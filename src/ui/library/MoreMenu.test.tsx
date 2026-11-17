import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { InstallPrompt } from '../../services/install'
import type { OfflineStatus } from '../../services/segmentation'
import type { UpdateWatch } from '../../services/update'
import { en, I18nProvider, type LangChoice } from '../i18n'
import { InstallCard } from './InstallCard'
import { InstallGuide } from './InstallGuide'
import { installOffer } from './installOffer'
import { MoreMenu, type MoreMenuProps } from './MoreMenu'
import { UpdateBar } from './UpdateBar'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'

function menuProps(over: Partial<MoreMenuProps> = {}): MoreMenuProps {
  return {
    canExportAll: true,
    canImport: true,
    onExportAll: vi.fn(),
    onImport: vi.fn(),
    choice: 'auto',
    onChoice: vi.fn(),
    install: { kind: 'guide', open: vi.fn() },
    storageLine: 'Stickers are saved on this device.',
    offline: { kind: 'downloading', percent: 42 },
    ...over,
  }
}

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: 'More' }))
  return screen.getByRole('menu')
}

const fakePrompt = (available: boolean) => {
  const shown = vi.fn(() => Promise.resolve('accepted' as const))
  const prompt: InstallPrompt = {
    available: () => available,
    prompt: shown,
    onChange: () => () => undefined,
  }
  return Object.assign(prompt, { shown })
}

describe('More menu (spec 0013)', () => {
  it('should_list_the_menu_in_order (AC-13)', () => {
    const install = vi.fn()
    const props = menuProps({
      canExportAll: false,
      install: { kind: 'guide', open: install },
    })
    render(<MoreMenu {...props} />)
    const menu = openMenu()
    const names = [
      ...menu.querySelectorAll(
        ':scope > [role=menuitem], :scope > [role=group]',
      ),
    ].map((el) => el.getAttribute('aria-label') ?? el.textContent)
    expect(names).toEqual(['Export all', 'Import', 'Language', 'Install Peel'])
    const lines = menu.querySelectorAll('.menu-status')
    expect([...lines].map((l) => l.textContent)).toEqual([
      'Stickers are saved on this device.',
      'Downloading for offline use… 42%',
    ])
    expect(
      within(menu).getByRole('menuitem', { name: 'Export all' }),
    ).toBeDisabled()

    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    openMenu()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Install Peel' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('should_export_and_import_from_the_menu (AC-13)', () => {
    const props = menuProps()
    render(<MoreMenu {...props} />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export all' }))
    expect(props.onExportAll).toHaveBeenCalledTimes(1)
    const input = screen.getByLabelText('Import')
    expect(input).toHaveAttribute('accept', '.zip,application/zip')
    const click = vi.spyOn(input, 'click')
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import' }))
    expect(click).toHaveBeenCalledTimes(1)
    const file = new File(['z'], 'b.zip', { type: 'application/zip' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(props.onImport).toHaveBeenCalledWith(file)
  })

  it('should_hide_install_when_there_is_no_offer (AC-14)', () => {
    render(<MoreMenu {...menuProps({ install: null, offline: null })} />)
    const menu = openMenu()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Install Peel' }),
    ).toBeNull()
    expect(menu.querySelectorAll('.menu-status')).toHaveLength(1)
  })

  it('should_switch_language_at_once (AC-24)', () => {
    function Harness() {
      const [choice, setChoice] = useState<LangChoice>('en')
      return (
        <I18nProvider lang={choice === 'ro' ? 'ro' : 'en'}>
          <MoreMenu {...menuProps({ choice, onChoice: setChoice })} />
        </I18nProvider>
      )
    }
    render(<Harness />)
    const menu = openMenu()
    const exportItem = within(menu).getByRole('menuitem', {
      name: 'Export all',
    })
    expect(
      within(menu).getByRole('menuitemradio', { name: 'English' }),
    ).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Română' }))
    expect(exportItem).toHaveTextContent('Exportă tot')
    expect(exportItem.isConnected).toBe(true)
    expect(document.documentElement.lang).toBe('ro')
    expect(
      within(menu).getByRole('menuitemradio', { name: 'Română' }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      within(menu).getByRole('menuitemradio', { name: 'English' }),
    ).toBeVisible()
    fireEvent.click(
      within(menu).getByRole('menuitemradio', { name: 'English' }),
    )
    expect(exportItem).toHaveTextContent('Export all')
    expect(document.documentElement.lang).toBe('en')
  })

  it('should_show_offline_progress (AC-19)', () => {
    const lines: [OfflineStatus, string][] = [
      [
        { kind: 'downloading', percent: 42 },
        'Downloading for offline use… 42%',
      ],
      [{ kind: 'ready' }, 'Ready to use offline.'],
      [{ kind: 'needsInternet' }, 'Auto needs the internet the first time.'],
    ]
    for (const [offline, text] of lines) {
      const { unmount } = render(<MoreMenu {...menuProps({ offline })} />)
      expect(openMenu()).toHaveTextContent(text)
      unmount()
    }
  })
})

describe('install help (spec 0013)', () => {
  it('should_offer_install_by_platform (AC-14 to AC-16)', async () => {
    const onGuide = vi.fn()
    const browser = { matchMedia: () => ({ matches: false }), navigator: {} }
    expect(
      installOffer(
        {
          ...browser,
          matchMedia: () => ({ matches: true }),
          ua: IPHONE,
          maxTouchPoints: 5,
        },
        fakePrompt(true),
        onGuide,
      ),
    ).toBeNull()

    const prompt = fakePrompt(true)
    const viaPrompt = installOffer(
      { ...browser, ua: FIREFOX, maxTouchPoints: 0 },
      prompt,
      onGuide,
    )
    expect(viaPrompt?.kind).toBe('prompt')
    await act(async () => {
      viaPrompt?.open()
      await Promise.resolve()
    })
    expect(prompt.shown).toHaveBeenCalledTimes(1)

    const viaGuide = installOffer(
      { ...browser, ua: IPHONE, maxTouchPoints: 5 },
      fakePrompt(false),
      onGuide,
    )
    expect(viaGuide?.kind).toBe('guide')
    viaGuide?.open()
    expect(onGuide).toHaveBeenCalledTimes(1)

    expect(
      installOffer(
        { ...browser, ua: FIREFOX, maxTouchPoints: 0 },
        fakePrompt(false),
        onGuide,
      ),
    ).toBeNull()
  })

  it('should_show_the_iphone_guide_text (AC-16)', () => {
    const onClose = vi.fn()
    render(<InstallGuide onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Install Peel' })
    const steps = within(dialog).getAllByRole('listitem')
    expect(steps.map((s) => s.textContent)).toEqual(
      [en['install.step1'], en['install.step2'], en['install.step3']].map((s) =>
        s.replaceAll('**', ''),
      ),
    )
    expect(within(steps[0] as HTMLElement).getByText('Share').tagName).toBe(
      'STRONG',
    )
    expect(dialog).toHaveTextContent(en['install.after'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should_show_the_install_card_until_closed (AC-17)', () => {
    const open = vi.fn()
    const onClose = vi.fn()
    const offer = { kind: 'guide' as const, open }
    const { rerender } = render(
      <InstallCard offer={offer} stickers={1} onClose={onClose} />,
    )
    expect(screen.getByText(en['install.card'])).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(open).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<InstallCard offer={offer} stickers={0} onClose={onClose} />)
    expect(screen.queryByText(en['install.card'])).toBeNull()
    rerender(<InstallCard offer={null} stickers={3} onClose={onClose} />)
    expect(screen.queryByText(en['install.card'])).toBeNull()
  })
})

describe('update bar (spec 0013)', () => {
  it('should_show_reload_when_a_version_waits (AC-22, AC-23)', () => {
    let ready = false
    const listeners = new Set<() => void>()
    const reload = vi.fn(() => Promise.resolve())
    const watch: UpdateWatch = {
      ready: () => ready,
      reload,
      onChange: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    }
    render(<UpdateBar watch={watch} />)
    expect(screen.queryByText('A new version of Peel is ready.')).toBeNull()
    act(() => {
      ready = true
      for (const cb of listeners) cb()
    })
    expect(screen.getByText('A new version of Peel is ready.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
