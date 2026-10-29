"use client";

import {
  bestAttempt,
  formatUsd,
  isReviewable,
  photoImageUrl,
  ROOM_TYPE_LABELS,
  statusChip,
} from "@/lib/review";
import { config } from "@/pipeline/config";
import type { Photo } from "@/pipeline/schemas";
import { BeforeAfterSlider } from "./before-after-slider";
import { StatusChip } from "./status-chip";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
const BUTTON = `rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

export interface PhotoCardProps {
  photo: Photo;
  /** This tab has a run request in flight for the photo. */
  running: boolean;
  note: string;
  /** A message from the last action on this card, e.g. "Run failed". */
  message: string | null;
  cardRef?: (element: HTMLElement | null) => void;
  onNoteChange: (note: string) => void;
  onRun: () => void;
  onDecide: (verdict: "approved" | "rejected") => void;
  onReset: () => void;
}

export function PhotoCard({
  photo,
  running,
  note,
  message,
  cardRef,
  onNoteChange,
  onRun,
  onDecide,
  onReset,
}: PhotoCardProps) {
  const name = photo.originalName;
  const attempt = bestAttempt(photo);
  const processing = photo.status === "processing";
  const runBlocked = processing || running;
  const runLabel = photo.status === "uploaded" ? "Run" : "Re-run";
  const noteId = `note-${photo.id}`;
  const runReasonId = `run-reason-${photo.id}`;

  return (
    <article
      ref={cardRef}
      tabIndex={0}
      data-photo-id={photo.id}
      aria-label={`${name}, ${statusChip(photo).label}`}
      className={`space-y-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm ${FOCUS}`}
    >
      {attempt?.editedFile ? (
        <BeforeAfterSlider
          originalSrc={photoImageUrl(photo, "original")}
          editedSrc={photoImageUrl(photo, "edited")}
          name={name}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- served by our own image route
        <img
          src={photoImageUrl(photo, "original")}
          alt={`Original photo ${name}`}
          className="block h-auto w-full rounded-md bg-neutral-200"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto break-all font-medium">{name}</h3>
        <StatusChip photo={photo} />
      </div>
      <p className="text-sm text-neutral-700">
        {ROOM_TYPE_LABELS[photo.roomType]} · Cost {formatUsd(photo.costUsd, 3)}
      </p>

      {attempt?.qa && (
        <div className="space-y-1 text-sm">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(attempt.qa.scores).map(([rubric, score]) => {
              const low = score < config.qa.minScore;
              return (
                <li key={rubric} className={low ? "font-semibold text-red-800" : undefined}>
                  {rubric}: {score}
                  {low && <span> (below {config.qa.minScore})</span>}
                </li>
              );
            })}
          </ul>
          <p className="text-neutral-700">QA: {attempt.qa.reason}</p>
        </div>
      )}

      {photo.error !== null && <p className="text-sm text-red-800">Error: {photo.error}</p>}
      {message !== null && <p className="text-sm font-medium text-red-800">{message}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={runBlocked}
          aria-describedby={runBlocked ? runReasonId : undefined}
          className={`${BUTTON} border-neutral-300 bg-white hover:bg-neutral-100`}
        >
          {runLabel}
        </button>
        {runBlocked && (
          <span id={runReasonId} className="text-xs text-neutral-600">
            {running ? "Running in this tab" : "Photo is processing"}
          </span>
        )}
        {processing && !running && (
          <button
            type="button"
            onClick={onReset}
            className={`${BUTTON} border-red-300 bg-white text-red-800 hover:bg-red-50`}
          >
            Reset stuck photo
          </button>
        )}
      </div>

      {photo.decision && isReviewable(photo) && (
        <p className="text-sm">
          Your decision: {photo.decision.verdict === "approved" ? "Approved" : "Rejected"}
          {photo.decision.note && <> · Note: {photo.decision.note}</>}
        </p>
      )}

      {isReviewable(photo) && (
        <div className="space-y-2">
          <label htmlFor={noteId} className="block text-sm font-medium">
            Review note
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={2000}
            rows={2}
            onChange={(event) => onNoteChange(event.target.value)}
            className={`w-full rounded-md border border-neutral-300 p-2 text-sm ${FOCUS}`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onDecide("approved")}
              disabled={running}
              className={`${BUTTON} border-green-700 bg-green-700 text-white hover:bg-green-800`}
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onDecide("rejected")}
              disabled={running}
              className={`${BUTTON} border-red-700 bg-white text-red-800 hover:bg-red-50`}
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
