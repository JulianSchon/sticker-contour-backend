// Run: npx tsx tests/artwork-edge-color.test.mjs
import { sampleArtworkEdgeColor } from '../src/services/edgeColor.ts';

let fail = 0;
const check = (label, cond) => { console.log((cond ? 'ok   - ' : 'FAIL - ') + label); if (!cond) fail++; };

const make = (w, h, fn) => { const b = Buffer.alloc(w*h*4); for (let y=0;y<h;y++) for (let x=0;x<w;x++){ const i=(y*w+x)*4; const [r,g,bl,a]=fn(x,y); b[i]=r;b[i+1]=g;b[i+2]=bl;b[i+3]=a; } return b; };

// 1) Fully-opaque solid red → red (border-average branch)
const red = sampleArtworkEdgeColor(make(6,6,()=>[255,0,0,255]), 6, 6);
check('solid opaque red → red', red.r===255 && red.g===0 && red.b===0);

// 2) Red disc on transparent bg → red (silhouette boundary), NOT white.
const disc = make(7,7,(x,y)=>{ const dx=x-3,dy=y-3; return (dx*dx+dy*dy)<=4 ? [220,0,0,255] : [0,0,0,0]; });
const dc = sampleArtworkEdgeColor(disc, 7, 7);
check('red disc on transparent → reddish, not white', dc.r>150 && dc.g<60 && dc.b<60);

// 3) Fully transparent → white fallback
const clear = sampleArtworkEdgeColor(make(5,5,()=>[0,0,0,0]), 5, 5);
check('fully transparent → white', clear.r===255 && clear.g===255 && clear.b===255);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
