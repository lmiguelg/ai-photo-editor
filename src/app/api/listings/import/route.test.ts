import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_URL, jsonRequest, setupApiTestEnv } from "@/lib/api-test-helpers";
import type { Transport } from "@/lib/listing-import";
import { getListing } from "@/lib/store";
import { ListingSchema } from "@/pipeline/schemas";
import { detailedImage } from "@/pipeline/test-helpers";
import { POST } from "./route";

// Tests may swap the transport the route picks; by default it is the real choice,
// which is the fixture because setupApiTestEnv forces mock mode.
const override = vi.hoisted(() => ({ transport: null as Transport | null }));

vi.mock("@/lib/listing-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/listing-import")>();
  return {
    ...actual,
    importTransport: (env: Record<string, string | undefined>) => override.transport ?? actual.importTransport(env),
  };
});

const getDataDir = setupApiTestEnv("import-route");

afterEach(() => {
  override.transport = null;
});

const URL_IMPORT = `${BASE_URL}/import`;

async function importLink(body: unknown) {
  const res = await POST(jsonRequest(URL_IMPORT, body));
  return { status: res.status, body: await res.json() };
}

async function listingDirs(): Promise<string[]> {
  return fs.readdir(path.join(getDataDir(), "listings")).catch(() => []);
}

describe("POST /api/listings/import (mock mode)", () => {
  it("imports the Airbnb fixture: 5 photos named airbnb-01..05.jpg, uploaded, room type other", async () => {
    const { status, body } = await importLink({ url: "https://www.airbnb.com/rooms/123" });
    expect(status).toBe(201);
    expect(body.imported).toBe(5);
    expect(body.skipped).toBe(1);
    const listing = ListingSchema.parse(body.listing);
    expect(listing.name).toBe("Imported from Airbnb");
    expect(listing.clientName).toBeNull();
    expect(listing.photos.map((photo) => photo.originalName)).toEqual([
      "airbnb-01.jpg",
      "airbnb-02.jpg",
      "airbnb-03.jpg",
      "airbnb-04.jpg",
      "airbnb-05.jpg",
    ]);
    for (const photo of listing.photos) {
      expect(photo.status).toBe("uploaded");
      expect(photo.roomType).toBe("other");
      expect(photo.originalFile).toBe("original.jpg");
    }

    const stored = await getListing(listing.id);
    expect(stored?.photos.map((photo) => photo.originalName).sort()).toEqual(
      listing.photos.map((photo) => photo.originalName),
    );
    expect(JSON.stringify(stored)).not.toMatch(/muscache|sample-|example\.com/);
  });

  it("imports the Booking.com fixture with the default name, given client name and the detected extension", async () => {
    const { status, body } = await importLink({ url: "https://www.booking.com/hotel/pt/x.html", clientName: "Ann" });
    expect(status).toBe(201);
    expect([body.imported, body.skipped]).toEqual([5, 1]);
    expect(body.listing.name).toBe("Imported from Booking.com");
    expect(body.listing.clientName).toBe("Ann");
    expect(body.listing.photos.map((photo: { originalName: string }) => photo.originalName)).toEqual([
      "booking-01.jpg",
      "booking-02.jpg",
      "booking-03.png",
      "booking-04.jpg",
      "booking-05.jpg",
    ]);
  });

  it("uses the given listing name", async () => {
    const { status, body } = await importLink({ url: "https://airbnb.pt/rooms/1", name: "  Lisbon loft " });
    expect(status).toBe(201);
    expect(body.listing.name).toBe("Lisbon loft");
  });

  it("400 Unsupported listing link for links off the allowlist, without creating anything", async () => {
    for (const url of [
      "http://www.airbnb.com/rooms/1",
      "https://airbnb.com.evil.test/rooms/1",
      "https://user:pw@www.airbnb.com/rooms/1",
      "https://www.airbnb.com:8443/rooms/1",
      "https://127.0.0.1/",
      "https://example.com/",
      "not a url",
    ]) {
      const res = await POST(jsonRequest(URL_IMPORT, { url }));
      expect(res.status, url).toBe(400);
      expect(await res.text(), url).toBe('{"error":"Unsupported listing link"}');
    }
    expect(await listingDirs()).toEqual([]);
  });

  it("400 Invalid request for a malformed body", async () => {
    for (const body of [{}, "not json", { url: 1 }, { url: "https://www.airbnb.com/rooms/1", name: "" }, []]) {
      const res = await POST(jsonRequest(URL_IMPORT, body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.text()).toBe('{"error":"Invalid request"}');
    }
  });

  it("422 No photos found and no listing directory when the page has no photos", async () => {
    const requested: string[] = [];
    override.transport = async (url) => {
      requested.push(url.href);
      return { contentType: "text/html", body: Buffer.from("<html><img src=https://example.com/a.jpg></html>") };
    };
    const res = await POST(jsonRequest(URL_IMPORT, { url: "https://www.airbnb.com/rooms/1" }));
    expect(res.status).toBe(422);
    expect(await res.text()).toBe('{"error":"No photos found"}');
    expect(requested).toEqual(["https://www.airbnb.com/rooms/1"]);
    expect(await listingDirs()).toEqual([]);
  });

  it("422 when every image fails its checks", async () => {
    override.transport = async (url) =>
      url.hostname === "www.airbnb.com"
        ? { contentType: "text/html", body: Buffer.from('"https://a0.muscache.com/im/pictures/a.jpg"') }
        : { contentType: "text/html", body: Buffer.from("<html>") };
    const res = await POST(jsonRequest(URL_IMPORT, { url: "https://www.airbnb.com/rooms/1" }));
    expect(res.status).toBe(422);
    expect(await listingDirs()).toEqual([]);
  });

  it("502 Could not fetch listing when the page fetch fails, without leaking the cause", async () => {
    override.transport = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:443 www.airbnb.com");
    };
    const res = await POST(jsonRequest(URL_IMPORT, { url: "https://www.airbnb.com/rooms/1" }));
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('{"error":"Could not fetch listing"}');
    expect(await listingDirs()).toEqual([]);
  });

  it("fetches only the site's CDN for images and skips failed fetches without aborting", async () => {
    const requested: { url: string; maxBytes: number; cdn: boolean }[] = [];
    const page = [1, 2, 3].map((n) => `https://a0.muscache.com/im/pictures/${n}.jpg`).join(" ");
    const jpeg = await detailedImage();
    override.transport = async (url, options) => {
      requested.push({ url: url.href, maxBytes: options.maxBytes, cdn: options.isAllowedHost("a0.muscache.com") });
      if (url.hostname === "www.airbnb.com") return { contentType: "text/html", body: Buffer.from(page) };
      expect(options.isAllowedHost("www.airbnb.com")).toBe(false);
      if (url.pathname.endsWith("/2.jpg")) throw new Error("timeout");
      return { contentType: "image/jpeg", body: jpeg };
    };
    const { status, body } = await importLink({ url: "https://www.airbnb.com/rooms/1" });
    expect(status).toBe(201);
    expect([body.imported, body.skipped]).toEqual([2, 1]);
    expect(requested[0]).toEqual({ url: "https://www.airbnb.com/rooms/1", maxBytes: 5 * 1024 * 1024, cdn: false });
    expect(requested.slice(1).map((r) => [r.maxBytes, r.cdn])).toEqual([
      [25 * 1024 * 1024, true],
      [25 * 1024 * 1024, true],
      [25 * 1024 * 1024, true],
    ]);
  });

  it("fetches at most 50 images", async () => {
    const page = Array.from({ length: 60 }, (_, n) => `https://a0.muscache.com/im/pictures/${n}.jpg`).join(" ");
    let imageRequests = 0;
    override.transport = async (url) => {
      if (url.hostname === "www.airbnb.com") return { contentType: "text/html", body: Buffer.from(page) };
      imageRequests += 1;
      return { contentType: "image/jpeg", body: Buffer.from("not an image") };
    };
    const res = await POST(jsonRequest(URL_IMPORT, { url: "https://www.airbnb.com/rooms/1" }));
    expect(res.status).toBe(422);
    expect(imageRequests).toBe(50);
  });
});
