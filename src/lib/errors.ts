export type StoreErrorCode = "not_found" | "invalid";

/** Store failure with a code API routes can map to 404 (`not_found`) or 400 (`invalid`). */
export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}
