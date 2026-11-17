import {
  isInstalled,
  type InstallEnv,
  type InstallPrompt,
} from '../../services/install'
import { isAppleTouch } from '../finish/device'

/** How "Install Peel" installs here (spec 0013 AC-14 to AC-16). */
export interface InstallOffer {
  /** `prompt`: the browser's own install prompt; `guide`: the iPhone steps. */
  kind: 'prompt' | 'guide'
  open: () => void
}

/**
 * `null` when Peel already runs installed (AC-14) or this browser can't
 * install it (AC-16, e.g. desktop Firefox); the kept prompt when there is one
 * (AC-15); the iPhone and iPad guide on Apple touch devices (AC-16).
 */
export function installOffer(
  env: InstallEnv & { ua: string; maxTouchPoints: number },
  prompt: InstallPrompt,
  onGuide: () => void,
): InstallOffer | null {
  if (isInstalled(env)) return null
  if (prompt.available()) {
    return {
      kind: 'prompt',
      open: () => {
        // A dismissed or failed prompt changes nothing on the page.
        void prompt.prompt().catch(() => undefined)
      },
    }
  }
  if (isAppleTouch(env.ua, env.maxTouchPoints)) {
    return { kind: 'guide', open: onGuide }
  }
  return null
}
