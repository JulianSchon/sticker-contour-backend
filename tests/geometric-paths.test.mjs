// Standalone assertions for buildGeometricPath. Run: npx tsx tests/geometric-paths.test.mjs
import { buildGeometricPath } from '../src/services/geometricPaths.ts';

let fail = 0;
const check = (label, cond) => { console.log((cond ? 'ok   - ' : 'FAIL - ') + label); if (!cond) fail++; };

// oval: distinct rx/ry ellipse arcs on a non-square image
const oval = buildGeometricPath(400, 200, 'oval', 0, 100, 0, 0);
check('oval emits arc commands', /\bA\b/.test(oval));
check('oval has two distinct radii (rx != ry)', (() => {
  const m = oval.match(/A ([\d.]+) ([\d.]+)/);
  return m && Math.abs(Number(m[1]) - Number(m[2])) > 1;
})());
// oval must be a horizontal ellipse (rx > ry) even on a SQUARE image — otherwise
// it collapses to a circle and is indistinguishable from the Circle shape.
check('oval is horizontal (rx > ry) on a square image', (() => {
  const sqOval = buildGeometricPath(300, 300, 'oval', 0, 100, 0, 0);
  const m = sqOval.match(/A ([\d.]+) ([\d.]+)/);
  return m && Number(m[1]) > Number(m[2]) + 1;
})());

// square: now rounded (contains arcs), radius small and < 15% of side
const sq = buildGeometricPath(300, 300, 'square', 0, 100, 0, 0);
check('square is rounded (arc commands present)', /\bA\b/.test(sq));
check('square radius is minimal (< 15% of side)', (() => {
  const m = sq.match(/A ([\d.]+) /);
  return m && Number(m[1]) > 0 && Number(m[1]) < 300 * 0.15;
})());

// circle + triangle unchanged
check('circle still works', buildGeometricPath(300, 300, 'circle', 0, 100, 0, 0).includes('A'));
check('triangle still sharp (no arcs)', !/\bA\b/.test(buildGeometricPath(300, 300, 'triangle', 0, 100, 0, 0)));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
