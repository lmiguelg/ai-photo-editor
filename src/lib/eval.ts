import fs from "node:fs/promises";
import path from "node:path";
import { config as defaultConfig, type PipelineConfig } from "@/pipeline/config";
import type { ProviderMode } from "@/pipeline/providers";
import type { Providers } from "@/pipeline/providers/types";
import { runPhoto, type PhotoRunStatus, type StopReason } from "@/pipeline/run-photo";
import { RoomTypeSchema, type RoomType } from "@/pipeline/schemas";
import { formatUsd } from "./review";

/**
 * Eval harness: runs a folder of sample photos through the pipeline and reports pass
 * rate, retries and cost. Writes nothing to disk and nothing to the feedback log.
 */

export interface EvalImage {
  /** Path relative to the eval folder, with `/` separators. */
  file: string;
  roomType: RoomType;
}

export interface EvalRow {
  file: string;
  roomType: RoomType;
  status: PhotoRunStatus;
  stopReason: StopReason;
  attempts: number;
  retries: number;
  costUsd: number;
}

export interface EvalSummary {
  images: number;
  passed: number;
  /** `passed / images`, 0..1. */
  passRate: number;
  byStatus: Partial<Record<PhotoRunStatus, number>>;
  meanRetries: number;
  totalCostUsd: number;
  meanCostPerImageUsd: number;
}

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i;

async function imageFilesIn(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && IMAGE_EXTENSION.test(entry.name)).map((entry) => entry.name);
}

/**
 * Images directly in `folder` (room type `other`) and directly inside immediate
 * subfolders named after a room type, sorted by relative path.
 */
export async function listEvalImages(folder: string): Promise<EvalImage[]> {
  const root = path.resolve(folder);
  const images: EvalImage[] = (await imageFilesIn(root)).map((file) => ({ file, roomType: "other" }));
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const roomType = RoomTypeSchema.safeParse(entry.name);
    if (!roomType.success) continue;
    for (const name of await imageFilesIn(path.join(root, entry.name))) {
      images.push({ file: `${entry.name}/${name}`, roomType: roomType.data });
    }
  }
  return images.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** Runs `runPhoto` on each image's bytes in turn and returns one row per image. */
export async function runEval(
  images: (EvalImage & { image: Buffer })[],
  providers: Providers,
  cfg: PipelineConfig = defaultConfig,
): Promise<EvalRow[]> {
  const rows: EvalRow[] = [];
  for (const { file, roomType, image } of images) {
    const result = await runPhoto({ image, roomType, providers, config: cfg });
    const attempts = result.attempts.length;
    rows.push({
      file,
      roomType,
      status: result.status,
      stopReason: result.stopReason,
      attempts,
      retries: Math.max(0, attempts - 1),
      costUsd: result.totalCostUsd,
    });
  }
  return rows;
}

export function summarizeEval(rows: EvalRow[]): EvalSummary {
  const images = rows.length;
  const byStatus: Partial<Record<PhotoRunStatus, number>> = {};
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  const passed = byStatus.passed ?? 0;
  const totalRetries = rows.reduce((sum, row) => sum + row.retries, 0);
  const totalCostUsd = rows.reduce((sum, row) => sum + row.costUsd, 0);
  return {
    images,
    passed,
    passRate: images === 0 ? 0 : passed / images,
    byStatus,
    meanRetries: images === 0 ? 0 : totalRetries / images,
    totalCostUsd,
    meanCostPerImageUsd: images === 0 ? 0 : totalCostUsd / images,
  };
}

/** Plain-text report: provider modes, one line per image, then the summary. */
export function formatEvalReport(rows: EvalRow[], summary: EvalSummary, mode: ProviderMode): string {
  const statusCounts = Object.entries(summary.byStatus)
    .map(([status, count]) => `${status} ${count}`)
    .join(", ");
  return [
    `Providers: vision ${mode.vision}, editor ${mode.editor}`,
    "",
    ...rows.map(
      (row) =>
        `${row.file}  ${row.roomType}  ${row.status}  ${row.stopReason}  retries ${row.retries}  ${formatUsd(row.costUsd, 4)}`,
    ),
    "",
    `Images: ${summary.images}`,
    `Pass rate: ${(summary.passRate * 100).toFixed(0)}% (${summary.passed}/${summary.images})`,
    `Statuses: ${statusCounts || "none"}`,
    `Mean retries: ${summary.meanRetries.toFixed(2)}`,
    `Total cost: ${formatUsd(summary.totalCostUsd, 4)}`,
    `Mean cost per image: ${formatUsd(summary.meanCostPerImageUsd, 4)}`,
    "",
  ].join("\n");
}
