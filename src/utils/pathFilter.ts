/**
 * Extracts only the outermost contour from an SVG path `d` string.
 *
 * Potrace returns multiple sub-paths: the outer silhouette plus inner holes
 * (counter-clockwise winding). We split on 'M' commands, compute the signed
 * area of each sub-path via the shoelace formula, and return only the one
 * with the largest absolute area — which is always the outer boundary.
 */

interface Point { x: number; y: number; }

/** Parse an SVG sub-path (M...Z) into a flat list of (x, y) vertices. */
function subPathToPoints(tokens: string[]): Point[] {
  const points: Point[] = [];
  let i = 0;
  let cx = 0, cy = 0;

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case 'M': {
        cx = parseFloat(tokens[i++]);
        cy = parseFloat(tokens[i++]);
        points.push({ x: cx, y: cy });
        break;
      }
      case 'C': {
        // Cubic bezier — sample the endpoint only (sufficient for area estimation)
        i += 4; // skip control points
        cx = parseFloat(tokens[i++]);
        cy = parseFloat(tokens[i++]);
        points.push({ x: cx, y: cy });
        break;
      }
      case 'Z': case 'z': break;
      default: break;
    }
  }
  return points;
}

/** Shoelace formula — signed area (negative = clockwise, positive = counter-clockwise). */
function signedArea(pts: Point[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return area / 2;
}

/** Shared helper: split path into annotated sub-paths with signed areas. */
function annotateSubPaths(svgPath: string): Array<{ path: string; area: number }> {
  return svgPath.trim().split(/(?=\bM\b)/).filter(Boolean).map(sp => {
    const tokens = sp.trim().split(/\s+/);
    const pts = subPathToPoints(tokens);
    return { path: sp.trim(), area: signedArea(pts) };
  });
}

/**
 * Drops inner hole sub-paths from a potrace SVG `d` string.
 *
 * Potrace convention (blackOnWhite mode, Y increases downward):
 *   Outer silhouette → clockwise → positive signed area
 *   Inner holes      → counter-clockwise → negative signed area
 *
 * When a bitmap has a tiny discontinuity, potrace may split the outer boundary
 * into multiple sub-paths (all positive area). Returning all of them preserves
 * a fully closed contour and avoids visible gaps.
 */
export function dropInnerHoles(svgPath: string): string {
  const subPaths = annotateSubPaths(svgPath);
  if (subPaths.length <= 1) return svgPath;

  const outer = subPaths.filter(p => p.area >= 0);
  if (outer.length === 0) return svgPath; // fallback: return as-is

  return outer.map(p => p.path).join(' ');
}

/**
 * Returns only the single largest outer contour path (the enclosing silhouette).
 * Drops all inner holes AND any smaller disconnected outer fragments.
 * Use when the user wants a clean single closed shape with no inner detail.
 */
export function keepOutermostPath(svgPath: string): string {
  const subPaths = annotateSubPaths(svgPath);
  if (subPaths.length <= 1) return svgPath;

  const outer = subPaths.filter(p => p.area >= 0);
  const candidates = outer.length > 0 ? outer : subPaths;

  const best = candidates.reduce((a, b) => Math.abs(a.area) >= Math.abs(b.area) ? a : b);
  return best.path;
}
