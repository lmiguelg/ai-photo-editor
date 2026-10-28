import { AnthropicVisionProvider } from "./anthropic";
import { FalImageEditor } from "./fal";
import { MockImageEditor, MockVisionProvider } from "./mock";
import type { ImageEditor, VisionProvider } from "./types";

export type { ImageEditor, Providers, VisionProvider } from "./types";

export interface ProviderSet {
  vision: VisionProvider;
  editor: ImageEditor;
  mode: { vision: "anthropic" | "mock"; editor: "fal" | "mock" };
}

function hasKey(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * The only place that picks real vs mock providers. Each provider is real only when
 * its key is set in `env`; callers pass `process.env`.
 */
export function createProviders(env: Record<string, string | undefined>): ProviderSet {
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const falKey = env.FAL_KEY;
  return {
    vision: hasKey(anthropicKey) ? new AnthropicVisionProvider(anthropicKey) : new MockVisionProvider(),
    editor: hasKey(falKey) ? new FalImageEditor(falKey) : new MockImageEditor(),
    mode: {
      vision: hasKey(anthropicKey) ? "anthropic" : "mock",
      editor: hasKey(falKey) ? "fal" : "mock",
    },
  };
}
