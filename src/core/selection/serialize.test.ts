import { describe, expect, it } from 'vitest'

import { mulberry32 } from '../../test/random'
import type { Node, Point, Size } from '../geometry/types'
import {
  InvalidSelectionError,
  UnsupportedSelectionVersionError,
} from './errors'
import {
  parseSelection,
  SELECTION_FORMAT_VERSION,
  serializeSelection,
} from './serialize'
import type { BrushStroke, Ring, Selection } from './types'

const imageSize: Size = { width: 4032, height: 3024 }

function randomSelection(rand: () => number): Selection {
  const ringCount = 1 + Math.floor(rand() * 4)
  const rings: Ring[] = Array.from({ length: ringCount }, () => {
    const count = 3 + Math.floor(rand() * 20)
    const cx = rand() * 4032
    const cy = rand() * 3024
    const r = 5 + rand() * 500
    const nodes: Node[] = Array.from({ length: count }, (_, i) => {
      const t = (i / count) * 2 * Math.PI
      const k = r * (0.7 + rand() * 0.6)
      return {
        x: cx + k * Math.cos(t),
        y: cy + k * Math.sin(t),
        kind: rand() < 0.4 ? 'corner' : 'smooth',
      }
    })
    return { op: rand() < 0.7 ? 'add' : 'subtract', nodes }
  })
  const strokes: BrushStroke[] = Array.from(
    { length: Math.floor(rand() * 4) },
    () => ({
      mode: rand() < 0.5 ? 'erase' : 'restore',
      sizePx: 0.5 + rand() * 100,
      hardness: rand(),
      points: Array.from({ length: 1 + Math.floor(rand() * 30) }, () => ({
        x: rand() * 4032,
        y: rand() * 3024,
      })),
    }),
  )
  const sel: Selection = { rings, strokes, feather: rand() * 3 }
  return rand() < 0.5
    ? { ...sel, softEdge: { source: 'guided', bandPx: 2 + rand() * 18 } }
    : sel
}

/** Every number in the parsed value is Object.is-identical to the original's. */
function expectBitExact(actual: unknown, expected: unknown, path = '$'): void {
  if (typeof expected === 'number') {
    expect(Object.is(actual, expected), path).toBe(true)
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true)
    const list = actual as unknown[]
    expect(list.length, path).toBe(expected.length)
    expected.forEach((v, i) => {
      expectBitExact(list[i], v, `${path}[${String(i)}]`)
    })
  } else if (typeof expected === 'object' && expected !== null) {
    const obj = actual as Record<string, unknown>
    for (const [k, v] of Object.entries(expected)) {
      expectBitExact(obj[k], v, `${path}.${k}`)
    }
  } else {
    expect(actual, path).toBe(expected)
  }
}

const awkward: Selection = {
  rings: [
    {
      op: 'add',
      nodes: [
        { x: 0.1 + 0.2, y: 1e-300, kind: 'corner' },
        { x: 4032.000000001, y: 0, kind: 'smooth' },
        { x: 5, y: 7.25, kind: 'smooth' },
      ],
    },
  ],
  strokes: [
    {
      mode: 'erase',
      sizePx: 1 / 3,
      hardness: 0.8,
      points: [{ x: Number.MIN_VALUE, y: 2 ** 53 + 2 }],
    },
  ],
  feather: 2.9999999999999996,
}

/** A valid document as a plain object, for the malformed-input table. */
const validDoc = (): Record<string, unknown> =>
  JSON.parse(
    serializeSelection(
      {
        ...awkward,
        softEdge: { source: 'model', bandPx: 6 },
      },
      imageSize,
    ),
  ) as Record<string, unknown>

const DELETE = Symbol('delete')

/**
 * Sets (or deletes) the field at a path like `selection.rings[0].nodes[1].x`
 * in a parsed JSON document.
 */
function setIn(doc: unknown, path: string, value: unknown): void {
  const keys = (path.match(/[^.[\]]+/g) ?? []).map((k) =>
    /^\d+$/.test(k) ? Number(k) : k,
  )
  const last = keys.pop() as string | number
  let node = doc as Record<string | number, unknown>
  for (const k of keys) node = node[k] as Record<string | number, unknown>
  if (value === DELETE) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete node[last]
  } else node[last] = value
}

/** The valid document with one field changed, as JSON. */
const mutated = (path: string, value: unknown): string => {
  const doc = validDoc()
  setIn(doc, path, value)
  return JSON.stringify(doc)
}

describe('selection JSON', () => {
  // AC-26
  it('should_round_trip_bit_exact', () => {
    const rand = mulberry32(26)
    const cases = [
      awkward,
      { ...awkward, softEdge: { source: 'model', bandPx: 6 } } as Selection,
      ...Array.from({ length: 30 }, () => randomSelection(rand)),
    ]
    for (const sel of cases) {
      const back = parseSelection(serializeSelection(sel, imageSize))
      expect(back.selection).toEqual(sel)
      expectBitExact(back.selection, sel)
    }
  })

  it('should_write_version_1_and_omit_an_absent_soft_edge', () => {
    expect(SELECTION_FORMAT_VERSION).toBe(1)
    const doc = JSON.parse(serializeSelection(awkward, imageSize)) as Record<
      string,
      unknown
    >
    expect(doc.version).toBe(1)
    expect(doc.imageSize).toEqual(imageSize)
    expect(Object.keys(doc.selection as object)).not.toContain('softEdge')
  })

  // Review Focus 5
  it('should_normalise_negative_zero', () => {
    const sel: Selection = {
      rings: [
        {
          op: 'add',
          nodes: [
            { x: -0, y: 0, kind: 'corner' },
            { x: 10, y: -0, kind: 'corner' },
            { x: 0, y: 10, kind: 'corner' },
          ],
        },
      ],
      strokes: [],
      feather: -0,
    }
    const back = parseSelection(serializeSelection(sel, imageSize)).selection
    const first = back.rings[0]?.nodes[0] as Point
    expect(Object.is(first.x, 0)).toBe(true)
    expect(Object.is(back.rings[0]?.nodes[1]?.y, 0)).toBe(true)
    expect(Object.is(back.feather, 0)).toBe(true)
  })

  // AC-27
  it.each<[string, unknown]>([
    ['0', 0],
    ['2', 2],
    ['"1"', '1'],
    ['null', null],
    ['missing', undefined],
  ])('should_reject_unknown_versions (%s)', (_, version) => {
    const doc = validDoc()
    setIn(doc, 'version', version === undefined ? DELETE : version)
    setIn(doc, 'selection', 'garbage') // the version is checked before anything else
    const json = JSON.stringify(doc)
    let caught: unknown
    try {
      parseSelection(json)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(UnsupportedSelectionVersionError)
    expect((caught as UnsupportedSelectionVersionError).version).toBe(version)
  })

  // AC-28
  const nodes = 'selection.rings[0].nodes'
  const stroke = 'selection.strokes[0]'
  it.each<[string, () => string, string]>([
    ['not JSON', () => 'not json {', '$'],
    ['a non-object root', () => '[1]', '$'],
    ['a missing image size', () => mutated('imageSize', DELETE), 'imageSize'],
    ['a zero width', () => mutated('imageSize.width', 0), 'imageSize.width'],
    [
      'a fractional height',
      () => mutated('imageSize.height', 2.5),
      'imageSize.height',
    ],
    ['a missing selection', () => mutated('selection', DELETE), 'selection'],
    [
      'rings not an array',
      () => mutated('selection.rings', {}),
      'selection.rings',
    ],
    [
      'an unknown op',
      () => mutated('selection.rings[0].op', 'union'),
      'selection.rings[0].op',
    ],
    [
      'a node that is not an object',
      () => mutated(`${nodes}[0]`, 5),
      `${nodes}[0]`,
    ],
    [
      'a string coordinate',
      () => mutated(`${nodes}[1].x`, '3'),
      `${nodes}[1].x`,
    ],
    [
      'a missing coordinate',
      () => mutated(`${nodes}[2].y`, DELETE),
      `${nodes}[2].y`,
    ],
    [
      'a non-finite coordinate',
      () => mutated(`${nodes}[1].x`, 12345.5).replace('12345.5', '1e999'),
      `${nodes}[1].x`,
    ],
    [
      'an unknown kind',
      () => mutated(`${nodes}[0].kind`, 'round'),
      `${nodes}[0].kind`,
    ],
    [
      'a ring with 2 nodes',
      () => mutated(nodes, awkward.rings[0]?.nodes.slice(0, 2)),
      nodes,
    ],
    [
      'a collinear ring',
      () =>
        mutated(nodes, [
          { x: 0, y: 0, kind: 'corner' },
          { x: 1, y: 1, kind: 'corner' },
          { x: 2, y: 2, kind: 'corner' },
        ]),
      nodes,
    ],
    [
      'a missing strokes list',
      () => mutated('selection.strokes', DELETE),
      'selection.strokes',
    ],
    [
      'an unknown mode',
      () => mutated(`${stroke}.mode`, 'smudge'),
      `${stroke}.mode`,
    ],
    [
      'a zero brush size',
      () => mutated(`${stroke}.sizePx`, 0),
      `${stroke}.sizePx`,
    ],
    [
      'a hardness above 1',
      () => mutated(`${stroke}.hardness`, 2),
      `${stroke}.hardness`,
    ],
    [
      'an empty stroke',
      () => mutated(`${stroke}.points`, []),
      `${stroke}.points`,
    ],
    [
      'a bad stroke point',
      () => mutated(`${stroke}.points[0].y`, true),
      `${stroke}.points[0].y`,
    ],
    ['feather 9', () => mutated('selection.feather', 9), 'selection.feather'],
    [
      'a null soft edge',
      () => mutated('selection.softEdge', null),
      'selection.softEdge',
    ],
    [
      'an unknown source',
      () => mutated('selection.softEdge.source', 'magic'),
      'selection.softEdge.source',
    ],
    [
      'a band of 50',
      () => mutated('selection.softEdge.bandPx', 50),
      'selection.softEdge.bandPx',
    ],
  ])(
    'should_reject_malformed_documents_with_the_field_path (%s)',
    (_, json, path) => {
      expect(() => parseSelection(json())).toThrow(InvalidSelectionError)
      expect(() => parseSelection(json())).toThrow(`${path}:`)
    },
  )

  // Review Focus 5
  it('should_ignore_unknown_extra_fields', () => {
    const sel: Selection = {
      ...awkward,
      softEdge: { source: 'model', bandPx: 6 },
    }
    const doc: unknown = JSON.parse(serializeSelection(sel, imageSize))
    for (const [path, value] of [
      ['comment', 'from a newer build'],
      ['imageSize.dpi', 72],
      ['selection.layers', []],
      ['selection.rings[0].name', 'cat'],
      ['selection.rings[0].nodes[0].pressure', 0.5],
      ['selection.strokes[0].tilt', 3],
      ['selection.strokes[0].points[0].t', 9],
      ['selection.softEdge.quality', 'high'],
    ] as const) {
      setIn(doc, path, value)
    }
    const back = parseSelection(JSON.stringify(doc))
    expect(back.selection).toStrictEqual(sel)
    expect(back.imageSize).toStrictEqual(imageSize)
  })

  // AC-29
  it('should_return_the_image_size', () => {
    const size = { width: 640, height: 480 }
    expect(parseSelection(serializeSelection(awkward, size)).imageSize).toEqual(
      size,
    )
  })

  it('should_refuse_to_write_a_bad_image_size', () => {
    for (const bad of [
      { width: 0, height: 10 },
      { width: 10, height: Number.NaN },
      { width: 1.5, height: 10 },
    ]) {
      expect(() => serializeSelection(awkward, bad)).toThrow(
        InvalidSelectionError,
      )
    }
  })
})
