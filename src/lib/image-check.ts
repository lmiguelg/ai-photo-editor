import sharp from "sharp";

// Shared image checks for uploads: the bytes decide the format.

export type ImageFormat = "jpg" | "png" | "webp";

/** Accepted file extension to the format `detectImageFormat` must find in the bytes. */
export const EXTENSION_FORMATS: ReadonlyMap<string, ImageFormat> = new Map([
  ["jpg", "jpg"],
  ["jpeg", "jpg"],
  ["png", "png"],
  ["webp", "webp"],
]);

const SHARP_FORMATS: ReadonlyMap<string, ImageFormat> = new Map([
  ["jpeg", "jpg"],
  ["png", "png"],
  ["webp", "webp"],
]);

/** The format sharp detects in `bytes`; null when it is not a jpeg, png or webp image. */
export async function detectImageFormat(bytes: Buffer | Uint8Array): Promise<ImageFormat | null> {
  try {
    const { format } = await sharp(bytes).metadata();
    return SHARP_FORMATS.get(format ?? "") ?? null;
  } catch {
    return null;
  }
}
