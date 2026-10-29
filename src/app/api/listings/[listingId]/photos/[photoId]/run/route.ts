import { PhotoParamsSchema } from "@/lib/api-schemas";
import { errorResponse, parseParams } from "@/lib/http";
import { processPhoto } from "@/lib/process-photo";
import { createProviders } from "@/pipeline/providers";

/** Runs the pipeline on one photo synchronously; 409 while it is already processing. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ listingId: string; photoId: string }> },
): Promise<Response> {
  try {
    const { listingId, photoId } = await parseParams(PhotoParamsSchema, params);
    return Response.json(await processPhoto(listingId, photoId, createProviders(process.env)));
  } catch (err) {
    return errorResponse(err);
  }
}
