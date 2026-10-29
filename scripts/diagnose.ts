// `npm run diagnose`: clusters the feedback log and writes a report proposing changes.
// It only writes `<DATA_DIR>/feedback-report.md`; it never edits prompts or config.
import fs from "node:fs/promises";
import { diagnose, renderDiagnosisReport } from "@/lib/diagnose";
import { readFeedback } from "@/lib/feedback";
import { getDataDir, safeJoin } from "@/lib/paths";

const { entries, invalidLines } = await readFeedback();
const result = diagnose(entries);
const report = renderDiagnosisReport(result, { generatedAt: new Date().toISOString(), invalidLines });

const reportPath = safeJoin(getDataDir(), "feedback-report.md");
await fs.mkdir(getDataDir(), { recursive: true });
await fs.writeFile(reportPath, report, "utf8");

console.log(`Report: ${reportPath}`);
console.log(`Entries: ${result.total}, invalid lines: ${invalidLines}, clusters: ${result.clusters.length}`);
