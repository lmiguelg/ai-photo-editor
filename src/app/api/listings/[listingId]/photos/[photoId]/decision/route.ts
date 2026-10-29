import { DecisionInputSchema, PhotoParamsSchema } from "@/lib/api-schemas";
import { errorResponse, jsonError, parseParams, readJsonBody } from "@/lib/http";
import { StoreError, updatePhoto } from "@/lib/store";

const REVIEWABLE = new Set(["passed", "needs_review"]);

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
    return Response.json(photo);
  } catch (err) {
    if (err instanceof StoreError && err.code === "conflict") {
      return jsonError(409, "Photo has no result to review");
    }
    return errorResponse(err);
  }
}
