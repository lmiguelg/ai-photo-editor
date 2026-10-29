import { beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, ctx, setupApiTestEnv } from "@/lib/api-test-helpers";
import { addPhoto, createListing } from "@/lib/store";
import { detailedImage } from "@/pipeline/test-helpers";
import { POST } from "./route";

// The route always builds its providers through the providers module; swap in fakes
// whose editor fails with a long, HTML-looking error.
vi.mock("@/pipeline/providers", async () => {
  const fakes = await import("@/pipeline/test-helpers");
  return {
    createProviders: () => ({
      vision: new fakes.ScriptedVision()
        .on("router", { reply: { route: "enhance", reason: "Dark" } })
        .on("synthesizer", { reply: { prompt: "Brighten evenly" } }),
      editor: new fakes.FakeEditor(0.04, new Error("<script>" + "x".repeat(5000))),
    }),
  };
});

setupApiTestEnv("run-route-failure");

let image: Buffer;

beforeAll(async () => {
  image = await detailedImage();
});

describe("POST .../run with a failing provider", () => {
  it("returns the failed photo as JSON with a capped error", async () => {
    const listing = await createListing({ name: "Beach house" });
    const { id: photoId } = await addPhoto(listing.id, { roomType: "bedroom", originalName: "a.jpg", data: image });

    const url = `${BASE_URL}/${listing.id}/photos/${photoId}/run`;
    const res = await POST(new Request(url, { method: "POST" }), ctx({ listingId: listing.id, photoId }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const photo = await res.json();
    expect(photo.status).toBe("failed");
    expect(photo.error.length).toBeLessThanOrEqual(500);
  });
});
