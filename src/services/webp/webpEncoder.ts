import type { RgbaImage } from '../../core/mask/types'

/** Encodes RGBA as a lossy WebP with full-quality alpha (spec 0012 AC-5). */
export type WebpEncode = (
  image: RgbaImage,
  quality: number,
) => Promise<Uint8Array>

/** The encoder couldn't be downloaded or started (spec 0012 AC-6). */
export class EncoderUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("The WebP encoder couldn't be loaded", { cause })
    this.name = 'EncoderUnavailableError'
  }
}

let loading: Promise<WebpEncode> | null = null

/**
 * Loads libwebp (`@jsquash/webp`) the first time it's needed, never in the
 * initial bundle (spec 0012 Decision 1), and keeps it. A failed load is
 * forgotten, so the next call tries again (AC-6). `init` starts the wasm;
 * the default lets the library fetch it next to its own script.
 */
export function loadWebpEncoder(
  init?: () => Promise<unknown>,
): Promise<WebpEncode> {
  loading ??= (async (): Promise<WebpEncode> => {
    const lib = await import('@jsquash/webp/encode')
    await (init ? init() : lib.init())
    return async (image, quality) => {
      const data = new Uint8ClampedArray(
        image.data.buffer,
        image.data.byteOffset,
        image.data.length,
      )
      const out = await lib.default(
        { data, width: image.width, height: image.height } as ImageData,
        { quality, alpha_quality: 100, method: 4, lossless: 0 },
      )
      return new Uint8Array(out)
    }
  })().catch((e: unknown) => {
    loading = null
    throw new EncoderUnavailableError(e)
  })
  return loading
}

/** Forgets the loaded encoder (tests only). */
export function resetWebpEncoderForTests(): void {
  loading = null
}
