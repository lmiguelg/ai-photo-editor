// Static guards for the API routes job (AC 7, 17, 19, 20). Patterns are built so
// this file never matches itself.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const ROOT = path.dirname(SRC);

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const isTest = (file: string) => /\.test\.tsx?$/.test(file);

describe("API repo rules", () => {
  it("never raises sharp's input pixel limit", async () => {
    const option = new RegExp("limit" + "InputPixels\\s*:\\s*([^,}\\n]+)");
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const match = (await readFile(file, "utf8")).match(option);
      if (match) offenders.push(`${rel(file)}: ${match[1].trim()}`);
    }
    expect(offenders).toEqual([]);
  });

  it("createProviders is called in src/app and src/lib only by the run route", async () => {
    const call = new RegExp("createProviders" + "\\(");
    const callers: string[] = [];
    for (const dir of ["app", "lib"]) {
      for (const file of await sourceFiles(path.join(SRC, dir))) {
        if (isTest(file)) continue;
        if (call.test(await readFile(file, "utf8"))) callers.push(rel(file));
      }
    }
    expect(callers).toEqual(["src/app/api/listings/[listingId]/photos/[photoId]/run/route.ts"]);
  });

  it("the nine API route files exist and await their params", async () => {
    const api = path.join(SRC, "app", "api", "listings");
    const routes = (await sourceFiles(api)).filter((f) => path.basename(f) === "route.ts").map(rel).sort();
    expect(routes).toEqual(
      [
        "src/app/api/listings/route.ts",
        "src/app/api/listings/[listingId]/route.ts",
        "src/app/api/listings/[listingId]/photos/route.ts",
        "src/app/api/listings/[listingId]/photos/[photoId]/run/route.ts",
        "src/app/api/listings/[listingId]/photos/[photoId]/decision/route.ts",
        "src/app/api/listings/[listingId]/photos/[photoId]/image/route.ts",
        "src/app/api/listings/[listingId]/photos/[photoId]/reset/route.ts",
        "src/app/api/listings/[listingId]/export/route.ts",
        "src/app/api/listings/[listingId]/export/summary/route.ts",
      ].sort(),
    );
    for (const file of routes.filter((f) => f.includes("[listingId]"))) {
      const text = await readFile(path.join(ROOT, file), "utf8");
      expect(text, file).toMatch(/params: Promise</);
      expect(text, file).not.toContain("Route" + "Context");
    }
  });

  it("the upload route takes its format check from image-check and defines none itself", async () => {
    const route = await readFile(path.join(SRC, "app/api/listings/[listingId]/photos/route.ts"), "utf8");
    expect(route).toMatch(/from "@\/lib\/image-check"/u);
    expect(route).not.toMatch(new RegExp("(const|function)\\s+(EXTENSION_" + "FORMATS|detect" + "Format)\\b", "u"));
    expect(route).not.toMatch(/from "sharp"/u);
  });

  it("the image route builds the path only from the record via getPhotoFilePath", async () => {
    const file = path.join(SRC, "app", "api", "listings", "[listingId]", "photos", "[photoId]", "image", "route.ts");
    const text = await readFile(file, "utf8");
    expect(text).toContain("getPhotoFilePath(listingId, photoId, fileName)");
    expect(text).toContain("photo.originalFile");
    expect(text).toContain(".editedFile");
    // The only query values read are kind and attempt.
    const reads = [...text.matchAll(/query\.get\("([^"]+)"\)/g)].map((m) => m[1]).sort();
    expect(reads).toEqual(["attempt", "kind"]);
    expect(text).not.toMatch(/path\.join|safeJoin\(/);
  });

  it("AGENTS.md documents the routes, the new modules, attempt files, the cap and the 409 rule", async () => {
    const text = await readFile(path.join(ROOT, "AGENTS.md"), "utf8");
    for (const needle of [
      "src/app/api/listings/",
      "GET /api/listings`",
      "POST /api/listings`",
      "GET /api/listings/[listingId]`",
      "POST /api/listings/[listingId]/photos`",
      "/run`",
      "/decision`",
      "/image?kind=",
      "/reset`",
      "/export`",
      "/export/summary`",
      "src/lib/export.ts",
      "src/lib/export-summary.ts",
      "src/lib/http.ts",
      "src/lib/process-photo.ts",
      "attempt-<index>.<ext>",
      "25 MB",
      "409",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });
});
