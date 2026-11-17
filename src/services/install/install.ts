/** What `isInstalled` reads; each part may be missing. */
export interface InstallEnv {
  matchMedia?: (query: string) => { matches: boolean }
  navigator?: { standalone?: boolean }
}

/** AC-14: Peel runs from the Home Screen (any browser), or as an iPhone web app. */
export function isInstalled(env: InstallEnv): boolean {
  if (env.matchMedia?.('(display-mode: standalone)').matches) return true
  return env.navigator?.standalone === true
}

/** Chrome's `beforeinstallprompt` event; not in TypeScript's DOM types. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface InstallPrompt {
  /** A kept prompt can be shown. */
  available(): boolean
  /** Shows the kept prompt once; rejects when none is kept. */
  prompt(): Promise<'accepted' | 'dismissed'>
  /** Calls `cb` whenever `available()` may have changed; returns a stop. */
  onChange(cb: () => void): () => void
}

/**
 * AC-15: keeps Chrome's install prompt (preventing its own mini bar) so the
 * "Install Peel" button can show it. After it's used, or the app is
 * installed, nothing is available.
 */
export function captureInstallPrompt(target: EventTarget): InstallPrompt {
  let kept: BeforeInstallPromptEvent | null = null
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const cb of listeners) cb()
  }
  target.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    kept = e as BeforeInstallPromptEvent
    changed()
  })
  target.addEventListener('appinstalled', () => {
    kept = null
    changed()
  })
  return {
    available: () => kept !== null,
    async prompt() {
      const event = kept
      if (!event) throw new Error('no install prompt is available')
      kept = null
      await event.prompt()
      const { outcome } = await event.userChoice
      changed()
      return outcome
    },
    onChange(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}
