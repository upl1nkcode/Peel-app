import type { Size } from '../geometry/types'
import type { Stroke, Tap } from './types'

/** Every tap must lie on the image: x ∈ [0, width), y ∈ [0, height), finite (AC-2). */
export function checkTaps(taps: readonly Tap[], size: Size): void {
  for (const { imagePt: p } of taps) {
    if (!(p.x >= 0 && p.x < size.width && p.y >= 0 && p.y < size.height)) {
      throw new RangeError(
        `tap (${String(p.x)}, ${String(p.y)}) is outside the ${String(size.width)}×${String(size.height)} image`,
      )
    }
  }
}

/** Taps as Tap v2 strokes: normalised, add → positive, remove → negative, in order (AC-9). */
export function tapsToStrokes(taps: readonly Tap[], size: Size): Stroke[] {
  checkTaps(taps, size)
  return taps.map(({ imagePt, mode }) => ({
    mode: mode === 'add' ? 'positive' : 'negative',
    x: imagePt.x / size.width,
    y: imagePt.y / size.height,
  }))
}
