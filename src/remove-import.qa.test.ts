// Static guards for removing the listing URL import feature (job 008, AC 1-4, 7, 9). Patterns are built
// so this file never matches itself.
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as imageCheck from "@/lib/image-check";
import * as review from "@/lib/review";
import * as listingRoute from "@/app/api/listings/[listingId]/route";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const ROOT = path.dirname(SRC);

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const SELF = rel(fileURLToPath(import.meta.url));

describe("URL import removal", () => {
  it("the import route, import lib folder, import form and import schema test are gone", async () => {
    const removed = [
      "src/app/api/listings/" + "import",
      "src/lib/listing-" + "import",
      "src/components/import-" + "listing-form.tsx",
      "src/lib/api-schemas" + ".test.ts",
    ];
    const present: string[] = [];
    for (const p of removed) if (await exists(path.join(ROOT, p))) present.push(p);
    expect(present).toEqual([]);
  });

  it("nothing in src, scripts or AGENTS.md references the URL import feature", async () => {
    const pattern = new RegExp(
      [
        "listing-" + "import",
        "ListingImport" + "Input",
        "ImportListing" + "Schema",
        "ImportListing" + "Form",
        "import-" + "listing-form",
        "UNSUPPORTED" + "_LINK",
        "import" + "Transport",
        "import" + "Listing",
        "api/listings/" + "import",
        "Link " + "imports",
        "link " + "import",
      ].join("|"),
    );
    const targets = [...(await files(SRC)), ...(await files(path.join(ROOT, "scripts"))), path.join(ROOT, "AGENTS.md")];
    const offenders: string[] = [];
    for (const file of targets) {
      if (rel(file) === SELF) continue;
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (pattern.test(line)) offenders.push(`${rel(file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("image-check keeps its exports and the upload route still uses it", async () => {
    expect(Object.keys(imageCheck).sort()).toEqual(["EXTENSION_FORMATS", "detectImageFormat"]);
    expect(await exists(path.join(SRC, "lib", "image-check.test.ts"))).toBe(true);
    const comment = await readFile(path.join(SRC, "lib", "image-check.ts"), "utf8");
    expect(comment).not.toMatch(/link/iu);
    const route = await readFile(path.join(SRC, "app/api/listings/[listingId]/photos/route.ts"), "utf8");
    expect(route).toMatch(/from "@\/lib\/image-check"/u);
  });

  it("the moved upload-route format rule lives in api-rules.qa.test.ts", async () => {
    const rules = await readFile(path.join(SRC, "api-rules.qa.test.ts"), "utf8");
    expect(rules).toContain('it("the upload route takes its format check from image-check and defines none itself"');
    expect(rules).toContain('it("the nine API route files exist and await their params"');
  });

  it("the full-mock banner text is the pre-import wording", async () => {
    const banner = await readFile(path.join(SRC, "components", "provider-mode-banner.tsx"), "utf8");
    expect(banner).toContain(
      '"Mock mode: no API calls are made, results are fake and cost $0. ANTHROPIC_API_KEY and FAL_KEY are not set.";',
    );
    expect(banner).not.toContain("sample " + "photos");
  });

  it("the listing route has no POST, so POST /api/listings/<anything> is not a create", () => {
    expect(Object.keys(listingRoute)).not.toContain("POST");
  });

  it("photo selection stays: review exports and workspace/card controls", async () => {
    expect(typeof review.selectionState).toBe("function");
    expect(typeof review.runSelectedQueue).toBe("function");
    const workspace = await readFile(path.join(SRC, "components", "listing-workspace.tsx"), "utf8");
    expect(workspace).toContain("Select all");
    expect(workspace).toContain("Run selected (${selectedCount})");
    expect(workspace).toContain("Run all");
    const card = await readFile(path.join(SRC, "components", "photo-card.tsx"), "utf8");
    expect(card).toMatch(/Select \$\{/u);
  });

  it("AGENTS.md matches requirement 11", async () => {
    const doc = await readFile(path.join(ROOT, "AGENTS.md"), "utf8");
    expect(doc).toContain("- `/` (`page.tsx`): create-listing form and the listings list");
    expect(doc).toContain("request-only Zod schemas (route params, upload fields, decision body, image query).");
    expect(doc).toMatch(/`src\/lib\/image-check\.ts`:[^\n]*used by the upload route only\./u);
    expect(doc).not.toMatch(/import-from-link|Importing photos/u);
    expect(doc).toContain("`selectionState(photos, selectedIds)`");
    expect(doc).toContain("`runSelectedQueue(photos, selectedIds, runningIds)`");
    expect(doc).toContain('photo selection with "Select all" and "Run selected (N)"');
    expect(doc).toContain("`photo-card.tsx` (with a `Select <name>` checkbox");
  });
});
