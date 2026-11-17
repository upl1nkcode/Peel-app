// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  createModelStore,
  prefetchModels,
  sha256Hex,
  type EngineUnavailable,
  type ModelFile,
  type OfflineStatus,
} from './index'

const bytes = (n: number, seed: number) =>
  Uint8Array.from({ length: n }, (_, k) => (k * 31 + seed) % 251)

/** A Response streaming `data` in 3 chunks; optionally failing after the first. */
const streamed = (data: Uint8Array, failAfterFirst = false): Response => {
  const third = Math.ceil(data.length / 3)
  let k = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (failAfterFirst && k > 0) {
          controller.error(new TypeError('network gone'))
          return
        }
        if (k * third >= data.length) {
          controller.close()
          return
        }
        controller.enqueue(data.slice(k * third, (k + 1) * third))
        k++
      },
    }),
  )
}

class FakeCache {
  readonly entries = new Map<string, ArrayBuffer>()
  failPut: Error | null = null
  /** Cached bodies read so far. */
  reads = 0
  match(key: string) {
    const v = this.entries.get(key)
    return Promise.resolve(
      v
        ? {
            arrayBuffer: () => {
              this.reads++
              return Promise.resolve(v.slice(0))
            },
          }
        : undefined,
    )
  }
  async put(key: string, res: Response) {
    if (this.failPut) throw this.failPut
    this.entries.set(key, await res.arrayBuffer())
  }
  keys() {
    return Promise.resolve(
      [...this.entries.keys()].map((k) => ({ url: `http://peel.test/${k}` })),
    )
  }
  delete(key: string | { url: string }) {
    const k =
      typeof key === 'string' ? key : key.url.replace('http://peel.test/', '')
    return Promise.resolve(this.entries.delete(k))
  }
}

function setup(
  served: Record<string, Uint8Array>,
  opts: { online?: boolean; fail?: 'reject' | 'midstream' } = {},
) {
  const cache = new FakeCache()
  const calls: string[] = []
  const fetchFn = (path: string) => {
    calls.push(path)
    if (opts.fail === 'reject') {
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    const body = served[path]
    if (!body) return Promise.resolve(new Response('missing', { status: 404 }))
    return Promise.resolve(streamed(body, opts.fail === 'midstream'))
  }
  const store = createModelStore({
    fetch: fetchFn as unknown as typeof fetch,
    caches: { open: () => Promise.resolve(cache as unknown as Cache) },
    digest: sha256Hex,
    online: () => opts.online ?? true,
  })
  return { store, cache, calls }
}

const fileOf = async (
  path: string,
  data: Uint8Array,
  parts?: { path: string; bytes: number }[],
): Promise<ModelFile> => ({
  path,
  bytes: data.length,
  sha256: await sha256Hex(data.slice().buffer),
  ...(parts ? { parts } : {}),
})

const reasonOf = async (
  env: ReturnType<typeof setup>,
  file: ModelFile,
): Promise<string> =>
  (
    (await env.store
      .get([file], () => undefined)
      .catch((e: unknown) => e)) as EngineUnavailable
  ).reason

describe('model store', () => {
  it('should_download_check_and_cache_model_files (AC-16, AC-17, AC-18)', async () => {
    const a = bytes(3000, 1)
    const whole = bytes(5000, 2)
    const fa = await fileOf('models/a.bin', a)
    const fb = await fileOf('models/b.task', whole, [
      { path: 'models/b.task.part1', bytes: 3000 },
      { path: 'models/b.task.part2', bytes: 2000 },
    ])
    const { store, cache, calls } = setup({
      'models/a.bin': a,
      'models/b.task.part1': whole.slice(0, 3000),
      'models/b.task.part2': whole.slice(3000),
    })
    expect(await store.missingBytes([fa, fb])).toBe(8000)
    const progress: [number, number][] = []
    const got = await store.get([fa, fb], (l, t) => progress.push([l, t]))
    expect(new Uint8Array(got.get('models/a.bin') as ArrayBuffer)).toEqual(a)
    expect(new Uint8Array(got.get('models/b.task') as ArrayBuffer)).toEqual(
      whole,
    )
    expect(calls).toEqual([
      'models/a.bin',
      'models/b.task.part1',
      'models/b.task.part2',
    ])
    expect(progress.every(([, t]) => t === 8000)).toBe(true)
    for (let k = 1; k < progress.length; k++) {
      expect(progress[k]?.[0]).toBeGreaterThanOrEqual(progress[k - 1]?.[0] ?? 0)
    }
    expect(progress[0]).toEqual([0, 8000])
    expect(progress.at(-1)).toEqual([8000, 8000])
    expect(progress.length).toBeGreaterThan(4)
    // Keyed by path and hash, so a changed file misses the cache.
    expect([...cache.entries.keys()]).toEqual([
      `models/a.bin?sha256=${fa.sha256}`,
      `models/b.task?sha256=${fb.sha256}`,
    ])
    expect(await store.missingBytes([fa, fb])).toBe(0)

    calls.length = 0
    const again = await store.get([fa, fb], () => undefined)
    expect(calls).toEqual([])
    expect(new Uint8Array(again.get('models/b.task') as ArrayBuffer)).toEqual(
      whole,
    )

    const wrong = {
      ...(await fileOf('models/c.bin', a)),
      sha256: '0'.repeat(64),
    }
    const bad = setup({ 'models/c.bin': a })
    expect(await reasonOf(bad, wrong)).toBe('download')
    expect(bad.cache.entries.size).toBe(0)
  })

  it('should_name_why_the_model_is_unavailable (AC-20)', async () => {
    const a = bytes(3000, 1)
    const fa = await fileOf('models/a.bin', a)

    expect(
      await reasonOf(setup({}, { online: false, fail: 'reject' }), fa),
    ).toBe('offline')
    expect(
      await reasonOf(setup({}, { online: true, fail: 'reject' }), fa),
    ).toBe('download')
    expect(await reasonOf(setup({}), fa)).toBe('download') // 404

    const mid = setup({ 'models/a.bin': a }, { fail: 'midstream' })
    expect(await reasonOf(mid, fa)).toBe('download')
    expect(mid.cache.entries.size).toBe(0)

    const full = setup({ 'models/a.bin': a })
    full.cache.failPut = new DOMException('quota', 'QuotaExceededError')
    expect(await reasonOf(full, fa)).toBe('storage')

    // Review Focus 4: a retry after a failure downloads from zero.
    full.cache.failPut = null
    full.calls.length = 0
    const progress: number[] = []
    await full.store.get([fa], (l) => progress.push(l))
    expect(full.calls).toEqual(['models/a.bin'])
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(3000)
  })

  it('should_download_again_when_a_file_changes (AC-18)', async () => {
    const v1 = bytes(3000, 1)
    const v2 = bytes(3000, 9)
    const env = setup({ 'models/a.bin': v1 })
    const f1 = await fileOf('models/a.bin', v1)
    await env.store.get([f1], () => undefined)
    // A new build serves new bytes at the same path; its manifest has the new hash.
    const store2 = createModelStore({
      fetch: ((path: string) => {
        env.calls.push(path)
        return Promise.resolve(new Response(v2.slice()))
      }) as unknown as typeof fetch,
      caches: { open: () => Promise.resolve(env.cache as unknown as Cache) },
      digest: sha256Hex,
      online: () => true,
    })
    const f2 = await fileOf('models/a.bin', v2)
    expect(await store2.missingBytes([f2])).toBe(3000)
    const got = await store2.get([f2], () => undefined)
    expect(new Uint8Array(got.get('models/a.bin') as ArrayBuffer)).toEqual(v2)
    expect(env.calls.filter((c) => c === 'models/a.bin')).toHaveLength(2)
    // Only the new version stays cached.
    expect(env.cache.entries.size).toBe(1)
    expect(await store2.missingBytes([f2])).toBe(0)
  })
})

describe('offline after the first visit (spec 0013)', () => {
  const increasing = (xs: number[]) =>
    xs.every((x, i) => i === 0 || x >= (xs[i - 1] ?? 0))

  it('should_fetch_a_file_once_for_two_callers (Review Focus 3)', async () => {
    const data = bytes(4000, 7)
    const f = await fileOf('models/fast.tflite', data)
    const env = setup({ 'models/fast.tflite': data })
    const seenA: number[] = []
    const seenB: number[] = []
    const [a, b] = await Promise.all([
      env.store.get([f], (n) => seenA.push(n)),
      env.store.get([f], (n) => seenB.push(n)),
    ])
    expect(env.calls).toEqual(['models/fast.tflite'])
    expect(new Uint8Array(a.get(f.path) as ArrayBuffer)).toEqual(data)
    expect(new Uint8Array(b.get(f.path) as ArrayBuffer)).toEqual(data)
    for (const seen of [seenA, seenB]) {
      expect(increasing(seen)).toBe(true)
      expect(seen.at(-1)).toBe(4000)
    }
    // Once cached, a third caller reads the cache.
    await env.store.get([f], () => undefined)
    expect(env.calls).toHaveLength(1)
  })

  it('should_prefetch_all_four_files_in_order (AC-18, AC-19)', async () => {
    const served = {
      'engine/loader.js': bytes(100, 1),
      'engine/engine.wasm': bytes(900, 2),
      'models/fast.tflite': bytes(500, 3),
      'models/precise.task': bytes(1500, 4),
    }
    const files = await Promise.all(
      Object.entries(served).map(([p, d]) => fileOf(p, d)),
    )
    const env = setup(served)
    const statuses: OfflineStatus[] = []
    await prefetchModels(env.store, files, { saveData: false }, (s) =>
      statuses.push(s),
    )
    expect(env.calls).toEqual(Object.keys(served))
    const percents = statuses.flatMap((s) =>
      s.kind === 'downloading' ? [s.percent] : [],
    )
    expect(percents.length).toBeGreaterThan(2)
    expect(percents.every(Number.isInteger)).toBe(true)
    expect(increasing(percents)).toBe(true)
    expect(statuses.at(-1)).toEqual({ kind: 'ready' })

    const again: OfflineStatus[] = []
    await prefetchModels(env.store, files, { saveData: false }, (s) =>
      again.push(s),
    )
    expect(again).toEqual([{ kind: 'ready' }])
    expect(env.calls).toHaveLength(4)
  })

  it('should_not_read_cached_files_on_each_start (final review I-2)', async () => {
    const served = {
      'models/fast.tflite': bytes(500, 3),
      'models/precise.task': bytes(1500, 4),
    }
    const files = await Promise.all(
      Object.entries(served).map(([p, d]) => fileOf(p, d)),
    )
    const env = setup(served)
    await prefetchModels(env.store, files, { saveData: false }, () => undefined)
    const statuses: OfflineStatus[] = []
    await prefetchModels(env.store, files, { saveData: false }, (s) =>
      statuses.push(s),
    )
    expect(statuses).toEqual([{ kind: 'ready' }])
    expect(env.cache.reads).toBe(0)
  })

  it('should_not_copy_a_download_that_auto_joins (final review I-2)', async () => {
    const data = bytes(4000, 7)
    const f = await fileOf('models/fast.tflite', data)
    const env = setup({ 'models/fast.tflite': data })
    const slices = vi.spyOn(ArrayBuffer.prototype, 'slice')
    const [, got] = await Promise.all([
      prefetchModels(env.store, [f], { saveData: false }, () => undefined),
      env.store.get([f], () => undefined),
    ])
    expect(env.calls).toEqual(['models/fast.tflite'])
    expect(new Uint8Array(got.get(f.path) as ArrayBuffer)).toEqual(data)
    expect(slices).not.toHaveBeenCalled()
    slices.mockRestore()
  })

  it('should_skip_the_download_on_save_data (AC-18, Decision 13)', async () => {
    const data = bytes(10, 1)
    const env = setup({ 'models/fast.tflite': data })
    const statuses: OfflineStatus[] = []
    await prefetchModels(
      env.store,
      [await fileOf('models/fast.tflite', data)],
      { saveData: true },
      (s) => statuses.push(s),
    )
    expect(env.calls).toEqual([])
    expect(statuses).toEqual([{ kind: 'needsInternet' }])
  })

  it('should_report_a_failure_once (AC-18, AC-19)', async () => {
    const data = bytes(10, 1)
    const env = setup({ 'models/fast.tflite': data }, { fail: 'reject' })
    const statuses: OfflineStatus[] = []
    await prefetchModels(
      env.store,
      [await fileOf('models/fast.tflite', data)],
      { saveData: false },
      (s) => statuses.push(s),
    )
    expect(env.calls).toHaveLength(1)
    expect(statuses.at(-1)).toEqual({ kind: 'needsInternet' })
    expect(statuses.filter((s) => s.kind === 'needsInternet')).toHaveLength(1)
  })
})
