import { snapToEdges } from '../core/matting'
import type { RgbaImage } from '../core/mask/types'
import {
  unknownImage,
  unknownMessage,
  type FromLiveWireWorker,
  type Handler,
  type ToLiveWireWorker,
} from './protocol'

/** The live-wire worker (spec 0006 AC-23, AC-24): keeps the last image set (by id) and snaps finger paths on it. */
export function createLiveWireHandler(): Handler<
  ToLiveWireWorker,
  FromLiveWireWorker
> {
  let current: { imageId: string; image: RgbaImage } | undefined
  return (msg) => {
    switch (msg.type) {
      case 'setImage':
        current = { imageId: msg.imageId, image: msg.image }
        return undefined
      case 'snap': {
        if (current?.imageId !== msg.imageId) throw unknownImage(msg.imageId)
        const path = snapToEdges(current.image, msg.finger, msg.reachPx)
        return {
          message: { type: 'snapped', jobId: msg.jobId, path },
          transfer: [],
        }
      }
      default:
        throw unknownMessage(msg)
    }
  }
}
