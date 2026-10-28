import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { config, type PipelineConfig } from "./config";
import { createProviders } from "./providers/index";
import { runPhoto } from "./run-photo";
import { AttemptSchema, PhotoStatusSchema } from "./schemas";
import { detailedImage, FakeEditor, ScriptedVision } from "./test-helpers";

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

let photo: Buffer;

beforeAll(async () => {
  photo = await detailedImage(3000, 2000);
});

function run(vision: ScriptedVision, editor: FakeEditor, cfg?: PipelineConfig) {
  return runPhoto({ image: photo, roomType: "bedroom", providers: { vision, editor }, config: cfg });
}

describe("runPhoto (QA edge cases)", () => {
  it("runs end to end on the mock providers from createProviders({}) at zero cost", async () => {
    const providers = createProviders({});
    const result = await runPhoto({ image: photo, roomType: "kitchen", providers });

    expect(PhotoStatusSchema.options).toContain(result.status);
    expect(result.status).toBe("passed");
    expect(result.bestAttemptIndex).toBe(0);
    expect(result.totalCostUsd).toBe(0);
    expect(result.calls.map((call) => call.agent)).toEqual(["router", "synthesizer", "editor", "qa"]);
    expect(result.calls.find((call) => call.agent === "router")?.model).toBe(config.models.cheap);
    expect(result.calls.find((call) => call.agent === "synthesizer")?.model).toBe(config.models.strong);
    expect(result.calls.find((call) => call.agent === "qa")?.model).toBe(config.models.strong);
    expect(result.calls.find((call) => call.agent === "editor")?.model).toBe(config.fal.model);
    const [{ attempt, editedImage }] = result.attempts;
    expect(AttemptSchema.safeParse(attempt).success).toBe(true);
    expect(Number.isNaN(Date.parse(attempt.createdAt))).toBe(false);
    expect(editedImage!.bytes.length).toBeGreaterThan(0);
    expect((await sharp(editedImage!.bytes).metadata()).format).toBe("jpeg");
  });

  it("stops before attempt 0 when router + synthesizer already hit the cap: failed, no edit", async () => {
    const half = config.limits.maxCostPerPhotoUsd / 2;
    const vision = new ScriptedVision()
      .on("router", { reply: { route: "enhance", reason: "Dark" }, costUsd: half })
      .on("synthesizer", { reply: { prompt: "Brighten" }, costUsd: half });
    const editor = new FakeEditor();
    const result = await run(vision, editor);

    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("budget");
    expect(result.error).toBeTruthy();
    expect(result.attempts).toHaveLength(0);
    expect(result.bestAttemptIndex).toBeNull();
    expect(editor.requests).toHaveLength(0);
    expect(result.totalCostUsd).toBeCloseTo(config.limits.maxCostPerPhotoUsd);
  });

  it("budget stop after attempt 1: two attempts, needs_review picks the higher score", async () => {
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("qa", qaReply(false, 6), qaReply(false, 4, 0.2), qaReply(true, 9))
      .on("refiner", { reply: { prompt: "Refined" }, costUsd: 0.003 }, PROMPT);
    const editor = new FakeEditor(0.04);
    const result = await run(vision, editor);

    expect(result.stopReason).toBe("budget");
    expect(result.status).toBe("needs_review");
    expect(result.attempts).toHaveLength(2);
    expect(editor.requests).toHaveLength(2);
    expect(vision.calls("refiner")).toHaveLength(1);
    expect(result.bestAttemptIndex).toBe(0);
    expect(result.attempts.every(({ editedImage }) => editedImage!.bytes.length > 0)).toBe(true);
  });

  it("honours an injected config: maxRetries 0 gives one attempt and no refiner", async () => {
    const cfg: PipelineConfig = { ...config, limits: { ...config.limits, maxRetries: 0 } };
    const vision = new ScriptedVision().on("router", ENHANCE).on("synthesizer", PROMPT).on("qa", qaReply(false, 5));
    const result = await run(vision, new FakeEditor(), cfg);

    expect(result.status).toBe("needs_review");
    expect(result.stopReason).toBe("max_retries");
    expect(result.attempts).toHaveLength(1);
    expect(vision.calls("refiner")).toHaveLength(0);
  });

  it("honours an injected QA threshold", async () => {
    const cfg: PipelineConfig = { ...config, qa: { ...config.qa, minScore: 10 } };
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("qa", qaReply(true, 9), qaReply(true, 9), qaReply(true, 9))
      .on("refiner", PROMPT, PROMPT);
    const result = await run(vision, new FakeEditor(), cfg);

    expect(result.status).toBe("needs_review");
    expect(result.attempts).toHaveLength(3);
  });

  it("a QA throw on a retry keeps the attempt with qa null and its refine + edit cost", async () => {
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("qa", qaReply(false, 5), { error: new Error("QA timeout") })
      .on("refiner", { reply: { prompt: "Refined" }, costUsd: 0.003 });
    const result = await run(vision, new FakeEditor(0.04));

    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("error");
    expect(result.error).toBe("QA timeout");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].attempt.qa?.pass).toBe(false);
    expect(result.attempts[1].attempt.qa).toBeNull();
    expect(result.attempts[1].attempt.costUsd).toBeCloseTo(0.003 + 0.04);
    expect(result.attempts[1].editedImage!.bytes.length).toBeGreaterThan(0);
    expect(result.totalCostUsd).toBeCloseTo(0.002 + 0.01 + 0.04 + 0.015 + 0.003 + 0.04);
  });

  it("an invalid router route fails without throwing and still logs the router cost", async () => {
    const vision = new ScriptedVision().on("router", { reply: { route: "maybe", reason: "?" }, costUsd: 0.002 });
    const editor = new FakeEditor();
    const result = await run(vision, editor);

    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("error");
    expect(result.error).toMatch(/router returned invalid output/);
    expect(result.route).toBeNull();
    expect(result.calls).toEqual([{ agent: "router", model: "fake-router", costUsd: 0.002 }]);
    expect(result.totalCostUsd).toBeCloseTo(0.002);
    expect(editor.requests).toHaveLength(0);
  });

  it("an empty synthesizer prompt is rejected and no edit is paid for", async () => {
    const vision = new ScriptedVision().on("router", ENHANCE).on("synthesizer", { reply: { prompt: "   " }, costUsd: 0.01 });
    const editor = new FakeEditor();
    const result = await run(vision, editor);

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/synthesizer returned invalid output/);
    expect(editor.requests).toHaveLength(0);
    expect(result.totalCostUsd).toBeCloseTo(0.012);
  });

  it("an invalid refiner reply fails, keeping earlier attempts and the refiner cost", async () => {
    const vision = new ScriptedVision()
      .on("router", ENHANCE)
      .on("synthesizer", PROMPT)
      .on("qa", qaReply(false, 5))
      .on("refiner", { reply: { wrong: true }, costUsd: 0.003 });
    const result = await run(vision, new FakeEditor(0.04));

    expect(result.status).toBe("failed");
    expect(result.attempts).toHaveLength(1);
    expect(result.calls.at(-1)).toMatchObject({ agent: "refiner", costUsd: 0.003 });
    expect(result.totalCostUsd).toBeCloseTo(0.002 + 0.01 + 0.04 + 0.015 + 0.003);
  });

  it("accepts a code fence without a language tag", async () => {
    const vision = new ScriptedVision().on("router", { reply: '```\n{"route": "reject", "reason": "Not a room"}\n```' });
    const result = await run(vision, new FakeEditor());

    expect(result.status).toBe("rejected");
    expect(result.stopReason).toBe("router_reject");
  });

  it("downscales an EXIF-rotated original for vision and keeps its portrait orientation", async () => {
    const rotated = await sharp(photo).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const vision = new ScriptedVision().on("router", { reply: { route: "skip", reason: "Fine" } });
    const result = await runPhoto({
      image: rotated,
      roomType: "bedroom",
      providers: { vision, editor: new FakeEditor() },
    });

    expect(result.metrics).toMatchObject({ width: 2000, height: 3000 });
    const [image] = vision.calls("router")[0].images;
    expect(image.height).toBe(config.vision.maxLongEdgePx);
    expect(image.width).toBeLessThan(image.height);
  });
});
