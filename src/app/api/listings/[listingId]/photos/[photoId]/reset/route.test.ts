import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, ctx, setupApiTestEnv } from "@/lib/api-test-helpers";
import { processPhoto } from "@/lib/process-photo";
import { addPhoto, createListing, getPhoto, updatePhoto } from "@/lib/store";
import { MockImageEditor, MockVisionProvider } from "@/pipeline/providers/mock";
import type { VisionRequest, VisionResponse } from "@/pipeline/providers/types";
import { PhotoSchema } from "@/pipeline/schemas";
import { detailedImage } from "@/pipeline/test-helpers";
import { POST } from "./route";

const getDataDir = setupApiTestEnv("reset-route");

let image: Buffer;

beforeAll(async () => {
  image = await detailedImage();
});

async function uploaded() {
  const listing = await createListing({ name: "Beach house" });
  const photo = await addPhoto(listing.id, { roomType: "bedroom", originalName: "room.jpg", data: image });
  return { listingId: listing.id, photoId: photo.id };
}

function reset(ids: { listingId: string; photoId: string }) {
  const url = `${BASE_URL}/${ids.listingId}/photos/${ids.photoId}/reset`;
  return POST(new Request(url, { method: "POST" }), ctx(ids));
}

/** Mock vision whose first call waits until `release()`; `started` resolves when it is reached. */
class GatedVision extends MockVisionProvider {
  release: () => void = () => {};
  readonly started: Promise<void>;
  private readonly gate: Promise<void>;
  private markStarted: () => void = () => {};

  constructor() {
    super();
    this.started = new Promise((resolve) => (this.markStarted = resolve));
    this.gate = new Promise((resolve) => (this.release = resolve));
  }

  override async complete(request: VisionRequest): Promise<VisionResponse> {
    this.markStarted();
    await this.gate;
    return super.complete(request);
  }
}

describe("POST /api/listings/[listingId]/photos/[photoId]/reset", () => {
  it("resets a stuck processing photo to failed and removes a stale lock", async () => {
    const ids = await uploaded();
    await updatePhoto(ids.listingId, ids.photoId, (photo) => ({ ...photo, status: "processing", costUsd: 0.05 }));
    const lock = path.join(getDataDir(), "listings", ids.listingId, "photos", ids.photoId, ".run.lock");
    await fs.writeFile(lock, "");

    const res = await reset(ids);
    expect(res.status).toBe(200);
    const photo = PhotoSchema.parse(await res.json());
    expect(photo.status).toBe("failed");
    expect(photo.error).toBe("Run interrupted");
    expect(photo.costUsd).toBe(0.05);
    await expect(fs.stat(lock)).rejects.toThrow();
  });

  it("returns 409 when the photo is not stuck", async () => {
    const ids = await uploaded();
    const res = await reset(ids);
    expect(res.status).toBe(409);
    expect(await res.text()).toBe('{"error":"Photo is not stuck"}');
    expect((await getPhoto(ids.listingId, ids.photoId))?.status).toBe("uploaded");
  });

  it("returns 409 Photo is running while a run is in flight and leaves it alone", async () => {
    const ids = await uploaded();
    const vision = new GatedVision();
    const run = processPhoto(ids.listingId, ids.photoId, { vision, editor: new MockImageEditor() });
    await vision.started;

    const res = await reset(ids);
    expect(res.status).toBe(409);
    expect(await res.text()).toBe('{"error":"Photo is running"}');
    expect((await getPhoto(ids.listingId, ids.photoId))?.status).toBe("processing");

    vision.release();
    expect((await run).status).toBe("passed");
  });

  it("returns 404 for unknown or invalid ids", async () => {
    const { listingId } = await uploaded();
    for (const photoId of ["00000000-0000-4000-8000-000000000000", "..%2F.."]) {
      const res = await reset({ listingId, photoId });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('{"error":"Not found"}');
    }
  });
});
