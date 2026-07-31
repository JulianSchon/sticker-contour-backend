import PDFDocument from 'pdfkit';
import type { StickerTemplate } from '../templates';
import type { EdgeColor } from './edgeColor';

const MM2PT = 72 / 25.4; // mm → PDF points

/**
 * Compose the finished Peltor sheet PDF: fill the whole artboard (sheet + baked-in
 * bleed) with bgColor, draw the design raster clipped to the union of the shield
 * printed-extent paths, then stroke the shield cuts (CutContour) and the sheet cut
 * (PerfCutContour). TrimBox = the sheet rect. Geometry is in mm; scale(MM2PT) maps
 * mm → points.
 */
export async function generateTemplatePdf(
  designPng: Buffer,
  template: StickerTemplate,
  bgColor: EdgeColor,
): Promise<Buffer> {
  const pageW = template.widthMm * MM2PT;
  const pageH = template.heightMm * MM2PT;
  const doc = new PDFDocument({ size: [pageW, pageH], margin: 0 });

  // @ts-expect-error — addSpotColor exists in pdfkit but missing from @types
  doc.addSpotColor('CutContour', 0, 100, 0, 0);
  // @ts-expect-error
  doc.addSpotColor('PerfCutContour', 100, 0, 0, 0);

  const rgb: [number, number, number] = [bgColor.r, bgColor.g, bgColor.b];

  doc.save();
  doc.scale(MM2PT); // user units are now mm, origin top-left

  // 1. white sheet / carrier (fills the whole artboard incl. the outer bleed)
  doc.rect(0, 0, template.widthMm, template.heightMm).fill([255, 255, 255]);

  // 2. shield interiors = bgColor. Fill the clipPaths (the printed extent, which
  //    sits ~2mm outside the cut) so the colour bleeds past each shield cut.
  for (const s of template.shields) doc.path(s.clipPath);
  doc.fill(rgb);

  // 3. design clipped to the union of the shield printed extents, over the colour
  doc.save();
  for (const s of template.shields) doc.path(s.clipPath);
  doc.clip();
  doc.image(designPng, 0, 0, { width: template.widthMm, height: template.heightMm });
  doc.restore();

  // 4. cut lines — shields = CutContour, sheet = PerfCutContour (hairline ~0.25pt)
  const hairline = 0.25 / MM2PT;
  for (const s of template.shields) {
    doc.path(s.cutPath).strokeColor('CutContour').lineWidth(hairline).undash().stroke();
  }
  doc.path(template.sheetCutPath).strokeColor('PerfCutContour').lineWidth(hairline).undash().stroke();

  doc.restore();

  // TrimBox = the sheet rect (mm, SVG top-left/y-down) → PDF points (bottom-left/y-up)
  const b = template.sheetBBoxMm;
  const trim = [
    b.x * MM2PT,
    (template.heightMm - (b.y + b.h)) * MM2PT,
    (b.x + b.w) * MM2PT,
    (template.heightMm - b.y) * MM2PT,
  ];
  // @ts-expect-error — page.dictionary is pdfkit internal, not in @types
  doc.page.dictionary.data.TrimBox = trim;

  doc.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
