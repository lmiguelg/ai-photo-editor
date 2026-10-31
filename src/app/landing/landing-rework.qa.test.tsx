import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeforeAfterSlider } from "@/components/before-after-slider";
import { LandingHeaderCta } from "@/components/landing-header-cta";
import { LandingStatFigure } from "@/components/landing-stat-figure";
import {
  BRAND_NAME,
  FAITHFULNESS,
  FAQ,
  FINAL_CTA,
  HERO,
  OFFER,
  PAGE_META,
  PROBLEM,
  PROOF,
  STATS,
} from "@/lib/landing-content";
import LandingPage, { metadata } from "./page";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const html = renderToStaticMarkup(<LandingPage />);
const text = html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function decode(s: string): string {
  return s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

/** The markup of the section whose aria-labelledby is `id`. */
function section(id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  const end = html.indexOf("</section>", start);
  return html.slice(html.indexOf(">", start) + 1, end);
}

describe("rework 1 copy (QA)", () => {
  it("no price appears in the copy or metadata (the owner quotes it by email)", () => {
    expect(HERO.cta).toBe("Ask about my listing");
    expect(OFFER.heading).toBe("Tell us about your listing");
    expect(PAGE_META.description).not.toMatch(/\$|price|per listing/i);
  });

  it("the hero has the rework headline, sub-line, CTA to #contact and a note with no unsupported approval promise", () => {
    const hero = section("hero-heading");
    expect(decode(hero)).toContain(HERO.headline);
    expect(decode(hero)).toContain(HERO.subline);
    expect(hero).toMatch(/<a id="hero-cta" href="#contact"[^>]*>Ask about my listing<\/a>/);
    expect(HERO.note).toBe("Email us to get started.");
    expect(text.toLowerCase()).not.toContain("before anything goes live");
  });

  it("the problem strip comes right after the hero, before the steps, and holds no number", () => {
    const order = ["hero-heading", "problem-heading", "steps-heading", "contact-heading"].map((id) =>
      html.indexOf(`aria-labelledby="${id}"`),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const problem = section("problem-heading");
    expect(problem).toContain(PROBLEM.heading);
    expect(problem).toContain(PROBLEM.body);
    expect(problem.replace(/<[^>]+>/g, " ")).not.toMatch(/\d/);
  });

  it("the proof section states the honesty line before the stat cards", () => {
    const proof = decode(section("stats-heading"));
    expect(proof).toContain(PROOF.heading);
    expect(PROOF.intro).toMatch(/not our service/);
    const intro = proof.indexOf(PROOF.intro);
    expect(intro).toBeGreaterThan(-1);
    expect(intro).toBeLessThan(proof.indexOf("<ul"));
    expect((proof.match(/<li/g) ?? []).length).toBe(STATS.length);
  });

  it("the faithfulness section has the new heading, the five chips and the change / never-change pair", () => {
    const faithful = decode(section("faithful-heading"));
    expect(faithful).toContain(FAITHFULNESS.heading);
    expect(faithful).toContain(FAITHFULNESS.promise);
    expect(FAITHFULNESS.changes).toHaveLength(5);
    for (const chip of FAITHFULNESS.changes) expect(faithful).toContain(`>${chip}</li>`);
    expect(faithful).toContain("We change:");
    expect(faithful).toContain(FAITHFULNESS.weChange);
    expect(faithful).toContain("We never change:");
    expect(faithful).toContain(FAITHFULNESS.weNeverChange);
    for (const kept of ["furniture", "fixtures", "walls", "windows", "views"]) expect(FAITHFULNESS.weNeverChange).toContain(kept);
  });

  it("the offer section names no price, tier, subscription or per-photo fee", () => {
    const offer = section("offer-heading");
    expect(offer).toContain(OFFER.heading);
    expect(OFFER.body).toBe("Email us your photos and we will reply with the details.");
    expect(offer).toMatch(/<a href="#contact"[^>]*>Ask about my listing<\/a>/);
    const lower = text.toLowerCase();
    expect(lower).not.toContain("per-photo");
    expect(lower).not.toContain("per photo");
    expect(lower).not.toContain("subscription");
  });

  it("the FAQ keeps five questions with answers of at most two sentences", () => {
    expect(FAQ).toHaveLength(5);
    for (const item of FAQ) {
      const sentences = item.answer.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, item.question).toBeLessThanOrEqual(2);
    }
  });

  it("the final CTA heading and the mailto: button sit in the #contact section", () => {
    const contact = decode(html.slice(html.indexOf('id="contact"')));
    expect(contact).toContain(`id="contact-heading"`);
    expect(contact).toContain(FINAL_CTA.heading);
    expect(contact).toMatch(new RegExp(`<a href="mailto:[^"]*"[^>]*>${FINAL_CTA.button}</a>`));
    expect(FINAL_CTA.button).toBe("Send me my photos");
  });

  it("metadata uses the rework title and description, and OG copies them", () => {
    expect(PAGE_META.title).toBe(`Enhance your Airbnb and Vrbo photos | ${BRAND_NAME}`);
    expect(PAGE_META.description).toBe(
      "Fix the light, colour and crooked lines in your listing photos. We never change what guests will find.",
    );
    expect(metadata.title).toBe(PAGE_META.title);
    expect(metadata.description).toBe(PAGE_META.description);
    expect(metadata.openGraph?.title).toBe(PAGE_META.title);
    expect(metadata.openGraph?.description).toBe(PAGE_META.description);
  });
});

describe("rework 1 UI pieces (QA)", () => {
  it("the header CTA is server-rendered invisible (out of the tab order) and links to #contact", () => {
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    const link = header.match(/<a [^>]*>/)?.[0] ?? "";
    expect(link).toContain('href="#contact"');
    expect(link).toMatch(/class="[^"]*\binvisible\b/);
    expect(link).toMatch(/focus-visible:/);
    expect(header).toContain("sticky");
  });

  it("LandingHeaderCta renders the label with motion-safe transitions only", () => {
    const out = renderToStaticMarkup(<LandingHeaderCta heroCtaId="x" label="Go" className="c" />);
    expect(out).toMatch(/^<a href="#contact" class="[^"]*">Go<\/a>$/);
    for (const token of out.match(/class="([^"]*)"/)![1].split(/\s+/)) {
      expect(/^(animate-|transition|duration-)/.test(token), token).toBe(false);
    }
  });

  it("each stat figure is server-rendered as the exact sourced text with no counting copy", () => {
    for (const stat of STATS) {
      const out = renderToStaticMarkup(<LandingStatFigure figure={stat.figure} className="f" />);
      expect(out).toBe(`<span class="relative inline-block"><span class="f">${stat.figure}</span></span>`);
      expect(html).toContain(`>${stat.figure}</span>`);
    }
    expect(html).not.toMatch(/aria-hidden="true"[^>]*>\d/);
  });

  it("the hero slider is the first slider and loads eagerly; the second lazy-loads", () => {
    const hero = section("hero-heading");
    expect(hero).toMatch(/<input type="range"/);
    const heroImgs = hero.match(/<img [^>]*>/g) ?? [];
    expect(heroImgs).toHaveLength(2);
    for (const img of heroImgs) expect(img).not.toMatch(/loading="lazy"/);
    const others = section("examples-heading").match(/<img [^>]*>/g) ?? [];
    expect(others.length).toBeGreaterThan(0);
    for (const img of others) expect(img).toMatch(/loading="lazy"/);
  });

  it("showcase slider lays the labelled range input over the image with a focus ring on the frame", () => {
    const out = renderToStaticMarkup(
      <BeforeAfterSlider originalSrc="/examples/a.jpg" editedSrc="/examples/b.jpg" name="kitchen" width={800} height={600} />,
    );
    expect(out).toMatch(/^<div class="[^"]*has-\[input:focus-visible\]:ring-4/);
    expect(out).toMatch(/<input type="range"[^>]*aria-label="Before\/after comparison for kitchen"[^>]*class="absolute inset-0[^"]*"/);
    expect(out).toContain(">Before</span>");
    expect(out).toContain(">After</span>");
    expect(out).toContain("clip-path:inset(0 0 0 50%)");
    expect(out).toMatch(/motion-safe:animate-landing-nudge/);
  });

  it("every section after the hero uses the scroll reveal class, and the hero does not", () => {
    expect(section("hero-heading")).not.toContain("landing-reveal");
    for (const id of ["problem-heading", "examples-heading", "steps-heading", "stats-heading", "faithful-heading", "offer-heading", "faq-heading"]) {
      expect(section(id), id).toContain("landing-reveal");
    }
  });
});

describe("rework 1 CSS stays scoped and motion-safe (QA)", () => {
  it("globals.css adds no owner-facing tokens and puts reveal and smooth scroll behind reduced-motion", async () => {
    const css = await readFile(path.join(ROOT, "src", "app", "globals.css"), "utf8");
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // Every custom property in @theme is landing-only.
    for (const prop of noComments.match(/--[\w-]+(?=\s*:)/g) ?? []) expect(prop, prop).toMatch(/^--animate-landing-/);
    // No base element rules (body, :root, html without the landing scope).
    expect(noComments).not.toMatch(/(^|[\s}])(body|:root)\s*\{/);
    const media = noComments.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(media).toBeGreaterThan(-1);
    expect(noComments.indexOf("scroll-behavior")).toBeGreaterThan(media);
    expect(noComments.indexOf(".landing-reveal")).toBeGreaterThan(media);
    expect(noComments).toMatch(/html:has\(\.landing-page\)\s*\{\s*scroll-behavior:\s*smooth/);
  });

  it("the landing animation utilities are only used behind motion-safe:", async () => {
    const files = [
      path.join(ROOT, "src", "app", "landing", "page.tsx"),
      path.join(ROOT, "src", "components", "before-after-slider.tsx"),
    ];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const m of source.matchAll(/(\S*)animate-landing-[\w-]+/g)) {
        expect(m[1], `${file}: ${m[0]}`).toMatch(/motion-safe:$/);
      }
    }
  });
});
