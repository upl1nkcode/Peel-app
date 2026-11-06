import type { Point } from '../core/geometry/types'
import type { AlphaMask, RgbaImage } from '../core/mask/types'
import type { Selection } from '../core/selection/types'

/** Worker messages (spec 0006 contract). */
export type ToRenderWorker =
  | {
      type: 'setImage'
      imageId: string
      image: RgbaImage
      modelAlpha?: AlphaMask
    }
  | {
      type: 'render'
      jobId: number
      imageId: string
      selection: Selection
      scale: number
    }
export type FromRenderWorker =
  | { type: 'rendered'; jobId: number; mask: AlphaMask }
  | { type: 'cancelled'; jobId: number }
  | { type: 'error'; jobId: number; message: string }

export type ToLiveWireWorker =
  | { type: 'setImage'; imageId: string; image: RgbaImage }
  | {
      type: 'snap'
      jobId: number
      imageId: string
      finger: Point[]
      reachPx: number
    }
export type FromLiveWireWorker =
  | { type: 'snapped'; jobId: number; path: Point[] }
  | { type: 'cancelled'; jobId: number }
  | { type: 'error'; jobId: number; message: string }

/** A message to post and the buffers to transfer with it (AC-27). */
export interface Reply<M> {
  message: M
  transfer: ArrayBuffer[]
}

/** The handler a worker runs per message; `undefined` means no reply. */
export type Handler<Req, Res> = (req: Req) => Reply<Res> | undefined

/** Thrown for a message outside the contract. */
export function unknownMessage(msg: { type?: unknown }): Error {
  return new Error(`unknown message type ${String(msg.type)}`)
}

export function unknownImage(imageId: string): Error {
  return new Error(`unknown image id ${imageId}`)
}
