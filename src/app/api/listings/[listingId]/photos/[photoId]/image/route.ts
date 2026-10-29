import fs from "node:fs/promises";
import path from "node:path";
import { ImageQuerySchema, PhotoParamsSchema } from "@/lib/api-schemas";
import { errorResponse, HttpError, parseParams, safeHeaderFileName } from "@/lib/http";
import { getPhoto, getPhotoFilePath } from "@/lib/store";

const CONTENT_TYPES = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

/**
 * Serves a stored image. The file name comes only from the photo record
 * (`originalFile` or an attempt's `editedFile`), never from the request.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ listingId: string; photoId: string }> },
): Promise<Response> {
  try {
    const { listingId, photoId } = await parseParams(PhotoParamsSchema, params);
    const query = new URL(request.url).searchParams;
    const { kind, attempt } = ImageQuerySchema.parse({
      kind: query.get("kind") ?? undefined,
      attempt: query.get("attempt") ?? undefined,
    });

    const photo = await getPhoto(listingId, photoId);
    if (!photo) throw new HttpError(404, "Not found");

    let fileName: string | null;
    if (kind === "original") {
      fileName = photo.originalFile;
    } else {
      const index = attempt ?? photo.bestAttemptIndex;
      fileName = photo.attempts.find((a) => a.index === index)?.editedFile ?? null;
    }
    const contentType = fileName && CONTENT_TYPES.get(path.extname(fileName).slice(1).toLowerCase());
    if (!fileName || !contentType) throw new HttpError(404, "Not found");

    let bytes: Buffer;
    try {
      bytes = await fs.readFile(getPhotoFilePath(listingId, photoId, fileName));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") throw new HttpError(404, "Not found");
      throw err;
    }

    const headers = new Headers({
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    if (kind === "original") {
      headers.set("Content-Disposition", `inline; filename="${safeHeaderFileName(photo.originalName)}"`);
    }
    return new Response(new Uint8Array(bytes), { headers });
  } catch (err) {
    return errorResponse(err);
  }
}
