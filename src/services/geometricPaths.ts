import type { ShapeType } from '../types/contour';

/**
 * Generates a geometric SVG path that fits within the given dimensions,
 * with an inward offset applied (in pixels).
 */
export function buildGeometricPath(
  width: number,
  height: number,
  shape: ShapeType,
  offsetPx: number
): string {
  const o = offsetPx; // positive = expand outward, negative = shrink inward

  switch (shape) {
    case 'circle': {
      const cx = width / 2;
      const cy = height / 2;
      const r = Math.min(width, height) / 2 + o;
      if (r <= 0) return '';
      // SVG circle as path (two arcs)
      return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
    }

    case 'square': {
      const x = -o;
      const y = -o;
      const w = width + o * 2;
      const h = height + o * 2;
      if (w <= 0 || h <= 0) return '';
      return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
    }

    case 'triangle': {
      // Equilateral-ish triangle fitting the bounding box, offset applied to each edge
      const cx = width / 2;
      // Top center, bottom-left, bottom-right
      const topX = cx;
      const topY = -o;
      const botY = height + o;
      const leftX = -o * 0.577; // tan(30°) ≈ 0.577 for side offset
      const rightX = width + o * 0.577;
      return `M ${topX} ${topY} L ${rightX} ${botY} L ${leftX} ${botY} Z`;
    }

    default:
      return '';
  }
}
