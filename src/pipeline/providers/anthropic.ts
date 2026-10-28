import Anthropic from "@anthropic-ai/sdk";
import { config as defaultConfig, type PipelineConfig } from "../config";
import { costFromUsage, type TokenUsage } from "../cost";
import type { VisionProvider, VisionRequest, VisionResponse } from "./types";

/** The slice of the SDK client this provider uses, so tests can inject a fake. */
export interface MessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export class AnthropicVisionProvider implements VisionProvider {
  private readonly client: MessagesClient;
  private readonly cfg: PipelineConfig;

  constructor(apiKey: string, client?: MessagesClient, cfg: PipelineConfig = defaultConfig) {
    this.client = client ?? new Anthropic({ apiKey });
    this.cfg = cfg;
  }

  async complete(request: VisionRequest): Promise<VisionResponse> {
    const model = this.cfg.models[this.cfg.agentTier[request.agent]];
    const message = await this.client.messages.create({
      model,
      max_tokens: this.cfg.maxTokens[request.agent],
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            ...request.images.map((image) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: image.mediaType, data: image.data },
            })),
            { type: "text" as const, text: request.text },
          ],
        },
      ],
    });
    const usage: TokenUsage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    };
    const text = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    return { text, model, usage, costUsd: costFromUsage(model, usage, this.cfg) };
  }
}
