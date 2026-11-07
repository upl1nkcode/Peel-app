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

export interface ZipWriter {
  /** The chunks for `entry`: its header and its data (not copied). */
  add(entry: ZipEntry): Uint8Array[]
  /** The central directory and end record; call once, after the last `add`. */
  finish(): Uint8Array[]
}

/**
 * A plain ZIP written one entry at a time (spec 0008 AC-15), so a caller can
 * hand each entry's chunks on (to a Blob) before reading the next. Entries
 * are stored (method 0) with their CRC-32 and a UTF-8 name. `add` throws
 * `ZipLimitError` for the entry that would take the file past plain ZIP's
 * limits (no ZIP64), before writing anything for it.
 */
export function createZipWriter(modified: Date): ZipWriter {
  const { time, date } = dosTime(modified)
  const central: Uint8Array[] = []
  let centralSize = 0
  let offset = 0

  return {
    add(entry) {
      const name = utf8Encode(entry.name)
      const size = entry.data.length
      checkZipLimits(
        central.length + 1,
        offset + 30 + name.length + size + centralSize + 46 + name.length + 22,
      )
      const crc = crc32(entry.data)

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
      centralSize += head.length

      offset += local.length + size
      return [local, entry.data]
    },
    finish() {
      const end = new Uint8Array(22)
      const ev = new DataView(end.buffer)
      ev.setUint32(0, 0x06054b50, true)
      ev.setUint16(8, central.length, true)
      ev.setUint16(10, central.length, true)
      ev.setUint32(12, centralSize, true)
      ev.setUint32(16, offset, true)
      return [...central, end]
    },
  }
}

/**
 * A plain ZIP of `entries` (spec 0008 AC-15), returned as chunks to hand to a
 * Blob. Entry data is not copied. Throws `ZipLimitError` past plain ZIP's
 * limits (no ZIP64), before computing any CRC.
 */
export function writeZip(
  entries: readonly ZipEntry[],
  modified: Date,
): Uint8Array[] {
  const total = entries.reduce(
    (n, e) => n + 30 + 46 + 2 * utf8Encode(e.name).length + e.data.length,
    22,
  )
  checkZipLimits(entries.length, total)
  const writer = createZipWriter(modified)
  return [...entries.flatMap((e) => writer.add(e)), ...writer.finish()]
}
