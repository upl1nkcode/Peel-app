import { smartEdgeRefiner } from '../core/matting'
import { renderMask, type EdgeRefiner } from '../core/mask/render'
import type { Size } from '../core/geometry/types'
import {
  unknownImage,
  unknownMessage,
  type FromRenderWorker,
  type Handler,
  type ToRenderWorker,
} from './protocol'

/**
 * The render worker (spec 0006 AC-23, AC-24, AC-27): keeps the last image
 * set (by id) with its smart-edge refiner, and renders selections against it.
 * The mask's buffer is transferred back.
 */
export function createRenderHandler(): Handler<
  ToRenderWorker,
  FromRenderWorker
> {
  let current: { imageId: string; size: Size; refiner: EdgeRefiner } | undefined
  return (msg) => {
    switch (msg.type) {
      case 'setImage':
        current = {
          imageId: msg.imageId,
          size: { width: msg.image.width, height: msg.image.height },
          refiner: smartEdgeRefiner(msg.image, msg.modelAlpha),
        }
        return undefined
      case 'render': {
        if (current?.imageId !== msg.imageId) throw unknownImage(msg.imageId)
        const mask = renderMask(msg.selection, current.size, {
          scale: msg.scale,
          refineEdge: current.refiner,
        })
        return {
          message: { type: 'rendered', jobId: msg.jobId, mask },
          transfer: [mask.data.buffer as ArrayBuffer],
        }
      }
      default:
        throw unknownMessage(msg)
    }
  }
}
