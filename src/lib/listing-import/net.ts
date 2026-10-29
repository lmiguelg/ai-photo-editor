import dns from "node:dns";
import https from "node:https";
import { isIPv4, isIPv6 } from "node:net";
import { IMPORT_REQUEST_TIMEOUT_MS, MAX_IMPORT_REDIRECTS } from "./limits";
import { isAllowedUrl } from "./sites";

// The only module that opens network connections for link imports. Every hop is
// checked against the host allowlist, and every resolved address must be public.

export interface SafeGetOptions {
  maxBytes: number;
  accept: string;
  isAllowedHost: (hostname: string) => boolean;
}

export interface SafeResponse {
  contentType: string;
  body: Buffer;
}

/** `safeGet`'s shape; the import code takes one so tests and mock mode never fetch. */
export type Transport = (url: URL, options: SafeGetOptions) => Promise<SafeResponse>;

/** One raw response, body not yet read. `abort` drops the connection. */
export interface HopResponse {
  status: number;
  location: string | null;
  contentType: string;
  contentLength: number | null;
  body: AsyncIterable<Uint8Array>;
  abort(): void;
}

/** Sends one GET without following redirects. */
export type HopRequest = (url: URL, headers: Record<string, string>) => Promise<HopResponse>;

export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchError";
  }
}

function ipv4Octets(ip: string): number[] {
  return ip.split(".").map(Number);
}

function isPublicIPv4(ip: string): boolean {
  const [a, b, c] = ipv4Octets(ip);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

/** The eight 16-bit groups of a valid IPv6 address, with any dotted IPv4 tail expanded. */
function ipv6Groups(ip: string): number[] {
  let text = ip.toLowerCase();
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (tail) {
    const [a, b, c, d] = ipv4Octets(tail);
    text = `${text.slice(0, -tail.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split("::");
  const parse = (part: string | undefined) => (part ? part.split(":").map((group) => parseInt(group, 16)) : []);
  const left = parse(head);
  const right = parse(rest);
  const fill = rest === undefined ? [] : Array<number>(8 - left.length - right.length).fill(0);
  return [...left, ...fill, ...right];
}

/** False for private, loopback, link-local, multicast and other non-public addresses. */
export function isPublicAddress(ip: string): boolean {
  const address = ip.replace(/%.*$/u, "");
  if (isIPv4(address)) return isPublicIPv4(address);
  if (!isIPv6(address)) return false;

  const groups = ipv6Groups(address);
  const first = groups[0];
  if (groups.every((group) => group === 0)) return false; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return false; // ::1
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const v4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
    return isPublicIPv4(v4);
  }
  return true;
}

export type Resolver = (hostname: string) => Promise<dns.LookupAddress[]>;

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

export type LookupFunction = (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => void;

const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * A `lookup` for `https.request`: resolves the host and fails the connection when any
 * address is not public. It runs at connect time, so DNS rebinding can't slip past it.
 */
export function publicLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || !addresses.every((entry) => isPublicAddress(entry.address))) {
          const err: NodeJS.ErrnoException = new FetchError("Blocked address");
          err.code = "EBLOCKED";
          callback(err, "", 0);
          return;
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 0),
    );
  };
}

/** The real transport: one https GET, no agent reuse, no cookies, a 15 s timeout. */
const httpsHop: HopRequest = (url, headers) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers,
        agent: false,
        lookup: publicLookup(),
        signal: AbortSignal.timeout(IMPORT_REQUEST_TIMEOUT_MS),
      },
      (response) => {
        const length = Number(response.headers["content-length"]);
        resolve({
          status: response.statusCode ?? 0,
          location: response.headers.location ?? null,
          contentType: response.headers["content-type"] ?? "",
          contentLength: Number.isFinite(length) ? length : null,
          body: response,
          abort: () => request.destroy(),
        });
      },
    );
    request.on("error", reject);
    request.end();
  });

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function readCapped(response: HopResponse, maxBytes: number): Promise<Buffer> {
  if (response.contentLength !== null && response.contentLength > maxBytes) {
    response.abort();
    throw new FetchError("Response too large");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      response.abort();
      throw new FetchError("Response too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * GETs `url`, following at most 3 redirects by hand. The URL and every hop must pass
 * `isAllowedUrl`; the body is aborted once it passes `maxBytes`; non-2xx fails.
 */
export async function safeGet(url: URL, options: SafeGetOptions, request: HopRequest = httpsHop): Promise<SafeResponse> {
  let current = url;
  for (let redirects = 0; ; redirects++) {
    if (!isAllowedUrl(current, options.isAllowedHost)) throw new FetchError("Blocked URL");
    const response = await request(current, { accept: options.accept, "user-agent": "Mozilla/5.0" });

    if (REDIRECT_STATUSES.has(response.status)) {
      response.abort();
      if (redirects >= MAX_IMPORT_REDIRECTS) throw new FetchError("Too many redirects");
      if (!response.location || !URL.canParse(response.location, current)) throw new FetchError("Bad redirect");
      current = new URL(response.location, current);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      response.abort();
      throw new FetchError(`HTTP ${response.status}`);
    }
    return { contentType: response.contentType, body: await readCapped(response, options.maxBytes) };
  }
}
