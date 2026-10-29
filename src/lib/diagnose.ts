import { config as defaultConfig, type PipelineConfig } from "@/pipeline/config";
import type { FeedbackEntry, RoomType } from "@/pipeline/schemas";

/**
 * Meta-diagnoser: groups feedback entries into clusters and proposes prompt or
 * threshold changes as text. Pure and free: no fs, providers or model calls.
 */

export type FeedbackKind = FeedbackEntry["kind"];
export type RubricKey = PipelineConfig["qa"]["rubric"][number];
export type Dimension = RubricKey | "qa_veto" | "after_qa_pass" | "after_needs_review";

export interface ClusterExample {
  /** `listingId/photoId`. */
  ref: string;
  attemptIndex: number | null;
  /** QA reason for `qa_fail`, reviewer note for `human_reject`. */
  text: string;
  prompt: string | null;
}

export interface Cluster {
  kind: FeedbackKind;
  roomType: RoomType;
  dimension: Dimension;
  count: number;
  /** Fraction of all entries, 0..1. */
  share: number;
  /** Mean per rubric key over entries with QA scores; null when none has that score. */
  meanScores: Record<RubricKey, number | null>;
  /** Entries scoring exactly `minScore - 1` on the dimension; null unless a `qa_fail` rubric cluster. */
  nearMisses: number | null;
  /** Newest first, at most `maxExamplesPerCluster`. */
  examples: ClusterExample[];
  /** Proposal lines; null below `minClusterSize`. */
  proposal: string[] | null;
}

export interface DiagnosisResult {
  total: number;
  byKind: Record<FeedbackKind, number>;
  /** Count descending. */
  clusters: Cluster[];
}

const NEAR_MISS_LINE =
  "Most failures miss `config.qa.minScore` by one point; check the examples by hand before changing the threshold.";

function isRubricKey(dimension: Dimension, cfg: PipelineConfig): dimension is RubricKey {
  return (cfg.qa.rubric as readonly string[]).includes(dimension);
}

/** The lowest failing rubric key (missing counts as lowest, ties in rubric order), else `qa_veto`. */
function dimensionOf(entry: FeedbackEntry, cfg: PipelineConfig): Dimension {
  if (entry.kind === "human_reject") {
    return entry.photoStatus === "passed" ? "after_qa_pass" : "after_needs_review";
  }
  let lowest: { key: RubricKey; score: number } | null = null;
  for (const key of cfg.qa.rubric) {
    const score = entry.qa?.scores[key] ?? -Infinity;
    if (score >= cfg.qa.minScore) continue;
    if (!lowest || score < lowest.score) lowest = { key, score };
  }
  return lowest?.key ?? "qa_veto";
}

function proposalFor(dimension: Dimension, roomType: RoomType): string {
  switch (dimension) {
    case "faithfulness":
      return `Make SYNTHESIZER_SYSTEM and REFINER_SYSTEM in src/pipeline/prompts.ts more conservative for ${roomType} photos. Never relax QA_SYSTEM or config.qa.minScore for faithfulness.`;
    case "realism":
      return `Ask for subtler edits of ${roomType} photos in SYNTHESIZER_SYSTEM in src/pipeline/prompts.ts.`;
    case "lighting":
      return `Make SYNTHESIZER_SYSTEM in src/pipeline/prompts.ts name the exposure / white-balance fixes for ${roomType} photos more concretely.`;
    case "coherence":
      return `Make SYNTHESIZER_SYSTEM in src/pipeline/prompts.ts stress keeping perspective, shadows and reflections consistent in ${roomType} photos.`;
    case "qa_veto":
      return `Review QA_SYSTEM in src/pipeline/prompts.ts: the model fails ${roomType} edits whose scores all meet config.qa.minScore (src/pipeline/config.ts). Check the examples by hand.`;
    case "after_qa_pass":
      return `The QA gate let through ${roomType} photos a human rejected. Consider raising config.qa.minScore in src/pipeline/config.ts or tightening QA_SYSTEM in src/pipeline/prompts.ts.`;
    case "after_needs_review":
      return `Best-of-failed ${roomType} attempts are being rejected. Review REFINER_SYSTEM in src/pipeline/prompts.ts and whether config.limits.maxRetries in src/pipeline/config.ts is worth raising, taking cost into account.`;
  }
}

function meanScores(entries: FeedbackEntry[], cfg: PipelineConfig): Record<RubricKey, number | null> {
  const means = {} as Record<RubricKey, number | null>;
  for (const key of cfg.qa.rubric) {
    const scores = entries.flatMap((entry) => {
      const score = entry.qa?.scores[key];
      return score === undefined ? [] : [score];
    });
    means[key] = scores.length === 0 ? null : scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }
  return means;
}

/** Clusters entries by `(kind, roomType, dimension)` and attaches proposals to the big ones. */
export function diagnose(entries: FeedbackEntry[], cfg: PipelineConfig = defaultConfig): DiagnosisResult {
  const groups = new Map<string, { kind: FeedbackKind; roomType: RoomType; dimension: Dimension; items: { entry: FeedbackEntry; order: number }[] }>();
  entries.forEach((entry, order) => {
    const dimension = dimensionOf(entry, cfg);
    const key = `${entry.kind}/${entry.roomType}/${dimension}`;
    let group = groups.get(key);
    if (!group) {
      group = { kind: entry.kind, roomType: entry.roomType, dimension, items: [] };
      groups.set(key, group);
    }
    group.items.push({ entry, order });
  });

  const clusters: Cluster[] = [...groups.values()].map(({ kind, roomType, dimension, items }) => {
    const groupEntries = items.map((item) => item.entry);
    const count = groupEntries.length;
    const rubricDimension = kind === "qa_fail" && isRubricKey(dimension, cfg);
    const nearMisses = rubricDimension
      ? groupEntries.filter((entry) => entry.qa?.scores[dimension] === cfg.qa.minScore - 1).length
      : null;
    // Newest first; entries appended later win ties on `at`.
    const newest = [...items].sort((a, b) => b.entry.at.localeCompare(a.entry.at) || b.order - a.order);
    const examples = newest.slice(0, cfg.feedback.maxExamplesPerCluster).map(({ entry }) => ({
      ref: `${entry.listingId}/${entry.photoId}`,
      attemptIndex: entry.attemptIndex,
      text: entry.kind === "qa_fail" ? (entry.qa?.reason ?? "") : entry.note,
      prompt: entry.prompt,
    }));
    let proposal: string[] | null = null;
    if (count >= cfg.feedback.minClusterSize) {
      proposal = [proposalFor(dimension, roomType)];
      if (nearMisses !== null && nearMisses * 2 >= count) proposal.push(NEAR_MISS_LINE);
    }
    return {
      kind,
      roomType,
      dimension,
      count,
      share: count / entries.length,
      meanScores: meanScores(groupEntries, cfg),
      nearMisses,
      examples,
      proposal,
    };
  });
  clusters.sort((a, b) => b.count - a.count);

  return {
    total: entries.length,
    byKind: {
      qa_fail: entries.filter((entry) => entry.kind === "qa_fail").length,
      human_reject: entries.filter((entry) => entry.kind === "human_reject").length,
    },
    clusters,
  };
}

export const MAX_REPORT_TEXT_LENGTH = 300;

/** Collapses newlines to spaces and cuts untrusted text to `MAX_REPORT_TEXT_LENGTH`. */
function clean(text: string): string {
  return text.replace(/\r?\n|\r/g, " ").slice(0, MAX_REPORT_TEXT_LENGTH);
}

function clusterTitle(cluster: Cluster): string {
  return `${cluster.kind} / ${cluster.roomType} / ${cluster.dimension}`;
}

function formatMeans(means: Record<string, number | null>): string {
  const parts = Object.entries(means)
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .map(([key, mean]) => `${key} ${mean.toFixed(1)}`);
  return parts.length === 0 ? "no QA scores" : parts.join(", ");
}

/** The diagnosis as Markdown. It proposes changes only; nothing is edited. */
export function renderDiagnosisReport(
  result: DiagnosisResult,
  { generatedAt, invalidLines }: { generatedAt: string; invalidLines: number },
): string {
  const lines: string[] = [
    "# Feedback diagnosis report",
    "",
    `Generated: ${generatedAt}`,
    "",
    `- Entries: ${result.total} (qa_fail: ${result.byKind.qa_fail}, human_reject: ${result.byKind.human_reject})`,
    `- Invalid lines skipped: ${invalidLines}`,
    "",
  ];

  if (result.total === 0) {
    lines.push("No feedback entries yet.", "");
  } else {
    lines.push("## Proposed changes", "");
    const proposed = result.clusters.filter((cluster) => cluster.proposal !== null);
    if (proposed.length === 0) lines.push("No cluster is big enough for a proposal yet.");
    for (const cluster of proposed) {
      const [first, ...rest] = cluster.proposal!;
      lines.push(`- **${clusterTitle(cluster)}** (${cluster.count} entries): ${first}`);
      for (const line of rest) lines.push(`  - ${line}`);
    }
    lines.push("", "## Clusters", "");
    for (const cluster of result.clusters) {
      lines.push(
        `### ${clusterTitle(cluster)}`,
        "",
        `- Count: ${cluster.count} (${(cluster.share * 100).toFixed(1)}% of entries)`,
        `- Mean scores: ${formatMeans(cluster.meanScores)}`,
      );
      if (cluster.nearMisses !== null) lines.push(`- Near misses (one point below the minimum score): ${cluster.nearMisses}`);
      lines.push(`- Proposal: ${cluster.proposal ? "yes, see Proposed changes" : "none (below the minimum cluster size)"}`);
      lines.push("", "Examples, newest first:", "");
      const label = cluster.kind === "qa_fail" ? "QA reason" : "Note";
      for (const example of cluster.examples) {
        const attempt = example.attemptIndex === null ? "no attempt" : `attempt ${example.attemptIndex}`;
        const prompt = example.prompt === null ? "" : ` | Prompt: ${clean(example.prompt)}`;
        lines.push(`- ${example.ref}, ${attempt} | ${label}: ${clean(example.text) || "(none)"}${prompt}`);
      }
      lines.push("");
    }
  }

  lines.push("This report only proposes changes; nothing was edited.", "");
  return lines.join("\n");
}
