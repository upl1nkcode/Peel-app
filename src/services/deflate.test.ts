import { describe, expect, it } from 'vitest'
import { browserDeflate, toArrayBufferView } from './deflate'

async function inflate(z: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate')
  const writer = ds.writable.getWriter()
  const done = writer.write(toArrayBufferView(z)).then(() => writer.close())
  const out = new Uint8Array(await new Response(ds.readable).arrayBuffer())
  await done
  return out
}

describe('browserDeflate', () => {
  it('should_produce_a_zlib_stream_the_platform_inflates (AC-24)', async () => {
    const data = new Uint8Array(100_000).map((_, i) => (i * i) & 0xff)
    const z = await browserDeflate(data)
    expect(z[0]).toBe(0x78) // zlib header, not raw deflate
    expect(z.length).toBeLessThan(data.length)
    expect(await inflate(z)).toEqual(data)
  })
})
