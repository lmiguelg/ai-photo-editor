import type { Attempt, Photo, PhotoStatus, RoomType } from "@/pipeline/schemas";

// Client-safe pure helpers for the management UI. No `node:*`, sharp, store or
// providers here: client components import this module.

/** Photos run at once by "Run all". A UI throttle, not a pipeline tunable. */
export const RUN_ALL_CONCURRENCY = 2;

/** Per-file upload cap; the upload route enforces the same value. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const UPLOAD_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  living_room: "Living room",
  bedroom: "Bedroom",
  kitchen: "Kitchen",
  bathroom: "Bathroom",
  dining: "Dining",
  exterior: "Exterior",
  other: "Other",
};

const STATUS_LABELS: Record<PhotoStatus, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  skipped: "Skipped",
  rejected: "Rejected (pipeline)",
  passed: "Passed",
  needs_review: "Needs review",
  failed: "Failed",
};

/** Statuses with a result the operator can approve or reject. */
export function isReviewable(photo: Pick<Photo, "status">): boolean {
  return photo.status === "passed" || photo.status === "needs_review";
}

/** Reviewable and not yet decided. */
export function isToReview(photo: Pick<Photo, "status" | "decision">): boolean {
  return isReviewable(photo) && photo.decision === null;
}

/** The decision that applies to the current result; one left on a non-reviewable photo is stale. */
function activeVerdict(photo: Pick<Photo, "status" | "decision">): "approved" | "rejected" | null {
  return isReviewable(photo) && photo.decision ? photo.decision.verdict : null;
}

export type ChipTone = "neutral" | "busy" | "good" | "warn" | "bad";

export function statusChip(photo: Pick<Photo, "status" | "decision">): { label: string; tone: ChipTone } {
  const verdict = activeVerdict(photo);
  if (verdict === "approved") return { label: "Approved", tone: "good" };
  if (verdict === "rejected") return { label: "Rejected by you", tone: "bad" };
  const tones: Record<PhotoStatus, ChipTone> = {
    uploaded: "neutral",
    processing: "busy",
    skipped: "neutral",
    rejected: "bad",
    passed: "good",
    needs_review: "warn",
    failed: "bad",
  };
  return { label: STATUS_LABELS[photo.status], tone: tones[photo.status] };
}

const STATUS_RANK: Record<PhotoStatus, number> = {
  needs_review: 0,
  passed: 1,
  processing: 2,
  failed: 3,
  uploaded: 4,
  skipped: 5,
  rejected: 5,
};

/** Lower ranks come first: undecided results, then work in progress, then decided photos. */
export function reviewRank(photo: Pick<Photo, "status" | "decision">): number {
  const verdict = activeVerdict(photo);
  if (verdict === "approved") return 6;
  if (verdict === "rejected") return 7;
  return STATUS_RANK[photo.status];
}

export function sortForReview<T extends Pick<Photo, "status" | "decision" | "createdAt">>(photos: readonly T[]): T[] {
  return [...photos].sort((a, b) => reviewRank(a) - reviewRank(b) || a.createdAt.localeCompare(b.createdAt));
}

/**
 * Where focus goes after deciding `decidedId`: the next photo still to review after it
 * in `ordered`, wrapping to the first one; null when none is left.
 */
export function nextToReview(
  ordered: readonly Pick<Photo, "id" | "status" | "decision">[],
  decidedId: string,
): string | null {
  const index = ordered.findIndex((photo) => photo.id === decidedId);
  const rotated = [...ordered.slice(index + 1), ...ordered.slice(0, Math.max(index, 0))];
  return rotated.find((photo) => photo.id !== decidedId && isToReview(photo))?.id ?? null;
}

/** Run all only picks photos without a result yet, so it never re-pays for one. */
export function isRunAllEligible(photo: Pick<Photo, "status" | "decision">): boolean {
  if (photo.decision?.verdict === "approved") return false;
  return photo.status === "uploaded" || photo.status === "failed";
}

export interface RunQueueOptions {
  concurrency: number;
  shouldStop?: () => boolean;
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight. Once `shouldStop()`
 * is true no new item starts; it resolves after the in-flight ones settle. A rejected
 * worker does not stop the queue.
 */
export async function runQueue<T>(
  items: readonly T[],
  worker: (item: T) => Promise<unknown>,
  { concurrency, shouldStop = () => false }: RunQueueOptions,
): Promise<void> {
  let next = 0;
  async function lane(): Promise<void> {
    while (next < items.length && !shouldStop()) {
      const item = items[next++];
      try {
        await worker(item);
      } catch {
        // The worker reports its own failures; keep going with the next item.
      }
    }
  }
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
}

export type RunOutcome = "ok" | "busy" | "failed";

/** How the UI treats a run route response status: 409 means another run has it. */
export function runOutcome(status: number): RunOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 409) return "busy";
  return "failed";
}

/** Text shown on the card for a run outcome; a busy photo is refreshed quietly. */
export function runErrorMessage(outcome: RunOutcome): string | null {
  return outcome === "failed" ? "Run failed" : null;
}

export interface CostSummary {
  totalUsd: number;
  priceUsd: number;
  marginUsd: number;
  marginPct: number;
}

export function costSummary(photos: readonly Pick<Photo, "costUsd">[], priceUsd: number): CostSummary {
  const totalUsd = photos.reduce((sum, photo) => sum + photo.costUsd, 0);
  const marginUsd = priceUsd - totalUsd;
  return { totalUsd, priceUsd, marginUsd, marginPct: (marginUsd / priceUsd) * 100 };
}

export function formatUsd(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits);
  return `${value < 0 && Number(text) !== 0 ? "-" : ""}$${text}`;
}

export function formatCostSummary({ totalUsd, priceUsd, marginUsd, marginPct }: CostSummary): string {
  return `AI cost ${formatUsd(totalUsd, 2)} of ${formatUsd(priceUsd, 2)} price, margin ${formatUsd(marginUsd, 2)} (${marginPct.toFixed(1)}%)`;
}

/** The attempt the photo's result is based on, if any. */
export function bestAttempt(photo: Pick<Photo, "attempts" | "bestAttemptIndex">): Attempt | null {
  if (photo.bestAttemptIndex === null) return null;
  return photo.attempts.find((attempt) => attempt.index === photo.bestAttemptIndex) ?? null;
}

export function photoImageUrl(photo: Pick<Photo, "id" | "listingId" | "updatedAt">, kind: "original" | "edited"): string {
  const v = encodeURIComponent(photo.updatedAt);
  return `/api/listings/${photo.listingId}/photos/${photo.id}/image?kind=${kind}&v=${v}`;
}

/** Why a file can't be uploaded, checked before any request; null when it can. */
export function uploadFileError(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    return "Unsupported file type (use JPG, PNG or WebP)";
  }
  if (file.size > MAX_UPLOAD_BYTES) return "File is larger than 25 MB";
  return null;
}

export type ReviewKeyAction = "next" | "prev" | "approve" | "reject";

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Maps a key press on the listing page to a review action; typing and modifiers are ignored. */
export function reviewKeyAction(event: KeyEventLike): ReviewKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target;
  if (target && (TYPING_TAGS.has((target.tagName ?? "").toUpperCase()) || target.isContentEditable)) return null;
  switch (event.key) {
    case "j":
    case "ArrowDown":
      return "next";
    case "k":
    case "ArrowUp":
      return "prev";
    case "a":
      return "approve";
    case "r":
      return "reject";
    default:
      return null;
  }
}
