// QA tests for link imports (job 007): transport choice, caps, image checks,
// safeGet wired into importListing, and that nothing opens a socket in mock mode.
import fs from "node:fs/promises";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListingImportInputSchema } from "@/lib/api-schemas";
import { setupApiTestEnv } from "@/lib/api-test-helpers";
import { HttpError } from "@/lib/http";
import { MAX_UPLOAD_BYTES } from "@/lib/review";
import { detailedImage } from "@/pipeline/test-helpers";
import { fixtureTransport } from "./fixture";
import { importListing, importTransport, type Transport } from "./index";
import {
  IMPORT_REQUEST_TIMEOUT_MS,
  MAX_IMPORT_PAGE_BYTES,
  MAX_IMPORT_PHOTOS,
  MAX_IMPORT_REDIRECTS,
  MAX_IMPORT_TOTAL_BYTES,
} from "./limits";
import { safeGet, type HopRequest, type HopResponse } from "./net";

const getDataDir = setupApiTestEnv("import-qa");

afterEach(() => {
  vi.restoreAllMocks();
});

const input = (url: string, extra: Record<string, unknown> = {}) => ListingImportInputSchema.parse({ url, ...extra });

async function listingDirs(): Promise<string[]> {
  return fs.readdir(path.join(getDataDir(), "listings")).catch(() => []);
}

async function importError(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error("expected an HttpError");
}

const page = (...urls: string[]) => Buffer.from(urls.map((url) => `<img src="${url}">`).join("\n"));
const cdn = (n: number | string) => `https://a0.muscache.com/im/pictures/${n}.jpg`;

describe("limits", () => {
  it("exports the caps from the spec", () => {
    expect(MAX_IMPORT_PAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_IMPORT_PHOTOS).toBe(50);
    expect(MAX_IMPORT_TOTAL_BYTES).toBe(300 * 1024 * 1024);
    expect(IMPORT_REQUEST_TIMEOUT_MS).toBe(15_000);
    expect(MAX_IMPORT_REDIRECTS).toBe(3);
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("importTransport", () => {
  it("is the fixture only in full mock mode, the network transport otherwise", () => {
    expect(importTransport({})).toBe(fixtureTransport);
    expect(importTransport({ ANTHROPIC_API_KEY: "", FAL_KEY: "" })).toBe(fixtureTransport);
    expect(importTransport({ ANTHROPIC_API_KEY: "sk-test" })).toBe(safeGet);
    expect(importTransport({ FAL_KEY: "fal-test" })).toBe(safeGet);
    expect(importTransport({ ANTHROPIC_API_KEY: "sk-test", FAL_KEY: "fal-test" })).toBe(safeGet);
  });
});

describe("importListing in mock mode", () => {
  it("never opens a socket or calls fetch", async () => {
    const httpsRequest = vi.spyOn(https, "request");
    const httpsGet = vi.spyOn(https, "get");
    const connect = vi.spyOn(net, "connect");
    const createConnection = vi.spyOn(net, "createConnection");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    for (const url of ["https://www.airbnb.com/rooms/123", "https://www.booking.com/hotel/pt/x.html"]) {
      const result = await importListing(input(url), importTransport(process.env));
      expect([result.imported, result.skipped], url).toEqual([5, 1]);
    }
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(httpsGet).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(createConnection).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("writes the photos in page order with sequential names and no remote names on disk", async () => {
    const result = await importListing(input("https://www.airbnb.com/rooms/123"), fixtureTransport);
    const dir = path.join(getDataDir(), "listings", result.listing.id);
    const files = await fs.readdir(dir, { recursive: true });
    expect(files.join(" ")).not.toMatch(/sample-|muscache/);
    const photosDir = path.join(dir, "photos");
    expect((await fs.readdir(photosDir)).length).toBe(5);
    for (const photo of result.listing.photos) {
      const bytes = await fs.readFile(path.join(photosDir, photo.id, photo.originalFile));
      expect((await sharp(bytes).metadata()).width).toBeGreaterThanOrEqual(1600);
    }
  });
});

describe("importListing image checks", () => {
  it("skips images with a non-image content type, unsupported formats and fetch failures, and keeps webp/png by detected format", async () => {
    const jpeg = await detailedImage();
    const png = await sharp(jpeg).png().toBuffer();
    const webp = await sharp(jpeg).webp().toBuffer();
    const gif = await sharp(jpeg).gif().toBuffer();
    const responses: Record<string, { contentType: string; body: Buffer } | Error> = {
      [cdn("a")]: { contentType: "image/jpeg", body: jpeg },
      [cdn("b")]: { contentType: "text/html", body: jpeg }, // right bytes, wrong type
      [cdn("c")]: { contentType: "image/jpeg", body: png }, // .jpg URL and type, png bytes
      [cdn("d")]: { contentType: "image/gif", body: gif },
      [cdn("e")]: { contentType: "IMAGE/WEBP", body: webp },
      [cdn("f")]: new Error("ECONNRESET"),
      [cdn("g")]: { contentType: "", body: jpeg },
    };
    const transport: Transport = async (url) => {
      if (url.hostname === "www.airbnb.com") return { contentType: "text/html", body: page(...Object.keys(responses)) };
      const key = `${url.origin}${url.pathname}`;
      const reply = responses[key];
      if (!reply) throw new Error(`unexpected ${url.href}`);
      if (reply instanceof Error) throw reply;
      return reply;
    };
    const result = await importListing(input("https://www.airbnb.com/rooms/1"), transport);
    expect(result.listing.photos.map((photo) => photo.originalName)).toEqual([
      "airbnb-01.jpg",
      "airbnb-02.png",
      "airbnb-03.webp",
    ]);
    expect(result.listing.photos.map((photo) => photo.originalFile)).toEqual([
      "original.jpg",
      "original.png",
      "original.webp",
    ]);
    expect([result.imported, result.skipped]).toEqual([3, 4]);
  });

  it("asks the transport for each image with the per-image cap and an allowlist of only the site's CDN", async () => {
    const seen: { host: string; maxBytes: number; accept: string; allows: Record<string, boolean> }[] = [];
    const hosts = ["a0.muscache.com", "cf.bstatic.com", "www.airbnb.com", "muscache.com", "a1.muscache.com"];
    const transport: Transport = async (url, options) => {
      seen.push({
        host: url.hostname,
        maxBytes: options.maxBytes,
        accept: options.accept,
        allows: Object.fromEntries(hosts.map((host) => [host, options.isAllowedHost(host)])),
      });
      if (url.hostname === "www.booking.com")
        return { contentType: "text/html", body: page("https://cf.bstatic.com/xdata/images/hotel/max500/1.jpg") };
      return { contentType: "image/jpeg", body: await detailedImage() };
    };
    await importListing(input("https://www.booking.com/hotel/pt/x.html"), transport);
    expect(seen[0].allows).toEqual({
      "a0.muscache.com": false,
      "cf.bstatic.com": false,
      "www.airbnb.com": true,
      "muscache.com": false,
      "a1.muscache.com": false,
    });
    expect(seen[1]).toEqual({
      host: "cf.bstatic.com",
      maxBytes: MAX_UPLOAD_BYTES,
      accept: "image/*",
      allows: {
        "a0.muscache.com": false,
        "cf.bstatic.com": true,
        "www.airbnb.com": false,
        "muscache.com": false,
        "a1.muscache.com": false,
      },
    });
  });
});

describe("importListing over safeGet with a scripted hop", () => {
  function hop(status: number, init: { location?: string; body?: Buffer; contentType?: string; contentLength?: number } = {}): HopResponse {
    return {
      status,
      location: init.location ?? null,
      contentType: init.contentType ?? "text/html",
      contentLength: init.contentLength ?? null,
      body: (async function* () {
        if (init.body) yield init.body;
      })(),
      abort: () => {},
    };
  }

  function transportFrom(reply: (url: URL) => HopResponse): { transport: Transport; urls: string[] } {
    const urls: string[] = [];
    const request: HopRequest = async (url) => {
      urls.push(url.href);
      return reply(url);
    };
    return { transport: (url, options) => safeGet(url, options, request), urls };
  }

  it("502 when the page redirects off the allowlist; nothing is written and the cause is not exposed", async () => {
    const { transport, urls } = transportFrom(() => hop(302, { location: "https://169.254.169.254/latest/meta-data" }));
    const err = await importError(importListing(input("https://www.airbnb.com/rooms/1"), transport));
    expect([err.status, err.message]).toEqual([502, "Could not fetch listing"]);
    expect(urls).toEqual(["https://www.airbnb.com/rooms/1"]);
    expect(await listingDirs()).toEqual([]);
  });

  it("502 when the page is over the 5 MB cap or not 2xx", async () => {
    for (const reply of [
      hop(200, { contentLength: MAX_IMPORT_PAGE_BYTES + 1 }),
      hop(200, { body: Buffer.alloc(MAX_IMPORT_PAGE_BYTES + 1) }),
      hop(403),
      hop(500),
    ]) {
      const { transport } = transportFrom(() => reply);
      const err = await importError(importListing(input("https://www.airbnb.com/rooms/1"), transport));
      expect(err.status).toBe(502);
    }
    expect(await listingDirs()).toEqual([]);
  });

  it("skips an image whose CDN response redirects back to a page host", async () => {
    const jpeg = await detailedImage();
    const { transport, urls } = transportFrom((url) => {
      if (url.hostname === "www.airbnb.com" && url.pathname === "/rooms/1") return hop(200, { body: page(cdn(1), cdn(2)) });
      if (url.pathname === "/im/pictures/1.jpg") return hop(302, { location: "https://www.airbnb.com/private.jpg" });
      if (url.pathname === "/im/pictures/2.jpg") return hop(200, { body: jpeg, contentType: "image/jpeg" });
      throw new Error(`unexpected ${url.href}`);
    });
    const result = await importListing(input("https://www.airbnb.com/rooms/1"), transport);
    expect([result.imported, result.skipped]).toEqual([1, 1]);
    expect(urls).not.toContain("https://www.airbnb.com/private.jpg");
  });
});
