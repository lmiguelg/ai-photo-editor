import { describe, expect, it } from "vitest";
import { ListingImportInputSchema, UNSUPPORTED_LINK } from "./api-schemas";

const parse = (url: unknown, extra: Record<string, unknown> = {}) => ListingImportInputSchema.safeParse({ url, ...extra });

describe("ListingImportInputSchema", () => {
  it("accepts allowlisted Airbnb and Booking.com links and drops the fragment", () => {
    const cases: [string, "airbnb" | "booking"][] = [
      ["https://www.airbnb.com/rooms/123", "airbnb"],
      ["https://airbnb.com/rooms/123?adults=2", "airbnb"],
      ["https://www.airbnb.pt/rooms/1", "airbnb"],
      ["https://www.airbnb.co.uk/rooms/1", "airbnb"],
      ["https://airbnb.com.br/rooms/1", "airbnb"],
      ["https://www.airbnb.com.au/rooms/1", "airbnb"],
      ["https://www.booking.com/hotel/pt/x.html", "booking"],
      ["https://booking.com/hotel/pt/x.html", "booking"],
      ["  https://WWW.Airbnb.com/rooms/9#photos  ", "airbnb"],
    ];
    for (const [url, site] of cases) {
      const result = parse(url);
      expect(result.success, url).toBe(true);
      expect(result.data?.url.site).toBe(site);
      expect(result.data?.url.url.hash).toBe("");
      expect(result.data?.url.url.href).not.toContain("#");
    }
  });

  it("applies the listing name and client name rules", () => {
    const ok = parse("https://www.airbnb.com/rooms/1", { name: "  Beach  ", clientName: "Ann" });
    expect(ok.data?.name).toBe("Beach");
    expect(ok.data?.clientName).toBe("Ann");
    expect(parse("https://www.airbnb.com/rooms/1").data?.name).toBeUndefined();
    expect(parse("https://www.airbnb.com/rooms/1", { name: "   " }).success).toBe(false);
    expect(parse("https://www.airbnb.com/rooms/1", { name: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects every other link with the unsupported-link message on url", () => {
    for (const url of [
      "http://www.airbnb.com/rooms/1",
      "https://user:pw@www.airbnb.com/rooms/1",
      "https://user@www.airbnb.com/rooms/1",
      "https://www.airbnb.com:8443/rooms/1",
      "https://www.airbnb.com:443/rooms/1".replace(":443", ":444"),
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://2130706433/",
      "https://airbnb.com.evil.test/rooms/1",
      "https://evilairbnb.com/rooms/1",
      "https://www.airbnb.com.evil.test/",
      "https://m.airbnb.com/rooms/1",
      "https://www.airbnb.com./rooms/1",
      "https://airbnb.org/rooms/1",
      "https://www.booking.com.evil.test/",
      "https://secure.booking.com/",
      "https://a0.muscache.com/im/pictures/x.jpg",
      "https://example.com/",
      "ftp://www.airbnb.com/",
      "not a url",
      "",
      `https://www.airbnb.com/rooms/${"1".repeat(2048)}`,
    ]) {
      const result = parse(url);
      expect(result.success, url).toBe(false);
      expect(
        result.error?.issues.some((issue) => issue.path[0] === "url" && issue.message === UNSUPPORTED_LINK),
        url,
      ).toBe(true);
    }
  });

  it("rejects a missing or non-string url without the unsupported-link message", () => {
    for (const body of [{}, { url: 42 }, { url: null }]) {
      const result = ListingImportInputSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.message === UNSUPPORTED_LINK)).toBe(false);
    }
  });
});
