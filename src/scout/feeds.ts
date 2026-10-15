/**
 * Reading a source's latest items: RSS, Atom (YouTube's channel feeds are
 * Atom), Hacker News through Algolia's API, and a Reddit board's .rss.
 *
 * No AI here and nothing heavy: a list of titles, addresses, dates and a line
 * of summary. One request per source per visit, the desk's own name on it, a
 * timeout and a size cap. A source that answers 429 or 403 says so and is
 * visited less (index.ts), never hammered.
 */

export type SourceKind = "rss" | "youtube" | "hn" | "reddit" | "gnews";

export interface Item {
  url: string;
  title: string;
  summary: string;
  /** ISO, when the source dated it, or null. */
  published: string | null;
  /** Points or comments where the source gives them (Hacker News). */
  signal: number;
  /** Google News names the publisher's own site: a source to discover (index.ts). */
  publisherSite: string | null;
}

const UA = "BalkarisDesk/1.0 (+https://www.balkaris.ch; the journal's news scout)";
const MAX = 3 * 1024 * 1024;

export class FeedError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** Swappable for the check script. */
export const wire = {
  async get(url: string, accept = "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.5"): Promise<string> {
    let res: Response;
    try {
      res = await fetch(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new FeedError(`did not answer (${e instanceof Error ? e.message : String(e)})`, null);
    }
    if (!res.ok) throw new FeedError(res.status === 429 ? "asked us to slow down (429)" : res.status === 403 ? "refused the desk (403)" : `answered ${res.status}`, res.status);
    const text = await res.text();
    return text.length > MAX ? text.slice(0, MAX) : text;
  },
};

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
export const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e.toLowerCase()] ?? m),
    );
const strip = (html: string): string => decode(decode(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tag = (block: string, name: string): string | null => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? null;
const attr = (block: string, name: string, a: string): string | null => block.match(new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]+)"`, "i"))?.[1] ?? null;
const iso = (s: string | null): string | null => {
  if (!s) return null;
  const t = Date.parse(decode(s).trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** RSS 2.0 and Atom, the two shapes every feed here speaks. */
export function parseFeed(xml: string, kind: SourceKind): Item[] {
  const out: Item[] = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    const title = strip(tag(b, "title") ?? "");
    let url = (attr(b, "link", "href") ?? tag(b, "link") ?? "").trim();
    url = decode(url);
    const summary = strip(tag(b, "description") ?? tag(b, "summary") ?? tag(b, "media:description") ?? tag(b, "content") ?? "").slice(0, 600);
    /* A Reddit post links to its comments; the article it is about is the "[link]" in its body. Self posts have none and are left out. */
    if (kind === "reddit") {
      const content = decode(tag(b, "content") ?? "");
      const ext = content.match(/<a href="(https?:\/\/[^"]+)">\s*\[link\]\s*<\/a>/i)?.[1];
      if (!ext || /reddit\.com|redd\.it/i.test(ext)) continue;
      url = decode(ext);
    }
    if (!title || !/^https?:\/\//i.test(url)) continue;
    out.push({
      url,
      title: kind === "gnews" ? title.replace(/\s+-\s+[^-]+$/, "") : title,
      summary,
      published: iso(tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date")),
      signal: 0,
      publisherSite: kind === "gnews" ? attr(b, "source", "url") : null,
    });
  }
  return out;
}

/** Hacker News's front page, through Algolia: only stories with an address of their own. */
export function parseHn(json: string): Item[] {
  const j = JSON.parse(json) as { hits?: { url?: string | null; title?: string; created_at?: string; points?: number; num_comments?: number; story_text?: string | null }[] };
  return (j.hits ?? [])
    .filter((h) => h.url && h.title)
    .map((h) => ({ url: h.url!, title: h.title!, summary: strip(h.story_text ?? ""), published: iso(h.created_at ?? null), signal: (h.points ?? 0) + (h.num_comments ?? 0), publisherSite: null }));
}

export async function readSource(kind: SourceKind, url: string): Promise<Item[]> {
  const body = await wire.get(url, kind === "hn" ? "application/json" : undefined);
  return kind === "hn" ? parseHn(body) : parseFeed(body, kind);
}

/** A site's own feed, from the <link rel="alternate"> its home page names. For a source found through Google News. */
export async function feedOf(site: string): Promise<{ url: string; name: string } | null> {
  const home = new URL(site);
  if (!/^https?:$/.test(home.protocol)) return null;
  const html = await wire.get(home.origin + "/", "text/html");
  const name = strip(tag(html, "title") ?? home.hostname).slice(0, 80) || home.hostname;
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const l = m[0];
    if (!/rel="alternate"/i.test(l) || !/type="application\/(rss|atom)\+xml"/i.test(l)) continue;
    const href = l.match(/href="([^"]+)"/i)?.[1];
    if (href) return { url: new URL(decode(href), home.origin + "/").toString(), name };
  }
  for (const guess of ["/feed/", "/rss.xml", "/feed.xml", "/rss"]) {
    try {
      const body = await wire.get(home.origin + guess);
      if (/<(rss|feed)\b/i.test(body.slice(0, 2000))) return { url: home.origin + guess, name };
    } catch {
      /* the next guess */
    }
  }
  return null;
}
