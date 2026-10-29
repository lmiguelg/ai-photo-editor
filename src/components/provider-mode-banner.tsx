import { providerMode } from "@/pipeline/providers";

/**
 * Server-rendered notice of which AI providers are mocked. Reads only the mode labels
 * from the env, never key values; renders nothing when both providers are real.
 */
export function ProviderModeBanner() {
  const mode = providerMode(process.env);
  const visionMock = mode.vision === "mock";
  const editorMock = mode.editor === "mock";
  if (!visionMock && !editorMock) return null;

  let text: string;
  if (visionMock && editorMock) {
    text =
      "Mock mode: no API calls are made, results are fake and cost $0. ANTHROPIC_API_KEY and FAL_KEY are not set.";
  } else if (editorMock) {
    text =
      "Partial mock mode: vision uses Anthropic (real, costs money); image editing is mocked (FAL_KEY not set).";
  } else {
    text =
      "Partial mock mode: image editing uses fal.ai (real, costs money); vision is mocked (ANTHROPIC_API_KEY not set).";
  }

  return (
    <div role="status" className="border-b border-amber-300 bg-amber-100 text-amber-950">
      <p className="mx-auto max-w-5xl px-4 py-2 text-sm font-medium">{text}</p>
    </div>
  );
}
