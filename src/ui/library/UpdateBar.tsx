import { useCallback, useState, useSyncExternalStore } from 'react'
import type { UpdateWatch } from '../../services/update'
import { useT } from '../i18n'

/**
 * Shown on the Library when a new version waits (spec 0013 AC-22); Reload
 * lets it take over (AC-23). Never shown in the editor, so work isn't lost.
 */
export function UpdateBar(props: { watch: UpdateWatch }) {
  const t = useT()
  const { watch } = props
  const subscribe = useCallback((cb: () => void) => watch.onChange(cb), [watch])
  const ready = useSyncExternalStore(subscribe, () => watch.ready())
  const [reloading, setReloading] = useState(false)
  if (!ready) return null
  return (
    <div className="update-bar" role="status">
      <p>{t('update.ready')}</p>
      <button
        type="button"
        disabled={reloading}
        onClick={() => {
          setReloading(true)
          void watch.reload()
        }}
      >
        {t('update.reload')}
      </button>
    </div>
  )
}
