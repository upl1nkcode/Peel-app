import { crc32 } from '../png/zlib'
import { utf8Decode } from './utf8'

/** Raw-deflate (or zlib) decompression, injected so core stays pure. */
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>

/** Bytes with no ZIP end record, or a central directory that can't be walked. */
export class NotAZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotAZipError'
  }
}

const END_RECORD = 0x06054b50
const CENTRAL_HEADER = 0x02014b50
const LOCAL_HEADER = 0x04034b50

interface CentralEntry {
  name: string
  flags: number
  method: number
  crc: number
  packed: number
  size: number
  local: number
}

/**
 * Reads a plain ZIP (spec 0008 AC-18). Stored entries come back as views of
 * `bytes` (no copies); deflated ones are inflated with `inflateRaw`. Entries
 * that are encrypted, ZIP64, use another method, run past the file or fail
 * their CRC are listed in `damaged`, not thrown. Folders are skipped.
 */
export async function readZip(
  bytes: Uint8Array,
  inflateRaw: Inflate,
): Promise<{ files: Map<string, Uint8Array>; damaged: string[] }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (at: number) => view.getUint16(at, true)
  const u32 = (at: number) => view.getUint32(at, true)

  let end = -1
  const lowest = Math.max(0, bytes.length - 22 - 0xffff)
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (u32(i) === END_RECORD) {
      end = i
      break
    }
  }
  if (end < 0) throw new NotAZipError('no end of central directory record')
  const count = u16(end + 10)
  const centralOffset = u32(end + 16)
  if (count === 0xffff || centralOffset === 0xffffffff) {
    throw new NotAZipError('ZIP64 archives are not supported')
  }

  const entries: CentralEntry[] = []
  let p = centralOffset
  for (let k = 0; k < count; k++) {
    if (p + 46 > end || u32(p) !== CENTRAL_HEADER) {
      throw new NotAZipError('the central directory is damaged')
    }
    const nameLen = u16(p + 28)
    entries.push({
      name: utf8Decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      flags: u16(p + 8),
      method: u16(p + 10),
      crc: u32(p + 16),
      packed: u32(p + 20),
      size: u32(p + 24),
      local: u32(p + 42),
    })
    p += 46 + nameLen + u16(p + 30) + u16(p + 32)
  }

  const entryData = async (e: CentralEntry): Promise<Uint8Array | null> => {
    if (e.flags & 1) return null // encrypted
    if (e.packed === 0xffffffff || e.size === 0xffffffff) return null // ZIP64
    if (e.method !== 0 && e.method !== 8) return null
    if (e.local + 30 > bytes.length || u32(e.local) !== LOCAL_HEADER) {
      return null
    }
    const start = e.local + 30 + u16(e.local + 26) + u16(e.local + 28)
    if (start + e.packed > bytes.length) return null
    const raw = bytes.subarray(start, start + e.packed)
    let out = raw
    if (e.method === 8) {
      try {
        out = await inflateRaw(raw)
      } catch {
        return null
      }
    }
    return out.length === e.size && crc32(out) === e.crc ? out : null
  }

  const files = new Map<string, Uint8Array>()
  const damaged: string[] = []
  for (const e of entries) {
    if (e.name.endsWith('/')) continue
    const data = await entryData(e)
    if (data) files.set(e.name, data)
    else damaged.push(e.name)
  }
  return { files, damaged }
}
