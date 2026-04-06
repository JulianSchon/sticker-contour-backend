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
const ROLAND_MARGIN_MM   = 30;
const ROLAND_HEADER_MM   = 10;
const ROLAND_CIRCLE_R_MM = 5;    // 10 mm diameter
const ROLAND_INSET_X_MM  = 18;
const ROLAND_INSET_Y_MM  = 20;
const ROLAND_LMARK_LEN   = 7;
const ROLAND_LMARK_W     = 1.5;
const ROLAND_BOT_W_MM    = 20;
const ROLAND_BOT_H_MM    = 4;
const ROLAND_BOT_INSET_Y = 8;

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

  // pdf-lib uses bottom-left origin.
  // Top margin spans:  pageHeightPt - marginPt  →  pageHeightPt
  // Bottom margin spans: 0  →  marginPt

  const topCircleCY = pageHeightPt - marginPt + insetYPt;   // Y of top circles
  const botCircleCY = marginPt - insetYPt;                   // Y of bottom circles

  const corners = [
    { x: insetXPt,                  y: topCircleCY, side: 'tl' as const },
    { x: foilWidthMm * MM_TO_PT - insetXPt, y: topCircleCY, side: 'tr' as const },
    { x: insetXPt,                  y: botCircleCY, side: 'bl' as const },
    { x: foilWidthMm * MM_TO_PT - insetXPt, y: botCircleCY, side: 'br' as const },
  ];

  // ── Header bar ──────────────────────────────────────────────────────────
  page.drawRectangle({
    x: 0, y: pageHeightPt - headerPt,
    width: foilWidthMm * MM_TO_PT, height: headerPt,
    color: rgb(0.05, 0.04, 0),
  });

  // ── Registration circles ─────────────────────────────────────────────────
  for (const c of corners) {
    page.drawCircle({
      x: c.x, y: c.y, size: rPt,
      color: rgb(0, 0, 0),
    });
  }

  // ── L-shaped crop marks ───────────────────────────────────────────────────
  for (const c of corners) {
    const hSign = c.side === 'tl' || c.side === 'bl' ? 1 : -1;  // 1 = arm goes right
    const vSign = c.side === 'tl' || c.side === 'tr' ? -1 : 1;  // 1 = arm goes up (pdf-lib coords)

    // Horizontal arm
    const hx = hSign === 1 ? c.x : c.x - lLen;
    page.drawRectangle({
      x: hx, y: c.y - lW / 2,
      width: lLen, height: lW,
      color: rgb(0, 0, 0),
    });

    // Vertical arm
    const vy = vSign === 1 ? c.y : c.y - lLen;
    page.drawRectangle({
      x: c.x - lW / 2, y: vy,
      width: lW, height: lLen,
      color: rgb(0, 0, 0),
    });
  }

  // ── Bottom-centre rectangle ───────────────────────────────────────────────
  const botRectCY  = ROLAND_BOT_INSET_Y * MM_TO_PT;
  const botRectW   = ROLAND_BOT_W_MM * MM_TO_PT;
  const botRectH   = ROLAND_BOT_H_MM * MM_TO_PT;
  page.drawRectangle({
    x: (foilWidthMm * MM_TO_PT) / 2 - botRectW / 2,
    y: botRectCY - botRectH / 2,
    width: botRectW, height: botRectH,
    color: rgb(0, 0, 0),
  });
}

export default router;
