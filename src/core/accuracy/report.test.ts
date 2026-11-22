import { describe, expect, it } from 'vitest'
import {
  compareToBaseline,
  formatReport,
  roundRow,
  TARGETS,
  TOLERANCES,
  type BenchFile,
  type Row,
} from './report'

const row = (over: Partial<Row> = {}): Row => ({
  fixture: 'hair',
  size: 600,
  stage: 'finished',
  iou: 0.99,
  edgeMean: 0.8,
  edgeP99: 3,
  extra: 0,
  softError: 0.04,
  background: 0.001,
  missed: 0.002,
  ...over,
})

const file = (rows: Row[]): BenchFile => ({
  version: 1,
  results: rows,
  roundTrip: [],
})

const compare = (now: Partial<Row>, base: Partial<Row> = {}) =>
  compareToBaseline(file([row(now)]), file([row(base)]))

describe('accuracy report (spec 0014)', () => {
  it('should_hold_the_spec_targets_and_tolerances (AC-6, AC-9)', () => {
    expect(TARGETS).toEqual({
      iou: 0.98,
      edgeMean: 1,
      edgeP99: 4,
      extra: 0.005,
      softError: 0.05,
      background: 0.005,
      missed: 0.005,
    })
    expect(TOLERANCES).toEqual({
      iou: 0.002,
      edgeMean: 0.05,
      edgeP99: 0.5,
      extra: 0.001,
      softError: 0.003,
      background: 0.001,
      missed: 0.001,
    })
  })

  it('should_fail_on_a_drop_beyond_tolerance (AC-9)', () => {
    const bad = compare({ iou: 0.9879 }, { iou: 0.99 })
    expect(bad.regressions).toEqual([
      'hair 600 finished: iou 0.9900 → 0.9879 (−0.0021, tolerance 0.002)',
    ])
    expect(compare({ iou: 0.9881 }, { iou: 0.99 }).regressions).toEqual([])
    // Better is never a regression.
    expect(compare({ iou: 0.999 }, { iou: 0.99 }).regressions).toEqual([])
  })

  it('should_compare_each_score_with_its_own_tolerance (AC-9)', () => {
    expect(compare({ edgeMean: 0.86 }).regressions).toHaveLength(1)
    expect(compare({ edgeP99: 3.4 }).regressions).toEqual([])
    expect(compare({ extra: 0.002 }).regressions).toHaveLength(1)
    expect(compare({ softError: 0.044 }).regressions).toHaveLength(1)
    expect(compare({ softError: 0.042 }).regressions).toEqual([])
  })

  it('should_report_new_rows_and_fail_dropped_ones (AC-9, Review Focus 4)', () => {
    const now = file([row(), row({ fixture: 'pet' })])
    const base = file([row(), row({ fixture: 'hole' })])
    const got = compareToBaseline(now, base)
    expect(got.regressions).toEqual([])
    expect(got.added).toEqual(['pet 600 finished'])
    expect(got.dropped).toEqual(['hole 600 finished'])
  })

  it('should_mark_rows_new_since_the_baseline (AC-9, Review Focus 4)', () => {
    const now = file([row(), row({ fixture: 'pet' })])
    const md = formatReport(now, file([row()]))
    expect(md).toContain('| pet (new) | 600 |')
    expect(md).toContain('| hair | 600 |')
    // Without a baseline nothing is "new".
    expect(formatReport(now, null)).not.toContain('(new)')
  })

  it('should_flag_soft_error_appearing_or_vanishing (AC-9, Review Focus 5)', () => {
    const appeared = compare({ softError: 0.02 }, { softError: null })
    expect(appeared.regressions).toHaveLength(1)
    expect(appeared.regressions[0]).toContain('softError')
    expect(
      compare({ softError: null }, { softError: 0.02 }).regressions,
    ).toHaveLength(1)
    expect(
      compare({ softError: null }, { softError: null }).regressions,
    ).toEqual([])
  })

  it('should_format_infinity_as_a_miss (AC-6, Review Focus 2)', () => {
    expect(
      compare({ edgeMean: Infinity }, { edgeMean: 1 }).regressions,
    ).toHaveLength(1)
    expect(
      compare(
        { edgeMean: Infinity, edgeP99: Infinity },
        { edgeMean: Infinity, edgeP99: Infinity },
      ).regressions,
    ).toEqual([])
    const md = formatReport(file([row({ iou: 0, edgeMean: Infinity })]), null)
    expect(md).toContain('∞ ❌')
  })

  it('should_round_to_4_decimals_keeping_infinity_and_null (AC-6)', () => {
    expect(
      roundRow(row({ iou: 0.123456, edgeMean: Infinity, softError: null })),
    ).toMatchObject({
      iou: 0.1235,
      edgeMean: Infinity,
      softError: null,
    })
  })

  it('should_guard_the_round_trip_and_its_known_misses (AC-7, Decision 8)', () => {
    const trip = (dIou: number, dEdgeMean: number): BenchFile => ({
      version: 1,
      results: [],
      roundTrip: [{ fixture: 'hole', stage: 'finished', dIou, dEdgeMean }],
    })
    // Within AC-7's limits: fine, whatever the baseline says.
    expect(
      compareToBaseline(trip(-0.001, 0.09), trip(0, 0)).regressions,
    ).toEqual([])
    // A new miss fails.
    expect(compareToBaseline(trip(0, 0.3), trip(0, 0.05)).regressions).toEqual([
      'hole finished round trip: dEdgeMean +0.0500 → +0.3000 (limit 0.1)',
    ])
    // A known miss (also outside the limits in the baseline) holds at today's value.
    expect(
      compareToBaseline(trip(0, 1.14), trip(0, 1.1166)).regressions,
    ).toEqual([])
    expect(
      compareToBaseline(trip(0, 1.2), trip(0, 1.1166)).regressions,
    ).toHaveLength(1)
    expect(
      compareToBaseline(trip(-0.0045, 0), trip(-0.003, 0)).regressions,
    ).toEqual([])
    expect(
      compareToBaseline(trip(-0.0051, 0), trip(-0.003, 0)).regressions,
    ).toHaveLength(1)
    // The report names it.
    expect(formatReport(trip(0, 1.1166), trip(0, 1.1166))).toContain(
      '❌ known miss',
    )
    expect(formatReport(trip(0, 1.1166), null)).not.toContain('known miss')
  })

  it('should_mark_targets_and_list_the_worst_five (AC-6)', () => {
    const rows: Row[] = [
      row({ fixture: 'hair', iou: 0.962 }),
      row({ fixture: 'pet', iou: 0.995, edgeMean: 0.5 }),
      row({ fixture: 'hole', iou: 0.9, stage: 'fast' }),
    ]
    const now: BenchFile = {
      version: 1,
      results: rows,
      roundTrip: [
        { fixture: 'hair', stage: 'finished', dIou: 0.001, dEdgeMean: 0.02 },
      ],
    }
    const md = formatReport(now, file([row({ fixture: 'hair', iou: 0.97 })]))
    expect(md).toContain('## Finished')
    expect(md).toContain('## Fast')
    expect(md).toContain('0.9620 ❌ −0.0180')
    expect(md).toContain('0.9950 ✅')
    expect(md).toContain('0.9700 → 0.9620')
    expect(md).toContain('## Worst five')
    expect(md.indexOf('hair 600')).toBeLessThan(md.indexOf('## Finished'))
    expect(md).toContain('## Dots round trip')
  })
})

describe('accuracy report: low detail (spec 0015)', () => {
  it('should_show_and_guard_background_and_missed (spec 0015 AC-2)', () => {
    const md = formatReport(
      file([row({ background: 0.004, missed: 0.009 })]),
      null,
    )
    expect(md).toContain('| Extra | Soft error | Background | Missed |')
    expect(md).toContain('0.0040 ✅')
    expect(md).toContain('0.0090 ❌ +0.0040')
    expect(
      compare({ background: 0.0031 }, { background: 0.002 }).regressions,
    ).toEqual([expect.stringContaining('background 0.0020 → 0.0031')])
    expect(
      compare({ background: 0.0029 }, { background: 0.002 }).regressions,
    ).toEqual([])
    expect(compare({ missed: 0.0031 }, { missed: 0.002 }).regressions).toEqual([
      expect.stringContaining('missed'),
    ])
  })

  it('should_list_the_most_background_left_on (spec 0015 AC-2)', () => {
    const rows = [0.01, 0.05, 0.002, 0.03, 0.02, 0.04, 0.0].map((b, i) =>
      row({ fixture: `f${String(i)}`, background: b }),
    )
    rows.push(row({ fixture: 'lassoed', stage: 'lasso', background: 0.9 }))
    const md = formatReport(file(rows), null)
    const at = md.indexOf('## Most background left on (finished)')
    expect(at).toBeGreaterThan(-1)
    const list = md.slice(at, md.indexOf('\n## ', at + 5))
    const names = [...list.matchAll(/^- (\S+) /gm)].map((m) => m[1])
    expect(names).toEqual(['f1', 'f5', 'f3', 'f4', 'f0'])
  })

  it('should_not_fail_on_scores_the_baseline_lacks (spec 0015 AC-2)', () => {
    const old = row({ background: 0.5, missed: 0.5 }) as Partial<Row>
    delete old.background
    delete old.missed
    const base = file([old as Row])
    expect(
      compareToBaseline(file([row({ background: 0.3, missed: 0.3 })]), base)
        .regressions,
    ).toEqual([])
  })

  it('should_order_the_screenshot_size_last (spec 0015 AC-4)', () => {
    const sizes = ['screenshot', 400, 'forwarded', 1600, 600, 1000] as const
    const md = formatReport(file(sizes.map((size) => row({ size }))), null)
    const finished = md.slice(md.indexOf('## Finished'))
    const order = [...finished.matchAll(/^\| hair \| (\S+) \|/gm)]
      .slice(0, 6)
      .map((m) => m[1])
    expect(order).toEqual([
      '1600',
      '1000',
      '600',
      '400',
      'forwarded',
      'screenshot',
    ])
  })

  it('should_show_time_to_sharper_result_as_information (spec 0015 AC-5)', () => {
    const t = (size: 1000 | 400, firstMs: number, secondMs: number | null) => ({
      fixture: 'x',
      size,
      firstMs,
      secondMs,
      path: 'whole' as const,
    })
    const md = formatReport(
      {
        ...file([row()]),
        timing: [
          t(1000, 900, 400),
          t(1000, 1100, 600),
          t(1000, 5000, 500),
          t(400, 300, null),
        ],
      },
      null,
    )
    const at = md.indexOf('## Time to sharper result')
    expect(at).toBeGreaterThan(-1)
    const section = md.slice(at)
    expect(section).toContain('information only')
    expect(section).toContain('| 1000 | 1100 | 500 |')
    expect(section).toContain('| 400 | 300 | — |')
    expect(formatReport(file([row()]), null)).not.toContain(
      '## Time to sharper',
    )
  })

  it('should_never_compare_timing (spec 0015 AC-5)', () => {
    const now: BenchFile = {
      ...file([row()]),
      timing: [
        {
          fixture: 'hair',
          size: 1000,
          firstMs: 99999,
          secondMs: 99999,
          path: 'whole',
        },
      ],
    }
    const base: BenchFile = {
      ...file([row()]),
      timing: [
        { fixture: 'hair', size: 1000, firstMs: 1, secondMs: 1, path: 'crop' },
      ],
    }
    expect(compareToBaseline(now, base)).toEqual({
      regressions: [],
      added: [],
      dropped: [],
    })
  })
})
