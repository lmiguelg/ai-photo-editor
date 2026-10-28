import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { config } from "./config";
import { runPhoto, type PhotoRunResult } from "./run-photo";
import { AttemptSchema } from "./schemas";
import { detailedImage, FakeEditor, ScriptedVision, uniformImage } from "./test-helpers";

const ENHANCE = { reply: { route: "enhance", reason: "Dark room" }, costUsd: 0.002 };
const PROMPT = { reply: { prompt: "Brighten evenly, keep everything" }, costUsd: 0.01 };
const qaReply = (pass: boolean, score: number, costUsd = 0.015) => ({
  reply: {
    pass,
    scores: { faithfulness: score, realism: score, lighting: score, coherence: score },
    reason: pass ? "Looks good" : "Too dark still",
  },
  costUsd,
});
const FIXED_NOW = new Date("2026-10-28T12:00:00.000Z");

let photo: Buffer;

beforeAll(async () => {
  photo = await detailedImage(3000, 2000);
});

function run(vision: ScriptedVision, editor: FakeEditor, image = photo) {
  return runPhoto({ image, roomType: "living_room", providers: { vision, editor }, now: () => FIXED_NOW });
}

function sumCalls(result: PhotoRunResult) {
  return result.calls.reduce((sum, call) => sum + call.costUsd, 0);
}

function expectValidAttempts(result: PhotoRunResult) {
  for (const { attempt, editedImage } of result.attempts) {
    expect(AttemptSchema.safeParse(attempt).success).toBe(true);
    expect(attempt.editedFile).toBeNull();
    expect(Buffer.isBuffer(editedImage?.bytes)).toBe(true);
    expect(editedImage!.bytes.length).toBeGreaterThan(0);
  }
}

function expectDownscaledImages(vision: ScriptedVision) {
  for (const request of vision.requests) {
    for (const image of request.images) {
      expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(config.vision.maxLongEdgePx);
    }
  }
}

describe("runPhoto", () => {
  it("(a) skip: router says skip, editor never called", async () => {
    const vision = new ScriptedVision().on("router", { reply: { route: "skip", reason: "Already great" }, costUsd: 0.002 });
    const editor = new FakeEditor();
    const result = await run(vision, editor);

    expect(result.status).toBe("skipped");
    expect(result.stopReason).toBe("router_skip");
    expect(result.route).toEqual({ route: "skip", reason: "Already great" });
    expect(editor.requests).toHaveLength(0);
    expect(result.attempts).toHaveLength(0);
    expect(result.totalCostUsd).toBeCloseTo(0.002);
  });

  it("(b1) prefilter reject: tiny or uniform image makes zero provider calls and costs 0", async () => {
    for (const image of [await detailedImage(400, 300), await uniformImage()]) {
      const vision = new ScriptedVision();
      const editor = new FakeEditor();
      const result = await run(vision, editor, image);

      expect(result.status).toBe("rejected");
      expect(result.stopReason).toBe("prefilter");
      expect(result.route).toBeNull();
      expect(result.error).toBeTruthy();
      expect(vision.requests).toHaveLength(0);
      expect(editor.requests).toHaveLength(0);
      expect(result.calls).toHaveLength(0);
      expect(result.totalCostUsd).toBe(0);
    }
  });

  it("(b1) prefilter reject: non-image bytes are rejected without throwing", async () => {
    const vision = new ScriptedVision();
    const editor = new FakeEditor();
    const result = await run(vision, editor, Buffer.from("not an image"));

    expect(result.status).toBe("rejected");
    expect(result.stopReason).toBe("prefilter");
    expect(result.metrics).toBeNull();
    expect(vision.requests).toHaveLength(0);
    expect(result.totalCostUsd).toBe(0);
  });

  it("(b2) router reject: router says reject", async () => {
    const vision = new ScriptedVision().on("router", { reply: { route: "reject", reason: "Not a room" } });
    const editor = new FakeEditor();
    const result = await run(vision, editor);

    expect(result.status).toBe("rejected");
    expect(result.stopReason).toBe("router_reject");
    expect(result.route?.route).toBe("reject");
    expect(editor.requests).toHaveLength(0);
  });

  it("(c) pass first try: one attempt, no refiner, total equals the fake costs", async () => {
    const vision = new ScriptedVision().on("router", ENHANCE).on("synthesizer", PROMPT).on("qa", qaReply(true, 9));
    const editor = new FakeEditor(0.04);
    const result = await run(vision, editor);

    expect(result.status).toBe("passed");
    expect(result.stopReason).toBe("passed");
    expect(result.attempts).toHaveLength(1);
    expect(result.bestAttemptIndex).toBe(0);
    expect(vision.calls("refiner")).toHaveLength(0);
    expect(result.totalCostUsd).toBeCloseTo(0.002 + 0.01 + 0.04 + 0.015);
    expect(result.totalCostUsd).toBeCloseTo(sumCalls(result));
    // Router and synthesizer costs are not part of the attempt's cost.
    expect(result.attempts[0].attempt.costUsd).toBeCloseTo(0.04 + 0.015);
    expect(result.attempts[0].attempt.prompt).toBe("Brighten evenly, keep everything");
    expect(result.attempts[0].attempt.createdAt).toBe(FIXED_NOW.toISOString());
    expect(result.calls.map((call) => call.agent)).toEqual(["router", "synthesizer", "editor", "qa"]);
    expect(result.error).toBeNull();
    expectValidAttempts(result);
  });

  it("sends downscaled images to router, synthesizer and QA, and a sized image to the editor", async () => {
    const vision = new ScriptedVision().on("router", ENHANCE).on("synthesizer", PROMPT).on("qa", qaReply(true, 9));
    const editor = new FakeEditor();
    await run(vision, editor);

    expect(vision.calls("router")[0].images).toHaveLength(1);
    expect(vision.calls("synthesizer")[0].images).toHaveLength(1);
    expect(vision.calls("qa")[0].images).toHaveLength(2);
    expectDownscaledImages(vision);
    const meta = await sharp(editor.requests[0].image).metadata();
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(config.fal.maxLongEdgePx);
  });

  it("(d) retry then pass: QA fails then passes, refiner is text-only and its prompt is used", async () => {
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("qa", qaReply(false, 5), qaReply(true, 9))
      .on("refiner", { reply: { prompt: "Refined: brighten more gently" }, costUsd: 0.003 });
    const editor = new FakeEditor(0.04);
    const result = await run(vision, editor);

    expect(result.status).toBe("passed");
    expect(result.attempts).toHaveLength(2);
    expect(result.bestAttemptIndex).toBe(1);
    expect(vision.calls("refiner")).toHaveLength(1);
    expect(vision.calls("refiner")[0].images.length).toBe(0);
    expect(vision.calls("refiner")[0].text).toContain("Brighten evenly, keep everything");
    expect(result.attempts[1].attempt.prompt).toBe("Refined: brighten more gently");
    expect(result.attempts[1].attempt.costUsd).toBeCloseTo(0.003 + 0.04 + 0.015);
    expect(editor.requests[1].prompt).toBe("Refined: brighten more gently");
    expect(result.totalCostUsd).toBeCloseTo(sumCalls(result));
    expectValidAttempts(result);
    expectDownscaledImages(vision);
  });

  it("QA fails when the model says pass but a rubric score is below the threshold or missing", async () => {
    const lowScore = {
      reply: { pass: true, scores: { faithfulness: 9, realism: 9, lighting: 6, coherence: 9 }, reason: "ok" },
    };
    const missing = { reply: { pass: true, scores: { faithfulness: 9, realism: 9, lighting: 9 }, reason: "ok" } };
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("qa", lowScore, missing, qaReply(true, 8))
      .on("refiner", PROMPT, PROMPT);
    const result = await run(vision, new FakeEditor());

    expect(result.status).toBe("passed");
    expect(result.attempts.map(({ attempt }) => attempt.qa?.pass)).toEqual([false, false, true]);
  });

  it("(e) budget stop: costs exceed the cap after attempt 0, ends needs_review", async () => {
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("qa", qaReply(false, 5, config.limits.maxCostPerPhotoUsd), qaReply(false, 5))
      .on("refiner", PROMPT, PROMPT);
    const editor = new FakeEditor(0.04);
    const result = await run(vision, editor);

    expect(result.stopReason).toBe("budget");
    expect(result.attempts.length).toBeLessThan(3);
    expect(result.attempts).toHaveLength(1);
    expect(result.status).toBe("needs_review");
    expect(result.bestAttemptIndex).toBe(0);
    expect(vision.calls("refiner")).toHaveLength(0);
    expect(result.totalCostUsd).toBeGreaterThanOrEqual(config.limits.maxCostPerPhotoUsd);
  });

  it("(f) needs review: QA fails 3 times, best attempt is the highest-scoring one", async () => {
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("qa", qaReply(false, 4), qaReply(false, 6), qaReply(false, 6))
      .on("refiner", { reply: { prompt: "Second try" } }, { reply: { prompt: "Third try" } });
    const editor = new FakeEditor(0.04);
    const result = await run(vision, editor);

    expect(result.status).toBe("needs_review");
    expect(result.stopReason).toBe("max_retries");
    expect(result.attempts).toHaveLength(3);
    expect(editor.requests).toHaveLength(1 + config.limits.maxRetries);
    expect(vision.calls("refiner")).toHaveLength(2);
    expect(vision.calls("refiner").every((request) => request.images.length === 0)).toBe(true);
    // Attempts 1 and 2 tie on score; the earlier one wins.
    expect(result.bestAttemptIndex).toBe(1);
    expect(result.attempts.map(({ attempt }) => attempt.prompt)).toEqual([
      "Brighten evenly, keep everything",
      "Second try",
      "Third try",
    ]);
    expectValidAttempts(result);
    expect(result.attempts.every(({ editedImage }) => editedImage && editedImage.bytes.length > 0)).toBe(true);
  });

  it("(g) error: a thrown editor error gives failed with the message, without throwing", async () => {
    const vision = new ScriptedVision().on("router", ENHANCE).on("synthesizer", PROMPT);
    const editor = new FakeEditor(0.04, new Error("fal.ai edit failed: HTTP 500"));
    const result = await run(vision, editor);

    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("error");
    expect(result.error).toBe("fal.ai edit failed: HTTP 500");
    expect(result.attempts).toHaveLength(0);
    expect(result.calls.map((call) => call.agent)).toEqual(["router", "synthesizer"]);
    expect(result.totalCostUsd).toBeCloseTo(0.012);
  });

  it("(g) error: a thrown vision error keeps earlier attempts and costs", async () => {
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("qa", qaReply(false, 5))
      .on("refiner", { error: new Error("Anthropic API overloaded") });
    const result = await run(vision, new FakeEditor(0.04));

    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("error");
    expect(result.error).toBe("Anthropic API overloaded");
    expect(result.attempts).toHaveLength(1);
    expect(result.totalCostUsd).toBeCloseTo(0.002 + 0.01 + 0.04 + 0.015);
    expectValidAttempts(result);
  });

  it("(g) error: unparseable model output fails but its call cost is still recorded", async () => {
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("qa", { reply: "not json at all", costUsd: 0.02 });
    const result = await run(vision, new FakeEditor(0.04));

    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("error");
    expect(result.error).toMatch(/qa returned invalid JSON/);
    expect(result.calls.map((call) => call.agent)).toEqual(["router", "synthesizer", "editor", "qa"]);
    expect(result.totalCostUsd).toBeCloseTo(0.002 + 0.01 + 0.04 + 0.02);
    expect(result.attempts[0].attempt.costUsd).toBeCloseTo(0.04 + 0.02);
  });

  it("accepts model JSON wrapped in a code fence", async () => {
    const vision = new ScriptedVision()
      .on("router", { reply: '```json\n{"route": "skip", "reason": "Fine"}\n```' });
    const result = await run(vision, new FakeEditor());

    expect(result.status).toBe("skipped");
  });
});
