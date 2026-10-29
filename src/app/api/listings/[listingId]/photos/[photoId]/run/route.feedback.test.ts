import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, ctx, setupApiTestEnv } from "@/lib/api-test-helpers";
import { readFeedback } from "@/lib/feedback";
import { addPhoto, createListing, getPhoto } from "@/lib/store";
import { detailedImage } from "@/pipeline/test-helpers";
import { POST } from "./route";

// Fakes whose QA fails the first attempt and passes the second, so the run logs one qa_fail.
vi.mock("@/pipeline/providers", async () => {
  const fakes = await import("@/pipeline/test-helpers");
  const scores = { realism: 9, lighting: 9, coherence: 9 };
  return {
    createProviders: () => ({
      vision: new fakes.ScriptedVision()
        .on("router", { reply: { route: "enhance", reason: "Dark" } })
        .on("synthesizer", { reply: { prompt: "Brighten evenly" } })
        .on("refiner", { reply: { prompt: "Brighten evenly, keep the sofa" } })
        .on(
          "qa",
          { reply: { pass: false, scores: { ...scores, faithfulness: 5 }, reason: "Sofa removed" } },
          { reply: { pass: true, scores: { ...scores, faithfulness: 9 }, reason: "Good" } },
        ),
      editor: new fakes.FakeEditor(0.04),
    }),
  };
});

const getDataDir = setupApiTestEnv("run-route-feedback");

let image: Buffer;

beforeAll(async () => {
  image = await detailedImage();
});

async function run() {
  const listing = await createListing({ name: "Beach house" });
  const { id: photoId } = await addPhoto(listing.id, { roomType: "living_room", originalName: "a.jpg", data: image });
  const url = `${BASE_URL}/${listing.id}/photos/${photoId}/run`;
  const res = await POST(new Request(url, { method: "POST" }), ctx({ listingId: listing.id, photoId }));
  return { res, listingId: listing.id, photoId };
}

describe("POST .../run feedback logging", () => {
  it("logs the failed attempt and returns the passed photo", async () => {
    const { res } = await run();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("passed");
    const { entries } = await readFeedback();
    expect(entries.map((entry) => [entry.kind, entry.attemptIndex, entry.roomType])).toEqual([
      ["qa_fail", 0, "living_room"],
    ]);
  });

  it("returns the same result when the feedback log cannot be written", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await fs.mkdir(path.join(getDataDir(), "feedback.jsonl"));

    const { res, listingId, photoId } = await run();
    expect(res.status).toBe(200);
    const photo = await res.json();
    expect(photo.status).toBe("passed");
    expect(photo.error).toBeNull();
    expect((await getPhoto(listingId, photoId))?.status).toBe("passed");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
