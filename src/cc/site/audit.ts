import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { pipeline, type Readable } from "node:stream";
import zlib from "node:zlib";
import type { AuditFacts, AuditIssue, SpiderAudit } from "../../../web/src/contract/spider.ts";
import { db } from "../../db.ts";
import { keep, kept } from "../store.ts";
import { parseWithRules } from "./extract.ts";
import { normalPath, sleep, UA } from "./http.ts";
import { issue, judgePage, RULES, type Issue, type PageView } from "./rules.ts";

/**
 * One page of any public website, read the way the crawl reads the site's
 * own: "analyse a competitor's page".
 *
 * A person on the desk names an address; the desk fetches that one page,
 * parses it with parse.ts (the same facts the crawl keeps), applies the
 * crawl's page rules to it alone (rules.ts `judgePage` with `alone`: nothing
 * that needs a whole site, such as the sitemap or links from other pages),
 * and answers with all of it (`SpiderAudit`, web/src/contract/spider.ts).
 * The answer is kept in cc_cache for a day: the same address asked again
 * within the day is answered from there and the other site is not asked.
 *
 * THE DESK MUST NOT BE MADE TO FETCH ITS OWN INSIDES. Anybody signed in may
 * name any address, so before every request, the first and each redirect,
 * the address is checked (`guardUrl`, `vet`):
 *
 *   - http or https only, port 80 or 443, no user name or password in it;
 *   - a host name that has a dot and is not localhost, *.localhost, *.local,
 *     *.internal, *.lan or *.home.arpa;
 *   - every address the name resolves to is public (`isPublicAddress`):
 *     never loopback, private (10/8, 172.16/12, 192.168/16, fc00::/7),
 *     link-local (169.254/16, where cloud metadata answers, fe80::/10),
 *     carrier-grade NAT (100.64/10), multicast, reserved, documentation
 *     (also 2001:db8::/32 and 3fff::/20) or the unspecified address, nor an
 *     IPv6 form that carries an IPv4 address inside it the way a translator
 *     would reach it (::ffff:10.0.0.1, the IPv4-translated ::ffff:0:a00:1,
 *     64:ff9b::a00:1, 2002:a00:1::);
 *   - and the connection then goes to the addresses that were checked, not
 *     to a second lookup that could answer differently (the request's
 *     `lookup` is pinned to them), so a name cannot pass the check and then
 *     point elsewhere.
 *
 * AND IT IS POLITE AND BOUNDED. At most one request every two seconds to
 * any one host (`AUDIT.hostGapMs`), whoever asks; five redirects at most;
 * 15 seconds for the whole fetch, the body included however it is
 * compressed; 2 MB of HTML after decompression (more is cut, and the
 * answer says so); the page parsed in extract.ts's thread, whose memory is
 * capped and whose every page has a deadline (EXTRACT.pageMs); the whole
 * audit given up after `AUDIT.wholeMs` whatever happens; at most
 * `AUDIT.perHour` fresh fetches an hour across the desk and
 * `AUDIT.perPersonHour` for any one person. Only an audit that sent a
 * request counts: an address refused by the guard or a name that does not
 * resolve costs nobody a turn.
 */

export const AUDIT = {
  /** Bytes of HTML read, after decompression. */
  maxBytes: 2_000_000,
  /** Milliseconds for the whole fetch, redirects and waiting for a host included. */
  timeoutMs: 15_000,
  maxHops: 5,
  /** At most one request to one host in this many milliseconds. */
  hostGapMs: 2_000,
  /** An audit is kept and answered from for this long. */
  keepMs: 86_400_000,
  /** Fresh fetches in any hour, the whole desk together. */
  perHour: 30,
  /** Fresh fetches in any hour by one person, so one person cannot spend the desk's hour. */
  perPersonHour: 10,
  /** Characters in an address. */
  urlChars: 2_000,
  /**
   * Milliseconds after which an audit is given up whatever it is waiting
   * for: the fetch (15 s), a turn in the parsing thread behind a crawl's
   * pages, and its own parse (each page at most EXTRACT.pageMs).
   */
  wholeMs: 90_000,
} as const;

/** The address may not be fetched; `message` says why, in a sentence for the person who asked. */
export class Refused extends Error {}
/** The audit ran past AUDIT.wholeMs and was given up. */
export class GaveUp extends Error {}
/** Too many audits this hour; `retryAfter` is seconds. */
export class TooMany extends Error {
  constructor(
    message: string,
    readonly retryAfter: number,
  ) {
    super(message);
  }
}

/* ---------- which addresses are public ------------------------------------------ */

const V4_BLOCKED: [string, number, string][] = [
  ["0.0.0.0", 8, "the 'this network' block (0.0.0.0/8)"],
  ["10.0.0.0", 8, "a private network address (10.0.0.0/8)"],
  ["100.64.0.0", 10, "a carrier-grade NAT address (100.64.0.0/10)"],
  ["127.0.0.0", 8, "a loopback address (127.0.0.0/8): this machine"],
  ["169.254.0.0", 16, "a link-local address (169.254.0.0/16), where cloud metadata answers"],
  ["172.16.0.0", 12, "a private network address (172.16.0.0/12)"],
  ["192.0.0.0", 24, "an IETF protocol address (192.0.0.0/24)"],
  ["192.0.2.0", 24, "a documentation address (192.0.2.0/24)"],
  ["192.88.99.0", 24, "a 6to4 relay address (192.88.99.0/24)"],
  ["192.168.0.0", 16, "a private network address (192.168.0.0/16)"],
  ["198.18.0.0", 15, "a benchmarking address (198.18.0.0/15)"],
  ["198.51.100.0", 24, "a documentation address (198.51.100.0/24)"],
  ["203.0.113.0", 24, "a documentation address (203.0.113.0/24)"],
  ["224.0.0.0", 4, "a multicast address (224.0.0.0/4)"],
  ["240.0.0.0", 4, "a reserved address (240.0.0.0/4)"],
];

const v4Int = (ip: string): number => ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);

function v4Reason(ip: string): string | null {
  const n = v4Int(ip);
  for (const [base, bits, why] of V4_BLOCKED) {
    const size = 2 ** (32 - bits);
    const start = v4Int(base);
    if (n >= start && n < start + size) return why;
  }
  return null;
}

/** An IPv6 address as eight 16-bit numbers, or null when it is not one. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  /* An IPv4 tail ("::ffff:10.0.0.1") as two groups. */
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    if (net.isIPv4(tail[1] as string) === false) return null;
    const n = v4Int(tail[1] as string);
    s = `${s.slice(0, -(tail[1] as string).length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0) return null;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const embeddedV4 = (hi: number, lo: number): string => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

function v6Reason(ip: string): string | null {
  const g = v6Groups(ip);
  if (!g) return "not an address the desk can read";
  const [a, b, c, d, e, f, g6, h] = g as [number, number, number, number, number, number, number, number];
  if (g.every((x) => x === 0)) return "the unspecified address (::)";
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && g6 === 0 && h === 1) return "a loopback address (::1): this machine";
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) {
    const inner = v4Reason(embeddedV4(g6, h));
    return inner ? `an IPv4-mapped form of ${inner}` : null;
  }
  /* ::ffff:0:a.b.c.d, the IPv4-translated form (RFC 2765, SIIT): only a
     translator on the desk's own network would carry it anywhere, so it is
     refused whatever IPv4 address it holds, and named when that one is. */
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0xffff && f === 0) {
    const inner = v4Reason(embeddedV4(g6, h));
    return inner ? `an IPv4-translated form of ${inner}` : "an IPv4-translated address (::ffff:0:0/96), which only a local translator would carry";
  }
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) return "an IPv4-compatible address (::/96), long retired";
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    const inner = v4Reason(embeddedV4(g6, h));
    return inner ? `a NAT64 form of ${inner}` : null;
  }
  if (a === 0x64 && b === 0xff9b && c === 1) return "a local NAT64 address (64:ff9b:1::/48)";
  if (a === 0x100 && b === 0 && c === 0 && d === 0) return "a discard address (100::/64)";
  if (a === 0x2001 && b === 0xdb8) return "a documentation address (2001:db8::/32)";
  if (a === 0x3fff && b < 0x1000) return "a documentation address (3fff::/20)";
  if (a === 0x2001 && b < 0x200) return "an IETF protocol or Teredo tunnel address (2001::/23)";
  if (a === 0x2002) {
    const inner = v4Reason(embeddedV4(b, c));
    return inner ? `a 6to4 form of ${inner}` : null;
  }
  if ((a & 0xfe00) === 0xfc00) return "a private network address (fc00::/7)";
  if ((a & 0xffc0) === 0xfe80) return "a link-local address (fe80::/10)";
  if ((a & 0xffc0) === 0xfec0) return "a site-local address (fec0::/10)";
  if ((a & 0xff00) === 0xff00) return "a multicast address (ff00::/8)";
  return null;
}

/** Null when `ip` is a public address; otherwise what kind of address it is, for the refusal. */
export function isPublicAddress(ip: string): string | null {
  const bare = ip.replace(/^\[|\]$/g, "");
  if (net.isIPv4(bare)) return v4Reason(bare);
  if (net.isIPv6(bare)) return v6Reason(bare);
  return "not an IP address";
}

const NAMES_REFUSED = /(^|\.)(localhost|local|internal|lan|home\.arpa|intranet|corp)$/i;

/**
 * The address tidied (no fragment), if it may be asked at all before any
 * lookup: scheme, port, credentials, the shape of the host, and the host
 * itself when it is written as an IP address. Throws `Refused`.
 */
export function guardUrl(raw: string): URL {
  const text = (raw ?? "").trim();
  if (!text) throw new Refused("Name an address to audit.");
  if (text.length > AUDIT.urlChars) throw new Refused(`The address is ${text.length} characters; at most ${AUDIT.urlChars}.`);
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Refused(`“${text.slice(0, 80)}” is not a web address.`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Refused(`Only http and https addresses are audited, not ${u.protocol.replace(/:$/, "")}.`);
  if (u.username || u.password) throw new Refused("An address with a user name or password in it is not audited.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Refused(`Only the web's own ports (80 and 443) are audited, not ${u.port}.`);
  u.hash = "";
  const host = u.hostname.replace(/\.$/, "");
  if (net.isIP(host.replace(/^\[|\]$/g, ""))) {
    const why = isPublicAddress(host);
    if (why) throw new Refused(`${host} is ${why}; the desk audits public websites only.`);
    return u;
  }
  if (NAMES_REFUSED.test(host)) throw new Refused(`“${host}” is a local or internal name; the desk audits public websites only.`);
  if (!host.includes(".")) throw new Refused(`“${host}” is not a public host name: it has no dot.`);
  return u;
}

/** How a name is looked up: every address it has. Replaced in the check script. */
export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
const systemResolver: Resolver = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/** Where a request may connect: the checked addresses, IPv4 first. */
export interface Vetted {
  address: string;
  family: 4 | 6;
  /** Every address the name has, all checked, IPv4 first: the connection may try each (happy eyeballs), and no other. */
  all: { address: string; family: 4 | 6 }[];
}

/**
 * The addresses to connect to for `u`, after checking every address its
 * name resolves to. Throws `Refused`. The lookup counts against the fetch's
 * time limit (`signal`): the system's resolver can take its own time over a
 * name that does not answer.
 */
async function vet(u: URL, resolve: Resolver, signal?: AbortSignal): Promise<Vetted> {
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (net.isIP(host)) {
    const one = { address: host, family: net.isIP(host) as 4 | 6 };
    return { ...one, all: [one] };
  }
  let found: { address: string; family: number }[];
  let quit: (() => void) | undefined;
  try {
    found = await Promise.race([
      resolve(host),
      new Promise<never>((_, reject) => {
        if (!signal) return;
        quit = () => reject(Object.assign(new Error("no answer in time"), { code: "LATE" }));
        if (signal.aborted) quit();
        else signal.addEventListener("abort", quit, { once: true });
      }),
    ]);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "LATE") throw new Refused(`The name ${host} could not be looked up in time.`);
    throw new Refused(code === "ENOTFOUND" ? `The name ${host} does not exist.` : `The name ${host} could not be looked up (${code ?? (e instanceof Error ? e.message : String(e))}).`);
  } finally {
    if (quit) signal?.removeEventListener("abort", quit);
  }
  if (!found.length) throw new Refused(`The name ${host} has no address.`);
  for (const a of found) {
    const why = isPublicAddress(a.address);
    if (why) throw new Refused(`${host} resolves to ${a.address}, ${why}; the desk audits public websites only.`);
  }
  const all = found.map((a) => ({ address: a.address, family: (net.isIPv6(a.address) ? 6 : 4) as 4 | 6 })).sort((a, b) => a.family - b.family);
  return { ...(all[0] as { address: string; family: 4 | 6 }), all };
}

/* ---------- asking one host politely -------------------------------------------- */

const lastAsked = new Map<string, number>();
const lanes = new Map<string, Promise<void>>();

/** Resolves when a request to `host` may go: at least AUDIT.hostGapMs after the one before, in the order asked. */
function politely(host: string): Promise<void> {
  const now = Date.now();
  for (const [h, at] of lastAsked) if (now - at > 60_000 && h !== host) lastAsked.delete(h);
  const before = lanes.get(host) ?? Promise.resolve();
  const mine = before.then(async () => {
    const wait = (lastAsked.get(host) ?? 0) + AUDIT.hostGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastAsked.set(host, Date.now());
  });
  lanes.set(host, mine);
  void mine.finally(() => {
    if (lanes.get(host) === mine) lanes.delete(host);
  });
  return mine;
}

/* ---------- one request ------------------------------------------------------------ */

/** What one request answered. `read` takes the body (decompressed, cut at `max` bytes); `drop` throws it away. */
export interface HopAnswer {
  status: number;
  /** Lower-case names. */
  headers: Record<string, string>;
  read: (max: number) => Promise<{ text: string; bytes: number; truncated: boolean }>;
  drop: () => void;
}

/** How one request is made, to the checked addresses only. Replaced in the check script, so no request leaves the machine there. */
export type Transport = (u: URL, to: Vetted, signal: AbortSignal) => Promise<HopAnswer>;

function flat(h: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (v !== undefined) out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  return out;
}

/**
 * The body, decompressed and cut at `max` bytes, read until it ends, fails,
 * or `signal` (the fetch's time limit) fires, whichever comes first.
 *
 * The decompressor is joined to the response with stream.pipeline, never
 * res.pipe(): when the response is destroyed (the time limit aborting the
 * request, a connection reset mid-body), pipe() tells the decompressor
 * nothing, so it neither ends nor fails and the read waits for ever; and
 * nearly every site answers compressed. pipeline destroys it with the
 * response's error. The signal is also listened to here, so a read that
 * began just before the limit stops at the limit too.
 */
async function readBody(res: http.IncomingMessage, headers: Record<string, string>, max: number, signal: AbortSignal): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const coding = (headers["content-encoding"] ?? "").trim().toLowerCase();
  const unzip = coding === "gzip" || coding === "x-gzip" ? zlib.createGunzip() : coding === "deflate" ? zlib.createInflate() : coding === "br" ? zlib.createBrotliDecompress() : null;
  const stream: Readable = unzip ?? res;
  /* Its own error is what the read below throws; the callback has nothing to add. */
  if (unzip) pipeline(res, unzip, () => {});
  const stop = (): void => {
    const why = signal.reason instanceof Error ? signal.reason : new Error("the time limit was reached");
    res.destroy(why);
    if (unzip) unzip.destroy(why);
  };
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });
  const parts: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    for await (const chunk of stream) {
      const b = chunk as Buffer;
      if (bytes + b.length > max) {
        parts.push(b.subarray(0, max - bytes));
        bytes = max;
        truncated = true;
        break;
      }
      parts.push(b);
      bytes += b.length;
    }
  } finally {
    signal.removeEventListener("abort", stop);
    res.destroy();
    if (unzip) unzip.destroy();
  }
  const charset = /charset=["']?([\w-]+)/i.exec(headers["content-type"] ?? "")?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return { text: decoder.decode(Buffer.concat(parts)), bytes, truncated };
}

/**
 * The real request: to the checked address only, with the desk's name on it.
 * It checks nothing itself (the guard is `fetchGuarded`'s, before it is
 * called); exported so the check script can run it against a local server
 * of its own, which the guard would rightly refuse.
 */
export const nodeTransport: Transport = (u, to, signal) =>
  new Promise((resolve, reject) => {
    /* The connection's own lookup answers with the addresses already checked, and nothing else. */
    const lookup = ((_host: string, opts: { all?: boolean }, cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => {
      if (opts?.all) cb(null, to.all);
      else cb(null, to.address, to.family);
    }) as unknown as net.LookupFunction;
    const req = (u.protocol === "https:" ? https : http).request(
      u,
      {
        method: "GET",
        agent: false,
        lookup,
        signal,
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "accept-encoding": "gzip, deflate, br", "accept-language": "en;q=0.9,de;q=0.8" },
      },
      (res) => {
        const headers = flat(res.headers);
        resolve({ status: res.statusCode ?? 0, headers, read: (max) => readBody(res, headers, max, signal), drop: () => res.destroy() });
      },
    );
    req.on("error", reject);
    req.end();
  });

/* ---------- the fetch, hop by hop ---------------------------------------------------- */

export interface GuardedFetch {
  /** Where it stopped. */
  url: string;
  status: number;
  hops: { url: string; status: number; location: string | null }[];
  loop: boolean;
  headers: Record<string, string>;
  ttfb: number;
  total: number;
  bytes: number;
  truncated: boolean;
  body: string | null;
  /** Why it stopped short: no answer, a redirect the desk would not follow, too many. */
  error: string | null;
  /** Requests that were sent (a connection was attempted). 0 when the guard or the lookup stopped it first. */
  sent: number;
}

/** Options for one guarded fetch. `timeoutMs` is for the check script (a short limit against its own slow server); the route never passes it. */
export interface FetchOptions {
  resolve?: Resolver;
  transport?: Transport;
  timeoutMs?: number;
}

/**
 * GET `raw`, following redirects by hand, every hop checked and spaced.
 * Throws `Refused` when the address itself may not be asked; a redirect to
 * an address that may not be asked ends the fetch with `error` saying so.
 */
export async function fetchGuarded(raw: string, o: FetchOptions = {}): Promise<GuardedFetch> {
  const resolve = o.resolve ?? systemResolver;
  const transport = o.transport ?? nodeTransport;
  const limit = o.timeoutMs ?? AUDIT.timeoutMs;
  const late = `no answer within ${limit / 1000} seconds`;
  const signal = AbortSignal.timeout(limit);
  const hops: GuardedFetch["hops"] = [];
  const seen = new Set<string>();
  let sent = 0;
  let at = guardUrl(raw);
  const stop = (status: number, error: string, extra: Partial<GuardedFetch> = {}): GuardedFetch => ({ url: at.toString(), status, hops, loop: false, headers: {}, ttfb: 0, total: 0, bytes: 0, truncated: false, body: null, error, sent, ...extra });

  for (let i = 0; ; i++) {
    let to: Vetted;
    try {
      to = await vet(at, resolve, signal);
    } catch (e) {
      if (i === 0 || !(e instanceof Refused)) throw e;
      return stop(hops[hops.length - 1]?.status ?? 0, `It redirects to ${at.toString()}, which the desk does not fetch: ${e.message}`);
    }
    await politely(at.host);
    if (signal.aborted) return stop(0, late);
    const started = performance.now();
    let answer: HopAnswer;
    sent++;
    try {
      answer = await transport(at, to, signal);
    } catch (e) {
      const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : "";
      const said = e instanceof Error ? (e.name === "AbortError" || e.name === "TimeoutError" || signal.aborted ? late : e.message) : String(e);
      return stop(0, `${said}${cause}`.slice(0, 200));
    }
    const ttfb = Math.round(performance.now() - started);
    const location = answer.headers.location ?? null;

    if (answer.status >= 300 && answer.status < 400 && location) {
      answer.drop();
      hops.push({ url: at.toString(), status: answer.status, location });
      seen.add(at.toString());
      let next: URL;
      try {
        next = new URL(location, at);
      } catch {
        return stop(answer.status, `It redirects to “${location.slice(0, 120)}”, which is not an address.`, { headers: answer.headers, ttfb });
      }
      next.hash = "";
      if (seen.has(next.toString())) return stop(answer.status, `The redirects go round in a loop: ${[...hops.map((h) => h.url), next.toString()].join(" → ")}.`, { url: next.toString(), loop: true, headers: answer.headers, ttfb });
      if (i + 1 >= AUDIT.maxHops) return stop(answer.status, `More than ${AUDIT.maxHops} redirects; the desk stopped following.`, { url: next.toString(), headers: answer.headers, ttfb });
      try {
        at = guardUrl(next.toString());
      } catch (e) {
        if (!(e instanceof Refused)) throw e;
        at = next;
        return stop(answer.status, `It redirects to ${next.toString()}, which the desk does not fetch: ${e.message}`, { headers: answer.headers, ttfb });
      }
      continue;
    }

    const html = /\b(x?html|xml)\b/i.test(answer.headers["content-type"] ?? "");
    let body: string | null = null;
    let bytes = 0;
    let truncated = false;
    if (html && answer.status !== 204) {
      try {
        ({ text: body, bytes, truncated } = await answer.read(AUDIT.maxBytes));
      } catch (e) {
        const said = signal.aborted ? `the body did not arrive within ${limit / 1000} seconds` : (e instanceof Error ? e.message : String(e)).slice(0, 160);
        return stop(answer.status, `The body could not be read: ${said}`, { headers: answer.headers, ttfb, total: Math.round(performance.now() - started) });
      }
    } else answer.drop();
    return { url: at.toString(), status: answer.status, hops, loop: false, headers: answer.headers, ttfb, total: Math.round(performance.now() - started), bytes, truncated, body, error: null, sent };
  }
}

/* ---------- the audit ----------------------------------------------------------------- */

/** The response headers worth showing for search and speed. */
const HEADERS = ["content-type", "content-length", "content-encoding", "content-language", "cache-control", "expires", "last-modified", "etag", "vary", "age", "x-robots-tag", "link", "server", "strict-transport-security", "x-cache", "cf-cache-status", "x-vercel-cache", "x-powered-by"];

const KEY = "spider:audit:";
/** One fresh audit that sent a request: when, and who asked. */
interface Turn {
  at: number;
  who: string;
}
/** Fresh audits of the last hour, oldest first, the whole desk together. */
const recent: Turn[] = [];
const asking = new Map<string, Promise<SpiderAudit>>();

function asAuditIssue(i: Issue): AuditIssue {
  return { rule: i.rule, severity: i.severity, title: RULES[i.rule].title, text: i.text, measured: i.measured, limit: i.limit };
}

/** Throws `TooMany` when the desk's hour, or this person's share of it, is spent. Counts the turns already taken and those being taken now. */
function mayAsk(who: string): void {
  const hourAgo = Date.now() - 3_600_000;
  while (recent.length && (recent[0] as Turn).at < hourAgo) recent.shift();
  const wait = (t: Turn | undefined): number => Math.max(1, Math.ceil(((t?.at ?? Date.now()) + 3_600_000 - Date.now()) / 1000));
  if (recent.length >= AUDIT.perHour) {
    const s = wait(recent[0]);
    throw new TooMany(`${AUDIT.perHour} pages were audited in the last hour, the most the desk fetches; the next can be asked in ${Math.ceil(s / 60)} minutes.`, s);
  }
  const mine = recent.filter((t) => t.who === who);
  if (mine.length >= AUDIT.perPersonHour) {
    const s = wait(mine[0]);
    throw new TooMany(`You audited ${AUDIT.perPersonHour} pages in the last hour, the most one person may; your next can be asked in ${Math.ceil(s / 60)} minutes.`, s);
  }
}

/** What an audit may be given besides the address: who asks (for their share of the hour), and the check script's replacements. */
export interface AuditOptions extends FetchOptions {
  /** Who is asking, as the route names them; their share is AUDIT.perPersonHour. Absent: one shared name. */
  who?: string;
}

/**
 * Audit one address: from what was kept within the day, or fetched now.
 * Throws `Refused` (the address may not be asked), `TooMany` (the hour is
 * spent, the desk's or this person's) or `GaveUp` (it ran past
 * AUDIT.wholeMs).
 *
 * A turn of the hour is taken before the fetch (so two audits at once
 * cannot both slip under the ceiling) and given back when no request was
 * sent: an address the guard refused, a name that does not exist or
 * resolves to a private address. A request that was sent counts, whether
 * it was answered or not.
 */
export async function audit(raw: string, o: AuditOptions = {}): Promise<SpiderAudit> {
  const u = guardUrl(raw);
  const url = u.toString();
  db.prepare("DELETE FROM cc_cache WHERE key LIKE ? AND at < ?").run(`${KEY}%`, Date.now() - AUDIT.keepMs);
  const had = kept<SpiderAudit>(`${KEY}${url}`);
  if (had && Date.now() - had.at < AUDIT.keepMs) return { ...had.value, cached: true };

  const running = asking.get(url);
  if (running) return running;
  const who = o.who ?? "desk";
  mayAsk(who);
  const turn: Turn = { at: Date.now(), who };
  recent.push(turn);
  const giveBack = (): void => {
    const i = recent.indexOf(turn);
    if (i >= 0) recent.splice(i, 1);
  };
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new GaveUp(`The audit took more than ${AUDIT.wholeMs / 1000} seconds and was given up; ask again in a minute.`)), AUDIT.wholeMs);
    timer.unref();
  });
  const work = Promise.race([
    fresh(url, o).then(
      (r) => {
        if (!r.sent) giveBack();
        return r.answer;
      },
      (e: unknown) => {
        if (e instanceof Refused) giveBack();
        throw e;
      },
    ),
    deadline,
  ]).finally(() => {
    clearTimeout(timer);
    asking.delete(url);
  });
  asking.set(url, work);
  return work;
}

async function fresh(url: string, o: FetchOptions): Promise<{ answer: SpiderAudit; sent: number }> {
  const at = new Date().toISOString();
  const g = await fetchGuarded(url, o);
  const final = new URL(g.url);
  const headers: Record<string, string> = {};
  for (const h of HEADERS) if (g.headers[h]) headers[h] = g.headers[h].slice(0, 300);

  let facts: AuditFacts | null = null;
  let unread: string | null = null;
  const issues: Issue[] = [];
  let score: number | null = null;
  const path = normalPath(final.pathname);

  if (g.loop) {
    issues.push(issue("redirect.loop", path, `The address redirects in a loop and never lands: ${[...g.hops.map((h) => h.url), g.url].join(" → ")}.`, g.hops.length, "a redirect that lands on 200", g.hops.map((h) => h.url)));
    unread = "the redirects go round in a loop";
  } else if (g.error && g.status === 0) {
    issues.push(issue("page.status", path, `Did not answer: ${g.error}.`, 0, 200));
    unread = g.error;
  } else if (g.error) {
    issues.push(issue("page.status", path, `${g.error} The last answer was ${g.status}.`, g.status, 200));
    unread = g.error;
  } else {
    if (g.hops.length > 1) issues.push(issue("redirect.chain", path, `Arrives in ${g.hops.length} redirects (${g.hops.map((h) => h.status).join(", ")}); one hop is the most a redirect should take.`, g.hops.length, 1));
    let parsedFacts = null;
    if (g.status === 200 && g.body !== null) {
      try {
        parsedFacts = (await parseWithRules(g.body, g.url, [], final.host)).parsed.facts;
      } catch (e) {
        unread = `the HTML could not be parsed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
      }
    } else if (g.status === 200) {
      unread = `the answer is ${g.headers["content-type"] ? `“${g.headers["content-type"]}”` : "of no stated type"}, not HTML`;
    }
    g.body = null;
    const view: PageView = {
      path,
      status: g.status,
      redirectTo: null,
      inSitemap: true,
      kind: path === "/" ? "home" : "standard",
      robotsHeader: g.headers["x-robots-tag"] ?? null,
      facts: parsedFacts,
      unread,
      inlinks: 1,
      broken: [],
      redirected: [],
      externalBroken: [],
    };
    issues.push(...judgePage(view, null, { host: final.host, url: g.url, alone: true }));
    if (parsedFacts) {
      const f = parsedFacts;
      const nodes = f.schema.flatMap((b) => b.nodes);
      const absent = f.images.filter((i) => i.alt === "absent" && !i.hidden);
      facts = {
        title: f.title,
        description: f.description,
        canonical: f.canonical,
        robots: f.robots,
        lang: f.lang,
        h1: f.h1.slice(0, 10),
        h2: f.h2s ?? [],
        words: f.words,
        schema: {
          types: f.schemaTypes,
          unreadable: f.schema.filter((b) => !b.parses).length,
          incomplete: nodes
            .filter((n) => n.missing.length)
            .slice(0, 20)
            .map((n) => ({ type: n.type, missing: n.missing.slice(0, 8) })),
        },
        og: f.og,
        twitter: f.twitter,
        images: {
          total: f.images.length,
          altWritten: f.images.filter((i) => i.alt === "written").length,
          altEmpty: f.images.filter((i) => i.alt === "empty").length,
          altAbsent: absent.length,
          withoutAlt: [...new Set(absent.map((i) => i.file ?? i.remoteUrl ?? i.remote ?? "?"))].slice(0, 10),
        },
        links: f.links,
        hreflang: f.hreflang ?? [],
        content: f.content ? { md5: f.content.md5, words: f.content.words } : null,
      };
      /* As the crawl scores a page: 100 minus each page rule that fired, once. */
      const fired = new Set(issues.filter((i) => RULES[i.rule].scope === "page").map((i) => i.rule));
      score = Math.max(0, 100 - [...fired].reduce((s, r) => s + RULES[r].cost, 0));
    }
  }

  const answer: SpiderAudit = {
    url,
    finalUrl: g.url,
    at,
    cached: false,
    status: g.status,
    redirects: g.hops,
    loop: g.loop,
    timing: { ttfbMs: g.ttfb, totalMs: g.total },
    bytes: g.bytes,
    truncated: g.truncated,
    headers,
    facts,
    unread,
    issues: issues.map(asAuditIssue),
    score,
    error: g.error,
  };
  /* Kept for the day when the site answered; "no answer", or a body that did
     not arrive in time, may be a passing failure and is asked again next time. */
  if (g.status !== 0 && !(g.error && g.error.startsWith("The body could not be read"))) keep(`${KEY}${url}`, answer);
  return { answer, sent: g.sent };
}
