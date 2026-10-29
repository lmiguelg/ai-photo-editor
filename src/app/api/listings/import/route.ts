import { ListingImportInputSchema, UNSUPPORTED_LINK } from "@/lib/api-schemas";
import { errorResponse, HttpError, readJsonBody } from "@/lib/http";
import { importListing, importTransport } from "@/lib/listing-import";

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = ListingImportInputSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      const offList = parsed.error.issues.some((issue) => issue.path[0] === "url" && issue.message === UNSUPPORTED_LINK);
      if (offList) throw new HttpError(400, UNSUPPORTED_LINK);
      throw parsed.error;
    }
    return Response.json(await importListing(parsed.data, importTransport(process.env)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
