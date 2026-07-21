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
