import { smartEdgeRefiner } from '../core/matting'
import { applyMask } from '../core/mask/cutout'
import { renderMask, type EdgeRefiner } from '../core/mask/render'
import { cropAlpha, cropRgba, trimBounds } from '../core/mask/trim'
import { EmptyMaskError, type RgbaImage } from '../core/mask/types'
import { decodePng } from '../core/png/decode'
import { encodePng } from '../core/png/encode'
import type { Deflate } from '../core/png/zlib'
import { applyCommand } from '../core/selection/commands'
import { fitRing } from '../core/selection/density'
import { serializeSelection } from '../core/selection/serialize'
import type { Selection } from '../core/selection/types'
import {
  encodeWithinBudget,
  finishImage,
  OUTPUT_MIME,
  TooLargeError,
  WHATSAPP_BUDGET_BYTES,
  WHATSAPP_QUALITIES,
  type FinishSettings,
} from '../core/sticker'
import type { Inflate } from '../core/zip'
import { browserDeflate, browserInflate } from '../services/deflate'
import {
  EncoderUnavailableError,
  loadWebpEncoder,
  type WebpEncode,
} from '../services/webp'
import {
  unknownImage,
  unknownMessage,
  type AsyncHandler,
  type FinishFailure,
  type FromRenderWorker,
  type Reply,
  type ToRenderWorker,
} from './protocol'

/** What the render worker uses from outside; tests swap them. */
export interface RenderDeps {
  deflate?: Deflate
  inflate?: Inflate
  loadWebp?: () => Promise<WebpEncode>
  render?: typeof renderMask
}

type Finished = Reply<FromRenderWorker>

/** The cutout trimmed to its mask, without copying the whole photo (spec 0012 Review Focus 2). */
function trimmedCutout(image: RgbaImage, mask: ReturnType<typeof renderMask>) {
  const bounds = trimBounds(mask, 0)
  return applyMask(cropRgba(image, bounds), cropAlpha(mask, bounds))
}

const failed = (jobId: number, reason: FinishFailure): Finished => ({
  message: { type: 'finishFailed', jobId, reason },
  transfer: [],
})

/**
 * The render worker (spec 0006 AC-23, AC-24, AC-27): keeps the last image
 * set (by id) with its smart-edge refiner, and renders selections against it.
 * The mask's buffer is transferred back. `finish` jobs (spec 0012) make the
 * output file asynchronously; the last trimmed cutout is kept, so a change
 * of outline, padding or output doesn't render the mask again (AC-7).
 */
export function createRenderHandler(
  deps: RenderDeps = {},
): AsyncHandler<ToRenderWorker, FromRenderWorker> {
  const deflate = deps.deflate ?? browserDeflate
  const inflate = deps.inflate ?? browserInflate
  const loadWebp = deps.loadWebp ?? (() => loadWebpEncoder())
  const render = deps.render ?? renderMask
  let current:
    { imageId: string; image: RgbaImage; refiner: EdgeRefiner } | undefined
  let cached: { imageId: string; key: string; cutout: RgbaImage } | undefined

  const cutoutOf = (
    cur: NonNullable<typeof current>,
    selection: Selection,
  ): RgbaImage => {
    const size = { width: cur.image.width, height: cur.image.height }
    const key = serializeSelection(selection, size)
    if (cached?.imageId === cur.imageId && cached.key === key) {
      return cached.cutout
    }
    const mask = render(selection, size, { scale: 1, refineEdge: cur.refiner })
    const cutout = trimmedCutout(cur.image, mask)
    cached = { imageId: cur.imageId, key, cutout }
    return cutout
  }

  async function finish(
    jobId: number,
    cutout: RgbaImage,
    settings: FinishSettings,
  ): Promise<Finished> {
    try {
      const img = finishImage(cutout, settings)
      const mime = OUTPUT_MIME[settings.output]
      let bytes: Uint8Array
      if (mime === 'image/webp') {
        const encode = await loadWebp()
        bytes = await encodeWithinBudget(
          (quality) => encode(img, quality),
          WHATSAPP_BUDGET_BYTES,
          WHATSAPP_QUALITIES,
        )
      } else {
        bytes = await encodePng(img, deflate)
      }
      return {
        message: {
          type: 'finished',
          jobId,
          bytes,
          mime,
          width: img.width,
          height: img.height,
        },
        transfer: [bytes.buffer as ArrayBuffer],
      }
    } catch (e) {
      if (e instanceof EmptyMaskError) return failed(jobId, 'empty')
      if (e instanceof TooLargeError) return failed(jobId, 'tooLarge')
      if (e instanceof EncoderUnavailableError) {
        return failed(jobId, 'encoderUnavailable')
      }
      throw e
    }
  }

  return (msg) => {
    switch (msg.type) {
      case 'setImage':
        cached = undefined
        current = {
          imageId: msg.imageId,
          image: msg.image,
          refiner: smartEdgeRefiner(msg.image, msg.modelAlpha),
        }
        return undefined
      case 'setModelAlpha':
        if (current?.imageId !== msg.imageId) throw unknownImage(msg.imageId)
        cached = undefined
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
      case 'resimplify': {
        let selection = msg.selection
        for (let ring = 0; ring < msg.selection.rings.length; ring++) {
          selection = applyCommand(selection, {
            type: 'setDensity',
            ring,
            tolerancePx: msg.tolerancePx,
          })
        }
        return {
          message: { type: 'resimplified', jobId: msg.jobId, selection },
          transfer: [],
        }
      }
      case 'fitRing':
        return {
          message: {
            type: 'fitted',
            jobId: msg.jobId,
            nodes: fitRing(msg.path, msg.tolerancePx),
          },
          transfer: [],
        }
      case 'finish':
      case 'finishPreview': {
        if (current?.imageId !== msg.imageId) throw unknownImage(msg.imageId)
        let cutout: RgbaImage
        try {
          cutout = cutoutOf(current, msg.selection)
        } catch (e) {
          if (e instanceof EmptyMaskError) {
            return Promise.resolve(failed(msg.jobId, 'empty'))
          }
          throw e
        }
        return finish(msg.jobId, cutout, msg.settings)
      }
      case 'finishSaved':
        return decodePng(msg.png, inflate).then((cutout) =>
          finish(msg.jobId, cutout, msg.settings),
        )
      default:
        throw unknownMessage(msg)
    }
  }
}
