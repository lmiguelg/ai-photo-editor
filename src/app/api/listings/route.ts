import { errorResponse, readJsonBody } from "@/lib/http";
import { createListing, listListings } from "@/lib/store";
import { NewListingInputSchema } from "@/pipeline/schemas";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await listListings());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const input = NewListingInputSchema.parse(await readJsonBody(request));
    return Response.json(await createListing(input), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
