import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { detailedImage, FakeEditor, ScriptedVision } from "@/pipeline/test-helpers";
import { setupApiTestEnv } from "./api-test-helpers";
import { StoreError } from "./errors";
import { isPhotoRunning, processPhoto } from "./process-photo";
import { addPhoto, createListing, getPhoto, updatePhoto } from "./store";

const getDataDir = setupApiTestEnv("process-photo");

const ENHANCE = { reply: { route: "enhance", reason: "Dark room" }, costUsd: 0.002 };
const PROMPT = { reply: { prompt: "Brighten evenly, keep everything" }, costUsd: 0.01 };
const QA_PASS = {
  reply: { pass: true, scores: { faithfulness: 9, realism: 9, lighting: 9, coherence: 9 }, reason: "Good" },
  costUsd: 0.015,
};
const RUN_COST = 0.002 + 0.01 + 0.04 + 0.015;

let image: Buffer;

beforeAll(async () => {
  image = await detailedImage();
});

async function uploaded() {
  const listing = await createListing({ name: "Beach house" });
  const photo = await addPhoto(listing.id, { roomType: "bedroom", originalName: "room.jpg", data: image });
  return { listingId: listing.id, photoId: photo.id };
}

const passingVision = () => new ScriptedVision().on("router", ENHANCE).on("synthesizer", PROMPT).on("qa", QA_PASS);

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (e: unknown) => e,
  );
}

describe("processPhoto", () => {
  it("persists attempts and edited files, and accumulates cost across runs", async () => {
    const { listingId, photoId } = await uploaded();

    const first = await processPhoto(listingId, photoId, { vision: passingVision(), editor: new FakeEditor(0.04) });
    expect(first.status).toBe("passed");
    expect(first.costUsd).toBeCloseTo(RUN_COST);
    expect(first.attempts).toHaveLength(1);
    expect(first.attempts[0].editedFile).toBe("attempt-0.jpg");
    const file = path.join(getDataDir(), "listings", listingId, "photos", photoId, "attempt-0.jpg");
    expect((await fs.stat(file)).size).toBeGreaterThan(0);
    expect(await getPhoto(listingId, photoId)).toEqual(first);

    await updatePhoto(listingId, photoId, (photo) => ({
      ...photo,
      decision: { verdict: "approved", note: "", decidedAt: new Date().toISOString() },
    }));
    const second = await processPhoto(listingId, photoId, { vision: passingVision(), editor: new FakeEditor(0.04) });
    expect(second.costUsd).toBeCloseTo(RUN_COST * 2);
    expect(second.attempts).toHaveLength(1);
    expect(second.decision).toBeNull();
  });

  it("stores a provider failure as failed with the error cut to 500 characters", async () => {
    const { listingId, photoId } = await uploaded();
    const vision = new ScriptedVision().on("router", ENHANCE).on("synthesizer", PROMPT);
    const editor = new FakeEditor(0.04, new Error("<script>" + "x".repeat(5000)));

    const photo = await processPhoto(listingId, photoId, { vision, editor });
    expect(photo.status).toBe("failed");
    expect(photo.error).not.toBeNull();
    expect(photo.error!.length).toBeLessThanOrEqual(500);
    expect(photo.attempts).toEqual([]);
    expect(photo.costUsd).toBeCloseTo(0.012);
  });

  it("marks the photo failed with a fixed error when it throws after the claim", async () => {
    const { listingId, photoId } = await uploaded();
    await fs.rm(path.join(getDataDir(), "listings", listingId, "photos", photoId, "original.jpg"));

    const err = await caught(processPhoto(listingId, photoId, { vision: passingVision(), editor: new FakeEditor() }));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(StoreError);
    const photo = await getPhoto(listingId, photoId);
    expect(photo?.status).toBe("failed");
    expect(photo?.error).toBe("Run failed");
  });

  it("leaves no edited file when the editor returns non-image bytes", async () => {
    const { listingId, photoId } = await uploaded();
    const editor = {
      edit: async () => ({ image: Buffer.from("not an image"), mimeType: "image/jpeg", costUsd: 0.04 }),
    };
    // QA can't read the non-image either, so the run fails after the attempt is recorded.
    const photo = await processPhoto(listingId, photoId, { vision: passingVision(), editor });
    expect(photo.attempts.every((attempt) => attempt.editedFile === null)).toBe(true);
    const files = await fs.readdir(path.join(getDataDir(), "listings", listingId, "photos", photoId));
    expect(files.filter((name) => name.startsWith("attempt-"))).toEqual([]);
  });

  it("refuses to run a photo that is already processing", async () => {
    const { listingId, photoId } = await uploaded();
    await updatePhoto(listingId, photoId, (photo) => ({ ...photo, status: "processing" }));
    const vision = passingVision();

    const err = await caught(processPhoto(listingId, photoId, { vision, editor: new FakeEditor() }));
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).code).toBe("conflict");
    expect(vision.requests).toHaveLength(0);
  });

  it("marks the photo running only while the run is in flight", async () => {
    const { listingId, photoId } = await uploaded();
    const seen: boolean[] = [];
    const vision = passingVision();
    const complete = vision.complete.bind(vision);
    vision.complete = async (request) => {
      seen.push(isPhotoRunning(listingId, photoId));
      return complete(request);
    };

    expect(isPhotoRunning(listingId, photoId)).toBe(false);
    await processPhoto(listingId, photoId, { vision, editor: new FakeEditor() });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(isPhotoRunning(listingId, photoId)).toBe(false);

    const failing = new ScriptedVision().on("router", { error: new Error("boom") });
    const failingSeen: boolean[] = [];
    const failingComplete = failing.complete.bind(failing);
    failing.complete = async (request) => {
      failingSeen.push(isPhotoRunning(listingId, photoId));
      return failingComplete(request);
    };
    const photo = await processPhoto(listingId, photoId, { vision: failing, editor: new FakeEditor() });
    expect(photo.status).toBe("failed");
    expect(failingSeen).toEqual([true]);
    expect(isPhotoRunning(listingId, photoId)).toBe(false);
  });

  it("is not running after a run that throws after the claim", async () => {
    const { listingId, photoId } = await uploaded();
    await fs.rm(path.join(getDataDir(), "listings", listingId, "photos", photoId, "original.jpg"));
    await caught(processPhoto(listingId, photoId, { vision: passingVision(), editor: new FakeEditor() }));
    expect(isPhotoRunning(listingId, photoId)).toBe(false);
  });
});
