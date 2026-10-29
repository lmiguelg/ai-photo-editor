// Static guards for the vivid-but-realistic colour prompt change: the AGENTS.md
// prompts.ts bullet and the untouched QA config. Lives outside src/pipeline
// because it reads files.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { config } from "./pipeline/config";

const ROOT = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

describe("vivid colour prompt change", () => {
  it("AGENTS.md prompts.ts bullet mentions natural colour pop and QA penalising over-saturation", async () => {
    const agents = await readFile(path.join(ROOT, "AGENTS.md"), "utf8");
    const bullet = agents.split("\n").find((line) => line.trimStart().startsWith("- `prompts.ts`:")) ?? "";
    expect(bullet).toMatch(/natural colour pop/);
    expect(bullet).toMatch(/vibrance\/contrast/);
    expect(bullet).toMatch(/QA gate penalises over-saturation/);
  });

  it("keeps the QA rubric keys and pass threshold unchanged", () => {
    expect([...config.qa.rubric]).toEqual(["faithfulness", "realism", "lighting", "coherence"]);
    expect(config.qa.minScore).toBe(7);
  });
});
