import potrace from 'potrace';
import sharp from 'sharp';
import type { ProcessedBitmap } from '../types/contour';

interface TraceOptions {
  smoothing: number; // 0-4
}

/**
 * Maps user smoothing level (0-4) to:
 * - preBlur: Gaussian blur sigma applied to the bitmap BEFORE tracing.
 *   Blurring the binary mask rounds jagged pixel corners so potrace traces
 *   smooth curves instead of staircases. This is the primary smoothing lever.
 * - optTolerance: potrace curve simplification (secondary lever).
 * - alphaMax: potrace corner rounding threshold.
 */
function smoothingConfig(smoothing: number) {
  const levels = [
    { preBlur: 0,   optTolerance: 0.1, alphaMax: 1.0 },  // 0: raw pixel edges
    { preBlur: 1,   optTolerance: 0.2, alphaMax: 1.0 },  // 1: slight rounding
    { preBlur: 2,   optTolerance: 0.4, alphaMax: 1.2 },  // 2: moderate
    { preBlur: 4,   optTolerance: 0.8, alphaMax: 1.5 },  // 3: smooth
    { preBlur: 8,   optTolerance: 1.5, alphaMax: 1.8 },  // 4: very smooth
  ];
  return levels[Math.max(0, Math.min(4, Math.round(smoothing)))];
}

/**
 * Applies a Gaussian blur to a raw binary bitmap then re-thresholds at 128.
 * The blur spreads the hard 0/255 boundary into a gradient, and re-thresholding
 * at mid-point produces a path that follows the center of the blurred edge —
 * corners become rounded curves naturally.
 */
async function preSmoothBitmap(bitmap: ProcessedBitmap, blurSigma: number): Promise<ProcessedBitmap> {
  if (blurSigma <= 0) return bitmap;

  // Convert raw 1-channel buffer → PNG first so sharp processes it reliably
  const png = await sharp(Buffer.from(bitmap.buffer), {
    raw: { width: bitmap.width, height: bitmap.height, channels: 1 },
  }).png().toBuffer();

  const { data, info } = await sharp(png)
    .blur(blurSigma)
    .threshold(128)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { buffer: Buffer.from(data), width: info.width, height: info.height, pad: bitmap.pad };
}

/**
 * Converts a binary bitmap into an SVG path string using potrace.
 * Applies pre-trace blur for smooth curves, then potrace curve fitting.
 */
export async function traceBitmap(
  bitmap: ProcessedBitmap,
  options: TraceOptions
): Promise<string> {
  const { preBlur, optTolerance, alphaMax } = smoothingConfig(options.smoothing);

  const smoothed = await preSmoothBitmap(bitmap, preBlur);
  const bmpBuffer = rawToBmp(smoothed.buffer, smoothed.width, smoothed.height);

  return new Promise((resolve, reject) => {
    potrace.trace(bmpBuffer, {
      turdSize: 4,
      optCurve: true,
      optTolerance,
      alphaMax,
      threshold: 128,
      blackOnWhite: true,
    }, (err: Error | null, svg: string) => {
      if (err) { reject(err); return; }

      const pathRegex = /\sd="([^"]+)"/g;
      const paths: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = pathRegex.exec(svg)) !== null) paths.push(match[1]);

      if (paths.length === 0) {
        reject(new Error('No contour found — image may be fully transparent or fully opaque'));
        return;
      }

      resolve(paths.join(' '));
    });
  });
}

function rawToBmp(raw: Buffer, width: number, height: number): Buffer {
  const rowSize = Math.floor((width + 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const paletteSize = 256 * 4;
  const headerSize = 54 + paletteSize;
  const fileSize = headerSize + pixelDataSize;
  const buf = Buffer.alloc(fileSize);
  let o = 0;

  buf.write('BM', o); o += 2;
  buf.writeUInt32LE(fileSize, o); o += 4;
  buf.writeUInt32LE(0, o); o += 4;
  buf.writeUInt32LE(headerSize, o); o += 4;
  buf.writeUInt32LE(40, o); o += 4;
  buf.writeInt32LE(width, o); o += 4;
  buf.writeInt32LE(-height, o); o += 4;
  buf.writeUInt16LE(1, o); o += 2;
  buf.writeUInt16LE(8, o); o += 2;
  buf.writeUInt32LE(0, o); o += 4;
  buf.writeUInt32LE(pixelDataSize, o); o += 4;
  buf.writeInt32LE(2835, o); o += 4;
  buf.writeInt32LE(2835, o); o += 4;
  buf.writeUInt32LE(256, o); o += 4;
  buf.writeUInt32LE(256, o); o += 4;

  for (let i = 0; i < 256; i++) { buf[o++] = i; buf[o++] = i; buf[o++] = i; buf[o++] = 0; }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) buf[o + x] = raw[y * width + x];
    o += rowSize;
  }

  return buf;
}
