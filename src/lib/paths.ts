import path from "node:path";
import { IdSchema } from "@/pipeline/schemas";
import { StoreError } from "./errors";

/** Absolute data directory: `DATA_DIR` if set, else `<cwd>/data`. Read on every call. */
export function getDataDir(): string {
  const dir = process.env.DATA_DIR;
  return dir ? path.resolve(dir) : path.resolve(process.cwd(), "data");
}

/**
 * Joins `segments` onto `base` and throws unless the result is `base` itself or
 * inside it. Both `/` and `\` count as separators on every platform.
 */
export function safeJoin(base: string, ...segments: string[]): string {
  const root = path.resolve(base);
  const target = path.resolve(root, ...segments.map((s) => s.replaceAll("\\", "/")));
  const rel = path.relative(root, target);
  if (rel === "") return target;
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new StoreError("invalid", `Path escapes base directory: ${segments.join(", ")}`);
  }
  return target;
}

function assertId(id: string): string {
  if (!IdSchema.safeParse(id).success) {
    throw new StoreError("invalid", `Invalid id: ${JSON.stringify(id)}`);
  }
  return id;
}

export function listingsDir(): string {
  return safeJoin(getDataDir(), "listings");
}

export function listingDir(listingId: string): string {
  return safeJoin(listingsDir(), assertId(listingId));
}

export function photosDir(listingId: string): string {
  return safeJoin(listingDir(listingId), "photos");
}

export function photoDir(listingId: string, photoId: string): string {
  return safeJoin(photosDir(listingId), assertId(photoId));
}
