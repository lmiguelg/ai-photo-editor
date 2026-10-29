import { beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, ctx, setupApiTestEnv } from "@/lib/api-test-helpers";
import { addPhoto, createListing, updatePhoto } from "@/lib/store";
import { detailedImage } from "@/pipeline/test-helpers";
import { GET } from "./route";

setupApiTestEnv("export-summary-route");

let image: Buffer;

beforeAll(async () => {
  image = await detailedImage(400, 300);
});

function summary(listingId: string) {
  return GET(new Request(`${BASE_URL}/${listingId}/export/summary`), ctx({ listingId }));
}

const NOW = "2026-01-01T00:00:00.000Z";

async function photoWith(listingId: string, roomType: "living_room" | "kitchen", approved: boolean | null) {
  const photo = await addPhoto(listingId, { roomType, originalName: "private-name.jpg", data: image });
  await updatePhoto(listingId, photo.id, (current) => ({
    ...current,
    status: "passed",
    bestAttemptIndex: 0,
    attempts: [{ index: 0, prompt: "Brighten", editedFile: "attempt-0.jpg", qa: null, costUsd: 0.05, createdAt: NOW }],
    decision: approved === null ? null : { verdict: approved ? "approved" : "rejected", note: "n", decidedAt: NOW },
  }));
  return photo;
}

describe("GET /api/listings/[listingId]/export/summary", () => {
  it("returns the html and text summary with no-store and nosniff", async () => {
    const listing = await createListing({ name: "Lake cabin", clientName: "Ana" });
    await photoWith(listing.id, "living_room", true);
    await photoWith(listing.id, "living_room", true);
    await photoWith(listing.id, "kitchen", null);

    const res = await summary(listing.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = (await res.json()) as { html: string; text: string };
    expect(Object.keys(body).sort()).toEqual(["html", "text"]);
    expect(body.text).toContain("Hi Ana,");
    expect(body.text).toContain("Your photos for Lake cabin are ready.");
    expect(body.text).toContain("- Living room: 2");
    expect(body.text).not.toContain("Kitchen");
    expect(body.text).toContain("Every edit keeps your space true to how it really looks.");
    expect(body.text).toContain("Before/after previews are included so you can see the difference at a glance.");
    expect(body.text).toContain("Let me know if you'd like anything adjusted.");
    expect(body.text).toContain("Best regards,");
    expect(body.html).toContain("<li>Living room: 2</li>");
    expect(`${body.html}${body.text}`).not.toContain("$");
  });

  it("greets 'Hi there,' without a client name", async () => {
    const listing = await createListing({ name: "Lake cabin" });
    await photoWith(listing.id, "kitchen", true);
    const body = (await (await summary(listing.id)).json()) as { text: string };
    expect(body.text.startsWith("Hi there,")).toBe(true);
  });

  it("returns 404 for an invalid or unknown listing id", async () => {
    for (const listingId of ["../x", "00000000-0000-0000-0000-000000000000"]) {
      const res = await summary(listingId);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    }
  });

  it("returns 409 when nothing is approved, even with skipped photos", async () => {
    const listing = await createListing({ name: "Nothing yet" });
    await photoWith(listing.id, "kitchen", null);
    await photoWith(listing.id, "kitchen", false);
    const skipped = await addPhoto(listing.id, { roomType: "kitchen", originalName: "s.jpg", data: image });
    await updatePhoto(listing.id, skipped.id, (current) => ({ ...current, status: "skipped" }));

    const res = await summary(listing.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Nothing approved to export" });
  });
});
