// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../src/core/png'

/** The accuracy test photos (spec 0014 AC-1 to AC-3). */
const DIR = resolve(import.meta.dirname, 'fixtures')
const NAMES = [
  'hair',
  'pet',
  'two-people',
  'skin-object',
  'glossy',
  'hole',
] as const
const LICENCES = ['CC0', 'Public domain', 'CC BY 4.0', 'CC BY 3.0', 'CC BY 2.0']

interface Fixture {
  image: string
  truth: string
  extra?: string
  tap: { x: number; y: number }
  holeProbe?: { x: number; y: number; width: number; height: number }
  hardTruth?: boolean
  issue?: number
}

const fixtures = (): Record<string, Fixture> =>
  JSON.parse(readFileSync(join(DIR, 'fixtures.json'), 'utf8')) as Record<
    string,
    Fixture
  >

/** Width and height from a baseline or progressive JPEG's frame header. */
function jpegSize(b: Buffer): { width: number; height: number } {
  let at = 2
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) throw new Error('bad JPEG marker')
    const marker = b[at + 1]
    const len = b.readUInt16BE(at + 2)
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7) }
    }
    at += 2 + len
  }
  throw new Error('no JPEG frame header')
}

const alphaOf = async (file: string) => {
  const img = await decodePng(
    new Uint8Array(readFileSync(join(DIR, file))),
    (d) => Promise.resolve(new Uint8Array(inflateSync(d))),
  )
  const alpha = new Uint8Array(img.width * img.height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3]
  return { width: img.width, height: img.height, alpha }
}

// Decoding 1600 × 1000 PNGs in JavaScript takes seconds under coverage on CI.
describe('accuracy test photos (spec 0014)', { timeout: 60_000 }, () => {
  it('should_list_six_fixtures_with_files (AC-1)', async () => {
    const all = fixtures()
    expect(Object.keys(all).sort()).toEqual([...NAMES].sort())
    for (const name of NAMES) {
      const f = all[name]
      const size = jpegSize(readFileSync(join(DIR, f.image)))
      expect(Math.max(size.width, size.height), name).toBe(1600)
      const truth = await alphaOf(f.truth)
      expect(truth.width, name).toBe(size.width)
      expect(truth.height, name).toBe(size.height)
      const tap =
        truth.alpha[Math.floor(f.tap.y) * truth.width + Math.floor(f.tap.x)]
      expect(tap, `${name} tap`).toBe(255)
      if (f.extra) {
        const extra = await alphaOf(f.extra)
        expect(extra.width, name).toBe(size.width)
      }
    }
    expect(all['two-people'].extra).toBeDefined()
    expect(all['skin-object'].extra).toBeDefined()
    expect(all.hole.holeProbe).toBeDefined()
  })

  it('should_keep_photos_small (AC-2)', () => {
    let total = 0
    for (const file of readdirSync(DIR)) {
      const bytes = statSync(join(DIR, file)).size
      total += bytes
      expect(bytes, file).toBeLessThanOrEqual(800 * 1024)
    }
    expect(total).toBeLessThanOrEqual(6 * 1024 * 1024)
  })

  it('should_credit_every_source (AC-2)', () => {
    const readme = readFileSync(join(DIR, 'README.md'), 'utf8')
    const licences = readFileSync(
      resolve(import.meta.dirname, '../docs/licenses.md'),
      'utf8',
    )
    const rows = readme
      .split('\n')
      .filter((l) => l.startsWith('| `') && l.includes('http'))
    expect(rows.length).toBeGreaterThanOrEqual(6)
    for (const r of rows) {
      const cells = r.split('|').map((c) => c.trim())
      const url = /https?:\/\/[^\s)>]+/.exec(r)?.[0]
      expect(url, r).toBeDefined()
      expect(
        LICENCES.some((l) => cells.includes(l)),
        `${r}: licence`,
      ).toBe(true)
      expect(licences, `${String(url)} in docs/licenses.md`).toContain(
        String(url),
      )
    }
  })

  it('should_have_soft_hair_and_fur (AC-3)', async () => {
    const all = fixtures()
    for (const name of ['hair', 'pet'] as const) {
      const f = all[name]
      if (f.hardTruth) {
        expect(
          f.issue,
          `${name}: the Decision 9 fallback needs an issue`,
        ).toBeGreaterThan(0)
        continue
      }
      const { width, height, alpha } = await alphaOf(f.truth)
      let x0 = width
      let y0 = height
      let x1 = -1
      let y1 = -1
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (alpha[y * width + x] === 0) continue
          x0 = Math.min(x0, x)
          y0 = Math.min(y0, y)
          x1 = Math.max(x1, x)
          y1 = Math.max(y1, y)
        }
      }
      let soft = 0
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const a = alpha[y * width + x]
          if (a > 0 && a < 255) soft++
        }
      }
      const box = (x1 - x0 + 1) * (y1 - y0 + 1)
      expect(soft / box, name).toBeGreaterThanOrEqual(0.02)
    }
  })
})
