import { notFound } from "next/navigation";
import { ListingWorkspace } from "@/components/listing-workspace";
import { getListing } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ListingPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  const listing = await getListing(listingId);
  if (!listing) notFound();
  return <ListingWorkspace initialListing={listing} />;
}
