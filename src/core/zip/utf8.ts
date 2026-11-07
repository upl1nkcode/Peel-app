/** UTF-8 without the DOM's TextEncoder (src/core has no browser lib). */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = []
  for (const ch of text) {
    const c = ch.codePointAt(0) as number
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    } else {
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 63),
        0x80 | ((c >> 6) & 63),
        0x80 | (c & 63),
      )
    }
  }
  return Uint8Array.from(out)
}

/** Decodes UTF-8; each malformed sequence becomes U+FFFD. */
export function utf8Decode(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  const cont = (k: number) => {
    const b = bytes[i + k]
    return b !== undefined && (b & 0xc0) === 0x80 ? b & 63 : -1
  }
  while (i < bytes.length) {
    const b = bytes[i] as number
    let c = -1
    let n = 1
    if (b < 0x80) {
      c = b
    } else if (b >= 0xc2 && b < 0xe0) {
      const x = cont(1)
      if (x >= 0) {
        c = ((b & 31) << 6) | x
        n = 2
      }
    } else if (b >= 0xe0 && b < 0xf0) {
      const x = cont(1)
      const y = cont(2)
      const v = ((b & 15) << 12) | (x << 6) | y
      if (x >= 0 && y >= 0 && v >= 0x800 && (v < 0xd800 || v > 0xdfff)) {
        c = v
        n = 3
      }
    } else if (b >= 0xf0 && b < 0xf5) {
      const x = cont(1)
      const y = cont(2)
      const z = cont(3)
      const v = ((b & 7) << 18) | (x << 12) | (y << 6) | z
      if (x >= 0 && y >= 0 && z >= 0 && v >= 0x10000 && v <= 0x10ffff) {
        c = v
        n = 4
      }
    }
    out += c < 0 ? '�' : String.fromCodePoint(c)
    i += n
  }
  return out
}
