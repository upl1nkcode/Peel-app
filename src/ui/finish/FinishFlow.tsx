import type { Selection } from '../../core/selection/types'
import type { FinishSettings } from '../../core/sticker'
import type { Renderer } from '../editor/session'
import { useState } from 'react'
import { canShareType } from '../../services/export'
import { AddStickerGuide } from './AddStickerGuide'
import { isAppleTouch } from './device'
import { ExportActions } from './ExportActions'
import { FinishScreen, type FinishScreenProps } from './FinishScreen'
import { useFinishOutput } from './useFinishOutput'

export interface FinishFlowProps {
  renderer: Renderer | null
  photoId: string
  selection: Selection
  settings: FinishSettings
  onSettings: (settings: FinishSettings) => void
  onFeather: (px: number) => void
  save: FinishScreenProps['save']
  onBack: () => void
  /** Open the iPhone guide: the first Finish screen of a session (AC-18). */
  guideOpen: boolean
}

/**
 * The Finish screen with its output (spec 0012). Mounted only while the
 * screen shows, so a result that lands after "Back" has nowhere to go
 * (Review Focus 5).
 */
export function FinishFlow(props: FinishFlowProps) {
  // The device and Share support don't change while the screen shows.
  const [guide] = useState(() => ({
    apple: isAppleTouch(navigator.userAgent, navigator.maxTouchPoints),
    shareShown: canShareType(navigator, 'image/png'),
  }))
  const output = useFinishOutput(
    props.renderer,
    props.photoId,
    props.selection,
    props.settings,
  )
  return (
    <FinishScreen
      settings={props.settings}
      onSettings={props.onSettings}
      feather={props.selection.feather}
      onFeather={props.onFeather}
      output={output}
      save={props.save}
      onBack={props.onBack}
      actions={
        <ExportActions
          file={output.file}
          preparing={output.preparing}
          settings={props.settings}
          selection={props.selection}
        />
      }
      guide={
        guide.apple ? (
          <AddStickerGuide
            shareShown={guide.shareShown}
            initiallyOpen={props.guideOpen}
          />
        ) : null
      }
    />
  )
}
