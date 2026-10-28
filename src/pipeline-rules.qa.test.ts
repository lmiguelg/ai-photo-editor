// Static guards for the pipeline acceptance criteria (model ids, storage-free
// pipeline, config assumptions, AGENTS.md layout). Lives outside src/pipeline
// because it reads files. Patterns are built so this file never matches itself.
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

describe("pipeline repo rules", () => {
  it("no file outside src/pipeline/config.ts contains a Claude model id, and nothing mentions the top tier", async () => {
    const modelId = new RegExp("claude" + "-");
    const topTier = new RegExp("o" + "pus", "i");
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const text = await readFile(file, "utf8");
      if (modelId.test(text) && rel(file) !== "src/pipeline/config.ts") offenders.push(rel(file));
      if (topTier.test(text)) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });

  it("src/pipeline never touches storage or the filesystem, and never reads process.env", async () => {
    const storage = /lib\/store|lib\/paths|node:fs|from "fs"/;
    const env = /process\.env[.[]/;
    const offenders: string[] = [];
    for (const file of await sourceFiles(path.join(SRC, "pipeline"))) {
      const text = await readFile(file, "utf8");
      if (storage.test(text) || env.test(text)) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });

  it("the fal model id appears only in config.ts", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      if (rel(file) === "src/pipeline/config.ts") continue;
      if ((await readFile(file, "utf8")).includes("fal-" + "ai/")) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });

  it("config.ts holds both models, the limits and ASSUMPTION-marked prices", async () => {
    const text = await readFile(path.join(SRC, "pipeline", "config.ts"), "utf8");
    expect(text).toContain("claude" + "-haiku-5-5");
    expect(text).toContain("claude" + "-sonnet-5-5");
    expect(text).toContain("maxRetries: 2");
    expect(text).toContain("maxCostPerPhotoUsd");
    expect(text.match(/\/\/ ASSUMPTION: verify against current Anthropic pricing/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/\/\/ ASSUMPTION[^\n]*\n\s*costPerImageUsd/);
  });

  it("AGENTS.md Layout lists the pipeline modules and says runPhoto persists nothing", async () => {
    const agents = await readFile(path.join(ROOT, "AGENTS.md"), "utf8");
    const layout = agents.slice(agents.indexOf("## Layout"), agents.indexOf("## Cost rules"));
    for (const entry of [
      "config.ts",
      "prompts.ts",
      "metrics.ts",
      "images.ts",
      "cost.ts",
      "providers/",
      "anthropic.ts",
      "fal.ts",
      "mock.ts",
      "createProviders",
      "agents/",
      "run-photo.ts",
    ]) {
      expect(layout).toContain(entry);
    }
    expect(layout).toMatch(/storage-free and persists nothing/);
  });
});
