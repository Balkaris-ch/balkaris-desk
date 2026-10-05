import { db } from "../../db.ts";
import type { DomainFact, DomainFacts, PaidDomainFacts, WebLang } from "../../../web/src/contract/seo/common.ts";
import type { LookupCell, LookupRow } from "../../../web/src/contract/seo/competitors.ts";
import { addCompetitorPage } from "./competitors.ts";
import { clusters, type Cluster } from "./keywords.ts";
import { siteWire } from "./web/guard.ts";
import { readSitemapXml } from "./web/domain.ts";
import { dataforseoConfigured, dataforseoStep } from "./web/index.ts";
import { pageWords } from "./words.ts";

/**
 * SEO › Competitors and the open web: what the Competitors page builds on
 * the web layer (src/cc/seo/web/) without re-doing any of it.
 *
 *   lookupRows     a looked-up domain's facts set beside Balkaris's, fact
 *                  by fact, each side with who said it and when, and what
 *                  could not be had said in words (never a zero);
 *   topicPages     a competitor's sitemap read for the pages that answer our
 *                  clusters, added to the weekly read under that cluster, so
 *                  Content Gaps sees them too;
 *   keptPaid       DataForSEO's answers about a domain as kept, read without
 *                  buying anything again.
 */

/* ---------- a looked-up domain beside Balkaris --------------------------------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (d: string | null | undefined): string => {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(d ?? "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : (d ?? "");
};
const n0 = (n: number): string => n.toLocaleString("en-GB");
const years = (day: string): string => {
  const y = (Date.now() - Date.parse(day)) / (365.25 * 86_400_000);
  return y >= 1 ? `${Math.floor(y)} year${Math.floor(y) === 1 ? "" : "s"}` : "less than a year";
};
const ms = (v: number | null): string => (v === null ? "not measured" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

/** One fact as a cell: its words when it could be had, the reason and the step when not. */
function cell<T>(f: DomainFact<T> | undefined, say: (v: T) => string | null, notSaid = "Not stated"): LookupCell {
  if (!f) return { state: "off", text: "Not looked up yet.", from: "", at: null, step: null };
  if (f.state === "ok") {
    const text = say(f.value);
    return { state: text ? "ok" : "off", text: text ?? notSaid, from: f.from, at: f.asOf, step: null };
  }
  if (f.state === "waiting") return { state: "waiting", text: f.reason, from: f.from, at: null, step: null };
  return { state: "off", text: f.reason, from: f.from, at: null, step: f.step ?? null };
}

/** A cell from the desk's own record of Balkaris (the crawl), when the lookup of our own domain could not say it. */
const deskCell = (text: string, at: string | null): LookupCell => ({ state: "ok", text, from: "The desk's crawl of balkaris.ch", at, step: null });

export interface OwnSite {
  /** Pages in our sitemap as the crawl read them, and when. */
  sitemapPages: number | null;
  /** Languages of our sitemap pages and their alternates. */
  languages: string[];
  /** Structured-data types across our sitemap pages. */
  schemaTypes: string[];
  at: string | null;
}

/**
 * Their facts and ours, row by row. `ours` is the lookup of balkaris.ch as
 * kept (null when it was never looked up); `own` is the desk's crawl, used for
 * the rows a lookup of our own site could not answer.
 */
export function lookupRows(them: DomainFacts, ours: DomainFacts | null, own: OwnSite): LookupRow[] {
  const t = them.facts;
  const o = ours?.facts;
  const rows: LookupRow[] = [];
  const row = (key: string, label: string, a: LookupCell, b: LookupCell | null): void => void rows.push({ key, label, them: a, us: b });
  const both = <T>(key: string, label: string, pick: (f: DomainFacts["facts"]) => DomainFact<T>, say: (v: T) => string | null, ownFallback?: () => LookupCell | null): void => {
    const us = o ? cell(pick(o), say) : null;
    row(key, label, cell(pick(t), say), us && us.state === "ok" ? us : (ownFallback?.() ?? us));
  };

  both("registered", "Domain registered", (f) => f.registration, (v) => (v.registered ? `${dayText(v.registered)} (${years(v.registered)} ago)${v.registrar ? `, through ${v.registrar}` : ""}` : null), );
  both("archived", "First kept by the Internet Archive", (f) => f.wayback, (v) => `${dayText(v.firstSeen)} (${years(v.firstSeen)} ago)`);
  both(
    "sitemap",
    "Pages in its sitemap",
    (f) => f.sitemap,
    (v) => `${n0(v.pages)}${v.capped ? " or more" : ""} page${v.pages === 1 ? "" : "s"}${v.newest ? `, the newest change ${dayText(v.newest)}` : ", no change dates given"}${v.sections.length ? `; most under ${v.sections.slice(0, 3).map((s) => `${s.section} (${n0(s.pages)})`).join(", ")}` : ""}`,
    () => (own.sitemapPages !== null ? deskCell(`${n0(own.sitemapPages)} page${own.sitemapPages === 1 ? "" : "s"} in our sitemap, indexable and answering`, own.at) : null),
  );
  /* Languages: the sitemap's addresses and alternates, else the home page's own lang and hreflang. */
  const langsOf = (f: DomainFacts["facts"]): string | null => {
    const set = new Set<string>();
    if (f.sitemap.state === "ok") f.sitemap.value.languages.forEach((l) => set.add(l));
    if (f.home.state === "ok") {
      if (f.home.value.lang) set.add(f.home.value.lang.split("-")[0]!);
      f.home.value.hreflang.forEach((l) => l !== "x-default" && set.add(l.split("-")[0]!));
    }
    return set.size ? [...set].sort().join(", ") : null;
  };
  const langCell = (f: DomainFacts["facts"]): LookupCell => {
    const v = langsOf(f);
    const from = f.sitemap.state === "ok" ? f.sitemap : f.home;
    return v ? { state: "ok", text: v, from: `${f.sitemap.from} and ${f.home.from.toLowerCase()}`, at: from.state === "ok" ? from.asOf : null, step: null } : cell(f.home, () => null, "No language stated on the home page or in the sitemap");
  };
  row("languages", "Languages", langCell(t), o && langsOf(o) ? langCell(o) : own.languages.length ? deskCell(own.languages.join(", "), own.at) : o ? langCell(o) : null);
  both("built", "Built with", (f) => f.home, (v) => (v.builtWith.length ? v.builtWith.join(", ") : null), );
  both(
    "schema",
    "Structured data on the home page",
    (f) => f.home,
    (v) => (v.schemaTypes.length ? v.schemaTypes.join(", ") : null),
    () => (own.schemaTypes.length ? deskCell(`${own.schemaTypes.join(", ")} (across our sitemap pages)`, own.at) : null),
  );
  both("home", "Its home page", (f) => f.home, (v) => `${v.title ? `“${v.title}”` : "No title"}, ${n0(v.words)} words${v.price.stated ? `, states “${v.price.text ?? "a price"}”` : ", no CHF amount"}`);
  both("rank", "Popularity rank (Tranco)", (f) => f.tranco, (v) => `#${n0(v.rank)} on ${dayText(v.date)} (best #${n0(v.best)} over ${v.days} days)`);
  both("crux", "Real-user speed on phones (Chrome)", (f) => f.crux, (v) => `LCP ${ms(v.lcpMs)}, INP ${ms(v.inpMs)}, CLS ${v.cls === null ? "not measured" : v.cls.toFixed(2)}${v.to ? `, 28 days to ${dayText(v.to)}` : ""}`);
  both("pagespeed", "Lab score on phones (PageSpeed)", (f) => f.pagespeed, (v) => (v.performance === null ? null : `Performance ${v.performance}, SEO ${v.seo ?? "not scored"}, LCP ${ms(v.lcpMs)}`));
  both("commoncrawl", "Pages Common Crawl captured", (f) => f.commoncrawl, (v) => `${n0(v.pages)}${v.capped ? " or more" : ""} in ${v.crawl}${v.languages.length ? ` (${v.languages.slice(0, 3).map((l) => `${l.code} ${n0(l.pages)}`).join(", ")})` : ""}`);
  both("wikipedia", "Wikipedia articles that link to it", (f) => f.wikipedia, (v) => (v.links.length ? `${n0(v.links.length)}${v.capped ? " or more" : ""}: ${v.links.slice(0, 3).map((l) => `${l.title} (${l.wiki})`).join(", ")}` : "None in de, fr, it or en Wikipedia"));
  both("robots", "robots.txt", (f) => f.robots, (v) => (v.closed ? "Shuts every crawler out" : `${v.rules} rule${v.rules === 1 ? "" : "s"} for every crawler${v.sitemaps.length ? `, names ${v.sitemaps.length} sitemap${v.sitemaps.length === 1 ? "" : "s"}` : ", names no sitemap"}`));
  return rows;
}

/** A brief for the local AI built from the lookup's facts only; under the operator's 1,000 characters. */
export function lookupBrief(them: DomainFacts, rows: LookupRow[]): { task: { kind: "brief"; prompt: string; depth: "deep" }; label: string; step: string } {
  const facts = rows
    .filter((r) => r.them.state === "ok" && ["sitemap", "languages", "built", "schema", "home", "rank"].includes(r.key))
    .map((r) => `${r.label}: ${r.them.text}`)
    .join("; ");
  const ourSide = rows
    .filter((r) => r.us?.state === "ok" && ["sitemap", "languages", "schema"].includes(r.key))
    .map((r) => `${r.label}: ${r.us!.text}`)
    .join("; ");
  const prompt = [
    `How Balkaris (balkaris.ch, a studio in Zürich) can compete with ${them.domain}.`,
    facts ? `What the desk read about it: ${facts}.` : "",
    ourSide ? `Balkaris: ${ourSide}.` : "",
    "Name the three things to do first on balkaris.ch (pages, languages, structured data, content), each with the reason from these facts. Invent no figure; leave every price for the owner.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    task: { kind: "brief", prompt: prompt.slice(0, 990), depth: "deep" },
    label: "Brief to compete",
    step: `Queues a brief for the AI Operator on the studio workstation (its local model): what Balkaris should do first to compete with ${them.domain}, from the facts above. Nothing on the website changes.`,
  };
}

/* ---------- their pages for our topics --------------------------------------------------------------- */

/** Where sitemap addresses are read. The check script replaces it. */
export const topicWire = { get: siteWire.get };

const LANG_PATH = /^\/(de|fr|it|en)(?:[-_][a-z]{2})?(?:\/|$)/i;

/** How many of a cluster's words an address's own words share, and how many words the address has. */
function fit(path: string, sets: Set<string>[]): { n: number; of: number } {
  const words = pageWords({ path, title: null, h1: null });
  let best = 0;
  for (const set of sets) {
    let n = 0;
    for (const w of words) if (set.has(w)) n++;
    if (n > best) best = n;
  }
  return { n: best, of: words.size };
}

/**
 * Read a competitor's sitemap (robots.txt's sitemaps, else /sitemap.xml; an
 * index followed four deep at most) and, for each of our clusters, the
 * address whose words fit it best. Those pages join the weekly read under
 * that cluster. At most `most` pages are added, our high-priority clusters
 * first. `siteLang` (its home page's language, when known) keeps an address
 * with no language in it to the clusters of that language. Never throws; the
 * line says what happened.
 */
export async function topicPages(domain: string, home: string, sitemaps: string[], most = 8, siteLang: string | null = null): Promise<{ added: { url: string; cluster: string }[]; read: number; line: string }> {
  const origin = new URL(home).origin;
  const queue = sitemaps.length ? sitemaps.slice(0, 4) : [`${origin}/sitemap.xml`];
  const urls: string[] = [];
  const seen = new Set<string>();
  let read = 0;
  let why: string | null = null;
  while (queue.length && read < 6 && urls.length < 5000) {
    const at = queue.shift()!;
    if (seen.has(at)) continue;
    seen.add(at);
    const g = await topicWire.get(at, { accept: "application/xml,text/xml,*/*;q=0.5", maxBytes: 5_000_000, timeoutMs: 20_000 });
    if (g.error || g.status !== 200) {
      why = g.error ?? `answered ${g.status}`;
      continue;
    }
    read++;
    const x = readSitemapXml(g.body.toString("utf8"));
    queue.push(...x.children.slice(0, 8));
    for (const u of x.urls) urls.push(u.loc);
  }
  if (!urls.length) return { added: [], read, line: read ? `${domain}'s sitemap lists no page.` : `${domain}'s sitemap could not be read${why ? ` (${why})` : ""}.` };
  const own = urls.filter((u) => {
    try {
      const h = new URL(u).hostname.replace(/^www\./, "");
      return h === domain || h.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  });
  const list: Cluster[] = clusters();
  const rank = { high: 0, medium: 1, low: 2 } as const;
  list.sort((a, b) => rank[a.priority] - rank[b.priority] || (a.rank ?? 999) - (b.rank ?? 999));
  const added: { url: string; cluster: string }[] = [];
  const taken = new Set<string>();
  for (const c of list) {
    if (added.length >= most) break;
    const sets = c.examples.map((e) => pageWords({ path: "", title: e, h1: null }));
    for (const r of db.prepare("SELECT phrase FROM cc_seo_keywords WHERE cluster = ? AND status = 'relevant' LIMIT 40").all(c.key) as { phrase: string }[]) sets.push(pageWords({ path: "", title: r.phrase, h1: null }));
    if (!sets.length) continue;
    let best: { url: string; n: number; of: number } | null = null;
    for (const u of own) {
      if (taken.has(u)) continue;
      let path: string;
      try {
        path = new URL(u).pathname;
      } catch {
        continue;
      }
      /* An address in another language than the cluster's is not its page. */
      const lang = LANG_PATH.exec(path)?.[1]?.toLowerCase() ?? siteLang;
      if (lang && lang !== c.lang) continue;
      const f = fit(path, sets);
      /* Two shared words, or one that is the whole address ("/webdesign"). */
      if (f.n >= 2 || (f.n === 1 && f.of === 1)) if (!best || f.n > best.n || (f.n === best.n && f.of < best.of)) best = { url: u, ...f };
    }
    if (best) {
      taken.add(best.url);
      if (addCompetitorPage({ url: best.url, domain, address: "topic", cluster: c.key, query: null })) added.push({ url: best.url, cluster: c.key });
      else db.prepare("UPDATE cc_seo_comp_pages SET cluster = COALESCE(cluster, ?) WHERE url = ?").run(c.key, best.url);
    }
  }
  const line = added.length
    ? `${added.length} of ${domain}'s ${n0(own.length)} sitemap pages answer our clusters by their address; they are read now and every week.`
    : `None of ${domain}'s ${n0(own.length)} sitemap pages answers one of our clusters by its address; its home page stands for it.`;
  return { added, read, line };
}

/* ---------- DataForSEO's answers, as kept --------------------------------------------------------------- */

const PAID_KEEP_MS = 7 * 86_400_000;

/**
 * What DataForSEO said about a domain, as kept by the web layer (the same
 * rows paidDomainFacts writes), read without buying again. While there is no
 * account every part is off with the owner's step; with one, a part never
 * asked says so and the page's button asks.
 */
export function keptPaid(domain: string, lang: WebLang): PaidDomainFacts & { configured: boolean; step: string | null } {
  const configured = dataforseoConfigured();
  const step = configured ? null : dataforseoStep();
  const notYet = <T>(why: string): DomainFact<T> => ({ state: "off", source: "desk", reason: why, ...(step ? { step } : {}), from: "DataForSEO" });
  const read = <T>(key: string): DomainFact<T> => {
    if (!configured) return notYet<T>("DataForSEO is not connected: no account exists, so what a domain ranks for on google.ch, its visibility and its links cannot be had.");
    const r = db.prepare("SELECT reading, at FROM cc_seo_domain_facts WHERE domain = ? AND fact = ?").get(domain, key) as { reading: string; at: string } | undefined;
    if (!r || Date.now() - Date.parse(r.at) > PAID_KEEP_MS) return notYet<T>("Not asked of DataForSEO in the last seven days.");
    try {
      return JSON.parse(r.reading) as DomainFact<T>;
    } catch {
      return notYet<T>("The kept answer could not be read.");
    }
  };
  return { configured, step, overview: read(`dfs-overview:${lang}`), ranked: read(`dfs-ranked:${lang}`), competitors: read(`dfs-competitors:${lang}`), backlinks: read("dfs-backlinks") };
}
