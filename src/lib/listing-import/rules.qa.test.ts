// Static guards for link imports (job 007, AC 2 and 8). Patterns are built so this
// file never matches itself.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const SRC = path.resolve(DIR, "../..");

describe("link import rules", () => {
  it("opens network connections only in listing-import/net.ts", async () => {
    const pattern = new RegExp(["https", "\\.request|", "https", "\\.get\\(|\\bfetch", "\\(|node:", "http\\b|node:net\\b"].join(""));
    const offenders: string[] = [];
    for (const name of await readdir(DIR)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name === "net.ts") continue;
      const text = await readFile(path.join(DIR, name), "utf8");
      if (pattern.test(text.replace(/import \{ isIP \} from "node:net";/u, ""))) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it("the upload route takes its format check from image-check and defines none itself", async () => {
    const route = await readFile(path.join(SRC, "app/api/listings/[listingId]/photos/route.ts"), "utf8");
    expect(route).toMatch(/from "@\/lib\/image-check"/u);
    expect(route).not.toMatch(new RegExp("(const|function)\\s+(EXTENSION_" + "FORMATS|detect" + "Format)\\b", "u"));
    expect(route).not.toMatch(/from "sharp"/u);
  });

  it("the client import form imports nothing server-only", async () => {
    const form = await readFile(path.join(SRC, "components/import-listing-form.tsx"), "utf8");
    const imports = [...form.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]);
    expect(form.startsWith('"use client"')).toBe(true);
    for (const spec of imports) {
      expect(["react", "next/navigation", "@/pipeline/schemas", "@/pipeline/config", "@/lib/review"]).toContain(spec);
    }
  });
});
