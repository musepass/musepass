export type MuseNameErrorCode =
  | 'EMPTY_LABEL'
  | 'INVALID_NAME'
  | 'INVALID_CHARACTER'
  | 'LABEL_TOO_SHORT'
  | 'LABEL_TOO_LONG'
  | 'LABEL_TOO_MANY_BYTES'
  | 'MIXED_SCRIPT'
  | 'EMOJI_NOT_ALLOWED'
  | 'RESERVED_NAME'
  | 'NAME_TAKEN'
  | 'NOT_FREE_TIER'
  | 'QUOTA_EXCEEDED'
  | 'SPONSORSHIP_EXCEEDED'
  | 'INVALID_CONFIG'
  | 'INVALID_CARD'
  | 'INVALID_SIGNATURE'
  | 'EXPIRED';

export interface MuseNameErrorJson {
  code: MuseNameErrorCode;
  message: string;
  details: Record<string, unknown>;
}

/**
 * Every rejection carries a stable machine code. The API layer turns these into
 * `{ summary, errors[] }` responses so that a human sentence is always present.
 */
export class MuseNameError extends Error {
  readonly code: MuseNameErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: MuseNameErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'MuseNameError';
    this.code = code;
    this.details = details;
  }

  toJSON(): MuseNameErrorJson {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function isMuseNameError(value: unknown): value is MuseNameError {
  return value instanceof MuseNameError;
}
