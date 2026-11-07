// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { crc32 } from '../png/zlib'
import { testInflateRaw } from '../testing/codecs'
import {
  PYTHON_DEFLATED_ZIP_BASE64,
  PYTHON_STORED_ZIP_BASE64,
} from './fixtures'
import {
  checkZipLimits,
  createZipWriter,
  NotAZipError,
  readZip,
  utf8Decode,
  utf8Encode,
  writeZip,
  ZipLimitError,
  type Inflate,
  type ZipEntry,
} from './index'

const inflateRaw: Inflate = testInflateRaw

const concat = (chunks: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function fromBase64(b64: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of b64.replace(/=+$/, '')) {
    value = (value << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((value >> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}
const text = (s: string) => utf8Encode(s)
const when = new Date(2026, 10, 7, 12, 30, 10)

const u32 = (b: Uint8Array, at: number) =>
  new DataView(b.buffer, b.byteOffset).getUint32(at, true)
const u16 = (b: Uint8Array, at: number) =>
  new DataView(b.buffer, b.byteOffset).getUint16(at, true)

/** Offsets of each central-directory header, by name. */
function centralHeaders(zip: Uint8Array): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 0; i + 46 <= zip.length; i++) {
    if (u32(zip, i) !== 0x02014b50) continue
    const nameLen = u16(zip, i + 28)
    out.set(utf8Decode(zip.subarray(i + 46, i + 46 + nameLen)), i)
  }
  return out
}

const sample = (): ZipEntry[] => [
  { name: 'peel-backup.json', data: text('{"a":1}') },
  { name: 'empty.bin', data: new Uint8Array(0) },
  {
    name: 'stickers/é/big.bin',
    data: Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31) % 251),
  },
]

describe('zip', () => {
  it('should_round_trip_entries (AC-15, AC-16)', async () => {
    const entries = sample()
    const { files, damaged } = await readZip(
      concat(writeZip(entries, when)),
      inflateRaw,
    )
    expect(damaged).toEqual([])
    expect([...files.keys()]).toEqual(entries.map((e) => e.name))
    for (const e of entries) expect(files.get(e.name)).toEqual(e.data)
  })

  it('should_write_crcs_and_stored_method (AC-15)', () => {
    const entries = sample()
    const zip = concat(writeZip(entries, when))
    const central = centralHeaders(zip)
    for (const e of entries) {
      const c = central.get(e.name) as number
      expect(u16(zip, c + 10)).toBe(0) // method: stored
      expect(u32(zip, c + 16)).toBe(crc32(e.data))
      expect(u16(zip, c + 8) & 0x800).toBe(0x800) // UTF-8 names
      const local = u32(zip, c + 42)
      expect(u32(zip, local)).toBe(0x04034b50)
      expect(u16(zip, local + 8)).toBe(0)
      expect(u32(zip, local + 14)).toBe(crc32(e.data))
    }
  })

  it('should_read_zips_made_elsewhere (AC-18)', async () => {
    for (const b64 of [PYTHON_STORED_ZIP_BASE64, PYTHON_DEFLATED_ZIP_BASE64]) {
      const { files, damaged } = await readZip(fromBase64(b64), inflateRaw)
      expect(damaged).toEqual([])
      expect(utf8Decode(files.get('a.txt') as Uint8Array)).toBe('hello')
      expect(files.get('dir/b.bin')).toEqual(
        Uint8Array.from({ length: 256 }, (_, i) => i),
      )
    }
  })

  it('should_count_damaged_entries (AC-17, AC-18)', async () => {
    const names = ['ok.txt', 'crc.txt', 'locked.txt', 'method.txt', 'cut.txt']
    const zip = concat(
      writeZip(
        names.map((name) => ({ name, data: text(`data of ${name}`) })),
        when,
      ),
    )
    const central = centralHeaders(zip)
    const at = (name: string) => central.get(name) as number
    // A flipped data byte: the CRC no longer matches.
    const crcLocal = u32(zip, at('crc.txt') + 42)
    zip[crcLocal + 30 + 'crc.txt'.length] =
      (zip[crcLocal + 30 + 'crc.txt'.length] as number) ^ 0xff
    // Encrypted (general purpose flag bit 0).
    zip[at('locked.txt') + 8] = (zip[at('locked.txt') + 8] as number) | 1
    // Method 12 (bzip2), unsupported.
    zip[at('method.txt') + 10] = 12
    // A size running past the end of the file.
    new DataView(zip.buffer).setUint32(at('cut.txt') + 20, 0x7fffffff, true)
    new DataView(zip.buffer).setUint32(at('cut.txt') + 24, 0x7fffffff, true)

    const { files, damaged } = await readZip(zip, inflateRaw)
    expect(damaged.sort()).toEqual(
      ['crc.txt', 'cut.txt', 'locked.txt', 'method.txt'].sort(),
    )
    expect(utf8Decode(files.get('ok.txt') as Uint8Array)).toBe('data of ok.txt')
    expect(files.has('crc.txt')).toBe(false)
  })

  it('should_refuse_bytes_that_are_not_a_zip (AC-18)', async () => {
    await expect(readZip(text('not a zip'), inflateRaw)).rejects.toThrow(
      NotAZipError,
    )
    await expect(readZip(new Uint8Array(0), inflateRaw)).rejects.toThrow(
      NotAZipError,
    )
  })

  it('should_refuse_zips_over_the_limits (AC-19)', () => {
    expect(() =>
      writeZip(
        Array.from({ length: 65_536 }, (_, i) => ({
          name: String(i),
          data: new Uint8Array(0),
        })),
        when,
      ),
    ).toThrow(ZipLimitError)
    expect(() => {
      checkZipLimits(65_535, 0xffffffff)
    }).not.toThrow()
    expect(() => {
      checkZipLimits(65_536, 0)
    }).toThrow(ZipLimitError)
    expect(() => {
      checkZipLimits(1, 2 ** 32)
    }).toThrow(ZipLimitError)
  })

  it('should_write_entries_one_at_a_time (export memory)', async () => {
    const writer = createZipWriter(when)
    const first = writer.add({ name: 'a.txt', data: utf8Encode('hello') })
    const second = writer.add({ name: 'b/c.bin', data: Uint8Array.of(1, 2) })
    const chunks = [...first, ...second, ...writer.finish()]
    expect(concat(chunks)).toEqual(
      concat(
        writeZip(
          [
            { name: 'a.txt', data: utf8Encode('hello') },
            { name: 'b/c.bin', data: Uint8Array.of(1, 2) },
          ],
          when,
        ),
      ),
    )
    const { files } = await readZip(concat(chunks), testInflateRaw)
    expect(files.get('b/c.bin')).toEqual(Uint8Array.of(1, 2))
  })

  it('should_refuse_an_entry_past_the_limits_as_it_is_added (AC-19)', () => {
    const writer = createZipWriter(when)
    for (let i = 0; i < 65_535; i++) {
      writer.add({ name: String(i), data: new Uint8Array(0) })
    }
    expect(() =>
      writer.add({ name: 'one too many', data: new Uint8Array(0) }),
    ).toThrow(ZipLimitError)
  })

  it('should_return_views_not_copies (Review Focus 5)', async () => {
    const zip = concat(writeZip(sample(), when))
    const { files } = await readZip(zip, inflateRaw)
    expect((files.get('stickers/é/big.bin') as Uint8Array).buffer).toBe(
      zip.buffer,
    )
  })

  it('should_write_the_dos_time (AC-15)', () => {
    const zip = concat(writeZip(sample(), when))
    const c = centralHeaders(zip).get('empty.bin') as number
    // 12:30:10 → (12 << 11) | (30 << 5) | 5; 2026-11-07 → (46 << 9) | (11 << 5) | 7
    expect(u16(zip, c + 12)).toBe((12 << 11) | (30 << 5) | 5)
    expect(u16(zip, c + 14)).toBe((46 << 9) | (11 << 5) | 7)
  })

  it('should_encode_utf8_names', () => {
    for (const s of ['', 'abc', 'é', '€', '😀', 'stickers/ü/photo.jpg']) {
      expect(utf8Decode(utf8Encode(s))).toBe(s)
    }
    expect([...utf8Encode('é€😀')]).toEqual([
      0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80,
    ])
  })
})
