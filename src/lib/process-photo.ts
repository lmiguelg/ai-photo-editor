import fs from "node:fs/promises";
import sharp from "sharp";
import type { Providers } from "@/pipeline/providers/types";
import { runPhoto, type AttemptRun } from "@/pipeline/run-photo";
import type { Attempt, Photo } from "@/pipeline/schemas";
import { claimPhotoForRun, getPhotoFilePath, savePhotoFile, updatePhoto } from "./store";

export const MAX_STORED_ERROR_LENGTH = 500;

// Photos this process is running. Kept on `globalThis` so separately bundled route
// modules share one set; it is empty after a restart, so a stuck photo can be reset.
const RUNNING_KEY = Symbol.for("ai-photo-editor.process-photo.running");
const running: Set<string> = ((globalThis as Record<symbol, unknown>)[RUNNING_KEY] ??= new Set<string>()) as Set<string>;

/** True while `processPhoto` is running this photo in this process. */
export function isPhotoRunning(listingId: string, photoId: string): boolean {
  return running.has(`${listingId}/${photoId}`);
}

const EDITED_EXTENSIONS: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp" };

/** Extension for edited bytes from their detected format; null when not a supported image. */
async function detectExtension(bytes: Buffer): Promise<string | null> {
  try {
    const { format } = await sharp(bytes).metadata();
    return (format && EDITED_EXTENSIONS[format]) ?? null;
  } catch {
    return null;
  }
}

async function saveAttempt(listingId: string, photoId: string, run: AttemptRun): Promise<Attempt> {
  if (!run.editedImage) return run.attempt;
  const ext = await detectExtension(run.editedImage.bytes);
  if (!ext) return run.attempt;
  const editedFile = `attempt-${run.attempt.index}.${ext}`;
  await savePhotoFile(listingId, photoId, editedFile, run.editedImage.bytes);
  return { ...run.attempt, editedFile };
}

/**
 * Claims the photo (409 if already processing), runs the pipeline on its original and
 * persists the edited files, then the record. Any failure after the claim leaves the
 * photo `failed` with a fixed error and rethrows as a plain `Error`.
 */
export async function processPhoto(
  listingId: string,
  photoId: string,
  providers: Providers,
): Promise<Photo> {
  const claimed = await claimPhotoForRun(listingId, photoId);
  const key = `${listingId}/${photoId}`;
  running.add(key);
  let spentUsd = 0;
  try {
    const image = await fs.readFile(getPhotoFilePath(listingId, photoId, claimed.originalFile));
    const result = await runPhoto({ image, roomType: claimed.roomType, providers });
    spentUsd = result.totalCostUsd;

    const attempts: Attempt[] = [];
    for (const run of result.attempts) attempts.push(await saveAttempt(listingId, photoId, run));

    return await updatePhoto(listingId, photoId, (photo) => ({
      ...photo,
      status: result.status,
      bestAttemptIndex: result.bestAttemptIndex,
      attempts,
      costUsd: photo.costUsd + result.totalCostUsd,
      error: result.error === null ? null : result.error.slice(0, MAX_STORED_ERROR_LENGTH),
      decision: null,
    }));
  } catch (err) {
    // Keep the money already spent on the record even when persisting the run failed.
    await updatePhoto(listingId, photoId, (photo) => ({
      ...photo,
      status: "failed",
      error: "Run failed",
      costUsd: photo.costUsd + spentUsd,
    }));
    throw new Error("Run failed", { cause: err });
  } finally {
    running.delete(key);
  }
}
