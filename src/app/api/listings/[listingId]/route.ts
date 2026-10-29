import { ListingParamsSchema } from "@/lib/api-schemas";
import { errorResponse, HttpError, parseParams } from "@/lib/http";
import { getListing } from "@/lib/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<Response> {
  try {
    const { listingId } = await parseParams(ListingParamsSchema, params);
    const listing = await getListing(listingId);
    if (!listing) throw new HttpError(404, "Not found");
    return Response.json(listing);
  } catch (err) {
    return errorResponse(err);
  }
}
