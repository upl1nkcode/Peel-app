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
  SCREENSHOT,
  scoreCutout,
  secondTap,
  sizeFor,
  type BenchFile,
  type Mask,
  type Row,
  type Size,
  type Stage,
  type Timing,
} from '../core/accuracy'
import type { Point } from '../core/geometry/types'
import {
  gaussianBlur,
  resizeRgba,
  type AlphaMask,
  type RgbaImage,
} from '../core/mask'
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
  timing: Timing
}

/** "Forwarded": re-sent at this long side and JPEG quality, roughly what WhatsApp does (spec 0014). */
const FORWARDED = { longSide: 1280, quality: 0.6 }
/** The round trip is checked at this size only (AC-7). */
const ROUND_TRIP_SIZE: Size = 1000
/** A second tap is timed at these sizes only (spec 0015 AC-5: CI time). */
const SECOND_TAP_SIZES: readonly Size[] = [1000, 'screenshot']
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

/** A truth or distractor at `size`: scaled like the photo, and blurred like it for "screenshot" (spec 0015 AC-4). */
function maskAt(mask: Mask, size: Size, width: number, height: number): Mask {
  const small = sizedMask(mask, width, height)
  if (size !== 'screenshot') return small
  return {
    width,
    height,
    data: gaussianBlur(small.data, width, height, 1, SCREENSHOT.sigma),
  }
}

/** `image` re-encoded as a JPEG at `quality` and decoded again, as a re-sent photo is. */
async function reencoded(
  image: RgbaImage,
  quality: number,
): Promise<RgbaImage> {
  const { width, height } = image
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2D canvas')
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), width, height),
    0,
    0,
  )
  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  return (await loadPhoto(jpeg)).image
}

/**
 * The photo as Auto sees it at `size`: scaled down; forwarded (scaled, then
 * JPEG at quality 60); or screenshot (scaled, blurred, then JPEG at 50).
 */
async function photoAt(original: RgbaImage, size: Size): Promise<RgbaImage> {
  if (size === 'forwarded') {
    const s = sizeFor(original, FORWARDED.longSide)
    return reencoded(sized(original, s.width, s.height), FORWARDED.quality)
  }
  if (size === 'screenshot') {
    const s = sizeFor(original, SCREENSHOT.longSide)
    const small = sized(original, s.width, s.height)
    const blurred = {
      width: s.width,
      height: s.height,
      data: gaussianBlur(small.data, s.width, s.height, 4, SCREENSHOT.sigma),
    }
    return reencoded(blurred, SCREENSHOT.quality)
  }
  const s = sizeFor(original, size)
  return sized(original, s.width, s.height)
}

/**
 * Both engines on `taps`, started together as Auto starts them today (spec
 * 0007); `ms` is from the start to the precise (sharper) result (spec 0015 AC-5).
 */
async function segmentBoth(
  id: string,
  taps: readonly Point[],
): Promise<{ fast: AutoResult; precise: AutoResult; ms: number }> {
  const [fastEngine, preciseEngine] = engines
  if (!fastEngine || !preciseEngine) throw new Error('two engines expected')
  const list = taps.map((imagePt) => ({ imagePt, mode: 'add' as const }))
  const start = performance.now()
  const fastRun = fastEngine.segment(id, list)
  const precise = await preciseEngine.segment(id, list)
  const ms = performance.now() - start
  return { fast: await fastRun, precise, ms }
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
  const truth = maskAt(await maskOf(input.truth), input.size, width, height)
  const extra = input.extra
    ? maskAt(await maskOf(input.extra), input.size, width, height)
    : undefined
  const scale = width / original.width
  const tap = { x: input.tap.x * scale, y: input.tap.y * scale }
  const id = `${input.photo}@${String(input.size)}`

  await Promise.all(engines.map((e) => e.setImage(id, image)))
  const first = await segmentBoth(id, [tap])
  const v1 = first.fast
  const v2 = first.precise
  const secondMs = SECOND_TAP_SIZES.includes(input.size)
    ? (await segmentBoth(id, [tap, secondTap(truth, tap)])).ms
    : null
  const timing: Timing = {
    fixture: '',
    size: input.size,
    firstMs: Math.round(first.ms),
    secondMs: secondMs === null ? null : Math.round(secondMs),
    path: 'whole',
  }
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
  return { rows, roundTrip, timing }
}

declare global {
  interface Window {
    peelBench?: { run(input: RunInput): Promise<RunOutput> }
  }
}

window.peelBench = { run }
