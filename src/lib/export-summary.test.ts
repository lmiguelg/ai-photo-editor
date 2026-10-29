import { describe, expect, it } from "vitest";
import type { Listing, Photo, PhotoStatus, RoomType } from "@/pipeline/schemas";
import { buildExportSummary, escapeHtml } from "./export-summary";

const NOW = "2026-01-01T00:00:00.000Z";
const LISTING_ID = "listing-0a1b2c";
const PROMPT = "Brighten the room evenly and keep the sofa";
const NOTE = "secret owner note";

let counter = 0;

function photo(roomType: RoomType, status: PhotoStatus, approved: boolean | null = true): Photo {
  counter += 1;
  return {
    id: `photo-${counter}-9f8e7d`,
    listingId: LISTING_ID,
    roomType,
    originalName: `IMG_${counter}_private.jpg`,
    originalFile: "original.jpg",
    status,
    attempts: [
      {
        index: 0,
        prompt: PROMPT,
        editedFile: "attempt-0.jpg",
        qa: { pass: true, scores: { faithfulness: 9 }, reason: "QA reason" },
        costUsd: 0.083,
        createdAt: NOW,
      },
    ],
    bestAttemptIndex: 0,
    costUsd: 0.083,
    decision: approved === null ? null : { verdict: approved ? "approved" : "rejected", note: NOTE, decidedAt: NOW },
    error: status === "failed" ? "Provider error 500" : null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: LISTING_ID,
    name: "Beach house",
    clientName: "Ana",
    createdAt: NOW,
    updatedAt: NOW,
    photos: [],
    ...overrides,
  };
}

const MIXED = () => [
  photo("bedroom", "passed"),
  photo("living_room", "needs_review"),
  photo("living_room", "passed"),
  photo("kitchen", "skipped", null),
  photo("living_room", "skipped", null),
  photo("bathroom", "passed", false),
  photo("bathroom", "passed", null),
  photo("dining", "failed", null),
  photo("exterior", "rejected", null),
];

describe("escapeHtml", () => {
  it("escapes & < > \" '", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    );
  });
});

describe("buildExportSummary", () => {
  it("writes the greeting, per-room counts and enhanced/kept line in order", () => {
    const { text, html } = buildExportSummary(listing({ photos: MIXED() }));
    expect(text).toBe(
      [
        "Hi Ana,",
        "",
        "Your photos for Beach house are ready.",
        "",
        "5 photos are included:",
        "- Living room: 3",
        "- Bedroom: 1",
        "- Kitchen: 1",
        "",
        "We enhanced 3 of them and kept 2 as they were because they already looked great. Every edit keeps your space true to how it really looks.",
        "",
        "Before/after previews are included so you can see the difference at a glance.",
        "",
        "Let me know if you'd like anything adjusted.",
        "",
        "Best regards,",
        "",
      ].join("\n"),
    );
    expect(html).toMatch(/^<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;">/);
    expect(html).toContain("<li>Living room: 3</li>");
    expect(html).toContain("5 photos are included:");
  });

  it("uses the singular and 'We enhanced it.' for one photo", () => {
    const { text } = buildExportSummary(listing({ photos: [photo("kitchen", "passed")] }));
    expect(text).toContain("1 photo is included:\n- Kitchen: 1");
    expect(text).toContain("We enhanced it. Every edit keeps your space true to how it really looks.");
  });

  it("says 'We enhanced all of them.' when no originals are included", () => {
    const { text } = buildExportSummary(listing({ photos: [photo("kitchen", "passed"), photo("bedroom", "passed")] }));
    expect(text).toContain("2 photos are included:");
    expect(text).toContain("We enhanced all of them.");
  });

  it("falls back to 'Hi there,' for a missing or blank client name", () => {
    for (const clientName of [null, "", "   "]) {
      const { text, html } = buildExportSummary(listing({ clientName, photos: [photo("kitchen", "passed")] }));
      expect(text.startsWith("Hi there,\n")).toBe(true);
      expect(html).toContain("Hi there,");
    }
  });

  it("escapes HTML-special characters in names", () => {
    const hostile = `<script>alert(1)</script> & "q" 'x'`;
    const { html, text } = buildExportSummary(
      listing({ name: hostile, clientName: hostile, photos: [photo("kitchen", "passed")] }),
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;x&#39;");
    expect(text).toContain(`Hi ${hostile},`);
  });

  it("uses only p, ul and li inside one styled div, with style as the only attribute", () => {
    const { html } = buildExportSummary(listing({ photos: MIXED() }));
    for (const banned of ["class=", "<a", "<img", "<style", "<script", " on"]) expect(html).not.toContain(banned);
    const tags = [...html.matchAll(/<([a-z]+)([^>]*)>/g)];
    expect(new Set(tags.map((m) => m[1]))).toEqual(new Set(["div", "p", "ul", "li"]));
    for (const [, , attrs] of tags) expect(attrs).toMatch(/^( style="[^"]*")?$/);
    expect(html.match(/<div/g)).toHaveLength(1);
  });

  it("holds no costs, scores, prompts, notes, errors, file names or ids", () => {
    const photos = MIXED();
    const { html, text } = buildExportSummary(listing({ photos }));
    for (const format of [html, text]) {
      for (const needle of ["$", "cost", "margin", "price", "QA", PROMPT, NOTE, "Provider error", "attempt-", "original.jpg", LISTING_ID]) {
        expect(format, needle).not.toContain(needle);
      }
      expect(format.toLowerCase()).not.toMatch(/cost|margin|price/);
      for (const p of photos) {
        expect(format).not.toContain(p.id);
        expect(format).not.toContain(p.originalName);
      }
    }
  });

  it("never mentions excluded photos", () => {
    const { text } = buildExportSummary(listing({ photos: MIXED() }));
    expect(text).not.toMatch(/Bathroom|Dining|Exterior|reject|fail|awaiting|left out/i);
  });
});
