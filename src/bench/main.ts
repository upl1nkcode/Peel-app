/**
 * The accuracy benchmark's page (spec 0014 AC-6, AC-7), in the bench build
 * only. It runs the real engines the way the app does and scores every stage
 * against the truth; bench/accuracy.bench.ts drives it through
 * `window.peelBench.run`.
 */
import manifest from 'virtual:peel-models'
import {
  dotsRoundTrip,
  finishedAlpha,
  lassoAlpha,
  resizeMask,
  scoreCutout,
  sizeFor,
  type BenchFile,
  type Mask,
  type Row,
  type Size,
  type Stage,
} from '../core/accuracy'
import type { Point } from '../core/geometry/types'
import { resizeRgba, type AlphaMask, type RgbaImage } from '../core/mask'
import { decodePng } from '../core/png'
import { browserInflate } from '../services/deflate'
import { loadPhoto } from '../services/photo/loadPhoto'
import {
  createModelStore,
  createWorkerEngine,
  sha256Hex,
  type AutoResult,
  type SegmentationEngine,
} from '../services/segmentation'
import { startSegmentationWorker } from '../services/workers'

export interface RunInput {
  photo: string
  truth: string
  extra?: string
  tap: Point
  size: Size
}

export interface RunOutput {
  rows: Row[]
  roundTrip: BenchFile['roundTrip']
}

/** "Forwarded": re-sent at this long side and JPEG quality, roughly what WhatsApp does (spec 0014). */
const FORWARDED = { longSide: 1280, quality: 0.6 }
/** The round trip is checked at this size only (AC-7). */
const ROUND_TRIP_SIZE: Size = 1000
const LASSO_SEED = 1

const store = createModelStore({
  fetch: (input, init) => fetch(input, init),
  caches: { open: (name) => caches.open(name) },
  digest: sha256Hex,
  online: () => navigator.onLine,
})
const { engineLoader, engineWasm, fast, precise } = manifest.files
const engines: readonly SegmentationEngine[] = [
  createWorkerEngine('fast', [engineLoader, engineWasm, fast], store, () =>
    startSegmentationWorker('fast'),
  ),
  createWorkerEngine(
    'precise',
    [engineLoader, engineWasm, precise],
    store,
    () => startSegmentationWorker('precise'),
  ),
]
let loaded: Promise<void> | null = null

async function bytesOf(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${String(res.status)}`)
  return res.blob()
}

/** A mask PNG's alpha channel, exactly (the truth is stored as alpha, Task 4). */
async function maskOf(url: string): Promise<Mask> {
  const blob = await bytesOf(url)
  const img = await decodePng(
    new Uint8Array(await blob.arrayBuffer()),
    browserInflate,
  )
  const data = new Uint8Array(img.width * img.height)
  for (let i = 0; i < data.length; i++) data[i] = img.data[i * 4 + 3] ?? 0
  return { width: img.width, height: img.height, data }
}

const sized = (image: RgbaImage, width: number, height: number) =>
  image.width === width && image.height === height
    ? image
    : resizeRgba(image, width, height)

const sizedMask = (mask: Mask, width: number, height: number) =>
  mask.width === width && mask.height === height
    ? mask
    : resizeMask(mask, width, height)

/** The photo as Auto sees it at `size`: scaled down, or forwarded (scaled, then JPEG at quality 60). */
async function photoAt(original: RgbaImage, size: Size): Promise<RgbaImage> {
  if (size !== 'forwarded') {
    const s = sizeFor(original, size)
    return sized(original, s.width, s.height)
  }
  const s = sizeFor(original, FORWARDED.longSide)
  const small = sized(original, s.width, s.height)
  const canvas = new OffscreenCanvas(s.width, s.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2D canvas')
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(small.data), s.width, s.height),
    0,
    0,
  )
  const jpeg = await canvas.convertToBlob({
    type: 'image/jpeg',
    quality: FORWARDED.quality,
  })
  return (await loadPhoto(jpeg)).image
}

async function segment(
  engine: SegmentationEngine,
  id: string,
  image: RgbaImage,
  tap: Point,
): Promise<AutoResult> {
  await engine.setImage(id, image)
  return engine.segment(id, [{ imagePt: tap, mode: 'add' }])
}

/** How much the round trip moved a result's scores against the truth (AC-7). */
function roundTripDelta(
  before: AlphaMask,
  after: AlphaMask,
  truth: Mask,
): { dIou: number; dEdgeMean: number } {
  const a = scoreCutout(before, truth)
  const b = scoreCutout(after, truth)
  return {
    dIou: b.iou - a.iou,
    dEdgeMean: a.edgeMean === b.edgeMean ? 0 : b.edgeMean - a.edgeMean,
  }
}

async function run(input: RunInput): Promise<RunOutput> {
  loaded ??= Promise.all(engines.map((e) => e.load(() => undefined))).then(
    () => undefined,
  )
  await loaded
  const original = (await loadPhoto(await bytesOf(input.photo))).image
  const image = await photoAt(original, input.size)
  const { width, height } = image
  const truth = sizedMask(await maskOf(input.truth), width, height)
  const extra = input.extra
    ? sizedMask(await maskOf(input.extra), width, height)
    : undefined
  const scale = width / original.width
  const tap = { x: input.tap.x * scale, y: input.tap.y * scale }
  const id = `${input.photo}@${String(input.size)}`

  const [v1, v2] = await Promise.all(
    engines.map((e) => segment(e, id, image, tap)),
  )
  if (!v1 || !v2) throw new Error('an engine gave no result')
  const finished = finishedAlpha(image, v2)
  const lasso = lassoAlpha(image, truth, { seed: LASSO_SEED, snap: false })
  const stages: Record<Stage, AlphaMask> = {
    fast: v1.alpha,
    precise: v2.alpha,
    finished,
    lasso,
    'lasso-snap': lassoAlpha(image, truth, { seed: LASSO_SEED, snap: true }),
  }
  const rows = (Object.keys(stages) as Stage[]).map((stage) => ({
    fixture: '',
    size: input.size,
    stage,
    ...scoreCutout(stages[stage], truth, extra),
  }))

  const roundTrip: BenchFile['roundTrip'] = []
  if (input.size === ROUND_TRIP_SIZE) {
    // Each result's 50% line retraced into dots and rendered back. The smart
    // edge is not run a second time: the app runs it once, on dots traced
    // from the model's mask, and never retraces a finished cutout.
    const finishedBack = dotsRoundTrip(finished, image, undefined)
    const lassoBack = dotsRoundTrip(lasso, image, undefined)
    roundTrip.push(
      {
        fixture: '',
        stage: 'finished',
        ...roundTripDelta(finished, finishedBack, truth),
      },
      {
        fixture: '',
        stage: 'lasso',
        ...roundTripDelta(lasso, lassoBack, truth),
      },
    )
  }
  return { rows, roundTrip }
}

declare global {
  interface Window {
    peelBench?: { run(input: RunInput): Promise<RunOutput> }
  }
}

window.peelBench = { run }
