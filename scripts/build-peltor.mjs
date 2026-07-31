// Build src/templates/peltor.json from scripts/peltor-source.svg.
// Run: node scripts/build-peltor.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, 'peltor-source.svg'), 'utf8');

const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
const widthMm = parseFloat(vb[1]), heightMm = parseFloat(vb[2]);

const group = (id) => {
  const m = svg.match(new RegExp(`<g id="${id}"[^>]*>([\\s\\S]*?)</g>`));
  return m ? m[1] : '';
};
const paths = (xml) => [...xml.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(m => m[1]);

const clipPaths = paths(group('Lager_5'));
const cutPaths  = paths(group('CutContour'));
if (clipPaths.length !== 2 || cutPaths.length !== 2) {
  throw new Error(`expected 2 clip + 2 cut paths, got ${clipPaths.length}/${cutPaths.length}`);
}

const rect = group('PerfCutContour').match(/<rect[^>]*>/)[0];
const attr = (n) => parseFloat(rect.match(new RegExp(`${n}="([\\d.]+)"`))[1]);
const x = attr('x'), y = attr('y'), w = attr('width'), h = attr('height'), rx = attr('rx'), ry = attr('ry');
const sheetCutPath =
  `M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0 1 ${x + w},${y + ry} ` +
  `V${y + h - ry} A${rx},${ry} 0 0 1 ${x + w - rx},${y + h} ` +
  `H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + h - ry} ` +
  `V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`;

const firstX = (d) => parseFloat(d.match(/M\s*(-?[\d.]+)/)[1]);
const shields = [0, 1]
  .map(i => ({ clipPath: clipPaths[i], cutPath: cutPaths[i], _x: firstX(clipPaths[i]) }))
  .sort((a, b) => a._x - b._x)
  .map(({ clipPath, cutPath }) => ({ clipPath, cutPath }));

const template = { id: 'peltor', name: 'Peltor', widthMm, heightMm, sheetCutPath, sheetBBoxMm: { x, y, w, h }, shields };

mkdirSync(join(here, '..', 'src', 'templates'), { recursive: true });
writeFileSync(join(here, '..', 'src', 'templates', 'peltor.json'), JSON.stringify(template, null, 2) + '\n');
console.log(`wrote peltor.json: ${widthMm}x${heightMm}mm, ${shields.length} shields, sheet bbox`, template.sheetBBoxMm);
