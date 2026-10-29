import { beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, ctx, jsonRequest, setupApiTestEnv } from "@/lib/api-test-helpers";
import { addPhoto, createListing, getPhoto, updatePhoto } from "@/lib/store";
import { PhotoSchema, type PhotoStatus } from "@/pipeline/schemas";
import { detailedImage } from "@/pipeline/test-helpers";
import { POST } from "./route";

setupApiTestEnv("decision-route");

let image: Buffer;

beforeAll(async () => {
  image = await detailedImage(400, 300);
});

async function photoWithStatus(status: PhotoStatus) {
  const listing = await createListing({ name: "Beach house" });
  const photo = await addPhoto(listing.id, { roomType: "bedroom", originalName: "room.jpg", data: image });
  if (status !== "uploaded") await updatePhoto(listing.id, photo.id, (p) => ({ ...p, status }));
  return { listingId: listing.id, photoId: photo.id };
}

function decide(ids: { listingId: string; photoId: string }, body: unknown) {
  const url = `${BASE_URL}/${ids.listingId}/photos/${ids.photoId}/decision`;
  return POST(jsonRequest(url, body), ctx(ids));
}

describe("POST /api/listings/[listingId]/photos/[photoId]/decision", () => {
  it("records a trimmed note and replaces an earlier decision", async () => {
    const ids = await photoWithStatus("passed");
    const res = await decide(ids, { verdict: "approved", note: "  looks great " });
    expect(res.status).toBe(200);
    const photo = PhotoSchema.parse(await res.json());
    expect(photo.decision?.verdict).toBe("approved");
    expect(photo.decision?.note).toBe("looks great");
    expect(Number.isNaN(Date.parse(photo.decision!.decidedAt))).toBe(false);

    const again = await decide(ids, { verdict: "rejected" });
    expect(again.status).toBe(200);
    const stored = await getPhoto(ids.listingId, ids.photoId);
    expect(stored?.decision?.verdict).toBe("rejected");
    expect(stored?.decision?.note).toBe("");
  });

  it("accepts needs_review photos", async () => {
    const res = await decide(await photoWithStatus("needs_review"), { verdict: "approved" });
    expect(res.status).toBe(200);
  });

  it("rejects invalid bodies with 400", async () => {
    const ids = await photoWithStatus("passed");
    expect((await decide(ids, { verdict: "maybe" })).status).toBe(400);
    expect((await decide(ids, { verdict: "approved", note: "a".repeat(2001) })).status).toBe(400);
    expect((await decide(ids, "{not json")).status).toBe(400);
    expect((await decide(ids, { verdict: "approved", note: "a".repeat(2000) })).status).toBe(200);
  });

  it("returns 409 for photos without a result to review", async () => {
    for (const status of ["uploaded", "processing", "skipped", "rejected", "failed"] as const) {
      const ids = await photoWithStatus(status);
      const res = await decide(ids, { verdict: "approved" });
      expect(res.status, status).toBe(409);
      expect(await res.json()).toEqual({ error: "Photo has no result to review" });
      expect((await getPhoto(ids.listingId, ids.photoId))?.decision).toBeNull();
    }
  });

  it("returns 404 for unknown or invalid photos", async () => {
    const { listingId } = await photoWithStatus("passed");
    for (const photoId of ["00000000-0000-4000-8000-000000000000", "..%2F.."]) {
      const res = await decide({ listingId, photoId }, { verdict: "approved" });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('{"error":"Not found"}');
    }
  });
});
