import type { CoverageMask } from '../contour'
import type { Size } from '../geometry/types'

/**
 * Tap v1 takes one point per run, so taps are combined per pixel as
 * max(add masks) × (1 − max(remove masks)) (spec 0007 AC-3).
 */
export function combineTapMasks(
  adds: readonly CoverageMask[],
  removes: readonly CoverageMask[],
  size: Size,
): CoverageMask {
  const n = size.width * size.height
  for (const m of [...adds, ...removes]) {
    if (m.width !== size.width || m.height !== size.height) {
      throw new RangeError(
        `tap mask is ${String(m.width)}×${String(m.height)}, expected ${String(size.width)}×${String(size.height)}`,
      )
    }
  }
  const data = new Float32Array(n)
  for (const m of adds)
    for (let k = 0; k < n; k++)
      data[k] = Math.max(data[k] as number, m.data[k] as number)
  if (adds.length > 0) {
    for (const m of removes) {
      for (let k = 0; k < n; k++)
        data[k] = (data[k] as number) * (1 - (m.data[k] as number))
    }
  }
  return { width: size.width, height: size.height, data }
}
