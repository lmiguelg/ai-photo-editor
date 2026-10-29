import { describe, expect, it } from "vitest";
import { config } from "@/pipeline/config";
import type { FeedbackEntry } from "@/pipeline/schemas";
import { diagnose, renderDiagnosisReport } from "./diagnose";

const QA = { pass: true, scores: { faithfulness: 8, realism: 7, lighting: 9, coherence: 10 }, reason: "Fine" };

function reject(n: number, photoStatus: FeedbackEntry["photoStatus"], qa: FeedbackEntry["qa"]): FeedbackEntry {
  return {
    kind: "human_reject",
    at: `2026-10-0${n}T10:00:00.000Z`,
    listingId: "listing-1",
    photoId: `photo-${n}`,
    roomType: "bathroom",
    photoStatus,
    attemptIndex: qa ? 0 : null,
    prompt: qa ? "Brighten" : null,
    qa,
    note: `note ${n}`,
  };
}

describe("diagnose (QA review)", () => {
  it("means human_reject scores over entries with qa only and has no near misses", () => {
    const [cluster] = diagnose([reject(1, "passed", QA), reject(2, "passed", null), reject(3, "passed", QA)]).clusters;
    expect(cluster).toMatchObject({ kind: "human_reject", dimension: "after_qa_pass", count: 3, nearMisses: null });
    expect(cluster.meanScores).toEqual({ faithfulness: 8, realism: 7, lighting: 9, coherence: 10 });
    expect(cluster.examples.map((e) => e.text)).toEqual(["note 3", "note 2", "note 1"]);
    expect(cluster.proposal).toHaveLength(1);
    expect(cluster.proposal![0]).toContain("bathroom");
  });

  it("treats any non-passed status of a rejected photo as after_needs_review", () => {
    const [cluster] = diagnose([reject(1, "needs_review", null)]).clusters;
    expect(cluster.dimension).toBe("after_needs_review");
  });

  it("caps examples at maxExamplesPerCluster", () => {
    const entries = [1, 2, 3, 4, 5].map((n) => reject(n, "passed", null));
    const [cluster] = diagnose(entries, { ...config, feedback: { minClusterSize: 3, maxExamplesPerCluster: 2 } }).clusters;
    expect(cluster.examples.map((e) => e.text)).toEqual(["note 5", "note 4"]);
  });

  it("lists clusters below the minimum size in the report without a proposal", () => {
    const report = renderDiagnosisReport(diagnose([reject(1, "passed", null)]), {
      generatedAt: "2026-10-29T10:00:00.000Z",
      invalidLines: 0,
    });
    expect(report).toContain("### human_reject / bathroom / after_qa_pass");
    const proposed = report.slice(report.indexOf("## Proposed changes"), report.indexOf("## Clusters"));
    expect(proposed).not.toContain("bathroom");
    expect(report).toContain("note 1");
  });
});
