// Run: npx tsx tests/pdf-body-fill.test.mjs
import { generateContourPdf } from '../src/services/pdfGenerator.ts';
import sharp from 'sharp';

let fail = 0;
const check = (label, cond) => { console.log((cond ? 'ok   - ' : 'FAIL - ') + label); if (!cond) fail++; };

// A 100x100 solid red PNG.
const img = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();

// A circle cut path bigger than the image (centered, radius 70 around a 100px image).
const circle = 'M -20 50 A 70 70 0 1 1 120 50 A 70 70 0 1 1 -20 50 Z';
const params = { threshold: 128, kissOffset: 0, perfOffset: 0, smoothing: 0, enclose: false, cutMode: 'kiss', shapeType: 'circle', shapeSize: 100, shapeOffsetX: 0, shapeOffsetY: 0 };

const withFill = await generateContourPdf(img, circle, null, 100, 100, 100, 100, 0, 0, params, 0, 0, { r: 255, g: 0, b: 0 });
const noFill   = await generateContourPdf(img, circle, null, 100, 100, 100, 100, 0, 0, params, 0, 0);

check('withFill is a valid PDF', withFill.slice(0, 5).toString() === '%PDF-');
check('noFill is a valid PDF', noFill.slice(0, 5).toString() === '%PDF-');
check('bodyFill adds content (larger than without)', withFill.length > noFill.length);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
