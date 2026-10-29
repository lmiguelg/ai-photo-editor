import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, ctx, jsonRequest, setupApiTestEnv } from "@/lib/api-test-helpers";
import { buildExportZip, MAX_EXPORT_BYTES } from "@/lib/export";
import { errorResponse, HttpError } from "@/lib/http";
import { addPhoto, createListing, getListing, updatePhoto } from "@/lib/store";
import type { Photo, PhotoStatus, RoomType } from "@/pipeline/schemas";
import { detailedImage, uniformImage } from "@/pipeline/test-helpers";
import { POST as decide } from "../photos/[photoId]/decision/route";
import { POST as runRoute } from "../photos/[photoId]/run/route";
import { GET } from "./route";

const getDataDir = setupApiTestEnv("export-route");

const ENTRY_NAME = /^(photos|previews)\/[a-z0-9-]+\.(jpg|png|webp)$/;

let detailedJpg: Buffer;
let detailedPng: Buffer;
let uniform: Buffer;

beforeAll(async () => {
  detailedJpg = await detailedImage();
  detailedPng = await sharp(detailedJpg).png().toBuffer();
  uniform = await uniformImage();
});

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

function exportZip(listingId: string) {
  return GET(new Request(`${BASE_URL}/${listingId}/export`), ctx({ listingId }));
}

async function run(photo: Photo) {
  const ids = { listingId: photo.listingId, photoId: photo.id };
  const res = await runRoute(new Request(`${BASE_URL}/${photo.listingId}/photos/${photo.id}/run`, { method: "POST" }), ctx(ids));
  expect(res.status).toBe(200);
  return (await res.json()) as Photo;
}

async function decideOn(photo: Photo, verdict: "approved" | "rejected") {
  const ids = { listingId: photo.listingId, photoId: photo.id };
  const url = `${BASE_URL}/${photo.listingId}/photos/${photo.id}/decision`;
  const res = await decide(jsonRequest(url, { verdict, note: "internal note for the owner" }), ctx(ids));
  expect(res.status).toBe(200);
}

async function setStatus(photo: Photo, status: PhotoStatus) {
  await updatePhoto(photo.listingId, photo.id, (current) => ({ ...current, status }));
}

async function add(listingId: string, roomType: RoomType, originalName: string, data: Buffer) {
  await pause(); // distinct createdAt values, so the order is deterministic
  return addPhoto(listingId, { roomType, originalName, data });
}

/** A listing with every kind of photo: four included (one skipped original) and six left out. */
async function mixedListing() {
  const listing = await createListing({ name: "Beach House #1: Ocean View!", clientName: "Ana" });
  const id = listing.id;
  const livingA = await add(id, "living_room", "../../evil.jpg", detailedJpg);
  const livingB = await add(id, "living_room", "a/b\\c.jpg", detailedJpg);
  const skipped = await add(id, "bedroom", "dup.png", detailedPng);
  const kitchen = await add(id, "kitchen", "../../evil.jpg", detailedJpg);
  const rejectedByYou = await add(id, "bedroom", "dup.png", detailedPng);
  const awaiting = await add(id, "bathroom", "awaiting.jpg", detailedJpg);
  await add(id, "dining", "not-run.jpg", detailedJpg); // stays uploaded: not run
  const failed = await add(id, "exterior", "failed.jpg", detailedJpg);
  const processing = await add(id, "other", "processing.jpg", detailedJpg);
  const pipelineRejected = await add(id, "exterior", "flat.jpg", uniform);

  for (const photo of [livingA, livingB, kitchen, rejectedByYou, awaiting, pipelineRejected]) await run(photo);
  for (const photo of [livingA, livingB, kitchen]) await decideOn(photo, "approved");
  await decideOn(rejectedByYou, "rejected");
  await setStatus(skipped, "skipped");
  await setStatus(failed, "failed");
  await setStatus(processing, "processing");

  const stored = (await getListing(id))!;
  expect(stored.photos.find((p) => p.id === pipelineRejected.id)?.status).toBe("rejected");
  return { listing: stored, skipped };
}

describe("GET /api/listings/[listingId]/export", () => {
  // Six full mock pipeline runs plus the zip take about 4-5 s alone, so the 5 s default
  // is too tight while the rest of the suite runs in parallel.
  it("returns a zip of approved enhanced photos, skipped originals and previews", async () => {
    const { listing, skipped } = await mixedListing();
    const res = await exportZip(listing.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="beach-house-1-ocean-view-photos.zip"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(entries);
    expect(names).toEqual([
      "photos/01-living-room-1.jpg",
      "photos/02-living-room-2.jpg",
      "photos/03-bedroom-1.png",
      "photos/04-kitchen-1.jpg",
      "previews/01-living-room-1-before-after.jpg",
      "previews/02-living-room-2-before-after.jpg",
      "previews/04-kitchen-1-before-after.jpg",
    ]);
    for (const name of names) expect(name).toMatch(ENTRY_NAME);

    // Approved enhanced (3) plus skipped (1); previews only for the enhanced ones.
    expect(names.filter((n) => n.startsWith("photos/"))).toHaveLength(4);
    expect(names.filter((n) => n.startsWith("previews/"))).toHaveLength(3);

    expect(Buffer.from(entries["photos/03-bedroom-1.png"]).equals(detailedPng)).toBe(true);
    const originalPath = path.join(getDataDir(), "listings", listing.id, "photos", skipped.id, "original.png");
    expect(Buffer.from(entries["photos/03-bedroom-1.png"]).equals(await fs.readFile(originalPath))).toBe(true);

    for (const name of names.filter((n) => n.startsWith("previews/"))) {
      const meta = await sharp(entries[name]).metadata();
      expect(meta.format).toBe("jpeg");
      expect([meta.width, meta.height]).toEqual([1608, 600]);
      expect(entries[name].byteLength).toBeLessThan(500 * 1024);
      expect(meta.exif).toBeUndefined();
    }
    for (const name of ["photos/01-living-room-1.jpg", "photos/04-kitchen-1.jpg"]) {
      const meta = await sharp(entries[name]).metadata();
      expect(meta.format).toBe("jpeg");
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
    }

    const forbidden = [
      listing.id,
      getDataDir(),
      "attempt-",
      ...listing.photos.flatMap((photo) => [photo.id, photo.originalName, ...photo.attempts.map((a) => a.prompt)]),
    ];
    for (const name of names) {
      const content = Buffer.from(entries[name]).toString("latin1");
      for (const needle of forbidden) {
        expect(name, needle).not.toContain(needle);
        expect(content.includes(needle), `${name} contains ${needle}`).toBe(false);
      }
    }
  }, 30_000);

  it("returns 404 for an invalid or unknown listing id", async () => {
    for (const listingId of ["../x", "00000000-0000-0000-0000-000000000000"]) {
      const res = await exportZip(listingId);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    }
  });

  it("returns 409 when nothing is approved, even with skipped photos", async () => {
    const onlySkipped = await createListing({ name: "Only skipped" });
    await setStatus(await add(onlySkipped.id, "bedroom", "a.jpg", detailedJpg), "skipped");

    const unreviewed = await createListing({ name: "Unreviewed" });
    const photo = await add(unreviewed.id, "bedroom", "b.jpg", detailedJpg);
    await run(photo);
    await decideOn(await add(unreviewed.id, "kitchen", "c.jpg", detailedJpg).then(run), "rejected");

    const empty = await createListing({ name: "Empty" });
    for (const listing of [onlySkipped, unreviewed, empty]) {
      const res = await exportZip(listing.id);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Nothing approved to export" });
    }
  });

  it("refuses with 413 Export too large when the source files exceed the limit", async () => {
    const listing = await createListing({ name: "Big" });
    const photo = await run(await add(listing.id, "bedroom", "a.jpg", detailedJpg));
    await decideOn(photo, "approved");
    const stored = (await getListing(listing.id))!;

    expect(MAX_EXPORT_BYTES).toBe(300 * 1024 * 1024);
    const err = await buildExportZip(stored, 1000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    const res = errorResponse(err);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Export too large" });
    await expect(buildExportZip(stored)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("returns 500 Internal error when a source file is missing on disk", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const listing = await createListing({ name: "Broken" });
    const photo = await run(await add(listing.id, "bedroom", "a.jpg", detailedJpg));
    await decideOn(photo, "approved");
    await fs.rm(path.join(getDataDir(), "listings", listing.id, "photos", photo.id, "attempt-0.jpg"));

    const res = await exportZip(listing.id);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
