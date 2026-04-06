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
const ROLAND_HEADER_MM   = 8;
const ROLAND_CIRCLE_R_MM = 5;    // Ø10 mm
const ROLAND_INSET_X_MM  = 5;    // = r — circles tangent to foil side edges
const ROLAND_INSET_Y_MM  = 5;    // = r — circles tangent to outer margin edges
const ROLAND_LMARK_LEN   = 2;    // mm — both L-mark arms
const ROLAND_LMARK_W     = 0.5;  // mm — arm thickness
const ROLAND_BOT_W_MM    = 7;    // bottom-right rectangle width
const ROLAND_BOT_H_MM    = 4;    // bottom-right rectangle height
const ROLAND_BOT_GAP_MM  = 4;    // gap from rect right edge to BR circle left edge

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
  regmarkType?: 'opos' | 'roland';
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

      const marginMm = regmarkType === 'roland' ? ROLAND_MARGIN_MM : OPOS_MARGIN_MM;

      const foilWidthPt  = foilWidthMm  * MM_TO_PT;
      const contentHPt   = totalLengthMm * MM_TO_PT;
      const marginPt     = marginMm * MM_TO_PT;
      const pageHeightPt = contentHPt + marginPt * 2;

      const sourceDocs = await Promise.all(
        files.map(f => PDFDocument.load(f.buffer))
      );

      const outDoc = await PDFDocument.create();
      const outPage = outDoc.addPage([foilWidthPt, pageHeightPt]);

      // ── Draw sticker copies ──────────────────────────────────────────────
      for (const copy of copies) {
        const srcDoc = sourceDocs[copy.fileIndex];
        if (!srcDoc) continue;
        const [embeddedPage] = await outDoc.embedPdf(srcDoc, [0]);

        const xPt = copy.x * MM_TO_PT;
        const yPt = marginPt + contentHPt
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
        drawRolandMarks(outPage, foilWidthMm, totalLengthMm, marginPt, contentHPt, pageHeightPt, MM_TO_PT);
      } else {
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
  MM_TO_PT: number,
): void {
  const rPt      = ROLAND_CIRCLE_R_MM * MM_TO_PT;
  const lLen     = ROLAND_LMARK_LEN   * MM_TO_PT;
  const lW       = ROLAND_LMARK_W     * MM_TO_PT;
  const headerPt = ROLAND_HEADER_MM   * MM_TO_PT;
  const insetXPt = ROLAND_INSET_X_MM  * MM_TO_PT;
  const insetYPt = ROLAND_INSET_Y_MM  * MM_TO_PT;
  const foilWPt  = foilWidthMm * MM_TO_PT;

  // pdf-lib uses bottom-left origin.
  // Top margin:    y ∈ [marginPt + contentHPt, pageHeightPt]
  // Content:       y ∈ [marginPt, marginPt + contentHPt]
  // Bottom margin: y ∈ [0, marginPt]
  //
  // Circles touch the outer edges of each margin band:
  //   top circles:    cy = pageHeightPt - insetYPt
  //   bottom circles: cy = insetYPt

  const topCircleCY = pageHeightPt - insetYPt;
  const botCircleCY = insetYPt;

  // Content boundary in pdf-lib coords
  const contentTopY = marginPt + contentHPt;   // top edge of content (in pdf-lib)
  const contentBotY = marginPt;                 // bottom edge of content

  // ── Header bar (top of page) ─────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: pageHeightPt - headerPt,
    width: foilWPt, height: headerPt,
    color: rgb(0.05, 0.04, 0),
  });

  // ── Registration circles ─────────────────────────────────────────────────
  const circleDefs = [
    { x: insetXPt,            y: topCircleCY },
    { x: foilWPt - insetXPt,  y: topCircleCY },
    { x: insetXPt,            y: botCircleCY },
    { x: foilWPt - insetXPt,  y: botCircleCY },
  ];
  for (const c of circleDefs) {
    page.drawCircle({ x: c.x, y: c.y, size: rPt, color: rgb(0, 0, 0) });
  }

  // ── L-marks at the four content boundary corners ─────────────────────────
  // Each mark has:
  //   - arm along the foil edge pointing toward the circle (away from content)
  //   - arm inward along the content boundary
  //
  // pdf-lib Y axis goes UP, so "toward top circle" means increasing Y.
  const lMarks = [
    // TL content corner (0, contentTopY): arm UP, arm RIGHT
    { cx: 0,       cy: contentTopY, ex: 0,       ey: contentTopY + lLen, ix: lLen,        iy: contentTopY },
    // TR content corner (foilWPt, contentTopY): arm UP, arm LEFT
    { cx: foilWPt, cy: contentTopY, ex: foilWPt, ey: contentTopY + lLen, ix: foilWPt - lLen, iy: contentTopY },
    // BL content corner (0, contentBotY): arm DOWN, arm RIGHT
    { cx: 0,       cy: contentBotY, ex: 0,       ey: contentBotY - lLen, ix: lLen,        iy: contentBotY },
    // BR content corner (foilWPt, contentBotY): arm DOWN, arm LEFT
    { cx: foilWPt, cy: contentBotY, ex: foilWPt, ey: contentBotY - lLen, ix: foilWPt - lLen, iy: contentBotY },
  ];
  for (const m of lMarks) {
    // Vertical arm (along foil edge toward circle)
    const armVX = m.ey > m.cy ? m.cx - lW / 2 : m.cx - lW / 2; // same x for both directions
    const armVY = Math.min(m.cy, m.ey);
    page.drawRectangle({ x: armVX, y: armVY, width: lW, height: lLen, color: rgb(0, 0, 0) });
    // Horizontal arm (inward along content boundary)
    const armHX = Math.min(m.cx, m.ix);
    const armHY = m.cy - lW / 2;
    page.drawRectangle({ x: armHX, y: armHY, width: lLen, height: lW, color: rgb(0, 0, 0) });
  }

  // ── Bottom-right sensor rectangle ────────────────────────────────────────
  // Right edge = BR circle left edge − BOT_GAP_MM
  const brCircleLeftX = foilWPt - insetXPt - rPt;
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

export default router;
