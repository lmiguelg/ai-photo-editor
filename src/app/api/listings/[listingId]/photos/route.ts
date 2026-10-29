import path from "node:path";
import { ListingParamsSchema, OriginalNameSchema, UploadFieldsSchema } from "@/lib/api-schemas";
import { checkUploadLength, errorResponse, HttpError, MAX_UPLOAD_BYTES, parseParams } from "@/lib/http";
import { detectImageFormat, EXTENSION_FORMATS } from "@/lib/image-check";
import { addPhoto } from "@/lib/store";

const UNSUPPORTED = "Unsupported image type";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<Response> {
  try {
    const { listingId } = await parseParams(ListingParamsSchema, params);
    checkUploadLength(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "Invalid request");
    }
    const { roomType, file } = UploadFieldsSchema.parse({
      roomType: form.get("roomType"),
      file: form.getAll("file"),
    });
    const originalName = OriginalNameSchema.parse(file.name);
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "File too large");

    const expected = EXTENSION_FORMATS.get(path.extname(originalName).slice(1).toLowerCase());
    if (!expected) throw new HttpError(400, UNSUPPORTED);
    const data = Buffer.from(await file.arrayBuffer());
    if ((await detectImageFormat(data)) !== expected) throw new HttpError(400, UNSUPPORTED);

    return Response.json(await addPhoto(listingId, { roomType, originalName, data }), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
