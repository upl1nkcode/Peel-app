import type { Size } from '../../core/geometry/types'
import {
  applyMask,
  cropRgba,
  resizeRgba,
  trimBounds,
  type AlphaMask,
  type RgbaImage,
} from '../../core/mask'
import { encodePng, type Deflate } from '../../core/png'
import type { Selection } from '../../core/selection/types'
import type { Inflate } from '../../core/zip'

export const THUMBNAIL_LONG_SIDE_PX = 256

/** The thumbnail size for a w × h sticker (spec 0008 AC-7); never enlarges. */
export function thumbnailSize(width: number, height: number): Size {
  const s = Math.min(1, THUMBNAIL_LONG_SIDE_PX / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * s)),
    height: Math.max(1, Math.round(height * s)),
  }
}

export interface SavedModelAlpha {
  width: number
  height: number
  /** zlib stream of the 8-bit values, row-major. */
  deflated: Uint8Array
}

export interface BuiltSticker {
  /** The full-resolution trimmed cutout as PNG (AC-6). */
  sticker: Uint8Array
  thumbnail: Uint8Array
  modelAlpha?: SavedModelAlpha
}

/**
 * The files saved for a sticker (spec 0008 AC-5 to AC-7): the scale-1 render
 * (`renderFull`, the render worker in the app) applied to the loaded image,
 * trimmed with no padding and encoded as PNG; a thumbnail of it; and the
 * model alpha deflated exactly. Nothing from the screen preview is used.
 * Throws `EmptyMaskError` when the cutout covers no pixel.
 */
export async function buildSticker(
  input: {
    image: RgbaImage
    selection: Selection
    modelAlpha: AlphaMask | null
  },
  deps: {
    renderFull(selection: Selection): Promise<AlphaMask>
    deflate: Deflate
  },
): Promise<BuiltSticker> {
  const mask = await deps.renderFull(input.selection)
  const cropped = cropRgba(applyMask(input.image, mask), trimBounds(mask, 0))
  const thumb = thumbnailSize(cropped.width, cropped.height)
  const [sticker, thumbnail] = await Promise.all([
    encodePng(cropped, deps.deflate),
    encodePng(resizeRgba(cropped, thumb.width, thumb.height), deps.deflate),
  ])
  if (!input.modelAlpha) return { sticker, thumbnail }
  const { width, height, data } = input.modelAlpha
  return {
    sticker,
    thumbnail,
    modelAlpha: { width, height, deflated: await deps.deflate(data) },
  }
}

/** The saved model alpha back as a mask; `RangeError` if its length is not width × height. */
export async function inflateModelAlpha(
  saved: SavedModelAlpha,
  inflate: Inflate,
): Promise<AlphaMask> {
  const data = await inflate(saved.deflated)
  if (data.length !== saved.width * saved.height) {
    throw new RangeError(
      `model alpha has ${String(data.length)} values, expected ${String(saved.width * saved.height)}`,
    )
  }
  return { width: saved.width, height: saved.height, data }
}
