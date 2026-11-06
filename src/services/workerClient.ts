import type { Point } from '../core/geometry/types'
import type { AlphaMask, RgbaImage } from '../core/mask/types'
import type { Selection } from '../core/selection/types'
import type {
  FromLiveWireWorker,
  FromRenderWorker,
  ToLiveWireWorker,
  ToRenderWorker,
} from '../workers/protocol'

/** The part of a Worker the client uses. */
export interface Port {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

/** A job message without its jobId (the client numbers jobs). */
type JobOf<Req> = Req extends { jobId: number } ? Omit<Req, 'jobId'> : never
type NoJob<Req> = Req extends { jobId: number } ? never : Req

export type Cancelled = { type: 'cancelled' }

/**
 * Talks to a worker with typed messages (spec 0006 AC-25). Each `request`
 * gets a new jobId; a newer request of the same type resolves the older one
 * `{ type: 'cancelled' }` at once, and any later reply to it is ignored.
 */
export function createWorkerClient<
  Req extends { type: string },
  Res extends { type: string; jobId: number },
>(port: Port) {
  let nextJob = 1
  const pending = new Map<number, (res: Res | Cancelled) => void>()
  const newest = new Map<string, number>()
  port.onmessage = (event) => {
    const res = event.data as Res | null
    if (typeof res !== 'object' || res === null) return
    const resolve = pending.get(res.jobId)
    if (!resolve) return
    pending.delete(res.jobId)
    resolve(res)
  }
  return {
    /** Posts a message that expects no reply (setImage). */
    send(msg: NoJob<Req>, transfer: Transferable[]): void {
      port.postMessage(msg, transfer)
    },
    request(
      msg: JobOf<Req>,
      transfer: Transferable[],
    ): Promise<Res | Cancelled> {
      const jobId = nextJob++
      const type = (msg as { type: string }).type
      const older = newest.get(type)
      if (older !== undefined) {
        const resolve = pending.get(older)
        pending.delete(older)
        resolve?.({ type: 'cancelled' })
      }
      newest.set(type, jobId)
      return new Promise((resolve) => {
        pending.set(jobId, resolve)
        port.postMessage({ ...msg, jobId }, transfer)
      })
    },
  }
}

/**
 * The render worker's client. `setImage` transfers the image's (and model
 * alpha's) buffers: they are unusable here afterwards, so pass copies of
 * anything the page still needs.
 */
export function renderWorkerClient(port: Port) {
  const client = createWorkerClient<ToRenderWorker, FromRenderWorker>(port)
  return {
    setImage(imageId: string, image: RgbaImage, modelAlpha?: AlphaMask): void {
      client.send(
        { type: 'setImage', imageId, image, ...(modelAlpha && { modelAlpha }) },
        modelAlpha
          ? [image.data.buffer, modelAlpha.data.buffer]
          : [image.data.buffer],
      )
    },
    /** Swaps the model alpha (spec 0007); transfers its buffer, so pass a copy. */
    setModelAlpha(imageId: string, modelAlpha: AlphaMask): void {
      client.send({ type: 'setModelAlpha', imageId, modelAlpha }, [
        modelAlpha.data.buffer,
      ])
    },
    render(imageId: string, selection: Selection, scale: number) {
      return client.request({ type: 'render', imageId, selection, scale }, [])
    },
  }
}

/** The live-wire worker's client; `setImage` transfers the image's buffer (see `renderWorkerClient`). */
export function liveWireWorkerClient(port: Port) {
  const client = createWorkerClient<ToLiveWireWorker, FromLiveWireWorker>(port)
  return {
    setImage(imageId: string, image: RgbaImage): void {
      client.send({ type: 'setImage', imageId, image }, [image.data.buffer])
    },
    snap(imageId: string, finger: Point[], reachPx: number) {
      return client.request({ type: 'snap', imageId, finger, reachPx }, [])
    },
  }
}
