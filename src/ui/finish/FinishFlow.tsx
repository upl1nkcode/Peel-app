import type { Selection } from '../../core/selection/types'
import type { FinishSettings } from '../../core/sticker'
import type { Renderer } from '../editor/session'
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
}

/**
 * The Finish screen with its output (spec 0012). Mounted only while the
 * screen shows, so a result that lands after "Back" has nowhere to go
 * (Review Focus 5).
 */
export function FinishFlow(props: FinishFlowProps) {
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
      actions={null}
      guide={null}
    />
  )
}
