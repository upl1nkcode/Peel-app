import type { Selection } from '../selection/types'
import { renderMask, type EdgeRefiner } from './render'
import type { AlphaMask, RgbaImage } from './types'

/**
 * RGB unchanged, alpha = round(imageAlpha · mask / 255). The mask must be the
 * image's exact size, so a preview mask can never reach the saved sticker.
 */
export function applyMask(image: RgbaImage, mask: AlphaMask): RgbaImage {
  if (mask.width !== image.width || mask.height !== image.height) {
    throw new RangeError(
      `mask ${String(mask.width)}×${String(mask.height)} does not match image ${String(image.width)}×${String(image.height)}`,
    )
  }
  const data = image.data.slice()
  for (let k = 0; k < mask.data.length; k++) {
    data[k * 4 + 3] = Math.round(
      ((data[k * 4 + 3] as number) * (mask.data[k] as number)) / 255,
    )
  }
  return { width: image.width, height: image.height, data }
}

/** The full-resolution cutout: renders the selection at the image's size (never scaled) and applies it. */
export function cutout(
  image: RgbaImage,
  selection: Selection,
  options: { refineEdge?: EdgeRefiner } = {},
): RgbaImage {
  const size = { width: image.width, height: image.height }
  const mask = options.refineEdge
    ? renderMask(selection, size, { refineEdge: options.refineEdge })
    : renderMask(selection, size)
  return applyMask(image, mask)
}
