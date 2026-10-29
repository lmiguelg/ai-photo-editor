import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FeedbackEntry } from "@/pipeline/schemas";
import { setupApiTestEnv } from "./api-test-helpers";
import { appendFeedback, readFeedback } from "./feedback";
import { feedbackLogPath } from "./paths";

const getDataDir = setupApiTestEnv("feedback");

function entry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    kind: "qa_fail",
    at: "2026-10-01T10:00:00.000Z",
    listingId: "listing-1",
    photoId: "photo-1",
    roomType: "kitchen",
    photoStatus: "needs_review",
    attemptIndex: 0,
    prompt: "Brighten evenly",
    qa: { pass: false, scores: { faithfulness: 5, realism: 9, lighting: 9, coherence: 9 }, reason: "Fridge removed" },
    note: "",
    ...overrides,
  };
}

describe("feedback log", () => {
  it("lives at <DATA_DIR>/feedback.jsonl", () => {
    expect(feedbackLogPath()).toBe(path.join(getDataDir(), "feedback.jsonl"));
  });

  it("round-trips appended entries, one JSON line each", async () => {
    const first = entry();
    const second = entry({ kind: "human_reject", attemptIndex: null, prompt: null, qa: null, note: "sofa removed" });
    await appendFeedback([first]);
    await appendFeedback([second]);

    const text = await fs.readFile(feedbackLogPath(), "utf8");
    expect(text.split("\n")).toEqual([JSON.stringify(first), JSON.stringify(second), ""]);
    expect(await readFeedback()).toEqual({ entries: [first, second], invalidLines: 0 });
  });

  it("creates a missing data dir and writes nothing for an empty array", async () => {
    const nested = path.join(getDataDir(), "nested", "data");
    process.env.DATA_DIR = nested;
    await appendFeedback([]);
    await expect(fs.stat(nested)).rejects.toThrow();
    await appendFeedback([entry()]);
    expect((await readFeedback()).entries).toHaveLength(1);
  });

  it("rejects invalid entries without writing anything", async () => {
    await expect(appendFeedback([entry(), entry({ photoId: "../x" })])).rejects.toThrow();
    await expect(fs.stat(feedbackLogPath())).rejects.toThrow();
  });

  it("reads a missing file as empty", async () => {
    expect(await readFeedback()).toEqual({ entries: [], invalidLines: 0 });
  });

  it("skips blank lines and counts invalid JSON or schema failures", async () => {
    const good = entry();
    const lines = [JSON.stringify(good), "", "not json", "   ", JSON.stringify({ ...good, kind: "approve" }), "{"];
    await fs.writeFile(feedbackLogPath(), `${lines.join("\r\n")}\n`, "utf8");
    expect(await readFeedback()).toEqual({ entries: [good], invalidLines: 3 });
  });
});
