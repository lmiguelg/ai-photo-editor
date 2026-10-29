import { describe, expect, it } from "vitest";
import type { Photo, PhotoStatus, RoomType } from "@/pipeline/schemas";
import {
  canExport,
  costSummary,
  exportSelection,
  formatCostSummary,
  formatUsd,
  isRunAllEligible,
  isToReview,
  nextToReview,
  reviewKeyAction,
  RUN_ALL_CONCURRENCY,
  runErrorMessage,
  runOutcome,
  runQueue,
  sortForReview,
  statusChip,
  uploadFileError,
} from "./review";

type Verdict = "approved" | "rejected";

function photo(id: string, status: PhotoStatus, verdict: Verdict | null = null, createdAt = "2026-01-01T00:00:00.000Z") {
  return {
    id,
    status,
    createdAt,
    costUsd: 0,
    decision: verdict ? { verdict, note: "", decidedAt: createdAt } : null,
  } satisfies Pick<Photo, "id" | "status" | "createdAt" | "costUsd" | "decision">;
}

const at = (second: number) => `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("sortForReview", () => {
  it("orders undecided results first, then work in progress, then decided photos", () => {
    const photos = [
      photo("rejected-by-you", "passed", "rejected", at(1)),
      photo("approved", "needs_review", "approved", at(2)),
      photo("skipped", "skipped", null, at(3)),
      photo("pipeline-rejected", "rejected", null, at(4)),
      photo("uploaded", "uploaded", null, at(5)),
      photo("failed", "failed", null, at(6)),
      photo("processing", "processing", null, at(7)),
      photo("passed-late", "passed", null, at(9)),
      photo("passed-early", "passed", null, at(8)),
      photo("needs-review", "needs_review", null, at(10)),
    ];
    expect(sortForReview(photos).map((p) => p.id)).toEqual([
      "needs-review",
      "passed-early",
      "passed-late",
      "processing",
      "failed",
      "uploaded",
      "skipped",
      "pipeline-rejected",
      "approved",
      "rejected-by-you",
    ]);
  });

  it("does not mutate its input", () => {
    const photos = [photo("b", "uploaded"), photo("a", "needs_review")];
    sortForReview(photos);
    expect(photos.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("counts only undecided passed and needs_review photos as to review", () => {
    expect(isToReview(photo("a", "passed"))).toBe(true);
    expect(isToReview(photo("a", "needs_review"))).toBe(true);
    expect(isToReview(photo("a", "passed", "approved"))).toBe(false);
    expect(isToReview(photo("a", "failed"))).toBe(false);
  });
});

describe("nextToReview", () => {
  const ordered = [
    photo("a", "needs_review"),
    photo("b", "passed"),
    photo("c", "passed"),
    photo("d", "uploaded"),
    photo("e", "passed", "approved"),
  ];

  it("picks the next photo still to review after the decided one", () => {
    expect(nextToReview(ordered, "b")).toBe("c");
    expect(nextToReview(ordered, "a")).toBe("b");
  });

  it("wraps to the first photo to review and skips the decided one", () => {
    expect(nextToReview(ordered, "c")).toBe("a");
    expect(nextToReview([photo("a", "passed")], "a")).toBeNull();
    expect(nextToReview(ordered, "missing")).toBe("a");
  });
});

describe("statusChip", () => {
  it("labels every status with text", () => {
    const labels = (["uploaded", "processing", "skipped", "rejected", "passed", "needs_review", "failed"] as const).map(
      (status) => statusChip(photo("a", status)).label,
    );
    expect(labels).toEqual(["Uploaded", "Processing", "Skipped", "Rejected (pipeline)", "Passed", "Needs review", "Failed"]);
  });

  it("shows the decision instead of the status", () => {
    expect(statusChip(photo("a", "passed", "approved")).label).toBe("Approved");
    expect(statusChip(photo("a", "needs_review", "rejected")).label).toBe("Rejected by you");
  });
});

describe("isRunAllEligible", () => {
  it.each([
    ["uploaded", true],
    ["failed", true],
    ["processing", false],
    ["passed", false],
    ["needs_review", false],
    ["skipped", false],
    ["rejected", false],
  ] as const)("%s -> %s", (status, eligible) => {
    expect(isRunAllEligible(photo("a", status))).toBe(eligible);
  });

  it("never picks an approved photo", () => {
    expect(isRunAllEligible(photo("a", "failed", "approved"))).toBe(false);
    expect(isRunAllEligible(photo("a", "passed", "approved"))).toBe(false);
  });
});

describe("runQueue", () => {
  it("runs at most RUN_ALL_CONCURRENCY workers at once and processes every item", async () => {
    expect(RUN_ALL_CONCURRENCY).toBe(2);
    const gates = new Map<number, ReturnType<typeof deferred>>();
    const started: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const done = runQueue(
      [1, 2, 3, 4, 5],
      async (item) => {
        started.push(item);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const gate = deferred();
        gates.set(item, gate);
        await gate.promise;
        inFlight--;
      },
      { concurrency: RUN_ALL_CONCURRENCY },
    );

    await tick();
    expect(started).toEqual([1, 2]);
    gates.get(1)!.resolve();
    await tick();
    expect(started).toEqual([1, 2, 3]);
    expect(inFlight).toBe(2);
    for (const item of [2, 3, 4, 5]) {
      await tick();
      gates.get(item)!.resolve();
    }
    await done;
    expect(started).toEqual([1, 2, 3, 4, 5]);
    expect(maxInFlight).toBe(2);
    expect(inFlight).toBe(0);
  });

  it("starts nothing new after shouldStop but waits for in-flight items", async () => {
    let stop = false;
    const gates = new Map<number, ReturnType<typeof deferred>>();
    const started: number[] = [];
    const finished: number[] = [];
    let settled = false;
    const done = runQueue(
      [1, 2, 3, 4, 5],
      async (item) => {
        started.push(item);
        const gate = deferred();
        gates.set(item, gate);
        await gate.promise;
        finished.push(item);
      },
      { concurrency: 2, shouldStop: () => stop },
    ).then(() => (settled = true));

    await tick();
    stop = true;
    gates.get(1)!.resolve();
    await tick();
    expect(settled).toBe(false);
    gates.get(2)!.resolve();
    await done;
    expect(started).toEqual([1, 2]);
    expect(finished).toEqual([1, 2]);
  });

  it("keeps going when a worker rejects", async () => {
    const seen: number[] = [];
    await runQueue(
      [1, 2, 3],
      async (item) => {
        seen.push(item);
        if (item === 1) throw new Error("boom");
      },
      { concurrency: 2 },
    );
    expect(seen).toEqual([1, 2, 3]);
  });

  it("resolves for an empty list", async () => {
    await expect(runQueue([], async () => {}, { concurrency: 2 })).resolves.toBeUndefined();
  });
});

describe("run outcome", () => {
  it("treats a 409 as busy with no error text and other failures as Run failed", () => {
    expect(runOutcome(200)).toBe("ok");
    expect(runOutcome(409)).toBe("busy");
    expect(runOutcome(500)).toBe("failed");
    expect(runOutcome(404)).toBe("failed");
    expect(runErrorMessage(runOutcome(200))).toBeNull();
    expect(runErrorMessage(runOutcome(409))).toBeNull();
    expect(runErrorMessage(runOutcome(500))).toBe("Run failed");
  });
});

describe("costs", () => {
  it("sums photo costs and computes the margin against the price", () => {
    const summary = costSummary([{ costUsd: 0.12 }, { costUsd: 0.08 }], 45);
    expect(summary.totalUsd).toBeCloseTo(0.2);
    expect(summary.priceUsd).toBe(45);
    expect(summary.marginUsd).toBeCloseTo(44.8);
    expect(summary.marginPct).toBeCloseTo(99.556, 2);
    expect(formatCostSummary(summary)).toBe("AI cost $0.20 of $45.00 price, margin $44.80 (99.6%)");
  });

  it("gives a full margin with no photos", () => {
    expect(costSummary([], 45)).toEqual({ totalUsd: 0, priceUsd: 45, marginUsd: 45, marginPct: 100 });
  });

  it("formats money with the given decimals", () => {
    expect(formatUsd(0.083, 3)).toBe("$0.083");
    expect(formatUsd(0, 3)).toBe("$0.000");
    expect(formatUsd(0.2, 2)).toBe("$0.20");
    expect(formatUsd(45, 2)).toBe("$45.00");
    expect(formatUsd(-1.5, 2)).toBe("-$1.50");
  });
});

describe("uploadFileError", () => {
  it("accepts the supported types up to 25 MB", () => {
    for (const name of ["a.jpg", "b.JPEG", "c.png", "d.webp"]) {
      expect(uploadFileError({ name, size: 1000 })).toBeNull();
    }
    expect(uploadFileError({ name: "a.jpg", size: 25 * 1024 * 1024 })).toBeNull();
  });

  it("rejects other extensions and files over 25 MB", () => {
    expect(uploadFileError({ name: "a.gif", size: 10 })).toMatch(/Unsupported/);
    expect(uploadFileError({ name: "jpg", size: 10 })).toMatch(/Unsupported/);
    expect(uploadFileError({ name: "a.jpg", size: 25 * 1024 * 1024 + 1 })).toMatch(/25 MB/);
  });
});

describe("reviewKeyAction", () => {
  const card = { tagName: "ARTICLE", isContentEditable: false };

  it("maps the review keys", () => {
    expect(reviewKeyAction({ key: "j", target: card })).toBe("next");
    expect(reviewKeyAction({ key: "ArrowDown", target: card })).toBe("next");
    expect(reviewKeyAction({ key: "k", target: card })).toBe("prev");
    expect(reviewKeyAction({ key: "ArrowUp", target: card })).toBe("prev");
    expect(reviewKeyAction({ key: "a", target: card })).toBe("approve");
    expect(reviewKeyAction({ key: "r", target: card })).toBe("reject");
    expect(reviewKeyAction({ key: "x", target: card })).toBeNull();
    expect(reviewKeyAction({ key: "A", target: card })).toBeNull();
  });

  it("ignores keys typed into form fields and contenteditable elements", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "textarea"]) {
      expect(reviewKeyAction({ key: "a", target: { tagName } })).toBeNull();
    }
    expect(reviewKeyAction({ key: "r", target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
  });

  it("ignores keys with Ctrl, Meta or Alt held", () => {
    expect(reviewKeyAction({ key: "a", ctrlKey: true, target: card })).toBeNull();
    expect(reviewKeyAction({ key: "r", metaKey: true, target: card })).toBeNull();
    expect(reviewKeyAction({ key: "j", altKey: true, target: card })).toBeNull();
  });
});

describe("exportSelection", () => {
  function exportPhoto(
    id: string,
    status: PhotoStatus,
    verdict: Verdict | null = null,
    { roomType = "bedroom" as RoomType, createdAt = at(0), editedFile = "attempt-0.jpg" as string | null } = {},
  ) {
    return {
      ...photo(id, status, verdict, createdAt),
      roomType,
      bestAttemptIndex: status === "passed" || status === "needs_review" ? 0 : null,
      attempts: [{ index: 0, prompt: "p", editedFile, qa: null, costUsd: 0, createdAt }],
    } satisfies Pick<Photo, "id" | "status" | "decision" | "createdAt" | "roomType" | "attempts" | "bestAttemptIndex">;
  }

  it("puts every status/decision combination in exactly one bucket", () => {
    const selection = exportSelection([
      exportPhoto("approved-passed", "passed", "approved"),
      exportPhoto("approved-needs-review", "needs_review", "approved"),
      exportPhoto("approved-no-file", "passed", "approved", { editedFile: null }),
      exportPhoto("rejected-by-you", "needs_review", "rejected"),
      exportPhoto("awaiting", "passed"),
      exportPhoto("awaiting-2", "needs_review"),
      exportPhoto("skipped", "skipped"),
      exportPhoto("pipeline-rejected", "rejected"),
      exportPhoto("failed", "failed"),
      exportPhoto("uploaded", "uploaded"),
      exportPhoto("processing", "processing"),
    ]);
    expect(selection.included.map((item) => [item.photo.id, item.source])).toEqual([
      ["approved-needs-review", "edited"],
      ["approved-passed", "edited"],
      ["skipped", "original"],
    ]);
    expect(selection.excluded).toEqual({
      awaiting_review: 2,
      rejected_by_you: 1,
      rejected_by_pipeline: 1,
      failed: 1,
      not_run: 1,
      processing: 1,
      no_result: 1,
    });
    expect(selection.enhancedCount).toBe(2);
    expect(selection.originalCount).toBe(1);
    expect(canExport(selection)).toBe(true);
  });

  it("ignores a stale approval on a photo that is no longer reviewable", () => {
    const selection = exportSelection([
      exportPhoto("failed-approved", "failed", "approved"),
      exportPhoto("skipped-rejected", "skipped", "rejected"),
    ]);
    expect(selection.included.map((item) => [item.photo.id, item.source])).toEqual([["skipped-rejected", "original"]]);
    expect(selection.excluded.failed).toBe(1);
    expect(canExport(selection)).toBe(false);
  });

  it("orders by room type enum order, then createdAt, then id", () => {
    const selection = exportSelection([
      exportPhoto("other", "skipped", null, { roomType: "other", createdAt: at(1) }),
      exportPhoto("bed-late", "passed", "approved", { roomType: "bedroom", createdAt: at(5) }),
      exportPhoto("bed-b", "passed", "approved", { roomType: "bedroom", createdAt: at(2) }),
      exportPhoto("bed-a", "skipped", null, { roomType: "bedroom", createdAt: at(2) }),
      exportPhoto("living", "needs_review", "approved", { roomType: "living_room", createdAt: at(9) }),
      exportPhoto("kitchen", "passed", "approved", { roomType: "kitchen", createdAt: at(0) }),
    ]);
    expect(selection.included.map((item) => item.photo.id)).toEqual([
      "living",
      "bed-a",
      "bed-b",
      "bed-late",
      "kitchen",
      "other",
    ]);
  });

  it("does not allow export with only skipped originals or nothing at all", () => {
    expect(canExport(exportSelection([exportPhoto("s", "skipped")]))).toBe(false);
    expect(canExport(exportSelection([]))).toBe(false);
  });
});
