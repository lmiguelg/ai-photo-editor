import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, ctx, setupApiTestEnv } from "@/lib/api-test-helpers";
import { addPhoto, createListing } from "@/lib/store";
import { detailedImage } from "@/pipeline/test-helpers";
import { POST as runRoute } from "../run/route";
import { GET } from "./route";

const getDataDir = setupApiTestEnv("image-route");

let image: Buffer;

beforeAll(async () => {
  image = await detailedImage();
});

async function uploaded(originalName = "room.jpg") {
  const listing = await createListing({ name: "Beach house" });
  const photo = await addPhoto(listing.id, { roomType: "bedroom", originalName, data: image });
  return { listingId: listing.id, photoId: photo.id };
}

function getImage(ids: { listingId: string; photoId: string }, query = "") {
  const url = `${BASE_URL}/${ids.listingId}/photos/${ids.photoId}/image${query}`;
  return GET(new Request(url), ctx(ids));
}

async function run(ids: { listingId: string; photoId: string }) {
  const res = await runRoute(new Request(`${BASE_URL}/run`, { method: "POST" }), ctx(ids));
  expect(res.status).toBe(200);
}

const photoFile = (ids: { listingId: string; photoId: string }, name: string) =>
  path.join(getDataDir(), "listings", ids.listingId, "photos", ids.photoId, name);

async function expectNotFound(res: Response) {
  expect(res.status).toBe(404);
  expect(await res.text()).toBe('{"error":"Not found"}');
}

describe("GET /api/listings/[listingId]/photos/[photoId]/image", () => {
  it("serves the original by default with safe headers", async () => {
    const ids = await uploaded();
    const res = await getImage(ids);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="room.jpg"');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(image);
  });

  it("serves edited attempts after a run", async () => {
    const ids = await uploaded();
    await expectNotFound(await getImage(ids, "?kind=edited"));

    await run(ids);
    const edited = await fs.readFile(photoFile(ids, "attempt-0.jpg"));
    for (const query of ["?kind=edited", "?kind=edited&attempt=0"]) {
      const res = await getImage(ids, query);
      expect(res.status, query).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(res.headers.get("content-disposition")).toBeNull();
      expect(Buffer.from(await res.arrayBuffer())).toEqual(edited);
    }

    await expectNotFound(await getImage(ids, "?kind=edited&attempt=7"));
    for (const query of ["?kind=edited&attempt=-1", "?kind=edited&attempt=abc", "?kind=thumbnail"]) {
      expect([400, 404], query).toContain((await getImage(ids, query)).status);
    }
  });

  it("returns 404 when the stored file is missing on disk", async () => {
    const ids = await uploaded();
    await fs.rm(photoFile(ids, "original.jpg"));
    await expectNotFound(await getImage(ids));
  });

  it("ignores extra query parameters when picking the file", async () => {
    const ids = await uploaded();
    for (const query of ["?kind=original&file=../../listing.json", "?file=photo.json&path=..%2F..&name=x"]) {
      const res = await getImage(ids, query);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(Buffer.from(await res.arrayBuffer())).toEqual(image);
    }
  });

  it("cleans the original name before putting it in Content-Disposition", async () => {
    const ids = await uploaded('evil"\r\nX-Injected: 1.jpg');
    const res = await getImage(ids);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-injected")).toBeNull();
    const disposition = res.headers.get("content-disposition")!;
    const value = /^inline; filename="(.*)"$/.exec(disposition)?.[1];
    expect(value).toBe("evil___X-Injected_ 1.jpg");
    expect(value).not.toMatch(/["\r\n]/);
  });

  it("returns 404 for unknown or invalid ids", async () => {
    const { listingId } = await uploaded();
    for (const photoId of ["00000000-0000-4000-8000-000000000000", "..%2F.."]) {
      await expectNotFound(await getImage({ listingId, photoId }));
    }
  });
});
