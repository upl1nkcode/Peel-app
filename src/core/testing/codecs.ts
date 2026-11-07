/**
 * Test-only compression through the runtime's DecompressionStream /
 * CompressionStream (Node and browsers). src/core has no DOM lib, so the
 * globals are typed here by hand; production code injects its own codecs.
 */
type Format = 'deflate' | 'deflate-raw'
interface Streams {
  CompressionStream: new (format: Format) => object
  DecompressionStream: new (format: Format) => object
  Response: new (body: unknown) => {
    body: { pipeThrough(transform: object): unknown }
    arrayBuffer(): Promise<ArrayBuffer>
  }
}
const { CompressionStream, DecompressionStream, Response } =
  globalThis as unknown as Streams

const run = async (data: Uint8Array, transform: object) =>
  new Uint8Array(
    await new Response(
      new Response(new Uint8Array(data)).body.pipeThrough(transform),
    ).arrayBuffer(),
  )

export const testInflateRaw = (data: Uint8Array) =>
  run(data, new DecompressionStream('deflate-raw'))
export const testInflate = (data: Uint8Array) =>
  run(data, new DecompressionStream('deflate'))
export const testDeflate = (data: Uint8Array) =>
  run(data, new CompressionStream('deflate'))
