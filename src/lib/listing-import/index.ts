import type { ListingImportInput } from "@/lib/api-schemas";
import { HttpError } from "@/lib/http";
import { detectImageFormat, type ImageFormat } from "@/lib/image-check";
import { MAX_UPLOAD_BYTES } from "@/lib/review";
import { addPhoto, createListing, getListing } from "@/lib/store";
import { providerMode } from "@/pipeline/providers";
import type { Listing, Photo } from "@/pipeline/schemas";
import { extractImageUrls } from "./extract";
import { fixtureTransport } from "./fixture";
import { MAX_IMPORT_PAGE_BYTES, MAX_IMPORT_PHOTOS, MAX_IMPORT_TOTAL_BYTES } from "./limits";
import { safeGet, type Transport } from "./net";
import { isImageHost, isPageHost, SITE_LABELS } from "./sites";

export type { Transport } from "./net";

export interface ImportResult {
  listing: Listing;
  imported: number;
  skipped: number;
}

interface CheckedImage {
  data: Buffer;
  format: ImageFormat;
}

/** The only place that picks the transport: the fixture in full mock mode, the network otherwise. */
export function importTransport(env: Record<string, string | undefined>): Transport {
  const mode = providerMode(env);
  return mode.vision === "mock" && mode.editor === "mock" ? fixtureTransport : safeGet;
}

/** Fetches one image and checks it like an upload; null when it fails any check or the fetch. */
async function fetchImage(url: URL, transport: Transport, isAllowedHost: (hostname: string) => boolean) {
  try {
    const { contentType, body } = await transport(url, { maxBytes: MAX_UPLOAD_BYTES, accept: "image/*", isAllowedHost });
    if (!contentType.toLowerCase().startsWith("image/")) return { bytes: body.byteLength, image: null };
    const format = await detectImageFormat(body);
    return { bytes: body.byteLength, image: format ? { data: body, format } : null };
  } catch {
    return { bytes: 0, image: null };
  }
}

/**
 * Fetches a listing page and its photos one at a time, then creates a listing with the
 * photos that pass the checks, in page order. Nothing is written when none pass.
 */
export async function importListing(input: ListingImportInput, transport: Transport): Promise<ImportResult> {
  const { site, url } = input.url;

  let html: string;
  try {
    const page = await transport(url, { maxBytes: MAX_IMPORT_PAGE_BYTES, accept: "text/html", isAllowedHost: isPageHost });
    html = page.body.toString("utf8");
  } catch {
    throw new HttpError(502, "Could not fetch listing");
  }

  const isAllowedHost = isImageHost(site);
  const images: CheckedImage[] = [];
  let skipped = 0;
  let totalBytes = 0;
  for (const imageUrl of extractImageUrls(html, site).slice(0, MAX_IMPORT_PHOTOS)) {
    if (totalBytes >= MAX_IMPORT_TOTAL_BYTES) break;
    const { bytes, image } = await fetchImage(new URL(imageUrl), transport, isAllowedHost);
    totalBytes += bytes;
    if (image) images.push(image);
    else skipped += 1;
  }
  if (images.length === 0) throw new HttpError(422, "No photos found");

  const listing = await createListing({
    name: input.name ?? `Imported from ${SITE_LABELS[site]}`,
    clientName: input.clientName,
  });
  const photos: Photo[] = [];
  for (const [index, image] of images.entries()) {
    const originalName = `${site}-${String(index + 1).padStart(2, "0")}.${image.format}`;
    photos.push(await addPhoto(listing.id, { roomType: "other", originalName, data: image.data }));
  }
  const stored = await getListing(listing.id);
  return { listing: { ...(stored ?? listing), photos }, imported: photos.length, skipped };
}
