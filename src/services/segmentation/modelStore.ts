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
  /**
   * Downloads the files not cached yet, as `get` does, without reading the
   * cached ones or keeping any bytes (spec 0013 AC-18, final review I-2).
   */
  ensure(
    files: readonly ModelFile[],
    onProgress: (loadedBytes: number, totalBytes: number) => void,
  ): Promise<void>
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
}

const isQuota = (e: unknown) =>
  e instanceof DOMException && e.name === 'QuotaExceededError'

export function createModelStore(deps: ModelStoreDeps): ModelStore {
  const open = () => deps.caches.open(MODEL_CACHE_NAME)

  /**
   * Cache entries are keyed by path and hash, so a file whose bytes change
   * (a model or engine update) misses the cache and is downloaded again.
   */
  const keyOf = (file: ModelFile) => `${file.path}?sha256=${file.sha256}`

  const cached = async (cache: Cache, file: ModelFile) => {
    const hit = await cache.match(keyOf(file))
    return hit ? hit.arrayBuffer() : undefined
  }

  /** Drops older versions of `file` (same path, other hash). */
  const dropStale = async (cache: Cache, file: ModelFile) => {
    const path = file.path.replace(/^\//, '')
    for (const req of await cache.keys()) {
      const url = new URL(req.url)
      const stale =
        url.pathname.replace(/^\//, '') === path &&
        url.searchParams.get('sha256') !== file.sha256
      if (stale) await cache.delete(req)
    }
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

  /** One download per file at a time; other callers join it (spec 0013 Review Focus 3). */
  interface Flight {
    promise: Promise<ArrayBuffer>
    /** Bytes of this file downloaded so far. */
    loaded: number
    listeners: Set<(loaded: number) => void>
    /** Callers of `get` waiting for the bytes (`ensure` takes none). */
    users: number
  }
  const flights = new Map<string, Flight>()

  /** Downloads, checks and caches `file`, or joins its download already running. */
  const download = (cache: Cache, file: ModelFile): Flight => {
    const key = keyOf(file)
    const running = flights.get(key)
    if (running) return running
    const flight: Flight = {
      promise: Promise.resolve(new ArrayBuffer(0)),
      loaded: 0,
      listeners: new Set(),
      users: 0,
    }
    const run = async (): Promise<ArrayBuffer> => {
      const data = new Uint8Array(file.bytes)
      const parts = file.parts ?? [{ path: file.path, bytes: file.bytes }]
      let offset = 0
      try {
        for (const part of parts) {
          const got = await fetchInto(part.path, data, offset, (n) => {
            flight.loaded += n
            for (const l of flight.listeners) l(flight.loaded)
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
        await cache.put(keyOf(file), new Response(data.slice().buffer))
      } catch (e) {
        if (isQuota(e)) throw new EngineUnavailable('storage', file.path)
        throw e
      }
      await dropStale(cache, file)
      return data.buffer
    }
    flight.promise = run().finally(() => {
      flights.delete(key)
    })
    flights.set(key, flight)
    return flight
  }

  /**
   * Downloads `missing` in order, or joins their downloads, reporting this
   * call's bytes; `take` collects each file's bytes into `out`.
   */
  const fetchMissing = async (
    cache: Cache,
    missing: readonly ModelFile[],
    onProgress: (loadedBytes: number, totalBytes: number) => void,
    out: Map<string, ArrayBuffer> | null,
  ) => {
    const total = missing.reduce((n, f) => n + f.bytes, 0)
    const perFile = new Map<string, number>()
    let loaded = 0
    if (missing.length > 0) onProgress(0, total)
    for (const file of missing) {
      const flight = download(cache, file)
      if (out) flight.users++
      const listener = (n: number) => {
        loaded += n - (perFile.get(file.path) ?? 0)
        perFile.set(file.path, n)
        onProgress(loaded, total)
      }
      flight.listeners.add(listener)
      if (flight.loaded > 0) listener(flight.loaded)
      try {
        const buffer = await flight.promise
        // A shared download gives each caller its own copy: a caller may
        // transfer its buffer to a worker, detaching it (spec 0013).
        out?.set(file.path, flight.users > 1 ? buffer.slice(0) : buffer)
      } finally {
        flight.listeners.delete(listener)
      }
    }
  }

  return {
    async missingBytes(files) {
      const cache = await open()
      let total = 0
      for (const file of files) {
        if (!(await cache.match(keyOf(file)))) total += file.bytes
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
      await fetchMissing(cache, missing, onProgress, out)
      return out
    },

    async ensure(files, onProgress) {
      const cache = await open()
      const missing: ModelFile[] = []
      for (const file of files) {
        if (!(await cache.match(keyOf(file)))) missing.push(file)
      }
      await fetchMissing(cache, missing, onProgress, null)
    },
  }
}
