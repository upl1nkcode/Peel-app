import type { Size } from '../geometry/types'

/** A saved sticker (spec 0008 Contract), as stored and as backed up. */
export interface StickerRecord {
  /** `crypto.randomUUID()` when made on this device. */
  id: string
  /** ms since epoch. */
  createdAt: number
  updatedAt: number
  /** The loaded photo's size (spec 0008 AC-2), which the selection is in. */
  imageSize: Size
  /** The photo file exactly as picked; `type` may be ''. */
  photo: { bytes: Uint8Array; type: string }
  /** Spec 0003 selection JSON, unchanged. */
  selection: string
  /** zlib-deflated 8-bit model alpha, row-major, width × height when inflated. */
  modelAlpha?: { width: number; height: number; deflated: Uint8Array }
  /** The full-resolution trimmed cutout (spec 0008 AC-6). */
  sticker: Uint8Array
  /** At most 256 px on the long side (spec 0008 AC-7). */
  thumbnail: Uint8Array
}
