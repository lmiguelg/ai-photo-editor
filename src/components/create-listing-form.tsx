"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
const INPUT = `w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 ${FOCUS}`;

/** Creates a listing through the API, then opens its page. */
export function CreateListingForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const clientName = String(form.get("clientName") ?? "").trim();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(clientName ? { name, clientName } : { name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setError(`Could not create the listing: ${typeof body?.error === "string" ? body.error : "request failed"}`);
        setSubmitting(false);
        return;
      }
      const listing = (await res.json()) as { id: string };
      router.push(`/listings/${listing.id}`);
    } catch {
      setError("Could not create the listing: request failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-lg font-semibold">New listing</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="listing-name" className="block text-sm font-medium">
            Listing name
          </label>
          <input id="listing-name" name="name" required maxLength={200} className={INPUT} />
        </div>
        <div className="space-y-1">
          <label htmlFor="client-name" className="block text-sm font-medium">
            Client name (optional)
          </label>
          <input id="client-name" name="clientName" maxLength={200} className={INPUT} />
        </div>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className={`rounded-md border border-blue-700 bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
      >
        {submitting ? "Creating…" : "Create listing"}
      </button>
      <p aria-live="polite" className="text-sm text-red-800">
        {error}
      </p>
    </form>
  );
}
