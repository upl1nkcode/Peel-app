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
