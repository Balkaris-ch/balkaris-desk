/**
 * How the desk asks the website for something, and how it names an address.
 *
 * The desk reads www.balkaris.ch the way any visitor's browser would, from
 * outside, with no credential. Two things follow from that and are kept here
 * so every module does them the same way:
 *
 * IT SAYS WHO IT IS. Every request carries the same User-Agent, so a line in
 * Vercel's log that reads "BalkarisDesk" is this process and nothing else,
 * and a firewall rule can let it through or shut it out by name.
 *
 * IT IS GENTLE. Never more than four requests at once (`pool`), with a short
 * breath between them. The site is ours, but the bandwidth and the firewall's
 * patience are Vercel's.
 */

export const UA = "BalkarisDesk/1.0 (+https://desk.balkaris.ch)";

/** The site as the sitemap and the canonicals name it. No trailing slash. */
export const base = (): string => (process.env.SITE_BASE ?? "https://www.balkaris.ch").replace(/\/+$/, "");

/** The canonical host: "www.balkaris.ch". */
export const siteHost = (): string => new URL(base()).host;

/** The same site without or with its "www.": both are the site, only one is canonical. */
export const twinHost = (): string => {
  const h = siteHost();
  return h.startsWith("www.") ? h.slice(4) : `www.${h}`;
};

/** An absolute URL for a site-relative address. */
export const abs = (path: string): string => new URL(path, `${base()}/`).toString();

/**
 * An address the way the desk stores it: site-relative, no trailing slash, no
 * query, no fragment. "/" is the home page.
 *
 * THE TRAILING SLASH IS NOT A DIFFERENCE. The home page's canonical is
 * "https://www.balkaris.ch" and its sitemap address is
 * "https://www.balkaris.ch/": one character apart and the same page. Every
 * comparison in the crawl goes through this function, so that pair is never
 * reported as a mismatch.
 */
export function normalPath(pathname: string): string {
  const p = pathname.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/**
 * The stored address of a URL on the site, or null when it points somewhere
 * else (another host, mailto:, tel:, javascript:, a malformed URL).
 */
export function pathOf(url: string, from: string = `${base()}/`): string | null {
  let u: URL;
  try {
    u = new URL(url, from);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.host !== siteHost() && u.host !== twinHost()) return null;
  return normalPath(u.pathname);
}

/** One step of a redirect chain: what was asked, what it answered, where it pointed. */
export interface Hop {
  url: string;
  status: number;
  location: string | null;
}

export interface Got {
  /** The address that finally answered (or the last one tried). */
  url: string;
  /** The final status. 0 means nothing answered: DNS, TLS, a timeout. */
  status: number;
  /** Every redirect on the way, in order. Empty when the first address answered itself. */
  hops: Hop[];
  /** The final answer's headers, lower-cased names. */
  headers: Record<string, string>;
  /** Milliseconds from sending the final request to its headers arriving. */
  ttfb: number;
  /** Milliseconds from sending the final request to the last byte of its body. */
  total: number;
  /** Size of the body after decompression, in bytes. 0 when the body was not read. */
  bytes: number;
  /** The body as text, when asked for and when there was one. */
  body: string | null;
  /** Why nothing answered, when status is 0. */
  error?: string;
}

const pick = (h: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
};

/**
 * GET (or HEAD) an address and follow its redirects by hand, so the chain is
 * known and not just where it ended.
 *
 * Never throws: an address that does not answer is a result with status 0 and
 * the reason, because "the page is down" is a finding and not a crash.
 */
export async function get(
  url: string,
  o: { body?: boolean; method?: "GET" | "HEAD"; timeout?: number; maxHops?: number; accept?: string } = {},
): Promise<Got> {
  const hops: Hop[] = [];
  let at = url;
  const max = o.maxHops ?? 5;

  for (let i = 0; ; i++) {
    const started = performance.now();
    try {
      const res = await fetch(at, {
        method: o.method ?? "GET",
        redirect: "manual",
        headers: { "user-agent": UA, accept: o.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8" },
        signal: AbortSignal.timeout(o.timeout ?? 20_000),
      });
      const ttfb = performance.now() - started;
      const location = res.headers.get("location");

      if (res.status >= 300 && res.status < 400 && location && i < max) {
        await res.body?.cancel().catch(() => {});
        hops.push({ url: at, status: res.status, location });
        at = new URL(location, at).toString();
        continue;
      }

      let body: string | null = null;
      let bytes = 0;
      if (o.body !== false && (o.method ?? "GET") === "GET") {
        body = await res.text();
        bytes = Buffer.byteLength(body);
      } else {
        await res.body?.cancel().catch(() => {});
      }
      return {
        url: at,
        status: res.status,
        hops,
        headers: pick(res.headers),
        ttfb: Math.round(ttfb),
        total: Math.round(performance.now() - started),
        bytes,
        body,
      };
    } catch (e) {
      const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : "";
      return {
        url: at,
        status: 0,
        hops,
        headers: {},
        ttfb: 0,
        total: Math.round(performance.now() - started),
        bytes: 0,
        body: null,
        error: `${e instanceof Error ? (e.name === "TimeoutError" ? "no answer in time" : e.message) : String(e)}${cause}`.slice(0, 200),
      };
    }
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Do `work` for every item, at most `width` at a time, with `pause`
 * milliseconds between one item and the next on the same lane. Results come
 * back in the order of the items.
 *
 * The ceiling is four whatever is asked for: it is the number the box and
 * the site were promised.
 */
export async function pool<T, R>(items: readonly T[], width: number, work: (item: T, index: number) => Promise<R>, pause = 0): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i] as T, i);
      if (pause) await sleep(pause);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, width, items.length)) }, lane));
  return out;
}

/** The middle value. Response times are skewed by the odd slow answer, so the median is the honest centre. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** The value `p` percent of the way up (p95 is "nineteen in twenty were faster"). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] as number;
}
