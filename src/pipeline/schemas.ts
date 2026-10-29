import { z } from "zod";

export const IdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/, "Invalid id");
export type Id = z.infer<typeof IdSchema>;

/** A file name relative to the photo's folder: no separators, no `..`. */
export const FileNameSchema = z
  .string()
  .min(1)
  .refine(
    (name) => !name.includes("/") && !name.includes("\\") && !name.includes(".."),
    "File name must not contain '/', '\\' or '..'",
  );
export type FileName = z.infer<typeof FileNameSchema>;

const DateTimeSchema = z.iso.datetime();

export const RoomTypeSchema = z.enum([
  "living_room",
  "bedroom",
  "kitchen",
  "bathroom",
  "dining",
  "exterior",
  "other",
]);
export type RoomType = z.infer<typeof RoomTypeSchema>;

export const PhotoStatusSchema = z.enum([
  "uploaded",
  "processing",
  "skipped",
  "rejected",
  "passed",
  "needs_review",
  "failed",
]);
export type PhotoStatus = z.infer<typeof PhotoStatusSchema>;

export const QaResultSchema = z.object({
  pass: z.boolean(),
  scores: z.record(z.string(), z.number()),
  reason: z.string(),
});
export type QaResult = z.infer<typeof QaResultSchema>;

/** Router agent output. */
export const RouteDecisionSchema = z.object({
  route: z.enum(["skip", "enhance", "reject"]),
  reason: z.string(),
});
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

/** Synthesizer and refiner agent output: the edit instruction for the image editor. */
export const PromptOutputSchema = z.object({
  prompt: z.string().trim().min(1),
});
export type PromptOutput = z.infer<typeof PromptOutputSchema>;

export const AttemptSchema = z.object({
  index: z.number().int().min(0),
  prompt: z.string(),
  editedFile: FileNameSchema.nullable(),
  qa: QaResultSchema.nullable(),
  costUsd: z.number().min(0),
  createdAt: DateTimeSchema,
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const DecisionSchema = z.object({
  verdict: z.enum(["approved", "rejected"]),
  note: z.string(),
  decidedAt: DateTimeSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;

export const PhotoSchema = z.object({
  id: IdSchema,
  listingId: IdSchema,
  roomType: RoomTypeSchema,
  originalName: z.string(),
  originalFile: FileNameSchema,
  status: PhotoStatusSchema,
  attempts: z.array(AttemptSchema),
  bestAttemptIndex: z.number().int().min(0).nullable(),
  costUsd: z.number().min(0),
  decision: DecisionSchema.nullable(),
  error: z.string().nullable(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});
export type Photo = z.infer<typeof PhotoSchema>;

/** One line of `data/feedback.jsonl`: a failed QA attempt or a human rejection. */
export const FeedbackEntrySchema = z.object({
  kind: z.enum(["qa_fail", "human_reject"]),
  at: DateTimeSchema,
  listingId: IdSchema,
  photoId: IdSchema,
  roomType: RoomTypeSchema,
  /** Status after the run (`qa_fail`) or at decision time (`human_reject`). */
  photoStatus: PhotoStatusSchema,
  attemptIndex: z.number().int().min(0).nullable(),
  prompt: z.string().nullable(),
  qa: QaResultSchema.nullable(),
  /** Reviewer note for `human_reject`; empty for `qa_fail`. */
  note: z.string(),
});
export type FeedbackEntry = z.infer<typeof FeedbackEntrySchema>;

const ListingNameSchema =z.string().trim().min(1).max(200);

export const ListingSchema = z.object({
  id: IdSchema,
  name: ListingNameSchema,
  clientName: z.string().nullable(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  photos: z.array(PhotoSchema),
});
export type Listing = z.infer<typeof ListingSchema>;

/** What `listing.json` holds on disk: the listing without its photos. */
export const ListingRecordSchema = ListingSchema.omit({ photos: true });
export type ListingRecord = z.infer<typeof ListingRecordSchema>;

export const NewListingInputSchema = z.object({
  name: ListingNameSchema,
  clientName: z.string().optional(),
});
export type NewListingInput = z.infer<typeof NewListingInputSchema>;
