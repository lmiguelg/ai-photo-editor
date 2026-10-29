/**
 * Every pipeline tunable: models, prices, image sizes, limits and thresholds.
 * Model ids live here and nowhere else.
 */

export type Tier = "cheap" | "strong";
export type VisionAgent = "router" | "synthesizer" | "refiner" | "qa";

export interface TokenPrices {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface PipelineConfig {
  models: Record<Tier, string>;
  agentTier: Record<VisionAgent, Tier>;
  /** Keyed by model id. */
  anthropicPrices: Record<string, TokenPrices>;
  fal: {
    model: string;
    endpoint: string;
    costPerImageUsd: number;
    maxLongEdgePx: number;
  };
  vision: { maxLongEdgePx: number; jpegQuality: number };
  maxTokens: Record<VisionAgent, number>;
  limits: { maxRetries: number; maxCostPerPhotoUsd: number };
  prefilter: {
    minLongEdgePx: number;
    minShortEdgePx: number;
    /** Width of the greyscale copy sharpness is measured on. */
    sharpnessWidthPx: number;
    minSharpness: number;
    minBrightness: number;
    maxBrightness: number;
  };
  qa: { minScore: number; rubric: readonly ["faithfulness", "realism", "lighting", "coherence"] };
  /** Meta-diagnoser: clusters smaller than `minClusterSize` get no proposal. */
  feedback: { minClusterSize: number; maxExamplesPerCluster: number };
  /** What the client pays; the UI shows AI cost and margin against it. */
  pricing: { listingPriceUsd: number };
}

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const FAL_MODEL = "fal-ai/flux-pro/kontext";

export const config: PipelineConfig = {
  models: { cheap: HAIKU, strong: SONNET },
  agentTier: { router: "cheap", refiner: "cheap", synthesizer: "strong", qa: "strong" },
  anthropicPrices: {
    // ASSUMPTION: verify against current Anthropic pricing
    [HAIKU]: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
    // ASSUMPTION: verify against current Anthropic pricing
    [SONNET]: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  },
  fal: {
    model: FAL_MODEL,
    endpoint: `https://fal.run/${FAL_MODEL}`,
    // ASSUMPTION: verify against current fal.ai pricing
    costPerImageUsd: 0.04,
    maxLongEdgePx: 2048,
  },
  vision: { maxLongEdgePx: 1024, jpegQuality: 80 },
  maxTokens: { router: 300, synthesizer: 600, refiner: 600, qa: 500 },
  limits: { maxRetries: 2, maxCostPerPhotoUsd: 0.2 },
  prefilter: {
    minLongEdgePx: 1024,
    minShortEdgePx: 500,
    sharpnessWidthPx: 512,
    // Calibrated on synthetic images: sharp patterns score 5-18, blurred and flat
    // images stay under 0.9. ASSUMPTION: verify on real listing photos.
    minSharpness: 1.5,
    minBrightness: 15,
    maxBrightness: 245,
  },
  qa: { minScore: 7, rubric: ["faithfulness", "realism", "lighting", "coherence"] },
  feedback: { minClusterSize: 3, maxExamplesPerCluster: 3 },
  pricing: { listingPriceUsd: 45 },
};
