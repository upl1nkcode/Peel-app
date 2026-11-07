import type { RgbaImage } from '../../core/mask'
import { cappedSize } from '../../core/photo'

/** A decoded photo with the file it came from, unchanged (spec 0008 AC-4). */
export interface LoadedPhoto {
  image: RgbaImage
  bytes: Uint8Array
  /** The file's MIME type; may be '' (some Android pickers). */
  type: string
}

/** The browser could not decode the file (spec 0008 AC-3). */
export class PhotoUnreadableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("This photo can't be opened. Try a JPEG or PNG.", options)
    this.name = 'PhotoUnreadableError'
  }
}

/**
 * Decodes a picked photo upright (its EXIF orientation applied, AC-1) at
 * `cappedSize` (AC-2), and keeps the file's bytes and type (AC-4). Anything
 * the browser can't decode rejects with `PhotoUnreadableError` (AC-3).
 */
export async function loadPhoto(file: Blob): Promise<LoadedPhoto> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (e) {
    throw new PhotoUnreadableError({ cause: e })
  }
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new PhotoUnreadableError()
    const { width, height } = cappedSize(bitmap.width, bitmap.height)
    // A DOM canvas: this runs on the main thread, and not every WebKit build has OffscreenCanvas.
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no 2D canvas')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    const pixels = ctx.getImageData(0, 0, width, height).data
    const image = { width, height, data: new Uint8Array(pixels.buffer) }
    return {
      image,
      bytes: new Uint8Array(await file.arrayBuffer()),
      type: file.type,
    }
  } finally {
    bitmap.close()
  }
}
