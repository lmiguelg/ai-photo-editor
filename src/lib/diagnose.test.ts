import { describe, expect, it } from "vitest";
import type { FeedbackEntry, QaResult, RoomType } from "@/pipeline/schemas";
import { diagnose, renderDiagnosisReport } from "./diagnose";

let seq = 0;

function qaFail(roomType: RoomType, scores: Record<string, number>, reason = "Bad edit"): FeedbackEntry {
  seq++;
  const qa: QaResult = { pass: false, scores, reason };
  return {
    kind: "qa_fail",
    at: new Date(Date.UTC(2026, 9, 1, 0, seq)).toISOString(),
    listingId: "listing-1",
    photoId: `photo-${seq}`,
    roomType,
    photoStatus: "needs_review",
    attemptIndex: 0,
    prompt: `Prompt ${seq}`,
    qa,
    note: "",
  };
}

function humanReject(roomType: RoomType, photoStatus: FeedbackEntry["photoStatus"], note = "sofa removed"): FeedbackEntry {
  seq++;
  return {
    kind: "human_reject",
    at: new Date(Date.UTC(2026, 9, 1, 0, seq)).toISOString(),
    listingId: "listing-1",
    photoId: `photo-${seq}`,
    roomType,
    photoStatus,
    attemptIndex: null,
    prompt: null,
    qa: null,
    note,
  };
}

const OK = { faithfulness: 9, realism: 9, lighting: 9, coherence: 9 };
const key = (c: { kind: string; roomType: string; dimension: string }) => `${c.kind}/${c.roomType}/${c.dimension}`;

describe("diagnose", () => {
  it("clusters by kind, room type and lowest failing rubric key", () => {
    const result = diagnose([
      qaFail("kitchen", { ...OK, faithfulness: 5 }),
      qaFail("kitchen", { ...OK, faithfulness: 6, realism: 4 }),
      // Missing score counts as lowest; ties go to rubric order.
      qaFail("kitchen", { faithfulness: 3, realism: 9, lighting: 9 }),
      qaFail("kitchen", { ...OK, lighting: 5, coherence: 5 }),
      qaFail("bedroom", { ...OK, faithfulness: 5 }),
      qaFail("bedroom", OK),
      humanReject("kitchen", "passed"),
      humanReject("kitchen", "needs_review"),
    ]);
    expect(result.total).toBe(8);
    expect(result.byKind).toEqual({ qa_fail: 6, human_reject: 2 });
    expect(Object.fromEntries(result.clusters.map((c) => [key(c), c.count]))).toEqual({
      "qa_fail/kitchen/realism": 1,
      "qa_fail/kitchen/coherence": 1,
      "qa_fail/kitchen/faithfulness": 1,
      "qa_fail/kitchen/lighting": 1,
      "qa_fail/bedroom/faithfulness": 1,
      "qa_fail/bedroom/qa_veto": 1,
      "human_reject/kitchen/after_qa_pass": 1,
      "human_reject/kitchen/after_needs_review": 1,
    });
    expect(result.clusters.every((c) => c.share === 1 / 8)).toBe(true);
  });

  it("sorts by count, reports means, near misses and newest-first examples", () => {
    const result = diagnose([
      qaFail("bedroom", { ...OK, realism: 2 }),
      qaFail("kitchen", { ...OK, faithfulness: 6 }, "first"),
      qaFail("kitchen", { ...OK, faithfulness: 6, lighting: 7 }, "second"),
      qaFail("kitchen", { ...OK, faithfulness: 3 }, "third"),
      qaFail("kitchen", { ...OK, faithfulness: 6 }, "fourth"),
    ]);
    const [kitchen, bedroom] = result.clusters;
    expect(key(kitchen)).toBe("qa_fail/kitchen/faithfulness");
    expect(key(bedroom)).toBe("qa_fail/bedroom/realism");
    expect(kitchen.count).toBe(4);
    expect(kitchen.share).toBe(0.8);
    expect(kitchen.meanScores).toEqual({ faithfulness: 5.25, realism: 9, lighting: 8.5, coherence: 9 });
    expect(kitchen.nearMisses).toBe(3);
    expect(kitchen.examples.map((e) => e.text)).toEqual(["fourth", "third", "second"]);
    expect(kitchen.examples[0]).toMatchObject({ ref: expect.stringMatching(/^listing-1\/photo-\d+$/), attemptIndex: 0 });
  });

  it("only proposes for clusters of at least minClusterSize", () => {
    const result = diagnose([
      qaFail("kitchen", { ...OK, faithfulness: 2 }),
      qaFail("kitchen", { ...OK, faithfulness: 2 }),
      qaFail("kitchen", { ...OK, faithfulness: 2 }),
      qaFail("bedroom", { ...OK, faithfulness: 2 }),
      qaFail("bedroom", { ...OK, faithfulness: 2 }),
    ]);
    const [kitchen, bedroom] = result.clusters;
    expect(kitchen.proposal).toEqual([
      "Make SYNTHESIZER_SYSTEM and REFINER_SYSTEM in src/pipeline/prompts.ts more conservative for kitchen photos. Never relax QA_SYSTEM or config.qa.minScore for faithfulness.",
    ]);
    expect(bedroom.proposal).toBeNull();
  });

  it("adds the near-miss line only when at least half the cluster misses by one point", () => {
    const near = diagnose([
      qaFail("kitchen", { ...OK, lighting: 6 }),
      qaFail("kitchen", { ...OK, lighting: 6 }),
      qaFail("kitchen", { ...OK, lighting: 2 }),
      qaFail("kitchen", { ...OK, lighting: 2 }),
    ]).clusters[0];
    expect(near.proposal).toHaveLength(2);
    expect(near.proposal![0]).toContain("SYNTHESIZER_SYSTEM");
    expect(near.proposal![0]).toContain("kitchen");
    expect(near.proposal![1]).toBe(
      "Most failures miss `config.qa.minScore` by one point; check the examples by hand before changing the threshold.",
    );

    const far = diagnose([
      qaFail("kitchen", { ...OK, lighting: 6 }),
      qaFail("kitchen", { ...OK, lighting: 2 }),
      qaFail("kitchen", { ...OK, lighting: 2 }),
    ]).clusters[0];
    expect(far.proposal).toHaveLength(1);

    const veto = diagnose([qaFail("bedroom", OK), qaFail("bedroom", OK), qaFail("bedroom", OK)]).clusters[0];
    expect(veto.dimension).toBe("qa_veto");
    expect(veto.nearMisses).toBeNull();
    expect(veto.proposal).toHaveLength(1);
    expect(veto.proposal![0]).toContain("QA_SYSTEM");
  });

  it("names the file and symbol in every proposal", () => {
    const cases: [FeedbackEntry, string[]][] = [
      [qaFail("dining", { ...OK, realism: 2 }), ["SYNTHESIZER_SYSTEM", "subtler"]],
      [qaFail("dining", { ...OK, lighting: 2 }), ["SYNTHESIZER_SYSTEM", "white-balance"]],
      [qaFail("dining", { ...OK, coherence: 2 }), ["SYNTHESIZER_SYSTEM", "perspective, shadows and reflections"]],
      [qaFail("dining", OK), ["QA_SYSTEM", "config.qa.minScore"]],
      [humanReject("dining", "passed"), ["config.qa.minScore", "QA_SYSTEM"]],
      [humanReject("dining", "needs_review"), ["REFINER_SYSTEM", "config.limits.maxRetries", "cost"]],
    ];
    for (const [entry, words] of cases) {
      const [cluster] = diagnose([entry, entry, entry]).clusters;
      const text = cluster.proposal!.join(" ");
      for (const word of [...words, "dining", "src/pipeline/"]) expect(text, key(cluster)).toContain(word);
    }
  });

  it("returns no clusters for no entries", () => {
    expect(diagnose([])).toEqual({ total: 0, byKind: { qa_fail: 0, human_reject: 0 }, clusters: [] });
  });
});

describe("renderDiagnosisReport", () => {
  const options = { generatedAt: "2026-10-29T10:00:00.000Z", invalidLines: 2 };

  it("says there are no entries yet for an empty log", () => {
    const report = renderDiagnosisReport(diagnose([]), options);
    expect(report).toContain("2026-10-29T10:00:00.000Z");
    expect(report).toContain("No feedback entries yet.");
    expect(report).toContain("Invalid lines skipped: 2");
    expect(report).not.toContain("## Proposed changes");
    expect(report).not.toContain("## Clusters");
    expect(report).toContain("nothing was edited");
  });

  it("lists proposals and clusters, and truncates and flattens untrusted text", () => {
    const long = `line one\nline two ${"x".repeat(400)}`;
    const entries = [
      qaFail("kitchen", { ...OK, faithfulness: 2 }, long),
      qaFail("kitchen", { ...OK, faithfulness: 2 }),
      qaFail("kitchen", { ...OK, faithfulness: 2 }),
      humanReject("bedroom", "passed", "bad\r\nnote"),
    ];
    const report = renderDiagnosisReport(diagnose(entries), options);
    expect(report).toContain("Entries: 4 (qa_fail: 3, human_reject: 1)");
    expect(report).toContain("## Proposed changes");
    expect(report).toContain("### qa_fail / kitchen / faithfulness");
    expect(report).toContain("### human_reject / bedroom / after_qa_pass");
    expect(report).toContain("Count: 3 (75.0% of entries)");
    expect(report).toContain("SYNTHESIZER_SYSTEM and REFINER_SYSTEM in src/pipeline/prompts.ts");
    expect(report).toContain("bad note");
    expect(report).toContain(`line one line two ${"x".repeat(300 - "line one line two ".length)} |`);
    expect(report).not.toContain("x".repeat(301 - "line one line two ".length));
    expect(report.trimEnd().endsWith("This report only proposes changes; nothing was edited.")).toBe(true);
  });
});
