import type dns from "node:dns";
import { describe, expect, it } from "vitest";
import { isPublicAddress, publicLookup, safeGet, type HopRequest, type HopResponse, type SafeGetOptions } from "./net";
import { isPageHost } from "./sites";

describe("isPublicAddress", () => {
  it("blocks every listed IPv4 range", () => {
    for (const ip of [
      "0.0.0.0",
      "0.255.1.2",
      "10.0.0.1",
      "10.255.255.255",
      "100.64.0.1",
      "100.127.255.255",
      "127.0.0.1",
      "127.8.8.8",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.8",
      "192.168.1.1",
      "198.18.0.1",
      "198.19.255.255",
      "224.0.0.1",
      "239.255.255.255",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("allows public IPv4 addresses next to the blocked ranges", () => {
    for (const ip of [
      "1.1.1.1",
      "8.8.8.8",
      "11.0.0.1",
      "100.63.255.255",
      "100.128.0.1",
      "126.255.255.255",
      "128.0.0.1",
      "169.253.0.1",
      "172.15.255.255",
      "172.32.0.1",
      "192.0.1.1",
      "192.167.1.1",
      "198.17.0.1",
      "198.20.0.1",
      "223.255.255.255",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("blocks the listed IPv6 ranges and IPv4-mapped forms of blocked IPv4", () => {
    for (const ip of [
      "::",
      "0:0:0:0:0:0:0:0",
      "::1",
      "0:0:0:0:0:0:0:1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "fe80::1%eth0",
      "febf::1",
      "ff02::1",
      "ff00::",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "::ffff:192.168.0.1",
      "::FFFF:169.254.169.254",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("allows public IPv6 addresses and IPv4-mapped public IPv4", () => {
    for (const ip of ["2606:4700:4700::1111", "2a00:1450:4003:80e::200e", "fec0::1", "fb00::1", "::2", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("is false for anything that is not an IP address", () => {
    for (const value of ["", "localhost", "www.airbnb.com", "1.2.3", "::ffff:999.1.1.1"]) {
      expect(isPublicAddress(value), value).toBe(false);
    }
  });
});

describe("publicLookup", () => {
  const lookup = (addresses: dns.LookupAddress[], options: dns.LookupOptions = {}) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) => {
      publicLookup(async () => addresses)("www.airbnb.com", options, (err, address, family) =>
        resolve({ err, address, family }),
      );
    });

  it("fails the connection when the host resolves to 127.0.0.1", async () => {
    const { err } = await lookup([{ address: "127.0.0.1", family: 4 }]);
    expect(err).toBeInstanceOf(Error);
    expect(err?.code).toBe("EBLOCKED");
  });

  it("fails when any one of several addresses is not public", async () => {
    const { err } = await lookup(
      [
        { address: "93.184.216.34", family: 4 },
        { address: "::1", family: 6 },
      ],
      { all: true },
    );
    expect(err?.code).toBe("EBLOCKED");
  });

  it("passes public addresses through in the form the caller asked for", async () => {
    const addresses = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1", family: 6 },
    ];
    const one = await lookup(addresses);
    expect(one).toEqual({ err: null, address: "93.184.216.34", family: 4 });
    const all = await lookup(addresses, { all: true });
    expect(all.err).toBeNull();
    expect(all.address).toEqual(addresses);
  });

  it("passes resolver errors through", async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      publicLookup(async () => {
        throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
      })("nowhere.test", {}, (e) => resolve(e));
    });
    expect(err?.code).toBe("ENOTFOUND");
  });
});

describe("safeGet", () => {
  const options: SafeGetOptions = { maxBytes: 1000, accept: "text/html", isAllowedHost: isPageHost };

  function response(status: number, init: Partial<HopResponse> & { chunks?: Uint8Array[] } = {}) {
    const state = { aborted: false, read: 0 };
    const chunks = init.chunks ?? [];
    const hop: HopResponse = {
      status,
      location: init.location ?? null,
      contentType: init.contentType ?? "text/html",
      contentLength: init.contentLength ?? null,
      body: (async function* () {
        for (const chunk of chunks) {
          if (state.aborted) return;
          state.read += 1;
          yield chunk;
        }
      })(),
      abort: () => {
        state.aborted = true;
      },
    };
    return { hop, state };
  }

  /** A request function that replies from `script` in order and records the URLs asked for. */
  function scripted(...script: HopResponse[]) {
    const urls: string[] = [];
    const headers: Record<string, string>[] = [];
    const request: HopRequest = async (url, sent) => {
      urls.push(url.href);
      headers.push(sent);
      const next = script.shift();
      if (!next) throw new Error("unexpected request");
      return next;
    };
    return { request, urls, headers };
  }

  const start = new URL("https://www.airbnb.com/rooms/1");

  it("returns the body of a 2xx response and sends no cookies or credentials", async () => {
    const { request, headers } = scripted(response(200, { chunks: [Buffer.from("<html>")], contentType: "text/html" }).hop);
    const result = await safeGet(start, options, request);
    expect(result.body.toString()).toBe("<html>");
    expect(result.contentType).toBe("text/html");
    const sent = Object.keys(headers[0]).map((key) => key.toLowerCase());
    expect(sent).not.toContain("cookie");
    expect(sent).not.toContain("authorization");
    expect(headers[0].accept).toBe("text/html");
  });

  it("follows up to 3 allowlisted redirects, resolving relative locations", async () => {
    const { request, urls } = scripted(
      response(301, { location: "https://airbnb.com/rooms/1" }).hop,
      response(302, { location: "/rooms/2" }).hop,
      response(307, { location: "https://www.airbnb.pt/rooms/3" }).hop,
      response(200, { chunks: [Buffer.from("ok")] }).hop,
    );
    expect((await safeGet(start, options, request)).body.toString()).toBe("ok");
    expect(urls).toEqual([
      "https://www.airbnb.com/rooms/1",
      "https://airbnb.com/rooms/1",
      "https://airbnb.com/rooms/2",
      "https://www.airbnb.pt/rooms/3",
    ]);
  });

  it("rejects more than 3 redirects", async () => {
    const { request, urls } = scripted(
      response(301, { location: "/a" }).hop,
      response(301, { location: "/b" }).hop,
      response(301, { location: "/c" }).hop,
      response(301, { location: "/d" }).hop,
      response(200, { chunks: [Buffer.from("ok")] }).hop,
    );
    await expect(safeGet(start, options, request)).rejects.toThrow("Too many redirects");
    expect(urls).toHaveLength(4);
  });

  it("rejects a redirect hop off the allowlist without requesting it", async () => {
    for (const location of [
      "https://evil.test/",
      "https://airbnb.com.evil.test/",
      "http://www.airbnb.com/rooms/1",
      "https://www.airbnb.com:8443/rooms/1",
      "https://user:pw@www.airbnb.com/",
      "https://127.0.0.1/",
      "https://[::1]/",
    ]) {
      const { request, urls } = scripted(response(302, { location }).hop);
      await expect(safeGet(start, options, request), location).rejects.toThrow("Blocked URL");
      expect(urls).toEqual(["https://www.airbnb.com/rooms/1"]);
    }
  });

  it("rejects an initial URL off the allowlist without any request", async () => {
    const { request, urls } = scripted();
    await expect(safeGet(new URL("https://example.com/"), options, request)).rejects.toThrow("Blocked URL");
    expect(urls).toEqual([]);
  });

  it("rejects a redirect without a location and non-2xx final responses", async () => {
    await expect(safeGet(start, options, scripted(response(302).hop).request)).rejects.toThrow("Bad redirect");
    for (const status of [304, 403, 404, 500]) {
      const { hop, state } = response(status, { chunks: [Buffer.from("x")] });
      await expect(safeGet(start, options, scripted(hop).request)).rejects.toThrow(`HTTP ${status}`);
      expect(state.aborted).toBe(true);
    }
  });

  it("aborts the body as soon as it passes maxBytes, without reading the rest", async () => {
    const chunk = Buffer.alloc(400);
    const { hop, state } = response(200, { chunks: [chunk, chunk, chunk, chunk, chunk, chunk] });
    await expect(safeGet(start, options, scripted(hop).request)).rejects.toThrow("Response too large");
    expect(state.aborted).toBe(true);
    expect(state.read).toBe(3);
  });

  it("refuses a declared Content-Length over maxBytes before reading", async () => {
    const { hop, state } = response(200, { contentLength: 1001, chunks: [Buffer.alloc(10)] });
    await expect(safeGet(start, options, scripted(hop).request)).rejects.toThrow("Response too large");
    expect(state.aborted).toBe(true);
    expect(state.read).toBe(0);
  });

  it("accepts a body of exactly maxBytes", async () => {
    const { hop } = response(200, { chunks: [Buffer.alloc(600), Buffer.alloc(400)] });
    expect((await safeGet(start, options, scripted(hop).request)).body.byteLength).toBe(1000);
  });
});
