import type { AlphaMask, RgbaImage } from '../../core/mask'
import type { Tap } from '../../core/segmentation'
import type { Selection } from '../../core/selection/types'

/** A file the app downloads, checks and caches (spec 0007 contract). */
export interface ModelFile {
  /** Site-relative path, also the Cache Storage key. */
  path: string
  bytes: number
  /** Lowercase hex SHA-256 of the whole file. */
  sha256: string
  /** Set when the file is served in parts (Pages' 25 MiB limit); joined in order. */
  parts?: { path: string; bytes: number }[]
}

/** `models/manifest.json`, written at build time. */
export interface ModelManifest {
  files: Record<'engineLoader' | 'engineWasm' | 'fast' | 'precise', ModelFile>
}

export type UnavailableReason =
  'offline' | 'download' | 'storage' | 'unsupported'

/** The engine cannot run; `reason` picks the message (spec 0007 AC-20). */
export class EngineUnavailable extends Error {
  override name = 'EngineUnavailable'
  readonly reason: UnavailableReason

  constructor(reason: UnavailableReason, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason)
    this.reason = reason
  }
}

/** An auto result at the photo's full size: its alpha and the selection traced from it. */
export interface AutoResult {
  alpha: AlphaMask
  /** `null` when nothing was found (no pixel reaches 50%). */
  selection: Selection | null
}

/** A tap segmenter (spec 0007 contract). Fakes implement it for every UI and controller test. */
export interface SegmentationEngine {
  readonly name: 'fast' | 'precise'
  /** The files `load` needs, so the bytes still to download are known before the first byte. */
  readonly files: readonly ModelFile[]
  /** Rejects with `EngineUnavailable`. */
  load(
    onProgress: (loadedBytes: number, totalBytes: number) => void,
  ): Promise<void>
  setImage(imageId: string, image: RgbaImage): Promise<void>
  segment(imageId: string, taps: readonly Tap[]): Promise<AutoResult>
}

/** A segment request replaced by a newer one before it ran; its result is never applied. */
export class SegmentCancelled extends Error {
  override name = 'SegmentCancelled'
}
