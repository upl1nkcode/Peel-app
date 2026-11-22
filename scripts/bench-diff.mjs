// Before/after table for a fix PR (spec 0015 Decision 4, the ship rule):
//   node scripts/bench-diff.mjs BEFORE.json AFTER.json
// Prints every finished row whose scores changed, as before → after, and the
// finished rows worse than BEFORE beyond the CI tolerances.
import { readFileSync } from 'node:fs'
import { compareToBaseline } from '../src/core/accuracy/report.ts'

const METRICS = [
  'iou',
  'edgeMean',
  'edgeP99',
  'extra',
  'softError',
  'background',
  'missed',
]

const [beforePath, afterPath] = process.argv.slice(2)
if (!beforePath || !afterPath) {
  console.error('usage: node scripts/bench-diff.mjs BEFORE.json AFTER.json')
  process.exit(2)
}
const read = (path) =>
  JSON.parse(readFileSync(path, 'utf8'), (_k, v) =>
    v === 'Infinity' ? Infinity : v,
  )
const finished = (file) => ({
  ...file,
  results: file.results.filter((r) => r.stage === 'finished'),
  roundTrip: [],
})
const before = finished(read(beforePath))
const after = finished(read(afterPath))

const key = (r) => `${r.fixture} ${String(r.size)}`
const was = new Map(before.results.map((r) => [key(r), r]))
const show = (v) =>
  v === undefined || v === null
    ? '—'
    : v === Infinity
      ? '∞'
      : Number(v).toFixed(4)

const lines = [
  '| Fixture | Size | ' + METRICS.join(' | ') + ' |',
  '|---|---|' + METRICS.map(() => '---|').join(''),
]
let changed = 0
for (const r of after.results) {
  const b = was.get(key(r))
  // A score the BEFORE file predates (spec 0015's background and missed) is shown, not compared.
  const differs = (m) => b !== undefined && m in b && b[m] !== r[m]
  const cells = METRICS.map((m) =>
    differs(m) ? `${show(b[m])} → ${show(r[m])}` : show(r[m]),
  )
  if (b && !METRICS.some(differs)) continue
  changed++
  lines.push(
    `| ${r.fixture}${b ? '' : ' (new)'} | ${String(r.size)} | ${cells.join(' | ')} |`,
  )
}
console.log(`Finished rows changed: ${String(changed)}\n`)
if (changed > 0) console.log(lines.join('\n'))
const { regressions } = compareToBaseline(after, before)
console.log(
  `\nFinished scores worse than before beyond the CI tolerances: ${String(regressions.length)}`,
)
for (const line of regressions) console.log(`- ${line}`)
