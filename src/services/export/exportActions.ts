/** Feature detection and the three ways out of the app (spec 0012 AC-13 to AC-16). */

const bytesOf = (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

/** Valid transparent 1 × 1 files, made by our PNG encoder and libwebp. */
export const ONE_PIXEL: Record<'image/png' | 'image/webp', Uint8Array> = {
  'image/png': bytesOf(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  ),
  'image/webp': bytesOf('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='),
}

/** AC-14: `canShare` exists and accepts a probe file of this type. */
export function canShareType(
  nav: Pick<Navigator, 'canShare'> | undefined,
  mime: 'image/png' | 'image/webp',
): boolean {
  if (typeof nav?.canShare !== 'function') return false
  const ext = mime === 'image/webp' ? 'webp' : 'png'
  try {
    return nav.canShare({
      files: [
        new File([ONE_PIXEL[mime] as Uint8Array<ArrayBuffer>], `probe.${ext}`, {
          type: mime,
        }),
      ],
    })
  } catch {
    return false
  }
}

/** Spec 0013 AC-8: `canShare` accepts one probe file of each type at once. */
export function canShareFiles(
  nav: Pick<Navigator, 'canShare'> | undefined,
  types: readonly ('image/png' | 'image/webp')[],
): boolean {
  if (typeof nav?.canShare !== 'function' || types.length === 0) return false
  try {
    return nav.canShare({
      files: [...new Set(types)].map(
        (mime) =>
          new File(
            [ONE_PIXEL[mime] as Uint8Array<ArrayBuffer>],
            `probe.${mime === 'image/webp' ? 'webp' : 'png'}`,
            { type: mime },
          ),
      ),
    })
  } catch {
    return false
  }
}

export interface ClipboardEnv {
  clipboard?: Pick<Clipboard, 'write'> | undefined
  ClipboardItem?: { supports?: (type: string) => boolean } | undefined
}

/**
 * AC-15: `clipboard.write` and `ClipboardItem` exist and PNG is supported.
 * Without `ClipboardItem.supports`, PNG counts as supported (the clipboard
 * standard requires it).
 */
export function canCopyPng(env: ClipboardEnv): boolean {
  if (typeof env.clipboard?.write !== 'function' || !env.ClipboardItem) {
    return false
  }
  const { supports } = env.ClipboardItem
  return typeof supports !== 'function' || supports('image/png')
}

/**
 * AC-14: calls `share` at once (Safari needs the tap's activation, Decision
 * 5). A closed share sheet is `'cancelled'`; other errors reject.
 */
export function shareFile(
  nav: Pick<Navigator, 'share'>,
  file: File,
): Promise<'shared' | 'cancelled'> {
  return shareFiles(nav, [file])
}

/** Spec 0013 AC-8: `shareFile` for several files in one sheet. */
export function shareFiles(
  nav: Pick<Navigator, 'share'>,
  files: File[],
): Promise<'shared' | 'cancelled'> {
  return nav.share({ files }).then(
    () => 'shared' as const,
    (e: unknown) => {
      // DOMException isn't an Error subclass everywhere: check the name.
      if ((e as { name?: unknown } | null)?.name === 'AbortError') {
        return 'cancelled'
      }
      throw e
    },
  )
}

/** AC-15: writes the file as `image/png`, at once. */
export function copyPng(
  clipboard: Pick<Clipboard, 'write'>,
  blob: Blob,
  Item: typeof ClipboardItem = ClipboardItem,
): Promise<void> {
  return clipboard.write([new Item({ 'image/png': blob })])
}

/** AC-16: a link click with `download`, revoking the URL later (Safari may still read it). */
export function downloadBlob(
  blob: Blob,
  name: string,
  doc: Document = document,
  revokeAfterMs = 30_000,
): void {
  const url = URL.createObjectURL(blob)
  const link = doc.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, revokeAfterMs)
}
