import path from "node:path";
import { z } from "zod";
import { StoreError, type StoreErrorCode } from "./errors";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Allowance for multipart boundaries and the other fields on top of the file. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const MAX_JSON_BYTES = 64 * 1024;

/** An error whose status and message are ours and safe to send as-is. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const STORE_ERROR_RESPONSES: Record<StoreErrorCode, { status: number; message: string }> = {
  not_found: { status: 404, message: "Not found" },
  invalid: { status: 400, message: "Invalid request" },
  conflict: { status: 409, message: "Conflict" },
};

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Maps any thrown value to a JSON error response. Bodies only ever hold our fixed
 * messages, never `err.message`, ids, file names or Zod issues.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return jsonError(err.status, err.message);
  if (err instanceof StoreError) {
    const { status, message } = STORE_ERROR_RESPONSES[err.code];
    return jsonError(status, message);
  }
  if (err instanceof z.ZodError) return jsonError(400, "Invalid request");
  console.error(err);
  return jsonError(500, "Internal error");
}

/** Validates route params; any invalid id is reported as a plain 404. */
export async function parseParams<T extends z.ZodType>(
  schema: T,
  params: Promise<unknown>,
): Promise<z.infer<T>> {
  const result = schema.safeParse(await params);
  if (!result.success) throw new HttpError(404, "Not found");
  return result.data;
}

/** Reads at most `maxBytes` of the body; 413 past that, without buffering the rest. */
async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new HttpError(413, "Request too large");
  if (!request.body) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Request too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Parses a JSON body of at most `MAX_JSON_BYTES`: 413 when larger, 400 when malformed. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const bytes = await readBodyLimited(request, MAX_JSON_BYTES);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Invalid request");
  }
}

/**
 * Checks an upload's `Content-Length` before the body is parsed: 411 when missing,
 * 413 when it can't fit a `maxFileBytes` file plus multipart overhead.
 */
export function checkUploadLength(request: Request, maxFileBytes = MAX_UPLOAD_BYTES): void {
  const header = request.headers.get("content-length");
  if (header === null) throw new HttpError(411, "Length required");
  const length = Number(header);
  if (!Number.isInteger(length) || length < 0) throw new HttpError(400, "Invalid request");
  if (length > maxFileBytes + MULTIPART_OVERHEAD_BYTES) throw new HttpError(413, "File too large");
}

/** A file name safe to put inside a quoted header value such as `Content-Disposition`. */
export function safeHeaderFileName(name: string): string {
  const base = path.posix.basename(name.replaceAll("\\", "/"));
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/gu, "_").slice(0, 100);
  return cleaned.length > 0 ? cleaned : "photo";
}
