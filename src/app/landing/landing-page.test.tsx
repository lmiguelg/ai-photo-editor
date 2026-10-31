import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, CONTACT_MAILTO_WITH_SUBJECT, CONTACT_SUBJECT, FINAL_CTA, STATS, STEPS } from "@/lib/landing-content";
import LandingPage, { metadata } from "./page";

const SRC = path.resolve(__dirname, "..", "..");
const html = renderToStaticMarkup(<LandingPage />);

describe("landing page markup", () => {
  it("has one h1 and a hero CTA to #contact", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*href="#contact"/);
  });

  it("has no form and no form fields", () => {
    expect(html).not.toMatch(/<(form|input(?![^>]*type="range")|textarea|select|button)[\s>]/);
  });

  it("ends with a contact section showing CONTACT_EMAIL as a mailto: link and a mailto: button with an encoded subject", () => {
    const start = html.indexOf('id="contact"');
    expect(start).toBeGreaterThan(-1);
    const contact = html.slice(start);
    expect(contact).toContain(FINAL_CTA.emailLead);
    expect(contact).toMatch(new RegExp(`<a href="mailto:${CONTACT_EMAIL}"[^>]*>${CONTACT_EMAIL}</a>`));

    const button = contact.match(new RegExp(`<a href="([^"]*)"[^>]*>${FINAL_CTA.button}</a>`));
    expect(button).not.toBeNull();
    const href = button![1].replace(/&amp;/g, "&");
    expect(href).toBe(CONTACT_MAILTO_WITH_SUBJECT);
    const url = new URL(href);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe(CONTACT_EMAIL);
    expect([...url.searchParams.keys()]).toEqual(["subject"]);
    expect(url.searchParams.get("subject")).toBe(CONTACT_SUBJECT);
    expect(url.search).toBe(`?subject=${encodeURIComponent(CONTACT_SUBJECT)}`);
    expect(url.search).not.toContain(" ");
  });

  it("shows at least two sliders with labelled range inputs, served by next/image, and a sample label", () => {
    const ranges = html.match(/<input type="range"[^>]*aria-label="[^"]+"/g) ?? [];
    expect(ranges.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("/_next/image?url=%2Fexamples%2F");
    expect(html).toContain("Sample images for illustration");
    for (const img of html.match(/<img [^>]*>/g) ?? []) expect(img).toMatch(/alt="[^"]+"/);
  });

  it("lists exactly three steps, the contact offer, the faithfulness promise and FAQ details", () => {
    for (const step of STEPS) expect(html).toContain(step.title);
    expect(html.match(/<ol[\s\S]*?<\/ol>/)?.[0].match(/<li/g)).toHaveLength(3);
    expect(html).not.toContain("$");
    expect(html).toContain("Tell us about your listing");
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

describe("landing code sends and stores nothing", () => {
  it("has no fetch, storage, cookies or server action, and no contact API route", async () => {
    const files = [
      "app/landing/page.tsx",
      "lib/landing-content.ts",
      "components/landing-header-cta.tsx",
      "components/landing-stat-figure.tsx",
      "components/before-after-slider.tsx",
    ];
    for (const file of files) {
      const source = await readFile(path.join(SRC, file), "utf8");
      expect(source, file).not.toMatch(/\bfetch\b|localStorage|sessionStorage|indexedDB|cookie|use server/i);
    }
    expect(existsSync(path.join(SRC, "app", "api", "contact"))).toBe(false);
  });
});

describe("landing example labels", () => {
  it("slider labels and alt text read as plain phrases (no dangling 'for of' / 'photo of of')", () => {
    expect(html).not.toMatch(/comparison for (of|a|an|the) /);
    expect(html).not.toMatch(/alt="(Original|Edited) photo (of|a|an|the) /);
    expect(html).toContain('aria-label="Before/after comparison for living room with a white corner sofa"');
  });
});
