// Run: npx tsx tests/size-generate.test.mjs
import sharp from 'sharp';
import { buildGeometricPath } from '../src/services/geometricPaths.ts';
import { computePathBBox } from '../src/services/pdfGenerator.ts';
import { cmToTargetPx, geometricImageScale, MAX_TARGET_PX } from '../src/services/sizeScaling.ts';
import { buildBitmap } from '../src/services/imageProcessor.ts';

let fail = 0;
const check = (label, cond) => { console.log((cond ? 'ok   - ' : 'FAIL - ') + label); if (!cond) fail++; };
const near = (a, b, eps = 6) => Math.abs(a - b) <= eps;

// Contour: a large sized image is NOT re-capped at 2000 when maxDim is raised.
const img = await sharp({ create: { width: 3000, height: 3000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
const target20 = cmToTargetPx(20, 20); // ~2362px
const resized = await sharp(img).resize(target20.w, target20.h, { fit: 'fill' }).png().toBuffer();
const bmp = await buildBitmap(resized, 128, 24, MAX_TARGET_PX);
check('contour large size not re-capped at 2000', near(bmp.width - bmp.pad * 2, target20.w) && (bmp.width - bmp.pad * 2) > 2000);

// Geometric: solve → rebuilt perf outline equals target.
const nativeW = 800, nativeH = 800, o = 24, sizePct = 54;
const t = cmToTargetPx(10, 10);
const dims = (p) => { const b = computePathBBox(p); return { w: b.maxX - b.minX, h: b.maxY - b.minY }; };
const w1 = dims(buildGeometricPath(nativeW, nativeH, 'circle', o, sizePct, 0, 0));
const w0 = dims(buildGeometricPath(nativeW, nativeH, 'circle', 0, sizePct, 0, 0));
let { sx, sy } = geometricImageScale(w1, w0, t); const s = Math.min(sx, sy);
const rebuilt = dims(buildGeometricPath(Math.round(nativeW * s), Math.round(nativeH * s), 'circle', o, sizePct, 0, 0));
check('geometric outline = target cm (+-6px)', near(rebuilt.w, t.w) && near(rebuilt.h, t.h));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
