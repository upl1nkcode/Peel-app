import type { RgbaImage } from '../../core/mask'

/** Photos are read at most this large on the long side (spec 0007 AC-24). */
export const MAX_PHOTO_LONG_SIDE_PX = 4096

/** Decodes a picked photo with its EXIF orientation applied, at most 4096 px on the long side. */
export async function loadPhoto(file: Blob): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  })
  try {
    const fit = Math.min(
      1,
      MAX_PHOTO_LONG_SIDE_PX / Math.max(bitmap.width, bitmap.height),
    )
    const width = Math.max(1, Math.round(bitmap.width * fit))
    const height = Math.max(1, Math.round(bitmap.height * fit))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2D canvas')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    const pixels = ctx.getImageData(0, 0, width, height).data
    return { width, height, data: new Uint8Array(pixels.buffer) }
  } finally {
    bitmap.close()
  }
}
