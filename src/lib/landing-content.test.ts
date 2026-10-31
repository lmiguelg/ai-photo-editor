import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, EXAMPLES, FAQ, PHOTOS_PER_LISTING, STATS, STEPS } from "./landing-content";

describe("landing content", () => {
  it("every stat has a figure, claim, quote and source name", () => {
    for (const stat of STATS) {
      expect(stat.figure.trim(), stat.url).not.toBe("");
      expect(stat.claim.trim(), stat.url).not.toBe("");
      expect(stat.quote.trim(), stat.url).not.toBe("");
      expect(stat.sourceName.trim(), stat.url).not.toBe("");
    }
  });

  it("every stat links to an https source", () => {
    for (const stat of STATS) {
      expect(new URL(stat.url).protocol, stat.url).toBe("https:");
    }
  });

  it("every stat has an integer publication year between 1990 and now", () => {
    const now = new Date().getFullYear();
    for (const stat of STATS) {
      expect(Number.isInteger(stat.year), stat.url).toBe(true);
      expect(stat.year).toBeGreaterThanOrEqual(1990);
      expect(stat.year).toBeLessThanOrEqual(now);
    }
  });

  it("every quote contains its figure verbatim", () => {
    for (const stat of STATS) {
      expect(stat.quote, stat.url).toContain(stat.figure);
    }
  });

  it("has three steps, 4 to 6 FAQ entries, example pairs under /examples/ and the offer data", () => {
    expect(STEPS).toHaveLength(3);
    expect(FAQ.length).toBeGreaterThanOrEqual(4);
    expect(FAQ.length).toBeLessThanOrEqual(6);
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(2);
    for (const example of EXAMPLES) {
      expect(example.beforeSrc).toMatch(/^\/examples\/[a-z0-9-]+\.(jpg|webp)$/);
      expect(example.afterSrc).toMatch(/^\/examples\/[a-z0-9-]+\.(jpg|webp)$/);
      expect(Math.max(example.width, example.height)).toBeLessThanOrEqual(1600);
    }
    expect(PHOTOS_PER_LISTING).toBe(25);
    expect(CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+$/);
  });
});
