// Build src/templates/peltor.json from scripts/peltor-source.svg.
// The SVG artboard was authored in POINTS, not mm, so its viewBox numbers are ~3x
// the real size. We uniformly scale every path into millimetre space so the real
// sheet is TARGET_WIDTH_MM wide (proportions preserved). Run: node scripts/build-peltor.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Real physical sheet width in mm (height follows from the viewBox proportions).
const TARGET_WIDTH_MM = 83.9;

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, 'peltor-source.svg'), 'utf8');

const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
const vbW = parseFloat(vb[1]), vbH = parseFloat(vb[2]);
const k = TARGET_WIDTH_MM / vbW;             // viewBox units → mm
const round = (n) => Math.round(n * 1000) / 1000;

// Uniform scale of an SVG path's numeric tokens. Safe here because the shield
// paths contain NO arc commands (only M/L/H/V/C/S/Z, whose numbers are all
// coordinates/deltas) — so multiplying every number by k is an exact scale.
const scalePath = (d) => d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (m) => String(round(parseFloat(m) * k)));

const group = (id) => {
  const m = svg.match(new RegExp(`<g id="${id}"[^>]*>([\\s\\S]*?)</g>`));
  return m ? m[1] : '';
};
const paths = (xml) => [...xml.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);

const clipPaths = paths(group('Lager_5'));
const cutPaths  = paths(group('CutContour'));
if (clipPaths.length !== 2 || cutPaths.length !== 2) {
  throw new Error(`expected 2 clip + 2 cut paths, got ${clipPaths.length}/${cutPaths.length}`);
}

// PerfCutContour <rect> → scale params to mm → rounded-rect path + bbox.
const rect = group('PerfCutContour').match(/<rect[^>]*>/)[0];
const attr = (n) => parseFloat(rect.match(new RegExp(`${n}="([\\d.]+)"`))[1]) * k;
const x = round(attr('x')), y = round(attr('y')), w = round(attr('width')), h = round(attr('height')), rx = round(attr('rx')), ry = round(attr('ry'));
const sheetCutPath =
  `M${x + rx},${y} H${round(x + w - rx)} A${rx},${ry} 0 0 1 ${round(x + w)},${round(y + ry)} ` +
  `V${round(y + h - ry)} A${rx},${ry} 0 0 1 ${round(x + w - rx)},${round(y + h)} ` +
  `H${x + rx} A${rx},${ry} 0 0 1 ${x},${round(y + h - ry)} ` +
  `V${round(y + ry)} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`;

const firstX = (d) => parseFloat(d.match(/M\s*(-?[\d.]+)/)[1]);
const shields = [0, 1]
  .map((i) => ({ clip: clipPaths[i], cut: cutPaths[i], _x: firstX(clipPaths[i]) }))
  .sort((a, b) => a._x - b._x)
  .map(({ clip, cut }) => ({ clipPath: scalePath(clip), cutPath: scalePath(cut) }));

const template = {
  id: 'peltor',
  name: 'Peltor',
  widthMm: round(vbW * k),
  heightMm: round(vbH * k),
  sheetCutPath,
  sheetBBoxMm: { x, y, w, h },
  shields,
};

mkdirSync(join(here, '..', 'src', 'templates'), { recursive: true });
writeFileSync(join(here, '..', 'src', 'templates', 'peltor.json'), JSON.stringify(template, null, 2) + '\n');
console.log(`wrote peltor.json: ${template.widthMm}x${template.heightMm}mm (scale ${round(k)}), ${shields.length} shields, sheet bbox`, template.sheetBBoxMm);
