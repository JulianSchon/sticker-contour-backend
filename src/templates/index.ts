import peltor from './peltor.json';

export interface StickerTemplate {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  sheetCutPath: string;
  sheetBBoxMm: { x: number; y: number; w: number; h: number };
  shields: Array<{ clipPath: string; cutPath: string }>;
}

const TEMPLATES: Record<string, StickerTemplate> = {
  peltor: peltor as StickerTemplate,
};

export function getTemplate(id: string): StickerTemplate | null {
  return TEMPLATES[id] ?? null;
}
