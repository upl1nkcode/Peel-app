/** The browser has no room for the save (spec 0008 AC-12). */
export class StorageFullError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      'Not enough space to save this sticker. Delete some stickers or free up space on your phone.',
      options,
    )
    this.name = 'StorageFullError'
  }
}

/** A newer copy of Peel owns the database (spec 0008 AC-11). */
export class StorageOutdatedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      'Peel was updated in another tab. Reload to use your stickers.',
      options,
    )
    this.name = 'StorageOutdatedError'
  }
}

const named = (e: unknown, name: string) =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === name

export const isQuotaError = (e: unknown) => named(e, 'QuotaExceededError')
export const isVersionError = (e: unknown) => named(e, 'VersionError')
