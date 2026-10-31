import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, EXAMPLES, FAITHFULNESS, FAQ, STATS } from "@/lib/landing-content";
import LandingPage from "./page";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src");
const EXAMPLES_DIR = path.join(ROOT, "public", "examples");
const html = renderToStaticMarkup(<LandingPage />);
const text = html.replace(/<[^>]+>/g, " ");

function importsOf(source: string): string[] {
  return [...source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
}

describe("landing page source (req 3)", () => {
  it("is a static server component with no store, provider, env or banner imports", async () => {
    const source = await readFile(path.join(SRC, "app", "landing", "page.tsx"), "utf8");
    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("force-dynamic");
    expect(source).not.toContain("process.env");
    for (const banned of ["@/lib/store", "@/pipeline/providers", "@/components/provider-mode-banner", "node:"]) {
      expect(importsOf(source).some((s) => s.startsWith(banned)), banned).toBe(false);
    }
  });

  it("the landing route has no layout of its own that pulls in owner chrome", () => {
    expect(existsSync(path.join(SRC, "app", "landing", "layout.tsx"))).toBe(false);
  });

  it("the root layout renders no owner header or banner (req 1)", async () => {
    const source = await readFile(path.join(SRC, "app", "layout.tsx"), "utf8");
    expect(source).not.toContain("ProviderModeBanner");
    expect(source).not.toContain("<header");
    expect(source).not.toContain("<main");
    expect(source).toContain('<html lang="en">');
  });

  it("owner pages no longer live at the top of src/app (req 2)", () => {
    expect(existsSync(path.join(SRC, "app", "page.tsx"))).toBe(false);
    expect(existsSync(path.join(SRC, "app", "listings"))).toBe(false);
    expect(existsSync(path.join(SRC, "app", "(owner)", "page.tsx"))).toBe(true);
    expect(existsSync(path.join(SRC, "app", "(owner)", "listings", "[listingId]", "page.tsx"))).toBe(true);
  });
});

describe("landing page markup (QA)", () => {
  it("renders its own header with the brand name as text and a CTA to #contact, and no link to the owner UI", () => {
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(header).toContain("AI Photo Editor");
    expect(header).toMatch(/<a [^>]*href="#contact"/);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    for (const href of hrefs) {
      const mailto = href === `mailto:${CONTACT_EMAIL}` || href.startsWith(`mailto:${CONTACT_EMAIL}?`);
      expect(href === "#contact" || href.startsWith("https://") || mailto, href).toBe(true);
    }
  });

  it("headings are in order: one h1 first, then h2 sections, h3 only under an h2", () => {
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1], `heading ${i}`).toBeLessThanOrEqual(1);
    }
  });

  it("the contact section is the last section on the page and holds no form", () => {
    const sections = [...html.matchAll(/<section[^>]*>/g)].map((m) => m[0]);
    expect(sections.at(-1)).toContain('id="contact"');
    expect(html).not.toMatch(/<form[\s>]/);
  });

  it("shows no price, tier or overage: the owner quotes by email", () => {
    expect(text.match(/\$\s?\d[\d,.]*/g) ?? []).toEqual([]);
    for (const needle of ["$79", "$149", "$299", "1.50", "overage", "discount", "Tier", "tier"]) {
      expect(text, needle).not.toContain(needle);
    }
  });

  it("shows no percentage other than the sourced stat figures (req 12)", () => {
    const percents = text.match(/\d[\d.,]*\s?%/g) ?? [];
    expect([...percents].sort()).toEqual(STATS.map((s) => s.figure).sort());
  });

  it("each stat link is visible text naming the source and year and opens the stat URL (req 12)", () => {
    for (const stat of STATS) {
      const link = new RegExp(`<a [^>]*href="${stat.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]*(?:<!-- -->[^<]*)*)</a>`, "g");
      const texts = [...html.matchAll(link)].map((m) => m[1].replace(/<!-- -->/g, ""));
      expect(texts.some((t) => t.includes(`${stat.sourceName}, ${stat.year}`)), stat.url).toBe(true);
    }
  });

  it("names every change the pipeline is allowed to make in the faithfulness section (req 10)", () => {
    for (const change of ["Light", "Exposure", "White balance", "colour", "Straightening"]) {
      expect(text, change).toContain(change);
    }
    expect(FAITHFULNESS.promise).toMatch(/never add, remove or reshape/);
  });

  it("promises no edit the pipeline does not do, no turnaround, guarantee, refund or testimonial", () => {
    const lower = text.toLowerCase();
    for (const needle of [
      "virtual staging",
      "sky replacement",
      "declutter",
      "object removal",
      "24 hours",
      "turnaround",
      "guarantee",
      "refund",
      "money back",
      "testimonial",
      "trusted by",
    ]) {
      expect(lower, needle).not.toContain(needle);
    }
  });

  it("has 4 to 6 FAQ items, each a native <details> with a <summary>", () => {
    const details = html.match(/<details[\s\S]*?<\/details>/g) ?? [];
    expect(details.length).toBe(FAQ.length);
    expect(details.length).toBeGreaterThanOrEqual(4);
    expect(details.length).toBeLessThanOrEqual(6);
    for (const item of details) expect(item).toMatch(/<summary[^>]*>[^<]+<\/summary>/);
  });

  it("every image goes through next/image from /examples/ with a non-empty alt (req 18, AC 8)", () => {
    const imgs = html.match(/<img [^>]*>/g) ?? [];
    expect(imgs.length).toBe(EXAMPLES.length * 2);
    for (const img of imgs) {
      expect(img).toMatch(/alt="[^"]+"/);
      expect(img).toMatch(/src="\/_next\/image\?url=%2Fexamples%2F/);
    }
  });

  it("interactive elements carry focus-visible styles and animations are motion-safe (req 19)", () => {
    const interactive = html.match(/<(a|input|textarea|button|summary)\s[^>]*>/g) ?? [];
    expect(interactive.length).toBeGreaterThan(0);
    for (const el of interactive) expect(el, el).toMatch(/focus-visible:/);
    for (const cls of html.match(/class="[^"]*"/g) ?? []) {
      for (const token of cls.slice(7, -1).split(/\s+/)) {
        if (/^(animate-|transition)/.test(token)) throw new Error(`unguarded animation class ${token}`);
      }
    }
  });
});

describe("public/examples images (req 6, AC 10)", () => {
  it("holds only JPEG/WebP files of at most 500 KB with a long edge of at most 1600 px", async () => {
    const files = await readdir(EXAMPLES_DIR);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      expect(file).toMatch(/\.(jpg|jpeg|webp)$/);
      const full = path.join(EXAMPLES_DIR, file);
      expect((await stat(full)).size, file).toBeLessThanOrEqual(500 * 1024);
      const meta = await sharp(full).metadata();
      expect(["jpeg", "webp"], file).toContain(meta.format);
      expect(Math.max(meta.width ?? 0, meta.height ?? 0), file).toBeLessThanOrEqual(1600);
    }
  });

  it("every example pair exists and both files match the declared width and height (same framing)", async () => {
    for (const example of EXAMPLES) {
      for (const src of [example.beforeSrc, example.afterSrc]) {
        const meta = await sharp(path.join(ROOT, "public", src)).metadata();
        expect([meta.width, meta.height], src).toEqual([example.width, example.height]);
      }
    }
  });
});

describe("example labels read as plain phrases (round 1 ux finding)", () => {
  it("every example name is a plain noun phrase with no leading article or 'of'", () => {
    for (const example of EXAMPLES) {
      expect(example.name.trim(), example.name).toBe(example.name);
      expect(example.name, example.name).not.toMatch(/^(of|a|an|the)\b/i);
    }
  });

  it("every slider range label and alt text is built from its example name", () => {
    for (const example of EXAMPLES) {
      const name = example.name.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      expect(html).toContain(`aria-label="Before/after comparison for ${name}"`);
      expect(html).toMatch(new RegExp(`alt="Original photo ${name}"`));
      expect(html).toMatch(new RegExp(`alt="Edited photo ${name}"`));
    }
    expect(html).not.toMatch(/comparison for (of|a|an|the) /i);
    expect(html).not.toMatch(/alt="[^"]*\b(of of|for of|photo of an?) /);
  });

  it("the Open Graph image alt reads as a phrase without a dangling 'of'", async () => {
    const { metadata } = await import("./page");
    const images = metadata.openGraph?.images;
    const first = (Array.isArray(images) ? images[0] : images) as { alt?: string };
    expect(first.alt).toMatch(/^Enhanced listing photo: \S/);
    expect(first.alt).not.toMatch(/: (of|a|an|the) /i);
  });
});
