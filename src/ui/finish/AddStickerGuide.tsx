import { useId, useState } from 'react'
import { Rich, useT } from '../i18n'

export interface AddStickerGuideProps {
  /** Share is offered for the Sticker output (AC-14); otherwise the steps use Download. */
  shareShown: boolean
  initiallyOpen: boolean
}

/**
 * How to make a Peel sticker an iPhone sticker (spec 0012 AC-18, AC-19): a
 * web app can't add it to the system's Stickers, but Photos can.
 */
export function AddStickerGuide(props: AddStickerGuideProps) {
  const t = useT()
  const [open, setOpen] = useState(props.initiallyOpen)
  const id = useId()
  const steps = [
    ...(props.shareShown
      ? (['guide.share1', 'guide.share2'] as const)
      : (['guide.download1', 'guide.download2'] as const)),
    'guide.step3',
    'guide.step4',
    'guide.step5',
  ] as const
  return (
    <div className="finish-guide">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((o) => !o)
        }}
      >
        {t('guide.toggle')}
      </button>
      <div id={id} hidden={!open}>
        {open && (
          <>
            <ol>
              {steps.map((key) => (
                <li key={key}>
                  <Rich text={t(key)} />
                </li>
              ))}
            </ol>
            <p>{t('guide.after')}</p>
          </>
        )}
      </div>
    </div>
  )
}
