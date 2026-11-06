// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { CoverageMask } from '../core/contour'
import type { Size } from '../core/geometry/types'
import { toAlphaMask, type RgbaImage } from '../core/mask'
import {
  autoSelection,
  tapsToStrokes,
  upscaleMask,
  type Stroke,
  type Tap,
} from '../core/segmentation'
import type { FromSegmentationWorker } from './protocol'
import {
  createSegmentationHandler,
  type InferenceBackend,
} from './segmentationHandler'

const FULL: Size = { width: 200, height: 100 }
const SMALL: Size = { width: 100, height: 50 }
const image = (size: Size): RgbaImage => ({
  ...size,
  data: new Uint8Array(size.width * size.height * 4),
})

/** Records runs; each positive stroke selects a disc of radius 10 inference px. */
function fakeBackend() {
  const runs: Stroke[][] = []
  let size: Size = { width: 1, height: 1 }
  const backend: InferenceBackend = {
    setImage(img) {
      size = { width: img.width, height: img.height }
    },
    run(strokes) {
      runs.push([...strokes])
      const data = new Float32Array(size.width * size.height)
      for (const s of strokes) {
        const cx = s.x * size.width
        const cy = s.y * size.height
        for (let j = 0; j < size.height; j++) {
          for (let i = 0; i < size.width; i++) {
            const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy)
            if (d <= 10)
              data[j * size.width + i] = s.mode === 'positive' ? 1 : 0
          }
        }
      }
      return { ...size, data }
    },
  }
  return { backend, runs }
}

async function loaded(engine: 'fast' | 'precise') {
  const fake = fakeBackend()
  const h = createSegmentationHandler(engine, () =>
    Promise.resolve(fake.backend),
  )
  await h.load({
    loaderJs: new ArrayBuffer(1),
    wasm: new ArrayBuffer(1),
    model: new ArrayBuffer(1),
  })
  h.handle({
    type: 'setImage',
    imageId: 'a',
    image: image(SMALL),
    fullSize: FULL,
  })
  const segment = (taps: Tap[], imageId = 'a') => {
    const reply = h.handle({ type: 'segment', jobId: 1, imageId, taps })
    const msg = reply?.message as FromSegmentationWorker
    if (msg.type !== 'segmented') throw new Error(JSON.stringify(msg))
    return { msg, transfer: reply?.transfer ?? [] }
  }
  return { h, fake, segment }
}

const add = (x: number, y: number): Tap => ({ imagePt: { x, y }, mode: 'add' })
const remove = (x: number, y: number): Tap => ({
  imagePt: { x, y },
  mode: 'remove',
})

describe('segmentation worker handler', () => {
  it('should_run_only_the_new_tap_in_the_fast_engine (AC-4)', async () => {
    const { fake, segment } = await loaded('fast')
    segment([add(60, 50)])
    const second = segment([add(60, 50), add(140, 50)]).msg
    expect(fake.runs).toHaveLength(2)
    for (const run of fake.runs) {
      expect(run).toHaveLength(1)
      expect(run[0]?.mode).toBe('positive')
    }
    const fresh = await loaded('fast')
    expect(fresh.segment([add(60, 50), add(140, 50)]).msg.alpha).toEqual(
      second.alpha,
    )

    // A remove tap runs once, as a positive point, and is combined as a remove mask.
    const removed = segment([add(60, 50), add(140, 50), remove(145, 50)]).msg
    expect(fake.runs).toHaveLength(3)
    expect(fake.runs[2]?.[0]?.mode).toBe('positive')
    expect(removed.alpha.data[50 * 200 + 140]).toBe(0)
    expect(removed.alpha.data[50 * 200 + 60]).toBe(255)
  })

  it('should_clear_the_tap_cache_on_a_new_image (AC-4)', async () => {
    const { h, fake, segment } = await loaded('fast')
    segment([add(60, 50)])
    h.handle({
      type: 'setImage',
      imageId: 'b',
      image: image(SMALL),
      fullSize: FULL,
    })
    segment([add(60, 50)], 'b')
    expect(fake.runs).toHaveLength(2)
  })

  it('should_send_all_taps_as_strokes_to_the_precise_engine (AC-9)', async () => {
    const { fake, segment } = await loaded('precise')
    const taps = [add(60, 50), remove(140, 50)]
    segment(taps)
    expect(fake.runs).toEqual([tapsToStrokes(taps, FULL)])
  })

  it('should_return_the_mask_at_full_size (AC-2, AC-13)', async () => {
    const { fake, segment } = await loaded('precise')
    const { msg, transfer } = segment([add(60, 50)])
    const small: CoverageMask = fake.backend.run(
      tapsToStrokes([add(60, 50)], FULL),
    )
    const full = upscaleMask(small, FULL)
    expect(msg.alpha).toEqual(toAlphaMask(full.data, FULL))
    expect(msg.selection).toEqual(autoSelection(full))
    expect(msg.imageId).toBe('a')
    expect(transfer).toEqual([msg.alpha.data.buffer])

    const empty = segment([]).msg
    expect(empty.selection).toBeNull()
    expect(empty.alpha.data.every((v) => v === 0)).toBe(true)
    expect({ width: empty.alpha.width, height: empty.alpha.height }).toEqual(
      FULL,
    )
  })

  it('should_refuse_old_images_bad_taps_and_unloaded_runs (AC-2)', async () => {
    const { h } = await loaded('fast')
    expect(() =>
      h.handle({
        type: 'segment',
        jobId: 2,
        imageId: 'old',
        taps: [add(1, 1)],
      }),
    ).toThrow('unknown image id old')
    expect(() =>
      h.handle({
        type: 'segment',
        jobId: 3,
        imageId: 'a',
        taps: [add(200, 1)],
      }),
    ).toThrow(RangeError)
    const unloaded = createSegmentationHandler('fast', () =>
      Promise.resolve(fakeBackend().backend),
    )
    // A photo can arrive while the model is still downloading; segmenting cannot.
    expect(
      unloaded.handle({
        type: 'setImage',
        imageId: 'a',
        image: image(SMALL),
        fullSize: FULL,
      }),
    ).toBeUndefined()
    expect(() =>
      unloaded.handle({ type: 'segment', jobId: 4, imageId: 'a', taps: [] }),
    ).toThrow(/not loaded/)
  })
})
