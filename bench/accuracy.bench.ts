import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  compareToBaseline,
  formatReport,
  roundRow,
  type BenchFile,
  type Row,
  type Size,
  type Stage,
  type Timing,
} from '../src/core/accuracy/report'

/** The accuracy benchmark (spec 0014 AC-6 to AC-9), run by `npm run bench:accuracy`. */

interface Fixture {
  image: string
  truth: string
  extra?: string
  tap: { x: number; y: number }
}

interface RunInput {
  photo: string
  truth: string
  extra?: string
  tap: { x: number; y: number }
  size: Size
}

declare global {
  interface Window {
    peelBench?: {
      run(
        input: RunInput,
      ): Promise<Pick<BenchFile, 'roundTrip'> & { rows: Row[]; timing: Timing }>
    }
  }
}

const ROOT = resolve(import.meta.dirname, '..')
/** `--only=a,b` (spec 0015): just those fixtures, for tuning; not compared and the report is left alone. */
const ONLY = (process.env['BENCH_ONLY'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '')
const NOW = resolve(
  ROOT,
  ONLY.length > 0 ? 'bench/accuracy-only.json' : 'bench/accuracy.json',
)
const BASELINE = resolve(ROOT, 'bench/accuracy-baseline.json')
const REPORT = resolve(ROOT, 'docs/accuracy.md')
const SIZES: readonly Size[] = [1600, 1000, 600, 400, 'forwarded', 'screenshot']
const STAGES: readonly Stage[] = [
  'fast',
  'precise',
  'finished',
  'lasso',
  'lasso-snap',
]

/** JSON has no Infinity (an empty cutout's edge error): it is stored as the string "Infinity". */
const toJson = (file: BenchFile) =>
  JSON.stringify(
    file,
    (_k, v: unknown) => (v === Infinity ? 'Infinity' : v),
    2,
  ) + '\n'
const fromJson = (text: string) =>
  JSON.parse(text, (_k, v: unknown) =>
    v === 'Infinity' ? Infinity : v,
  ) as BenchFile

/** Pass-or-fail checks today's app fails, each guarded at today's value (spec 0014 Decision 8). */
const KNOWN_MISSES = [
  '## Known misses',
  '',
  '- #156: the dots round trip changes the finished `hole` and `two-people` cutouts beyond AC-7.',
  '- #158: Auto fills the holes of the `hole` photo (AC-12); `e2e/offline.spec.ts` guards it.',
  '',
].join('\n')

const allFixtures = JSON.parse(
  readFileSync(resolve(ROOT, 'bench/fixtures/fixtures.json'), 'utf8'),
) as Record<string, Fixture>
for (const name of ONLY) {
  if (!(name in allFixtures)) throw new Error(`--only: no fixture ${name}`)
}
const fixtures =
  ONLY.length > 0
    ? Object.fromEntries(
        Object.entries(allFixtures).filter(([name]) => ONLY.includes(name)),
      )
    : allFixtures

test.describe.configure({ mode: 'serial' })

test('should_score_every_fixture_size_and_stage (AC-6, AC-7)', async ({
  page,
}) => {
  await page.goto('/bench.html')
  await page.waitForFunction(() => window.peelBench !== undefined, null, {
    timeout: 60_000,
  })
  const results: Row[] = []
  const roundTrip: BenchFile['roundTrip'] = []
  const timing: Timing[] = []
  for (const [name, f] of Object.entries(fixtures)) {
    for (const size of SIZES) {
      const input: RunInput = {
        photo: `bench-fixtures/${f.image}`,
        truth: `bench-fixtures/${f.truth}`,
        ...(f.extra && { extra: `bench-fixtures/${f.extra}` }),
        tap: f.tap,
        size,
      }
      const got = await page.evaluate((i) => {
        if (!window.peelBench) throw new Error('no bench')
        return window.peelBench.run(i)
      }, input)
      results.push(...got.rows.map((r) => roundRow({ ...r, fixture: name })))
      roundTrip.push(...got.roundTrip.map((t) => ({ ...t, fixture: name })))
      timing.push({ ...got.timing, fixture: name })
    }
  }
  const file: BenchFile = { version: 1, results, roundTrip, timing }
  writeFileSync(NOW, toJson(file))
  if (ONLY.length > 0) return
  const base = existsSync(BASELINE)
    ? fromJson(readFileSync(BASELINE, 'utf8'))
    : null
  // The "Speed" section (AC-14) is written by hand from Lighthouse; keep it.
  const old = existsSync(REPORT) ? readFileSync(REPORT, 'utf8') : ''
  const speedAt = old.indexOf('\n## Speed')
  const speed = speedAt === -1 ? '' : old.slice(speedAt)
  writeFileSync(REPORT, `${formatReport(file, base)}\n${KNOWN_MISSES}${speed}`)

  const names = Object.keys(fixtures)
  expect(results).toHaveLength(names.length * SIZES.length * STAGES.length)
  for (const name of names) {
    for (const size of SIZES) {
      const stages = results
        .filter((r) => r.fixture === name && r.size === size)
        .map((r) => r.stage)
        .sort()
      expect(stages, `${name} ${String(size)}`).toEqual([...STAGES].sort())
    }
  }
  for (const r of results) {
    expect(
      r.iou,
      `${r.fixture} ${String(r.size)} ${r.stage}`,
    ).toBeGreaterThanOrEqual(0)
    expect(r.iou).toBeLessThanOrEqual(1)
  }
  // The round trip at 1000 px, on the finished and lasso results (AC-7).
  expect(roundTrip).toHaveLength(names.length * 2)
})

test('should_not_regress (AC-9, AC-10)', () => {
  test.skip(ONLY.length > 0, '--only runs are not compared')
  if (process.env['BENCH_UPDATE'] === '1') {
    // Timing differs between machines and is never compared (spec 0015 AC-5).
    const kept = fromJson(readFileSync(NOW, 'utf8'))
    delete kept.timing
    writeFileSync(BASELINE, toJson(kept))
    return
  }
  expect(
    existsSync(BASELINE),
    'No baseline: commit bench/accuracy.json from the CI artifact as bench/accuracy-baseline.json',
  ).toBe(true)
  const got = compareToBaseline(
    fromJson(readFileSync(NOW, 'utf8')),
    fromJson(readFileSync(BASELINE, 'utf8')),
  )
  expect(got.regressions, 'worse than bench/accuracy-baseline.json').toEqual([])
  expect(got.dropped, 'rows missing since the baseline').toEqual([])
  // A new fixture, size or stage is unguarded until it is in the baseline.
  expect(
    got.added,
    'rows not in the baseline: update it with npm run bench:accuracy -- --update from the CI artifact',
  ).toEqual([])
})
