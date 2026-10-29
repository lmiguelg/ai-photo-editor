import { z } from "zod";
import { DecisionSchema, IdSchema, RoomTypeSchema } from "@/pipeline/schemas";

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
