import PDFDocument from 'pdfkit';
import type { ContourParams } from '../types/contour';
import type { EdgeColor } from './edgeColor';

const DPI = 300;
const SCALE_FACTOR = 72 / DPI; // pixels → PDF points
const STROKE_WIDTH_PX = 2;
const SAFETY_MARGIN_PX = 10;
const PAGE_MARGIN_INCHES = 0.1; // ~3 mm
const CROP_MARGIN_PX = 3;

// ---------------------------------------------------------------------------
// SVG path bounding box (handles M, L, H, V, C, Q, A, Z and relative variants)
// ---------------------------------------------------------------------------
export function computePathBBox(pathData: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const tokenRe = /([MmLlHhVvCcQqAaZz])|(-?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)/gi;
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

  // Bound an elliptical arc (endpoint form). Converts to centre form (SVG spec
  // F.6.5) and adds the ellipse's axis-aligned extrema. For a full circle/oval
  // (drawn as two 180° arcs) this is exact; for a partial arc it over-bounds by
  // at most a radius — which only pads the page slightly, never crops content.
  function addArc(x1: number, y1: number, rxIn: number, ryIn: number, rotDeg: number, laf: number, sf: number, x2: number, y2: number) {
    let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
    if (rx === 0 || ry === 0) { addPt(x2, y2); return; }
    const phi = (rotDeg * Math.PI) / 180;
    const cosP = Math.cos(phi), sinP = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cosP * dx + sinP * dy;
    const y1p = -sinP * dx + cosP * dy;
    let rx2 = rx * rx, ry2 = ry * ry;
    const lambda = (x1p * x1p) / rx2 + (y1p * y1p) / ry2;
    if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; rx2 = rx * rx; ry2 = ry * ry; }
    let numer = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
    if (numer < 0) numer = 0;
    const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
    const coef = (den === 0 ? 0 : Math.sqrt(numer / den)) * (laf !== sf ? 1 : -1);
    const cxp = coef * (rx * y1p / ry);
    const cyp = coef * (-ry * x1p / rx);
    const ecx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
    const ecy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
    // Half-extents of the (possibly rotated) ellipse's bounding box.
    const hx = Math.sqrt(rx2 * cosP * cosP + ry2 * sinP * sinP);
    const hy = Math.sqrt(rx2 * sinP * sinP + ry2 * cosP * cosP);
    addPt(ecx - hx, ecy - hy);
    addPt(ecx + hx, ecy + hy);
  }

  function num(): number { return parseFloat(tokens[i++]); }

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (!/^[MmLlHhVvCcQqAaZz]$/.test(cmd)) { i++; continue; }
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
      case 'A': {
        const rx = num(), ry = num(), rot = num(), laf = num(), sf = num(), x = num(), y = num();
        addArc(cx, cy, rx, ry, rot, laf, sf, x, y);
        addPt(x, y);
        cx = x; cy = y; break;
      }
      case 'a': {
        const rx = num(), ry = num(), rot = num(), laf = num(), sf = num(), dx = num(), dy = num();
        const x = cx + dx, y = cy + dy;
        addArc(cx, cy, rx, ry, rot, laf, sf, x, y);
        addPt(x, y);
        cx = x; cy = y; break;
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
  bleedPad = 0,    // px the embedded image was padded on each side for bleed
  pageBleedPx = 0, // px the page extends past the cut; the cut becomes the TrimBox
  bodyFill?: EdgeColor, // fill the body path with this color UNDER the image (geometric shapes)
  bleedColor?: EdgeColor, // fill the bleed band OUTSIDE the cut with this color (all shapes)
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

  // Extend the page past the cut by the bleed so the extra ink is in the file.
  // The cut bbox stays the TrimBox (set below).
  const cropMargin = Math.max(CROP_MARGIN_PX, pageBleedPx);

  if (bbox) {
    cropMinX = bbox.minX - cropMargin;
    cropMinY = bbox.minY - cropMargin;
    cropMaxX = bbox.maxX + cropMargin;
    cropMaxY = bbox.maxY + cropMargin;
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

  // The embedded image was padded by `bleedPad` on each side, so its top-left
  // sits at bitmap coord (-bleedPad, -bleedPad). Shift by -crop origin to place.
  const imageX = (-bleedPad - cropMinX) * SCALE_FACTOR;
  const imageY = (-bleedPad - cropMinY) * SCALE_FACTOR;

  const imageWidthPt  = (bitmapWidth  + 2 * bleedPad) * SCALE_FACTOR;
  const imageHeightPt = (bitmapHeight + 2 * bleedPad) * SCALE_FACTOR;

  // Path is in bitmap coords; same offset applies
  const translateX = -cropMinX * SCALE_FACTOR;
  const translateY = -cropMinY * SCALE_FACTOR;

  // ── Build PDF ────────────────────────────────────────────────────────────
  const doc = new PDFDocument({ size: [pageWidthPt, pageHeightPt], margin: 0 });

  // TrimBox = the cut (the page is inset by the bleed on each side). Production
  // tools trim here; the bleed lives between TrimBox and MediaBox. Without a
  // cut path (no bbox) there's nothing to trim, so leave TrimBox = MediaBox.
  if (bbox && pageBleedPx > 0) {
    const inset = pageBleedPx * SCALE_FACTOR;
    // PDF coords have origin bottom-left; the inset is symmetric so it's the
    // same on all four sides.
    // @ts-expect-error — page.dictionary is pdfkit internal, not in @types
    doc.page.dictionary.data.TrimBox = [inset, inset, pageWidthPt - inset, pageHeightPt - inset];
  }

  // @ts-expect-error — addSpotColor exists in pdfkit but missing from @types/pdfkit
  doc.addSpotColor('CutContour',     0, 100,   0, 0);
  // @ts-expect-error
  doc.addSpotColor('PerfCutContour', 100,   0, 0, 0);

  // Body fill UNDER the image: for geometric shapes the cut can extend past the
  // artwork, leaving a gap. Fill it with the image's sampled edge color so the
  // background continues to the cut edge (matches the preview). Body path choice
  // mirrors renderSticker: perf (outer) if present, else kiss.
  if (bodyFill) {
    const bodySvg = needsPerf && perfSvgPath ? perfSvgPath : kissSvgPath;
    doc.save();
    doc.translate(translateX, translateY);
    doc.scale(SCALE_FACTOR);
    doc.path(bodySvg).fillColor([bodyFill.r, bodyFill.g, bodyFill.b]).fill();
    doc.restore();
  }

  // Bleed band: fill page-rect MINUS the outer cut path (even-odd) with the
  // sampled edge colour, so a misaligned cut lands on ink. Even-odd leaves the
  // inside of the cut untouched. The cut is the TrimBox (set below); the band is
  // trimmed in production.
  if (bleedColor && bbox && pageBleedPx > 0) {
    const outerCut = needsPerf && perfSvgPath ? perfSvgPath : kissSvgPath;
    doc.save();
    doc.translate(translateX, translateY);
    doc.scale(SCALE_FACTOR);
    doc.rect(cropMinX, cropMinY, cropMaxX - cropMinX, cropMaxY - cropMinY);
    doc.path(outerCut);
    doc.fillColor([bleedColor.r, bleedColor.g, bleedColor.b]);
    doc.fill('even-odd');
    doc.restore();
  }

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
