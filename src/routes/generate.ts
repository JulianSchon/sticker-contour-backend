import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { buildBitmap, bleedColors } from '../services/imageProcessor';
import { traceBitmap } from '../services/contourTracer';
import { clampParams } from '../services/pathSmoother';
import { generateContourPdf, computePathBBox } from '../services/pdfGenerator';
import { sampleEdgeColor } from '../services/edgeColor';
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

      // For geometric shapes the cut can extend past the artwork. Sample the
      // image's border color so the PDF fills the body with the continuing
      // background instead of a bare gap. Contour cuts hug the art — no fill.
      let bodyFill: { r: number; g: number; b: number } | undefined;
      if (params.shapeType !== 'contour') {
        const raw = await sharp(imageForPdf)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        bodyFill = sampleEdgeColor(raw.data, raw.info.width, raw.info.height);
      }

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
        const pw = paddedRaw.info.width, ph = paddedRaw.info.height;

        // Rasterise the outer cut contour into an "inside the cut" mask so the
        // bleed only fills OUTSIDE the cut (never the sticker body / negative
        // pockets). The cut path is in unpadded coords; shift it by bleedPad to
        // match the padded bitmap.
        const outerCutPath = (params.cutMode === 'kiss' ? kissSvgPath : perfSvgPath) ?? kissSvgPath;
        const maskSvg = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}">` +
          `<path transform="translate(${bleedPad},${bleedPad})" d="${outerCutPath}" fill="#fff" fill-rule="nonzero"/></svg>`,
        );
        const maskRaw = await sharp(maskSvg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const insideCut = new Uint8Array(pw * ph);
        for (let p = 0; p < insideCut.length; p++) insideCut[p] = maskRaw.data[p * 4 + 3] > 127 ? 1 : 0;

        // Radius is the 3mm bleed band (pageBleedPx) — not bleedPad, which also
        // includes the offset reach + padding and would over-extend the colour.
        const bledRaw = bleedColors(paddedRaw.data, pw, ph, pageBleedPx, insideCut);
        pdfImage = await sharp(bledRaw, {
          raw: { width: pw, height: ph, channels: 4 },
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
        bodyFill,
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
