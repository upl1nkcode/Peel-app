import {
  InteractiveSegmenter,
  InteractiveSegmenterLegacy,
  type BrushMode,
  type MPMask,
} from '@mediapipe/tasks-vision'
import type { RgbaImage } from '../core/mask'
import type { Stroke } from '../core/segmentation'
import { EngineUnavailable } from '../services/segmentation/types'
import type { EngineFiles, InferenceBackend } from './segmentationHandler'

type Fileset = Parameters<typeof InteractiveSegmenter.createFromOptions>[0]

/** MediaPipe's brush modes; `BrushMode` is a type-only enum (not in the bundle's runtime exports). */
// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- no runtime enum to take it from
const POSITIVE = 1 as BrushMode
// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- as above
const NEGATIVE = 2 as BrushMode

const blobUrl = (data: ArrayBuffer, type: string) =>
  URL.createObjectURL(new Blob([data], { type }))

/** Copies a MediaPipe mask out (its memory belongs to the engine) and frees it. */
function take(mask: MPMask): {
  width: number
  height: number
  data: Float32Array
} {
  const out = {
    width: mask.width,
    height: mask.height,
    data: mask.getAsFloat32Array().slice(),
  }
  mask.close()
  return out
}

const toImageData = (image: RgbaImage) =>
  new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)

/**
 * MediaPipe tap engines in a module worker, on the CPU (spec 0007 decision 6):
 * Tap v1 through `InteractiveSegmenterLegacy` (one keypoint per run), Tap v2
 * through `InteractiveSegmenter` (strokes; `setImage` once per photo).
 */
export async function createMediapipeBackend(
  engine: 'fast' | 'precise',
  files: EngineFiles,
): Promise<InferenceBackend> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new EngineUnavailable('unsupported', 'no OffscreenCanvas in workers')
  }
  // Module workers have no importScripts; MediaPipe then falls back to import().
  const scope = self as unknown as { importScripts?: unknown }
  if (typeof scope.importScripts !== 'function') {
    scope.importScripts = () => {
      throw new TypeError('module worker')
    }
  }
  const fileset: Fileset = {
    wasmLoaderPath: blobUrl(files.loaderJs, 'text/javascript'),
    wasmBinaryPath: blobUrl(files.wasm, 'application/wasm'),
  }
  const baseOptions = {
    modelAssetBuffer: new Uint8Array(files.model),
    delegate: 'CPU' as const,
  }
  const canvas = new OffscreenCanvas(1, 1)

  if (engine === 'fast') {
    const segmenter = await InteractiveSegmenterLegacy.createFromOptions(
      fileset,
      {
        baseOptions,
        outputConfidenceMasks: true,
        outputCategoryMask: false,
        canvas,
      },
    )
    let current: ImageData | undefined
    return {
      setImage(image) {
        current = toImageData(image)
      },
      run(strokes) {
        const [point] = strokes
        if (!current || !point) throw new Error('no image or tap')
        const result = segmenter.segment(current, {
          keypoint: { x: point.x, y: point.y },
        })
        const masks = result.confidenceMasks ?? []
        const foreground = masks[masks.length - 1]
        if (!foreground) throw new Error('the fast model returned no mask')
        const out = take(foreground)
        result.close()
        return out
      },
    }
  }

  const segmenter = await InteractiveSegmenter.createFromOptions(fileset, {
    baseOptions,
    canvas,
  })
  return {
    setImage(image) {
      segmenter.setImage(toImageData(image))
    },
    run(strokes: readonly Stroke[]) {
      return take(
        segmenter.segment(
          strokes.map((s) => ({
            brushMode: s.mode === 'positive' ? POSITIVE : NEGATIVE,
            point: [{ x: s.x, y: s.y }],
            isCompleted: true,
          })),
        ),
      )
    },
  }
}
