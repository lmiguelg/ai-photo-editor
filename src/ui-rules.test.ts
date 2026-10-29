// Static guards for the management UI. Patterns are built so this file never
// matches itself.
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

function imports(text: string): string[] {
  return [...text.matchAll(/^import[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1]);
}

describe("UI repo rules", () => {
  it("no source file sets raw HTML", async () => {
    const pattern = new RegExp("dangerously" + "SetInnerHTML|inner" + "HTML");
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      if (isTest(file)) continue;
      if (pattern.test(await readFile(file, "utf8"))) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });

  it("src/lib/review.ts stays client-safe", async () => {
    const text = await readFile(path.join(SRC, "lib", "review.ts"), "utf8");
    expect(imports(text)).toEqual(["@/pipeline/schemas"]);
  });

  it("client components import only schemas, config, review helpers and other client components", async () => {
    const allowed = new Set(["react", "next/link", "next/navigation", "@/pipeline/schemas", "@/pipeline/config", "@/lib/review"]);
    const offenders: string[] = [];
    for (const file of await sourceFiles(path.join(SRC, "components"))) {
      if (isTest(file)) continue;
      const text = await readFile(file, "utf8");
      if (!text.startsWith('"use client";')) continue;
      for (const source of imports(text)) {
        if (allowed.has(source)) continue;
        const sibling = source.startsWith("./") ? path.join(path.dirname(file), `${source}.tsx`) : null;
        if (sibling && (await readFile(sibling, "utf8")).startsWith('"use client";')) continue;
        offenders.push(`${rel(file)}: ${source}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("animations and transitions in components are motion-safe only", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(path.join(SRC, "components"))) {
      if (isTest(file)) continue;
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/(\S*)\b(animate-[a-z-]+|transition(?:-[a-z]+)?)\b/g)) {
        if (!match[1].endsWith("motion-safe:")) offenders.push(`${rel(file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("pages that read the store or env render per request", async () => {
    for (const page of ["app/page.tsx", "app/listings/[listingId]/page.tsx"]) {
      const text = await readFile(path.join(SRC, page), "utf8");
      expect(text, page).toContain('export const dynamic = "force-dynamic";');
    }
  });
});
