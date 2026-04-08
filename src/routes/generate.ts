import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { buildBitmap } from '../services/imageProcessor';
import { traceBitmap } from '../services/contourTracer';
import { clampParams } from '../services/pathSmoother';
import { generateContourPdf } from '../services/pdfGenerator';
import { translateSvgPath } from '../utils/svgPathParser';
import { dropInnerHoles, keepOutermostPath } from '../utils/pathFilter';
import { buildGeometricPath } from '../services/geometricPaths';
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
      });

      const meta = await sharp(req.file.buffer).metadata();
      const originalWidth = meta.width ?? 0;
      const originalHeight = meta.height ?? 0;

      // Geometric shape: skip bitmap tracing, generate path directly
      if (params.shapeType !== 'contour') {
        const PAD = 10;
        const kissSvgPath = buildGeometricPath(originalWidth, originalHeight, params.shapeType, params.kissOffset);
        const perfSvgPath = (params.cutMode === 'perf' || params.cutMode === 'both')
          ? buildGeometricPath(originalWidth, originalHeight, params.shapeType, params.perfOffset)
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
        kissPad = 10;
        perfPad = 10;
        unpaddedW = originalWidth;
        unpaddedH = originalHeight;
        kissSvgPath = buildGeometricPath(originalWidth, originalHeight, params.shapeType, params.kissOffset);
        perfSvgPath = (params.cutMode === 'perf' || params.cutMode === 'both')
          ? buildGeometricPath(originalWidth, originalHeight, params.shapeType, params.perfOffset)
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

      const pdfBuffer = await generateContourPdf(
        req.file.buffer,
        kissSvgPath,
        perfSvgPath,
        unpaddedW,
        unpaddedH,
        originalWidth,
        originalHeight,
        kissPad,
        perfPad,
        params
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
