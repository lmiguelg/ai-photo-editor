import { config as defaultConfig, type PipelineConfig } from "./config";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/** USD cost of one Anthropic call from its token usage and the config prices. */
export function costFromUsage(
  model: string,
  usage: TokenUsage,
  cfg: PipelineConfig = defaultConfig,
): number {
  const prices = cfg.anthropicPrices[model];
  if (!prices) throw new Error(`No Anthropic prices configured for model ${model}`);
  return (
    (usage.inputTokens * prices.input +
      usage.outputTokens * prices.output +
      usage.cacheCreationInputTokens * prices.cacheWrite +
      usage.cacheReadInputTokens * prices.cacheRead) /
    1e6
  );
}
