import type { ImportSite } from "./sites";

// Pure scraping of listing photo URLs from a page's HTML. Best effort: the patterns
// match where the sites serve listing photos and are only verified on the fixture.

const URL_PATTERNS: Record<ImportSite, RegExp> = {
  airbnb: /https:\/\/a0\.muscache\.com\/im\/pictures\/[^\s"'`<>\\()]+/gu,
  booking: /https:\/\/cf\.bstatic\.com\/xdata\/images\/hotel\/[^\s"'`<>\\()]+/gu,
};

/** The URL at the size we fetch; null when it is not a listing photo. */
function normalise(url: URL, site: ImportSite): URL | null {
  if (site === "airbnb") {
    if (url.pathname.includes("/user/")) return null;
    url.search = "?im_w=1440";
  } else {
    url.pathname = url.pathname.replace(/\/(?:max\d+x\d+|square\d+)\//u, "/max1280x900/");
  }
  return url;
}

/** Listing photo URLs on the site's image CDN in page order, de-duplicated ignoring the query. */
export function extractImageUrls(html: string, site: ImportSite): string[] {
  const text = html.replace(/\\u002f/giu, "/").replaceAll("\\/", "/").replaceAll("&amp;", "&");
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const [match] of text.matchAll(URL_PATTERNS[site])) {
    if (!URL.canParse(match)) continue;
    const url = normalise(new URL(match), site);
    if (!url) continue;
    const key = `${url.origin}${url.pathname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url.href);
  }
  return urls;
}
