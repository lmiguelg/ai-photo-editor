import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import {
  FileNameSchema,
  IdSchema,
  ListingRecordSchema,
  NewListingInputSchema,
  PhotoSchema,
  RoomTypeSchema,
  type Listing,
  type ListingRecord,
  type NewListingInput,
  type Photo,
  type RoomType,
} from "@/pipeline/schemas";
import { StoreError } from "./errors";
import { listingDir, listingsDir, photoDir, photosDir, safeJoin } from "./paths";

export { StoreError } from "./errors";

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new StoreError("invalid", `Invalid ${what}: ${result.error.message}`);
  }
  return result.data;
}

/** Reads and validates a JSON file; `null` when it doesn't exist. */
async function readJson<T extends z.ZodType>(
  file: string,
  schema: T,
  what: string,
): Promise<z.infer<T> | null> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  return parseOrThrow(schema, JSON.parse(text), what);
}

/** Writes JSON atomically: temp file in the same folder, then rename over the target. */
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = safeJoin(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

function listingFile(listingId: string): string {
  return safeJoin(listingDir(listingId), "listing.json");
}

function photoFile(listingId: string, photoId: string): string {
  return safeJoin(photoDir(listingId, photoId), "photo.json");
}

async function readListingRecord(listingId: string): Promise<ListingRecord | null> {
  return readJson(listingFile(listingId), ListingRecordSchema, "listing");
}

async function readPhoto(listingId: string, photoId: string): Promise<Photo | null> {
  return readJson(photoFile(listingId, photoId), PhotoSchema, "photo");
}

async function readDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

export async function createListing(input: NewListingInput): Promise<Listing> {
  const { name, clientName } = parseOrThrow(NewListingInputSchema, input, "listing input");
  const now = new Date().toISOString();
  const record = parseOrThrow(
    ListingRecordSchema,
    { id: randomUUID(), name, clientName: clientName ?? null, createdAt: now, updatedAt: now },
    "listing",
  );
  await fs.mkdir(photosDir(record.id), { recursive: true });
  await writeJsonAtomic(listingFile(record.id), record);
  return { ...record, photos: [] };
}

export async function getListing(id: string): Promise<Listing | null> {
  if (!IdSchema.safeParse(id).success) return null;
  const record = await readListingRecord(id);
  if (!record) return null;

  const photos: Photo[] = [];
  for (const photoId of await readDirNames(photosDir(id))) {
    if (!IdSchema.safeParse(photoId).success) continue;
    const photo = await readPhoto(id, photoId);
    if (photo) photos.push(photo);
  }
  photos.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { ...record, photos };
}

export async function listListings(): Promise<Listing[]> {
  const listings: Listing[] = [];
  for (const id of await readDirNames(listingsDir())) {
    if (!IdSchema.safeParse(id).success) continue;
    // A folder without a valid listing.json is not a listing; skip it.
    const record = await readListingRecord(id).catch(() => null);
    if (!record) continue;
    const listing = await getListing(id);
    if (listing) listings.push(listing);
  }
  listings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return listings;
}

export interface NewPhotoInput {
  roomType: RoomType;
  originalName: string;
  data: Buffer | Uint8Array;
}

export async function addPhoto(listingId: string, input: NewPhotoInput): Promise<Photo> {
  const roomType = parseOrThrow(RoomTypeSchema, input.roomType, "room type");
  const record = IdSchema.safeParse(listingId).success ? await readListingRecord(listingId) : null;
  if (!record) throw new StoreError("not_found", `Listing not found: ${listingId}`);

  const ext = path.extname(input.originalName).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new StoreError("invalid", `Unsupported file type: ${JSON.stringify(input.originalName)}`);
  }

  const now = new Date().toISOString();
  const photo = parseOrThrow(
    PhotoSchema,
    {
      id: randomUUID(),
      listingId,
      roomType,
      originalName: input.originalName,
      originalFile: `original.${ext}`,
      status: "uploaded",
      attempts: [],
      bestAttemptIndex: null,
      costUsd: 0,
      decision: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    } satisfies Photo,
    "photo",
  );

  const dir = photoDir(listingId, photo.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(safeJoin(dir, photo.originalFile), input.data);
  await writeJsonAtomic(photoFile(listingId, photo.id), photo);
  await writeJsonAtomic(listingFile(listingId), { ...record, updatedAt: now });
  return photo;
}

export async function updatePhoto(
  listingId: string,
  photoId: string,
  update: (photo: Photo) => Photo,
): Promise<Photo> {
  const valid = IdSchema.safeParse(listingId).success && IdSchema.safeParse(photoId).success;
  const current = valid ? await readPhoto(listingId, photoId) : null;
  if (!current) throw new StoreError("not_found", `Photo not found: ${listingId}/${photoId}`);

  const updated = update(structuredClone(current));
  const next = parseOrThrow(
    PhotoSchema,
    {
      ...updated,
      id: current.id,
      listingId: current.listingId,
      originalFile: current.originalFile,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    },
    "photo",
  );
  await writeJsonAtomic(photoFile(listingId, photoId), next);
  return next;
}

/** Absolute path of a stored image file in a photo's folder. */
export function getPhotoFilePath(listingId: string, photoId: string, fileName: string): string {
  const name = parseOrThrow(FileNameSchema, fileName, "file name");
  return safeJoin(photoDir(listingId, photoId), name);
}
