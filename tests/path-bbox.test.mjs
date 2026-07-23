// Standalone assertions for computePathBBox arc handling. Run: npx tsx tests/path-bbox.test.mjs
import { buildGeometricPath } from '../src/services/geometricPaths.ts';
import { computePathBBox } from '../src/services/pdfGenerator.ts';

let fail = 0;
const check = (label, cond) => { console.log((cond ? 'ok   - ' : 'FAIL - ') + label); if (!cond) fail++; };
const dims = (p) => { const b = computePathBBox(p); return b ? { w: b.maxX - b.minX, h: b.maxY - b.minY, ...b } : null; };
const near = (a, b, eps = 1) => Math.abs(a - b) <= eps;

// Regression: circle/oval are drawn as pure arc (A) commands. Before the arc-aware
// bbox fix these collapsed to a zero-size box, cropping the PDF to a sliver.
const W = 800, H = 800, o = 24;

const circle = dims(buildGeometricPath(W, H, 'circle', o, 54, 0, 0));
check('circle bbox is not degenerate', circle.w > 1 && circle.h > 1);
// 54% of 800 = 432 → r = 216 + 24 = 240 → diameter 480, centred at 400.
check('circle bbox is the full circle (480x480 @160..640)',
  near(circle.w, 480) && near(circle.h, 480) && near(circle.minX, 160) && near(circle.maxX, 640) && near(circle.minY, 160) && near(circle.maxY, 640));

const oval = dims(buildGeometricPath(W, H, 'oval', o, 54, 0, 0));
check('oval bbox is not degenerate', oval.w > 1 && oval.h > 1);
check('oval bbox is wider than tall (horizontal ellipse)', oval.w > oval.h + 1);

// Square (uses L + small corner arcs) and triangle (pure L) must stay correct.
const square = dims(buildGeometricPath(W, H, 'square', o, 54, 0, 0));
check('square bbox spans 160..640', near(square.minX, 160) && near(square.maxX, 640) && near(square.minY, 160) && near(square.maxY, 640));

const tri = dims(buildGeometricPath(W, H, 'triangle', o, 54, 0, 0));
check('triangle bbox spans full height 160..640', near(tri.minY, 160) && near(tri.maxY, 640));

// Sanity: a plain polyline still works.
const poly = dims('M 10 10 L 100 10 L 100 80 Z');
check('polyline bbox correct', near(poly.minX, 10) && near(poly.maxX, 100) && near(poly.minY, 10) && near(poly.maxY, 80));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
