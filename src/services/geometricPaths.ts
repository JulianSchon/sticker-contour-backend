import type { ShapeType } from '../types/contour';

/**
 * Generates a geometric SVG path centered on the image,
 * scaled to `sizePct`% of the image dimensions, with `offsetPx` applied outward.
 */
export function buildGeometricPath(
  width: number,
  height: number,
  shape: ShapeType,
  offsetPx: number,
  sizePct: number  // 10-100
): string {
  const s = Math.max(0.1, Math.min(1, sizePct / 100));
  const sw = width  * s;
  const sh = height * s;
  const ox = (width  - sw) / 2;  // left offset to center shape
  const oy = (height - sh) / 2;  // top offset to center shape
  const o = offsetPx;

  switch (shape) {
    case 'circle': {
      const cx = ox + sw / 2;
      const cy = oy + sh / 2;
      const r = Math.min(sw, sh) / 2 + o;
      if (r <= 0) return '';
      return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
    }

    case 'square': {
      const x = ox - o;
      const y = oy - o;
      const w = sw + o * 2;
      const h = sh + o * 2;
      if (w <= 0 || h <= 0) return '';
      return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
    }

    case 'triangle': {
      const topX  = ox + sw / 2;
      const topY  = oy - o;
      const botY  = oy + sh + o;
      const leftX  = ox - o * 0.577;
      const rightX = ox + sw + o * 0.577;
      return `M ${topX} ${topY} L ${rightX} ${botY} L ${leftX} ${botY} Z`;
    }

    default:
      return '';
  }
}

/** Returns the padding needed to contain the geometric shape + offset */
export function geometricPad(offsetPx: number): number {
  return Math.max(10, Math.abs(offsetPx) + 10);
}
