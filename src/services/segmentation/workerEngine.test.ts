// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { RgbaImage } from '../../core/mask'
import type { Stroke } from '../../core/segmentation'
import type { InferenceBackend } from '../../workers/segmentationHandler'
import { wireSegmentationWorker } from '../../workers/segmentationHandler'
import type { WorkerScope } from '../../workers/wire'
import type { Port } from '../workerClient'
import type { ModelStore } from './modelStore'
import { EngineUnavailable, SegmentCancelled, type ModelFile } from './types'
import { createWorkerEngine } from './workerEngine'

const FILES: ModelFile[] = [
  { path: 'engine/loader.js', bytes: 1, sha256: '' },
  { path: 'engine/vision.wasm', bytes: 2, sha256: '' },
  { path: 'models/fast.tflite', bytes: 3, sha256: '' },
]

/** A store that hands back one buffer per file and reports its size as progress. */
const fakeStore = (fail?: EngineUnavailable): ModelStore => ({
  missingBytes: () => Promise.resolve(6),
  get(files, onProgress) {
    if (fail) return Promise.reject(fail)
    onProgress(6, 6)
    return Promise.resolve(
      new Map(files.map((f) => [f.path, new ArrayBuffer(f.bytes)])),
    )
  },
})

const discBackend = (runs: Stroke[][]): InferenceBackend => {
  let w = 1
  let h = 1
  return {
    setImage(img) {
      w = img.width
      h = img.height
    },
    run(strokes) {
      runs.push([...strokes])
      return { width: w, height: h, data: new Float32Array(w * h).fill(1) }
    },
  }
}

/** Connects a client port to a worker scope in-process, delivering messages asynchronously. */
function inProcessWorker(
  makeBackend: () => Promise<InferenceBackend>,
  posted: { type: string; transfer: Transferable[] }[] = [],
) {
  const scope: WorkerScope = {
    onmessage: null,
    postMessage(message) {
      setTimeout(() => {
        port.onmessage?.({ data: message } as MessageEvent)
      }, 0)
    },
  }
  const port: Port & { terminate(): void } = {
    onmessage: null,
    postMessage(message, transfer) {
      posted.push({ type: (message as { type: string }).type, transfer })
      setTimeout(() => {
        scope.onmessage?.({ data: message })
      }, 0)
    },
    terminate() {
      // nothing to stop in-process
    },
  }
  wireSegmentationWorker(scope, 'fast', makeBackend)
  return port
}

const photo = (width: number, height: number): RgbaImage => ({
  width,
  height,
  data: new Uint8Array(width * height * 4),
})

describe('worker engine', () => {
  it('should_load_through_the_store_then_the_worker (AC-2)', async () => {
    const runs: Stroke[][] = []
    const posted: { type: string; transfer: Transferable[] }[] = []
    const port = inProcessWorker(
      () => Promise.resolve(discBackend(runs)),
      posted,
    )
    const engine = createWorkerEngine('fast', FILES, fakeStore(), () => port)
    expect(engine.name).toBe('fast')
    expect(engine.files).toBe(FILES)

    await engine.setImage('a', photo(40, 20))
    await expect(engine.segment('a', [])).rejects.toThrow(/not loaded/)

    const progress: number[] = []
    await engine.load((l) => progress.push(l))
    expect(progress).toEqual([6])
    const load = posted.find((p) => p.type === 'load')
    expect(load?.transfer).toHaveLength(3)

    const result = await engine.segment('a', [
      { imagePt: { x: 10, y: 5 }, mode: 'add' },
    ])
    expect(result.alpha.width).toBe(40)
    expect(result.selection?.rings).toHaveLength(1)
    expect(runs).toHaveLength(1)
  })

  it('should_report_why_the_engine_cannot_load (AC-20)', async () => {
    const offline = createWorkerEngine(
      'fast',
      FILES,
      fakeStore(new EngineUnavailable('offline')),
      () => inProcessWorker(() => Promise.resolve(discBackend([]))),
    )
    await expect(offline.load(() => undefined)).rejects.toMatchObject({
      reason: 'offline',
    })

    const unsupported = createWorkerEngine('fast', FILES, fakeStore(), () =>
      inProcessWorker(() =>
        Promise.reject(
          new EngineUnavailable('unsupported', 'no OffscreenCanvas'),
        ),
      ),
    )
    const error = await unsupported
      .load(() => undefined)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineUnavailable)
    expect((error as EngineUnavailable).reason).toBe('unsupported')
  })

  it('should_cancel_an_older_segment_when_a_newer_one_is_sent', async () => {
    const engine = createWorkerEngine('fast', FILES, fakeStore(), () =>
      inProcessWorker(() => Promise.resolve(discBackend([]))),
    )
    await engine.load(() => undefined)
    await engine.setImage('a', photo(40, 20))
    const first = engine.segment('a', [
      { imagePt: { x: 10, y: 5 }, mode: 'add' },
    ])
    const second = engine.segment('a', [
      { imagePt: { x: 30, y: 5 }, mode: 'add' },
    ])
    await expect(first).rejects.toBeInstanceOf(SegmentCancelled)
    await expect(second).resolves.toMatchObject({ alpha: { width: 40 } })
  })

  it('should_send_the_worker_a_copy_and_downscale_once_per_photo (AC-5)', async () => {
    const posted: { type: string; transfer: Transferable[] }[] = []
    const engine = createWorkerEngine('fast', FILES, fakeStore(), () =>
      inProcessWorker(() => Promise.resolve(discBackend([])), posted),
    )
    const small = photo(40, 20)
    await engine.setImage('a', small)
    expect(small.data.byteLength).toBe(40 * 20 * 4) // not detached
    expect(posted.find((p) => p.type === 'setImage')?.transfer).toHaveLength(1)
  })
})
