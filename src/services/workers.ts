import { liveWireWorkerClient, renderWorkerClient } from './workerClient'

/** Starts the render worker (spec 0006): renderMask with the smart edge off the main thread. */
export function startRenderWorker() {
  const worker = new Worker(
    new URL('../workers/render.worker.ts', import.meta.url),
    { type: 'module' },
  )
  return {
    ...renderWorkerClient(worker),
    terminate: () => {
      worker.terminate()
    },
  }
}

/** Starts the live-wire worker (spec 0006): snapToEdges off the main thread. */
export function startLiveWireWorker() {
  const worker = new Worker(
    new URL('../workers/livewire.worker.ts', import.meta.url),
    { type: 'module' },
  )
  return {
    ...liveWireWorkerClient(worker),
    terminate: () => {
      worker.terminate()
    },
  }
}

/** Starts a segmentation worker (spec 0007) for one engine; the worker's name tells it which. */
export function startSegmentationWorker(engine: 'fast' | 'precise') {
  const worker = new Worker(
    new URL('../workers/segmentation.worker.ts', import.meta.url),
    { type: 'module', name: engine },
  )
  return {
    get onmessage() {
      return worker.onmessage
    },
    set onmessage(f: ((event: MessageEvent) => void) | null) {
      worker.onmessage = f
    },
    postMessage(message: unknown, transfer: Transferable[]) {
      worker.postMessage(message, transfer)
    },
    terminate: () => {
      worker.terminate()
    },
  }
}
