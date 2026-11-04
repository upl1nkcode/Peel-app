import { simplifyRing } from './simplify'
import { smoothRing, type SmoothStrength } from './smooth'
import type { Point } from './types'

export interface LassoRefineOptions {
  strength: SmoothStrength
  /** RDP tolerance in image px. */
  epsilon: number
}

export const DEFAULT_LASSO_REFINE: Readonly<LassoRefineOptions> = {
  strength: 1,
  epsilon: 1.0,
}

/** Turns a closed lasso ring into a clean ring of few dots: smooth, then simplify. */
export function refineLasso(
  ring: readonly Point[],
  options: LassoRefineOptions,
): Point[] {
  return simplifyRing(smoothRing(ring, options.strength), options.epsilon)
}
