import { REFINER_SYSTEM, refinerUserText } from "../prompts";
import type { VisionProvider } from "../providers/types";
import { PromptOutputSchema, type QaResult } from "../schemas";
import { callAgent } from "./call";

/** Text-only: rewrites the previous prompt from the QA feedback, no images sent. */
export function runRefiner(vision: VisionProvider, input: { previousPrompt: string; qa: QaResult }) {
  return callAgent(
    vision,
    {
      agent: "refiner",
      system: REFINER_SYSTEM,
      images: [],
      text: refinerUserText(input.previousPrompt, input.qa),
    },
    PromptOutputSchema,
  );
}
