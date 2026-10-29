import { isIP } from "node:net";

// The one allowlist for link imports: listing page hosts and each site's image CDN.
// Hosts match exactly; there is no suffix or substring matching.

export type ImportSite = "airbnb" | "booking";

export const SITE_LABELS: Record<ImportSite, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
};

const AIRBNB_TLDS = ["com", "pt", "es", "fr", "de", "it", "co.uk", "ie", "nl", "ca", "com.br", "com.au"];

const PAGE_HOSTS: ReadonlyMap<string, ImportSite> = new Map([
  ...AIRBNB_TLDS.flatMap((tld) => [`airbnb.${tld}`, `www.airbnb.${tld}`].map((host) => [host, "airbnb"] as const)),
  ["booking.com", "booking"],
  ["www.booking.com", "booking"],
]);

/** The only host each site's listing photos are fetched from. */
export const IMAGE_HOSTS: Record<ImportSite, string> = {
  airbnb: "a0.muscache.com",
  booking: "cf.bstatic.com",
};

/** The site a listing page host belongs to; null for any host off the allowlist. */
export function pageSite(hostname: string): ImportSite | null {
  return PAGE_HOSTS.get(hostname) ?? null;
}

export function isPageHost(hostname: string): boolean {
  return PAGE_HOSTS.has(hostname);
}

export function isImageHost(site: ImportSite): (hostname: string) => boolean {
  return (hostname) => hostname === IMAGE_HOSTS[site];
}

/**
 * The checks every import URL and every redirect hop must pass: https, no
 * credentials, the default port, a host name (not an IP literal) that `isAllowedHost`
 * accepts.
 */
export function isAllowedUrl(url: URL, isAllowedHost: (hostname: string) => boolean): boolean {
  const hostname = url.hostname;
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    isIP(hostname.replace(/^\[(.*)\]$/u, "$1")) === 0 &&
    hostname === hostname.toLowerCase() &&
    isAllowedHost(hostname)
  );
}
