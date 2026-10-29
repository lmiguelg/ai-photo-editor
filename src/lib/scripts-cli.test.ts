import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FeedbackEntry } from "@/pipeline/schemas";
import { detailedImage } from "@/pipeline/test-helpers";

/**
 * Runs the real `npm run diagnose` / `npm run eval` commands (from package.json) in a
 * child process, with DATA_DIR at a temp folder and the API keys forced empty so the
 * providers are mocks even if a `.env.local` exists (env vars win over the env file).
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TIMEOUT = 60_000;

interface PackageJson {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
}

let tmp = "";
let dataDir = "";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-photo-editor-cli-"));
  dataDir = path.join(tmp, "data");
  await fs.mkdir(dataDir);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function packageJson(): Promise<PackageJson> {
  return JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8")) as PackageJson;
}

async function runScript(name: string, ...args: string[]) {
  const command = (await packageJson()).scripts[name].split(" ");
  expect(command[0]).toBe("node");
  const result = spawnSync(process.execPath, [...command.slice(1), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, DATA_DIR: dataDir, ANTHROPIC_API_KEY: "", FAL_KEY: "" },
    timeout: TIMEOUT,
  });
  // Node itself prints this notice for `--env-file-if-exists` when there is no `.env.local`.
  const stderr = result.stderr
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(".env.local not found"))
    .join("\n");
  return { code: result.status, stdout: result.stdout, stderr, output: result.stdout + stderr };
}

function gitStatusSrc(): string {
  return spawnSync("git", ["status", "--porcelain", "--", "src"], { cwd: ROOT, encoding: "utf8" }).stdout;
}

function kitchenFaithfulnessFail(n: number): FeedbackEntry {
  return {
    kind: "qa_fail",
    at: `2026-10-0${n}T10:00:00.000Z`,
    listingId: "listing-1",
    photoId: `photo-${n}`,
    roomType: "kitchen",
    photoStatus: "needs_review",
    attemptIndex: 0,
    prompt: "Brighten evenly",
    qa: { pass: false, scores: { faithfulness: 5, realism: 9, lighting: 9, coherence: 9 }, reason: "Fridge removed" },
    note: "",
  };
}

describe("package.json scripts", () => {
  it("lists tsx and the diagnose / eval scripts exactly as specified", async () => {
    const pkg = await packageJson();
    expect(pkg.devDependencies.tsx).toBeTruthy();
    expect(pkg.scripts.diagnose).toBe("node --env-file-if-exists=.env.local --import tsx scripts/diagnose.ts");
    expect(pkg.scripts.eval).toBe("node --env-file-if-exists=.env.local --import tsx scripts/eval.ts");
  });
});

describe("npm run diagnose", () => {
  it("writes a 'No feedback entries yet.' report for an empty data dir", async () => {
    await fs.rm(dataDir, { recursive: true });
    const { code, stdout } = await runScript("diagnose");
    expect(code).toBe(0);
    const reportPath = path.join(dataDir, "feedback-report.md");
    expect(stdout).toContain(reportPath);
    const report = await fs.readFile(reportPath, "utf8");
    expect(report).toContain("No feedback entries yet.");
    expect(report).toContain("nothing was edited");
    expect(await fs.readdir(dataDir)).toEqual(["feedback-report.md"]);
  }, TIMEOUT);

  it("clusters 3 kitchen faithfulness failures, counts the garbage line and leaves src/ untouched", async () => {
    const before = gitStatusSrc();
    const lines = [1, 2, 3].map((n) => JSON.stringify(kitchenFaithfulnessFail(n)));
    lines.splice(1, 0, "garbage");
    await fs.writeFile(path.join(dataDir, "feedback.jsonl"), `${lines.join("\n")}\n`, "utf8");
    await fs.writeFile(path.join(dataDir, "feedback-report.md"), "old report", "utf8");

    const { code, stdout } = await runScript("diagnose");
    expect(code).toBe(0);
    expect(stdout).toMatch(/Entries: 3, invalid lines: 1, clusters: 1/);
    const report = await fs.readFile(path.join(dataDir, "feedback-report.md"), "utf8");
    expect(report).not.toContain("old report");
    expect(report).toContain("Entries: 3 (qa_fail: 3, human_reject: 0)");
    expect(report).toContain("Invalid lines skipped: 1");
    expect(report).toContain("### qa_fail / kitchen / faithfulness");
    const proposed = report.slice(report.indexOf("## Proposed changes"), report.indexOf("## Clusters"));
    expect(proposed).toContain("SYNTHESIZER_SYSTEM and REFINER_SYSTEM in src/pipeline/prompts.ts");
    expect(proposed).toContain("kitchen");
    expect((await fs.readdir(dataDir)).sort()).toEqual(["feedback-report.md", "feedback.jsonl"]);
    expect(gitStatusSrc()).toBe(before);
  }, TIMEOUT);
});

describe("npm run eval", () => {
  it("prints the usage and exits 1 without a folder", async () => {
    const { code, output } = await runScript("eval");
    expect(code).toBe(1);
    expect(output).toContain("Usage: npm run eval -- <folder>");
  }, TIMEOUT);

  it("prints an error and exits 1 for a missing folder or one without images", async () => {
    const missing = await runScript("eval", path.join(tmp, "does-not-exist"));
    expect(missing.code).toBe(1);
    expect(missing.output.trim()).toMatch(/error/i);
    expect(missing.output.trim().split("\n")).toHaveLength(1);

    const empty = path.join(tmp, "empty");
    await fs.mkdir(path.join(empty, "attic"), { recursive: true });
    await fs.writeFile(path.join(empty, "notes.txt"), "x");
    await fs.writeFile(path.join(empty, "attic", "a.jpg"), "x");
    const none = await runScript("eval", empty);
    expect(none.code).toBe(1);
    expect(none.output.trim()).toMatch(/error/i);
    expect(none.output.trim().split("\n")).toHaveLength(1);
  }, TIMEOUT);

  it("runs a folder in mock mode, reports 100% pass and $0 cost, and writes nothing to DATA_DIR", async () => {
    const samples = path.join(tmp, "samples");
    await fs.mkdir(path.join(samples, "kitchen"), { recursive: true });
    const image = await detailedImage();
    await fs.writeFile(path.join(samples, "a.jpg"), image);
    await fs.writeFile(path.join(samples, "kitchen", "b.jpg"), image);

    const { code, stdout } = await runScript("eval", samples);
    expect(code).toBe(0);
    expect(stdout).toContain("vision mock, editor mock");
    const imageLines = stdout.split(/\r?\n/).filter((line) => /\.jpg\s/.test(line));
    expect(imageLines).toHaveLength(2);
    expect(imageLines[0]).toMatch(/^a\.jpg\s+other\s+passed\b/);
    expect(imageLines[1]).toMatch(/^kitchen\/b\.jpg\s+kitchen\s+passed\b/);
    expect(stdout).toContain("Pass rate: 100%");
    expect(stdout).toMatch(/Mean retries: 0(\.0+)?\b/);
    expect(stdout).toMatch(/Mean cost per image: \$0\.0+\b/);
    expect(await fs.readdir(dataDir)).toEqual([]);
    expect((await fs.readdir(samples)).sort()).toEqual(["a.jpg", "kitchen"]);
  }, TIMEOUT);
});
