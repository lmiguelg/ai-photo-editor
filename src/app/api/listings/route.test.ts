import { describe, expect, it } from "vitest";
import { BASE_URL, ctx, jsonRequest, setupApiTestEnv } from "@/lib/api-test-helpers";
import { IdSchema, ListingSchema } from "@/pipeline/schemas";
import { GET as getListingRoute } from "./[listingId]/route";
import { GET, POST } from "./route";

setupApiTestEnv("listings-route");

describe("POST /api/listings", () => {
  it("creates a listing", async () => {
    const res = await POST(jsonRequest(BASE_URL, { name: "Beach house", clientName: "Ana" }));
    expect(res.status).toBe(201);
    const listing = ListingSchema.parse(await res.json());
    expect(IdSchema.safeParse(listing.id).success).toBe(true);
    expect(listing.name).toBe("Beach house");
    expect(listing.clientName).toBe("Ana");
    expect(listing.photos).toEqual([]);
  });

  it("rejects invalid input, non-JSON and oversized bodies", async () => {
    const empty = await POST(jsonRequest(BASE_URL, { name: "" }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Invalid request" });

    const notJson = await POST(jsonRequest(BASE_URL, "name=Beach"));
    expect(notJson.status).toBe(400);

    const big = await POST(jsonRequest(BASE_URL, { name: "Big", clientName: "x".repeat(70 * 1024) }));
    expect(big.status).toBe(413);
  });
});

describe("GET /api/listings and /api/listings/[listingId]", () => {
  it("lists and gets the created listing", async () => {
    const created = await (await POST(jsonRequest(BASE_URL, { name: "Beach house" }))).json();

    const list = await GET();
    expect(list.status).toBe(200);
    expect(await list.json()).toContainEqual(created);

    const one = await getListingRoute(new Request(`${BASE_URL}/${created.id}`), ctx({ listingId: created.id }));
    expect(one.status).toBe(200);
    expect(await one.json()).toEqual(created);
  });

  it("returns the same 404 for unknown and invalid ids", async () => {
    for (const listingId of ["00000000-0000-4000-8000-000000000000", "..%2F..", "../..", "ABC"]) {
      const res = await getListingRoute(new Request(`${BASE_URL}/x`), ctx({ listingId }));
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('{"error":"Not found"}');
    }
  });
});
