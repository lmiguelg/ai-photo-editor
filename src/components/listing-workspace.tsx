"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  costSummary,
  formatCostSummary,
  isReviewable,
  isRunAllEligible,
  isToReview,
  nextToReview,
  reviewKeyAction,
  RUN_ALL_CONCURRENCY,
  runErrorMessage,
  runOutcome,
  runQueue,
  sortForReview,
} from "@/lib/review";
import { config } from "@/pipeline/config";
import type { Listing, Photo } from "@/pipeline/schemas";
import { ExportPanel } from "./export-panel";
import { PhotoCard } from "./photo-card";
import { UploadPanel } from "./upload-panel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
const BUTTON = `rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

const RESET_CONFIRM =
  "Reset this stuck photo? Only use this after a crash or restart left it in Processing. " +
  "A photo that is really running will be refused.";

interface RunAllProgress {
  total: number;
  started: number;
  done: number;
}

export function ListingWorkspace({ initialListing }: { initialListing: Listing }) {
  const listingId = initialListing.id;
  const [listing, setListing] = useState(initialListing);
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, string | null>>({});
  const [runAll, setRunAll] = useState<RunAllProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const stopRequested = useRef(false);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);

  // While this tab runs a photo, show it as processing.
  const photos = sortForReview(
    listing.photos.map((photo) => (running.has(photo.id) ? { ...photo, status: "processing" as const } : photo)),
  );
  const summary = costSummary(listing.photos, config.pricing.listingPriceUsd);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    cardRefs.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  const photoUrl = (photoId: string) => `/api/listings/${listingId}/photos/${photoId}`;
  const setMessage = (photoId: string, message: string | null) =>
    setMessages((current) => ({ ...current, [photoId]: message }));

  function replacePhoto(photo: Photo) {
    setListing((current) => ({
      ...current,
      photos: current.photos.map((existing) => (existing.id === photo.id ? photo : existing)),
    }));
  }

  /** Reloads the listing, keeping any photo we already hold a newer copy of. */
  async function refresh() {
    const res = await fetch(`/api/listings/${listingId}`);
    if (!res.ok) return;
    const fresh = (await res.json()) as Listing;
    setListing((current) => {
      const local = new Map(current.photos.map((photo) => [photo.id, photo]));
      return {
        ...fresh,
        photos: fresh.photos.map((photo) => {
          const held = local.get(photo.id);
          return held && held.updatedAt > photo.updatedAt ? held : photo;
        }),
      };
    });
  }

  async function runPhoto(photoId: string) {
    setRunning((current) => new Set(current).add(photoId));
    setMessage(photoId, null);
    try {
      const res = await fetch(`${photoUrl(photoId)}/run`, { method: "POST" });
      const outcome = runOutcome(res.status);
      if (outcome === "ok") replacePhoto((await res.json()) as Photo);
      else await refresh();
      setMessage(photoId, runErrorMessage(outcome));
    } catch {
      setMessage(photoId, runErrorMessage("failed"));
    } finally {
      setRunning((current) => {
        const next = new Set(current);
        next.delete(photoId);
        return next;
      });
    }
  }

  async function startRunAll() {
    const queue = photos.filter((photo) => isRunAllEligible(photo) && !running.has(photo.id));
    if (queue.length === 0) {
      setAnnouncement("No photos to run");
      return;
    }
    stopRequested.current = false;
    setStopping(false);
    setRunAll({ total: queue.length, started: 0, done: 0 });
    await runQueue(
      queue,
      async (photo) => {
        setRunAll((current) => current && { ...current, started: current.started + 1 });
        await runPhoto(photo.id);
        setRunAll((current) => current && { ...current, done: current.done + 1 });
      },
      { concurrency: RUN_ALL_CONCURRENCY, shouldStop: () => stopRequested.current },
    );
    setAnnouncement(stopRequested.current ? "Run all stopped" : "Run all finished");
    setRunAll(null);
    setStopping(false);
  }

  function stopRunAll() {
    stopRequested.current = true;
    setStopping(true);
  }

  async function decide(photoId: string, verdict: "approved" | "rejected") {
    setMessage(photoId, null);
    try {
      const res = await fetch(`${photoUrl(photoId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict, note: notes[photoId] ?? "" }),
      });
      if (!res.ok) {
        setMessage(photoId, res.status === 409 ? "This photo has no result to review." : "Decision failed");
        if (res.status === 409) await refresh();
        return;
      }
      const updated = (await res.json()) as Photo;
      pendingFocus.current = nextToReview(photos, photoId) ?? updated.id;
      replacePhoto(updated);
      setNotes((current) => ({ ...current, [photoId]: "" }));
      setAnnouncement(`${updated.originalName}: ${verdict === "approved" ? "Approved" : "Rejected by you"}`);
    } catch {
      setMessage(photoId, "Decision failed");
    }
  }

  async function reset(photoId: string) {
    if (!window.confirm(RESET_CONFIRM)) return;
    setMessage(photoId, null);
    try {
      const res = await fetch(`${photoUrl(photoId)}/reset`, { method: "POST" });
      if (res.ok) {
        replacePhoto((await res.json()) as Photo);
        return;
      }
      setMessage(photoId, res.status === 409 ? "This photo is still running; not reset." : "Reset failed");
      await refresh();
    } catch {
      setMessage(photoId, "Reset failed");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const action = reviewKeyAction({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      target,
    });
    if (action === null) return;
    const card = target.closest<HTMLElement>("[data-photo-id]");
    const index = photos.findIndex((photo) => photo.id === card?.dataset.photoId);
    if (index < 0) return;
    const photo = photos[index];

    if (action === "next" || action === "prev") {
      event.preventDefault();
      const neighbour = photos[action === "next" ? index + 1 : index - 1];
      if (neighbour) cardRefs.current.get(neighbour.id)?.focus();
      return;
    }
    if (!isReviewable(photo) || running.has(photo.id)) return;
    event.preventDefault();
    void decide(photo.id, action === "approve" ? "approved" : "rejected");
  }

  const toReview = listing.photos.filter(isToReview).length;
  let progress = announcement;
  if (runAll) {
    const inFlight = runAll.started - runAll.done;
    progress = stopping
      ? `Stopping… ${inFlight} in progress`
      : `Running ${runAll.started} of ${runAll.total}, ${inFlight} in progress`;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link href="/" className={`rounded text-sm text-blue-800 underline hover:text-blue-950 ${FOCUS}`}>
          ← All listings
        </Link>
        <h1 className="break-words text-3xl font-bold tracking-tight">{listing.name}</h1>
        {listing.clientName && <p className="text-neutral-700">Client: {listing.clientName}</p>}
        <p className="font-medium">{formatCostSummary(summary)}</p>
        <p className="text-sm text-neutral-700">
          {listing.photos.length} {listing.photos.length === 1 ? "photo" : "photos"}, {toReview} to review
        </p>
      </header>

      <ExportPanel listing={listing} />

      <UploadPanel
        listingId={listingId}
        onUploaded={(photo) => setListing((current) => ({ ...current, photos: [...current.photos, photo] }))}
      />

      <section aria-labelledby="photos-heading" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="photos-heading" className="mr-auto text-lg font-semibold">
            Photos
          </h2>
          <button
            type="button"
            onClick={() => void startRunAll()}
            disabled={runAll !== null}
            className={`${BUTTON} border-blue-700 bg-blue-700 text-white hover:bg-blue-800`}
          >
            Run all
          </button>
          {runAll && (
            <button
              type="button"
              onClick={stopRunAll}
              disabled={stopping}
              className={`${BUTTON} border-neutral-300 bg-white hover:bg-neutral-100`}
            >
              Stop
            </button>
          )}
        </div>
        <p aria-live="polite" className="min-h-5 text-sm text-neutral-700">
          {progress}
        </p>
        <p className="text-xs text-neutral-600">
          Keys on a focused card: j / ↓ next, k / ↑ previous, a approve, r reject (not while typing).
        </p>

        {photos.length === 0 ? (
          <p className="text-neutral-600">No photos yet. Upload some above.</p>
        ) : (
          <div onKeyDown={onKeyDown} className="grid gap-4 sm:grid-cols-2">
            {photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                running={running.has(photo.id)}
                note={notes[photo.id] ?? ""}
                message={messages[photo.id] ?? null}
                cardRef={(element) => {
                  if (element) cardRefs.current.set(photo.id, element);
                  else cardRefs.current.delete(photo.id);
                }}
                onNoteChange={(note) => setNotes((current) => ({ ...current, [photo.id]: note }))}
                onRun={() => void runPhoto(photo.id)}
                onDecide={(verdict) => void decide(photo.id, verdict)}
                onReset={() => void reset(photo.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
