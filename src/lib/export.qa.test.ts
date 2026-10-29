// QA: client export zip builder and export routes, beyond the builder's tests:
// name padding past 99 photos, extension normalisation, metadata stripping and
// auto-rotation of enhanced images, preview layout, the exact size guard,
// stored (level 0) entries, re-run invalidation and request-independence.
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as decide } from "@/app/api/listings/[listingId]/photos/[photoId]/decision/route";
import { POST as runRoute } from "@/app/api/listings/[listingId]/photos/[photoId]/run/route";
import { GET as exportRoute } from "@/app/api/listings/[listingId]/export/route";
import { GET as summaryRoute } from "@/app/api/listings/[listingId]/export/summary/route";
import { BASE_URL, ctx, jsonRequest, setupApiTestEnv } from "@/lib/api-test-helpers";
import { buildExportZip, listingSlug } from "@/lib/export";
import { errorResponse } from "@/lib/http";
import { addPhoto, createListing, getListing, savePhotoFile, updatePhoto } from "@/lib/store";
import type { Listing, Photo, RoomType } from "@/pipeline/schemas";
import { detailedImage } from "@/pipeline/test-helpers";

const getDataDir = setupApiTestEnv("export-qa");

const NOW = "2026-01-01T00:00:00.000Z";
const SECRET_PROMPT = "QA-SECRET-PROMPT make the sky bluer";

let jpg: Buffer;

beforeAll(async () => {
  jpg = await detailedImage(400, 300);
});

function solid(width: number, height: number, color: { r: number; g: number; b: number }) {
  return sharp({ create: { width, height, channels: 3, background: color } });
}

/** Adds a photo and turns it into an approved enhanced one with the given edited file. */
async function approvedEnhanced(
  listingId: string,
  roomType: RoomType,
  edited: { name: string; bytes: Buffer },
  original: { name: string; bytes: Buffer } = { name: "orig.jpg", bytes: jpg },
): Promise<Photo> {
  const photo = await addPhoto(listingId, { roomType, originalName: original.name, data: original.bytes });
  await savePhotoFile(listingId, photo.id, edited.name, edited.bytes);
  return updatePhoto(listingId, photo.id, (current) => ({
    ...current,
    status: "passed",
    bestAttemptIndex: 0,
    attempts: [{ index: 0, prompt: SECRET_PROMPT, editedFile: edited.name, qa: null, costUsd: 0.05, createdAt: NOW }],
    decision: { verdict: "approved", note: "owner note", decidedAt: NOW },
  }));
}

async function skippedPhoto(listingId: string, roomType: RoomType, name: string, bytes: Buffer): Promise<Photo> {
  const photo = await addPhoto(listingId, { roomType, originalName: name, data: bytes });
  return updatePhoto(listingId, photo.id, (current) => ({ ...current, status: "skipped" }));
}

async function zipOf(listingId: string, maxBytes?: number) {
  const listing = (await getListing(listingId))!;
  const zip = await buildExportZip(listing, maxBytes);
  return { zip, entries: unzipSync(zip) };
}

/** Compression method of every entry, read from the zip's central directory. */
function compressionMethods(zip: Uint8Array): Record<string, number> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.byteLength - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const methods: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const method = view.getUint16(offset + 10, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = Buffer.from(zip.subarray(offset + 46, offset + 46 + nameLength)).toString("utf8");
    methods[name] = method;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return methods;
}

function pixel(raw: { data: Buffer; info: sharp.OutputInfo }, x: number, y: number) {
  const i = (y * raw.info.width + x) * raw.info.channels;
  return { r: raw.data[i], g: raw.data[i + 1], b: raw.data[i + 2] };
}

describe("export zip names (QA)", () => {
  it("pads positions to 3 digits when more than 99 photos are included", async () => {
    const listing = await createListing({ name: "Big house" });
    const tiny = await solid(16, 12, { r: 10, g: 20, b: 30 }).png().toBuffer();
    await approvedEnhanced(listing.id, "living_room", { name: "attempt-0.jpg", bytes: jpg });
    for (let i = 0; i < 100; i++) await skippedPhoto(listing.id, "bedroom", `b${i}.png`, tiny);

    const { entries } = await zipOf(listing.id);
    const names = Object.keys(entries);
    expect(names).toHaveLength(102);
    expect(names[0]).toBe("photos/001-living-room-1.jpg");
    expect(names[1]).toBe("photos/002-bedroom-1.png");
    expect(names[100]).toBe("photos/101-bedroom-100.png");
    expect(names[101]).toBe("previews/001-living-room-1-before-after.jpg");
    for (const name of names) expect(name).toMatch(/^(photos|previews)\/\d{3}-[a-z-]+-\d+(-before-after)?\.(jpg|png)$/);
  }, 60_000);

  it("normalises jpeg to jpg and uses the edited file's own extension", async () => {
    const listing = await createListing({ name: "Ext" });
    const webp = await sharp(jpg).webp().toBuffer();
    const png = await sharp(jpg).png().toBuffer();
    await approvedEnhanced(listing.id, "living_room", { name: "attempt-0.webp", bytes: webp });
    await approvedEnhanced(listing.id, "bedroom", { name: "attempt-0.png", bytes: png }, { name: "IMG.JPEG", bytes: jpg });
    const skipped = await skippedPhoto(listing.id, "kitchen", "Holiday.JPEG", jpg);
    expect(skipped.originalFile).toBe("original.jpeg");

    const { entries } = await zipOf(listing.id);
    expect(Object.keys(entries)).toEqual([
      "photos/01-living-room-1.webp",
      "photos/02-bedroom-1.png",
      "photos/03-kitchen-1.jpg",
      "previews/01-living-room-1-before-after.jpg",
      "previews/02-bedroom-1-before-after.jpg",
    ]);
    expect((await sharp(entries["photos/01-living-room-1.webp"]).metadata()).format).toBe("webp");
    expect((await sharp(entries["photos/02-bedroom-1.png"]).metadata()).format).toBe("png");
    expect(Buffer.from(entries["photos/03-kitchen-1.jpg"]).equals(jpg)).toBe(true);
  });

  it("uses the 'listing' slug fallback and ignores anything in the request", async () => {
    expect(listingSlug("###")).toBe("listing");
    expect(listingSlug("  Casa Ñandú -- Porto  ")).toBe("casa-and-porto");
    const listing = await createListing({ name: "***" });
    await approvedEnhanced(listing.id, "kitchen", { name: "attempt-0.jpg", bytes: jpg });

    const url = `${BASE_URL}/${listing.id}/export?maxBytes=1&name=../../evil&filename=x.exe`;
    const res = await exportRoute(new Request(url, { headers: { "x-max-bytes": "1" } }), ctx({ listingId: listing.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="listing-photos.zip"');
    expect(Object.keys(unzipSync(new Uint8Array(await res.arrayBuffer())))).toEqual([
      "photos/01-kitchen-1.jpg",
      "previews/01-kitchen-1-before-after.jpg",
    ]);
  });
});

describe("export zip contents (QA)", () => {
  it("strips EXIF and XMP from enhanced images, keeps the ICC profile and auto-rotates", async () => {
    const listing = await createListing({ name: "Meta" });
    // 400x300 stored with orientation 6: displays as 300x400.
    const edited = await sharp(jpg)
      .withIccProfile("p3")
      .withExif({ IFD0: { ImageDescription: SECRET_PROMPT, Software: "fal-generator" } })
      .withMetadata({ orientation: 6 })
      .withXmp(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description>${SECRET_PROMPT}</rdf:Description></x:xmpmeta>`)
      .jpeg()
      .toBuffer();
    const editedMeta = await sharp(edited).metadata();
    expect(editedMeta.exif).toBeDefined();
    expect(editedMeta.xmp).toBeDefined();
    expect(editedMeta.orientation).toBe(6);
    await approvedEnhanced(listing.id, "kitchen", { name: "attempt-0.jpg", bytes: edited });

    const { entries } = await zipOf(listing.id);
    const out = entries["photos/01-kitchen-1.jpg"];
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(meta.icc).toBeDefined();
    expect([meta.width, meta.height]).toEqual([300, 400]);
    for (const entry of Object.values(entries)) {
      const latin1 = Buffer.from(entry).toString("latin1");
      expect(latin1).not.toContain("QA-SECRET-PROMPT");
      expect(latin1).not.toContain("fal-generator");
    }
  });

  it("draws the original on the left and the enhanced image on the right of a white 1608x600 canvas", async () => {
    const listing = await createListing({ name: "Preview" });
    // Wide images (2:1) get white bars above and below inside each 800x600 half.
    const red = await solid(800, 400, { r: 255, g: 0, b: 0 }).jpeg().toBuffer();
    const blue = await solid(800, 400, { r: 0, g: 0, b: 255 }).png().toBuffer();
    await approvedEnhanced(listing.id, "kitchen", { name: "attempt-0.png", bytes: blue }, { name: "o.jpg", bytes: red });

    const { entries } = await zipOf(listing.id);
    const preview = entries["previews/01-kitchen-1-before-after.jpg"];
    const meta = await sharp(preview).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1608, 600]);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    const raw = await sharp(preview).removeAlpha().raw().toBuffer({ resolveWithObject: true });

    const isRed = ({ r, g, b }: { r: number; g: number; b: number }) => r > 200 && g < 60 && b < 60;
    const isBlue = ({ r, g, b }: { r: number; g: number; b: number }) => b > 200 && r < 60 && g < 60;
    const isWhite = ({ r, g, b }: { r: number; g: number; b: number }) => r > 240 && g > 240 && b > 240;
    expect(isRed(pixel(raw, 400, 300))).toBe(true);
    expect(isBlue(pixel(raw, 1208, 300))).toBe(true);
    expect(isWhite(pixel(raw, 804, 300))).toBe(true); // gutter
    expect(isWhite(pixel(raw, 400, 20))).toBe(true); // letterbox, before half
    expect(isWhite(pixel(raw, 1208, 580))).toBe(true); // letterbox, after half
  });

  it("stores every entry uncompressed (level 0)", async () => {
    const listing = await createListing({ name: "Stored" });
    await approvedEnhanced(listing.id, "kitchen", { name: "attempt-0.jpg", bytes: jpg });
    await skippedPhoto(listing.id, "bedroom", "s.png", await sharp(jpg).png().toBuffer());

    const { zip, entries } = await zipOf(listing.id);
    const methods = compressionMethods(zip);
    expect(Object.keys(methods).sort()).toEqual(Object.keys(entries).sort());
    for (const [name, method] of Object.entries(methods)) expect(method, name).toBe(0);
  });
});

describe("export size guard (QA)", () => {
  it("sums exported files plus originals read for previews, with an inclusive limit", async () => {
    const listing = await createListing({ name: "Sizes" });
    const enhanced = await approvedEnhanced(listing.id, "kitchen", { name: "attempt-0.png", bytes: await sharp(jpg).png().toBuffer() });
    const skipped = await skippedPhoto(listing.id, "bedroom", "s.jpg", jpg);
    const dir = (photo: Photo) => path.join(getDataDir(), "listings", listing.id, "photos", photo.id);
    const size = async (photo: Photo, file: string) => (await fs.stat(path.join(dir(photo), file))).size;
    const editedSize = await size(enhanced, "attempt-0.png");
    const originalSize = await size(enhanced, enhanced.originalFile);
    const skippedSize = await size(skipped, skipped.originalFile);
    const total = editedSize + originalSize + skippedSize;
    const stored = (await getListing(listing.id)) as Listing;

    await expect(buildExportZip(stored, total)).resolves.toBeInstanceOf(Uint8Array);
    for (const limit of [total - 1, editedSize + skippedSize]) {
      const res = errorResponse(await buildExportZip(stored, limit).catch((e: unknown) => e));
      expect(res.status, String(limit)).toBe(413);
      expect(await res.json()).toEqual({ error: "Export too large" });
    }
  });
});

describe("export routes over the real flow (QA)", () => {
  it("a re-run clears the approval, so the photo leaves the export", async () => {
    const listing = await createListing({ name: "Rerun", clientName: "Bo" });
    const photo = await addPhoto(listing.id, { roomType: "kitchen", originalName: "k.jpg", data: await detailedImage() });
    const ids = { listingId: listing.id, photoId: photo.id };
    const runUrl = `${BASE_URL}/${listing.id}/photos/${photo.id}/run`;
    expect((await runRoute(new Request(runUrl, { method: "POST" }), ctx(ids))).status).toBe(200);
    const decisionUrl = `${BASE_URL}/${listing.id}/photos/${photo.id}/decision`;
    expect((await decide(jsonRequest(decisionUrl, { verdict: "approved" }), ctx(ids))).status).toBe(200);

    const exportOnce = () => exportRoute(new Request(`${BASE_URL}/${listing.id}/export`), ctx({ listingId: listing.id }));
    const summaryOnce = () =>
      summaryRoute(new Request(`${BASE_URL}/${listing.id}/export/summary`), ctx({ listingId: listing.id }));
    expect((await exportOnce()).status).toBe(200);
    expect((await summaryOnce()).status).toBe(200);

    expect((await runRoute(new Request(runUrl, { method: "POST" }), ctx(ids))).status).toBe(200);
    for (const res of [await exportOnce(), await summaryOnce()]) {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Nothing approved to export" });
    }
  });

  it("the summary route escapes names and leaks no ids, file names, prompts or notes", async () => {
    const hostile = `<script>alert(1)</script> & "q" 'x'`;
    const listing = await createListing({ name: hostile, clientName: hostile });
    const photo = await approvedEnhanced(listing.id, "kitchen", { name: "attempt-0.jpg", bytes: jpg }, { name: "../../IMG_9.jpg", bytes: jpg });
    await skippedPhoto(listing.id, "kitchen", "private-holiday.jpg", jpg);

    const res = await summaryRoute(new Request(`${BASE_URL}/${listing.id}/export/summary`), ctx({ listingId: listing.id }));
    expect(res.status).toBe(200);
    const { html, text } = (await res.json()) as { html: string; text: string };
    expect(html).not.toContain("<script");
    expect(html).toContain("Hi &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;x&#39;,");
    expect(text).toContain("We enhanced 1 of them and kept 1 as they were because they already looked great.");
    expect(text).toContain("- Kitchen: 2");
    for (const format of [html, text]) {
      for (const needle of [listing.id, photo.id, "IMG_9", "private-holiday", "attempt-", "original.", SECRET_PROMPT, "owner note", "$"]) {
        expect(format, needle).not.toContain(needle);
      }
    }
  });
});
