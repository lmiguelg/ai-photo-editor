import fs from "node:fs/promises";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import sharp from "sharp";
import type { Listing, Photo } from "@/pipeline/schemas";
import { HttpError } from "./http";
import { bestAttempt, canExport, exportSelection, ROOM_TYPE_LABELS, type ExportSource } from "./review";
import { getPhotoFilePath } from "./store";

// Builds the client zip in memory. File names inside the zip come only from position
// and room type; source files come only from the photo records.

/** Cap on the summed on-disk size of every source file one export reads. */
export const MAX_EXPORT_BYTES = 300 * 1024 * 1024;

const ENTRY_NAME = /^(photos|previews)\/[a-z0-9-]+\.(jpg|png|webp)$/;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const PREVIEW_HALF = { width: 800, height: 600 };
const PREVIEW_GUTTER = 8;

interface PlannedPhoto {
  photo: Photo;
  source: ExportSource;
  /** `<NN>-<room>-<k>`, the shared stem of the photo and preview entries. */
  stem: string;
  /** The stored file to export: the original, or the best attempt's edited file. */
  file: string;
  ext: "jpg" | "png" | "webp";
}

/** The listing name as a file name slug, `listing` when nothing is left. */
export function listingSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "listing";
}

function exportExtension(fileName: string): PlannedPhoto["ext"] {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "png" || ext === "webp") return ext;
  throw new Error("Unsupported stored image type");
}

function planExport(listing: Listing): PlannedPhoto[] {
  const selection = exportSelection(listing.photos);
  if (!canExport(selection)) throw new HttpError(409, "Nothing approved to export");
  const width = Math.max(2, String(selection.included.length).length);
  const perRoom = new Map<string, number>();
  return selection.included.map(({ photo, source }, index) => {
    const k = (perRoom.get(photo.roomType) ?? 0) + 1;
    perRoom.set(photo.roomType, k);
    const room = ROOM_TYPE_LABELS[photo.roomType].toLowerCase().replaceAll(" ", "-");
    const stem = `${String(index + 1).padStart(width, "0")}-${room}-${k}`;
    const file = source === "edited" ? bestAttempt(photo)!.editedFile! : photo.originalFile;
    return { photo, source, stem, file, ext: exportExtension(file) };
  });
}

function sourcePath(item: PlannedPhoto, fileName: string): string {
  return getPhotoFilePath(item.photo.listingId, item.photo.id, fileName);
}

/** Every file the export reads: the exported image, plus the original for a preview. */
function sourceFiles(plan: PlannedPhoto[]): string[] {
  return plan.flatMap((item) => {
    const files = [sourcePath(item, item.file)];
    if (item.source === "edited") files.push(sourcePath(item, item.photo.originalFile));
    return files;
  });
}

async function checkSize(files: string[], maxBytes: number): Promise<void> {
  let total = 0;
  for (const file of files) total += (await fs.stat(file)).size;
  if (total > maxBytes) throw new HttpError(413, "Export too large");
}

/** Re-encodes an edited image in its own format, dropping all metadata except the ICC profile. */
async function cleanEdited(bytes: Buffer, ext: PlannedPhoto["ext"]): Promise<Buffer> {
  const image = sharp(bytes).rotate().keepIccProfile();
  if (ext === "jpg") return image.jpeg({ quality: 92 }).toBuffer();
  if (ext === "webp") return image.webp({ quality: 92 }).toBuffer();
  return image.png().toBuffer();
}

function previewHalf(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    .resize({ ...PREVIEW_HALF, fit: "contain", background: WHITE })
    .png()
    .toBuffer();
}

/** Side-by-side before (left) / after (right) JPEG on a white canvas, no labels or metadata. */
async function buildPreview(original: Buffer, edited: Buffer): Promise<Buffer> {
  const [before, after] = await Promise.all([previewHalf(original), previewHalf(edited)]);
  return sharp({
    create: { width: PREVIEW_HALF.width * 2 + PREVIEW_GUTTER, height: PREVIEW_HALF.height, channels: 3, background: WHITE },
  })
    .composite([
      { input: before, left: 0, top: 0 },
      { input: after, left: PREVIEW_HALF.width + PREVIEW_GUTTER, top: 0 },
    ])
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
}

/** Throws unless every entry name is a plain, unique `photos/` or `previews/` image name. */
function checkEntryNames(names: string[]): void {
  if (new Set(names).size !== names.length) throw new Error("Duplicate export entry name");
  for (const name of names) {
    if (!ENTRY_NAME.test(name)) throw new Error("Invalid export entry name");
  }
}

/**
 * Builds the client zip for a listing: `photos/` holds approved enhanced images
 * (re-encoded without editor metadata) and skipped originals (byte for byte);
 * `previews/` holds one before/after JPEG per enhanced photo. 409 when nothing
 * approved, 413 when the source files exceed `maxBytes`.
 */
export async function buildExportZip(listing: Listing, maxBytes = MAX_EXPORT_BYTES): Promise<Uint8Array> {
  const plan = planExport(listing);
  const photoNames = plan.map((item) => `photos/${item.stem}.${item.ext}`);
  const previewNames = plan
    .filter((item) => item.source === "edited")
    .map((item) => `previews/${item.stem}-before-after.jpg`);
  checkEntryNames([...photoNames, ...previewNames]);
  await checkSize(sourceFiles(plan), maxBytes);

  const photos: Zippable = {};
  const previews: Zippable = {};
  for (const item of plan) {
    const bytes = await fs.readFile(sourcePath(item, item.file));
    if (item.source === "original") {
      photos[`photos/${item.stem}.${item.ext}`] = [new Uint8Array(bytes), { level: 0 }];
      continue;
    }
    const original = await fs.readFile(sourcePath(item, item.photo.originalFile));
    photos[`photos/${item.stem}.${item.ext}`] = [new Uint8Array(await cleanEdited(bytes, item.ext)), { level: 0 }];
    previews[`previews/${item.stem}-before-after.jpg`] = [
      new Uint8Array(await buildPreview(original, bytes)),
      { level: 0 },
    ];
  }
  return zipSync({ ...photos, ...previews });
}
