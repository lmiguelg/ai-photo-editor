import sharp from "sharp";
import { config as defaultConfig, type PipelineConfig, type VisionAgent } from "../config";
import type {
  EditRequest,
  EditResponse,
  ImageEditor,
  VisionProvider,
  VisionRequest,
  VisionResponse,
} from "./types";

const MOCK_PROMPT =
  "Brighten the room evenly and neutralise the white balance. Keep every object, wall, window and view exactly as it is.";

const MOCK_REPLIES: Record<VisionAgent, unknown> = {
  router: { route: "enhance", reason: "Mock: photo is a little dark." },
  synthesizer: { prompt: MOCK_PROMPT },
  refiner: { prompt: MOCK_PROMPT },
  qa: {
    pass: true,
    scores: { faithfulness: 9, realism: 8, lighting: 8, coherence: 9 },
    reason: "Mock: edit looks natural and faithful.",
  },
};

/** Free stand-in for the Anthropic provider: canned valid JSON per agent, zero cost. */
export class MockVisionProvider implements VisionProvider {
  constructor(private readonly cfg: PipelineConfig = defaultConfig) {}

  async complete(request: VisionRequest): Promise<VisionResponse> {
    return {
      text: JSON.stringify(MOCK_REPLIES[request.agent]),
      model: this.cfg.models[this.cfg.agentTier[request.agent]],
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      costUsd: 0,
    };
  }
}

/** Free stand-in for fal.ai: a slightly brightened JPEG copy of the input. */
export class MockImageEditor implements ImageEditor {
  async edit({ image }: EditRequest): Promise<EditResponse> {
    const edited = await sharp(image).rotate().modulate({ brightness: 1.15 }).jpeg().toBuffer();
    return { image: edited, mimeType: "image/jpeg", costUsd: 0 };
  }
}
