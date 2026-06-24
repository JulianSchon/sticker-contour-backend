import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { PDFDocument, degrees, rgb } from 'pdf-lib';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error(`Expected PDF, got: ${file.mimetype}`));
  },
});

// ---------------------------------------------------------------------------
// OPOS constants (must match frontend/src/lib/oposMarks.ts)
// ---------------------------------------------------------------------------
const OPOS_MARK_SIZE_MM  = 5;
const OPOS_MARGIN_MM     = 20;
const OPOS_CENTER_DEPTH  = 10;
const OPOS_MARK_INSET    = 15;
const OPOS_MAX_SPACING   = 200;

function getOposMarkXPositions(foilWidthMm: number): number[] {
  const left  = OPOS_MARK_INSET;
  const right = foilWidthMm - OPOS_MARK_INSET;
  if (right <= left) return [foilWidthMm / 2];
  const positions: number[] = [left];
  let cursor = left;
  while (cursor + OPOS_MAX_SPACING < right - OPOS_MAX_SPACING / 2) {
    cursor += OPOS_MAX_SPACING;
    positions.push(cursor);
  }
  positions.push(right);
  return positions.filter((x, i, arr) => i === 0 || x - arr[i - 1] >= 10);
}

// ---------------------------------------------------------------------------
// Roland VersaWorks constants (must match frontend/src/lib/rolandMarks.ts)
// ---------------------------------------------------------------------------
// Roland constants — must match frontend/src/lib/rolandMarks.ts
const ROLAND_MARGIN_MM   = 15;   // = 2×r + 5 mm clearance
const ROLAND_BLEED_MM    = 5;    // extra page padding so circles aren't clipped at edge
const ROLAND_CIRCLE_R_MM = 5;    // Ø10 mm
const ROLAND_INSET_X_MM  = 5;    // = r — circles tangent to foil side edges
const ROLAND_INSET_Y_MM  = 5;    // = r — circles tangent to outer margin edges
const ROLAND_LMARK_LEN   = 2;    // mm — both L-mark arms
const ROLAND_LMARK_W     = 0.5;  // mm — arm thickness
const ROLAND_BOT_W_MM    = 7;    // bottom-right rectangle width
const ROLAND_BOT_H_MM    = 4;    // bottom-right rectangle height
const ROLAND_BOT_GAP_MM  = 4;    // gap from rect right edge to BR circle left edge

// ---------------------------------------------------------------------------
// Graphtec CE8000 constants (must match frontend/src/lib/graphtecMarks.ts)
// ---------------------------------------------------------------------------
const GRAPHTEC_MARK_LEN_MM = 20;   // L arm length
const GRAPHTEC_MARK_W_MM   = 1.0;  // line thickness
const GRAPHTEC_MARGIN_MM   = 30;   // top + bottom band = inset_y(7)+arm(20)+3mm gap (full mark stays in band)
const GRAPHTEC_INSET_X_MM  = 10;   // L corner inset from foil side edges
const GRAPHTEC_INSET_Y_MM  = 7;    // L corner inset from outer edge of the band

// ---------------------------------------------------------------------------
// POST /api/print-planning/pdf-info
// ---------------------------------------------------------------------------
router.post(
  '/print-planning/pdf-info',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      const page = pdfDoc.getPage(0);
      const { width, height } = page.getSize();
      const widthMm  = (width  / 72) * 25.4;
      const heightMm = (height / 72) * 25.4;
      res.json({ widthMm, heightMm });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/print-planning/export
// ---------------------------------------------------------------------------
interface ExportCopy {
  fileIndex: number;
  x: number;
  y: number;
  widthMm: number;
  heightMm: number;
  rotated: boolean;
}

interface ExportLayout {
  foilWidthMm: number;
  totalLengthMm: number;
  copies: ExportCopy[];
  regmarkType?: 'opos' | 'roland' | 'graphtec' | 'none';
}

router.post(
  '/print-planning/export',
  upload.array('files', 50),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files uploaded' }); return;
      }

      let layout: ExportLayout;
      try {
        layout = JSON.parse(req.body.layout as string) as ExportLayout;
      } catch {
        res.status(400).json({ error: 'Invalid layout JSON' }); return;
      }

      const { foilWidthMm, totalLengthMm, copies, regmarkType = 'opos' } = layout;
      const MM_TO_PT = 72 / 25.4;

      const marginMm = regmarkType === 'roland' ? ROLAND_MARGIN_MM
        : regmarkType === 'graphtec' ? GRAPHTEC_MARGIN_MM
        : regmarkType === 'none' ? 0
        : OPOS_MARGIN_MM;
      const bleedMm  = regmarkType === 'roland' ? ROLAND_BLEED_MM  : 0;

      const foilWidthPt  = foilWidthMm  * MM_TO_PT;
      const contentHPt   = totalLengthMm * MM_TO_PT;
      const marginPt     = marginMm * MM_TO_PT;
      const bleedPt      = bleedMm  * MM_TO_PT;
      // Roland: page is wider/taller by bleed on all sides so circles aren't clipped
      const pageWidthPt  = foilWidthPt  + bleedPt * 2;
      const pageHeightPt = contentHPt + marginPt * 2 + bleedPt * 2;

      const sourceDocs = await Promise.all(
        files.map(f => PDFDocument.load(f.buffer))
      );

      const outDoc = await PDFDocument.create();
      const outPage = outDoc.addPage([pageWidthPt, pageHeightPt]);

      // ── Draw sticker copies ──────────────────────────────────────────────
      for (const copy of copies) {
        const srcDoc = sourceDocs[copy.fileIndex];
        if (!srcDoc) continue;
        const [embeddedPage] = await outDoc.embedPdf(srcDoc, [0]);

        const xPt = bleedPt + copy.x * MM_TO_PT;
        const yPt = bleedPt + marginPt + contentHPt
                  - copy.y * MM_TO_PT
                  - copy.heightMm * MM_TO_PT;

        if (copy.rotated) {
          outPage.drawPage(embeddedPage, {
            x:      xPt + copy.widthMm  * MM_TO_PT,
            y:      yPt,
            width:  copy.heightMm * MM_TO_PT,
            height: copy.widthMm  * MM_TO_PT,
            rotate: degrees(90),
          });
        } else {
          outPage.drawPage(embeddedPage, {
            x:      xPt,
            y:      yPt,
            width:  copy.widthMm  * MM_TO_PT,
            height: copy.heightMm * MM_TO_PT,
          });
        }
      }

      // ── Draw registration marks ──────────────────────────────────────────
      if (regmarkType === 'roland') {
        drawRolandMarks(outPage, foilWidthMm, totalLengthMm, marginPt, contentHPt, pageHeightPt, bleedPt, MM_TO_PT);
      } else if (regmarkType === 'graphtec') {
        drawGraphtecMarks(outPage, foilWidthMm, marginPt, contentHPt, pageHeightPt, MM_TO_PT);
      } else if (regmarkType !== 'none') {
        drawOposMarks(outPage, foilWidthMm, marginPt, contentHPt, pageHeightPt, MM_TO_PT);
      }

      const pdfBytes = await outDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="print-foil.pdf"');
      res.send(Buffer.from(pdfBytes));
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// OPOS mark drawing
// ---------------------------------------------------------------------------
function drawOposMarks(
  page: ReturnType<PDFDocument['addPage']>,
  foilWidthMm: number,
  marginPt: number,
  contentHPt: number,
  pageHeightPt: number,
  MM_TO_PT: number,
): void {
  const markSizePt  = OPOS_MARK_SIZE_MM * MM_TO_PT;
  const markHalfPt  = markSizePt / 2;
  const markDepthPt = OPOS_CENTER_DEPTH * MM_TO_PT;
  const topMarkCY   = pageHeightPt - markDepthPt;
  const botMarkCY   = markDepthPt;

  for (const cxMm of getOposMarkXPositions(foilWidthMm)) {
    const cxPt = cxMm * MM_TO_PT;

    page.drawRectangle({
      x: cxPt - markHalfPt, y: topMarkCY - markHalfPt,
      width: markSizePt, height: markSizePt,
      color: rgb(0, 0, 0),
    });
    page.drawRectangle({
      x: cxPt - markHalfPt, y: botMarkCY - markHalfPt,
      width: markSizePt, height: markSizePt,
      color: rgb(0, 0, 0),
    });
  }
}

// ---------------------------------------------------------------------------
// Roland VersaWorks mark drawing
// ---------------------------------------------------------------------------
function drawRolandMarks(
  page: ReturnType<PDFDocument['addPage']>,
  foilWidthMm: number,
  _totalLengthMm: number,
  marginPt: number,
  contentHPt: number,
  pageHeightPt: number,
  bleedPt: number,
  MM_TO_PT: number,
): void {
  const rPt      = ROLAND_CIRCLE_R_MM * MM_TO_PT;
  const lLen     = ROLAND_LMARK_LEN   * MM_TO_PT;
  const lW       = ROLAND_LMARK_W     * MM_TO_PT;
  const insetXPt = ROLAND_INSET_X_MM  * MM_TO_PT;
  const insetYPt = ROLAND_INSET_Y_MM  * MM_TO_PT;
  const foilWPt  = foilWidthMm * MM_TO_PT;

  // All coordinates are offset by bleedPt so the foil content starts at (bleedPt, bleedPt)
  // in pdf-lib's bottom-left coordinate system.
  //
  // Circles sit at insetX/Y from the foil edges (tangent), which now have space to breathe.
  //   top circles:    cy = bleedPt + marginPt + contentHPt + insetYPt
  //   bottom circles: cy = bleedPt + insetYPt  (from bottom of page)

  const topCircleCY = bleedPt + marginPt + contentHPt + insetYPt;
  const botCircleCY = bleedPt + insetYPt;

  // Content boundary in pdf-lib coords (offset by bleed)
  const contentTopY = bleedPt + marginPt + contentHPt;
  const contentBotY = bleedPt + marginPt;

  // ── Registration circles ─────────────────────────────────────────────────
  const circleDefs = [
    { x: bleedPt + insetXPt,            y: topCircleCY },
    { x: bleedPt + foilWPt - insetXPt,  y: topCircleCY },
    { x: bleedPt + insetXPt,            y: botCircleCY },
    { x: bleedPt + foilWPt - insetXPt,  y: botCircleCY },
  ];
  for (const c of circleDefs) {
    page.drawCircle({ x: c.x, y: c.y, size: rPt, color: rgb(0, 0, 0) });
  }

  // ── L-marks at the four content boundary corners ─────────────────────────
  // pdf-lib Y axis goes UP.
  // Each L sits exactly at the foil edge × content boundary crossing:
  //   Left  corners: vertical arm at x=0 (flush with foil left edge)
  //   Right corners: vertical arm at x=foilWPt-lW (flush with foil right edge)
  //   Top   corners: vertical arm goes UP   (toward top circles, +Y)
  //   Bottom corners: vertical arm goes DOWN (toward bottom circles, -Y)
  //   Horizontal arm goes inward (right for left corners, left for right corners)

  const lx0 = bleedPt;              // left foil edge in page coords
  const lx1 = bleedPt + foilWPt;   // right foil edge in page coords

  // TL – arm up, arm right
  page.drawRectangle({ x: lx0,        y: contentTopY,        width: lW,   height: lLen, color: rgb(0,0,0) });
  page.drawRectangle({ x: lx0,        y: contentTopY - lW/2, width: lLen, height: lW,   color: rgb(0,0,0) });

  // TR – arm up, arm left
  page.drawRectangle({ x: lx1-lW,     y: contentTopY,        width: lW,   height: lLen, color: rgb(0,0,0) });
  page.drawRectangle({ x: lx1-lLen,   y: contentTopY - lW/2, width: lLen, height: lW,   color: rgb(0,0,0) });

  // BL – arm down, arm right
  page.drawRectangle({ x: lx0,        y: contentBotY - lLen, width: lW,   height: lLen, color: rgb(0,0,0) });
  page.drawRectangle({ x: lx0,        y: contentBotY - lW/2, width: lLen, height: lW,   color: rgb(0,0,0) });

  // BR – arm down, arm left
  page.drawRectangle({ x: lx1-lW,     y: contentBotY - lLen, width: lW,   height: lLen, color: rgb(0,0,0) });
  page.drawRectangle({ x: lx1-lLen,   y: contentBotY - lW/2, width: lLen, height: lW,   color: rgb(0,0,0) });

  // ── Bottom-right sensor rectangle ────────────────────────────────────────
  // Right edge = BR circle left edge − BOT_GAP_MM
  const brCircleLeftX = bleedPt + foilWPt - insetXPt - rPt;
  const botRectRightX = brCircleLeftX - ROLAND_BOT_GAP_MM * MM_TO_PT;
  const botRectW      = ROLAND_BOT_W_MM * MM_TO_PT;
  const botRectH      = ROLAND_BOT_H_MM * MM_TO_PT;
  page.drawRectangle({
    x: botRectRightX - botRectW,
    y: botCircleCY - botRectH / 2,
    width:  botRectW,
    height: botRectH,
    color: rgb(0, 0, 0),
  });
}

// ---------------------------------------------------------------------------
// Graphtec CE8000 mark drawing — four Type 1 L-marks at the sheet corners.
// Built as a loop over a list of mark rows so segment marks can be added later.
// ---------------------------------------------------------------------------
function drawGraphtecMarks(
  page: ReturnType<PDFDocument['addPage']>,
  foilWidthMm: number,
  marginPt: number,
  contentHPt: number,
  pageHeightPt: number,
  MM_TO_PT: number,
): void {
  const lLen   = GRAPHTEC_MARK_LEN_MM * MM_TO_PT;
  const lW     = GRAPHTEC_MARK_W_MM   * MM_TO_PT;
  const insetX = GRAPHTEC_INSET_X_MM  * MM_TO_PT;
  const insetY = GRAPHTEC_INSET_Y_MM  * MM_TO_PT;
  const foilWPt = foilWidthMm * MM_TO_PT;

  const leftX  = insetX;                 // L corner X, left marks
  const rightX = foilWPt - insetX;       // L corner X, right marks
  // pdf-lib Y is UP. Top band at top of page, bottom band at bottom.
  const topY   = pageHeightPt - insetY;  // L corner Y, top band
  const botY   = insetY;                 // L corner Y, bottom band

  // dx/dy = arm directions toward the content (pdf coords):
  //   top marks: content BELOW  → dy = -1 ; bottom marks: content ABOVE → dy = +1
  //   left marks point right (+1), right marks point left (-1)
  const marks = [
    { cx: leftX,  cy: topY, dx:  1, dy: -1 }, // TL
    { cx: rightX, cy: topY, dx: -1, dy: -1 }, // TR
    { cx: leftX,  cy: botY, dx:  1, dy:  1 }, // BL
    { cx: rightX, cy: botY, dx: -1, dy:  1 }, // BR
  ];

  for (const m of marks) {
    // vertical arm (thickness lW, length lLen) — thickness on the dx side
    page.drawRectangle({
      x: m.dx > 0 ? m.cx : m.cx - lW,
      y: m.dy > 0 ? m.cy : m.cy - lLen,
      width: lW, height: lLen, color: rgb(0, 0, 0),
    });
    // horizontal arm (length lLen, thickness lW) — thickness on the dy side
    page.drawRectangle({
      x: m.dx > 0 ? m.cx : m.cx - lLen,
      y: m.dy > 0 ? m.cy : m.cy - lW,
      width: lLen, height: lW, color: rgb(0, 0, 0),
    });
  }
}

export default router;
