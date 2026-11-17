import { describe, expect, it, vi } from 'vitest'
import { watchForUpdate } from './update'

describe('update (spec 0013)', () => {
  it('should_offer_reload_when_a_version_waits (AC-22, AC-23)', async () => {
    let needRefresh: () => void = () => {
      throw new Error('not registered')
    }
    const reload = vi.fn<(reloadPage?: boolean) => Promise<void>>(() =>
      Promise.resolve(),
    )
    const watch = watchForUpdate((opts) => {
      needRefresh = opts.onNeedRefresh
      return reload
    })
    const changed = vi.fn()
    watch.onChange(changed)
    expect(watch.ready()).toBe(false)

    needRefresh()
    expect(watch.ready()).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)

    await watch.reload()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledWith(true)
  })
})
