// QA: cross-route flows and edge cases for the listings API, calling the real
// handlers in sequence under a temp DATA_DIR with mock providers.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  BASE_URL,
  ctx,
  imageFile,
  jsonRequest,
  multipartRequest,
  setupApiTestEnv,
} from "@/lib/api-test-helpers";
import { MAX_JSON_BYTES } from "@/lib/http";
import { processPhoto } from "@/lib/process-photo";
import { StoreError } from "@/lib/errors";
import { getPhoto, updatePhoto } from "@/lib/store";
import { PhotoSchema, type Photo } from "@/pipeline/schemas";
import { detailedImage, FakeEditor, ScriptedVision } from "@/pipeline/test-helpers";
import { GET as getListingRoute } from "./[listingId]/route";
import { POST as uploadRoute } from "./[listingId]/photos/route";
import { POST as decisionRoute } from "./[listingId]/photos/[photoId]/decision/route";
import { GET as imageRoute } from "./[listingId]/photos/[photoId]/image/route";
import { POST as runRoute } from "./[listingId]/photos/[photoId]/run/route";
import { GET as listRoute, POST as createRoute } from "./route";

const getDataDir = setupApiTestEnv("api-flow-qa");

let jpeg: Buffer;

beforeAll(async () => {
  jpeg = await detailedImage();
});

type Ids = { listingId: string; photoId: string };

async function createListing(): Promise<string> {
  const res = await createRoute(jsonRequest(BASE_URL, { name: "Beach house", clientName: "Ana" }));
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

async function upload(listingId: string, file: File, roomType = "bedroom"): Promise<Response> {
  const req = await multipartRequest(`${BASE_URL}/${listingId}/photos`, { file, roomType });
  return uploadRoute(req, ctx({ listingId }));
}

async function uploaded(name = "room.jpg"): Promise<Ids> {
  const listingId = await createListing();
  const res = await upload(listingId, imageFile(jpeg, name));
  expect(res.status).toBe(201);
  return { listingId, photoId: (await res.json()).id };
}

const photoUrl = (ids: Ids, rest: string) => `${BASE_URL}/${ids.listingId}/photos/${ids.photoId}/${rest}`;
const run = (ids: Ids) => runRoute(new Request(photoUrl(ids, "run"), { method: "POST" }), ctx(ids));
const decide = (ids: Ids, body: unknown) => decisionRoute(jsonRequest(photoUrl(ids, "decision"), body), ctx(ids));
const image = (ids: Ids, query = "") => imageRoute(new Request(photoUrl(ids, `image${query}`)), ctx(ids));

const photoFolder = (ids: Ids) => path.join(getDataDir(), "listings", ids.listingId, "photos", ids.photoId);

describe("listings API end-to-end through the handlers", () => {
  it("create, upload, run, decide, re-run: the record and listing stay consistent", async () => {
    const ids = await uploaded();

    const listed = await (await listRoute()).json();
    expect(listed.find((l: { id: string }) => l.id === ids.listingId)?.photos).toHaveLength(1);

    const first = PhotoSchema.parse(await (await run(ids)).json());
    expect(first.status).toBe("passed");

    const decided = await decide(ids, { verdict: "approved", note: " ok " });
    expect(decided.status).toBe(200);
    const listing = await (await getListingRoute(new Request(`${BASE_URL}/${ids.listingId}`), ctx({ listingId: ids.listingId }))).json();
    expect(listing.photos[0].decision).toMatchObject({ verdict: "approved", note: "ok" });

    // A re-run clears the decision and replaces attempts.
    const second = PhotoSchema.parse(await (await run(ids)).json());
    expect(second.decision).toBeNull();
    expect(second.attempts.map((a) => a.index)).toEqual(first.attempts.map((a) => a.index));
    expect(second.costUsd).toBeGreaterThanOrEqual(first.costUsd);

    // The edited image after the re-run is served.
    const edited = await image(ids, "?kind=edited");
    expect(edited.status).toBe(200);
    expect(edited.headers.get("content-type")).toBe("image/jpeg");
    expect(edited.headers.get("content-disposition")).toBeNull();
    const onDisk = await fs.readFile(path.join(photoFolder(ids), "attempt-0.jpg"));
    expect(Buffer.from(await edited.arrayBuffer()).equals(onDisk)).toBe(true);
  });

  it("does not leave the run lock file behind after a run or a conflict", async () => {
    const ids = await uploaded();
    await Promise.all([run(ids), run(ids)]);
    const entries = await fs.readdir(photoFolder(ids));
    expect(entries.filter((e) => e.includes("lock"))).toEqual([]);
  });

  it("uploaded photos keep the extension in lower case and accept .webp and upper-case .JPEG", async () => {
    const listingId = await createListing();
    const webp = await sharp(jpeg).webp().toBuffer();
    const a = await upload(listingId, imageFile(webp, "living.webp"), "living_room");
    const b = await upload(listingId, imageFile(jpeg, "KITCHEN.JPEG"), "kitchen");
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await a.json()).originalFile).toBe("original.webp");
    expect((await b.json()).originalFile).toBe("original.jpeg");
  });

  it("rejects a roomType sent as a file and a non-numeric Content-Length with 400", async () => {
    const listingId = await createListing();
    const req = await multipartRequest(`${BASE_URL}/${listingId}/photos`, {
      file: imageFile(jpeg, "room.jpg"),
      roomType: new File(["bedroom"], "bedroom"),
    });
    expect((await uploadRoute(req, ctx({ listingId }))).status).toBe(400);

    const ok = await multipartRequest(`${BASE_URL}/${listingId}/photos`, {
      file: imageFile(jpeg, "room.jpg"),
      roomType: "bedroom",
    });
    const bad = new Request(ok.url, {
      method: "POST",
      headers: { "content-type": ok.headers.get("content-type")!, "content-length": "abc" },
      body: await ok.arrayBuffer(),
    });
    expect((await uploadRoute(bad, ctx({ listingId }))).status).toBe(400);
  });

  it("run responses are JSON for every outcome and never echo the original name", async () => {
    const ids = await uploaded("secret-name.jpg");
    const ok = await run(ids);
    expect(ok.headers.get("content-type")).toMatch(/^application\/json/);
    await ok.text();

    await updatePhoto(ids.listingId, ids.photoId, (p) => ({ ...p, status: "processing" }));
    const conflict = await run(ids);
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get("content-type")).toMatch(/^application\/json/);
    const body = await conflict.text();
    expect(body).not.toContain("secret-name");
    expect(body).not.toContain(ids.photoId);
  });
});

describe("decision route edge cases", () => {
  it("returns 413 for a JSON body over MAX_JSON_BYTES", async () => {
    const ids = await uploaded();
    await run(ids);
    const res = await decide(ids, JSON.stringify({ verdict: "approved", note: "x".repeat(MAX_JSON_BYTES) }));
    expect(res.status).toBe(413);
    expect((await getPhoto(ids.listingId, ids.photoId))?.decision).toBeNull();
  });

  it("returns the fixed 409 body exactly, as JSON", async () => {
    const ids = await uploaded();
    const res = await decide(ids, { verdict: "approved" });
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await res.text()).toBe('{"error":"Photo has no result to review"}');
  });

  it("rejects unknown fields' types and a missing verdict with 400", async () => {
    const ids = await uploaded();
    await run(ids);
    expect((await decide(ids, {})).status).toBe(400);
    expect((await decide(ids, { verdict: "approved", note: 5 })).status).toBe(400);
    expect((await decide(ids, [])).status).toBe(400);
  });
});

describe("image route edge cases", () => {
  it("ignores attempt for kind=original", async () => {
    const ids = await uploaded();
    await run(ids);
    const res = await image(ids, "?kind=original&attempt=0");
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(jpeg)).toBe(true);
  });

  it("edited before any run is exactly the generic 404 body", async () => {
    const ids = await uploaded();
    const res = await image(ids, "?kind=edited");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"Not found"}');
  });

  it("an attempt with editedFile null gives 404", async () => {
    const ids = await uploaded();
    await run(ids);
    await updatePhoto(ids.listingId, ids.photoId, (p) => ({
      ...p,
      attempts: p.attempts.map((a) => ({ ...a, editedFile: null })),
    }));
    expect((await image(ids, "?kind=edited")).status).toBe(404);
    expect((await image(ids, "?kind=edited&attempt=0")).status).toBe(404);
  });
});

describe("processPhoto claim under contention", () => {
  const ROUTER = { reply: { route: "enhance", reason: "Dark" }, costUsd: 0.002 };
  const PROMPT = { reply: { prompt: "Brighten evenly" }, costUsd: 0.01 };
  const QA = {
    reply: { pass: true, scores: { faithfulness: 9, realism: 9, lighting: 9, coherence: 9 }, reason: "Good" },
    costUsd: 0.015,
  };

  it("five concurrent runs give exactly one pipeline run and four conflicts", async () => {
    const ids = await uploaded();
    const vision = new ScriptedVision();
    for (let i = 0; i < 5; i++) vision.on("router", ROUTER).on("synthesizer", PROMPT).on("qa", QA);
    const editor = new FakeEditor(0.04);
    const providers = { vision, editor };

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => processPhoto(ids.listingId, ids.photoId, providers)),
    );
    const ok = results.filter((r): r is PromiseFulfilledResult<Photo> => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(4);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(StoreError);
      expect((f.reason as StoreError).code).toBe("conflict");
    }
    expect(vision.calls("router")).toHaveLength(1);
    expect(editor.requests).toHaveLength(1);
    const stored = await getPhoto(ids.listingId, ids.photoId);
    expect(stored?.status).toBe("passed");
    expect(stored?.costUsd).toBeCloseTo(0.002 + 0.01 + 0.04 + 0.015);
  });

  it("an unknown photo is not_found, not a conflict, and creates no folder", async () => {
    const listingId = await createListing();
    const photoId = "00000000-0000-4000-8000-000000000000";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await processPhoto(listingId, photoId, { vision: new ScriptedVision(), editor: new FakeEditor() }).catch(
      (e: unknown) => e,
    );
    log.mockRestore();
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).code).toBe("not_found");
    await expect(fs.stat(path.join(getDataDir(), "listings", listingId, "photos", photoId))).rejects.toThrow();
  });
});
