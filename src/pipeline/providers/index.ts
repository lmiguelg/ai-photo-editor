import { AnthropicVisionProvider } from "./anthropic";
import { FalImageEditor } from "./fal";
import { MockImageEditor, MockVisionProvider } from "./mock";
import type { ImageEditor, VisionProvider } from "./types";

export type { ImageEditor, Providers, VisionProvider } from "./types";

export interface ProviderMode {
  vision: "anthropic" | "mock";
  editor: "fal" | "mock";
}

export interface ProviderSet {
  vision: VisionProvider;
  editor: ImageEditor;
  mode: ProviderMode;
}

function hasKey(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Which providers `createProviders` would pick for `env`: labels only, never key values. */
export function providerMode(env: Record<string, string | undefined>): ProviderMode {
  return {
    vision: hasKey(env.ANTHROPIC_API_KEY) ? "anthropic" : "mock",
    editor: hasKey(env.FAL_KEY) ? "fal" : "mock",
  };
}

/**
 * The only place that picks real vs mock providers. Each provider is real only when
 * its key is set in `env`; callers pass `process.env`.
 */
export function createProviders(env: Record<string, string | undefined>): ProviderSet {
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const falKey = env.FAL_KEY;
  const mode = providerMode(env);
  return {
    vision:
      mode.vision === "anthropic" && hasKey(anthropicKey)
        ? new AnthropicVisionProvider(anthropicKey)
        : new MockVisionProvider(),
    editor: mode.editor === "fal" && hasKey(falKey) ? new FalImageEditor(falKey) : new MockImageEditor(),
    mode,
  };
}
