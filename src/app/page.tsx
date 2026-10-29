import { HomeView } from "@/components/home-view";
import { listListings } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <HomeView listings={await listListings()} />;
}
