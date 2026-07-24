export const CM_TO_PX_300 = 300 / 2.54; // px per cm at 300 DPI
export const MAX_TARGET_PX = 4000;      // clamp so we never build a huge buffer

export interface Dims { w: number; h: number; }

/** Target pixel dimensions for a physical size in cm at 300 DPI (clamped). */
export function cmToTargetPx(widthCm: number, heightCm: number): Dims {
  const clamp = (px: number) => Math.max(1, Math.min(MAX_TARGET_PX, Math.round(px)));
  return { w: clamp(widthCm * CM_TO_PX_300), h: clamp(heightCm * CM_TO_PX_300) };
}

/**
 * Per-axis image scale so a geometric cut path's outline bbox becomes `targetPx`,
 * keeping the offset's fixed pixel contribution. Given the outline bbox WITH the
 * offset and WITHOUT it (both at the current image size):
 *   C = w1 - w0   (fixed offset contribution)
 *   scale = (target - C) / w0
 * Returns 1 for a degenerate/non-positive axis (leave that axis unscaled).
 */
export function geometricImageScale(bboxWithOffset: Dims, bboxNoOffset: Dims, targetPx: Dims): { sx: number; sy: number } {
  const axis = (w1: number, w0: number, target: number) => {
    if (w0 <= 0) return 1;
    const c = w1 - w0;
    const s = (target - c) / w0;
    return s > 0 && Number.isFinite(s) ? s : 1;
  };
  return {
    sx: axis(bboxWithOffset.w, bboxNoOffset.w, targetPx.w),
    sy: axis(bboxWithOffset.h, bboxNoOffset.h, targetPx.h),
  };
}
