export interface EdgeColor { r: number; g: number; b: number; }

const ALPHA_MIN = 8;
const WHITE: EdgeColor = { r: 255, g: 255, b: 255 };

/**
 * Average of the opaque border pixels of an RGBA buffer (row-major, width*height*4).
 * Falls back to white when the border is fully transparent or the image is empty.
 */
export function sampleEdgeColor(
  rgba: Buffer | Uint8Array,
  width: number,
  height: number,
): EdgeColor {
  if (width < 1 || height < 1) return WHITE;

  let sr = 0, sg = 0, sb = 0, n = 0;
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (rgba[i + 3] >= ALPHA_MIN) { sr += rgba[i]; sg += rgba[i + 1]; sb += rgba[i + 2]; n++; }
  };

  for (let x = 0; x < width; x++) { at(x, 0); at(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { at(0, y); at(width - 1, y); }

  if (n === 0) return WHITE;
  return { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) };
}

/**
 * Average RGB of the artwork's opaque pixels lying on the silhouette boundary —
 * an opaque pixel (alpha ≥ 200) that touches a transparent pixel (alpha < 8) or
 * the image edge. For a transparent-background subject this yields the subject's
 * edge colour (never white); for a fully-opaque image it reduces to the outer
 * border average. Falls back to white when there are no opaque pixels.
 * Used for the bleed band (and the geometric body fill).
 */
export function sampleArtworkEdgeColor(
  rgba: Buffer | Uint8Array,
  width: number,
  height: number,
): EdgeColor {
  if (width < 1 || height < 1) return { r: 255, g: 255, b: 255 };
  const OPAQUE = 200, CLEAR = 8;
  const alpha = (x: number, y: number) => rgba[(y * width + x) * 4 + 3];
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < OPAQUE) continue;
      const onEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const nbrClear =
        (x > 0 && alpha(x - 1, y) < CLEAR) ||
        (x < width - 1 && alpha(x + 1, y) < CLEAR) ||
        (y > 0 && alpha(x, y - 1) < CLEAR) ||
        (y < height - 1 && alpha(x, y + 1) < CLEAR);
      if (onEdge || nbrClear) { sr += rgba[i]; sg += rgba[i + 1]; sb += rgba[i + 2]; n++; }
    }
  }
  if (n === 0) return { r: 255, g: 255, b: 255 };
  return { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) };
}
