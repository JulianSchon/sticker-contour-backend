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
}) {
  const threshold = typeof raw.threshold === 'number'
    ? Math.max(1, Math.min(255, Math.round(raw.threshold)))
    : 128;

  const kissOffset = typeof raw.kissOffset === 'number'
    ? Math.max(0, Math.min(50, Math.round(raw.kissOffset)))
    : 3;

  const perfOffset = typeof raw.perfOffset === 'number'
    ? Math.max(0, Math.min(50, Math.round(raw.perfOffset)))
    : 8;

  const smoothing = typeof raw.smoothing === 'number'
    ? Math.max(0, Math.min(4, Math.round(raw.smoothing)))
    : 1;

  const enclose = raw.enclose === true || raw.enclose === 'true';

  const cutMode = raw.cutMode === 'both'
    ? 'both' as const
    : raw.cutMode === 'perf'
    ? 'perf' as const
    : 'kiss' as const;

  return { threshold, kissOffset, perfOffset, smoothing, enclose, cutMode };
}
