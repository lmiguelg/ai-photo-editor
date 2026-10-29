// QA: the management UI pages rendered with the real store under a temp DATA_DIR
// (server pages call the store directly), plus the layout banner and repo-level
// accessibility checks on the rendered markup.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TestRouter } from "@/components/test-router";
import { setupApiTestEnv } from "@/lib/api-test-helpers";
import { addPhoto, createListing, updatePhoto } from "@/lib/store";
import { config } from "@/pipeline/config";
import type { Photo } from "@/pipeline/schemas";
import { detailedImage } from "@/pipeline/test-helpers";
import RootLayout from "./layout";
import ListingPage from "./listings/[listingId]/page";
import Home from "./page";

setupApiTestEnv("management-ui-qa");

const ROOT = path.dirname(path.dirname(fileURLToPath(new URL(".", import.meta.url))));

let jpeg: Buffer;

beforeAll(async () => {
  jpeg = await detailedImage();
});

const wrap = (node: React.ReactNode) => renderToStaticMarkup(<TestRouter>{node}</TestRouter>);

async function renderListingPage(listingId: string): Promise<string> {
  return wrap(await ListingPage({ params: Promise.resolve({ listingId }) }));
}

const attempt = (costUsd: number) => ({
  index: 0,
  prompt: "Brighten",
  editedFile: "attempt-0.jpg",
  qa: { pass: true, scores: { faithfulness: 9, realism: 8, lighting: 8, coherence: 9 }, reason: "ok" },
  costUsd,
  createdAt: new Date().toISOString(),
});

async function photoIn(
  listingId: string,
  name: string,
  patch: Partial<Photo> = {},
): Promise<Photo> {
  const photo = await addPhoto(listingId, { roomType: "kitchen", originalName: name, data: jpeg });
  if (Object.keys(patch).length === 0) return photo;
  return updatePhoto(listingId, photo.id, (current) => ({ ...current, ...patch }));
}

/** Order of the photo cards as their data-photo-id attributes appear in the markup. */
function cardOrder(html: string, byId: Map<string, string>): string[] {
  return [...html.matchAll(/data-photo-id="([^"]+)"/g)].map((m) => byId.get(m[1]) ?? m[1]);
}

describe("home page with the real store", () => {
  it("shows No listings yet with an empty data dir", async () => {
    const html = wrap(await Home());
    expect(html).toContain("No listings yet");
    expect(html).toMatch(/<label for="listing-name"[^>]*>Listing name<\/label>/);
  });

  it("lists a new listing newest first with 0 photos and $0.00, linking to its page", async () => {
    const older = await createListing({ name: "Older flat" });
    await new Promise((resolve) => setImmediate(resolve));
    const newer = await createListing({ name: "Beach house", clientName: "Ann" });
    const html = wrap(await Home());
    expect(html).not.toContain("No listings yet");
    expect(html.indexOf("Beach house")).toBeLessThan(html.indexOf("Older flat"));
    expect(html).toContain(`href="/listings/${newer.id}"`);
    expect(html).toContain(`href="/listings/${older.id}"`);
    expect(html).toContain("Client: Ann");
    expect(html).toContain("0 photos");
    expect(html).toContain("AI cost $0.00");
    expect(html).not.toContain("to review");
  });
});

describe("listing page with the real store", () => {
  it("calls notFound for an unknown or invalid listing id", async () => {
    for (const listingId of ["00000000-0000-4000-8000-000000000000", "..%2F.."]) {
      const err = await ListingPage({ params: Promise.resolve({ listingId }) }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, listingId).toBeInstanceOf(Error);
      expect(String((err as { digest?: string }).digest)).toContain("404");
    }
  });

  it("header shows name, client, back link and the live cost summary against the $45 price", async () => {
    const listing = await createListing({ name: "<b>Villa</b>", clientName: "<i>Bob</i>" });
    await photoIn(listing.id, "a.jpg", { status: "passed", attempts: [attempt(0.12)], bestAttemptIndex: 0, costUsd: 0.12 });
    await photoIn(listing.id, "b.jpg", { status: "failed", costUsd: 0.08, error: "Run failed" });
    const html = await renderListingPage(listing.id);

    expect(config.pricing.listingPriceUsd).toBe(45);
    expect(html).toContain("&lt;b&gt;Villa&lt;/b&gt;");
    expect(html).toContain("Client: &lt;i&gt;Bob&lt;/i&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>← All listings<\/a>/);
    expect(html).toContain("AI cost $0.20 of $45.00 price, margin $44.80 (99.6%)");
    expect(html).toContain("2 photos, 1 to review");
    expect(html).toContain("Cost $0.120");
    expect(html).toContain("Cost $0.080");
  });

  it("orders cards for review: needs review, passed, processing, failed, uploaded, skipped, decided", async () => {
    const listing = await createListing({ name: "Mixed" });
    const decided = (verdict: "approved" | "rejected") => ({
      verdict,
      note: "",
      decidedAt: new Date().toISOString(),
    });
    const result = { attempts: [attempt(0)], bestAttemptIndex: 0 };
    const specs: [string, Partial<Photo>][] = [
      ["approved", { status: "passed", ...result, decision: decided("approved") }],
      ["rejected-by-you", { status: "needs_review", ...result, decision: decided("rejected") }],
      ["uploaded", {}],
      ["skipped", { status: "skipped" }],
      ["failed", { status: "failed", error: "Run failed" }],
      ["processing", { status: "processing" }],
      ["passed", { status: "passed", ...result }],
      ["needs-review", { status: "needs_review", ...result }],
    ];
    const byId = new Map<string, string>();
    for (const [name, patch] of specs) {
      const photo = await photoIn(listing.id, `${name}.jpg`, patch);
      byId.set(photo.id, name);
    }
    const html = await renderListingPage(listing.id);
    expect(cardOrder(html, byId)).toEqual([
      "needs-review",
      "passed",
      "processing",
      "failed",
      "uploaded",
      "skipped",
      "approved",
      "rejected-by-you",
    ]);
    // Chips: decisions override the label; processing shows Reset.
    expect(html).toContain(">Approved</span>");
    expect(html).toContain(">Rejected by you</span>");
    expect(html).toContain("Reset stuck photo");
    expect(html).toContain("motion-safe:animate-pulse");
  });

  it("renders the upload panel, Run all, an aria-live progress region and the shortcut hint", async () => {
    const listing = await createListing({ name: "Empty" });
    const html = await renderListingPage(listing.id);
    expect(html).toMatch(/<label for="upload-room-type"[^>]*>Room type for new uploads<\/label>/);
    expect(html).toContain('<option value="other" selected="">Other</option>');
    expect(html).toMatch(/<button type="button"[^>]*>Run all<\/button>/);
    expect(html).not.toContain(">Stop</button>");
    expect(html).toMatch(/<p aria-live="polite"/);
    expect(html).toMatch(/j \/ ↓ next, k \/ ↑ previous, a approve, r reject/);
    expect(html).toContain("No photos yet");
    expect(html).toContain("AI cost $0.00 of $45.00 price, margin $45.00 (100.0%)");
  });

  it("every control on the listing page has a label or aria-label and a visible focus style", async () => {
    const listing = await createListing({ name: "A11y" });
    const result = { attempts: [attempt(0)], bestAttemptIndex: 0 };
    await photoIn(listing.id, "passed.jpg", { status: "passed", ...result });
    await photoIn(listing.id, "stuck.jpg", { status: "processing" });
    await photoIn(listing.id, "new.jpg");
    const html = await renderListingPage(listing.id);

    const controls = [...html.matchAll(/<(input|select|textarea|button|a|article)\b([^>]*)>/g)];
    expect(controls.length).toBeGreaterThan(10);
    const missingFocus: string[] = [];
    const missingLabel: string[] = [];
    for (const [tag, name, attrs] of controls) {
      const id = attrs.match(/\bid="([^"]+)"/)?.[1];
      const labelled =
        /aria-label="[^"]+"/.test(attrs) || (id !== undefined && html.includes(`<label for="${id}"`));
      if ((name === "input" || name === "select" || name === "textarea") && !labelled) missingLabel.push(tag);
      // The visually hidden file input shows its ring on its label (has-[:focus-visible]).
      if (/\bsr-only\b/.test(attrs)) continue;
      if (!/focus-visible:ring/.test(attrs)) missingFocus.push(tag);
    }
    expect(missingLabel).toEqual([]);
    expect(missingFocus).toEqual([]);
    expect(html).toMatch(/<label for="upload-files"[^>]*has-\[:focus-visible\]:ring-2/);
    // Cards are focusable and named by file and status.
    expect(html).toMatch(/<article[^>]*tabindex="0"[^>]*aria-label="stuck.jpg, Processing"/);
  });
});

describe("layout banner", () => {
  const shell = () => renderToStaticMarkup(<RootLayout><p>child</p></RootLayout>);

  it("sits above <main> in mock mode and names both keys", () => {
    const html = shell();
    expect(html).toMatch(/<div role="status"[^>]*>[\s\S]*Mock mode[\s\S]*<\/div>\s*<main/);
    expect(html).toContain("ANTHROPIC_API_KEY and FAL_KEY are not set");
  });

  it("never leaks key values in partial or real mode", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-SENTINEL");
    let html = shell();
    expect(html).toContain("vision uses Anthropic (real, costs money); image editing is mocked (FAL_KEY not set)");
    expect(html).not.toContain("SENTINEL");
    vi.stubEnv("FAL_KEY", "fal-SENTINEL");
    html = shell();
    expect(html).not.toContain('role="status"');
    expect(html).not.toMatch(/mock mode/i);
    expect(html).not.toContain("SENTINEL");
  });
});

describe("docs", () => {
  it("AGENTS.md documents the management UI pieces", async () => {
    const text = await readFile(path.join(ROOT, "AGENTS.md"), "utf8");
    for (const needle of [
      "/reset",
      "providerMode",
      "src/components/",
      "src/lib/review.ts",
      "/listings/[listingId]",
      "listingPriceUsd",
      "isPhotoRunning",
      "RUN_ALL_CONCURRENCY = 2",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });

  it("createProviders takes its mode from providerMode (one source of truth)", async () => {
    const text = await readFile(path.join(ROOT, "src", "pipeline", "providers", "index.ts"), "utf8");
    const body = text.slice(text.indexOf("export function createProviders"));
    expect(body).toContain("providerMode(env)");
  });
});
