import { describe, expect, it } from "vitest";
import {
  AttemptSchema,
  IdSchema,
  ListingSchema,
  NewListingInputSchema,
  PhotoSchema,
  type Listing,
} from "./schemas";

const now = "2026-10-28T12:00:00.000Z";

function validListing(): Listing {
  return {
    id: "3f2a9c1e-1b2c-4d5e-8f90-abcdef012345",
    name: "Beach House",
    clientName: "Ana",
    createdAt: now,
    updatedAt: now,
    photos: [
      {
        id: "a1b2c3d4-0000-4000-8000-000000000001",
        listingId: "3f2a9c1e-1b2c-4d5e-8f90-abcdef012345",
        roomType: "living_room",
        originalName: "Living Room.JPG",
        originalFile: "original.jpg",
        status: "passed",
        attempts: [
          {
            index: 0,
            prompt: "Brighten the room evenly",
            editedFile: "attempt-0.jpg",
            qa: { pass: true, scores: { faithfulness: 9, quality: 8 }, reason: "Looks natural" },
            costUsd: 0.04,
            createdAt: now,
          },
        ],
        bestAttemptIndex: 0,
        costUsd: 0.06,
        decision: { verdict: "approved", note: "Great", decidedAt: now },
        error: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

describe("schemas", () => {
  it("parses a valid listing with a photo, attempt, QA result and decision", () => {
    const listing = validListing();
    expect(ListingSchema.parse(listing)).toEqual(listing);
  });

  it.each(["Abc", "a/b", "", "a".repeat(65), "../x"])("rejects id %j", (id) => {
    expect(IdSchema.safeParse(id).success).toBe(false);
    const listing = validListing();
    listing.id = id;
    expect(ListingSchema.safeParse(listing).success).toBe(false);
  });

  it("rejects an unknown room type", () => {
    const photo = { ...validListing().photos[0], roomType: "garage" };
    expect(PhotoSchema.safeParse(photo).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    const photo = { ...validListing().photos[0], status: "done" };
    expect(PhotoSchema.safeParse(photo).success).toBe(false);
  });

  it("rejects a negative costUsd on photos and attempts", () => {
    const photo = validListing().photos[0];
    expect(PhotoSchema.safeParse({ ...photo, costUsd: -1 }).success).toBe(false);
    expect(AttemptSchema.safeParse({ ...photo.attempts[0], costUsd: -0.01 }).success).toBe(false);
  });

  it.each(["../x.jpg", "a/b.jpg", "a\\b.jpg", ".."])("rejects file name %j", (name) => {
    const photo = validListing().photos[0];
    expect(AttemptSchema.safeParse({ ...photo.attempts[0], editedFile: name }).success).toBe(false);
    expect(PhotoSchema.safeParse({ ...photo, originalFile: name }).success).toBe(false);
  });

  it("rejects an empty or blank listing name", () => {
    expect(ListingSchema.safeParse({ ...validListing(), name: "" }).success).toBe(false);
    expect(NewListingInputSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("trims the listing name and allows a missing clientName in the input", () => {
    expect(NewListingInputSchema.parse({ name: "  Beach House " })).toEqual({ name: "Beach House" });
  });
});
