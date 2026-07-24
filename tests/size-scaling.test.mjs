// Run: npx tsx tests/size-scaling.test.mjs
import { cmToTargetPx, geometricImageScale, MAX_TARGET_PX } from '../src/services/sizeScaling.ts';
import { buildGeometricPath } from '../src/services/geometricPaths.ts';
import { computePathBBox } from '../src/services/pdfGenerator.ts';

let fail = 0;
const check = (label, cond) => { console.log((cond ? 'ok   - ' : 'FAIL - ') + label); if (!cond) fail++; };
const near = (a, b, eps = 2) => Math.abs(a - b) <= eps;
const bboxDims = (p) => { const b = computePathBBox(p); return { w: b.maxX - b.minX, h: b.maxY - b.minY }; };

const t = cmToTargetPx(10, 10);
check('cmToTargetPx(10,10) ~ 1181x1181', near(t.w, 1181) && near(t.h, 1181));
const big = cmToTargetPx(100, 100);
check('cmToTargetPx clamps to MAX_TARGET_PX', big.w === MAX_TARGET_PX && big.h === MAX_TARGET_PX);

const nativeW = 800, nativeH = 800, o = 24, sizePct = 54;
const target = cmToTargetPx(10, 10);
const withO = bboxDims(buildGeometricPath(nativeW, nativeH, 'circle', o, sizePct, 0, 0));
const noO   = bboxDims(buildGeometricPath(nativeW, nativeH, 'circle', 0, sizePct, 0, 0));
let { sx, sy } = geometricImageScale(withO, noO, target);
const s = Math.min(sx, sy);
const rw = Math.round(nativeW * s), rh = Math.round(nativeH * s);
const rebuilt = bboxDims(buildGeometricPath(rw, rh, 'circle', o, sizePct, 0, 0));
check('geometric circle outline hits target (+/-2px)', near(rebuilt.w, target.w) && near(rebuilt.h, target.h));
check('offset stayed fixed (bbox = shape + 2*o)', near(rebuilt.w, sizePct/100*rw + 2*o));

const ovWithO = bboxDims(buildGeometricPath(nativeW, nativeH, 'oval', o, sizePct, 0, 0));
const ovNoO   = bboxDims(buildGeometricPath(nativeW, nativeH, 'oval', 0, sizePct, 0, 0));
const ovScale = geometricImageScale(ovWithO, ovNoO, target);
const orw = Math.round(nativeW * ovScale.sx);
const ovRebuilt = bboxDims(buildGeometricPath(orw, Math.round(nativeH * ovScale.sy), 'oval', o, sizePct, 0, 0));
check('oval outline width hits target (+/-2px)', near(ovRebuilt.w, target.w));

check('geometricImageScale guards w0<=0', geometricImageScale({w:10,h:10},{w:0,h:0},{w:100,h:100}).sx === 1);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
