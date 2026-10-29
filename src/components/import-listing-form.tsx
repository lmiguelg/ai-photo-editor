"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
const INPUT = `w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 ${FOCUS}`;

/** Imports a listing's photos from an Airbnb or Booking.com link, then opens the new listing. */
export function ImportListingForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const url = String(form.get("url") ?? "");
    const name = String(form.get("name") ?? "").trim();
    const clientName = String(form.get("clientName") ?? "").trim();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/listings/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, ...(name ? { name } : {}), ...(clientName ? { clientName } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setError(`Could not import: ${typeof body?.error === "string" ? body.error : "request failed"}`);
        setSubmitting(false);
        return;
      }
      const { listing } = (await res.json()) as { listing: { id: string } };
      // Refresh first so going Back restores a home list that includes the new listing.
      router.refresh();
      router.push(`/listings/${listing.id}`);
    } catch {
      setError("Could not import: request failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Import from listing link</h2>
      <div className="space-y-1">
        <label htmlFor="import-url" className="block text-sm font-medium">
          Airbnb or Booking.com link
        </label>
        <input id="import-url" name="url" type="url" required maxLength={2048} className={INPUT} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="import-name" className="block text-sm font-medium">
            Listing name
          </label>
          <input id="import-name" name="name" maxLength={200} className={INPUT} />
        </div>
        <div className="space-y-1">
          <label htmlFor="import-client-name" className="block text-sm font-medium">
            Client name
          </label>
          <input id="import-client-name" name="clientName" maxLength={200} className={INPUT} />
        </div>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className={`rounded-md border border-blue-700 bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
      >
        {submitting ? "Importing…" : "Import photos"}
      </button>
      <p aria-live="polite" className="text-sm text-red-800">
        {error}
      </p>
    </form>
  );
}
