import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { prepareForVision } from "./images";
import { computeLocalMetrics, prefilter } from "./metrics";
import { detailedImage, uniformImage } from "./test-helpers";

describe("computeLocalMetrics and prefilter", () => {
  it("passes a detailed image of sufficient size", async () => {
    const metrics = await computeLocalMetrics(await detailedImage(1600, 1000));
    expect(metrics.width).toBe(1600);
    expect(metrics.height).toBe(1000);
    expect(metrics.sharpness).toBeGreaterThan(config.prefilter.minSharpness);
    expect(prefilter(metrics)).toEqual({ ok: true });
  });

  it("rejects a blurred image", async () => {
    const blurred = await sharp(await detailedImage(1600, 1000)).blur(20).jpeg().toBuffer();
    const result = prefilter(await computeLocalMetrics(blurred));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/blurry/);
  });

  it("rejects a uniform image", async () => {
    const result = prefilter(await computeLocalMetrics(await uniformImage()));
    expect(result.ok).toBe(false);
  });

  it("rejects an image that is too small", async () => {
    const result = prefilter(await computeLocalMetrics(await detailedImage(800, 500)));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/Too small/);
  });

  it("rejects near-black and blown-out images", async () => {
    expect(prefilter(await computeLocalMetrics(await uniformImage(1600, 1000, 5))).ok).toBe(false);
    const dark = { width: 1600, height: 1000, sharpness: 10, brightness: 5 };
    const bright = { ...dark, brightness: 250 };
    expect(prefilter(dark)).toMatchObject({ ok: false, reason: expect.stringMatching(/Too dark/) });
    expect(prefilter(bright)).toMatchObject({ ok: false, reason: expect.stringMatching(/Too bright/) });
  });

  it("measures brightness on greyscale and dimensions after EXIF rotation", async () => {
    const red = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const metrics = await computeLocalMetrics(red);
    expect(metrics.width).toBe(1000);
    expect(metrics.height).toBe(1600);
    // Pure red has a red-channel mean of ~255; its greyscale lightness is far lower.
    expect(metrics.brightness).toBeGreaterThan(40);
    expect(metrics.brightness).toBeLessThan(200);
  });

  it("gives a similar sharpness regardless of resolution", async () => {
    const small = await computeLocalMetrics(await detailedImage(1600, 1000, 16));
    const large = await computeLocalMetrics(await detailedImage(3200, 2000, 32));
    expect(large.sharpness / small.sharpness).toBeGreaterThan(0.7);
    expect(large.sharpness / small.sharpness).toBeLessThan(1.4);
  });

  it("throws on non-image bytes", async () => {
    await expect(computeLocalMetrics(Buffer.from("nope"))).rejects.toThrow();
  });
});

describe("prepareForVision", () => {
  it("auto-rotates, downscales to the configured long edge and encodes JPEG", async () => {
    const rotated = await sharp(await detailedImage(3000, 2000)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const prepared = await prepareForVision(rotated);
    expect(prepared.mediaType).toBe("image/jpeg");
    expect(prepared.height).toBe(config.vision.maxLongEdgePx);
    expect(prepared.width).toBeLessThan(prepared.height);
    const meta = await sharp(Buffer.from(prepared.data, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([prepared.width, prepared.height]);
  });

  it("never enlarges a small image", async () => {
    const prepared = await prepareForVision(await detailedImage(300, 200));
    expect([prepared.width, prepared.height]).toEqual([300, 200]);
  });
});
