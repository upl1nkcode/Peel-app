import { smartEdgeRefiner } from '../core/matting'
import { renderMask, type EdgeRefiner } from '../core/mask/render'
import type { RgbaImage } from '../core/mask/types'
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
  let current:
    { imageId: string; image: RgbaImage; refiner: EdgeRefiner } | undefined
  return (msg) => {
    switch (msg.type) {
      case 'setImage':
        current = {
          imageId: msg.imageId,
          image: msg.image,
          refiner: smartEdgeRefiner(msg.image, msg.modelAlpha),
        }
        return undefined
      case 'setModelAlpha':
        if (current?.imageId !== msg.imageId) throw unknownImage(msg.imageId)
        current = {
          ...current,
          refiner: smartEdgeRefiner(current.image, msg.modelAlpha),
        }
        return undefined
      case 'render':
      case 'renderFull': {
        if (current?.imageId !== msg.imageId) throw unknownImage(msg.imageId)
        const { width, height } = current.image
        const mask = renderMask(
          msg.selection,
          { width, height },
          msg.type === 'render'
            ? { scale: msg.scale, refineEdge: current.refiner }
            : {
                scale: 1,
                refineEdge: smartEdgeRefiner(current.image, msg.modelAlpha),
              },
        )
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
