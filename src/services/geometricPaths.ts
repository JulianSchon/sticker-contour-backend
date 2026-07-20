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
  sizePct: number,      // 10-100
  moveXPct = 0,         // -50 to 50
  moveYPct = 0          // -50 to 50
): string {
  const s = Math.max(0.1, Math.min(1, sizePct / 100));
  const sw = width  * s;
  const sh = height * s;
  // Center + user move offset
  const ox = (width  - sw) / 2 + (width  * moveXPct / 100);
  const oy = (height - sh) / 2 + (height * moveYPct / 100);
  const o = offsetPx;

  switch (shape) {
    case 'circle': {
      const cx = ox + sw / 2;
      const cy = oy + sh / 2;
      const r = Math.min(sw, sh) / 2 + o;
      if (r <= 0) return '';
      return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
    }

    case 'oval': {
      const cx = ox + sw / 2;
      const cy = oy + sh / 2;
      // Always a horizontal ellipse (wider than tall, ~1:0.7) so it reads as an
      // "oval" regardless of image aspect — distinct from Circle even on a square
      // image. Minor axis capped to the box height so it still fits.
      const rx = sw / 2 + o;
      const ry = Math.min((sw / 2) * 0.7, sh / 2) + o;
      if (rx <= 0 || ry <= 0) return '';
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} Z`;
    }

    case 'square': {
      const x = ox - o;
      const y = oy - o;
      const w = sw + o * 2;
      const h = sh + o * 2;
      if (w <= 0 || h <= 0) return '';
      // Minimal corner radius so the cutter blade doesn't snag on sharp corners —
      // barely visible (~2% of the shorter side, capped at half the side). Machine
      // benefit only, not a customer-facing design choice.
      const r = Math.min(Math.min(sw, sh) * 0.02, Math.min(w, h) / 2);
      if (r <= 0) {
        return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
      }
      return `M ${x + r} ${y} L ${x + w - r} ${y} A ${r} ${r} 0 0 1 ${x + w} ${y + r} `
        + `L ${x + w} ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} `
        + `L ${x + r} ${y + h} A ${r} ${r} 0 0 1 ${x} ${y + h - r} `
        + `L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
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
