import type { SerpLocalRow, SerpOrganicRow, SerpPage } from "../../../../web/src/contract/seo/common.ts";
import { decode } from "../html.ts";

/**
 * Reading a search engine's result page without a browser.
 *
 * Two pages are read here, and they are never mixed up:
 *
 *   Google's BASIC result page, the one it serves a client too old for
 *   scripts (asked for with an Opera Mini User-Agent from the studio's home
 *   connection, web/work.ts). It carries the organic ten, the map pack, the
 *   ads and the "also searched for" list. It carries NO AI Overview and NO
 *   "people also ask": a check read from it says so by leaving them empty.
 *
 *   DuckDuckGo's "lite" page: ten results from DuckDuckGo's index (largely
 *   Bing's). A second opinion, labelled DuckDuckGo wherever it is shown.
 *
 * Both are unofficial pages their owners can change any day. So every reader
 * here is paired with a verdict that says, in a sentence, when the page was
 * not a result page at all (a captcha, a refusal, a script shell, a consent
 * form, a layout the reader no longer knows): a page that cannot be read is
 * never stored as "nobody ranks".
 *
 * Plain string work, no DOM: the box lives in little memory beside the
 * engine (html.ts explains), and these pages are small.
 */

/**
 * The shapes are the contract's (web/src/contract/seo/common.ts): an organic
 * row (position 1 is the first organic result, ads and the map pack not
 * counted; the host lower case as written, "www." kept), a map-pack row, and
 * the page (organic, map pack, ads and who advertised, "also searched for",
 * and "people also ask", which only a paid result API returns).
 */
export type SerpOrganic = SerpOrganicRow;
export type SerpLocal = SerpLocalRow;
export type SerpResult = SerpPage;

export const emptyResult = (): SerpResult => ({ organic: [], localPack: [], ads: 0, adHosts: [], related: [], questions: [] });

/* A slice that ends inside a tag (a block's start is found by one of its attributes) leaves "<div data-x=…" with no ">": cut that too. */
const text = (html: string): string =>
  decode(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/<[^>]*$/, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
const unamp = (s: string): string => s.replace(/&amp;/g, "&");
const bodyOf = (html: string): string => html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ");

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

/* ---------- Google's basic result page --------------------------------------------------------- */

/** The heading of the "also searched for" block, in the four languages (German and English and French seen on real pages; Italian by Google's own wording). */
const RELATED = /(?:Wird auch oft gesucht|Ähnliche Suchanfragen|People also search for|Related searches|Recherches associées|Autres recherches associées|Ricerche correlate|Altre ricerche)/g;
const AD_LABEL = />\s*(?:Gesponsert|Anzeige|Sponsored|Sponsorisé|Annonce|Sponsorizzato|Annuncio)\s*</g;

/**
 * What Google's basic result page holds.
 *
 *   organic   every <a href="/url?q=TARGET..."> that contains an <h3>: the
 *             title is the h3, the address is the q parameter, the snippet is
 *             the text up to the next result or block.
 *   map pack  every <a href="/searchviewer/..."> that contains an <h3>: the
 *             name, then "5.0 (67) · Webdesigner", then a line with the street.
 *   ads       blocks marked data-text-ad, with the advertiser's host in data-dtld.
 *   related   the links under "Wird auch oft gesucht" / "People also search for".
 */
export function parseGoogle(html: string): SerpResult {
  const page = bodyOf(html);
  const out = emptyResult();

  /* Where a snippet must stop: the next block of another kind. */
  const stops: number[] = [];
  for (const m of page.matchAll(RELATED)) stops.push(m.index);
  for (const m of page.matchAll(/data-text-ad="1"/g)) stops.push(m.index);
  for (const m of page.matchAll(/href="\/searchviewer\//g)) stops.push(m.index);

  const hits: { target: string; host: string; title: string; start: number; end: number }[] = [];
  const anchor = /<a\b[^>]*\bhref="(\/url\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = anchor.exec(page); m; m = anchor.exec(page)) {
    const h3 = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(m[2]!);
    if (!h3) continue;
    let target: string | null = null;
    try {
      const q = new URL(`https://www.google.com${unamp(m[1]!)}`).searchParams;
      target = q.get("q") ?? q.get("url");
    } catch {
      target = null;
    }
    const host = target ? hostOf(target) : null;
    if (!target || !host) continue;
    hits.push({ target, host, title: text(h3[1]!), start: m.index, end: anchor.lastIndex });
  }
  for (const h of hits) stops.push(h.start);
  stops.sort((a, b) => a - b);
  for (const [i, h] of hits.entries()) {
    const stop = stops.find((s) => s > h.end) ?? Math.min(page.length, h.end + 3000);
    out.organic.push({ position: i + 1, title: h.title, url: h.target, host: h.host, snippet: text(page.slice(h.end, stop)).slice(0, 300) });
  }

  const pack = /<a\b[^>]*\bhref="\/searchviewer\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = pack.exec(page); m; m = pack.exec(page)) {
    const h3 = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(m[1]!);
    if (!h3) continue;
    const name = text(h3[1]!);
    if (!name || out.localPack.some((l) => l.name === name)) continue;
    /* The lines under the name, as Google breaks them. */
    const lines = m[1]!
      .slice(h3.index + h3[0].length)
      .split(/<br\s*\/?>/i)
      .map((l) => text(l))
      .filter(Boolean);
    const first = lines[0] ?? "";
    const rated = /(\d[.,]\d)\s*\(\s*([\d.,'’\s]+)\)/.exec(first);
    const rest = (rated ? first.slice(rated.index + rated[0].length) : first).replace(/^[\s·⋅•-]+/, "").trim();
    const withStreet = [rest, ...lines.slice(1)].find((l) => l.includes("⋅"));
    const category = rest.split("⋅")[0]!.trim() || null;
    out.localPack.push({
      name,
      rating: rated ? Number(rated[1]!.replace(",", ".")) : null,
      reviews: rated ? Number(rated[2]!.replace(/[^\d]/g, "")) || null : null,
      category,
      address: withStreet ? withStreet.split("⋅").pop()!.trim() || null : null,
    });
  }

  out.ads = (page.match(/data-text-ad="1"/g) ?? []).length || (page.match(AD_LABEL) ?? []).length;
  out.adHosts = [...new Set([...page.matchAll(/data-dtld="([^"]+)"/g)].map((m) => m[1]!.toLowerCase()))];

  const seen = new Set<string>();
  for (const label of page.matchAll(RELATED)) {
    const links = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    links.lastIndex = label.index;
    for (let a = links.exec(page); a; a = links.exec(page)) {
      const href = unamp(a[1]!);
      /* The list is a run of search links; the first link of another kind ends it (the next result, "Next"). */
      if (!href.startsWith("/search?")) break;
      const q = new URLSearchParams(href.slice(href.indexOf("?") + 1));
      if (q.has("start") || !q.get("q")) break;
      const phrase = text(a[2]!) || q.get("q")!;
      if (phrase && !seen.has(phrase.toLowerCase())) {
        seen.add(phrase.toLowerCase());
        out.related.push(phrase);
      }
    }
  }
  return out;
}

export type PageVerdict =
  /** A result page: `result` holds what it carried (an honest "nothing matches" is a result with no rows). */
  | { ok: true; result: SerpResult }
  /**
   * Not a result page. `refused` true means the engine turned the asker away
   * (a captcha, a 403 or 429, a script shell, a consent form, a page the
   * reader does not know): the caller stops asking for a while.
   */
  | { ok: false; refused: boolean; kind: "captcha" | "forbidden" | "shell" | "consent" | "outdated" | "unreadable" | "error"; line: string };

const NO_MATCH = /keine (?:mit deiner Suchanfrage|mit Ihrer Suchanfrage|Ergebnisse gefunden)|ergab keine Treffer|did not match any documents|No results found for|Aucun document ne correspond|Aucun résultat|non ha prodotto risultati|Nessun risultato/i;

/**
 * Judge what the workstation brought back from Google, and read it when it is
 * a result page. The order matters: a captcha page also has status 429, and a
 * script shell answers 200.
 */
export function readGoogle(got: { status: number; finalUrl: string; body: string }): PageVerdict {
  const where = got.finalUrl ?? "";
  const body = got.body ?? "";
  if (got.status === 429 || /\/sorry\//.test(where) || /\/sorry\/index|unusual traffic|ungewöhnlichen Datenverkehr|trafic inhabituel|g-recaptcha|captcha-form/i.test(body)) {
    return { ok: false, refused: true, kind: "captcha", line: "Google asked the workstation to prove it is not a robot" };
  }
  if (got.status === 403) return { ok: false, refused: true, kind: "forbidden", line: "Google refused the workstation (403)" };
  if (/(^|\.)consent\.google\./.test(hostOf(where) ?? "")) return { ok: false, refused: true, kind: "consent", line: "Google sent the workstation to its cookie consent form instead of the results" };
  if (got.status >= 500) return { ok: false, refused: false, kind: "error", line: `Google answered ${got.status}` };
  const result = parseGoogle(body);
  if (result.organic.length) return { ok: true, result };
  if (/\/httpservice\/retry\/enablejs|enablejs\?/.test(body)) return { ok: false, refused: true, kind: "shell", line: "Google sent the workstation a page that needs JavaScript instead of the results" };
  if (/Browser aktualisieren|Update your browser|Mettre à jour votre navigateur|Aggiorna il browser/i.test(body)) {
    return { ok: false, refused: true, kind: "outdated", line: "Google no longer serves its basic result page to this client" };
  }
  if (got.status === 200 && NO_MATCH.test(text(bodyOf(body)))) return { ok: true, result };
  if (got.status !== 200) return { ok: false, refused: true, kind: "forbidden", line: `Google refused the workstation (${got.status})` };
  return { ok: false, refused: true, kind: "unreadable", line: "Google sent the workstation a page the desk cannot read (its layout may have changed)" };
}

/* ---------- DuckDuckGo lite ----------------------------------------------------------------------- */

/**
 * What DuckDuckGo's lite page holds: a table, one result over three rows (the
 * link, the snippet, the shown host). Sponsored rows carry the class
 * "result-sponsored": they are counted as ads and never as results, and the
 * positions here count the results alone (DuckDuckGo's own numbering counts
 * its ads too).
 */
export function parseDdgLite(html: string): SerpResult {
  const out = emptyResult();
  let open: SerpOrganic | null = null;
  let adOpen = false;
  for (const m of html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const sponsored = /result-sponsored/.test(m[1]!);
    const row = m[2]!;
    const link = /<a\b[^>]*\bhref="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/i.exec(row) ?? /<a\b[^>]*class=['"]result-link['"][^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (link) {
      if (sponsored) {
        out.ads++;
        adOpen = true;
        open = null;
        continue;
      }
      adOpen = false;
      let url = unamp(link[1]!);
      try {
        const u = new URL(url.startsWith("//") ? `https:${url}` : url, "https://lite.duckduckgo.com/");
        /* DuckDuckGo wraps the target: //duckduckgo.com/l/?uddg=<the address>. */
        if (u.hostname.endsWith("duckduckgo.com") && u.searchParams.get("uddg")) url = u.searchParams.get("uddg")!;
        else url = u.toString();
      } catch {
        /* kept as written; dropped below when it has no host */
      }
      const host = hostOf(url);
      if (!host) {
        open = null;
        continue;
      }
      open = { position: out.organic.length + 1, title: text(link[2]!), url, host, snippet: "" };
      out.organic.push(open);
      continue;
    }
    const snippet = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i.exec(row);
    if (snippet && open && !sponsored) open.snippet = text(snippet[1]!).slice(0, 300);
    const shown = /class=['"]link-text['"][^>]*>([\s\S]*?)<\/span>/i.exec(row);
    if (shown && sponsored && adOpen) {
      const h = text(shown[1]!).toLowerCase().split("/")[0]!;
      if (h && !out.adHosts.includes(h)) out.adHosts.push(h);
    }
  }
  return out;
}

/** Judge what came back from DuckDuckGo lite, and read it when it is a result page. */
export function readDdgLite(got: { status: number; body: string }): PageVerdict {
  const body = got.body ?? "";
  if (got.status === 202 || /anomaly-modal|challenge-form|bots use DuckDuckGo/i.test(body)) {
    return { ok: false, refused: true, kind: "captcha", line: "DuckDuckGo asked the desk to prove it is not a robot" };
  }
  if (got.status === 403 || got.status === 429) return { ok: false, refused: true, kind: "forbidden", line: `DuckDuckGo refused the desk (${got.status})` };
  if (got.status !== 200) return { ok: false, refused: false, kind: "error", line: `DuckDuckGo answered ${got.status}` };
  const result = parseDdgLite(body);
  if (result.organic.length || result.ads) return { ok: true, result };
  /* The page's own words when a search finds nothing. */
  if (/No results\.|No more results\./i.test(body)) return { ok: true, result };
  return { ok: false, refused: false, kind: "unreadable", line: "DuckDuckGo sent a page the desk cannot read (its layout may have changed)" };
}
