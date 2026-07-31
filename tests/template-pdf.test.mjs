// Run: npx tsx tests/template-pdf.test.mjs
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { generateTemplatePdf } from '../src/services/templatePdf.ts';

let fail = 0;
const check = (label, cond) => { console.log((cond ? 'ok   - ' : 'FAIL - ') + label); if (!cond) fail++; };

const tpl = JSON.parse(readFileSync('./src/templates/peltor.json', 'utf8'));
const w = 940, h = Math.round(940 * tpl.heightMm / tpl.widthMm);
const design = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();

const pdf = await generateTemplatePdf(design, tpl, { r: 243, g: 230, b: 39 });
check('valid PDF', pdf.slice(0, 5).toString() === '%PDF-');
check('declares a TrimBox', pdf.toString('latin1').includes('TrimBox'));

const mb = pdf.toString('latin1').match(/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/);
const MM2PT = 72 / 25.4;
check('MediaBox ~ artboard mm', mb &&
  Math.abs(parseFloat(mb[1]) - tpl.widthMm * MM2PT) < 2 &&
  Math.abs(parseFloat(mb[2]) - tpl.heightMm * MM2PT) < 2);

const bare = await generateTemplatePdf(
  await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(),
  tpl, { r: 0, g: 0, b: 0 });
check('design + bg add content vs a near-empty render', pdf.length > bare.length);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
