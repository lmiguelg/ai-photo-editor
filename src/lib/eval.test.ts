import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { detailedImage, FakeEditor, ScriptedVision, uniformImage } from "@/pipeline/test-helpers";
import { formatEvalReport, listEvalImages, runEval, summarizeEval, type EvalRow } from "./eval";

let folder = "";
let detailed: Buffer;
let uniform: Buffer;

beforeAll(async () => {
  detailed = await detailedImage();
  uniform = await uniformImage();
});

beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "ai-photo-editor-eval-"));
});

afterEach(async () => {
  await fs.rm(folder, { recursive: true, force: true });
});

async function touch(...files: string[]) {
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(folder, file)), { recursive: true });
    await fs.writeFile(path.join(folder, file), "x");
  }
}

const ENHANCE = { reply: { route: "enhance", reason: "Dark" }, costUsd: 0.002 };
const PROMPT = { reply: { prompt: "Brighten evenly" }, costUsd: 0.01 };
const QA_PASS = { reply: { pass: true, scores: { faithfulness: 9, realism: 9, lighting: 9, coherence: 9 }, reason: "Good" }, costUsd: 0.015 };
const QA_FAIL = { reply: { pass: false, scores: { faithfulness: 5, realism: 9, lighting: 9, coherence: 9 }, reason: "Bad" }, costUsd: 0.015 };
const REFINE = { reply: { prompt: "Brighten less" }, costUsd: 0.001 };

describe("listEvalImages", () => {
  it("maps root files to other and room-type subfolders to their room type", async () => {
    await touch(
      "b.JPG",
      "a.webp",
      "notes.txt",
      "kitchen/c.jpeg",
      "kitchen/d.png",
      "kitchen/deeper/e.jpg",
      "garage/f.jpg",
      "living_room/g.jpg",
    );
    await fs.mkdir(path.join(folder, "folder.jpg"));
    expect(await listEvalImages(folder)).toEqual([
      { file: "a.webp", roomType: "other" },
      { file: "b.JPG", roomType: "other" },
      { file: "kitchen/c.jpeg", roomType: "kitchen" },
      { file: "kitchen/d.png", roomType: "kitchen" },
      { file: "living_room/g.jpg", roomType: "living_room" },
    ]);
  });

  it("returns nothing for a folder without images", async () => {
    await touch("readme.md", "attic/a.jpg");
    expect(await listEvalImages(folder)).toEqual([]);
  });
});

describe("runEval and summarizeEval", () => {
  it("reports pass rate, retries and cost per image without writing anything", async () => {
    const vision = new ScriptedVision()
      .on("router", ENHANCE, ENHANCE)
      .on("synthesizer", PROMPT, PROMPT)
      .on("qa", QA_PASS, QA_FAIL, QA_FAIL, QA_PASS)
      .on("refiner", REFINE, REFINE);
    const before = await fs.readdir(folder);

    const rows = await runEval(
      [
        { file: "a.jpg", roomType: "other", image: detailed },
        { file: "kitchen/b.jpg", roomType: "kitchen", image: detailed },
        { file: "kitchen/c.jpg", roomType: "kitchen", image: uniform },
      ],
      { vision, editor: new FakeEditor(0.04) },
    );

    expect(rows.map(({ costUsd, ...rest }) => ({ ...rest, costUsd: Number(costUsd.toFixed(4)) }))).toEqual([
      { file: "a.jpg", roomType: "other", status: "passed", stopReason: "passed", attempts: 1, retries: 0, costUsd: 0.067 },
      { file: "kitchen/b.jpg", roomType: "kitchen", status: "passed", stopReason: "passed", attempts: 3, retries: 2, costUsd: 0.179 },
      { file: "kitchen/c.jpg", roomType: "kitchen", status: "rejected", stopReason: "prefilter", attempts: 0, retries: 0, costUsd: 0 },
    ]);
    expect(await fs.readdir(folder)).toEqual(before);

    const summary = summarizeEval(rows);
    expect(summary).toMatchObject({ images: 3, passed: 2, byStatus: { passed: 2, rejected: 1 } });
    expect(summary.passRate).toBeCloseTo(2 / 3);
    expect(summary.meanRetries).toBeCloseTo(2 / 3);
    expect(summary.totalCostUsd).toBeCloseTo(0.246);
    expect(summary.meanCostPerImageUsd).toBeCloseTo(0.082);
  });

  it("summarizes no rows as zeros", () => {
    expect(summarizeEval([])).toEqual({
      images: 0,
      passed: 0,
      passRate: 0,
      byStatus: {},
      meanRetries: 0,
      totalCostUsd: 0,
      meanCostPerImageUsd: 0,
    });
  });
});

describe("formatEvalReport", () => {
  it("prints provider modes, one line per image and the summary", () => {
    const rows: EvalRow[] = [
      { file: "a.jpg", roomType: "other", status: "passed", stopReason: "passed", attempts: 1, retries: 0, costUsd: 0.05 },
      { file: "kitchen/b.jpg", roomType: "kitchen", status: "needs_review", stopReason: "max_retries", attempts: 3, retries: 2, costUsd: 0.15 },
    ];
    const text = formatEvalReport(rows, summarizeEval(rows), { vision: "mock", editor: "fal" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Providers: vision mock, editor fal");
    expect(lines.filter((line) => line.startsWith("a.jpg"))).toEqual(["a.jpg  other  passed  passed  retries 0  $0.0500"]);
    expect(text).toContain("kitchen/b.jpg  kitchen  needs_review  max_retries  retries 2  $0.1500");
    expect(text).toContain("Pass rate: 50% (1/2)");
    expect(text).toContain("Statuses: passed 1, needs_review 1");
    expect(text).toContain("Mean retries: 1.00");
    expect(text).toContain("Total cost: $0.2000");
    expect(text).toContain("Mean cost per image: $0.1000");
  });
});
