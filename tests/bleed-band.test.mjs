// Run: npx tsx tests/bleed-band.test.mjs
import { generateContourPdf } from '../src/services/pdfGenerator.ts';
import sharp from 'sharp';

let fail = 0;
const check = (label, cond) => { console.log((cond ? 'ok   - ' : 'FAIL - ') + label); if (!cond) fail++; };

const img = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer();
const circle = 'M 20 100 A 80 80 0 1 1 180 100 A 80 80 0 1 1 20 100 Z';
const params = { threshold: 128, kissOffset: 0, perfOffset: 0, smoothing: 0, enclose: false, cutMode: 'perf', shapeType: 'circle', shapeSize: 100, shapeOffsetX: 0, shapeOffsetY: 0 };

const withBleed = await generateContourPdf(img, circle, circle, 200, 200, 200, 200, 0, 0, params, 0, 35, undefined, { r: 0, g: 0, b: 255 });
const noBleed   = await generateContourPdf(img, circle, circle, 200, 200, 200, 200, 0, 0, params, 0, 0,  undefined, undefined);

check('withBleed is a valid PDF', withBleed.slice(0, 5).toString() === '%PDF-');
check('bleed band adds content (larger than no-bleed)', withBleed.length > noBleed.length);
check('withBleed declares a TrimBox', withBleed.toString('latin1').includes('TrimBox'));
check('noBleed has no TrimBox', !noBleed.toString('latin1').includes('TrimBox'));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
