import { ListingParamsSchema } from "@/lib/api-schemas";
import { buildExportSummary } from "@/lib/export-summary";
import { errorResponse, HttpError, parseParams } from "@/lib/http";
import { canExport, exportSelection } from "@/lib/review";
import { getListing } from "@/lib/store";

/** The email-ready summary of the client export, as HTML and plain text. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<Response> {
  try {
    const { listingId } = await parseParams(ListingParamsSchema, params);
    const listing = await getListing(listingId);
    if (!listing) throw new HttpError(404, "Not found");
    if (!canExport(exportSelection(listing.photos))) throw new HttpError(409, "Nothing approved to export");

    return Response.json(buildExportSummary(listing), {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
