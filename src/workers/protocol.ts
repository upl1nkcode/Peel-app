import type { Point, Size } from '../core/geometry/types'
import type { AlphaMask, RgbaImage } from '../core/mask/types'
import type { Tap } from '../core/segmentation/types'
import type { Selection } from '../core/selection/types'

/** Worker messages (spec 0006 contract). */
export type ToRenderWorker =
  | {
      type: 'setImage'
      imageId: string
      image: RgbaImage
      modelAlpha?: AlphaMask
    }
  /** Swaps the model alpha of the current image (spec 0007), without re-sending the photo. */
  | { type: 'setModelAlpha'; imageId: string; modelAlpha: AlphaMask }
  | {
      type: 'render'
      jobId: number
      imageId: string
      selection: Selection
      scale: number
    }
  /**
   * A scale-1 render for saving (spec 0008 AC-6). Its own type, so a preview
   * `render` never cancels it (newest-wins is per type). It carries the model
   * alpha saved with the sticker (none: rendered without one), so a
   * `setModelAlpha` that lands before it runs can't change what is saved.
   */
  | {
      type: 'renderFull'
      jobId: number
      imageId: string
      selection: Selection
      modelAlpha?: AlphaMask
    }
  /**
   * Every ring re-simplified to `tolerancePx` (spec 0010 AC-15), off the
   * main thread. Needs no image; newest-wins like `render`.
   */
  | {
      type: 'resimplify'
      jobId: number
      selection: Selection
      tolerancePx: number
    }
export type FromRenderWorker =
  | { type: 'rendered'; jobId: number; mask: AlphaMask }
  | { type: 'resimplified'; jobId: number; selection: Selection }
  | { type: 'cancelled'; jobId: number }
  | { type: 'error'; jobId: number; message: string }

/** Segmentation worker messages (spec 0007). `load` runs outside the newest-wins queue. */
export type ToSegmentationWorker =
  | {
      type: 'load'
      jobId: number
      loaderJs: ArrayBuffer
      wasm: ArrayBuffer
      model: ArrayBuffer
    }
  /** The inference copy (long side ≤ 1024 px) and the photo's full size. */
  | { type: 'setImage'; imageId: string; image: RgbaImage; fullSize: Size }
  | { type: 'segment'; jobId: number; imageId: string; taps: Tap[] }
export type FromSegmentationWorker =
  | { type: 'loaded'; jobId: number }
  | {
      type: 'segmented'
      jobId: number
      imageId: string
      alpha: AlphaMask
      selection: Selection | null
    }
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
