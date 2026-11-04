/** A command that would produce an invalid selection; nothing was changed. */
export class InvalidCommandError extends Error {
  override name = 'InvalidCommandError'
}

/** Selection JSON that is malformed; the message names the field path. */
export class InvalidSelectionError extends Error {
  override name = 'InvalidSelectionError'
}

/** Selection JSON written by a format version this build cannot read. */
export class UnsupportedSelectionVersionError extends Error {
  override name = 'UnsupportedSelectionVersionError'
  readonly version: unknown

  constructor(version: unknown) {
    super(
      `unsupported selection format version: ${version === undefined ? 'missing' : JSON.stringify(version)}`,
    )
    this.version = version
  }
}
