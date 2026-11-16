import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AddStickerGuide } from './AddStickerGuide'
import { isAppleTouch } from './device'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1'
const IPAD_OLD =
  'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const IPOD =
  'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const steps = () => screen.getAllByRole('listitem').map((li) => li.textContent)

describe('iPhone "Add to Stickers" guide (spec 0012)', () => {
  it('should_detect_iphone_and_ipad (AC-18)', () => {
    expect(isAppleTouch(IPHONE, 5)).toBe(true)
    expect(isAppleTouch(IPAD_OLD, 5)).toBe(true)
    expect(isAppleTouch(IPOD, 5)).toBe(true)
    // iPadOS asks for the desktop site: a Mac user agent with touch.
    expect(isAppleTouch(MAC, 5)).toBe(true)
    expect(isAppleTouch(MAC, 0)).toBe(false)
    expect(isAppleTouch(MAC, 1)).toBe(false)
    expect(isAppleTouch(ANDROID, 5)).toBe(false)
    expect(isAppleTouch(WINDOWS, 10)).toBe(false)
  })

  it('should_say_the_steps (AC-19)', () => {
    render(<AddStickerGuide shareShown initiallyOpen />)
    expect(
      screen.getByRole('button', { name: 'How to add to iPhone Stickers' }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(steps()).toEqual([
      'Choose Sticker, then tap Share.',
      'Tap Save Image.',
      'Open Photos and open the image.',
      'Touch and hold the sticker until it lifts, then let go.',
      'Tap Add Sticker.',
    ])
    expect(
      screen.getByText(
        'Your sticker is now in the stickers of Messages and the keyboard.',
      ),
    ).toBeVisible()
    // The named things are bold.
    expect(screen.getByText('Save Image').tagName).toBe('STRONG')
  })

  it('should_use_download_steps_without_share (AC-19)', () => {
    render(<AddStickerGuide shareShown={false} initiallyOpen />)
    expect(steps().slice(0, 2)).toEqual([
      'Choose Sticker, then tap Download.',
      'Open the download and tap Share, then Save Image.',
    ])
  })

  it('should_open_and_close_with_its_button (AC-18)', () => {
    render(<AddStickerGuide shareShown initiallyOpen={false} />)
    const toggle = screen.getByRole('button', {
      name: 'How to add to iPhone Stickers',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('list')
    expect(toggle.getAttribute('aria-controls')).toBe(list.parentElement?.id)
    fireEvent.click(toggle)
    expect(screen.queryByRole('list')).toBeNull()
  })
})
