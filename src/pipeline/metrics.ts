import sharp from "sharp";
import { config as defaultConfig, type PipelineConfig } from "./config";

export interface LocalMetrics {
  /** Dimensions after EXIF auto-rotation. */
  width: number;
  height: number;
  /** Laplacian-based sharpness of a fixed-width greyscale copy (resolution independent). */
  sharpness: number;
  /** Mean greyscale value, 0-255. */
  brightness: number;
}

export type PrefilterResult = { ok: true } | { ok: false; reason: string };

/** Free local measurements with `sharp`. Throws if the bytes are not a readable image. */
export async function computeLocalMetrics(
  bytes: Buffer,
  cfg: PipelineConfig = defaultConfig,
): Promise<LocalMetrics> {
  const meta = await sharp(bytes).metadata();
  const { width, height } = meta.autoOrient;
  // `stats()` reads the input pixels, not the pipeline output, so render the
  // greyscale copy first and measure that.
  const grey = await sharp(bytes)
    .rotate()
    .greyscale()
    .resize({ width: cfg.prefilter.sharpnessWidthPx })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stats = await sharp(grey.data, {
    raw: { width: grey.info.width, height: grey.info.height, channels: grey.info.channels },
  }).stats();
  return { width, height, sharpness: stats.sharpness, brightness: stats.channels[0].mean };
}

export function prefilter(metrics: LocalMetrics, cfg: PipelineConfig = defaultConfig): PrefilterResult {
  const p = cfg.prefilter;
  const longEdge = Math.max(metrics.width, metrics.height);
  const shortEdge = Math.min(metrics.width, metrics.height);
  if (longEdge < p.minLongEdgePx || shortEdge < p.minShortEdgePx) {
    return {
      ok: false,
      reason: `Too small: ${metrics.width}x${metrics.height}px (need at least ${p.minLongEdgePx}x${p.minShortEdgePx}px)`,
    };
  }
  if (metrics.brightness < p.minBrightness) {
    return { ok: false, reason: `Too dark: mean brightness ${metrics.brightness.toFixed(0)}/255` };
  }
  if (metrics.brightness > p.maxBrightness) {
    return { ok: false, reason: `Too bright: mean brightness ${metrics.brightness.toFixed(0)}/255` };
  }
  if (metrics.sharpness < p.minSharpness) {
    return { ok: false, reason: `Too blurry or featureless: sharpness ${metrics.sharpness.toFixed(2)}` };
  }
  return { ok: true };
}
