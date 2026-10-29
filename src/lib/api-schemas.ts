import { z } from "zod";
import { DecisionSchema, IdSchema, NewListingInputSchema, RoomTypeSchema } from "@/pipeline/schemas";
import { isAllowedUrl, isPageHost, pageSite, type ImportSite } from "./listing-import/sites";

// Request-only schemas for the API routes. Stored records use `@/pipeline/schemas`.

export const ListingParamsSchema = z.object({ listingId: IdSchema });

export const PhotoParamsSchema = z.object({ listingId: IdSchema, photoId: IdSchema });

/** Multipart upload fields: `file` holds every `file` entry, and there must be exactly one. */
export const UploadFieldsSchema = z.object({
  roomType: RoomTypeSchema,
  file: z
    .array(z.instanceof(File))
    .length(1)
    .transform(([file]) => file),
});

export const OriginalNameSchema = z.string().min(1).max(255);

export const DecisionInputSchema = z.object({
  verdict: DecisionSchema.shape.verdict,
  note: z.string().trim().max(2000).default(""),
});
export type DecisionInput = z.infer<typeof DecisionInputSchema>;

/** `attempt` only applies to `kind=edited`; it defaults to the photo's best attempt. */
export const ImageQuerySchema = z.object({
  kind: z.enum(["original", "edited"]).default("original"),
  attempt: z
    .string()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .optional(),
});

/** The issue message on `url` when a link is off the allowlist; the import route maps it to 400. */
export const UNSUPPORTED_LINK = "Unsupported listing link";

const ImportUrlSchema = z
  .string()
  .trim()
  .max(2048, UNSUPPORTED_LINK)
  .transform((value, ctx): { site: ImportSite; url: URL } => {
    const url = URL.canParse(value) ? new URL(value) : null;
    const site = url && isAllowedUrl(url, isPageHost) ? pageSite(url.hostname) : null;
    if (!url || !site) {
      ctx.addIssue({ code: "custom", message: UNSUPPORTED_LINK });
      return z.NEVER;
    }
    url.hash = "";
    return { site, url };
  });

export const ListingImportInputSchema = z.object({
  url: ImportUrlSchema,
  name: NewListingInputSchema.shape.name.optional(),
  clientName: NewListingInputSchema.shape.clientName,
});
export type ListingImportInput = z.infer<typeof ListingImportInputSchema>;
