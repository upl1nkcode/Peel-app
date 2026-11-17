import { useId, useState } from 'react'

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
  const [open, setOpen] = useState(props.initiallyOpen)
  const id = useId()
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
        How to add to iPhone Stickers
      </button>
      <div id={id} hidden={!open}>
        {open && (
          <>
            <ol>
              {props.shareShown ? (
                <>
                  <li>
                    Choose <strong>Sticker</strong>, then tap{' '}
                    <strong>Share</strong>.
                  </li>
                  <li>
                    Tap <strong>Save Image</strong>.
                  </li>
                </>
              ) : (
                <>
                  <li>
                    Choose <strong>Sticker</strong>, then tap{' '}
                    <strong>Download</strong>.
                  </li>
                  <li>
                    Open the download and tap <strong>Share</strong>, then{' '}
                    <strong>Save Image</strong>.
                  </li>
                </>
              )}
              <li>
                Open <strong>Photos</strong> and open the image.
              </li>
              <li>Touch and hold the sticker until it lifts, then let go.</li>
              <li>
                Tap <strong>Add Sticker</strong>.
              </li>
            </ol>
            <p>
              Your sticker is now in the stickers of Messages and the keyboard.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
