/**
 * Spec 0012 AC-18: an iPhone, iPad or iPod. iPadOS asks for the desktop
 * site, so a Macintosh user agent on a device with touch counts too.
 */
export function isAppleTouch(ua: string, maxTouchPoints: number): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return true
  return /\bMacintosh\b/.test(ua) && maxTouchPoints > 1
}
