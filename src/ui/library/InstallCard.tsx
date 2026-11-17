import { useT } from '../i18n'
import type { InstallOffer } from './installOffer'

export interface InstallCardProps {
  /** `null` hides the card: installed, or this browser can't install. */
  offer: InstallOffer | null
  /** How many stickers are saved; the card waits for the first one. */
  stickers: number
  /** Closed for good (the caller remembers it). */
  onClose: () => void
}

/**
 * Above the grid once there's a sticker to lose (spec 0013 AC-17): installing
 * keeps the browser from clearing Peel's data.
 */
export function InstallCard(props: InstallCardProps) {
  const t = useT()
  const { offer } = props
  if (!offer || props.stickers === 0) return null
  return (
    <aside className="install-card">
      <p>{t('install.card')}</p>
      <div className="install-card-actions">
        <button type="button" className="install-card-go" onClick={offer.open}>
          {t('install.cardInstall')}
        </button>
        <button
          type="button"
          className="install-card-close"
          aria-label={t('common.close')}
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
    </aside>
  )
}
