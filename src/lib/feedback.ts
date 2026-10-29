import fs from "node:fs/promises";
import { FeedbackEntrySchema, type FeedbackEntry } from "@/pipeline/schemas";
import { feedbackLogPath, getDataDir } from "./paths";

/** Validates `entries` and appends one JSON line each to the feedback log in one write. */
export async function appendFeedback(entries: FeedbackEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const lines = entries.map((entry) => `${JSON.stringify(FeedbackEntrySchema.parse(entry))}\n`).join("");
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.appendFile(feedbackLogPath(), lines, "utf8");
}

/** Every valid entry in the feedback log; unparseable or invalid lines are counted and skipped. */
export async function readFeedback(): Promise<{ entries: FeedbackEntry[]; invalidLines: number }> {
  let text: string;
  try {
    text = await fs.readFile(feedbackLogPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], invalidLines: 0 };
    throw err;
  }
  const entries: FeedbackEntry[] = [];
  let invalidLines = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      invalidLines++;
      continue;
    }
    const parsed = FeedbackEntrySchema.safeParse(json);
    if (parsed.success) entries.push(parsed.data);
    else invalidLines++;
  }
  return { entries, invalidLines };
}
