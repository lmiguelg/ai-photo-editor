import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildContactMailto, contactSchema } from "./landing-contact";
import { CONTACT_EMAIL } from "./landing-content";

const SRC = path.resolve(__dirname, "..");
const valid = { name: "Ann", email: "ann@example.org" };

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("contactSchema boundaries (req 15)", () => {
  it.each([
    ["a 100-character name", { name: "a".repeat(100) }],
    ["an http: listing URL", { listingUrl: "http://example.com/rooms/1" }],
    ["a 500-character listing URL", { listingUrl: `https://example.com/${"a".repeat(500 - "https://example.com/".length)}` }],
    ["a 1000-character message", { message: "a".repeat(1000) }],
  ])("accepts %s", (_label, patch) => {
    expect(contactSchema.safeParse({ ...valid, ...patch }).success).toBe(true);
  });

  it.each([
    ["a missing name", { name: undefined }],
    ["a missing email", { email: undefined }],
    ["an email without a domain", { email: "ann@" }],
    ["a data: listing URL", { listingUrl: "data:text/html,hi" }],
    ["a mailto: listing URL", { listingUrl: "mailto:a@b.co" }],
    ["a listing URL that is not a URL", { listingUrl: "airbnb rooms 1" }],
    ["a 501-character listing URL", { listingUrl: `https://example.com/${"a".repeat(501 - "https://example.com/".length)}` }],
  ])("rejects %s", (_label, patch) => {
    expect(contactSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("puts an error on the listingUrl path for a bad link", () => {
    const result = contactSchema.safeParse({ ...valid, listingUrl: "javascript:alert(1)" });
    expect(result.error?.issues.map((i) => i.path[0])).toEqual(["listingUrl"]);
  });
});

describe("buildContactMailto (req 15)", () => {
  it("leaves out optional fields that were not given", () => {
    const href = buildContactMailto(contactSchema.parse(valid), CONTACT_EMAIL);
    const body = new URLSearchParams(href.split("?")[1]).get("body") ?? "";
    expect(body).toBe("Name: Ann\nEmail: ann@example.org");
  });

  it("encodes every value with encodeURIComponent (spaces as %20, not +)", () => {
    const href = buildContactMailto(contactSchema.parse({ ...valid, name: "Ann Host" }), CONTACT_EMAIL);
    expect(href).toContain(`body=${encodeURIComponent("Name: Ann Host\nEmail: ann@example.org")}`);
    expect(href).not.toContain("+");
  });

  it("a crafted name cannot change the recipient", () => {
    const href = buildContactMailto(contactSchema.parse({ ...valid, name: "x?to=evil@example.com" }), CONTACT_EMAIL);
    expect(href.slice(0, href.indexOf("?"))).toBe(`mailto:${CONTACT_EMAIL}`);
  });
});

describe("contact form stores and sends nothing (req 16, AC 6)", () => {
  it("form and contact module hold no fetch, storage or cookies", async () => {
    for (const file of ["components/landing-contact-form.tsx", "lib/landing-contact.ts"]) {
      const text = await readFile(path.join(SRC, file), "utf8");
      expect(text, file).not.toMatch(/fetch|localStorage|sessionStorage|cookie|indexedDB|console\./);
    }
  });

  it("the form opens the mailto via window.location.href after safeParse", async () => {
    const text = await readFile(path.join(SRC, "components", "landing-contact-form.tsx"), "utf8");
    expect(text.startsWith('"use client"')).toBe(true);
    expect(text).toContain("contactSchema.safeParse");
    expect(text).toMatch(/window\.location\.href\s*=\s*buildContactMailto\(/);
    expect(text).toContain("aria-invalid");
    expect(text).toContain("aria-describedby");
  });

  it("there is no contact API route and no server action anywhere in src", async () => {
    expect(existsSync(path.join(SRC, "app", "api", "contact"))).toBe(false);
    for (const file of await walk(SRC)) {
      if (/\.test\.tsx?$/.test(file)) continue;
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(/["']use server["']/);
    }
  });
});
