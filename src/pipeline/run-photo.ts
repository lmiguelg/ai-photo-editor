import { AgentOutputError, type CallRecord } from "./agents/call";
import { runQa } from "./agents/qa";
import { runRefiner } from "./agents/refiner";
import { runRouter } from "./agents/router";
import { runSynthesizer } from "./agents/synthesizer";
import { config as defaultConfig, type PipelineConfig } from "./config";
import { prepareForVision } from "./images";
import { computeLocalMetrics, prefilter, type LocalMetrics } from "./metrics";
import type { Providers } from "./providers/types";
import {
  AttemptSchema,
  type Attempt,
  type PhotoStatus,
  type QaResult,
  type RoomType,
  type RouteDecision,
} from "./schemas";

export type { CallRecord } from "./agents/call";

export type PhotoRunStatus = Extract<
  PhotoStatus,
  "skipped" | "rejected" | "passed" | "needs_review" | "failed"
>;

export type StopReason =
  | "prefilter"
  | "router_skip"
  | "router_reject"
  | "passed"
  | "max_retries"
  | "budget"
  | "error";

export interface AttemptRun {
  /** `editedFile` is null: persistence assigns file names later. */
  attempt: Attempt;
  editedImage: { bytes: Buffer; mimeType: string } | null;
}

export interface PhotoRunResult {
  status: PhotoRunStatus;
  stopReason: StopReason;
  /** Null only when the bytes could not be read as an image. */
  metrics: LocalMetrics | null;
  /** Null when the photo was rejected locally, before the router. */
  route: RouteDecision | null;
  attempts: AttemptRun[];
  bestAttemptIndex: number | null;
  calls: CallRecord[];
  totalCostUsd: number;
  /** Failure message, or the prefilter's reason for a local rejection. */
  error: string | null;
}

export interface RunPhotoInput {
  image: Buffer;
  roomType: RoomType;
  providers: Providers;
  config?: PipelineConfig;
  now?: () => Date;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function rubricSum(qa: QaResult, cfg: PipelineConfig): number {
  return cfg.qa.rubric.reduce((sum, key) => sum + (qa.scores[key] ?? 0), 0);
}

/** Index of the attempt with the highest rubric sum (earliest wins ties), or null if none has QA. */
function pickBestAttempt(attempts: AttemptRun[], cfg: PipelineConfig): number | null {
  let best: { index: number; score: number } | null = null;
  for (const { attempt } of attempts) {
    if (!attempt.qa) continue;
    const score = rubricSum(attempt.qa, cfg);
    if (!best || score > best.score) best = { index: attempt.index, score };
  }
  return best?.index ?? null;
}

/**
 * Runs one photo through prefilter, router, synthesizer and the edit/QA loop.
 * Storage-free: takes the original bytes and returns edited bytes and costs for the
 * caller to persist. Never throws for provider or model failures.
 */
export async function runPhoto({
  image,
  roomType,
  providers,
  config: cfg = defaultConfig,
  now = () => new Date(),
}: RunPhotoInput): Promise<PhotoRunResult> {
  const { vision, editor } = providers;
  const calls: CallRecord[] = [];
  const attempts: AttemptRun[] = [];
  let metrics: LocalMetrics | null = null;
  let route: RouteDecision | null = null;
  let currentAttempt: Attempt | null = null;

  const totalCost = () => calls.reduce((sum, call) => sum + call.costUsd, 0);
  const record = (call: CallRecord) => {
    calls.push(call);
    if (currentAttempt) currentAttempt.costUsd += call.costUsd;
  };
  const finish = (
    fields: Pick<PhotoRunResult, "status" | "stopReason"> & Partial<PhotoRunResult>,
  ): PhotoRunResult => ({
    metrics,
    route,
    attempts: attempts.map((run) => ({ ...run, attempt: AttemptSchema.parse(run.attempt) })),
    bestAttemptIndex: null,
    calls,
    totalCostUsd: totalCost(),
    error: null,
    ...fields,
  });

  try {
    metrics = await computeLocalMetrics(image, cfg);
  } catch (err) {
    return finish({ status: "rejected", stopReason: "prefilter", error: `Unreadable image: ${errorMessage(err)}` });
  }
  const local = prefilter(metrics, cfg);
  if (!local.ok) return finish({ status: "rejected", stopReason: "prefilter", error: local.reason });

  try {
    const original = await prepareForVision(image, cfg.vision.maxLongEdgePx, cfg.vision.jpegQuality);

    const router = await runRouter(vision, { original, roomType, metrics });
    record(router.call);
    route = router.value;
    if (route.route === "skip") return finish({ status: "skipped", stopReason: "router_skip" });
    if (route.route === "reject") return finish({ status: "rejected", stopReason: "router_reject" });

    const synthesizer = await runSynthesizer(vision, { original, roomType, routerReason: route.reason });
    record(synthesizer.call);

    const editorInput = await prepareForVision(image, cfg.fal.maxLongEdgePx, cfg.vision.jpegQuality);
    const editorImage = Buffer.from(editorInput.data, "base64");

    let prompt = synthesizer.value.prompt;
    let lastQa: QaResult | null = null;
    let stopReason: StopReason = "max_retries";

    for (let index = 0; index <= cfg.limits.maxRetries; index++) {
      if (totalCost() >= cfg.limits.maxCostPerPhotoUsd) {
        stopReason = "budget";
        break;
      }
      const createdAt = now().toISOString();
      let attemptCost = 0;

      if (lastQa) {
        const refiner = await runRefiner(vision, { previousPrompt: prompt, qa: lastQa });
        record(refiner.call);
        attemptCost += refiner.call.costUsd;
        prompt = refiner.value.prompt;
      }

      const edit = await editor.edit({ image: editorImage, prompt });
      record({ agent: "editor", model: cfg.fal.model, costUsd: edit.costUsd });
      attemptCost += edit.costUsd;

      currentAttempt = { index, prompt, editedFile: null, qa: null, costUsd: attemptCost, createdAt };
      attempts.push({ attempt: currentAttempt, editedImage: { bytes: edit.image, mimeType: edit.mimeType } });

      const edited = await prepareForVision(edit.image, cfg.vision.maxLongEdgePx, cfg.vision.jpegQuality);
      const qa = await runQa(vision, { original, edited, roomType }, cfg);
      record(qa.call);
      currentAttempt.qa = qa.value;
      currentAttempt = null;
      lastQa = qa.value;

      if (qa.value.pass) return finish({ status: "passed", stopReason: "passed", bestAttemptIndex: index });
    }

    const bestAttemptIndex = pickBestAttempt(attempts, cfg);
    if (bestAttemptIndex === null) {
      return finish({ status: "failed", stopReason, error: "No attempt reached QA before the run stopped" });
    }
    return finish({ status: "needs_review", stopReason, bestAttemptIndex });
  } catch (err) {
    if (err instanceof AgentOutputError) record(err.call);
    return finish({ status: "failed", stopReason: "error", error: errorMessage(err) });
  }
}
