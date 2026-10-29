import { PhotoParamsSchema } from "@/lib/api-schemas";
import { errorResponse, jsonError, parseParams } from "@/lib/http";
import { isPhotoRunning } from "@/lib/process-photo";
import { resetStuckPhoto, StoreError } from "@/lib/store";

/**
 * Recovers a photo left `processing` by a crashed run. 409 while this process is
 * running the photo, and 409 when it is neither processing nor locked.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ listingId: string; photoId: string }> },
): Promise<Response> {
  try {
    const { listingId, photoId } = await parseParams(PhotoParamsSchema, params);
    if (isPhotoRunning(listingId, photoId)) return jsonError(409, "Photo is running");
    return Response.json(await resetStuckPhoto(listingId, photoId));
  } catch (err) {
    if (err instanceof StoreError && err.code === "conflict") {
      return jsonError(409, "Photo is not stuck");
    }
    return errorResponse(err);
  }
}
