import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FeedbackEntrySchema, PhotoSchema } from "@/pipeline/schemas";
import { detailedImage, FakeEditor, ScriptedVision, uniformImage } from "@/pipeline/test-helpers";
import { setupApiTestEnv } from "./api-test-helpers";
import { processPhoto } from "./process-photo";
import { addPhoto, createListing } from "./store";

const getDataDir = setupApiTestEnv("process-photo-feedback");

const ENHANCE = { reply: { route: "enhance", reason: "Dark room" }, costUsd: 0.002 };
const PROMPT = { reply: { prompt: "Brighten evenly" }, costUsd: 0.01 };
const REFINE = { reply: { prompt: "Brighten less" }, costUsd: 0.001 };
const qaFail = (faithfulness: number) => ({
  reply: { pass: false, scores: { faithfulness, realism: 9, lighting: 9, coherence: 9 }, reason: `Faithfulness ${faithfulness}` },
  costUsd: 0.015,
});

let detailed: Buffer;
let uniform: Buffer;

beforeAll(async () => {
  detailed = await detailedImage();
  uniform = await uniformImage();
});

async function uploaded(data: Buffer) {
  const listing = await createListing({ name: "Lake cabin" });
  const photo = await addPhoto(listing.id, { roomType: "kitchen", originalName: "k.jpg", data });
  return { listingId: listing.id, photoId: photo.id };
}

const logPath = () => path.join(getDataDir(), "feedback.jsonl");

async function logLines(): Promise<string[]> {
  return (await fs.readFile(logPath(), "utf8")).split("\n").filter((line) => line !== "");
}

describe("processPhoto qa_fail logging (QA review)", () => {
  it("logs every failed attempt of a needs_review run with photoStatus needs_review, in one append", async () => {
    const { listingId, photoId } = await uploaded(detailed);
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("refiner", REFINE, REFINE)
      .on("qa", qaFail(5), qaFail(6), qaFail(4));
    const append = vi.spyOn(fs, "appendFile");

    const photo = await processPhoto(listingId, photoId, { vision, editor: new FakeEditor(0.04) });
    expect(photo.status).toBe("needs_review");
    expect(append).toHaveBeenCalledTimes(1);
    append.mockRestore();

    const entries = (await logLines()).map((line) => FeedbackEntrySchema.parse(JSON.parse(line)));
    expect(entries.map((e) => [e.kind, e.attemptIndex, e.photoStatus, e.roomType, e.note])).toEqual([
      ["qa_fail", 0, "needs_review", "kitchen", ""],
      ["qa_fail", 1, "needs_review", "kitchen", ""],
      ["qa_fail", 2, "needs_review", "kitchen", ""],
    ]);
    expect(entries.map((e) => e.prompt)).toEqual(["Brighten evenly", "Brighten less", "Brighten less"]);
    expect(entries.map((e) => e.qa?.scores.faithfulness)).toEqual([5, 6, 4]);
  });

  it("appends only after the photo record has been written", async () => {
    const { listingId, photoId } = await uploaded(detailed);
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("refiner", REFINE)
      .on("qa", qaFail(5), {
        reply: { pass: true, scores: { faithfulness: 9, realism: 9, lighting: 9, coherence: 9 }, reason: "Good" },
        costUsd: 0.015,
      });
    const recordFile = path.join(getDataDir(), "listings", listingId, "photos", photoId, "photo.json");
    let statusAtAppend: string | null = null;
    const original = fs.appendFile;
    const append = vi.spyOn(fs, "appendFile").mockImplementation(async (...args: Parameters<typeof fs.appendFile>) => {
      statusAtAppend = PhotoSchema.parse(JSON.parse(await fs.readFile(recordFile, "utf8"))).status;
      return original(...args);
    });

    await processPhoto(listingId, photoId, { vision, editor: new FakeEditor(0.04) });
    append.mockRestore();
    expect(statusAtAppend).toBe("passed");
    expect(await logLines()).toHaveLength(1);
  });

  it("logs nothing for a prefilter-rejected run or a run whose editor fails", async () => {
    const rejected = await uploaded(uniform);
    const r = await processPhoto(rejected.listingId, rejected.photoId, {
      vision: new ScriptedVision(),
      editor: new FakeEditor(),
    });
    expect(r.status).toBe("rejected");

    const failing = await uploaded(detailed);
    const f = await processPhoto(failing.listingId, failing.photoId, {
      vision: new ScriptedVision().on("router", ENHANCE).on("synthesizer", PROMPT),
      editor: new FakeEditor(0.04, new Error("editor down")),
    });
    expect(f.status).toBe("failed");

    await expect(fs.stat(logPath())).rejects.toThrow();
  });
});
