import sharp from 'sharp';
import type { ProcessedBitmap } from '../types/contour';

const MAX_DIM = 2000;

// ---------------------------------------------------------------------------
// Color space helpers
// ---------------------------------------------------------------------------

/** sRGB gamma expansion (linear light) */
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Linear RGB → CIE Lab (D65 illuminant) */
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.00000;
  const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;

  const fx = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  const fz = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Euclidean distance in Lab */
function labDistance(a: [number, number, number], b: [number, number, number]): number {
  const dL = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

// ---------------------------------------------------------------------------
// Background estimation — average all four edge borders
// ---------------------------------------------------------------------------

async function estimateBgColor(
  buf: Buffer,
  width: number,
  height: number
): Promise<{ r: number; g: number; b: number }> {
  const { data } = await sharp(buf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const stride = width * 3;
  let r = 0, g = 0, b = 0, n = 0;

  for (let x = 0; x < width; x++) {
    // top row
    r += data[x * 3]; g += data[x * 3 + 1]; b += data[x * 3 + 2]; n++;
    // bottom row
    const bi = (height - 1) * stride + x * 3;
    r += data[bi]; g += data[bi + 1]; b += data[bi + 2]; n++;
  }
  for (let y = 1; y < height - 1; y++) {
    // left col
    r += data[y * stride]; g += data[y * stride + 1]; b += data[y * stride + 2]; n++;
    // right col
    const ri = y * stride + (width - 1) * 3;
    r += data[ri]; g += data[ri + 1]; b += data[ri + 2]; n++;
  }

  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

// ---------------------------------------------------------------------------
// Otsu's method — finds optimal threshold on a 0-255 histogram
// ---------------------------------------------------------------------------

function otsu(hist: Uint32Array, total: number): number {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let sumB = 0, wB = 0, bestVar = 0, threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const meanB = sumB / wB;
    const meanF = (sumAll - sumB) / wF;
    const variance = wB * wF * (meanB - meanF) ** 2;

    if (variance > bestVar) { bestVar = variance; threshold = t; }
  }
  return threshold;
}

// ---------------------------------------------------------------------------
// Morphological ops (binary: 0 = sticker, 255 = background)
// ---------------------------------------------------------------------------

/** Dilation: expands sticker (0) into background (255) */
function dilate(data: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.round(radius);
  if (r <= 0) return data;
  const tmp = new Uint8Array(width * height).fill(255);
  const out = new Uint8Array(width * height).fill(255);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const xMin = Math.max(0, x - r), xMax = Math.min(width - 1, x + r);
      for (let nx = xMin; nx <= xMax; nx++) {
        if (data[y * width + nx] === 0) { tmp[y * width + x] = 0; break; }
      }
    }
  }
  // Vertical pass
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const yMin = Math.max(0, y - r), yMax = Math.min(height - 1, y + r);
      for (let ny = yMin; ny <= yMax; ny++) {
        if (tmp[ny * width + x] === 0) { out[y * width + x] = 0; break; }
      }
    }
  }
  return out;
}

/** Erosion: shrinks sticker region */
function erode(data: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.round(radius);
  if (r <= 0) return data;
  const tmp = new Uint8Array(width * height).fill(0);
  const out = new Uint8Array(width * height).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const xMin = Math.max(0, x - r), xMax = Math.min(width - 1, x + r);
      let isBg = false;
      for (let nx = xMin; nx <= xMax; nx++) {
        if (data[y * width + nx] === 255) { isBg = true; break; }
      }
      tmp[y * width + x] = isBg ? 255 : 0;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const yMin = Math.max(0, y - r), yMax = Math.min(height - 1, y + r);
      let isBg = false;
      for (let ny = yMin; ny <= yMax; ny++) {
        if (tmp[ny * width + x] === 255) { isBg = true; break; }
      }
      out[y * width + x] = isBg ? 255 : 0;
    }
  }
  return out;
}

const close = (d: Uint8Array, w: number, h: number, r: number) => erode(dilate(d, w, h, r), w, h, r);
const open  = (d: Uint8Array, w: number, h: number, r: number) => dilate(erode(d, w, h, r), w, h, r);

// ---------------------------------------------------------------------------
// Interior hole fill via BFS from edges
// ---------------------------------------------------------------------------

function fillInteriorHoles(data: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(data);
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const idx = y * width + x;
      if (data[idx] === 255 && !visited[idx]) { visited[idx] = 1; queue.push(idx); }
    }
  }
  for (let y = 1; y < height - 1; y++) {
    for (const x of [0, width - 1]) {
      const idx = y * width + x;
      if (data[idx] === 255 && !visited[idx]) { visited[idx] = 1; queue.push(idx); }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % width, y = Math.floor(idx / width);
    for (const n of [
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
    ]) {
      if (n >= 0 && !visited[n] && data[n] === 255) { visited[n] = 1; queue.push(n); }
    }
  }

  for (let i = 0; i < result.length; i++) {
    if (!visited[i]) result[i] = 0;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Builds a clean binary bitmap (sticker=0, background=255) ready for potrace.
 *
 * For solid-background images (JPEG etc.):
 *   1. Estimate background color from all four image borders
 *   2. Compute per-pixel Lab distance from background
 *   3. Apply Otsu's method to find optimal threshold on the distance map
 *   4. Morphological close (r=2) → fills small gaps
 *   5. Morphological open  (r=1) → removes small noise blobs
 *   6. Flood-fill interior holes → solid silhouette
 *
 * For transparent images: uses alpha channel directly.
 *
 * Then dilates by `offsetPx` for the contour offset.
 */
export async function buildBitmap(
  inputBuffer: Buffer,
  threshold: number,   // user slider (used as multiplier on Otsu for solid images)
  offsetPx: number
): Promise<ProcessedBitmap> {
  // PAD must be large enough to contain the full offset expansion.
  // Without enough pad the dilation hits the canvas edge and gets clipped.
  const PAD = Math.max(10, Math.abs(offsetPx) + 10);

  // 1. Resize and normalise to PNG (preserves alpha, avoids JPEG re-compression artifacts)
  const meta = await sharp(inputBuffer).metadata();
  let rw = meta.width ?? 0;
  let rh = meta.height ?? 0;
  const hasAlpha = meta.hasAlpha ?? false;

  let resized: Buffer;
  if (rw > MAX_DIM || rh > MAX_DIM) {
    const result = await sharp(inputBuffer)
      .rotate()
      .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    resized = result.data; rw = result.info.width; rh = result.info.height;
  } else {
    resized = await sharp(inputBuffer).rotate().png().toBuffer();
  }

  // 2. Pad BEFORE background estimation so the mask never clips at image edges.
  // Transparent images get a transparent pad; solid images get their background color
  // sampled from the pre-pad borders (accurate — before padding pollutes the edges).
  let padBg: { r: number; g: number; b: number; alpha: number };
  if (hasAlpha) {
    padBg = { r: 0, g: 0, b: 0, alpha: 0 };
  } else {
    const bg = await estimateBgColor(resized, rw, rh);
    padBg = { r: bg.r, g: bg.g, b: bg.b, alpha: 255 };
  }

  resized = await sharp(resized)
    .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: padBg })
    .png()
    .toBuffer();
  rw += PAD * 2;
  rh += PAD * 2;

  let mask: Uint8Array;

  if (hasAlpha) {
    // --- Transparent image: extract alpha ---
    const { data } = await sharp(resized)
      .extractChannel('alpha')
      .raw()
      .toBuffer({ resolveWithObject: true });
    // alpha: 255=opaque sticker → 0 (black), 0=transparent bg → 255 (white)
    mask = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      mask[i] = data[i] > threshold ? 0 : 255;
    }
  } else {
    // --- Solid background image: Lab distance + Otsu ---
    const { data: rgb } = await sharp(resized)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const bgRgb = await estimateBgColor(resized, rw, rh);
    const bgLab = rgbToLab(bgRgb.r, bgRgb.g, bgRgb.b);

    // Build distance map (0-255) and histogram
    const distMap = new Uint8Array(rw * rh);
    const hist = new Uint32Array(256);
    let maxDist = 0;
    const rawDists = new Float32Array(rw * rh);

    for (let i = 0; i < rw * rh; i++) {
      const pLab = rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
      const d = labDistance(pLab, bgLab);
      rawDists[i] = d;
      if (d > maxDist) maxDist = d;
    }
    if (maxDist === 0) maxDist = 1;
    for (let i = 0; i < rw * rh; i++) {
      const v = Math.round((rawDists[i] / maxDist) * 255);
      distMap[i] = v;
      hist[v]++;
    }

    // Otsu on distance map, then scale by user threshold (128=neutral)
    const otsuT = otsu(hist, rw * rh);
    // User threshold slider: <128 = more permissive, >128 = stricter
    const finalT = Math.max(1, Math.min(254, Math.round(otsuT * (threshold / 128))));

    // Threshold: pixel with high distance from bg = sticker (0 = black)
    mask = new Uint8Array(rw * rh);
    for (let i = 0; i < rw * rh; i++) {
      mask[i] = distMap[i] >= finalT ? 0 : 255;
    }
  }

  // 3. Morphological clean: close (fill gaps) then open (remove noise)
  let cleaned = close(mask, rw, rh, 2);
  cleaned = open(cleaned, rw, rh, 1);

  // 4. Flood-fill interior holes → solid silhouette per component
  const filled = fillInteriorHoles(cleaned, rw, rh);

  // 5. Merge disconnected components.
  // A large closing (dilate → erode with same radius) bridges gaps between
  // nearby elements (e.g. separate text lines, logo pieces) so the tracer
  // sees one unified shape rather than dozens of tiny separate contours.
  // The merge radius (12px) is chosen to close typical inter-element gaps
  // without distorting the overall silhouette shape.
  const MERGE_RADIUS = 12;
  const merged = close(filled, rw, rh, MERGE_RADIUS);
  const reHoled = fillInteriorHoles(merged, rw, rh);

  // 6. Dilate or erode for contour offset
  const final = offsetPx > 0
    ? dilate(reHoled, rw, rh, offsetPx)
    : offsetPx < 0
    ? erode(reHoled, rw, rh, -offsetPx)
    : reHoled;

  return { buffer: Buffer.from(final), width: rw, height: rh, pad: PAD };
}
