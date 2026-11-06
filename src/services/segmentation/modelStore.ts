import { EngineUnavailable, type ModelFile } from './types'

/** Engine and model files live here; a model update changes the name (spec 0007 "Data"). */
export const MODEL_CACHE_NAME = 'peel-models-v1'

export interface ModelStoreDeps {
  fetch: typeof fetch
  caches: Pick<CacheStorage, 'open'>
  /** Lowercase hex SHA-256. */
  digest: (data: ArrayBuffer) => Promise<string>
  online: () => boolean
}

export interface ModelStore {
  /** Bytes of the files not cached yet. */
  missingBytes(files: readonly ModelFile[]): Promise<number>
  /**
   * Every file's bytes, by path: cached ones are read, the rest downloaded in
   * order, checked against their SHA-256 and cached whole. `onProgress`
   * counts the downloaded bytes of this call, from 0 to their total. Rejects
   * with `EngineUnavailable`; nothing partial is cached.
   */
  get(
    files: readonly ModelFile[],
    onProgress: (loadedBytes: number, totalBytes: number) => void,
  ): Promise<Map<string, ArrayBuffer>>
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
}

const isQuota = (e: unknown) =>
  e instanceof DOMException && e.name === 'QuotaExceededError'

export function createModelStore(deps: ModelStoreDeps): ModelStore {
  const open = () => deps.caches.open(MODEL_CACHE_NAME)

  const cached = async (cache: Cache, file: ModelFile) => {
    const hit = await cache.match(file.path)
    return hit ? hit.arrayBuffer() : undefined
  }

  const networkError = (e: unknown): EngineUnavailable =>
    e instanceof EngineUnavailable
      ? e
      : new EngineUnavailable(
          deps.online() ? 'download' : 'offline',
          e instanceof Error ? e.message : String(e),
        )

  /** Streams one URL into `into` at `offset`, reporting each chunk. */
  const fetchInto = async (
    path: string,
    into: Uint8Array,
    offset: number,
    onChunk: (n: number) => void,
  ): Promise<number> => {
    const res = await deps.fetch(path)
    if (!res.ok || !res.body) {
      throw new EngineUnavailable(
        'download',
        `${path}: HTTP ${String(res.status)}`,
      )
    }
    const reader = res.body.getReader()
    let at = offset
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (at + value.length > into.length) {
        throw new EngineUnavailable(
          'download',
          `${path} is larger than expected`,
        )
      }
      into.set(value, at)
      at += value.length
      onChunk(value.length)
    }
    return at - offset
  }

  return {
    async missingBytes(files) {
      const cache = await open()
      let total = 0
      for (const file of files) {
        if (!(await cache.match(file.path))) total += file.bytes
      }
      return total
    },

    async get(files, onProgress) {
      const cache = await open()
      const out = new Map<string, ArrayBuffer>()
      const missing: ModelFile[] = []
      for (const file of files) {
        const hit = await cached(cache, file)
        if (hit) out.set(file.path, hit)
        else missing.push(file)
      }
      const total = missing.reduce((n, f) => n + f.bytes, 0)
      let loaded = 0
      if (missing.length > 0) onProgress(0, total)
      for (const file of missing) {
        const data = new Uint8Array(file.bytes)
        const parts = file.parts ?? [{ path: file.path, bytes: file.bytes }]
        let offset = 0
        try {
          for (const part of parts) {
            const got = await fetchInto(part.path, data, offset, (n) => {
              loaded += n
              onProgress(loaded, total)
            })
            if (got !== part.bytes) {
              throw new EngineUnavailable(
                'download',
                `${part.path}: got ${String(got)} of ${String(part.bytes)} bytes`,
              )
            }
            offset += got
          }
        } catch (e) {
          throw networkError(e)
        }
        if ((await deps.digest(data.buffer)) !== file.sha256) {
          throw new EngineUnavailable(
            'download',
            `${file.path}: checksum mismatch`,
          )
        }
        try {
          await cache.put(file.path, new Response(data.slice().buffer))
        } catch (e) {
          if (isQuota(e)) throw new EngineUnavailable('storage', file.path)
          throw e
        }
        out.set(file.path, data.buffer)
      }
      return out
    },
  }
}
