import { describe, expect, it } from "vitest";
import { computeLocalMetrics, prefilter } from "@/pipeline/metrics";
import { extractImageUrls } from "./extract";
import { fixtureTransport } from "./fixture";
import { isImageHost, isPageHost, type ImportSite } from "./sites";

async function fixtureHtml(url: string): Promise<string> {
  const page = await fixtureTransport(new URL(url), { maxBytes: 5_000_000, accept: "text/html", isAllowedHost: isPageHost });
  return page.body.toString("utf8");
}

describe("extractImageUrls on the fixture pages", () => {
  it("finds the six Airbnb photos in page order at im_w=1440, without the host avatar or off-CDN images", async () => {
    const urls = extractImageUrls(await fixtureHtml("https://www.airbnb.com/rooms/123"), "airbnb");
    expect(urls).toEqual(
      ["living-room", "kitchen", "broken", "bedroom", "bathroom", "terrace"].map(
        (name) => `https://a0.muscache.com/im/pictures/hosting/sample-${name}.jpg?im_w=1440`,
      ),
    );
  });

  it("finds the six Booking.com photos resized to max1280x900, keeping the query and dropping the thumbnail", async () => {
    const urls = extractImageUrls(await fixtureHtml("https://www.booking.com/hotel/pt/x.html"), "booking");
    expect(urls).toEqual(
      [1001, 1002, 1003, 1004, 1005, 1006].map(
        (id) => `https://cf.bstatic.com/xdata/images/hotel/max1280x900/${id}.jpg?k=abc&o=`,
      ),
    );
  });

  it("serves the same page for any allowlisted page URL of a site", async () => {
    expect(await fixtureHtml("https://airbnb.pt/rooms/9")).toBe(await fixtureHtml("https://www.airbnb.com/rooms/123"));
  });
});

describe("extractImageUrls", () => {
  it("decodes JSON escapes and &amp; before matching", () => {
    const html = String.raw`{"a":"https://a0.muscache.com/im/pictures/x.jpg"} <img src="https:\/\/a0.muscache.com\/im\/pictures\/y.jpg?a=1&amp;b=2">`;
    expect(extractImageUrls(html, "airbnb")).toEqual([
      "https://a0.muscache.com/im/pictures/x.jpg?im_w=1440",
      "https://a0.muscache.com/im/pictures/y.jpg?im_w=1440",
    ]);
  });

  it("ignores look-alike hosts, other paths and the other site's CDN", () => {
    const html = [
      "https://a0.muscache.com.evil.test/im/pictures/a.jpg",
      "https://evila0.muscache.com/im/pictures/b.jpg",
      "https://a0.muscache.com/pictures/c.jpg",
      "http://a0.muscache.com/im/pictures/d.jpg",
      "https://a0.muscache.com/im/pictures/user/e.jpg",
      "https://cf.bstatic.com/xdata/images/hotel/max500/f.jpg",
    ].join(" ");
    expect(extractImageUrls(html, "airbnb")).toEqual([]);
    expect(extractImageUrls(html, "booking")).toEqual(["https://cf.bstatic.com/xdata/images/hotel/max500/f.jpg"]);
  });

  it("rewrites only the first Booking.com size segment and de-duplicates by URL without query", () => {
    const html = [
      "https://cf.bstatic.com/xdata/images/hotel/square240/1.jpg?k=a",
      "https://cf.bstatic.com/xdata/images/hotel/max300x200/1.jpg?k=b",
      "https://cf.bstatic.com/xdata/images/hotel/max300x200/square60/2.jpg",
    ].join("\n");
    expect(extractImageUrls(html, "booking")).toEqual([
      "https://cf.bstatic.com/xdata/images/hotel/max1280x900/1.jpg?k=a",
      "https://cf.bstatic.com/xdata/images/hotel/max1280x900/square60/2.jpg",
    ]);
  });
});

describe("fixtureTransport images", () => {
  it.each<[ImportSite, string]>([
    ["airbnb", "https://www.airbnb.com/rooms/123"],
    ["booking", "https://www.booking.com/hotel/pt/x.html"],
  ])("serves five prefilter-passing images and one non-image for %s", async (site, page) => {
    const urls = extractImageUrls(await fixtureHtml(page), site);
    let good = 0;
    let bad = 0;
    for (const url of urls) {
      const { contentType, body } = await fixtureTransport(new URL(url), {
        maxBytes: 25 * 1024 * 1024,
        accept: "image/*",
        isAllowedHost: isImageHost(site),
      });
      expect(contentType).toMatch(/^image\//);
      const metrics = await computeLocalMetrics(body).catch(() => null);
      if (metrics === null) {
        bad += 1;
        continue;
      }
      expect(metrics.width).toBeGreaterThanOrEqual(1600);
      expect(metrics.height).toBeGreaterThanOrEqual(1000);
      expect(prefilter(metrics)).toEqual({ ok: true });
      good += 1;
    }
    expect([good, bad]).toEqual([5, 1]);
  });

  it("refuses hosts off the allowlist it is given and unknown CDN paths", async () => {
    const options = { maxBytes: 1_000_000, accept: "image/*", isAllowedHost: isImageHost("airbnb") };
    await expect(fixtureTransport(new URL("https://example.com/x.jpg"), options)).rejects.toThrow();
    await expect(fixtureTransport(new URL("https://cf.bstatic.com/xdata/images/hotel/max1280x900/1001.jpg"), options)).rejects.toThrow();
    await expect(fixtureTransport(new URL("https://a0.muscache.com/im/pictures/nope.jpg"), options)).rejects.toThrow();
  });
});
