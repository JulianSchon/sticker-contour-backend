// Run: npx tsx tests/bleed-generate.test.mjs
import sharp from 'sharp';
import { sampleArtworkEdgeColor } from '../src/services/edgeColor.ts';

let fail = 0;
const check = (label, cond) => { console.log((cond ? 'ok   - ' : 'FAIL - ') + label); if (!cond) fail++; };

const W = 200, H = 200;
const svg = Buffer.from(`<svg width="${W}" height="${H}"><circle cx="100" cy="100" r="80" fill="#cc2222"/></svg>`);
const raw = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const c = sampleArtworkEdgeColor(raw.data, raw.info.width, raw.info.height);
check('transparent-subject band colour is reddish, not white', c.r > 150 && c.g < 90 && c.b < 90);

const solid = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 10, g: 120, b: 30, alpha: 1 } } }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const cs = sampleArtworkEdgeColor(solid.data, 100, 100);
check('solid green image → green', cs.r < 40 && cs.g > 100 && cs.b < 60);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
