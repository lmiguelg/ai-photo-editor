import type { PreparedImage } from "../images";
import { SYNTHESIZER_SYSTEM, synthesizerUserText } from "../prompts";
import type { VisionProvider } from "../providers/types";
import { PromptOutputSchema, type RoomType } from "../schemas";
import { callAgent } from "./call";

export function runSynthesizer(
  vision: VisionProvider,
  input: { original: PreparedImage; roomType: RoomType; routerReason: string },
) {
  return callAgent(
    vision,
    {
      agent: "synthesizer",
      system: SYNTHESIZER_SYSTEM,
      images: [input.original],
      text: synthesizerUserText(input.roomType, input.routerReason),
    },
    PromptOutputSchema,
  );
}
