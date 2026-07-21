// Standalone assertions for sampleEdgeColor. Run: npx tsx tests/edge-color.test.mjs
import { sampleEdgeColor } from '../src/services/edgeColor.ts';

let fail = 0;
const check = (label, cond) => { console.log((cond ? 'ok   - ' : 'FAIL - ') + label); if (!cond) fail++; };

// Build a width*height RGBA buffer where every pixel is [r,g,b,a].
const solid = (w, h, r, g, b, a) => {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { buf[i*4]=r; buf[i*4+1]=g; buf[i*4+2]=b; buf[i*4+3]=a; }
  return buf;
};

const black = sampleEdgeColor(solid(4, 4, 0, 0, 0, 255), 4, 4);
check('all-black opaque → black', black.r === 0 && black.g === 0 && black.b === 0);

const red = sampleEdgeColor(solid(4, 4, 255, 0, 0, 255), 4, 4);
check('solid red → red', red.r === 255 && red.g === 0 && red.b === 0);

const clear = sampleEdgeColor(solid(4, 4, 0, 0, 0, 0), 4, 4);
check('fully transparent border → white fallback', clear.r === 255 && clear.g === 255 && clear.b === 255);

// Opaque colored border, transparent center → border color (center ignored).
const framed = (() => {
  const w = 5, h = 5, buf = Buffer.alloc(w*h*4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y*w + x) * 4;
    const border = x === 0 || y === 0 || x === w-1 || y === h-1;
    buf[i] = 0; buf[i+1] = border ? 200 : 50; buf[i+2] = 0; buf[i+3] = border ? 255 : 0;
  }
  return buf;
})();
const fr = sampleEdgeColor(framed, 5, 5);
check('framed: border green counted, center ignored', fr.g === 200 && fr.r === 0 && fr.b === 0);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
