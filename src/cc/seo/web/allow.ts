/**
 * What the studio workstation may be asked to fetch, and nothing else.
 *
 * THE WORKSTATION IS NOT A PROXY. It sits on the owner's home connection, and
 * the box asks it for a page only because Google answers a datacenter with a
 * script shell and a home line with results. So the list of hosts is short
 * and fixed IN CODE, on both sides: the box refuses to queue anything off it
 * (fetchq.ts) and the workstation refuses to fetch anything off it whatever
 * the box says (work.ts). A box that was broken into could still not make the
 * workstation read the owner's router or somebody's intranet.
 *
 * This file imports nothing, on purpose: the workstation's runner loads it,
 * and the runner must never open the desk's database.
 */

/** Hosts whose page may be the ANSWER: a search result page. */
export const FINAL_HOSTS: readonly string[] = ["www.google.com", "www.google.ch", "lite.duckduckgo.com", "html.duckduckgo.com"];

/**
 * Hosts a redirect may pass THROUGH on its way back to one of the above, and
 * whose own page is never returned. Google sends a first visit from
 * Switzerland to consent.google.com/ml, which answers 303 straight back to
 * the result page with "ucbcb=1" added (seen 5 October 2026: asking for the
 * result page with ucbcb=1 already on it was refused with 403, the bounce was
 * not). Without this one hop there is no Google page at all.
 */
export const HOP_HOSTS: readonly string[] = ["consent.google.com"];

/** The largest page the workstation reads and sends back. */
export const MAX_BYTES = 1_500_000;
/** The longest one request may take, and the shortest limit the box may set. */
export const MAX_TIMEOUT_MS = 30_000;
export const MIN_TIMEOUT_MS = 5_000;
/** Redirects followed by hand, each one checked against the lists. */
export const MAX_HOPS = 4;

/** The request headers the box may set. Never a cookie, never an authorization. */
export const HEADERS_ALLOWED: readonly string[] = ["user-agent", "accept", "accept-language"];

export type TargetVerdict = { ok: true; url: URL } | { ok: false; why: string };

/**
 * May this address be fetched? https only, no credentials in it, the default
 * port, and a host on the list (`hop` true: the pass-through hosts count too).
 */
export function checkTarget(address: string, hop = false): TargetVerdict {
  if (typeof address !== "string" || address.length > 2000) return { ok: false, why: "the address is missing or too long" };
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { ok: false, why: "that is not an address" };
  }
  if (url.protocol !== "https:") return { ok: false, why: `only https is fetched, not ${url.protocol.replace(":", "")}` };
  if (url.username || url.password) return { ok: false, why: "an address with a name or password in it is not fetched" };
  if (url.port && url.port !== "443") return { ok: false, why: `port ${url.port} is not fetched` };
  const host = url.hostname.toLowerCase();
  if (FINAL_HOSTS.includes(host) || (hop && HOP_HOSTS.includes(host))) return { ok: true, url };
  return { ok: false, why: `${host} is not on the list of hosts the workstation fetches` };
}

/** The headers of a task, cut down to the ones allowed, with nothing that could start a second header line. */
export function cleanHeaders(given: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!given || typeof given !== "object") return out;
  for (const [k, v] of Object.entries(given as Record<string, unknown>)) {
    const name = k.toLowerCase();
    if (!HEADERS_ALLOWED.includes(name) || typeof v !== "string") continue;
    const value = v.replace(/[\r\n\0]+/g, " ").trim().slice(0, 400);
    if (value) out[name] = value;
  }
  return out;
}
