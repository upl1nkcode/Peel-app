import { crc32 } from '../png/zlib'
import { utf8Encode } from './utf8'

export interface ZipEntry {
  name: string
  data: Uint8Array
}

/** A backup that plain ZIP cannot hold: over 4 GiB or 65,535 entries (spec 0008 AC-19). */
export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipLimitError'
  }
}

export const MAX_ZIP_ENTRIES = 0xffff
export const MAX_ZIP_BYTES = 0xffffffff

/** Throws `ZipLimitError` when `count` entries or `totalBytes` exceed plain ZIP. */
export function checkZipLimits(count: number, totalBytes: number): void {
  if (count > MAX_ZIP_ENTRIES) {
    throw new ZipLimitError(`${String(count)} entries; plain ZIP holds 65,535`)
  }
  if (totalBytes > MAX_ZIP_BYTES) {
    throw new ZipLimitError(
      `${String(totalBytes)} bytes; plain ZIP holds 4 GiB`,
    )
  }
}

/** MS-DOS time and date from the local fields, clamped to 1980-01-01. */
function dosTime(d: Date): { time: number; date: number } {
  if (d.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 }
  return {
    time:
      (d.getHours() << 11) |
      (d.getMinutes() << 5) |
      Math.floor(d.getSeconds() / 2),
    date:
      ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * A plain ZIP of `entries` (spec 0008 AC-15), each stored (method 0) with its
 * CRC-32 and a UTF-8 name, returned as chunks to hand to a Blob. Entry data
 * is not copied. Throws `ZipLimitError` past plain ZIP's limits (no ZIP64).
 */
export function writeZip(
  entries: readonly ZipEntry[],
  modified: Date,
): Uint8Array[] {
  const names = entries.map((e) => utf8Encode(e.name))
  const total = entries.reduce(
    (n, e, k) =>
      n + 30 + 46 + 2 * (names[k] as Uint8Array).length + e.data.length,
    22,
  )
  checkZipLimits(entries.length, total)

  const { time, date } = dosTime(modified)
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  entries.forEach((entry, k) => {
    const name = names[k] as Uint8Array
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed: 2.0
    lv.setUint16(6, 0x800, true) // UTF-8 names
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    chunks.push(local, entry.data)

    const head = new Uint8Array(46 + name.length)
    const cv = new DataView(head.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0x800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    head.set(name, 46)
    central.push(head)

    offset += local.length + size
  })

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  return [...chunks, ...central, end]
}
