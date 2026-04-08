export type ShapeType = 'contour' | 'circle' | 'square' | 'triangle';

export interface ContourParams {
  threshold: number;      // 1-255
  kissOffset: number;     // px — offset for the solid kiss cut line
  perfOffset: number;     // px — offset for the dashed perf cut line
  smoothing: number;      // 0-4
  enclose: boolean;       // keep only the outermost contour, drop inner cuts
  cutMode: 'kiss' | 'perf' | 'both';
  shapeType: ShapeType;
}

export interface ContourPreviewResponse {
  kissSvgPath: string;
  perfSvgPath: string | null;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  pad: number;   // pixels of padding around the image — path coords can go negative by this amount
}

export interface ProcessedBitmap {
  buffer: Buffer;
  width: number;
  height: number;
  pad: number;   // pixels added on each side — caller must subtract from path coords
}
