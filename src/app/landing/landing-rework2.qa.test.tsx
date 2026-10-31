import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CONTACT_EMAIL,
  CONTACT_MAILTO,
  CONTACT_MAILTO_WITH_SUBJECT,
  CONTACT_SUBJECT,
  FINAL_CTA,
  HERO,
  HEADER_CTA,
} from "@/lib/landing-content";
import LandingPage from "./page";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src");
const html = renderToStaticMarkup(<LandingPage />);

function decode(s: string): string {
  return s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const isTest = (file: string) => /\.test\.(ts|tsx)$/.test(file);

/** Every `<a>` on the page as `{ href, text }`, decoded. */
const links = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)].map((m) => ({
  href: decode(m[1]),
  text: decode(m[2].replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "")).trim(),
}));

describe("rework 2: mailto contact instead of a form (QA)", () => {
  it("renders no form, form field, label or validation attribute anywhere", () => {
    expect(html).not.toMatch(/<form[\s>]/);
    expect(html).not.toMatch(/<(textarea|select|button)[\s>]/);
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
    for (const input of inputs) expect(input).toContain('type="range"');
    expect(html).not.toMatch(/<label[\s>]/);
    expect(html).not.toMatch(/aria-invalid|novalidate|formaction/i);
  });

  it("keeps the final #contact section last, with its heading, the email lead and both mailto links", () => {
    const sections = [...html.matchAll(/<section[^>]*>/g)].map((m) => m[0]);
    expect(sections.at(-1)).toContain('id="contact"');
    expect(FINAL_CTA.heading).toBe("Ready for photos that do your place justice?");
    const contact = decode(html.slice(html.indexOf('id="contact"')));
    expect(contact).toContain(FINAL_CTA.heading);
    expect(contact).toContain(FINAL_CTA.emailLead);
    expect(FINAL_CTA.emailLead).toMatch(/^Email your photos to/);
    // The lead sentence is followed by the address link in the same paragraph.
    expect(contact).toMatch(
      new RegExp(`<p[^>]*>${FINAL_CTA.emailLead}\\s*<a href="mailto:${CONTACT_EMAIL}"[^>]*>${CONTACT_EMAIL}</a></p>`),
    );
  });

  it("has exactly two mailto links, both in #contact and both to CONTACT_EMAIL", () => {
    const mailtos = links.filter((l) => l.href.startsWith("mailto:"));
    expect(mailtos).toHaveLength(2);
    const contactStart = html.indexOf('id="contact"');
    for (const m of html.matchAll(/href="mailto:/g)) expect(m.index).toBeGreaterThan(contactStart);
    for (const { href } of mailtos) {
      const url = new URL(href);
      expect(url.protocol).toBe("mailto:");
      expect(url.pathname).toBe(CONTACT_EMAIL);
    }
    expect(mailtos.map((l) => l.href)).toEqual([CONTACT_MAILTO, CONTACT_MAILTO_WITH_SUBJECT]);
    expect(mailtos.map((l) => l.text)).toEqual([CONTACT_EMAIL, FINAL_CTA.button]);
  });

  it("the button subject is plain text, URI-encoded, and adds no other mailto parameter", () => {
    expect(CONTACT_SUBJECT).toMatch(/^[A-Za-z ]+$/);
    const url = new URL(CONTACT_MAILTO_WITH_SUBJECT);
    expect([...url.searchParams.keys()]).toEqual(["subject"]);
    expect(decodeURIComponent(url.search.slice("?subject=".length))).toBe(CONTACT_SUBJECT);
    expect(CONTACT_MAILTO_WITH_SUBJECT).not.toMatch(/[\s&#]/);
    expect(CONTACT_MAILTO_WITH_SUBJECT).toMatch(/subject=Photo%20enhancement/);
  });

  it("every other CTA (header, hero, offer) keeps one behaviour: a plain #contact anchor", () => {
    const toContact = links.filter((l) => l.href === "#contact").map((l) => l.text);
    expect(toContact).toContain(HERO.cta);
    expect(toContact).toContain(HEADER_CTA);
    expect(toContact.filter((t) => t === HERO.cta)).toHaveLength(2); // hero and offer
    expect(toContact.length).toBeGreaterThanOrEqual(3);
    for (const { href } of links) {
      const ok = href === "#contact" || href.startsWith("https://") || href.startsWith(`mailto:${CONTACT_EMAIL}`);
      expect(ok, href).toBe(true);
    }
  });

  it("CONTACT_EMAIL keeps the placeholder, says it is the only line to change, and is set nowhere else", async () => {
    expect(CONTACT_EMAIL).toBe("hello@example.com");
    const content = await readFile(path.join(SRC, "lib", "landing-content.ts"), "utf8");
    const lines = content.split(/\r?\n/);
    const at = lines.findIndex((l) => /export const CONTACT_EMAIL = "/.test(l));
    expect(at).toBeGreaterThan(-1);
    const comments = lines.slice(Math.max(0, at - 3), at).join(" ");
    expect(comments).toMatch(/only line to change/i);
    expect(comments).toMatch(/before publishing/i);

    for (const file of await sourceFiles(SRC)) {
      if (isTest(file) || file.endsWith(path.join("lib", "landing-content.ts"))) continue;
      const text = await readFile(file, "utf8");
      expect(text, file).not.toContain("hello@example.com");
      expect(text, file).not.toMatch(/mailto:[a-z0-9]/i);
    }
  });

  it("FINAL_CTA copy no longer describes a form submission", () => {
    const copy = Object.values(FINAL_CTA).join(" ");
    expect(copy).not.toMatch(/submit|form|nothing is stored|tell us about/i);
  });

  it("leaves no dead form code: files, imports, symbols or AGENTS.md mentions", async () => {
    expect(existsSync(path.join(SRC, "lib", "landing-contact.ts"))).toBe(false);
    expect(existsSync(path.join(SRC, "lib", "landing-contact.test.ts"))).toBe(false);
    expect(existsSync(path.join(SRC, "lib", "landing-contact.qa.test.ts"))).toBe(false);
    expect(existsSync(path.join(SRC, "components", "landing-contact-form.tsx"))).toBe(false);
    const banned = /landing-contact|contactSchema|buildContactMailto|LandingContactForm/;
    for (const file of await sourceFiles(SRC)) {
      if (file === __filename) continue;
      expect(await readFile(file, "utf8"), file).not.toMatch(banned);
    }
    const agents = await readFile(path.join(ROOT, "AGENTS.md"), "utf8");
    expect(agents).not.toMatch(banned);
    expect(agents).not.toMatch(/contact form/i);
  });

  it("no landing code fetches, stores, navigates by script or uses a server action, and src has no contact route", async () => {
    const files = [
      path.join(SRC, "app", "landing", "page.tsx"),
      path.join(SRC, "lib", "landing-content.ts"),
      path.join(SRC, "components", "landing-header-cta.tsx"),
      path.join(SRC, "components", "landing-stat-figure.tsx"),
      path.join(SRC, "components", "before-after-slider.tsx"),
    ];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(
        /\bfetch\b|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|cookie|window\.location|use server/i,
      );
    }
    for (const file of await sourceFiles(SRC)) {
      if (isTest(file)) continue;
      expect(await readFile(file, "utf8"), file).not.toMatch(/["']use server["']/);
    }
    expect(existsSync(path.join(SRC, "app", "api", "contact"))).toBe(false);
  });
});
