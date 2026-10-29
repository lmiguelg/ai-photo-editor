import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { detailedImage } from "@/pipeline/test-helpers";
import { detectImageFormat, EXTENSION_FORMATS } from "./image-check";

describe("detectImageFormat", () => {
  it("names jpeg, png and webp bytes by their stored extension", async () => {
    const jpeg = await detailedImage(64, 64);
    expect(await detectImageFormat(jpeg)).toBe("jpg");
    expect(await detectImageFormat(await sharp(jpeg).png().toBuffer())).toBe("png");
    expect(await detectImageFormat(await sharp(jpeg).webp().toBuffer())).toBe("webp");
  });

  it("is null for other images and non-image bytes", async () => {
    const jpeg = await detailedImage(64, 64);
    expect(await detectImageFormat(await sharp(jpeg).gif().toBuffer())).toBeNull();
    expect(await detectImageFormat(Buffer.from("not an image"))).toBeNull();
    expect(await detectImageFormat(Buffer.alloc(0))).toBeNull();
  });

  it("maps every accepted extension to a format", () => {
    expect(Object.fromEntries(EXTENSION_FORMATS)).toEqual({ jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp" });
  });
});
