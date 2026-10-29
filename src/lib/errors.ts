export type StoreErrorCode = "not_found" | "invalid" | "conflict";

/**
 * Store failure with a code API routes map to 404 (`not_found`), 400 (`invalid`) or
 * 409 (`conflict`). The message is for logs only and never reaches a response.
 */
export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}
