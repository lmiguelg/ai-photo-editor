"use client";

import { useEffect, useState } from "react";
import { canExport, EXCLUDED_REASONS, exportSelection, type ExcludedReason } from "@/lib/review";
import type { Listing } from "@/pipeline/schemas";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
const BUTTON = `rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const SECONDARY = `${BUTTON} border-neutral-300 bg-white hover:bg-neutral-100`;

const EXCLUDED_LABELS: Record<ExcludedReason, string> = {
  awaiting_review: "awaiting review",
  rejected_by_you: "rejected by you",
  rejected_by_pipeline: "rejected by the pipeline",
  failed: "failed",
  not_run: "not run yet",
  processing: "processing",
  no_result: "no result",
};

const DOWNLOAD_ERRORS: Record<number, string> = {
  409: "Nothing approved to export",
  413: "Export is too large to build",
};

const HINT_ID = "export-hint";

interface Summary {
  html: string;
  text: string;
}

function fileNameFrom(disposition: string | null): string {
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? "photos.zip";
}

/** Export for client: counts of what goes in the zip, the zip download and the email summary. */
export function ExportPanel({ listing }: { listing: Listing }) {
  const listingId = listing.id;
  const selection = exportSelection(listing.photos);
  const ready = canExport(selection);
  const selectionKey = selection.included.map((item) => `${item.photo.id}:${item.source}`).join(",");
  const [downloading, setDownloading] = useState(false);
  const [summaryRequest, setSummaryRequest] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState("");

  // While the summary is open, refetch it whenever the exportable selection changes.
  useEffect(() => {
    if (summaryRequest === 0 || !ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/listings/${listingId}/export/summary`);
        if (cancelled) return;
        if (!res.ok) {
          setSummary(null);
          setStatus(res.status === 409 ? "Nothing approved to export" : "Email summary failed");
          return;
        }
        const body = (await res.json()) as Summary;
        if (!cancelled) setSummary(body);
      } catch {
        if (!cancelled) setStatus("Email summary failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId, ready, selectionKey, summaryRequest]);

  async function download() {
    setDownloading(true);
    setStatus("");
    try {
      const res = await fetch(`/api/listings/${listingId}/export`);
      if (!res.ok) {
        setStatus(DOWNLOAD_ERRORS[res.status] ?? "Export failed");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFrom(res.headers.get("content-disposition"));
      document.body.append(link);
      link.click();
      link.remove();
      // Revoke after the browser has picked the download up.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setStatus("Export failed");
    } finally {
      setDownloading(false);
    }
  }

  async function copy(write: () => Promise<void>) {
    try {
      await write();
      setStatus("Copied");
    } catch {
      setStatus("Copy failed. Select the text and copy it manually.");
    }
  }

  function copyForEmail(current: Summary) {
    return copy(() =>
      navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([current.html], { type: "text/html" }),
          "text/plain": new Blob([current.text], { type: "text/plain" }),
        }),
      ]),
    );
  }

  const total = selection.included.length;
  const { enhancedCount, originalCount } = selection;
  const leftOut = EXCLUDED_REASONS.filter((reason) => selection.excluded[reason] > 0).map(
    (reason) => `${selection.excluded[reason]} ${EXCLUDED_LABELS[reason]}`,
  );
  const describedBy = ready ? undefined : HINT_ID;

  return (
    <section aria-labelledby="export-heading" className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <h2 id="export-heading" className="text-lg font-semibold">
        Export for client
      </h2>
      <p className="text-sm">
        Ready to export: {total} {total === 1 ? "photo" : "photos"} ({enhancedCount} enhanced, {originalCount}{" "}
        {originalCount === 1 ? "original" : "originals"})
      </p>
      {leftOut.length > 0 && <p className="text-sm text-neutral-700">Left out: {leftOut.join(", ")}</p>}
      {!ready && (
        <p id={HINT_ID} className="text-sm text-neutral-700">
          Approve at least one enhanced photo to export. Photos the pipeline skipped as already good are included
          automatically.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void download()}
          disabled={!ready || downloading}
          aria-describedby={describedBy}
          className={`${BUTTON} border-blue-700 bg-blue-700 text-white hover:bg-blue-800`}
        >
          {downloading ? "Preparing zip…" : "Download zip"}
        </button>
        <button
          type="button"
          onClick={() => setSummaryRequest((count) => count + 1)}
          disabled={!ready}
          aria-describedby={describedBy}
          className={SECONDARY}
        >
          Email summary
        </button>
      </div>
      <p aria-live="polite" className="min-h-5 text-sm text-neutral-700">
        {status}
      </p>
      {ready && summary && (
        <div className="space-y-2">
          <label htmlFor="export-email-text" className="block text-sm font-medium">
            Email text
          </label>
          <textarea
            id="export-email-text"
            readOnly
            value={summary.text}
            rows={14}
            className={`w-full rounded-md border border-neutral-300 bg-neutral-50 p-2 text-sm ${FOCUS}`}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copyForEmail(summary)} className={SECONDARY}>
              Copy for email
            </button>
            <button
              type="button"
              onClick={() => void copy(() => navigator.clipboard.writeText(summary.text))}
              className={SECONDARY}
            >
              Copy plain text
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
