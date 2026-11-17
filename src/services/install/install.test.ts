import { describe, expect, it, vi } from 'vitest'
import { captureInstallPrompt, isInstalled } from './install'

const media = (matches: boolean) => () => ({ matches })

/** A `beforeinstallprompt` event as Chrome fires it. */
function promptEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  const prompt = vi.fn(() => Promise.resolve())
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  })
  return { event, prompt }
}

describe('install (spec 0013)', () => {
  it('should_hide_install_when_running_installed (AC-14)', () => {
    expect(isInstalled({ matchMedia: media(true) })).toBe(true)
    expect(
      isInstalled({
        matchMedia: media(false),
        navigator: { standalone: true },
      }),
    ).toBe(true)
    expect(isInstalled({ matchMedia: media(false), navigator: {} })).toBe(false)
    expect(isInstalled({})).toBe(false)
  })

  it('should_keep_and_use_the_install_prompt_once (AC-15)', async () => {
    const target = new EventTarget()
    const install = captureInstallPrompt(target)
    const changed = vi.fn()
    install.onChange(changed)
    expect(install.available()).toBe(false)

    const { event, prompt } = promptEvent('accepted')
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(install.available()).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)

    await expect(install.prompt()).resolves.toBe('accepted')
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(install.available()).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
    await expect(install.prompt()).rejects.toThrow()
  })

  it('should_hide_after_the_app_is_installed (AC-15)', () => {
    const target = new EventTarget()
    const install = captureInstallPrompt(target)
    target.dispatchEvent(promptEvent('dismissed').event)
    expect(install.available()).toBe(true)
    target.dispatchEvent(new Event('appinstalled'))
    expect(install.available()).toBe(false)
  })

  it('should_stop_telling_a_listener_that_left (AC-15)', () => {
    const target = new EventTarget()
    const install = captureInstallPrompt(target)
    const changed = vi.fn()
    const stop = install.onChange(changed)
    stop()
    target.dispatchEvent(promptEvent('dismissed').event)
    expect(changed).not.toHaveBeenCalled()
  })
})
