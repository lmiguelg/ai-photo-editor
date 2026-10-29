import { DecisionInputSchema, PhotoParamsSchema } from "@/lib/api-schemas";
import { appendFeedback } from "@/lib/feedback";
import { errorResponse, jsonError, parseParams, readJsonBody } from "@/lib/http";
import { StoreError, updatePhoto } from "@/lib/store";
import type { Photo } from "@/pipeline/schemas";

const REVIEWABLE = new Set(["passed", "needs_review"]);

/** Appends a `human_reject` feedback entry for the photo's best attempt. Best-effort: never throws. */
async function logRejection(photo: Photo, note: string): Promise<void> {
  const best = photo.attempts.find((attempt) => attempt.index === photo.bestAttemptIndex) ?? null;
  try {
    await appendFeedback([
      {
        kind: "human_reject",
        at: new Date().toISOString(),
        listingId: photo.listingId,
        photoId: photo.id,
        roomType: photo.roomType,
        photoStatus: photo.status,
        attemptIndex: best?.index ?? null,
        prompt: best?.prompt ?? null,
        qa: best?.qa ?? null,
        note,
      },
    ]);
  } catch (err) {
    console.error("Failed to append a rejection to the feedback log", err);
  }
}

/** Records an approve/reject decision on a photo with a result; replaces any earlier one. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ listingId: string; photoId: string }> },
): Promise<Response> {
  try {
    const { listingId, photoId } = await parseParams(PhotoParamsSchema, params);
    const { verdict, note } = DecisionInputSchema.parse(await readJsonBody(request));
    const photo = await updatePhoto(listingId, photoId, (current) => {
      if (!REVIEWABLE.has(current.status)) {
        throw new StoreError("conflict", `Photo ${photoId} has status ${current.status}`);
      }
      return { ...current, decision: { verdict, note, decidedAt: new Date().toISOString() } };
    });
    if (verdict === "rejected") await logRejection(photo, note);
    return Response.json(photo);
  } catch (err) {
    if (err instanceof StoreError && err.code === "conflict") {
      return jsonError(409, "Photo has no result to review");
    }
    return errorResponse(err);
  }
}
