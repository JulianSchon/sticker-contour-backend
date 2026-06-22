import PDFDocument from 'pdfkit';
import type { ContourParams } from '../types/contour';

const DPI = 300;
const SCALE_FACTOR = 72 / DPI; // pixels → PDF points
const STROKE_WIDTH_PX = 2;
const SAFETY_MARGIN_PX = 10;
const PAGE_MARGIN_INCHES = 0.1; // ~3 mm
const CROP_MARGIN_PX = 3;

// ---------------------------------------------------------------------------
// SVG path bounding box (handles M, L, H, V, C, Q, Z and relative variants)
// ---------------------------------------------------------------------------
function computePathBBox(pathData: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const tokenRe = /([MmLlHhVvCcQqZz])|(-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)/gi;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(pathData)) !== null) tokens.push(m[0]);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let cx = 0, cy = 0;
  let i = 0;

  function addPt(x: number, y: number) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  function num(): number { return parseFloat(tokens[i++]); }

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (!/^[MmLlHhVvCcQqZz]$/.test(cmd)) { i++; continue; }
    i++;
    switch (cmd) {
      case 'M': { cx = num(); cy = num(); addPt(cx, cy); break; }
      case 'm': { cx += num(); cy += num(); addPt(cx, cy); break; }
      case 'L': { cx = num(); cy = num(); addPt(cx, cy); break; }
      case 'l': { cx += num(); cy += num(); addPt(cx, cy); break; }
      case 'H': { cx = num(); addPt(cx, cy); break; }
      case 'h': { cx += num(); addPt(cx, cy); break; }
      case 'V': { cy = num(); addPt(cx, cy); break; }
      case 'v': { cy += num(); addPt(cx, cy); break; }
      case 'C': {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
        addPt(x1, y1); addPt(x2, y2); addPt(x, y);
        cx = x; cy = y; break;
      }
      case 'c': {
        const dx1 = num(), dy1 = num(), dx2 = num(), dy2 = num(), dx = num(), dy = num();
        addPt(cx + dx1, cy + dy1); addPt(cx + dx2, cy + dy2); addPt(cx + dx, cy + dy);
        cx += dx; cy += dy; break;
      }
      case 'Q': {
        const x1 = num(), y1 = num(), x = num(), y = num();
        addPt(x1, y1); addPt(x, y);
        cx = x; cy = y; break;
      }
      case 'q': {
        const dx1 = num(), dy1 = num(), dx = num(), dy = num();
        addPt(cx + dx1, cy + dy1); addPt(cx + dx, cy + dy);
        cx += dx; cy += dy; break;
      }
      case 'Z': case 'z': break;
    }
  }

  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
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

  // ── Compute path bounding box in bitmap pixel coordinates ────────────────
  // The kiss/perf paths are already offset outward, so their bbox IS the tight
  // cut boundary. We crop the PDF to that + CROP_MARGIN_PX on each side.
  let bbox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

  if (needsKiss) bbox = computePathBBox(kissSvgPath);
  if (needsPerf && perfSvgPath) {
    const pb = computePathBBox(perfSvgPath);
    if (pb) {
      bbox = bbox
        ? { minX: Math.min(bbox.minX, pb.minX), minY: Math.min(bbox.minY, pb.minY),
            maxX: Math.max(bbox.maxX, pb.maxX), maxY: Math.max(bbox.maxY, pb.maxY) }
        : pb;
    }
  }

  // ── Determine crop region in bitmap coords ───────────────────────────────
  let cropMinX: number, cropMinY: number, cropMaxX: number, cropMaxY: number;

  if (bbox) {
    cropMinX = bbox.minX - CROP_MARGIN_PX;
    cropMinY = bbox.minY - CROP_MARGIN_PX;
    cropMaxX = bbox.maxX + CROP_MARGIN_PX;
    cropMaxY = bbox.maxY + CROP_MARGIN_PX;
  } else {
    // Fallback: use full image + safety margin
    const maxOffsetPx = Math.max(
      needsKiss ? Math.abs(params.kissOffset) : 0,
      needsPerf ? Math.abs(params.perfOffset) : 0,
    );
    const padding = maxOffsetPx + (PAGE_MARGIN_INCHES * DPI) + STROKE_WIDTH_PX + SAFETY_MARGIN_PX;
    cropMinX = -padding;
    cropMinY = -padding;
    cropMaxX = bitmapWidth + padding;
    cropMaxY = bitmapHeight + padding;
  }

  // ── PDF page dimensions (pixels → points at 300 DPI) ────────────────────
  const pageWidthPt  = (cropMaxX - cropMinX) * SCALE_FACTOR;
  const pageHeightPt = (cropMaxY - cropMinY) * SCALE_FACTOR;

  // Image sits at bitmap coords (0, 0); shift by -crop origin to place on page
  const imageX = -cropMinX * SCALE_FACTOR;
  const imageY = -cropMinY * SCALE_FACTOR;

  const imageWidthPt  = bitmapWidth  * SCALE_FACTOR;
  const imageHeightPt = bitmapHeight * SCALE_FACTOR;

  // Path is in bitmap coords; same offset applies
  const translateX = -cropMinX * SCALE_FACTOR;
  const translateY = -cropMinY * SCALE_FACTOR;

  // ── Build PDF ────────────────────────────────────────────────────────────
  const doc = new PDFDocument({ size: [pageWidthPt, pageHeightPt], margin: 0 });

  // @ts-expect-error — addSpotColor exists in pdfkit but missing from @types/pdfkit
  doc.addSpotColor('CutContour',     0, 100,   0, 0);
  // @ts-expect-error
  doc.addSpotColor('PerfCutContour', 100,   0, 0, 0);

  doc.image(imageBuffer, imageX, imageY, { width: imageWidthPt, height: imageHeightPt });

  doc.save();
  doc.translate(translateX, translateY);
  doc.scale(SCALE_FACTOR);

  if (needsKiss) {
    doc
      .path(kissSvgPath)
      .strokeColor('CutContour')
      .lineWidth(0.25 / SCALE_FACTOR)
      .undash()
      .stroke();
  }

  if (needsPerf && perfSvgPath) {
    doc
      .path(perfSvgPath)
      .strokeColor('PerfCutContour')
      .lineWidth(0.25 / SCALE_FACTOR)
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
