import type { CoverageMask } from '../../core/contour'
import type { Size } from '../../core/geometry/types'
import { toAlphaMask } from '../../core/mask'
import {
  autoSelection,
  checkTaps,
  combineTapMasks,
  type Tap,
} from '../../core/segmentation'
import {
  EngineUnavailable,
  type AutoResult,
  type SegmentationEngine,
  type UnavailableReason,
} from './types'

/** Radius of the disc each fake tap selects or clears (spec 0007 AC-1). */
export const FAKE_DISC_RADIUS_PX = 20

const disc = (tap: Tap, size: Size): CoverageMask => {
  const data = new Float32Array(size.width * size.height)
  const r2 = FAKE_DISC_RADIUS_PX * FAKE_DISC_RADIUS_PX
  for (let j = 0; j < size.height; j++) {
    for (let i = 0; i < size.width; i++) {
      const dx = i + 0.5 - tap.imagePt.x
      const dy = j + 0.5 - tap.imagePt.y
      if (dx * dx + dy * dy <= r2) data[j * size.width + i] = 1
    }
  }
  return { ...size, data }
}

/**
 * A deterministic stand-in engine (spec 0007 AC-1): progress in four equal
 * steps, then discs of radius 20 px around add taps minus discs around remove
 * taps. It can fail loading with a reason, or take `delayMs` per segment.
 */
export function createFakeEngine(
  opts: {
    name?: 'fast' | 'precise'
    totalBytes?: number
    failLoad?: UnavailableReason
    delayMs?: number
  } = {},
): SegmentationEngine {
  const name = opts.name ?? 'fast'
  const total = opts.totalBytes ?? 100
  let loaded = false
  const images = new Map<string, Size>()
  return {
    name,
    files: [{ path: `fake/${name}.bin`, bytes: total, sha256: '' }],
    load(onProgress) {
      if (opts.failLoad) {
        return Promise.reject(new EngineUnavailable(opts.failLoad))
      }
      for (let k = 1; k <= 4; k++) onProgress((total * k) / 4, total)
      loaded = true
      return Promise.resolve()
    },
    setImage(imageId, image) {
      images.set(imageId, { width: image.width, height: image.height })
      return Promise.resolve()
    },
    async segment(imageId, taps): Promise<AutoResult> {
      if (!loaded) throw new Error(`${name} engine not loaded`)
      const size = images.get(imageId)
      if (!size) throw new Error(`unknown image id ${imageId}`)
      checkTaps(taps, size)
      if (opts.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs))
      }
      const adds = taps
        .filter((t) => t.mode === 'add')
        .map((t) => disc(t, size))
      const removes = taps
        .filter((t) => t.mode === 'remove')
        .map((t) => disc(t, size))
      const mask = combineTapMasks(adds, removes, size)
      return {
        alpha: toAlphaMask(mask.data, size),
        selection: autoSelection(mask),
      }
    },
  }
}
