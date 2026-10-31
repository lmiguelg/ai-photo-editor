import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STATS, STEPS } from "@/lib/landing-content";
import LandingPage, { metadata } from "./page";

const html = renderToStaticMarkup(<LandingPage />);

describe("landing page markup", () => {
  it("has one h1 and a hero CTA to #contact", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*href="#contact"/);
  });

  it("ends with a contact section holding a form with labelled inputs", () => {
    const start = html.indexOf('id="contact"');
    expect(start).toBeGreaterThan(-1);
    const contact = html.slice(start);
    expect(contact).toContain("<form");
    for (const field of ["name", "email", "listingUrl", "message"]) {
      expect(contact).toContain(`<label for="contact-${field}"`);
      expect(contact).toMatch(new RegExp(`<(input|textarea)[^>]*id="contact-${field}"`));
    }
  });

  it("shows at least two sliders with labelled range inputs, served by next/image, and a sample label", () => {
    const ranges = html.match(/<input type="range"[^>]*aria-label="[^"]+"/g) ?? [];
    expect(ranges.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("/_next/image?url=%2Fexamples%2F");
    expect(html).toContain("Sample images for illustration");
    for (const img of html.match(/<img [^>]*>/g) ?? []) expect(img).toMatch(/alt="[^"]+"/);
  });

  it("lists exactly three steps, the $45 offer, the faithfulness promise and FAQ details", () => {
    for (const step of STEPS) expect(html).toContain(step.title);
    expect(html.match(/<ol[\s\S]*?<\/ol>/)?.[0].match(/<li/g)).toHaveLength(3);
    expect(html).toContain("$45");
    expect(html).toContain("Up to 25 photos");
    expect(html).toContain("We never add, remove or reshape anything that would misrepresent your property.");
    expect((html.match(/<details/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("<summary");
  });

  it("links every stat to its source with name and year", () => {
    for (const stat of STATS) {
      expect(html).toContain(`href="${stat.url}"`);
      expect(html).toContain(`${stat.sourceName}, ${stat.year}`);
      expect(html).toContain(stat.figure);
    }
  });

  it("holds no owner data or owner links", () => {
    for (const needle of ["Mock mode", "AI cost", "margin", "QA", "score", "ANTHROPIC", "FAL_KEY", 'href="/"', "/listings", "/api/"]) {
      expect(html, needle).not.toContain(needle);
    }
  });

  it("exports title, description and Open Graph metadata with an /examples/ image", () => {
    expect(metadata.title).toBeTruthy();
    expect(metadata.description).toBeTruthy();
    const og = metadata.openGraph as { title?: unknown; description?: unknown; type?: unknown; images?: unknown };
    expect(og.title).toBeTruthy();
    expect(og.description).toBeTruthy();
    expect(og.type).toBe("website");
    const [image] = og.images as { url: string; width: number; height: number; alt: string }[];
    expect(image.url).toMatch(/^\/examples\/.+-after\.jpg$/);
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
    expect(image.alt).toBeTruthy();
  });
});
