/** Turns bytes into a zlib stream (RFC 1950). The browser's is `CompressionStream('deflate')`. */
export type Deflate = (data: Uint8Array) => Promise<Uint8Array>

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** CRC-32 as used by PNG chunks. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Adler-32 as used by zlib. */
export function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  const NMAX = 5552 // largest run before the sums can overflow 2^32
  for (let i = 0; i < bytes.length;) {
    const end = Math.min(bytes.length, i + NMAX)
    for (; i < end; i++) {
      a += bytes[i] as number
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

const MAX_STORED = 65535

/** A valid zlib stream of stored (uncompressed) deflate blocks; needs no compression library. */
export const storedDeflate: Deflate = (data) => {
  const blocks = Math.max(1, Math.ceil(data.length / MAX_STORED))
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4)
  out[0] = 0x78 // deflate, 32 K window
  out[1] = 0x01 // check bits: 0x7801 % 31 === 0, no dictionary, fastest
  let o = 2
  for (let b = 0; b < blocks; b++) {
    const start = b * MAX_STORED
    const len = Math.min(MAX_STORED, data.length - start)
    out[o] = b === blocks - 1 ? 1 : 0 // BFINAL, BTYPE = 00 (stored)
    out[o + 1] = len & 0xff
    out[o + 2] = len >>> 8
    out[o + 3] = ~len & 0xff
    out[o + 4] = (~len >>> 8) & 0xff
    out.set(data.subarray(start, start + len), o + 5)
    o += 5 + len
  }
  const sum = adler32(data)
  out[o] = sum >>> 24
  out[o + 1] = (sum >>> 16) & 0xff
  out[o + 2] = (sum >>> 8) & 0xff
  out[o + 3] = sum & 0xff
  return Promise.resolve(out)
}
