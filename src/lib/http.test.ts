import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { StoreError } from "./errors";
import {
  checkUploadLength,
  errorResponse,
  HttpError,
  MAX_JSON_BYTES,
  MAX_UPLOAD_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  parseParams,
  readJsonBody,
  safeHeaderFileName,
} from "./http";

afterEach(() => {
  vi.restoreAllMocks();
});

async function caught(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

describe("errorResponse", () => {
  it("maps store errors to fixed bodies without the message", async () => {
    const secret = "listing 1234 photo evil.jpg";
    const cases = [
      [new StoreError("not_found", secret), 404, "Not found"],
      [new StoreError("invalid", secret), 400, "Invalid request"],
      [new StoreError("conflict", secret), 409, "Conflict"],
    ] as const;
    for (const [err, status, message] of cases) {
      const res = errorResponse(err);
      expect(res.status).toBe(status);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(await res.text()).toBe(JSON.stringify({ error: message }));
    }
  });

  it("maps Zod errors to 400 without echoing the input", async () => {
    const parsed = z.object({ name: z.literal("x") }).safeParse({ name: "<script>secret" });
    const res = errorResponse(parsed.error);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"error":"Invalid request"}');
  });

  it("passes HttpError status and message through", async () => {
    const res = errorResponse(new HttpError(413, "Request too large"));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Request too large" });
  });

  it("maps anything else to 500 and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("ENOENT /secret/path");
    const res = errorResponse(err);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"Internal error"}');
    expect(log).toHaveBeenCalledWith(err);
  });
});

describe("parseParams", () => {
  it("turns invalid params into a 404 HttpError", async () => {
    const schema = z.object({ id: z.string().regex(/^[a-z]+$/) });
    expect(await parseParams(schema, Promise.resolve({ id: "abc" }))).toEqual({ id: "abc" });
    const err = await caught(() => parseParams(schema, Promise.resolve({ id: "../x" })));
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
  });
});

describe("readJsonBody", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/", { method: "POST", body, headers });

  it("parses JSON", async () => {
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ a: 1 });
  });

  it("rejects malformed JSON with 400", async () => {
    const err = await caught(() => readJsonBody(post("{nope")));
    expect((err as HttpError).status).toBe(400);
  });

  it("rejects bodies over MAX_JSON_BYTES with 413, with or without Content-Length", async () => {
    const big = JSON.stringify({ a: "x".repeat(MAX_JSON_BYTES) });
    const withoutLength = await caught(() => readJsonBody(post(big)));
    expect((withoutLength as HttpError).status).toBe(413);
    const declared = await caught(() =>
      readJsonBody(post("{}", { "content-length": String(MAX_JSON_BYTES + 1) })),
    );
    expect((declared as HttpError).status).toBe(413);
  });
});

describe("checkUploadLength", () => {
  const withLength = (length?: string) =>
    new Request("http://localhost/", {
      method: "POST",
      body: "x",
      headers: length === undefined ? {} : { "content-length": length },
    });

  it("requires a Content-Length (411)", async () => {
    const err = await caught(() => checkUploadLength(new Request("http://localhost/")));
    expect((err as HttpError).status).toBe(411);
  });

  it("rejects lengths over the cap plus multipart overhead (413)", async () => {
    expect(() => checkUploadLength(withLength(String(MAX_UPLOAD_BYTES)))).not.toThrow();
    const limit = MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES;
    expect(() => checkUploadLength(withLength(String(limit)))).not.toThrow();
    const err = await caught(() => checkUploadLength(withLength(String(limit + 1))));
    expect((err as HttpError).status).toBe(413);
    const small = await caught(() => checkUploadLength(withLength(String(MULTIPART_OVERHEAD_BYTES + 11)), 10));
    expect((small as HttpError).status).toBe(413);
  });
});

describe("safeHeaderFileName", () => {
  it("keeps safe names", () => {
    expect(safeHeaderFileName("Living room 01.jpg")).toBe("Living room 01.jpg");
  });

  it("keeps only the base name for / and \\ paths", () => {
    expect(safeHeaderFileName("../../etc/passwd")).toBe("passwd");
    expect(safeHeaderFileName("C:\\Users\\me\\room.jpg")).toBe("room.jpg");
  });

  it("replaces quotes, CR/LF and non-ASCII", () => {
    const name = safeHeaderFileName('evil"\r\nX-Injected: 1.jpg');
    expect(name).toBe("evil___X-Injected_ 1.jpg");
    expect(safeHeaderFileName("café;ü😀.png")).toBe("caf____.png");
  });

  it("caps the length at 100", () => {
    expect(safeHeaderFileName(`${"a".repeat(300)}.jpg`)).toHaveLength(100);
  });

  it("falls back to 'photo' when nothing is left", () => {
    expect(safeHeaderFileName("")).toBe("photo");
    expect(safeHeaderFileName("dir/")).toBe("dir");
    expect(safeHeaderFileName("/")).toBe("photo");
  });
});
