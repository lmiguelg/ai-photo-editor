import Link from "next/link";
import { costSummary, formatUsd, isToReview } from "@/lib/review";
import { config } from "@/pipeline/config";
import type { Listing } from "@/pipeline/schemas";
import { CreateListingForm } from "./create-listing-form";
import { ImportListingForm } from "./import-listing-form";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";

/** The home page: heading, create form and the listings, newest first as given. */
export function HomeView({ listings }: { listings: Listing[] }) {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">AI Photo Editor</h1>
        <p className="text-neutral-600">
          Improve Airbnb and Vrbo listing photos with AI, review the results locally,
          and export them to send to clients.
        </p>
      </section>

      <CreateListingForm />

      <ImportListingForm />

      <section aria-labelledby="listings-heading" className="space-y-3">
        <h2 id="listings-heading" className="text-lg font-semibold">
          Listings
        </h2>
        {listings.length === 0 ? (
          <p className="text-neutral-600">No listings yet</p>
        ) : (
          <ul className="space-y-2">
            {listings.map((listing) => {
              const toReview = listing.photos.filter(isToReview).length;
              const { totalUsd } = costSummary(listing.photos, config.pricing.listingPriceUsd);
              return (
                <li key={listing.id}>
                  <Link
                    href={`/listings/${listing.id}`}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-neutral-200 bg-white p-4 hover:bg-neutral-100 ${FOCUS}`}
                  >
                    <span className="mr-auto">
                      <span className="block break-words font-medium">{listing.name}</span>
                      {listing.clientName && (
                        <span className="block text-sm text-neutral-600">Client: {listing.clientName}</span>
                      )}
                    </span>
                    <span className="text-sm text-neutral-700">
                      {listing.photos.length} {listing.photos.length === 1 ? "photo" : "photos"}
                    </span>
                    {toReview > 0 && (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                        {toReview} to review
                      </span>
                    )}
                    <span className="text-sm text-neutral-700">AI cost {formatUsd(totalUsd, 2)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
