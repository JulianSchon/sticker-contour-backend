import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { buildBitmap } from '../services/imageProcessor';
import { traceBitmap } from '../services/contourTracer';
import { clampParams } from '../services/pathSmoother';
import { generateContourPdf, computePathBBox } from '../services/pdfGenerator';
import { sampleArtworkEdgeColor } from '../services/edgeColor';
import { translateSvgPath } from '../utils/svgPathParser';
import { dropInnerHoles, keepOutermostPath } from '../utils/pathFilter';
import { buildGeometricPath, geometricPad } from '../services/geometricPaths';
import { cmToTargetPx, geometricImageScale, MAX_TARGET_PX } from '../services/sizeScaling';
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
      const nativeWidth = meta.width ?? 0;
      const nativeHeight = meta.height ?? 0;

      // ── Physical size: scale the working image so pixels ÷ 300 DPI = the
      // customer's chosen cm. Geometric → the cut OUTLINE is the chosen size;
      // contour → the ARTWORK is the chosen size. Absent/≤0 cm → unchanged.
      const widthCm = parseFloat(req.body.widthCm);
      const heightCm = parseFloat(req.body.heightCm);
      const hasCm = widthCm > 0 && heightCm > 0 && nativeWidth > 0 && nativeHeight > 0;

      let workingBuffer = req.file.buffer;
      let originalWidth = nativeWidth;
      let originalHeight = nativeHeight;

      if (hasCm) {
        const target = cmToTargetPx(widthCm, heightCm);
        if (params.shapeType === 'contour') {
          originalWidth = target.w;
          originalHeight = target.h;
        } else {
          const usesPerf = params.cutMode === 'perf' || params.cutMode === 'both';
          const outerOffset = usesPerf ? params.perfOffset : params.kissOffset;
          const withO = computePathBBox(buildGeometricPath(nativeWidth, nativeHeight, params.shapeType, outerOffset, params.shapeSize, params.shapeOffsetX, params.shapeOffsetY));
          const noO = computePathBBox(buildGeometricPath(nativeWidth, nativeHeight, params.shapeType, 0, params.shapeSize, params.shapeOffsetX, params.shapeOffsetY));
          if (withO && noO) {
            let { sx, sy } = geometricImageScale(
              { w: withO.maxX - withO.minX, h: withO.maxY - withO.minY },
              { w: noO.maxX - noO.minX, h: noO.maxY - noO.minY },
              target,
            );
            // Circle and square are isotropic — keep them undistorted.
            if (params.shapeType === 'circle' || params.shapeType === 'square') {
              const s = Math.min(sx, sy); sx = s; sy = s;
            }
            originalWidth = Math.max(1, Math.min(MAX_TARGET_PX, Math.round(nativeWidth * sx)));
            originalHeight = Math.max(1, Math.min(MAX_TARGET_PX, Math.round(nativeHeight * sy)));
          }
        }
        if (originalWidth !== nativeWidth || originalHeight !== nativeHeight) {
          workingBuffer = await sharp(req.file.buffer)
            .rotate()
            .resize(originalWidth, originalHeight, { fit: 'fill' })
            .png()
            .toBuffer();
        }
      }

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
          workingBuffer,
          params.threshold,
          needsKiss ? params.kissOffset : 0,
          hasCm ? MAX_TARGET_PX : undefined
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
            workingBuffer,
            params.threshold,
            params.perfOffset,
            hasCm ? MAX_TARGET_PX : undefined
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
      const imageForPdf = await sharp(workingBuffer)
        .rotate()
        .resize(unpaddedW, unpaddedH, { fit: 'fill' })
        .png()
        .toBuffer();

      // Sample one representative edge colour at the artwork's silhouette edge.
      // For a transparent-background subject this is the subject's edge colour
      // (never white → no white sliver on an edge-to-edge cut); for a fully
      // opaque image it reduces to the outer-border colour. Used for the bleed
      // band (all shapes) and the geometric body fill.
      const rawForEdge = await sharp(imageForPdf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const edgeColor = sampleArtworkEdgeColor(rawForEdge.data, rawForEdge.info.width, rawForEdge.info.height);
      const bodyFill = params.shapeType !== 'contour' ? edgeColor : undefined;

      // ── Print bleed: a thin SOLID edge-colour band OUTSIDE the cut so a
      // misaligned cut lands on ink, not white substrate. The cut is the TrimBox;
      // the band lives between TrimBox and MediaBox and is trimmed in production.
      // Single stickers opt in; the kiss-cut sheet opts out (bleed=false).
      const bleedRequested = req.body.bleed !== 'false' && req.body.bleed !== false;
      const BLEED_MM = 3;
      const pageBleedPx = bleedRequested ? Math.round((BLEED_MM * 300) / 25.4) : 0; // ~35px @300dpi
      const bleedColor = bleedRequested ? edgeColor : undefined;

      const pdfBuffer = await generateContourPdf(
        imageForPdf,
        kissSvgPath,
        perfSvgPath,
        unpaddedW,
        unpaddedH,
        originalWidth,
        originalHeight,
        kissPad,
        perfPad,
        params,
        0,
        pageBleedPx,
        bodyFill,
        bleedColor,
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
