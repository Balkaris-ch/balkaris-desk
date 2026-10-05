import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import { UA } from "../../site/http.ts";
import { pace } from "./shared.ts";

/**
 * Reading an address a PERSON TYPED, without letting it reach anything but
 * the public web.
 *
 * The desk lives on a server beside the engine and its private network; a
 * domain lookup that would fetch "http://10.0.0.5/" or "localhost:5432" or a
 * name that resolves into the server's own range would be a door into it. So
 * an address is refused, with the reason in a sentence, unless:
 *
 *   it is http or https, with no name or password in it, on port 80 or 443;
 *   its host is a public name: not an IP literal, not localhost, not a
 *   single label, not under .local, .internal, .lan, .home, .corp,
 *   .localhost, .test, .invalid, .example, .onion or .arpa;
 *   every address the name resolves to is public (no private, loopback,
 *   link-local, carrier-grade NAT, documentation, multicast or reserved
 *   range, IPv4 or IPv6, mapped addresses included).
 *
 * The resolution is checked AT CONNECT TIME by the request's own lookup, not
 * only before it: a name that answers a public address to the check and a
 * private one to the request (DNS rebinding) is refused all the same. Every
 * redirect is checked again, as a new address. Bodies are capped, requests
 * time out, the desk's own name is on every request, and one host is asked
 * at most once every two seconds.
 */

const BLOCKED_SUFFIX = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|private|test|invalid|example|onion|arpa|localdomain)$/;

export type HostVerdict = { ok: true; url: URL; host: string } | { ok: false; why: string };

/** Is this typed address one the desk may read? Pure: no DNS (`resolvesPublic` does that). */
export function checkAddress(input: string): HostVerdict {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 500) return { ok: false, why: "type a domain or an address, such as example.ch" };
  if (/\s/.test(raw)) return { ok: false, why: "an address has no spaces" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, why: "that is not an address" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, why: `only http and https addresses are read, not ${url.protocol.replace(":", "")}` };
  if (url.username || url.password) return { ok: false, why: "an address with a name or password in it is not read" };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, why: `only ports 80 and 443 are read, not ${url.port}` };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, why: "the address names no host" };
  if (host.startsWith("[") || net.isIP(host)) return { ok: false, why: "a numeric IP address is not read: type the site's name" };
  if (!host.includes(".")) return { ok: false, why: `${host} is not a public name (it has no dot)` };
  if (BLOCKED_SUFFIX.test(host)) return { ok: false, why: `${host} is a local or reserved name, not a public site` };
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(host)) return { ok: false, why: `${host} is not a valid public host name` };
  return { ok: true, url, host };
}

const v4 = (ip: string): number[] | null => {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
};

/** An address that is not on the public internet. */
export function privateAddress(ip: string): boolean {
  const a = v4(ip);
  if (a) {
    const [x, y] = a as [number, number, number, number];
    return (
      x === 0 ||
      x === 10 ||
      x === 127 ||
      (x === 100 && y >= 64 && y <= 127) ||
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 192 && y === 0 && (a[2] === 0 || a[2] === 2)) ||
      (x === 198 && (y === 18 || y === 19)) ||
      (x === 198 && y === 51 && a[2] === 100) ||
      (x === 203 && y === 0 && a[2] === 113) ||
      x >= 224
    );
  }
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]!;
  if (!net.isIPv6(s)) return true;
  if (s === "::" || s === "::1") return true;
  /* IPv4 written inside IPv6 (::ffff:10.0.0.1, ::10.0.0.1, 64:ff9b::10.0.0.1): judged as the IPv4 it carries. */
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)?.[1];
  if (tail) return privateAddress(tail);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16);
    const lo = parseInt(mapped[2]!, 16);
    return privateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(s.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 /* fc00::/7 unique local */ ||
    (first & 0xffc0) === 0xfe80 /* fe80::/10 link-local */ ||
    (first & 0xff00) === 0xff00 /* multicast */ ||
    s.startsWith("2001:db8:") /* documentation */ ||
    s.startsWith("100::") /* discard */ ||
    s.startsWith("::ffff:") ||
    first === 0
  );
}

/** How a name resolves. The check script replaces it. */
export const dnsWire = {
  lookup: (host: string): Promise<{ address: string; family: number }[]> =>
    new Promise((resolve, reject) => dns.lookup(host, { all: true, verbatim: true }, (err, list) => (err ? reject(err) : resolve(list as { address: string; family: number }[])))),
};

/** Whether every address the name resolves to is public, or why not. */
export async function resolvesPublic(host: string): Promise<{ ok: true } | { ok: false; why: string }> {
  let list: { address: string }[];
  try {
    list = await dnsWire.lookup(host);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    return { ok: false, why: code === "ENOTFOUND" || code === "ENODATA" ? `${host} does not exist (no address in DNS)` : `${host} could not be looked up (${code ?? "no answer"})` };
  }
  if (!list.length) return { ok: false, why: `${host} has no address in DNS` };
  if (list.some((a) => privateAddress(a.address))) return { ok: false, why: `${host} points to a private or reserved address, so the desk does not read it` };
  return { ok: true };
}

/** The lookup every request uses: the same rule, at the moment of connecting. */
function guardedLookup(hostname: string, options: dns.LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void): void {
  dnsWire
    .lookup(hostname)
    .then((list) => {
      if (!list.length || list.some((a) => privateAddress(a.address))) {
        const err = Object.assign(new Error(`${hostname} points to a private or reserved address`), { code: "EPRIVATE" }) as NodeJS.ErrnoException;
        return callback(err, "", 4);
      }
      const want = options.family === 4 || options.family === 6 ? list.filter((a) => a.family === options.family) : list;
      const usable = want.length ? want : list;
      if (options.all) return callback(null, usable as dns.LookupAddress[]);
      return callback(null, usable[0]!.address, usable[0]!.family);
    })
    .catch((e: NodeJS.ErrnoException) => callback(e, "", 4));
}

export interface Got {
  status: number;
  /** The address that answered last. */
  url: string;
  headers: Record<string, string>;
  body: Buffer;
  /** Set when nothing usable came back: why, in a sentence. */
  error: string | null;
  /** The body was cut at the cap. */
  cut: boolean;
}

export interface GetOptions {
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  acceptLanguage?: string;
  /** Redirects followed, each checked as a new address. */
  hops?: number;
  /** Seconds between two requests to one host. */
  gapMs?: number;
}

/** One request through the guarded lookup, no redirect followed, the body cut at the cap. */
function once(url: URL, o: Required<Pick<GetOptions, "maxBytes" | "timeoutMs" | "accept" | "acceptLanguage">>): Promise<{ status: number; headers: Record<string, string>; body: Buffer; cut: boolean }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "http:" ? http : https;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup as unknown as net.LookupFunction,
        headers: { "user-agent": UA, accept: o.accept, "accept-language": o.acceptLanguage, "accept-encoding": "gzip, deflate, br" },
        timeout: o.timeoutMs,
      },
      (res) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
        const enc = (headers["content-encoding"] ?? "").toLowerCase();
        let stream: NodeJS.ReadableStream = res;
        if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
        const parts: Buffer[] = [];
        let size = 0;
        let cut = false;
        stream.on("data", (d: Buffer) => {
          if (cut) return;
          size += d.length;
          if (size > o.maxBytes) {
            cut = true;
            parts.push(d.subarray(0, Math.max(0, d.length - (size - o.maxBytes))));
            res.destroy();
            resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(parts), cut: true });
            return;
          }
          parts.push(d);
        });
        stream.on("end", () => resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(parts), cut }));
        stream.on("error", (e) => (cut ? undefined : reject(e)));
      },
    );
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("no answer in time"), { name: "TimeoutError" })), o.timeoutMs);
    req.on("timeout", () => req.destroy(Object.assign(new Error("no answer in time"), { name: "TimeoutError" })));
    req.on("error", reject);
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}

/** What went wrong with a request, in words: never the address, never a stack. */
function why(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === "EPRIVATE") return (e as Error).message;
  if (code === "ENOTFOUND" || code === "ENODATA") return "the name does not exist";
  if (code === "ECONNREFUSED") return "the site refused the connection";
  if (code === "ECONNRESET") return "the site dropped the connection";
  if ((code && code.startsWith("ERR_TLS")) || code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return "its certificate is not valid";
  if ((e as Error)?.name === "TimeoutError" || code === "ETIMEDOUT") return "no answer in time";
  return ((e as Error)?.message ?? String(e)).split("\n")[0]!.slice(0, 120);
}

/** The request a domain lookup makes of the site itself. The check script replaces it. */
export const siteWire = {
  get: async (address: string, o: GetOptions = {}): Promise<Got> => {
    const opts = {
      maxBytes: o.maxBytes ?? 2_000_000,
      timeoutMs: o.timeoutMs ?? 20_000,
      accept: o.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      acceptLanguage: o.acceptLanguage ?? "de-CH,de;q=0.9,fr;q=0.8,en;q=0.7",
    };
    let url: URL;
    const first = checkAddress(address);
    if (!first.ok) return { status: 0, url: address, headers: {}, body: Buffer.alloc(0), error: `refused: ${first.why}`, cut: false };
    url = first.url;
    for (let hop = 0; ; hop++) {
      await pace(url.hostname.toLowerCase(), o.gapMs ?? 2000);
      let r: Awaited<ReturnType<typeof once>>;
      try {
        r = await once(url, opts);
      } catch (e) {
        return { status: 0, url: url.toString(), headers: {}, body: Buffer.alloc(0), error: why(e), cut: false };
      }
      const loc = r.headers.location;
      if (r.status >= 300 && r.status < 400 && loc) {
        if (hop >= (o.hops ?? 5)) return { status: r.status, url: url.toString(), headers: r.headers, body: Buffer.alloc(0), error: "more than five redirects", cut: false };
        let next: URL;
        try {
          next = new URL(loc, url);
        } catch {
          return { status: r.status, url: url.toString(), headers: r.headers, body: Buffer.alloc(0), error: "a redirect to no address", cut: false };
        }
        const may = checkAddress(next.toString());
        if (!may.ok) return { status: r.status, url: url.toString(), headers: r.headers, body: Buffer.alloc(0), error: `a redirect the desk does not follow: ${may.why}`, cut: false };
        url = may.url;
        continue;
      }
      return { status: r.status, url: url.toString(), headers: r.headers, body: r.body, error: null, cut: r.cut };
    }
  },
};
