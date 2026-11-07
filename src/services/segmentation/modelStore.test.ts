// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  createModelStore,
  sha256Hex,
  type EngineUnavailable,
  type ModelFile,
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
  match(key: string) {
    const v = this.entries.get(key)
    return Promise.resolve(v ? new Response(v.slice(0)) : undefined)
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
