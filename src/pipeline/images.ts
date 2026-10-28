import sharp from "sharp";
import { config } from "./config";

export interface PreparedImage {
  /** Base64-encoded JPEG bytes. */
  data: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

/**
 * Auto-rotates, downscales (never enlarges) to `maxLongEdgePx` and re-encodes as JPEG.
 * Every image sent to a vision call goes through this; the editor input uses it with
 * `config.fal.maxLongEdgePx`.
 */
export async function prepareForVision(
  bytes: Buffer,
  maxLongEdgePx: number = config.vision.maxLongEdgePx,
  jpegQuality: number = config.vision.jpegQuality,
): Promise<PreparedImage> {
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize({ width: maxLongEdgePx, height: maxLongEdgePx, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: jpegQuality })
    .toBuffer({ resolveWithObject: true });
  return { data: data.toString("base64"), mediaType: "image/jpeg", width: info.width, height: info.height };
}
