import type { Deflate } from '../core/png/zlib'

/** Streams take ArrayBuffer-backed views only; copy the rare shared-buffer view. */
export const toArrayBufferView = (data: Uint8Array): Uint8Array<ArrayBuffer> =>
  data.buffer instanceof ArrayBuffer
    ? (data as Uint8Array<ArrayBuffer>)
    : new Uint8Array(data)

/** zlib deflate with the platform's built-in `CompressionStream` (no library). */
export const browserDeflate: Deflate = async (data) => {
  const cs = new CompressionStream('deflate')
  const writer = cs.writable.getWriter()
  const written = writer
    .write(toArrayBufferView(data))
    .then(() => writer.close())
  const out = new Uint8Array(await new Response(cs.readable).arrayBuffer())
  await written
  return out
}

async function decompress(
  format: 'deflate' | 'deflate-raw',
  data: Uint8Array,
): Promise<Uint8Array> {
  const ds = new DecompressionStream(format)
  const writer = ds.writable.getWriter()
  const written = writer
    .write(toArrayBufferView(data))
    .then(() => writer.close())
  try {
    return new Uint8Array(await new Response(ds.readable).arrayBuffer())
  } finally {
    // A corrupt stream rejects both sides; the read's error is the one reported.
    await written.catch(() => undefined)
  }
}

/** zlib inflate with the platform's `DecompressionStream` (spec 0008 model alpha). */
export const browserInflate = (data: Uint8Array) => decompress('deflate', data)

/** Raw-deflate inflate, for ZIP entries compressed with method 8 (spec 0008 AC-18). */
export const browserInflateRaw = (data: Uint8Array) =>
  decompress('deflate-raw', data)
