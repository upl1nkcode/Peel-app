import type { RgbaImage } from '../../core/mask'
import { inferenceImage } from '../../core/segmentation'
import type {
  FromSegmentationWorker,
  ToSegmentationWorker,
} from '../../workers/protocol'
import { createWorkerClient, type Port } from '../workerClient'
import type { ModelStore } from './modelStore'
import {
  EngineUnavailable,
  SegmentCancelled,
  type ModelFile,
  type SegmentationEngine,
} from './types'

/** Both engines get the same photo: downscale it once (ledger ruling, Task 6 pre-flight). */
const copies = new WeakMap<RgbaImage, RgbaImage>()
function sharedInferenceImage(image: RgbaImage): RgbaImage {
  let copy = copies.get(image)
  if (!copy) {
    copy = inferenceImage(image)
    copies.set(image, copy)
  }
  return copy
}

/**
 * A `SegmentationEngine` over a segmentation worker (spec 0007). `files` are
 * the engine loader, the engine wasm and the model, in that order. The
 * worker is started on the first `load` or `setImage`.
 */
export function createWorkerEngine(
  name: 'fast' | 'precise',
  files: readonly ModelFile[],
  store: ModelStore,
  startWorker: () => Port & { terminate(): void },
): SegmentationEngine {
  const [loader, wasm, model] = files
  if (!loader || !wasm || !model) {
    throw new RangeError('files must be the engine loader, wasm and model')
  }
  let client:
    | ReturnType<
        typeof createWorkerClient<ToSegmentationWorker, FromSegmentationWorker>
      >
    | undefined
  const worker = () =>
    (client ??= createWorkerClient<
      ToSegmentationWorker,
      FromSegmentationWorker
    >(startWorker()))

  return {
    name,
    files,
    async load(onProgress) {
      const got = await store.get(files, onProgress)
      const buffer = (f: ModelFile) => got.get(f.path) as ArrayBuffer
      const msg = {
        type: 'load' as const,
        loaderJs: buffer(loader),
        wasm: buffer(wasm),
        model: buffer(model),
      }
      const reply = await worker().request(msg, [
        msg.loaderJs,
        msg.wasm,
        msg.model,
      ])
      if (reply.type === 'error') {
        throw new EngineUnavailable('unsupported', reply.message)
      }
      if (reply.type !== 'loaded') {
        throw new EngineUnavailable('unsupported', `unexpected ${reply.type}`)
      }
    },
    setImage(imageId, image) {
      const small = sharedInferenceImage(image)
      const copy = { ...small, data: small.data.slice() }
      worker().send(
        {
          type: 'setImage',
          imageId,
          image: copy,
          fullSize: { width: image.width, height: image.height },
        },
        [copy.data.buffer],
      )
      return Promise.resolve()
    },
    async segment(imageId, taps) {
      const reply = await worker().request(
        { type: 'segment', imageId, taps: [...taps] },
        [],
      )
      switch (reply.type) {
        case 'segmented':
          return { alpha: reply.alpha, selection: reply.selection }
        case 'cancelled':
          throw new SegmentCancelled(`${name} segment replaced by a newer one`)
        case 'error':
          throw new Error(reply.message)
        default:
          throw new Error(`unexpected ${reply.type}`)
      }
    },
  }
}
