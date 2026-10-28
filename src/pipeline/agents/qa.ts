import { config as defaultConfig, type PipelineConfig } from "../config";
import type { PreparedImage } from "../images";
import { QA_SYSTEM, qaUserText } from "../prompts";
import type { VisionProvider } from "../providers/types";
import { QaResultSchema, type QaResult, type RoomType } from "../schemas";
import { callAgent } from "./call";

/**
 * Passes only if the model said pass and every rubric score is at least
 * `cfg.qa.minScore`; a missing score fails.
 */
export function applyQaThreshold(qa: QaResult, cfg: PipelineConfig = defaultConfig): QaResult {
  const allScoresMet = cfg.qa.rubric.every((key) => (qa.scores[key] ?? -Infinity) >= cfg.qa.minScore);
  return { ...qa, pass: qa.pass && allScoresMet };
}

export async function runQa(
  vision: VisionProvider,
  input: { original: PreparedImage; edited: PreparedImage; roomType: RoomType },
  cfg: PipelineConfig = defaultConfig,
) {
  const result = await callAgent(
    vision,
    {
      agent: "qa",
      system: QA_SYSTEM,
      images: [input.original, input.edited],
      text: qaUserText(input.roomType),
    },
    QaResultSchema,
  );
  return { ...result, value: applyQaThreshold(result.value, cfg) };
}
