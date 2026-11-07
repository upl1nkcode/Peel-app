// @vitest-environment node
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import {
  openStickerStore,
  persistenceStatus,
  requestPersistence,
  STORAGE_STATUS_TEXT,
} from './index'

describe('persistent storage', () => {
  it('should_ask_once_ever (AC-13)', async () => {
    const factory = new IDBFactory()
    const persist = vi.fn(() => Promise.resolve(true))
    const first = await openStickerStore(factory)
    await requestPersistence({ persist }, first)
    await requestPersistence({ persist }, first)
    first.close()

    const reopened = await openStickerStore(factory)
    await requestPersistence({ persist }, reopened)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(await reopened.getMeta('persistRequested')).toBe(true)
    reopened.close()
  })

  it('should_ask_only_once_while_a_prompt_is_open (AC-13)', async () => {
    const store = await openStickerStore(new IDBFactory())
    let answer: (v: boolean) => void = () => undefined
    const persist = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve
        }),
    )
    const a = requestPersistence({ persist }, store)
    await vi.waitFor(() => {
      expect(persist).toHaveBeenCalledTimes(1)
    })
    await requestPersistence({ persist }, store)
    answer(false)
    await a
    expect(persist).toHaveBeenCalledTimes(1)
    store.close()
  })

  it('should_do_nothing_without_the_api (AC-13)', async () => {
    const store = await openStickerStore(new IDBFactory())
    await expect(requestPersistence(undefined, store)).resolves.toBeUndefined()
    await expect(requestPersistence({}, store)).resolves.toBeUndefined()
    expect(await store.getMeta('persistRequested')).toBeUndefined()
    store.close()
  })

  it('should_survive_a_rejected_request (AC-13)', async () => {
    const store = await openStickerStore(new IDBFactory())
    const persist = vi.fn(() => Promise.reject(new Error('denied')))
    await expect(
      requestPersistence({ persist }, store),
    ).resolves.toBeUndefined()
    expect(await store.getMeta('persistRequested')).toBe(true)
    store.close()
  })

  it('should_show_the_storage_status (AC-14)', async () => {
    expect(
      await persistenceStatus({ persisted: () => Promise.resolve(true) }),
    ).toBe('persisted')
    expect(
      await persistenceStatus({ persisted: () => Promise.resolve(false) }),
    ).toBe('atRisk')
    expect(await persistenceStatus({})).toBe('atRisk')
    expect(await persistenceStatus(undefined)).toBe('atRisk')
    expect(
      await persistenceStatus({
        persisted: () => Promise.reject(new Error('no')),
      }),
    ).toBe('atRisk')
    expect(STORAGE_STATUS_TEXT).toEqual({
      persisted: 'Stickers are kept on this device.',
      atRisk:
        "Your browser may clear stickers if Peel isn't used for a while. Add Peel to your Home Screen, or export a backup.",
    })
  })
})
