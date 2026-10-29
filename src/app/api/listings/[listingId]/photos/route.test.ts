import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BASE_URL, ctx, imageFile, multipartRequest, setupApiTestEnv } from "@/lib/api-test-helpers";
import { MAX_UPLOAD_BYTES } from "@/lib/http";
import { createListing } from "@/lib/store";
import { PhotoSchema } from "@/pipeline/schemas";
import { detailedImage } from "@/pipeline/test-helpers";
import { POST } from "./route";

const getDataDir = setupApiTestEnv("upload-route");

let jpeg: Buffer;
let png: Buffer;
let listingId: string;

beforeAll(async () => {
  jpeg = await detailedImage();
  png = await sharp(jpeg).png().toBuffer();
});

beforeEach(async () => {
  listingId = (await createListing({ name: "Beach house" })).id;
});

async function upload(fields: Parameters<typeof multipartRequest>[1], id = listingId) {
  const request = await multipartRequest(`${BASE_URL}/${id}/photos`, fields);
  return POST(request, ctx({ listingId: id }));
}

describe("POST /api/listings/[listingId]/photos", () => {
  it("stores an uploaded JPEG", async () => {
    const res = await upload({ file: imageFile(jpeg, "room.jpg"), roomType: "bedroom" });
    expect(res.status).toBe(201);
    const photo = PhotoSchema.parse(await res.json());
    expect(photo.status).toBe("uploaded");
    expect(photo.roomType).toBe("bedroom");
    expect(photo.originalFile).toBe("original.jpg");
    expect(photo.originalName).toBe("room.jpg");

    const file = path.join(getDataDir(), "listings", listingId, "photos", photo.id, "original.jpg");
    expect(await fs.readFile(file)).toEqual(jpeg);
  });

  it("accepts PNG bytes named .png", async () => {
    const res = await upload({ file: imageFile(png, "room.PNG"), roomType: "kitchen" });
    expect(res.status).toBe(201);
    expect((await res.json()).originalFile).toBe("original.png");
  });

  it("rejects invalid uploads with 400 and never echoes names or ids", async () => {
    const cases: [string, Parameters<typeof multipartRequest>[1], string][] = [
      ["bad room type", { file: imageFile(jpeg, "secret-room.jpg"), roomType: "garage" }, "Invalid request"],
      ["missing file", { roomType: "bedroom" }, "Invalid request"],
      [
        "two files",
        { file: [imageFile(jpeg, "secret-a.jpg"), imageFile(jpeg, "secret-b.jpg")], roomType: "bedroom" },
        "Invalid request",
      ],
      ["file as text", { file: "secret.jpg", roomType: "bedroom" }, "Invalid request"],
      ["txt name", { file: imageFile(jpeg, "secret-notes.txt"), roomType: "bedroom" }, "Unsupported image type"],
      [
        "text bytes named .jpg",
        { file: new File(["hello, not an image"], "secret-fake.jpg"), roomType: "bedroom" },
        "Unsupported image type",
      ],
      ["PNG bytes named .jpg", { file: imageFile(png, "secret-x.jpg"), roomType: "bedroom" }, "Unsupported image type"],
      [
        "svg",
        { file: new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "secret-x.svg"), roomType: "bedroom" },
        "Unsupported image type",
      ],
      ["empty name", { file: imageFile(jpeg, ""), roomType: "bedroom" }, "Invalid request"],
      ["name over 255", { file: imageFile(jpeg, `${"a".repeat(256)}.jpg`), roomType: "bedroom" }, "Invalid request"],
    ];
    for (const [label, fields, message] of cases) {
      const res = await upload(fields);
      expect(res.status, label).toBe(400);
      const body = await res.text();
      expect(body, label).toBe(JSON.stringify({ error: message }));
      expect(body, label).not.toContain("secret");
      expect(body, label).not.toContain(listingId);
    }
    const photosDir = path.join(getDataDir(), "listings", listingId, "photos");
    expect(await fs.readdir(photosDir)).toEqual([]);
  });

  it("returns 404 for unknown or invalid listings", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    for (const id of [unknown, "..%2F.."]) {
      const res = await upload({ file: imageFile(jpeg, "secret-room.jpg"), roomType: "bedroom" }, id);
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).toBe('{"error":"Not found"}');
      expect(body).not.toContain("secret");
      expect(body).not.toContain(unknown);
    }
  });

  it("returns 413 when Content-Length is over the cap and 411 when it is missing", async () => {
    const valid = await multipartRequest(`${BASE_URL}/${listingId}/photos`, {
      file: imageFile(jpeg, "room.jpg"),
      roomType: "bedroom",
    });
    const body = await valid.arrayBuffer();
    const contentType = valid.headers.get("content-type")!;

    const tooLarge = new Request(valid.url, {
      method: "POST",
      headers: { "content-type": contentType, "content-length": String(MAX_UPLOAD_BYTES * 2) },
      body,
    });
    expect((await POST(tooLarge, ctx({ listingId }))).status).toBe(413);

    const noLength = new Request(valid.url, { method: "POST", headers: { "content-type": contentType }, body });
    expect((await POST(noLength, ctx({ listingId }))).status).toBe(411);
  });

  it("returns 413 when the parsed file is over MAX_UPLOAD_BYTES", async () => {
    // Within the Content-Length allowance, so only the parsed-size check can reject it.
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    const res = await upload({ file: imageFile(big, "room.jpg"), roomType: "bedroom" });
    expect(res.status).toBe(413);
  });
});
