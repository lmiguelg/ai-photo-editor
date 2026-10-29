// `npm run eval -- <folder>`: runs sample photos through the pipeline and prints pass
// rate, retries and cost per image. Spends real money when API keys are set.
import fs from "node:fs/promises";
import path from "node:path";
import { formatEvalReport, listEvalImages, runEval, summarizeEval } from "@/lib/eval";
import { createProviders } from "@/pipeline/providers";

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: npm run eval -- <folder>");
  process.exit(1);
}

const stat = await fs.stat(folder).catch(() => null);
if (!stat?.isDirectory()) {
  console.error(`Error: folder not found: ${folder}`);
  process.exit(1);
}

const images = await listEvalImages(folder);
if (images.length === 0) {
  console.error(`Error: no jpg/jpeg/png/webp images in ${folder} or its room-type subfolders`);
  process.exit(1);
}

const providers = createProviders(process.env);
const withBytes = [];
for (const image of images) {
  withBytes.push({ ...image, image: await fs.readFile(path.join(folder, image.file)) });
}
const rows = await runEval(withBytes, providers);
console.log(formatEvalReport(rows, summarizeEval(rows), providers.mode));
