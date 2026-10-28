import type { LocalMetrics } from "./metrics";
import type { QaResult, RoomType } from "./schemas";

const FAITHFULNESS_RULE = `Faithfulness rule (non-negotiable): never add, remove, move or reshape furniture, fixtures, walls, windows or views. The room must stay a truthful picture of the property. Allowed changes are limited to lighting, exposure, white balance, straightening of verticals/horizon, and a mild declutter of loose small items only if the room stays truthful.`;

const JSON_ONLY = "Reply with JSON only: no prose, no markdown.";

export const ROUTER_SYSTEM = `You triage short-term rental listing photos before an AI enhancement step.
Decide one route:
- "skip": the photo is already well lit, level and listing-ready; enhancement would not help.
- "enhance": the photo is usable but would benefit from lighting, exposure, white balance or straightening fixes.
- "reject": the photo is unusable for a listing (not a property photo, badly blurred, mostly obstructed, or too dark/blown out to recover).
${JSON_ONLY}
Output shape: {"route": "skip" | "enhance" | "reject", "reason": string}`;

export const SYNTHESIZER_SYSTEM = `You write one instruction for an instruction-based image editor that improves a short-term rental listing photo.
${FAITHFULNESS_RULE}
Write a concise, concrete edit instruction (1-3 sentences) naming the specific lighting, exposure, white balance or straightening fixes this photo needs, and explicitly tell the editor to keep every object, wall, window and view exactly as they are.
${JSON_ONLY}
Output shape: {"prompt": string}`;

export const REFINER_SYSTEM = `You fix an image-editor instruction that produced an edit which failed quality review for a short-term rental listing photo.
${FAITHFULNESS_RULE}
Given the previous instruction and the reviewer's scores and reason, rewrite the instruction so the next edit addresses the failure while keeping every object, wall, window and view exactly as they are. If the edit misrepresented the property, make the instruction more conservative.
${JSON_ONLY}
Output shape: {"prompt": string}`;

export const QA_SYSTEM = `You are the quality gate for AI-enhanced short-term rental listing photos. The first image is the original, the second is the edit.
${FAITHFULNESS_RULE}
Score the edit on exactly these four criteria, each an integer from 0 to 10:
- faithfulness: the edit shows the same property: nothing added, removed, moved or reshaped.
- realism: the edit looks like a real photograph, with no AI artifacts, warped lines or smeared textures.
- lighting: exposure, white balance and brightness are natural and improved over the original.
- coherence: shadows, reflections, perspective and colours are consistent across the image.
Set "pass" to false for any edit that misrepresents the property, whatever its other scores.
${JSON_ONLY}
Output shape: {"pass": boolean, "scores": {"faithfulness": number, "realism": number, "lighting": number, "coherence": number}, "reason": string}`;

export function routerUserText(roomType: RoomType, metrics: LocalMetrics): string {
  return [
    `Room type: ${roomType}.`,
    `Local metrics: ${metrics.width}x${metrics.height}px, sharpness ${metrics.sharpness.toFixed(2)}, mean brightness ${metrics.brightness.toFixed(0)}/255.`,
    "Choose the route for this photo.",
  ].join("\n");
}

export function synthesizerUserText(roomType: RoomType, routerReason: string): string {
  return [
    `Room type: ${roomType}.`,
    `Why it needs enhancement: ${routerReason}`,
    "Write the edit instruction for this photo.",
  ].join("\n");
}

export function refinerUserText(previousPrompt: string, qa: QaResult): string {
  return [
    `Previous instruction: ${previousPrompt}`,
    `Reviewer scores: ${JSON.stringify(qa.scores)}`,
    `Reviewer reason: ${qa.reason}`,
    "Write the improved instruction.",
  ].join("\n");
}

export function qaUserText(roomType: RoomType): string {
  return `Room type: ${roomType}.\nImage 1 is the original, image 2 is the edit. Score the edit.`;
}
