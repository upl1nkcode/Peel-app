/** `registerSW` from `virtual:pwa-register`, as far as this needs it. */
export type RegisterSW = (options: {
  immediate?: boolean
  onNeedRefresh: () => void
}) => (reloadPage?: boolean) => Promise<void>

export interface UpdateWatch {
  /** A new version is installed and waiting (AC-22). */
  ready(): boolean
  /** Lets the waiting version take over and reloads once (AC-23). */
  reload(): Promise<void>
  /** Calls `cb` when `ready()` changes; returns a stop. */
  onChange(cb: () => void): () => void
}

/** Registers the service worker in "prompt" mode and tells when a new version waits. */
export function watchForUpdate(register: RegisterSW): UpdateWatch {
  let waiting = false
  const listeners = new Set<() => void>()
  const update = register({
    immediate: true,
    onNeedRefresh() {
      waiting = true
      for (const cb of listeners) cb()
    },
  })
  return {
    ready: () => waiting,
    reload: () => update(true),
    onChange(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}
