import {
  PDFDocument,
  PDFPage,
  PDFName,
  PDFArray,
  PDFDict,
  PDFNumber,
  PDFStream,
  PDFRawStream,
  asPDFName,
} from 'pdf-lib';

/**
 * Builds the CutContour Separation color space and registers it as
 * a named resource on the given page.
 *
 * A Separation color space in PDF has the structure:
 *   [/Separation /CutContour /DeviceCMYK <tint-function>]
 *
 * The tint function is a Type 4 (PostScript calculator) function that maps
 * a single tint value in [0,1] to CMYK values:
 *   C=0, M=tint, Y=0, K=0  (solid magenta / process color representation)
 *
 * This matches what Roland VersaWorks and Mimaki RasterLink expect for
 * "CutContour" spot color recognition.
 *
 * The color space is registered as "/CS_CutContour" in the page's
 * /Resources /ColorSpace dictionary.
 *
 * Returns the PDF name to use in content stream operators:
 *   "/<name> CS <tint> SCN" for stroke
 *   "/<name> cs <tint> scn" for fill
 */
export function registerCutContourColorSpace(
  pdfDoc: PDFDocument,
  page: PDFPage
): string {
  const context = pdfDoc.context;

  // Type 4 PostScript function: {dup 0 exch 0 0}
  // Input: tint (0..1)
  // Stack trace: [t] → dup → [t t] → 0 → [t t 0] → exch → [t 0 t] → 0 → [t 0 t 0] → 0 → [t 0 t 0 0]
  // Wait, let me be precise. CMYK = C M Y K
  // We want C=0, M=tint, Y=0, K=0
  // PostScript stack after function entry: [tint]
  // {0 exch 0 0} → [0 tint 0 0] = C=0, M=tint, Y=0, K=0 ✓
  const functionBytes = Buffer.from('{ 0 exch 0 0 }', 'latin1');

  const tintFunction = context.stream(functionBytes, {
    FunctionType: 4,
    Domain: context.obj([0, 1]),
    Range: context.obj([0, 1, 0, 1, 0, 1, 0, 1]),
  });

  // [/Separation /CutContour /DeviceCMYK <function>]
  const colorSpaceArray = context.obj([
    PDFName.of('Separation'),
    PDFName.of('CutContour'),
    PDFName.of('DeviceCMYK'),
    tintFunction,
  ]);

  // Ensure the page has a Resources dictionary with a ColorSpace sub-dict
  const resources = page.node.Resources();
  if (!resources) {
    page.node.set(PDFName.of('Resources'), context.obj({}));
  }

  const pageResources = page.node.Resources()!;
  let colorSpaceDict = pageResources.lookup(PDFName.of('ColorSpace')) as PDFDict | undefined;

  if (!colorSpaceDict) {
    colorSpaceDict = context.obj({}) as PDFDict;
    pageResources.set(PDFName.of('ColorSpace'), colorSpaceDict);
  }

  const csName = 'CS_CutContour';
  colorSpaceDict.set(PDFName.of(csName), colorSpaceArray);

  return csName;
}

/**
 * Builds the PDF content stream operators that:
 * 1. Set the stroke color to CutContour (full tint = 1)
 * 2. Set hairline stroke width (0.001 pt — recognized as "hairline" by most RIPs)
 * 3. Apply the dash pattern based on cut mode
 * 4. Stroke the path operators
 *
 * cutMode:
 *   'kiss' = solid stroke (kiss cut / die cut contour)
 *   'perf' = dashed stroke (perforation cut)
 *
 * pathOperators: the PDF path drawing operators (m, c, h commands)
 */
export function buildContourContentStream(
  csName: string,
  pathOperators: string,
  cutMode: 'kiss' | 'perf'
): string {
  const dashPattern =
    cutMode === 'perf'
      ? '[2 2] 0 d\n'  // 2pt dash, 2pt gap
      : '[] 0 d\n';    // solid stroke

  return [
    'q',                           // save graphics state
    `/${csName} CS`,               // set stroke color space to CutContour
    '1 SCN',                       // set tint = 1 (full CutContour color)
    '0.001 w',                     // hairline stroke width
    dashPattern,
    pathOperators,                 // M, C, H path commands
    'S',                           // stroke (do NOT fill)
    'Q',                           // restore graphics state
  ].join('\n');
}
