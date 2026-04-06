import PDFDocument from 'pdfkit';
import type { ContourParams } from '../types/contour';

const DPI = 300;
const STROKE_WIDTH_PX = 2;
const SAFETY_MARGIN_PX = 10;
const PAGE_MARGIN_INCHES = 0.1; // ~3 mm

const REGISTRATION_MARK_RADIUS = 3;
const REGISTRATION_MARK_INSET  = 10;

function calculateDimensions(
  imageWidth: number,
  imageHeight: number,
  kissCutOffsetPx: number,
  perfCutOffsetPx: number,
) {
  const maxOffsetPx  = Math.max(Math.abs(kissCutOffsetPx), Math.abs(perfCutOffsetPx));
  const pageMarginPx = PAGE_MARGIN_INCHES * DPI;
  const padding      = maxOffsetPx + pageMarginPx + STROKE_WIDTH_PX + SAFETY_MARGIN_PX;

  const viewBoxWidth  = imageWidth  + padding * 2;
  const viewBoxHeight = imageHeight + padding * 2;

  const widthInPoints  = (viewBoxWidth  / DPI) * 72;
  const heightInPoints = (viewBoxHeight / DPI) * 72;

  const scaleFactor = widthInPoints / viewBoxWidth;

  const imageX = padding * scaleFactor;
  const imageY = padding * scaleFactor;

  return { widthInPoints, heightInPoints, padding, scaleFactor, imageX, imageY };
}

function drawRegistrationMarks(
  doc: InstanceType<typeof PDFDocument>,
  widthInPoints: number,
  heightInPoints: number,
): void {
  doc.save();
  doc.fillColor('black');
  doc.circle(REGISTRATION_MARK_INSET, REGISTRATION_MARK_INSET, REGISTRATION_MARK_RADIUS).fill();
  doc.circle(widthInPoints - REGISTRATION_MARK_INSET, REGISTRATION_MARK_INSET, REGISTRATION_MARK_RADIUS).fill();
  doc.circle(REGISTRATION_MARK_INSET, heightInPoints - REGISTRATION_MARK_INSET, REGISTRATION_MARK_RADIUS).fill();
  doc.circle(widthInPoints - REGISTRATION_MARK_INSET, heightInPoints - REGISTRATION_MARK_INSET, REGISTRATION_MARK_RADIUS).fill();
  doc.restore();
}

export async function generateContourPdf(
  imageBuffer: Buffer,
  kissSvgPath: string,
  perfSvgPath: string | null,
  bitmapWidth: number,
  bitmapHeight: number,
  originalWidth: number,
  originalHeight: number,
  kissPad: number,
  perfPad: number,
  params: ContourParams,
): Promise<Buffer> {
  const needsKiss = params.cutMode === 'kiss' || params.cutMode === 'both';
  const needsPerf = (params.cutMode === 'perf' || params.cutMode === 'both') && !!perfSvgPath;

  const kissOffsetPx = needsKiss ? params.kissOffset : 0;
  const perfOffsetPx = needsPerf ? params.perfOffset : 0;

  const { widthInPoints, heightInPoints, padding, scaleFactor, imageX, imageY } =
    calculateDimensions(bitmapWidth, bitmapHeight, kissOffsetPx, perfOffsetPx);

  const imageWidthPt  = bitmapWidth  * scaleFactor;
  const imageHeightPt = bitmapHeight * scaleFactor;

  // Matches Effectit generateCombinedPDF exactly
  const doc = new PDFDocument({
    size: [widthInPoints, heightInPoints],
    margin: 0,
  });

  // @ts-expect-error — addSpotColor exists in pdfkit but missing from @types/pdfkit
  doc.addSpotColor('CutContour',     0, 100,   0, 0);
  // @ts-expect-error
  doc.addSpotColor('PerfCutContour', 100,   0, 0, 0);

  doc.image(imageBuffer, imageX, imageY, {
    width:  imageWidthPt,
    height: imageHeightPt,
  });

  const translateX = padding * scaleFactor;
  const translateY = padding * scaleFactor;

  doc.save();
  doc.translate(translateX, translateY);
  doc.scale(scaleFactor);

  if (needsKiss) {
    doc
      .path(kissSvgPath)
      .strokeColor('CutContour')
      .lineWidth(0.25 / scaleFactor)
      .undash()
      .stroke();
  }

  if (needsPerf && perfSvgPath) {
    doc
      .path(perfSvgPath)
      .strokeColor('PerfCutContour')
      .lineWidth(0.25 / scaleFactor)
      .undash()
      .stroke();
  }

  doc.restore();


  doc.end();

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data',  (chunk: Buffer) => chunks.push(chunk));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
