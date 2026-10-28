import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addPhoto, createListing, getListing, listListings, StoreError, updatePhoto } from "./store";

// QA edge cases for the filesystem store, beyond the builder's store.test.ts.

let dataDir: string;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-photo-editor-store-qa-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  await fs.rm(dataDir, { recursive: true, force: true });
});

const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (e: unknown) => e,
  );
}

describe("listListings edge cases", () => {
  it("returns [] for an existing but empty data dir", async () => {
    expect(await listListings()).toEqual([]);
    await fs.mkdir(path.join(dataDir, "listings"));
    expect(await listListings()).toEqual([]);
  });

  it("skips a listing folder whose listing.json is corrupt or invalid", async () => {
    const good = await createListing({ name: "Good" });
    const corrupt = path.join(dataDir, "listings", "corrupt-json");
    await fs.mkdir(corrupt, { recursive: true });
    await fs.writeFile(path.join(corrupt, "listing.json"), "{ not json");
    const invalid = path.join(dataDir, "listings", "invalid-json");
    await fs.mkdir(invalid, { recursive: true });
    await fs.writeFile(path.join(invalid, "listing.json"), JSON.stringify({ id: "invalid-json" }));
    // A stray file (not a folder) under listings/ is ignored too.
    await fs.writeFile(path.join(dataDir, "listings", "notes.txt"), "hi");

    const listings = await listListings();
    expect(listings.map((l) => l.id)).toEqual([good.id]);
  });

  it("includes each listing's photos", async () => {
    const listing = await createListing({ name: "With photo" });
    const photo = await addPhoto(listing.id, { roomType: "dining", originalName: "d.jpeg", data: bytes });
    const [only] = await listListings();
    expect(only.photos).toEqual([photo]);
  });
});

describe("createListing", () => {
  it("stores clientName and trims the name", async () => {
    const listing = await createListing({ name: "  Lake Cabin  ", clientName: "Ana" });
    expect(listing.name).toBe("Lake Cabin");
    expect(listing.clientName).toBe("Ana");
    expect(await getListing(listing.id)).toEqual(listing);
  });

  it("rejects a name over 200 characters with an invalid StoreError", async () => {
    const err = await caught(createListing({ name: "x".repeat(201) }));
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).code).toBe("invalid");
  });
});

describe("atomic writes", () => {
  it("leaves no temp files behind after create, add and update", async () => {
    const listing = await createListing({ name: "Atomic" });
    const photo = await addPhoto(listing.id, { roomType: "kitchen", originalName: "k.png", data: bytes });
    await updatePhoto(listing.id, photo.id, (p) => ({ ...p, status: "processing" }));

    const files = (await listFilesRecursive(dataDir)).map((f) => path.relative(dataDir, f).replaceAll("\\", "/"));
    expect(files.sort()).toEqual(
      [
        `listings/${listing.id}/listing.json`,
        `listings/${listing.id}/photos/${photo.id}/original.png`,
        `listings/${listing.id}/photos/${photo.id}/photo.json`,
      ].sort(),
    );
  });
});

describe("addPhoto edge cases", () => {
  it("never uses originalName to build a path", async () => {
    const listing = await createListing({ name: "Traversal" });
    const photo = await addPhoto(listing.id, {
      roomType: "other",
      originalName: "../../../evil.JPEG",
      data: new Uint8Array(bytes),
    });
    expect(photo.originalName).toBe("../../../evil.JPEG");
    expect(photo.originalFile).toBe("original.jpeg");

    const stored = path.join(dataDir, "listings", listing.id, "photos", photo.id, "original.jpeg");
    expect(Buffer.compare(await fs.readFile(stored), bytes)).toBe(0);
    // Nothing was written outside the listing's folder.
    const outside = (await listFilesRecursive(dataDir)).filter(
      (f) => !f.startsWith(path.join(dataDir, "listings", listing.id)),
    );
    expect(outside).toEqual([]);
  });

  it("throws not_found for a listing id that is not a valid id", async () => {
    const err = await caught(addPhoto("../etc", { roomType: "other", originalName: "a.jpg", data: bytes }));
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).code).toBe("not_found");
  });

  it("handles concurrent uploads to one listing", async () => {
    // Each addPhoto rewrites listing.json (updatedAt) with a temp-file rename.
    // On Windows, concurrent renames onto the same target can fail with EPERM,
    // so several rounds are run to make a regression show up reliably.
    for (let round = 0; round < 10; round++) {
      const listing = await createListing({ name: `Batch ${round}` });
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          addPhoto(listing.id, { roomType: "other", originalName: `p${i}.jpg`, data: bytes }),
        ),
      );
      const errors = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason)] : []));
      expect(errors).toEqual([]);
      expect((await getListing(listing.id))?.photos).toHaveLength(6);
    }
  });

  it("handles uploads while the listing is being read, leaving no temp files", async () => {
    // Readers hold listing.json open, which on Windows makes a rename onto it fail.
    for (let round = 0; round < 5; round++) {
      const listing = await createListing({ name: `Read ${round}` });
      const results = await Promise.allSettled([
        ...Array.from({ length: 4 }, (_, i) =>
          addPhoto(listing.id, { roomType: "other", originalName: `p${i}.png`, data: bytes }),
        ),
        ...Array.from({ length: 4 }, () => getListing(listing.id)),
        listListings(),
      ]);
      const errors = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason)] : []));
      expect(errors).toEqual([]);
      expect((await getListing(listing.id))?.photos).toHaveLength(4);
    }
    const temps = (await listFilesRecursive(dataDir)).filter((f) => f.endsWith(".tmp"));
    expect(temps).toEqual([]);
  });

  it("rejects an unknown room type as invalid", async () => {
    const listing = await createListing({ name: "Room" });
    const err = await caught(
      addPhoto(listing.id, {
        roomType: "garage" as never,
        originalName: "a.jpg",
        data: bytes,
      }),
    );
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).code).toBe("invalid");
  });
});

describe("updatePhoto edge cases", () => {
  it("keeps listingId and originalFile even if the updater changes them", async () => {
    const listing = await createListing({ name: "Identity" });
    const photo = await addPhoto(listing.id, { roomType: "bedroom", originalName: "b.jpg", data: bytes });

    const updated = await updatePhoto(listing.id, photo.id, (p) => ({
      ...p,
      listingId: "other-listing",
      originalFile: "evil.jpg",
      decision: { verdict: "approved", note: "ok", decidedAt: new Date().toISOString() },
    }));

    expect(updated.listingId).toBe(listing.id);
    expect(updated.originalFile).toBe("original.jpg");
    expect(updated.decision?.verdict).toBe("approved");
    expect((await getListing(listing.id))?.photos[0]).toEqual(updated);
  });

  it("throws not_found for an invalid photo id and leaves no file behind", async () => {
    const listing = await createListing({ name: "Bad id" });
    const err = await caught(updatePhoto(listing.id, "../../x", (p) => p));
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).code).toBe("not_found");
  });

  it("throws not_found for an unknown listing", async () => {
    const err = await caught(
      updatePhoto("00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000001", (p) => p),
    );
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).code).toBe("not_found");
  });

  it("persists many concurrent updates across photos of one listing", async () => {
    const listing = await createListing({ name: "Concurrent" });
    const photos = [];
    for (let i = 0; i < 6; i++) {
      photos.push(await addPhoto(listing.id, { roomType: "other", originalName: `p${i}.jpg`, data: bytes }));
    }

    await Promise.all(
      photos.map((p, i) => updatePhoto(listing.id, p.id, (cur) => ({ ...cur, costUsd: i + 0.5 }))),
    );

    const reloaded = (await getListing(listing.id))?.photos ?? [];
    expect(reloaded).toHaveLength(6);
    const byId = new Map(reloaded.map((p) => [p.id, p.costUsd]));
    photos.forEach((p, i) => expect(byId.get(p.id)).toBe(i + 0.5));
  });

  it("does not throw on concurrent updates to the same photo", async () => {
    // No locking is in scope, so the last writer wins; but every call must succeed
    // and leave a valid record with no temp files behind.
    const listing = await createListing({ name: "Same photo" });
    const photo = await addPhoto(listing.id, { roomType: "kitchen", originalName: "k.jpg", data: bytes });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => updatePhoto(listing.id, photo.id, (cur) => ({ ...cur, costUsd: i + 1 }))),
    );
    const errors = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason)] : []));
    expect(errors).toEqual([]);

    const stored = (await getListing(listing.id))?.photos[0];
    expect(stored?.id).toBe(photo.id);
    expect([1, 2, 3, 4, 5, 6]).toContain(stored?.costUsd);
    const temps = (await listFilesRecursive(dataDir)).filter((f) => f.endsWith(".tmp"));
    expect(temps).toEqual([]);
  });
});
