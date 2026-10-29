import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, ctx, setupApiTestEnv } from "@/lib/api-test-helpers";
import { addPhoto, createListing, getListing, getPhoto, updatePhoto } from "@/lib/store";
import { PhotoSchema } from "@/pipeline/schemas";
import { detailedImage, uniformImage } from "@/pipeline/test-helpers";
import { POST } from "./route";

const getDataDir = setupApiTestEnv("run-route");

let detailed: Buffer;
let uniform: Buffer;

beforeAll(async () => {
  detailed = await detailedImage();
  uniform = await uniformImage();
});

async function uploaded(data: Buffer) {
  const listing = await createListing({ name: "Beach house" });
  const photo = await addPhoto(listing.id, { roomType: "bedroom", originalName: "room.jpg", data });
  return { listingId: listing.id, photoId: photo.id };
}

function run(ids: { listingId: string; photoId: string }) {
  const url = `${BASE_URL}/${ids.listingId}/photos/${ids.photoId}/run`;
  return POST(new Request(url, { method: "POST" }), ctx(ids));
}

describe("POST /api/listings/[listingId]/photos/[photoId]/run", () => {
  it("runs the mock pipeline and persists the result", async () => {
    const ids = await uploaded(detailed);
    const res = await run(ids);
    expect(res.status).toBe(200);
    const photo = PhotoSchema.parse(await res.json());
    expect(photo.status).toBe("passed");
    expect(photo.attempts.length).toBeGreaterThanOrEqual(1);
    expect(photo.attempts[0].editedFile).toBe("attempt-0.jpg");
    expect(photo.bestAttemptIndex).toBe(0);
    expect(photo.decision).toBeNull();

    const file = path.join(getDataDir(), "listings", ids.listingId, "photos", ids.photoId, "attempt-0.jpg");
    expect((await fs.stat(file)).size).toBeGreaterThan(0);
    const listing = await getListing(ids.listingId);
    expect(listing?.photos).toEqual([photo]);
  });

  it("stores a prefilter rejection", async () => {
    const res = await run(await uploaded(uniform));
    expect(res.status).toBe(200);
    const photo = await res.json();
    expect(photo.status).toBe("rejected");
    expect(photo.attempts).toEqual([]);
    expect(photo.error).toEqual(expect.any(String));
  });

  it("returns 409 while the photo is processing and keeps the previous result", async () => {
    const ids = await uploaded(detailed);
    const first = await (await run(ids)).json();
    await updatePhoto(ids.listingId, ids.photoId, (photo) => ({ ...photo, status: "processing" }));

    const res = await run(ids);
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const stored = await getPhoto(ids.listingId, ids.photoId);
    expect(stored?.attempts).toEqual(first.attempts);
    expect(stored?.costUsd).toBe(first.costUsd);
  });

  it("lets only one of two concurrent runs through", async () => {
    const ids = await uploaded(detailed);
    const statuses = (await Promise.all([run(ids), run(ids)])).map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect((await getPhoto(ids.listingId, ids.photoId))?.status).toBe("passed");
  });

  it("allows a re-run from a finished status", async () => {
    const ids = await uploaded(detailed);
    expect((await run(ids)).status).toBe(200);
    expect((await run(ids)).status).toBe(200);
  });

  it("returns 500 and leaves the photo failed when the original is missing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const ids = await uploaded(detailed);
    await fs.rm(path.join(getDataDir(), "listings", ids.listingId, "photos", ids.photoId, "original.jpg"));

    const res = await run(ids);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"Internal error"}');
    const photo = await getPhoto(ids.listingId, ids.photoId);
    expect(photo?.status).toBe("failed");
    expect(photo?.error).toBe("Run failed");
    log.mockRestore();
  });

  it("returns 404 for unknown or invalid ids", async () => {
    const { listingId } = await uploaded(detailed);
    for (const photoId of ["00000000-0000-4000-8000-000000000000", "..%2F.."]) {
      const res = await run({ listingId, photoId });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('{"error":"Not found"}');
    }
  });
});
