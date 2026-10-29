import { ListingParamsSchema } from "@/lib/api-schemas";
import { buildExportZip, listingSlug } from "@/lib/export";
import { errorResponse, HttpError, parseParams, safeHeaderFileName } from "@/lib/http";
import { getListing } from "@/lib/store";

/** The client zip: approved enhanced photos, skipped originals and before/after previews. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<Response> {
  try {
    const { listingId } = await parseParams(ListingParamsSchema, params);
    const listing = await getListing(listingId);
    if (!listing) throw new HttpError(404, "Not found");

    const zip = await buildExportZip(listing);
    const fileName = safeHeaderFileName(`${listingSlug(listing.name)}-photos.zip`);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
