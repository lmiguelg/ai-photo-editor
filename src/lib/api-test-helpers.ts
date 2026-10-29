import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * Registers hooks that point `DATA_DIR` at a fresh temp folder and force mock
 * providers. Returns a getter for the current temp folder.
 */
export function setupApiTestEnv(prefix: string): () => string {
  let dataDir = "";
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), `ai-photo-editor-${prefix}-`));
    process.env.DATA_DIR = dataDir;
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("FAL_KEY", "");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  return () => dataDir;
}

export const BASE_URL = "http://localhost/api/listings";

/** Route handler context with already-resolved params. */
export function ctx<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

export function jsonRequest(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/**
 * A multipart request with a real `Content-Length`, as a browser sends it. `fields`
 * values that are `File`s are appended as files.
 */
export async function multipartRequest(
  url: string,
  fields: Record<string, string | File | (string | File)[]>,
): Promise<Request> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(name, item);
  }
  const encoded = new Request(url, { method: "POST", body: form });
  const body = await encoded.arrayBuffer();
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(body.byteLength),
    },
    body,
  });
}

export function imageFile(bytes: Buffer, name: string): File {
  return new File([new Uint8Array(bytes)], name);
}
