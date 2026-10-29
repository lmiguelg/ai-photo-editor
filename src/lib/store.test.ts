import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdSchema, type Attempt } from "@/pipeline/schemas";
import {
  addPhoto,
  claimPhotoForRun,
  createListing,
  getListing,
  getPhoto,
  listListings,
  resetStuckPhoto,
  StoreError,
  updatePhoto,
} from "./store";

let dataDir: string;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-photo-editor-store-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  await fs.rm(dataDir, { recursive: true, force: true });
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function attempt(index: number): Attempt {
  return {
    index,
    prompt: "Brighten evenly",
    editedFile: `attempt-${index}.jpg`,
    qa: { pass: true, scores: { faithfulness: 9 }, reason: "ok" },
    costUsd: 0.04,
    createdAt: new Date().toISOString(),
  };
}

async function expectStoreError(promise: Promise<unknown>, code: StoreError["code"]) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(StoreError);
  expect((err as StoreError).code).toBe(code);
}

describe("createListing / getListing", () => {
  it("creates a listing on disk and reads it back", async () => {
    const listing = await createListing({ name: "Beach House" });
    expect(IdSchema.safeParse(listing.id).success).toBe(true);
    expect(listing.photos).toEqual([]);
    expect(listing.clientName).toBeNull();

    const file = path.join(dataDir, "listings", listing.id, "listing.json");
    const onDisk = JSON.parse(await fs.readFile(file, "utf8"));
    expect(onDisk).not.toHaveProperty("photos");

    expect(await getListing(listing.id)).toEqual(listing);
  });

  it("rejects invalid input", async () => {
    await expectStoreError(createListing({ name: "  " }), "invalid");
  });

  it("returns null for unknown or invalid ids", async () => {
    expect(await getListing("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await getListing("../etc")).toBeNull();
  });
});

describe("listListings", () => {
  it("returns [] when the data dir doesn't exist", async () => {
    process.env.DATA_DIR = path.join(dataDir, "missing");
    expect(await listListings()).toEqual([]);
  });

  it("returns listings newest first and skips stray folders", async () => {
    const first = await createListing({ name: "First" });
    await delay(5);
    const second = await createListing({ name: "Second", clientName: "Ana" });
    await fs.mkdir(path.join(dataDir, "listings", "stray-folder"), { recursive: true });
    await fs.mkdir(path.join(dataDir, "listings", "Not An Id"), { recursive: true });

    const listings = await listListings();
    expect(listings.map((l) => l.id)).toEqual([second.id, first.id]);
  });
});

describe("addPhoto", () => {
  it("stores the bytes and the photo record", async () => {
    const listing = await createListing({ name: "Beach House" });
    await delay(5);
    const photo = await addPhoto(listing.id, {
      roomType: "living_room",
      originalName: "Living Room.JPG",
      data: bytes,
    });

    expect(photo.status).toBe("uploaded");
    expect(photo.originalFile).toBe("original.jpg");
    expect(photo.attempts).toEqual([]);
    expect(photo.costUsd).toBe(0);
    expect(photo.decision).toBeNull();
    expect(photo.error).toBeNull();

    const file = path.join(dataDir, "listings", listing.id, "photos", photo.id, "original.jpg");
    expect(Buffer.compare(await fs.readFile(file), bytes)).toBe(0);

    const reloaded = await getListing(listing.id);
    expect(reloaded?.photos).toEqual([photo]);
    expect(reloaded?.updatedAt).toBe(photo.createdAt);
    expect(reloaded?.updatedAt).not.toBe(listing.updatedAt);
  });

  it("returns photos sorted by createdAt", async () => {
    const listing = await createListing({ name: "Beach House" });
    const a = await addPhoto(listing.id, { roomType: "kitchen", originalName: "a.png", data: bytes });
    await delay(5);
    const b = await addPhoto(listing.id, { roomType: "bedroom", originalName: "b.webp", data: bytes });
    const reloaded = await getListing(listing.id);
    expect(reloaded?.photos.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it.each(["photo.gif", "photo.exe", "photo"])("rejects %j", async (originalName) => {
    const listing = await createListing({ name: "Beach House" });
    await expectStoreError(addPhoto(listing.id, { roomType: "other", originalName, data: bytes }), "invalid");
  });

  it("throws not_found for an unknown listing", async () => {
    await expectStoreError(
      addPhoto("00000000-0000-4000-8000-000000000000", {
        roomType: "other",
        originalName: "a.jpg",
        data: bytes,
      }),
      "not_found",
    );
  });
});

describe("updatePhoto", () => {
  it("persists the update and keeps identity fields", async () => {
    const listing = await createListing({ name: "Beach House" });
    const photo = await addPhoto(listing.id, { roomType: "bathroom", originalName: "a.jpg", data: bytes });
    await delay(5);

    const updated = await updatePhoto(listing.id, photo.id, (p) => ({
      ...p,
      id: "hijacked",
      createdAt: "2000-01-01T00:00:00.000Z",
      status: "passed",
      attempts: [...p.attempts, attempt(0)],
    }));

    expect(updated.id).toBe(photo.id);
    expect(updated.createdAt).toBe(photo.createdAt);
    expect(updated.updatedAt).not.toBe(photo.updatedAt);

    const reloaded = (await getListing(listing.id))?.photos[0];
    expect(reloaded).toEqual(updated);
    expect(reloaded?.status).toBe("passed");
    expect(reloaded?.attempts).toHaveLength(1);
  });

  it("rejects an invalid result and leaves the stored record unchanged", async () => {
    const listing = await createListing({ name: "Beach House" });
    const photo = await addPhoto(listing.id, { roomType: "bathroom", originalName: "a.jpg", data: bytes });

    await expectStoreError(updatePhoto(listing.id, photo.id, (p) => ({ ...p, costUsd: -1 })), "invalid");
    expect((await getListing(listing.id))?.photos[0]).toEqual(photo);
  });

  it("throws not_found for an unknown photo", async () => {
    const listing = await createListing({ name: "Beach House" });
    await expectStoreError(
      updatePhoto(listing.id, "00000000-0000-4000-8000-000000000000", (p) => p),
      "not_found",
    );
  });

  it("persists concurrent updates to two photos of one listing", async () => {
    const listing = await createListing({ name: "Beach House" });
    const a = await addPhoto(listing.id, { roomType: "kitchen", originalName: "a.jpg", data: bytes });
    const b = await addPhoto(listing.id, { roomType: "bedroom", originalName: "b.jpg", data: bytes });

    await Promise.all([
      updatePhoto(listing.id, a.id, (p) => ({ ...p, status: "passed", attempts: [attempt(0)] })),
      updatePhoto(listing.id, b.id, (p) => ({ ...p, status: "skipped" })),
    ]);

    const photos = (await getListing(listing.id))?.photos ?? [];
    const byId = new Map(photos.map((p) => [p.id, p]));
    expect(byId.get(a.id)?.status).toBe("passed");
    expect(byId.get(a.id)?.attempts).toHaveLength(1);
    expect(byId.get(b.id)?.status).toBe("skipped");
  });
});

describe("resetStuckPhoto", () => {
  async function stuck() {
    const listing = await createListing({ name: "Beach House" });
    const photo = await addPhoto(listing.id, { roomType: "kitchen", originalName: "a.jpg", data: bytes });
    const decision = { verdict: "approved" as const, note: "ok", decidedAt: new Date().toISOString() };
    const before = await updatePhoto(listing.id, photo.id, (p) => ({
      ...p,
      status: "processing",
      attempts: [attempt(0)],
      bestAttemptIndex: 0,
      costUsd: 0.12,
      decision,
    }));
    return { listingId: listing.id, photoId: photo.id, before };
  }

  const lockFile = (listingId: string, photoId: string) =>
    path.join(dataDir, "listings", listingId, "photos", photoId, ".run.lock");

  it("sets a processing photo failed with Run interrupted and keeps cost, attempts and decision", async () => {
    const { listingId, photoId, before } = await stuck();
    const photo = await resetStuckPhoto(listingId, photoId);
    expect(photo.status).toBe("failed");
    expect(photo.error).toBe("Run interrupted");
    expect(photo.costUsd).toBe(0.12);
    expect(photo.attempts).toEqual(before.attempts);
    expect(photo.bestAttemptIndex).toBe(0);
    expect(photo.decision).toEqual(before.decision);
    expect(await getPhoto(listingId, photoId)).toEqual(photo);
  });

  it("removes a stale run lock so a later claim succeeds", async () => {
    const { listingId, photoId } = await stuck();
    await fs.writeFile(lockFile(listingId, photoId), "");
    await expectStoreError(claimPhotoForRun(listingId, photoId), "conflict");

    await resetStuckPhoto(listingId, photoId);
    await expect(fs.stat(lockFile(listingId, photoId))).rejects.toThrow();
    expect((await claimPhotoForRun(listingId, photoId)).status).toBe("processing");
  });

  it("removes a stale lock on a photo that is not processing and leaves the record alone", async () => {
    const listing = await createListing({ name: "Beach House" });
    const photo = await addPhoto(listing.id, { roomType: "kitchen", originalName: "a.jpg", data: bytes });
    await fs.writeFile(lockFile(listing.id, photo.id), "");

    expect(await resetStuckPhoto(listing.id, photo.id)).toEqual(photo);
    await expect(fs.stat(lockFile(listing.id, photo.id))).rejects.toThrow();
  });

  it("gives conflict for a photo that is not processing and has no lock", async () => {
    const listing = await createListing({ name: "Beach House" });
    const photo = await addPhoto(listing.id, { roomType: "kitchen", originalName: "a.jpg", data: bytes });
    await expectStoreError(resetStuckPhoto(listing.id, photo.id), "conflict");
    expect(await getPhoto(listing.id, photo.id)).toEqual(photo);
  });

  it("gives not_found for unknown or invalid ids", async () => {
    const listing = await createListing({ name: "Beach House" });
    await expectStoreError(resetStuckPhoto(listing.id, "00000000-0000-4000-8000-000000000000"), "not_found");
    await expectStoreError(resetStuckPhoto(listing.id, "../.."), "not_found");
    await expectStoreError(resetStuckPhoto("../..", "abc"), "not_found");
  });
});
