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
