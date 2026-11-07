import type { CoverageMask } from '../core/contour'
import type { Size } from '../core/geometry/types'
import { toAlphaMask, type RgbaImage } from '../core/mask'
import {
  autoSelection,
  checkTaps,
  combineTapMasks,
  tapsToStrokes,
  upscaleMask,
  type Stroke,
  type Tap,
} from '../core/segmentation'
import {
  unknownImage,
  unknownMessage,
  type FromSegmentationWorker,
  type Handler,
  type ToSegmentationWorker,
} from './protocol'
import { wireWorker, type WorkerScope } from './wire'

/** One model behind the worker: MediaPipe in production, a fake in tests. */
export interface InferenceBackend {
  setImage(image: RgbaImage): void
  /** The mask at the inference image's size. The fast engine gets one positive stroke per run. */
  run(strokes: readonly Stroke[]): CoverageMask
}

export interface EngineFiles {
  loaderJs: ArrayBuffer
  wasm: ArrayBuffer
  model: ArrayBuffer
}

export type MakeBackend = (
  engine: 'fast' | 'precise',
  files: EngineFiles,
) => Promise<InferenceBackend>

type Job = Exclude<ToSegmentationWorker, { type: 'load' }>

/**
 * The segmentation worker's logic (spec 0007 AC-2, AC-4, AC-9, AC-13).
 * `load` is asynchronous (MediaPipe starts up), so it runs outside the
 * newest-wins queue; `setImage` and `segment` are handled synchronously.
 * The fast engine (Tap v1) runs one point per tap and keeps each tap's mask,
 * so an extra tap costs one run; the precise engine (Tap v2) runs all taps
 * as strokes. Results are upscaled to the photo's full size and traced here,
 * off the main thread.
 */
export function createSegmentationHandler(
  engine: 'fast' | 'precise',
  makeBackend: MakeBackend,
) {
  let backend: InferenceBackend | undefined
  let image:
    | { imageId: string; small: RgbaImage; fullSize: Size; inBackend: boolean }
    | undefined
  /** Fast engine: each tap point's mask, by normalised point. */
  let perPoint = new Map<string, CoverageMask>()

  const result = (
    jobId: number,
    imageId: string,
    small: CoverageMask | null,
    fullSize: Size,
  ) => {
    const full: CoverageMask = small
      ? upscaleMask(small, fullSize)
      : {
          ...fullSize,
          data: new Float32Array(fullSize.width * fullSize.height),
        }
    const alpha = toAlphaMask(full.data, fullSize)
    const message: FromSegmentationWorker = {
      type: 'segmented',
      jobId,
      imageId,
      alpha,
      selection: small ? autoSelection(full) : null,
    }
    return { message, transfer: [alpha.data.buffer as ArrayBuffer] }
  }

  const segment = (
    run: InferenceBackend,
    current: NonNullable<typeof image>,
    taps: readonly Tap[],
  ): CoverageMask | null => {
    checkTaps(taps, current.fullSize)
    if (!taps.some((t) => t.mode === 'add')) return null
    if (!current.inBackend) {
      run.setImage(current.small)
      current.inBackend = true
    }
    const strokes = tapsToStrokes(taps, current.fullSize)
    if (engine === 'precise') return run.run(strokes)
    const maskOf = (s: Stroke) => {
      const key = `${String(s.x)},${String(s.y)}`
      let mask = perPoint.get(key)
      if (!mask) {
        mask = run.run([{ mode: 'positive', x: s.x, y: s.y }])
        perPoint.set(key, mask)
      }
      return mask
    }
    const size = { width: current.small.width, height: current.small.height }
    return combineTapMasks(
      strokes.filter((s) => s.mode === 'positive').map(maskOf),
      strokes.filter((s) => s.mode === 'negative').map(maskOf),
      size,
    )
  }

  const handle: Handler<Job, FromSegmentationWorker> = (msg) => {
    switch (msg.type) {
      case 'setImage':
        image = {
          imageId: msg.imageId,
          small: msg.image,
          fullSize: msg.fullSize,
          inBackend: false,
        }
        perPoint = new Map()
        return undefined
      case 'segment': {
        if (!backend) throw new Error(`${engine} engine not loaded`)
        if (image?.imageId !== msg.imageId) throw unknownImage(msg.imageId)
        const mask = segment(backend, image, msg.taps)
        return result(msg.jobId, msg.imageId, mask, image.fullSize)
      }
      default:
        throw unknownMessage(msg)
    }
  }

  return {
    async load(files: EngineFiles): Promise<void> {
      backend = await makeBackend(engine, files)
      if (image) image.inBackend = false
    },
    handle,
  }
}

/** Wires the handler to a worker scope: `load` asynchronously, the rest through `wireWorker`. */
export function wireSegmentationWorker(
  scope: WorkerScope,
  engine: 'fast' | 'precise',
  makeBackend: MakeBackend,
): void {
  const handler = createSegmentationHandler(engine, makeBackend)
  const queued: WorkerScope = {
    onmessage: null,
    postMessage: (m, t) => {
      scope.postMessage(m, t)
    },
  }
  wireWorker(queued, handler.handle)
  scope.onmessage = (event) => {
    const msg = event.data as Partial<ToSegmentationWorker> | null
    if (msg?.type !== 'load') {
      queued.onmessage?.(event)
      return
    }
    const { jobId = -1, loaderJs, wasm, model } = msg
    const reply = (message: FromSegmentationWorker) => {
      scope.postMessage(message, [])
    }
    if (!loaderJs || !wasm || !model) {
      reply({
        type: 'error',
        jobId,
        message: 'load needs loaderJs, wasm and model',
      })
      return
    }
    handler.load({ loaderJs, wasm, model }).then(
      () => {
        reply({ type: 'loaded', jobId })
      },
      (e: unknown) => {
        reply({
          type: 'error',
          jobId,
          message: e instanceof Error ? e.message : String(e),
        })
      },
    )
  }
}
