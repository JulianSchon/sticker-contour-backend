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
// OPOS mark constants (must match frontend/src/lib/oposMarks.ts)
// ---------------------------------------------------------------------------
const OPOS_MARK_SIZE_MM  = 5;
const OPOS_MARGIN_MM     = 20;   // extra band added to top AND bottom of export
const OPOS_CENTER_DEPTH  = 10;   // mm from outer edge of margin to mark centre
const OPOS_MARK_INSET    = 15;   // mm from left / right foil edge
const OPOS_MAX_SPACING   = 200;  // mm max between consecutive marks

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
      // PDF points → mm  (1 pt = 25.4 / 72 mm)
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

      const { foilWidthMm, totalLengthMm, copies } = layout;
      const MM_TO_PT = 72 / 25.4;

      // Export page includes OPOS margin bands above and below the content
      const foilWidthPt  = foilWidthMm  * MM_TO_PT;
      const contentHPt   = totalLengthMm * MM_TO_PT;
      const marginPt     = OPOS_MARGIN_MM * MM_TO_PT;
      const pageHeightPt = contentHPt + marginPt * 2;

      // Load all source PDFs
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

        // copy.x / copy.y are mm from top-left of the content area.
        // In pdf-lib (bottom-left origin) y=0 is the bottom of the page.
        // Content area starts at marginPt from the bottom of the page.
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

      // ── Draw OPOS registration marks ─────────────────────────────────────
      // Marks are solid black squares in the top and bottom OPOS_MARGIN_MM bands.
      const markSizePt   = OPOS_MARK_SIZE_MM  * MM_TO_PT;
      const markHalfPt   = markSizePt / 2;
      const markDepthPt  = OPOS_CENTER_DEPTH  * MM_TO_PT;

      // Top band: in pdf-lib, top of page = pageHeightPt.
      // Mark centre is OPOS_CENTER_DEPTH mm from the outer (top) edge of the page.
      const topMarkCY_pt    = pageHeightPt - markDepthPt;
      // Bottom band: mark centre is OPOS_CENTER_DEPTH mm from the bottom edge.
      const botMarkCY_pt    = markDepthPt;

      const markXs = getOposMarkXPositions(foilWidthMm);

      for (const cxMm of markXs) {
        const cxPt = cxMm * MM_TO_PT;

        // Top row
        outPage.drawRectangle({
          x:      cxPt - markHalfPt,
          y:      topMarkCY_pt - markHalfPt,
          width:  markSizePt,
          height: markSizePt,
          color:  rgb(0, 0, 0),
        });

        // Bottom row
        outPage.drawRectangle({
          x:      cxPt - markHalfPt,
          y:      botMarkCY_pt - markHalfPt,
          width:  markSizePt,
          height: markSizePt,
          color:  rgb(0, 0, 0),
        });
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

export default router;
