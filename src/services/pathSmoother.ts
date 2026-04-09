/**
 * Converts a user-facing pixel offset to a blur sigma for morphological dilation.
 * Sharp's blur(sigma) spreads pixels outward by ~sigma pixels.
 */
export function offsetToBlurSigma(offsetPx: number): number {
  return Math.max(0, Math.min(offsetPx * 0.8, 16));
}

export function clampParams(raw: {
  threshold?: unknown;
  kissOffset?: unknown;
  perfOffset?: unknown;
  smoothing?: unknown;
  enclose?: unknown;
  cutMode?: unknown;
  shapeType?: unknown;
  shapeSize?: unknown;
  shapeOffsetX?: unknown;
  shapeOffsetY?: unknown;
}) {
  const threshold = typeof raw.threshold === 'number'
    ? Math.max(1, Math.min(255, Math.round(raw.threshold)))
    : 128;

  const kissOffset = typeof raw.kissOffset === 'number'
    ? Math.max(-25, Math.min(75, Math.round(raw.kissOffset)))
    : 35;

  const perfOffset = typeof raw.perfOffset === 'number'
    ? Math.max(-25, Math.min(75, Math.round(raw.perfOffset)))
    : 35;

  const smoothing = typeof raw.smoothing === 'number'
    ? Math.max(0, Math.min(4, Math.round(raw.smoothing)))
    : 1;

  const enclose = raw.enclose === true || raw.enclose === 'true';

  const cutMode = raw.cutMode === 'both'
    ? 'both' as const
    : raw.cutMode === 'perf'
    ? 'perf' as const
    : 'kiss' as const;

  const shapeType = raw.shapeType === 'circle' ? 'circle' as const
    : raw.shapeType === 'square'   ? 'square' as const
    : raw.shapeType === 'triangle' ? 'triangle' as const
    : 'contour' as const;

  const shapeSize = typeof raw.shapeSize === 'number'
    ? Math.max(10, Math.min(100, Math.round(raw.shapeSize)))
    : 90;

  const shapeOffsetX = typeof raw.shapeOffsetX === 'number'
    ? Math.max(-50, Math.min(50, raw.shapeOffsetX))
    : 0;
  const shapeOffsetY = typeof raw.shapeOffsetY === 'number'
    ? Math.max(-50, Math.min(50, raw.shapeOffsetY))
    : 0;

  return { threshold, kissOffset, perfOffset, smoothing, enclose, cutMode, shapeType, shapeSize, shapeOffsetX, shapeOffsetY };
}
