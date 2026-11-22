import type { Scores } from './score'

export type Size = 1600 | 1000 | 600 | 400 | 'forwarded' | 'screenshot'
export type Stage = 'fast' | 'precise' | 'finished' | 'lasso' | 'lasso-snap'

/** One fixture at one size and stage (spec 0014 AC-6). */
export interface Row extends Scores {
  fixture: string
  size: Size
  stage: Stage
}

/** The selection-to-dots-and-back change, at 1000 px (AC-7). */
export interface RoundTrip {
  fixture: string
  stage: 'finished' | 'lasso'
  dIou: number
  dEdgeMean: number
}

/** Time from the tap to the sharper result (spec 0015 AC-5): information only, never compared. */
export interface Timing {
  fixture: string
  size: Size
  firstMs: number
  /** A second add tap, at 1000 px and screenshot only. */
  secondMs: number | null
  path: 'whole' | 'crop' | 'cut'
}

/** `bench/accuracy.json` and `bench/accuracy-baseline.json` (the baseline has no `timing`). */
export interface BenchFile {
  version: 1
  results: Row[]
  roundTrip: RoundTrip[]
  timing?: Timing[]
}

type Metric = keyof Scores

/** Near-perfect (Decision 2): reported, never failed. */
export const TARGETS: Readonly<Record<Metric, number>> = {
  iou: 0.98,
  edgeMean: 1,
  edgeP99: 4,
  extra: 0.005,
  softError: 0.05,
  background: 0.005,
  missed: 0.005,
}

/** How much worse than the baseline fails CI (AC-9). */
export const TOLERANCES: Readonly<Record<Metric, number>> = {
  iou: 0.002,
  edgeMean: 0.05,
  edgeP99: 0.5,
  extra: 0.001,
  softError: 0.003,
  background: 0.001,
  missed: 0.001,
}

/** The AC-7 limits on the round trip. */
const ROUND_TRIP = { dIou: 0.002, dEdgeMean: 0.1 }
/** How much a known round-trip miss may grow before CI fails (Decision 8; AC-9's iou and edgeMean tolerances). */
const ROUND_TRIP_TOLERANCE = { dIou: 0.002, dEdgeMean: 0.05 }
const TRIP_METRICS = ['dIou', 'dEdgeMean'] as const

const tripKey = (t: RoundTrip) => `${t.fixture} ${t.stage}`
const tripOk = (t: RoundTrip) =>
  TRIP_METRICS.every((m) => Math.abs(t[m]) <= ROUND_TRIP[m])

/**
 * Round-trip rows that fail CI (AC-7, Decision 8): outside AC-7's limits,
 * unless the baseline already missed by as much (a known miss, held at
 * today's value within a tolerance).
 */
function roundTripRegressions(now: BenchFile, base: BenchFile): string[] {
  const before = new Map(base.roundTrip.map((t) => [tripKey(t), t]))
  const out: string[] = []
  for (const t of now.roundTrip) {
    const b = before.get(tripKey(t))
    for (const m of TRIP_METRICS) {
      const v = Math.abs(t[m])
      if (v <= ROUND_TRIP[m]) continue
      const w = b ? Math.abs(b[m]) : null
      if (w !== null && w > ROUND_TRIP[m] && v <= w + ROUND_TRIP_TOLERANCE[m])
        continue
      out.push(
        `${tripKey(t)} round trip: ${m} ${b ? signed(b[m]) : 'none'} → ${signed(t[m])} (limit ${String(ROUND_TRIP[m])})`,
      )
    }
  }
  return out
}

const METRICS: readonly Metric[] = [
  'iou',
  'edgeMean',
  'edgeP99',
  'extra',
  'softError',
  'background',
  'missed',
]
const STAGES: readonly { stage: Stage; title: string }[] = [
  { stage: 'finished', title: 'Finished (what Auto saves)' },
  { stage: 'precise', title: 'Precise (Tap v2 model alpha)' },
  { stage: 'fast', title: 'Fast (Tap v1)' },
  { stage: 'lasso', title: 'Lasso (snap off, the default)' },
  { stage: 'lasso-snap', title: 'Lasso (snap on)' },
]
const SIZES: readonly Size[] = [1600, 1000, 600, 400, 'forwarded', 'screenshot']

const key = (r: Pick<Row, 'fixture' | 'size' | 'stage'>) =>
  `${r.fixture} ${String(r.size)} ${r.stage}`

const higherIsBetter = (m: Metric) => m === 'iou'

const round4 = (v: number) => Math.round(v * 1e4) / 1e4

/** Rounds every score to 4 decimals; `Infinity` and `null` stay as they are. */
export function roundRow(row: Row): Row {
  const out = { ...row }
  for (const m of METRICS) {
    const v = row[m]
    if (typeof v === 'number' && Number.isFinite(v)) out[m] = round4(v)
  }
  return out
}

const num = (v: number) => (v === Infinity ? '∞' : v.toFixed(4))
const signed = (v: number) =>
  v === Infinity ? '+∞' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(4)}`

/** How much worse `now` is than `base` (positive is worse); null when not comparable. */
function worsening(m: Metric, now: number, base: number): number {
  if (now === base) return 0
  if (now === Infinity) return Infinity
  if (base === Infinity) return -Infinity
  return higherIsBetter(m) ? base - now : now - base
}

/** Regressions beyond AC-9's tolerances, rows new since the baseline, and rows gone from it. */
export function compareToBaseline(
  now: BenchFile,
  base: BenchFile,
): { regressions: string[]; added: string[]; dropped: string[] } {
  const before = new Map(base.results.map((r) => [key(r), r]))
  const seen = new Set<string>()
  const regressions: string[] = []
  const added: string[] = []
  for (const r of now.results) {
    const k = key(r)
    seen.add(k)
    const b = before.get(k)
    if (!b) {
      added.push(k)
      continue
    }
    for (const m of METRICS) {
      const v = r[m]
      // A baseline written before a score existed (spec 0015 AC-2) has nothing to compare.
      const w = b[m] as number | null | undefined
      if (w === undefined) continue
      if (v === null || w === null) {
        if (v !== w) {
          regressions.push(
            `${k}: ${m} ${w === null ? 'none' : num(w)} → ${v === null ? 'none' : num(v)} (appeared or vanished)`,
          )
        }
        continue
      }
      const worse = worsening(m, v, w)
      if (worse > TOLERANCES[m]) {
        regressions.push(
          `${k}: ${m} ${num(w)} → ${num(v)} (${signed(v - w)}, tolerance ${String(TOLERANCES[m])})`,
        )
      }
    }
  }
  regressions.push(...roundTripRegressions(now, base))
  const dropped = base.results.map(key).filter((k) => !seen.has(k))
  return { regressions, added, dropped }
}

/** The signed distance from the target: negative IoU and positive errors are short of it. */
function gap(m: Metric, v: number): number {
  return v - TARGETS[m]
}

function meets(m: Metric, v: number): boolean {
  return higherIsBetter(m) ? v >= TARGETS[m] : v <= TARGETS[m]
}

function cell(
  m: Metric,
  v: number | null,
  before: number | null | undefined,
): string {
  if (v === null) return '—'
  const was =
    before !== undefined && before !== v
      ? `${before === null ? '—' : num(before)} → `
      : ''
  if (v === Infinity) return `${was}∞ ❌`
  return meets(m, v)
    ? `${was}${num(v)} ✅`
    : `${was}${num(v)} ❌ ${signed(gap(m, v))}`
}

const sizeOrder = (s: Size) => SIZES.indexOf(s)

/** The median of `values` (the lower middle for an even count, so it is always a measured value). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] as number
}

/** Median time from the tap to the sharper result, by size (spec 0015 AC-5). */
function timingLines(timing: readonly Timing[]): string[] {
  const lines = [
    '## Time to sharper result',
    '',
    'Median milliseconds from the tap to the precise result on the machine that ran the bench: information only, never compared with the baseline (spec 0015 AC-5).',
    '',
    '| Size | First tap (ms) | Second tap (ms) |',
    '|---|---|---|',
  ]
  for (const size of SIZES) {
    const at = timing.filter((t) => t.size === size)
    if (at.length === 0) continue
    const second = at.flatMap((t) => (t.secondMs === null ? [] : [t.secondMs]))
    const secondCell = second.length > 0 ? String(median(second)) : '—'
    lines.push(
      `| ${String(size)} | ${String(median(at.map((t) => t.firstMs)))} | ${secondCell} |`,
    )
  }
  lines.push('')
  return lines
}

/** `docs/accuracy.md` (AC-6): targets, the worst five, a table per stage, the round trip. */
export function formatReport(now: BenchFile, base: BenchFile | null): string {
  const before = new Map((base?.results ?? []).map((r) => [key(r), r]))
  const lines: string[] = [
    '# Cutout accuracy',
    '',
    'Written by `npm run bench:accuracy` (spec 0014). Each score is the cutout against the exact truth of a composited test photo, at that photo size, in its own pixels.',
    '',
    `Targets (near-perfect, reported, not failed): IoU ≥ ${String(TARGETS.iou)}, mean edge error ≤ ${String(TARGETS.edgeMean)} px, 99th-percentile edge error ≤ ${String(TARGETS.edgeP99)} px, extra ≤ ${String(TARGETS.extra)}, soft-edge error ≤ ${String(TARGETS.softError)}, background left on ≤ ${String(TARGETS.background)}, subject missed ≤ ${String(TARGETS.missed)} (both as a share of the subject's size). CI fails only when a score gets worse than \`bench/accuracy-baseline.json\`.`,
    '',
  ]
  if (base) lines.push('Changed cells show baseline → now.', '')

  const finished = now.results
    .filter((r) => r.stage === 'finished')
    .sort((a, b) => a.iou - b.iou)
    .slice(0, 5)
  lines.push('## Worst five (finished cutouts, by IoU)', '')
  for (const r of finished) {
    lines.push(
      `- ${r.fixture} ${String(r.size)}: IoU ${num(r.iou)}${meets('iou', r.iou) ? '' : ` (${signed(gap('iou', r.iou))})`}, edge ${num(r.edgeMean)} px`,
    )
  }
  if (finished.length === 0) lines.push('- None scored.')
  lines.push('')

  const stray = now.results
    .filter((r) => r.stage === 'finished')
    .sort((a, b) => b.background - a.background)
    .slice(0, 5)
  if (stray.length > 0) {
    lines.push('## Most background left on (finished)', '')
    for (const r of stray) {
      lines.push(
        `- ${r.fixture} ${String(r.size)}: background ${num(r.background)}, missed ${num(r.missed)}`,
      )
    }
    lines.push('')
  }

  for (const { stage, title } of STAGES) {
    const rows = now.results
      .filter((r) => r.stage === stage)
      .sort(
        (a, b) =>
          a.fixture.localeCompare(b.fixture) ||
          sizeOrder(a.size) - sizeOrder(b.size),
      )
    if (rows.length === 0) continue
    lines.push(
      `## ${title}`,
      '',
      '| Fixture | Size | IoU | Edge mean (px) | Edge p99 (px) | Extra | Soft error | Background | Missed |',
      '|---|---|---|---|---|---|---|---|---|',
    )
    for (const r of rows) {
      const b = before.get(key(r))
      const cells = METRICS.map((m) => cell(m, r[m], b?.[m]))
      const name = base && !b ? `${r.fixture} (new)` : r.fixture
      lines.push(`| ${name} | ${String(r.size)} | ${cells.join(' | ')} |`)
    }
    lines.push('')
  }

  if (now.roundTrip.length > 0) {
    lines.push(
      '## Dots round trip',
      '',
      `Selection to dots and back at 1000 px (AC-7): within IoU ${String(ROUND_TRIP.dIou)} and ${String(ROUND_TRIP.dEdgeMean)} px.`,
      '',
      '| Fixture | Stage | ΔIoU | ΔEdge mean (px) | OK |',
      '|---|---|---|---|---|',
    )
    const tripsBefore = new Map(
      (base?.roundTrip ?? []).map((t) => [tripKey(t), t]),
    )
    for (const t of now.roundTrip) {
      const b = tripsBefore.get(tripKey(t))
      const mark = tripOk(t) ? '✅' : b && !tripOk(b) ? '❌ known miss' : '❌'
      lines.push(
        `| ${t.fixture} | ${t.stage} | ${signed(t.dIou)} | ${signed(t.dEdgeMean)} | ${mark} |`,
      )
    }
    lines.push('')
  }
  if (now.timing && now.timing.length > 0)
    lines.push(...timingLines(now.timing))
  return lines.join('\n')
}
