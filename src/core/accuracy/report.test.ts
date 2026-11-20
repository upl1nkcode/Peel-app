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
    })
    expect(TOLERANCES).toEqual({
      iou: 0.002,
      edgeMean: 0.05,
      edgeP99: 0.5,
      extra: 0.001,
      softError: 0.003,
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
