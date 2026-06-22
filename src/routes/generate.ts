import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { buildBitmap, bleedColors } from '../services/imageProcessor';
import { traceBitmap } from '../services/contourTracer';
import { clampParams } from '../services/pathSmoother';
import { generateContourPdf } from '../services/pdfGenerator';
import { translateSvgPath } from '../utils/svgPathParser';
import { dropInnerHoles, keepOutermostPath } from '../utils/pathFilter';
import { buildGeometricPath, geometricPad } from '../services/geometricPaths';
import type { ContourPreviewResponse } from '../types/contour';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

router.post(
  '/contour-preview',
  upload.single('image'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) { res.status(400).json({ error: 'No image uploaded' }); return; }

      const params = clampParams({
        threshold: parseFloat(req.body.threshold),
        kissOffset: parseFloat(req.body.kissOffset),
        perfOffset: parseFloat(req.body.perfOffset),
        smoothing: parseFloat(req.body.smoothing),
        enclose: req.body.enclose,
        cutMode: req.body.cutMode,
        shapeType: req.body.shapeType,
        shapeSize: parseFloat(req.body.shapeSize),
        shapeOffsetX: parseFloat(req.body.shapeOffsetX),
        shapeOffsetY: parseFloat(req.body.shapeOffsetY),
      });

      const meta = await sharp(req.file.buffer).metadata();
      const originalWidth = meta.width ?? 0;
      const originalHeight = meta.height ?? 0;

      // Geometric shape: skip bitmap tracing, generate path directly
      if (params.shapeType !== 'contour') {
        const PAD = geometricPad(Math.max(params.kissOffset, params.perfOffset));
        const kissSvgPath = buildGeometricPath(originalWidth, originalHeight, params.shapeType, params.kissOffset, params.shapeSize, params.shapeOffsetX, params.shapeOffsetY);
        const perfSvgPath = (params.cutMode === 'perf' || params.cutMode === 'both')
          ? buildGeometricPath(originalWidth, originalHeight, params.shapeType, params.perfOffset, params.shapeSize, params.shapeOffsetX, params.shapeOffsetY)
          : null;
        const response: ContourPreviewResponse = {
          kissSvgPath,
          perfSvgPath,
          width: originalWidth,
          height: originalHeight,
          originalWidth,
          originalHeight,
          pad: PAD,
        };
        res.json(response);
        return;
      }

      const needsPerf = params.cutMode === 'perf' || params.cutMode === 'both';
      const needsKiss = params.cutMode === 'kiss' || params.cutMode === 'both';

      const applyEnclose = (path: string) => {
        const noHoles = dropInnerHoles(path);
        return params.enclose ? keepOutermostPath(noHoles) : noHoles;
      };

      const kissBitmap = await buildBitmap(
        req.file.buffer,
        params.threshold,
        needsKiss ? params.kissOffset : 0
      );
      const kissPad = kissBitmap.pad;
      const unpaddedW = kissBitmap.width - kissPad * 2;
      const unpaddedH = kissBitmap.height - kissPad * 2;

      const kissSvgPath = applyEnclose(translateSvgPath(
        await traceBitmap(kissBitmap, { smoothing: params.smoothing }),
        -kissPad, -kissPad
      ));

      let perfSvgPath: string | null = null;
      let perfPad = kissPad;
      if (needsPerf) {
        const perfBitmap = await buildBitmap(
          req.file.buffer,
          params.threshold,
          params.perfOffset
        );
        perfPad = perfBitmap.pad;
        perfSvgPath = applyEnclose(translateSvgPath(
          await traceBitmap(perfBitmap, { smoothing: params.smoothing }),
          -perfPad, -perfPad
        ));
      }

      const displayPad = Math.max(kissPad, perfPad);

      const response: ContourPreviewResponse = {
        kissSvgPath,
        perfSvgPath,
        width: unpaddedW,
        height: unpaddedH,
        originalWidth,
        originalHeight,
        pad: displayPad,
      };

      res.json(response);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/generate',
  upload.single('image'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) { res.status(400).json({ error: 'No image uploaded' }); return; }

      const params = clampParams({
        threshold: parseFloat(req.body.threshold),
        kissOffset: parseFloat(req.body.kissOffset),
        perfOffset: parseFloat(req.body.perfOffset),
        smoothing: parseFloat(req.body.smoothing),
        enclose: req.body.enclose,
        cutMode: req.body.cutMode,
        shapeType: req.body.shapeType,
        shapeSize: parseFloat(req.body.shapeSize),
        shapeOffsetX: parseFloat(req.body.shapeOffsetX),
        shapeOffsetY: parseFloat(req.body.shapeOffsetY),
      });

      const meta = await sharp(req.file.buffer).metadata();
      const originalWidth = meta.width ?? 0;
      const originalHeight = meta.height ?? 0;

      let kissSvgPath: string;
      let perfSvgPath: string | null = null;
      let unpaddedW: number;
      let unpaddedH: number;
      let kissPad: number;
      let perfPad: number;

      if (params.shapeType !== 'contour') {
        // Geometric shape — no bitmap processing needed
        kissPad = geometricPad(params.kissOffset);
        perfPad = geometricPad(params.perfOffset);
        unpaddedW = originalWidth;
        unpaddedH = originalHeight;
        kissSvgPath = buildGeometricPath(originalWidth, originalHeight, params.shapeType, params.kissOffset, params.shapeSize, params.shapeOffsetX, params.shapeOffsetY);
        perfSvgPath = (params.cutMode === 'perf' || params.cutMode === 'both')
          ? buildGeometricPath(originalWidth, originalHeight, params.shapeType, params.perfOffset, params.shapeSize, params.shapeOffsetX, params.shapeOffsetY)
          : null;
      } else {
        const needsPerf = params.cutMode === 'perf' || params.cutMode === 'both';
        const needsKiss = params.cutMode === 'kiss' || params.cutMode === 'both';

        const applyEnclose = (path: string) => {
          const noHoles = dropInnerHoles(path);
          return params.enclose ? keepOutermostPath(noHoles) : noHoles;
        };

        const kissBitmap = await buildBitmap(
          req.file.buffer,
          params.threshold,
          needsKiss ? params.kissOffset : 0
        );
        kissPad = kissBitmap.pad;
        unpaddedW = kissBitmap.width - kissPad * 2;
        unpaddedH = kissBitmap.height - kissPad * 2;

        kissSvgPath = applyEnclose(translateSvgPath(
          await traceBitmap(kissBitmap, { smoothing: params.smoothing }),
          -kissPad, -kissPad
        ));

        perfPad = kissPad;
        if (needsPerf) {
          const perfBitmap = await buildBitmap(
            req.file.buffer,
            params.threshold,
            params.perfOffset
          );
          perfPad = perfBitmap.pad;
          perfSvgPath = applyEnclose(translateSvgPath(
            await traceBitmap(perfBitmap, { smoothing: params.smoothing }),
            -perfPad, -perfPad
          ));
        }
      }

      // Resize image to bitmap dimensions before PDF embedding — avoids
      // encoding a full-res (e.g. 6000px) image in a 2000px-based PDF.
      const imageForPdf = await sharp(req.file.buffer)
        .rotate()
        .resize(unpaddedW, unpaddedH, { fit: 'fill' })
        .png()
        .toBuffer();

      // ── Print bleed (production only, opt-in) ─────────────────────────────
      // Extend edge colours past the cut so a misaligned cut lands on ink, not
      // white substrate. The ink lives BEYOND the cut (page MediaBox) while the
      // TrimBox marks the cut. Single stickers request it; the kiss-cut sheet
      // does not (it packs tight by the cut and the backing absorbs miscuts).
      //
      // Only when the cut hugs the artwork (offset ≤ 0). A positive offset is an
      // intentional white border/margin, which the bleed would otherwise fill.
      const bleedRequested = req.body.bleed !== 'false' && req.body.bleed !== false;
      const outerOffsetPx = params.cutMode === 'kiss' ? params.kissOffset : params.perfOffset;
      const wantBleed = bleedRequested && outerOffsetPx <= 0;
      let pdfImage = imageForPdf;
      let bleedPad = 0;
      let pageBleedPx = 0;
      if (wantBleed) {
        const BLEED_MM = 3;
        pageBleedPx = Math.round((BLEED_MM * 300) / 25.4); // ~35px at 300 DPI
        const maxOffsetPx = Math.max(
          Math.abs(params.kissOffset) || 0,
          Math.abs(params.perfOffset) || 0,
        );
        bleedPad = Math.ceil(maxOffsetPx) + pageBleedPx + 4; // reach past the cut + bleed
        const paddedRaw = await sharp(imageForPdf)
          .ensureAlpha()
          .extend({ top: bleedPad, bottom: bleedPad, left: bleedPad, right: bleedPad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .raw()
          .toBuffer({ resolveWithObject: true });
        const bledRaw = bleedColors(paddedRaw.data, paddedRaw.info.width, paddedRaw.info.height, bleedPad);
        pdfImage = await sharp(bledRaw, {
          raw: { width: paddedRaw.info.width, height: paddedRaw.info.height, channels: 4 },
        }).png().toBuffer();
      }

      const pdfBuffer = await generateContourPdf(
        pdfImage,
        kissSvgPath,
        perfSvgPath,
        unpaddedW,
        unpaddedH,
        originalWidth,
        originalHeight,
        kissPad,
        perfPad,
        params,
        bleedPad,
        pageBleedPx,
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="sticker-cutcontour.pdf"');
      res.setHeader('Content-Length', pdfBuffer.length.toString());
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
