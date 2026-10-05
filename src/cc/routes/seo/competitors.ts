import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../../../db.ts";
import { me, requireOwner, type Vars } from "../../access.ts";
import { status as jobStatus } from "../../scheduler.ts";
import { note, off, ok, reading, waiting } from "../../store.ts";
import { scrub } from "../../system.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { ReadinessCheck } from "../../../../web/src/contract/seo/ai-search.ts";
import type { DomainFacts, Priority, SeoSpan, SerpCheck, WebLang } from "../../../../web/src/contract/seo/common.ts";
import type {
  BesideRow,
  CapturedSearch,
  ClusterCompare,
  CompetitorDecision,
  CompetitorShown,
  LookupCard,
  SearchPanel,
  SerpChange,
  SerpPanel,
  SerpView,
  CompetitorDetail,
  CompetitorEngineFilter,
  CompetitorHas,
  CompetitorPage,
  CompetitorRow,
  CompetitorsAsked,
  CompetitorSort,
  CompetitorTiles,
  CompetitorTypeFilter,
  DirectoryRow,
  LackPanel,
  LackRow,
  OurPage,
  RivalPage,
  SeoCompetitorsPayload,
  Sighting,
  TaskRef,
} from "../../../../web/src/contract/seo/competitors.ts";
import { tally } from "../../seo/aisearch.ts";
import {
  competitorNames,
  competitorPages,
  decide,
  decisions,
  domainKey,
  duePages,
  ENGINE_LABEL,
  fileSearch,
  handFiling,
  PLATFORMS,
  readable,
  recordByHand,
  refreshPages,
  sightings,
  watchSite,
  type CompPageRow,
  type Decision,
  type SightingRow,
} from "../../seo/competitors.ts";
import { keptPaid, lookupBrief, lookupRows, topicPages, type OwnSite } from "../../seo/competitors-web.ts";
import * as web from "../../seo/web/index.ts";
import { clusters as allClusters, type Cluster } from "../../seo/keywords.ts";
import { ownerTasks } from "../../seo/owner.ts";
import { profiles } from "../../seo/presence.ts";
import { queryFigures, rate } from "../../seo/rank.ts";
import { pageReadiness } from "../../seo/readiness.ts";
import { pageRef, type SitePage, type SiteView } from "../../seo/site.ts";
import { langOf, normal, pageWords, PLACES, tokens } from "../../seo/words.ts";
import { body, csvFile, head, historyAbsent, historyAt, int, rangeFrom, view } from "./shared.ts";

/**
 * /api/v1/seo/competitors — SEO › Competitors: who appears for the searches
 * Balkaris wants, in Google and in AI answers, what they show that Balkaris
 * does not, and for each of our clusters who ranks beside our own page.
 *
 *   GET /   the whole page (contract/seo/competitors.ts, SeoCompetitorsPayload)
 *
 * WHERE EACH PANEL COMES FROM, each its own `reading()`, so one that fails
 * costs its panel and not the page:
 *
 *   tiles, the list, the detail   the observations (src/cc/seo/competitors.ts:
 *                                 cc_seo_sightings) and their pages as the desk
 *                                 read them once a week (cc_seo_comp_pages)
 *   what they have that we lack   their pages read beside our sitemap pages
 *                                 (the crawl), the readiness check's price
 *                                 check, the AI checks (aisearch.ts) and the
 *                                 profile registry (presence.ts)
 *   directories                   the platforms among the observations, and
 *                                 the studio's own profile there
 *   our clusters                  the clusters (keywords.ts), our page for
 *                                 each (the crawl, the readiness check), and
 *                                 Search Console for their phrases over the
 *                                 head's window (the desk's own history, rank.ts)
 *
 * Nothing here changes anything, and nothing is asked of anybody while the
 * page is drawn: every figure is read from the desk's own database. A brief's
 * button posts the task given here to the AI Operator (POST
 * /api/v1/operator/tasks); "Read due pages now" asks the scheduler for the
 * weekly read (POST /api/v1/jobs/seo-competitors/run).
 *
 * NO INVENTED METRIC. No domain rating, no traffic estimate, no backlink
 * count, no "difficulty": what is shown is where each was seen (with the day
 * and who saw it) and what its own page says. The board-like "words" figure
 * of a home page is that page's, not necessarily the page that ranks, and is
 * said so.
 */
export const routes = new Hono<Vars>();

/* ---------- the question ------------------------------------------------------------------- */

const ENGINES: CompetitorEngineFilter[] = ["all", "google", "ai"];
const TYPES: CompetitorTypeFilter[] = ["all", "studios", "platforms"];
const SORTS: CompetitorSort[] = ["seen", "position", "ai", "name"];
const LIMIT = 15;

const pick = <T extends string>(list: readonly T[], raw: string | undefined, fallback: T): T => (list.includes(raw as T) ? (raw as T) : fallback);

const SHOWN: CompetitorShown[] = ["active", "ignored", "all"];
const LANGS: WebLang[] = ["de", "en", "fr", "it"];

function askedOf(q: (k: string) => string | undefined): CompetitorsAsked {
  const cluster = (q("cluster") ?? "").trim().slice(0, 80);
  const open = (q("open") ?? "").trim().slice(0, 160);
  const look = (q("look") ?? "").trim().slice(0, 200);
  const serp = normal(q("serp") ?? "").slice(0, 120);
  const search = (q("search") ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
  return {
    engine: pick(ENGINES, q("engine"), "all"),
    type: pick(TYPES, q("type"), "all"),
    cluster: cluster || null,
    q: (q("q") ?? "").trim().slice(0, 80),
    sort: pick(SORTS, q("sort"), "seen"),
    offset: int(q("offset"), 0, 0, 10_000),
    limit: int(q("limit"), LIMIT, 5, 50),
    open: open || null,
    look: look || null,
    serp: serp.length >= 2 ? serp : null,
    serpLang: serp.length >= 2 ? pick(LANGS, q("serpLang"), (langOf(serp) ?? "de") as WebLang) : null,
    search: search || null,
    shown: pick(SHOWN, q("shown"), "active"),
  };
}

/* ---------- what a person types, as the list matches it ----------------------------------------- */

/**
 * Letters and digits with single spaces, accents and umlauts folded the same
 * way on both sides, so "zürich", "zuerich" and "zurich" are one word.
 */
const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A pasted address as the host it names ("https://www.example.ch/de/" → "example.ch"); anything else as typed. */
function typedHost(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/?#].*)?$/.exec(t);
  return m && /\.[a-z]{2,}$/.test(m[1]!) ? m[1]! : null;
}

/** The key a typed ?open= names: a host as the list keys it, else the text as given. */
function openKeyOf(raw: string): string {
  if (raw.startsWith("name:")) return raw;
  return typedHost(raw) ?? domainKey(raw) ?? raw;
}

/* ---------- the page's rules, in words ------------------------------------------------------- */

const FILING =
  "A search the keyword table (the SEO audit's, with the research's phrases) files under a cluster keeps that cluster. Any other is filed under the cluster of its own language whose phrase shares the most of its words, places and small words aside, when that is at least two words and at least half of them; a search two clusters fit equally, or none fits, stays unfiled.";
const JOINING =
  "A company an AI answer or the map pack named without a site is counted with a site seen elsewhere when its name, without GmbH, AG and the like, is that site's name: the same letters and digits, or one begins with the other and the shorter has six or more. Two names without a site are one company by the same test, and the shorter name stands for both. The rule is literal, so a company written two ways that do not begin alike (a short name of fewer than six letters and its long form, a name in another language, an abbreviation) is counted twice.";
const observed = (day: string | null, audit: boolean): string =>
  `Each observation is a result someone saw on a stated day${day ? (audit ? `: the SEO audit read Google (google.ch) and the AI assistants in the owner's Chrome on ${dayText(day)}` : `, the newest on ${dayText(day)}; each says who saw it`) : ""}. Nothing is estimated: no domain rating, no traffic, no backlink count. Their pages are read by the desk once a week, robots.txt obeyed, two seconds apart per site.`;

const NOTHING = "No competitor is known yet: they come from the SEO audit's captured Google results and AI answers.";
const NOTHING_STEP = "The owner copies the audit's files to the box and runs npm run seo:import there (or POST /api/v1/seo/imports/audit).";

/* ---------- names, platforms, joining ----------------------------------------------------- */

const AI_KINDS = new Set(["named", "cited"]);
const GOOGLE_KINDS = new Set(["organic", "local-pack"]);
/** Seen in Google's own results: an organic result of Google (DuckDuckGo's second opinion is never Google's ranking) or the map pack. */
const inGoogle = (s: { kind: string; engine: string }): boolean => (s.kind === "organic" && s.engine === "google") || s.kind === "local-pack";
const inAi = (s: { kind: string }): boolean => AI_KINDS.has(s.kind);
const BUSINESS = /^(Organization|Corporation|LocalBusiness|ProfessionalService|AdvertisingAgency|LegalService|FinancialService|Photographer|Store|OnlineBusiness)$/;
const REVIEWS = /^(AggregateRating|Review)$/;

/** Letters and digits only, umlauts folded: "Example Studios" → "examplestudios". */
const compact = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

const LEGAL = /\b(gmbh|ag|sa|sarl|sàrl|kg|llc|ltd|inc)\b\.?/gi;
const labelOf = (domain: string): string => compact(domain.split(".")[0] ?? domain);
const isPlatform = (key: string): boolean => {
  if (key.startsWith("name:")) {
    const n = compact(key.slice(5).replace(LEGAL, ""));
    return [...PLATFORMS].some((p) => labelOf(p) === n);
  }
  return [...PLATFORMS].some((p) => key === p || key.endsWith(`.${p}`));
};
const isOurs = (s: { domain: string; name: string | null }): boolean => /balkaris/i.test(s.domain) || /balkaris/i.test(s.name ?? "");

/** Where a name-only key joins a site (JOINING), or null. */
function joinTo(nameKey: string, domains: { key: string; n: number }[]): string | null {
  const n = compact(nameKey.slice(5).replace(LEGAL, ""));
  if (n.length < 3) return null;
  const fits = domains.filter((d) => {
    const l = labelOf(d.key);
    return l === n || (l.length >= 6 && n.startsWith(l)) || (n.length >= 6 && l.startsWith(n));
  });
  fits.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  return fits[0]?.key ?? null;
}

/* ---------- filing a search under a cluster ---------------------------------------------------- */

interface Filed {
  cluster: string | null;
  filed: "audit" | "words" | "hand" | null;
}

const place = (t: string): boolean => PLACES.has(t) || PLACES.has(t.replace(/ue/g, "u"));
const formsOf = (t: string): Set<string> => pageWords({ path: "", title: t, h1: null });

function filer(list: Cluster[]): (query: string, lang: string | null, stored: string | null) => Filed {
  const known = new Map<string, string>();
  for (const r of db.prepare("SELECT phrase, cluster FROM cc_seo_keywords WHERE cluster IS NOT NULL").all() as { phrase: string; cluster: string }[]) known.set(r.phrase, r.cluster);
  const byCluster = new Map<string, { lang: string; sets: Set<string>[] }>();
  for (const c of list) byCluster.set(c.key, { lang: c.lang, sets: c.examples.map((e) => pageWords({ path: "", title: e, h1: null })) });
  for (const r of db.prepare("SELECT phrase, cluster FROM cc_seo_keywords WHERE cluster IS NOT NULL AND status = 'relevant'").all() as { phrase: string; cluster: string }[]) {
    byCluster.get(r.cluster)?.sets.push(pageWords({ path: "", title: r.phrase, h1: null }));
  }
  const cache = new Map<string, Filed>();
  /* A person's filing stands over the table and the rule (it is written into the stored cluster too). */
  const hand = handFiling();
  return (query, lang, stored) => {
    const h = hand.get(query);
    if (h) return { cluster: h.cluster, filed: h.cluster ? "hand" : null };
    if (stored) return { cluster: stored, filed: "audit" };
    const k = `${lang ?? ""}|${query}`;
    const had = cache.get(k);
    if (had) return had;
    let out: Filed = { cluster: known.get(normal(query)) ?? null, filed: known.has(normal(query)) ? "audit" : null };
    if (!out.cluster) {
      const need = tokens(query).filter((t) => !place(t));
      const forms = need.map(formsOf);
      const language = lang ?? langOf(query);
      const scores: { key: string; score: number }[] = [];
      for (const [key, c] of byCluster) {
        if (language && c.lang !== language) continue;
        let best = 0;
        for (const set of c.sets) {
          const n = forms.filter((fs) => [...fs].some((f) => set.has(f))).length;
          if (n > best) best = n;
        }
        if (best) scores.push({ key, score: best });
      }
      scores.sort((a, b) => b.score - a.score);
      const top = scores[0];
      const tie = top && scores[1]?.score === top.score;
      if (top && !tie && top.score >= 2 && top.score * 2 >= need.length) out = { cluster: top.key, filed: "words" };
    }
    cache.set(k, out);
    return out;
  };
}

/* ---------- everything read once per answer ------------------------------------------------------ */

/** A competitor page with the one doubt the page itself applies to the reading's price. */
type Page = CompPageRow & { priceDoubt: string | null };

/**
 * "Fr." followed by one or two digits and nothing more ("Fr. 9") is how a
 * Swiss page writes Friday's opening hours as often as a price: it is shown as
 * written and not counted as a price.
 */
function sane(p: CompPageRow): Page {
  if (p.priceStated && p.priceText && /^(?:ab\s+|from\s+)?Fr\.\s?\d{1,2}\.?$/i.test(p.priceText.trim())) {
    return { ...p, priceStated: null, priceDoubt: `“${p.priceText.trim()}” not counted as a price: it may be Friday's opening hours (Fr. = Freitag).` };
  }
  return { ...p, priceDoubt: null };
}

interface Group {
  key: string;
  aliases: string[];
  rows: (SightingRow & Filed)[];
  pages: Page[];
}

interface World {
  /** The newest day an observation was made. */
  day: string | null;
  /** When the desk recorded the observations (the import), ISO: what a stamp says, since an observation carries its day and no time. */
  at: string;
  raw: SightingRow[];
  /** Balkaris's own sightings (its organic positions as a capture counted them), filed like the rest; never a competitor. */
  ours: (SightingRow & Filed)[];
  groups: Group[];
  byKey: Map<string, Group>;
  /** Competitors' pages: a platform's are never compared, even one the desk read before it was known as a platform. */
  pages: Page[];
  /** Every page on the weekly read's list, platforms' included: what the read itself reports on. */
  allPages: Page[];
  names: Map<string, string | null>;
  clusters: Map<string, Cluster>;
  clusterName: (key: string | null) => { key: string; name: string } | null;
  file: (query: string, lang: string | null, stored: string | null) => Filed;
  /** A person's word on each key (src/cc/seo/competitors.ts `decide`). */
  decisions: Map<string, Decision>;
  /** A platform by the list, unless a person said otherwise. */
  platform: (key: string) => boolean;
}

function world(): World {
  const list = allClusters();
  const clusters = new Map(list.map((c) => [c.key, c]));
  const file = filer(list);
  const raw = sightings();
  const said = decisions();
  const platform = (key: string): boolean => {
    const k = said.get(key)?.kind;
    return k === "platform" ? true : k === "studio" ? false : isPlatform(key);
  };
  const others = raw.filter((s) => !isOurs(s));
  const own = raw.filter(isOurs).map((s) => ({ ...s, ...file(s.query, s.lang, s.cluster) }));
  const names = competitorNames();
  const allPages = competitorPages().map(sane);
  const pages = allPages.filter((p) => !platform(p.domain));
  const counts = new Map<string, number>();
  for (const s of others) counts.set(s.domain, (counts.get(s.domain) ?? 0) + 1);
  const domains = [...counts.entries()].filter(([k]) => !k.startsWith("name:")).map(([key, n]) => ({ key, n }));
  const target = new Map<string, string>();
  for (const k of counts.keys()) target.set(k, k.startsWith("name:") ? (joinTo(k, domains) ?? k) : k);
  /* A name written two ways ("Wikipedia", "wikipedia") is one company: the spelling seen most stands for both. */
  const spelled = new Map<string, string>();
  for (const k of [...counts.keys()].filter((x) => target.get(x) === x && x.startsWith("name:")).sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b))) {
    const c = compact(k.slice(5).replace(LEGAL, ""));
    if (!c) continue;
    const had = spelled.get(c);
    if (had) target.set(k, had);
    else spelled.set(c, k);
  }
  /* A name and its longer form ("Example Studio", "Example Studio Zürich") are one company when the shorter has six or more letters and digits: the shorter stands for both (JOINING). */
  const bare = [...counts.keys()]
    .filter((k) => k.startsWith("name:") && target.get(k) === k)
    .map((k) => ({ k, c: compact(k.slice(5).replace(LEGAL, "")) }))
    .filter((x) => x.c.length >= 6)
    .sort((a, b) => a.c.length - b.c.length || a.k.localeCompare(b.k));
  for (const [i, short] of bare.entries()) {
    if (target.get(short.k) !== short.k) continue;
    for (const long of bare.slice(i + 1)) if (target.get(long.k) === long.k && long.c !== short.c && long.c.startsWith(short.c)) target.set(long.k, short.k);
  }
  /* Where a spelling was joined to a name that a shorter one then took, follow it to the end. */
  /* A person's merge ("the same company as …") comes first, then the joining rule. */
  const root = (k: string): string => {
    let x = k;
    for (let i = 0; i < 8; i++) {
      const merged = said.get(x)?.mergedInto;
      if (merged && merged !== x) {
        x = merged;
        continue;
      }
      const t = target.get(x);
      if (!t || t === x) break;
      x = t;
    }
    return x;
  };
  const byKey = new Map<string, Group>();
  for (const s of others) {
    const key = root(s.domain);
    const g = byKey.get(key) ?? { key, aliases: [], rows: [], pages: [] };
    if (s.domain !== key) {
      const alias = s.name ?? s.domain.slice(5);
      if (!g.aliases.includes(alias)) g.aliases.push(alias);
    }
    g.rows.push({ ...s, ...file(s.query, s.lang, s.cluster) });
    byKey.set(key, g);
  }
  /* A site a person chose to watch is on the list before any result shows it. */
  for (const d of said.values()) {
    if (!d.watch || d.mergedInto || byKey.has(d.domain)) continue;
    byKey.set(d.domain, { key: d.domain, aliases: [], rows: [], pages: [] });
  }
  for (const p of pages) byKey.get(root(p.domain))?.pages.push(p);
  const day = others.map((s) => s.day).sort().at(-1) ?? null;
  const recorded = (db.prepare("SELECT MAX(updated_at) AS at FROM cc_seo_competitors").get() as { at: string | null } | undefined)?.at ?? null;
  return {
    day,
    at: recorded ?? (day ? `${day}T23:59:59.000Z` : new Date().toISOString()),
    raw,
    ours: own,
    groups: [...byKey.values()],
    byKey,
    pages,
    allPages,
    names,
    clusters,
    clusterName: (key) => (key ? { key, name: clusters.get(key)?.name ?? key } : null),
    file,
    decisions: said,
    platform,
  };
}

/** A decision as the page is told it. */
const decisionOf = (d: Decision | undefined): CompetitorDecision | null => (d ? { watch: d.watch, ignore: d.ignore, kind: d.kind, mergedInto: d.mergedInto, by: d.by, at: d.at } : null);

/** Our site as the comparisons need it: the sitemap pages, their German alternates, the readiness checks. */
interface Ours {
  view: SiteView;
  sitemap: SitePage[];
  hreflang: Map<string, string[] | null>;
  readiness: Map<string, ReadinessCheck[]>;
  readinessAt: string | null;
}

function ours(): Ours {
  const v = view();
  const sitemap = v.pages.filter((p) => p.inSitemap && p.status === 200 && p.indexable);
  const hreflang = new Map<string, string[] | null>();
  for (const r of db.prepare("SELECT path, CASE WHEN json_valid(facts) THEN json_extract(facts, '$.hreflang') END AS h FROM cc_pages").all() as { path: string; h: string | null }[]) {
    let langs: string[] | null = null;
    try {
      const parsed = r.h ? (JSON.parse(r.h) as { lang?: unknown }[]) : null;
      langs = Array.isArray(parsed) ? parsed.map((x) => String(x?.lang ?? "")) : null;
    } catch {
      langs = null;
    }
    hreflang.set(r.path, langs);
  }
  const ready = pageReadiness();
  return { view: v, sitemap, hreflang, readiness: new Map(ready.pages.map((p) => [p.path, p.checks])), readinessAt: ready.checkedAt };
}

/* ---------- small facts -------------------------------------------------------------------------- */

/** Which page of theirs it is, in words. */
const kindOf = (p: CompPageRow): string => (p.topic ? "its page for one of our topics" : p.address === "home" ? "its home page" : "the page that ranks");
const readOk = (p: CompPageRow): boolean => p.status === 200 && !p.error && p.fetchedAt !== null;
const german = (lang: string | null): boolean => !!lang && lang.toLowerCase().startsWith("de");
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};
const n0 = (n: number): string => n.toLocaleString("en-GB");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-02" → "2 Oct 2026", as a sentence on the page writes a day. */
const dayText = (d: string): string => {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(d);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : d;
};
const plural = (n: number, one: string, many = `${one}s`): string => `${n0(n)} ${n === 1 ? one : many}`;
const langName = (lang: string | null): string => (!lang ? "language not stated" : german(lang) ? `German (${lang})` : lang.startsWith("en") ? `English (${lang})` : lang.startsWith("fr") ? `French (${lang})` : lang);

function hasOf(pages: CompPageRow[]): CompetitorHas | null {
  const read = pages.filter(readOk);
  if (!read.length) return null;
  return {
    pages: read.length,
    german: read.some((p) => german(p.lang)),
    price: read.some((p) => p.priceStated === true),
    faq: read.some((p) => p.schemaTypes.includes("FAQPage")),
    business: read.some((p) => p.schemaTypes.some((t) => BUSINESS.test(t))),
    reviews: read.some((p) => p.schemaTypes.some((t) => REVIEWS.test(t))),
  };
}

function rowOf(g: Group, w: World): CompetitorRow {
  const organic = g.rows.filter((s) => s.kind === "organic" && s.engine === "google" && s.position !== null).map((s) => s.position!);
  const local = g.rows.filter((s) => s.kind === "local-pack" && s.position !== null).map((s) => s.position!);
  const engines = [...new Set(g.rows.map((s) => s.engine))];
  const named = g.key.startsWith("name:") ? g.key.slice(5) : null;
  const name = named ?? w.names.get(g.key) ?? g.rows.find((s) => s.name)?.name ?? g.aliases[0] ?? null;
  const clusterKeys = [...new Set(g.rows.map((s) => s.cluster).filter((c): c is string => !!c))];
  const read = g.pages.filter(readOk);
  return {
    domain: g.key,
    name,
    sightings: g.rows.length,
    bestPosition: organic.length ? Math.min(...organic) : null,
    named: g.rows.filter((s) => s.kind === "named").length,
    cited: g.rows.filter((s) => s.kind === "cited").length,
    queries: [...new Set(g.rows.map((s) => s.query))],
    pages: read.length,
    pricePages: read.filter((p) => p.priceStated === true).length,
    lastSeen: g.rows.map((s) => s.day).sort().at(-1) ?? "",
    platform: w.platform(g.key),
    engines: engines.map((key) => ({ key, label: ENGINE_LABEL[key] ?? key })),
    mapPack: local.length ? Math.min(...local) : null,
    alsoNamed: g.aliases.filter((a) => a.toLowerCase() !== (name ?? "").toLowerCase()),
    has: hasOf(g.pages),
    clusters: clusterKeys.map((k) => w.clusterName(k)!),
    decision: decisionOf(w.decisions.get(g.key)),
  };
}

function sightingOf(s: SightingRow & Filed, w: World): Sighting {
  return {
    engine: s.engine,
    engineLabel: ENGINE_LABEL[s.engine] ?? s.engine,
    kind: s.kind,
    query: s.query,
    position: s.position,
    day: s.day,
    by: s.by,
    cluster: w.clusterName(s.cluster),
    filed: s.filed,
  };
}

function pageOf(p: Page, w: World): CompetitorPage {
  const f = p.cluster ? { cluster: p.cluster } : p.query ? { cluster: w.file(p.query, null, null).cluster } : { cluster: null };
  return {
    url: p.url,
    address: p.topic ? "topic" : p.address,
    cluster: w.clusterName(f.cluster),
    query: p.query,
    status: p.status,
    title: p.title,
    h1: p.h1,
    words: p.words,
    lang: p.lang,
    schemaTypes: p.schemaTypes,
    priceStated: p.priceStated,
    priceText: p.priceText,
    priceDoubt: p.priceDoubt,
    fetchedAt: p.fetchedAt,
    error: p.error,
  };
}

/* ---------- tasks ---------------------------------------------------------------------------- */

function taskRefs(): (ids: string[]) => TaskRef | null {
  let all: ReturnType<typeof ownerTasks> = [];
  try {
    all = ownerTasks(["owner", "lead-chrome", "code", "content"]);
  } catch {
    all = [];
  }
  const by = new Map(all.map((t) => [t.id, t]));
  return (ids) => {
    for (const id of ids) {
      const t = by.get(id);
      if (!t) continue;
      const who = t.whoAll;
      return { id: t.id, title: t.title, who, done: t.done, href: who === "owner" || who === "lead-chrome" ? "/seo#needs-you" : null };
    }
    return null;
  };
}

/** The tasks that act on each lack, first that exists wins. */
const TASKS: Record<LackRow["key"], string[]> = {
  german: ["german-plan", "german-locale", "german-price-pages"],
  price: ["price-ranges", "german-price-pages"],
  faq: ["faq-schema", "answer-fields"],
  business: ["schema-fixes"],
  reviews: ["reviews"],
  "map-pack": ["business-profile"],
  ai: ["ai-answer-pages", "off-site-presence"],
  directories: ["directories", "local-listings"],
};

/* ---------- our page for a cluster ------------------------------------------------------------- */

function ourPage(path: string, mappedBy: string | null, o: Ours): OurPage {
  const p = o.view.byPath.get(path);
  const h = o.hreflang.get(path);
  const checks = o.readiness.get(path);
  const pc = checks?.find((c) => c.key === "price");
  let price: boolean | null = null;
  let priceWhy: string;
  if (!p) priceWhy = "The crawl does not know this page.";
  else if (!checks || !pc) priceWhy = "The readiness check has not read this page yet.";
  else if (pc.state === "pass") {
    price = true;
    priceWhy = pc.detail;
  } else if (pc.state === "fail") {
    price = false;
    priceWhy = pc.detail;
  } else if (pc.state === "n/a") priceWhy = `The readiness check asks for a price on service and landing pages only; this is a${/^[aeiou]/i.test(p.kindLabel) ? "n" : ""} ${p.kindLabel.toLowerCase()} page.`;
  else priceWhy = pc.detail;
  return {
    page: pageRef(path, o.view),
    mappedBy,
    words: p?.words ?? null,
    lang: p?.lang ?? null,
    schemaTypes: p?.schemaTypes ?? [],
    faq: (p?.schemaTypes ?? []).includes("FAQPage"),
    german: h === undefined || h === null ? null : h.some((l) => german(l)),
    price,
    priceWhy,
  };
}

/* ---------- the tiles ---------------------------------------------------------------------- */

function tilesOf(w: World, rows: CompetitorRow[]): CompetitorTiles {
  if (!w.raw.length) {
    const none = off<Stat>("desk", NOTHING, NOTHING_STEP);
    return { seen: none, google: none, ai: none, pages: none, clusters: none };
  }
  const at = w.at;
  const rounds = new Set(w.raw.map((s) => s.day)).size;
  const note = w.raw.every((s) => s.by === "audit") && rounds === 1 ? `Observed by the SEO audit on ${dayText(w.day ?? "")}. One round of observations so far: nothing to compare with yet.` : `Observations of ${plural(rounds, "day")}, the newest on ${dayText(w.day ?? "")}; counted over all of them.`;
  const stat = (value: number, sub: string, of?: number): Stat => ({ value, previous: null, unit: "count", series: [], sub, ...(of !== undefined ? { of } : {}) });
  const studios = rows.filter((r) => !r.platform);
  const searches = new Set(w.groups.flatMap((g) => g.rows.filter(inGoogle).map((s) => s.query)));
  const questions = new Set(w.groups.flatMap((g) => g.rows.map((s) => s.query)));
  const googleRows = studios.filter((r) => r.bestPosition !== null || r.mapPack !== null);
  const aiRows = rows.filter((r) => r.named + r.cited > 0);
  const t = (() => {
    try {
      return tally();
    } catch {
      return [];
    }
  })();
  const asked = t.reduce((n, e) => n + e.unprompted.asked, 0);
  const named = t.reduce((n, e) => n + e.unprompted.mentioned, 0);
  const known = w.pages.length;
  const read = w.pages.filter(readOk);
  const used = new Set(w.groups.flatMap((g) => g.rows.map((s) => s.cluster).filter((c): c is string => !!c)));
  const withoutPage = [...used].filter((k) => !w.clusters.get(k)?.page).length;
  return {
    seen: ok(
      stat(studios.length, `sites and companies in ${plural(questions.size, "search or question", "searches and questions")}; ${plural(rows.length - studios.length, "platform")} apart`),
      "desk",
      at,
      `${note} Every site or company not on the desk's list of directories and platforms; not checked one by one to be a studio.`,
    ),
    google: ok(stat(googleRows.length, `in the top results of ${plural(searches.size, "Google search", "Google searches")}, map pack included`), "desk", at, `${note} Of the sites and companies, platforms apart.`),
    ai: ok(
      stat(aiRows.length, asked ? `Balkaris: named in ${named} of ${asked} questions that did not name it` : "No AI check of Balkaris is recorded yet"),
      "desk",
      at,
      `${note} Platforms included: an AI answer that cites a directory is a finding too.`,
    ),
    pages: known
      ? ok(stat(read.length, `${read.filter((p) => p.priceStated === true).length} state a price · ${read.filter((p) => german(p.lang)).length} in German`, known), "desk", read.map((p) => p.fetchedAt!).sort().at(-1) ?? at, "Read by the desk, robots.txt obeyed; a home page where only the site was observed.")
      : off<Stat>("desk", "No competitor page is known yet: they come with the audit's captured Google results.", NOTHING_STEP),
    clusters: ok(stat(used.size, `${withoutPage} of them without a page of ours`, w.clusters.size), "desk", at, `${note} Searches filed by the keyword table, or by the page's words rule.`),
  };
}

/* ---------- the list ----------------------------------------------------------------------------- */

/**
 * What the search box matches in a row: the name shown (never the internal
 * "name:" key), the host, the other names it was given, the searches it was
 * seen for, the clusters and the titles of its pages read. All folded alike.
 */
function haystack(r: CompetitorRow, group: Group): string {
  const shown = r.domain.startsWith("name:") ? r.domain.slice(5) : r.domain;
  const titles = group.pages.flatMap((p) => [p.title ?? "", p.h1 ?? ""]);
  return ` ${fold([shown, r.name ?? "", ...r.alsoNamed, ...r.queries, ...r.clusters.map((c) => c.name), ...titles].join(" "))} `;
}

/** The words a person typed, as the list matches them: a pasted address as its host. */
function typedWords(q: string): string[] {
  const host = typedHost(q);
  return fold(host ?? q)
    .split(" ")
    .filter(Boolean);
}

function filtered(rows: CompetitorRow[], g: Map<string, Group>, a: CompetitorsAsked, skip: "engine" | "type" | "cluster" | "shown" | null): CompetitorRow[] {
  const words = typedWords(a.q);
  const kinds = a.engine === "google" ? inGoogle : a.engine === "ai" ? inAi : null;
  return rows.filter((r) => {
    const group = g.get(r.domain)!;
    const ignored = !!r.decision?.ignore;
    if (skip !== "shown" && (a.shown ?? "active") === "active" && ignored) return false;
    if (skip !== "shown" && a.shown === "ignored" && !ignored) return false;
    if (skip !== "type" && a.type === "studios" && r.platform) return false;
    if (skip !== "type" && a.type === "platforms" && !r.platform) return false;
    /* Engine, cluster and captured search are asked of ONE observation together: "AI answers in this cluster" is an AI answer for this cluster. */
    const useEngine = skip !== "engine" && kinds;
    const useCluster = skip !== "cluster" && a.cluster;
    if (useEngine || useCluster || a.search) {
      const fits = group.rows.some((s) => (!useEngine || kinds!(s)) && (!useCluster || s.cluster === a.cluster) && (!a.search || s.query === a.search));
      if (!fits) return false;
    }
    if (words.length) {
      const hay = haystack(r, group);
      if (!words.every((x) => hay.includes(x))) return false;
    }
    return true;
  });
}

const nameOf = (r: CompetitorRow): string => r.name ?? r.domain;

function sorted(rows: CompetitorRow[], sort: CompetitorSort): CompetitorRow[] {
  const pos = (n: number | null) => n ?? 999;
  const by: Record<CompetitorSort, (a: CompetitorRow, b: CompetitorRow) => number> = {
    seen: (a, b) => b.sightings - a.sightings || pos(a.bestPosition) - pos(b.bestPosition) || nameOf(a).localeCompare(nameOf(b)),
    position: (a, b) => pos(a.bestPosition) - pos(b.bestPosition) || pos(a.mapPack) - pos(b.mapPack) || b.sightings - a.sightings || nameOf(a).localeCompare(nameOf(b)),
    ai: (a, b) => b.named + b.cited - (a.named + a.cited) || b.sightings - a.sightings || nameOf(a).localeCompare(nameOf(b)),
    name: (a, b) => nameOf(a).localeCompare(nameOf(b), "de"),
  };
  return [...rows].sort(by[sort]);
}

function listOf(w: World, all: CompetitorRow[], a: CompetitorsAsked): SeoCompetitorsPayload["list"] {
  if (!w.raw.length && !w.groups.length) return off("desk", NOTHING, NOTHING_STEP);
  const rows = sorted(filtered(all, w.byKey, a, null), a.sort);
  /* A page past the end shows the last page, and says so by its offset. */
  const last = rows.length ? Math.floor((rows.length - 1) / a.limit) * a.limit : 0;
  a.offset = Math.max(0, Math.min(a.offset, last));
  const forEngines = filtered(all, w.byKey, a, "engine");
  const forTypes = filtered(all, w.byKey, a, "type");
  const forClusters = filtered(all, w.byKey, a, "cluster");
  const forShown = filtered(all, w.byKey, a, "shown");
  /* The counts take the same one-observation test as the list. */
  const has = (r: CompetitorRow, kinds: (s: SightingRow) => boolean) => w.byKey.get(r.domain)!.rows.some((s) => kinds(s) && (!a.cluster || s.cluster === a.cluster) && (!a.search || s.query === a.search));
  const kinds = a.engine === "google" ? inGoogle : a.engine === "ai" ? inAi : null;
  const clusterCounts = new Map<string, number>();
  for (const r of forClusters) {
    const keys = new Set(w.byKey.get(r.domain)!.rows.filter((s) => s.cluster && (!kinds || kinds(s)) && (!a.search || s.query === a.search)).map((s) => s.cluster!));
    for (const k of keys) clusterCounts.set(k, (clusterCounts.get(k) ?? 0) + 1);
  }
  /* The cluster asked is always among the options, with its count, so the select shows what is applied. */
  if (a.cluster && !clusterCounts.has(a.cluster)) clusterCounts.set(a.cluster, 0);
  const ignored = forShown.filter((r) => r.decision?.ignore).length;
  return ok(
    {
      total: rows.length,
      rows: rows.slice(a.offset, a.offset + a.limit),
      engines: [
        { key: "all", label: "All", count: forEngines.length },
        { key: "google", label: "Google results", count: forEngines.filter((r) => has(r, inGoogle)).length },
        { key: "ai", label: "AI answers", count: forEngines.filter((r) => has(r, inAi)).length },
      ],
      offset: a.offset,
      limit: a.limit,
      types: [
        { key: "all", label: "All", count: forTypes.length },
        { key: "studios", label: "Sites and companies", count: forTypes.filter((r) => !r.platform).length },
        { key: "platforms", label: "Directories and platforms", count: forTypes.filter((r) => r.platform).length },
      ],
      clusters: [...clusterCounts.entries()]
        .map(([key, count]) => ({ key, name: w.clusterName(key)!.name, count }))
        .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)),
      shown: [
        { key: "active", label: "Competitors", count: forShown.length - ignored },
        { key: "ignored", label: "Ignored", count: ignored },
        { key: "all", label: "All", count: forShown.length },
      ],
      /* Nothing matched what was typed: offer exactly that to look up (an address) or to check (a phrase). */
      lookFor: !rows.length && a.q ? (web.domainOf(a.q).ok ? (typedHost(a.q) ?? a.q) : null) : null,
      checkFor: !rows.length && a.q && !typedHost(a.q) && normal(a.q).length >= 2 ? normal(a.q) : null,
    },
    "desk",
    w.at,
    "Where each was seen is an observation with its day; their pages are what the desk read on them.",
  );
}

/* ---------- one competitor beside us ---------------------------------------------------------- */

interface Context {
  w: World;
  o: Ours;
  span: SeoSpan | null;
  qfig: Map<string, { clicks: number; impressions: number; position: number | null }> | null;
  task: (ids: string[]) => TaskRef | null;
  ai: { asked: number; named: number };
  mapPacks: { searches: number; ours: number };
  gbp: string;
}

function detailOf(g: Group, c: Context): CompetitorDetail {
  const { w, o } = c;
  const row = rowOf(g, w);
  const organic = g.rows.filter((s) => s.kind === "organic" && s.engine === "google" && s.position !== null).sort((a, b) => a.position! - b.position!);
  const best = organic[0] ?? null;
  const clusterKey = best?.cluster ?? g.rows.find((s) => s.cluster)?.cluster ?? null;
  const cluster = clusterKey ? w.clusters.get(clusterKey) : undefined;
  const ourPath = cluster?.page && o.view.byPath.has(cluster.page) ? cluster.page : null;
  const mine = ourPath ? ourPage(ourPath, cluster?.mappedBy ?? null, o) : null;
  const read = g.pages.filter(readOk);
  const site = g.key.startsWith("name:") ? null : `https://${g.key}/`;

  const against = {
    cluster: w.clusterName(clusterKey),
    page: mine?.page ?? null,
    line: !clusterKey
      ? "It was seen for searches no cluster takes, so it is set beside the site as a whole."
      : mine
        ? `Set beside our page for “${cluster?.name ?? clusterKey}”: ${mine.page.path}.`
        : `Set beside the site as a whole: there is no page of ours for “${cluster?.name ?? clusterKey}”${cluster?.pageSaid ? ` (the audit: ${cluster.pageSaid})` : ""}.`,
  };

  const beside: BesideRow[] = [];
  const pagesLine = (n: number) => `${n} of ${plural(read.length, "page")} read`;
  const sitemapDe = o.sitemap.filter((p) => german(p.lang)).length;

  /* language */
  if (read.length) {
    const de = read.filter((p) => german(p.lang)).length;
    const usDe = mine ? german(mine.lang) || mine.german === true : sitemapDe > 0;
    beside.push({
      key: "german",
      label: "German",
      them: de ? `${pagesLine(de)} in German (${[...new Set(read.filter((p) => german(p.lang)).map((p) => p.lang))].join(", ")})` : `No German page read (${[...new Set(read.map((p) => p.lang ?? "not stated"))].join(", ")})`,
      us: mine ? `${mine.page.path} is ${langName(mine.lang)}${mine.german ? ", with a German version" : mine.german === false ? ", no German version" : ""}` : `${sitemapDe} of ${plural(o.sitemap.length, "sitemap page")} in German`,
      lack: de > 0 && !usDe,
      task: de > 0 && !usDe ? c.task(TASKS.german) : null,
    });
    /* price */
    const priced = read.filter((p) => p.priceStated === true);
    const usPrice = mine ? mine.price : null;
    beside.push({
      key: "price",
      label: "States a price",
      them: priced.length
        ? `“${priced[0]!.priceText ?? "a CHF amount"}” on ${kindOf(priced[0]!)}`
        : read.some((p) => p.priceDoubt)
          ? read.find((p) => p.priceDoubt)!.priceDoubt!
          : `No CHF amount on the ${plural(read.length, "page")} read`,
      us: mine ? (mine.price === true ? `${mine.page.path} states a CHF amount (readiness check)` : mine.price === false ? "No CHF amount on the page (readiness check)" : mine.priceWhy) : sitePriceLine(o),
      lack: priced.length ? (mine ? (usPrice === null ? null : !usPrice) : sitePriced(o) === 0) : false,
      task: priced.length && (mine ? usPrice === false : sitePriced(o) === 0) ? c.task(TASKS.price) : null,
    });
    /* FAQ */
    const faq = read.some((p) => p.schemaTypes.includes("FAQPage"));
    const usFaq = mine ? mine.faq : o.sitemap.some((p) => p.schemaTypes.includes("FAQPage"));
    beside.push({
      key: "faq",
      label: "FAQ in structured data",
      them: faq ? "FAQPage on a page read" : "No FAQPage on the pages read",
      us: mine ? (mine.faq ? `FAQPage on ${mine.page.path}` : `No FAQPage on ${mine.page.path}`) : `FAQPage on ${o.sitemap.filter((p) => p.schemaTypes.includes("FAQPage")).length} of ${plural(o.sitemap.length, "sitemap page")}`,
      lack: faq && !usFaq,
      task: faq && !usFaq ? c.task(TASKS.faq) : null,
    });
    /* business types */
    const biz = [...new Set(read.flatMap((p) => p.schemaTypes.filter((t) => BUSINESS.test(t))))];
    const usBiz = mine ? mine.schemaTypes.filter((t) => BUSINESS.test(t)) : [...new Set(o.sitemap.flatMap((p) => p.schemaTypes.filter((t) => BUSINESS.test(t))))];
    beside.push({
      key: "business",
      label: "Business in structured data",
      them: biz.length ? biz.join(", ") : "None on the pages read",
      us: usBiz.length ? usBiz.join(", ") : mine ? `None on ${mine.page.path}` : "None on the sitemap pages",
      lack: biz.length > 0 && usBiz.length === 0,
      task: biz.length > 0 && usBiz.length === 0 ? c.task(TASKS.business) : null,
    });
    /* words, for scale */
    const words = read.filter((p) => p.words !== null).map((p) => `${p.words ? n0(p.words) : "no text in its HTML"} (${kindOf(p)})`);
    beside.push({
      key: "words",
      label: "Words on the page",
      them: words.length ? words.join(", ") : "Not counted",
      us: mine ? (mine.words !== null ? `${n0(mine.words)} on ${mine.page.path}` : "Not counted by the crawl") : "No page of ours to set beside it",
      lack: null,
      task: null,
    });
  }
  /* map pack */
  const local = g.rows.filter((s) => s.kind === "local-pack" && s.position !== null).sort((a, b) => a.position! - b.position!);
  beside.push({
    key: "map-pack",
    label: "Google map pack",
    them: local.length ? `Position ${local[0]!.position} for “${local[0]!.query}”${local.length > 1 ? ` and ${plural(local.length - 1, "other search", "other searches")}` : ""}` : "Not in a captured map pack",
    us: c.mapPacks.searches ? `${c.mapPacks.ours ? `In ${c.mapPacks.ours}` : "In none"} of the ${plural(c.mapPacks.searches, "map pack")} captured. ${c.gbp}` : "No map pack was captured",
    lack: local.length > 0 && c.mapPacks.ours === 0,
    task: local.length > 0 && c.mapPacks.ours === 0 ? c.task(TASKS["map-pack"]) : null,
  });
  /* AI answers */
  const named = g.rows.filter((s) => s.kind === "named");
  const cited = g.rows.filter((s) => s.kind === "cited");
  const engines = [...new Set([...named, ...cited].map((s) => ENGINE_LABEL[s.engine] ?? s.engine))];
  beside.push({
    key: "ai",
    label: "AI answers",
    them: named.length + cited.length ? `Named ${plural(named.length, "time")}, cited ${plural(cited.length, "time")} (${engines.join(", ")})` : "Not named or cited in an AI answer recorded",
    us: c.ai.asked ? `Balkaris named in ${c.ai.named} of ${c.ai.asked} questions that did not name it` : "No AI check of Balkaris is recorded yet",
    lack: named.length + cited.length > 0 && c.ai.asked > 0 && c.ai.named === 0,
    task: named.length + cited.length > 0 && c.ai.asked > 0 && c.ai.named === 0 ? c.task(TASKS.ai) : null,
  });
  /* organic: their best against ours in the same capture (same search, same day) where the capture records us; else against Search Console for the same search */
  if (best) {
    const same = w.ours.find((s) => s.kind === "organic" && s.engine === "google" && s.position !== null && s.query === best.query && s.day === best.day) ?? null;
    if (same) {
      beside.push({
        key: "organic",
        label: `Google for “${best.query}”`,
        them: `Position ${best.position} on ${dayText(best.day)}`,
        us: `Position ${same.position} in the same capture`,
        lack: best.position! < same.position!,
        task: null,
      });
    } else {
      const f = c.qfig?.get(normal(best.query));
      const window = c.span ? `${dayText(c.span.start)} – ${dayText(c.span.end)}` : null;
      /* Said only where the desk records our own positions at all: without them, silence about the capture is not a finding. */
      const capture = w.ours.length ? "Not recorded in that day's capture. " : "";
      beside.push({
        key: "organic",
        label: `Google for “${best.query}”`,
        them: `Position ${best.position} on ${dayText(best.day)}`,
        us: `${capture}${!c.qfig || !window ? "Search Console's history is not on this desk yet" : f && f.impressions ? `Average position ${f.position} in Search Console, ${window} (${plural(f.impressions, "impression")})` : `Not shown for it in Search Console, ${window}`}`,
        lack: !c.qfig ? null : !(f && f.impressions && f.position !== null && f.position <= best.position!),
        task: null,
      });
    }
  }

  return {
    competitor: row,
    sightings: [...g.rows]
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "organic" ? -1 : b.kind === "organic" ? 1 : a.kind.localeCompare(b.kind)) || (a.position ?? 99) - (b.position ?? 99) || a.query.localeCompare(b.query))
      .map((s) => sightingOf(s, w)),
    pages: g.pages.map((p) => pageOf(p, w)),
    site,
    against,
    beside,
    topics: topicsOf(g, w),
    mergeWith: mergeCandidates(g, w),
    merged: [...w.decisions.values()].filter((d) => d.mergedInto === g.key).map((d) => ({ key: d.domain, name: d.domain.startsWith("name:") ? d.domain.slice(5) : d.domain, by: d.by })),
  };
}

/** Its pages read, by our clusters: a page's own cluster, else its title filed by the same rule as a search. */
function topicsOf(g: Group, w: World): NonNullable<CompetitorDetail["topics"]> {
  const by = new Map<string, { url: string; title: string | null }[]>();
  for (const p of g.pages.filter(readOk)) {
    const key = p.cluster ?? (p.title ? w.file(p.title, p.lang?.slice(0, 2) ?? null, null).cluster : null);
    if (!key) continue;
    by.set(key, [...(by.get(key) ?? []), { url: p.url, title: p.title }]);
  }
  return [...by.entries()].map(([key, pages]) => ({ cluster: w.clusterName(key)!, pages })).sort((a, b) => b.pages.length - a.pages.length || a.cluster.name.localeCompare(b.cluster.name));
}

/** Rows whose name begins like this one's (four letters or more): the ones a person may want to count as one company. */
function mergeCandidates(g: Group, w: World): { key: string; name: string }[] {
  const shown = (k: string): string => (k.startsWith("name:") ? k.slice(5) : (w.names.get(k) ?? k));
  const stem = compact(shown(g.key).replace(LEGAL, "").split(".")[0] ?? "").slice(0, 4);
  if (stem.length < 4) return [];
  return w.groups
    .filter((o) => o.key !== g.key && compact(shown(o.key).replace(LEGAL, "").split(".")[0] ?? "").startsWith(stem))
    .slice(0, 6)
    .map((o) => ({ key: o.key, name: shown(o.key) }));
}

/** Our service and landing pages the readiness check asks a price of, and how many state one. */
function sitePriced(o: Ours): number {
  let n = 0;
  for (const checks of o.readiness.values()) if (checks.find((x) => x.key === "price")?.state === "pass") n++;
  return n;
}
function sitePriceLine(o: Ours): string {
  let asked = 0;
  for (const checks of o.readiness.values()) {
    const s = checks.find((x) => x.key === "price")?.state;
    if (s === "pass" || s === "fail") asked++;
  }
  return asked ? `${sitePriced(o)} of the ${plural(asked, "page")} the readiness check asks a price of state one` : "The readiness check has not read the site yet";
}

/* ---------- what they have that we lack ----------------------------------------------------- */

function lacksOf(c: Context): Reading<LackPanel> {
  const { w, o } = c;
  if (!w.raw.length) return off("desk", NOTHING, NOTHING_STEP);
  const read = w.pages.filter(readOk);
  if (!o.view.at) return off("crawl", "The crawl has not read the website yet, so there is nothing of ours to set beside them.", "The crawl runs every few hours (Automations: Crawl the website), or now with Run full SEO audit.");
  const ourN = o.sitemap.length;
  const rows: LackRow[] = [];
  const lack = (them: { num: number; den: number } | null, us: { num: number; den: number } | null): boolean | null =>
    !them || !us || !them.den || !us.den ? null : them.num > 0 && us.num / us.den < them.num / them.den;
  const push = (key: LackRow["key"], label: string, how: string, them: ReturnType<typeof rate> | null, themLine: string, us: ReturnType<typeof rate> | null, usLine: string, l: boolean | null) =>
    rows.push({ key, label, how, them, themLine, us, usLine, lack: l, task: l ? c.task(TASKS[key]) : null });

  const de = read.filter((p) => german(p.lang)).length;
  const ourDe = o.sitemap.filter((p) => german(p.lang)).length;
  const ourAlt = o.sitemap.filter((p) => (o.hreflang.get(p.path) ?? []).some((l) => german(l))).length;
  push(
    "german",
    "Pages in German",
    "The html lang of their pages read; of ours, the sitemap pages' html lang and their hreflang alternates.",
    rate(de, read.length),
    `${de} of ${plural(read.length, "page")} read`,
    rate(ourDe, ourN),
    `${ourDe} of ${plural(ourN, "sitemap page")}${ourAlt ? `; ${ourAlt} link a German version` : ", none links a German version"}`,
    lack({ num: de, den: read.length }, { num: ourDe, den: ourN }),
  );

  const priced = read.filter((p) => p.priceStated === true).length;
  let asked = 0;
  for (const checks of o.readiness.values()) {
    const s = checks.find((x) => x.key === "price")?.state;
    if (s === "pass" || s === "fail") asked++;
  }
  const ourPriced = sitePriced(o);
  push(
    "price",
    "States a price",
    "A CHF or Fr. amount in the page's own text, read by two readers. Theirs: the desk's page reader, which does not count “Fr.” followed by one or two digits alone (it may be Friday's opening hours). Ours: the readiness check's price check on the service and landing pages it asks a price of, which counts any CHF or Fr. amount.",
    rate(priced, read.length),
    `${priced} of ${plural(read.length, "page")} read`,
    asked ? rate(ourPriced, asked) : null,
    asked ? `${ourPriced} of ${plural(asked, "service and landing page", "service and landing pages")}` : "The readiness check has not read the site yet",
    asked ? lack({ num: priced, den: read.length }, { num: ourPriced, den: asked }) : null,
  );

  const faq = read.filter((p) => p.schemaTypes.includes("FAQPage")).length;
  const ourFaq = o.sitemap.filter((p) => p.schemaTypes.includes("FAQPage")).length;
  push("faq", "FAQ in structured data", "FAQPage among the page's JSON-LD types.", rate(faq, read.length), `${faq} of ${plural(read.length, "page")} read`, rate(ourFaq, ourN), `${ourFaq} of ${plural(ourN, "sitemap page")}`, lack({ num: faq, den: read.length }, { num: ourFaq, den: ourN }));

  const biz = read.filter((p) => p.schemaTypes.some((t) => BUSINESS.test(t))).length;
  const ourBiz = o.sitemap.filter((p) => p.schemaTypes.some((t) => BUSINESS.test(t))).length;
  push(
    "business",
    "Business in structured data",
    "Organization, LocalBusiness, ProfessionalService or another business type among the page's JSON-LD types.",
    rate(biz, read.length),
    `${biz} of ${plural(read.length, "page")} read`,
    rate(ourBiz, ourN),
    `${ourBiz} of ${plural(ourN, "sitemap page")}`,
    lack({ num: biz, den: read.length }, { num: ourBiz, den: ourN }),
  );

  const rev = read.filter((p) => p.schemaTypes.some((t) => REVIEWS.test(t))).length;
  const ourRev = o.sitemap.filter((p) => p.schemaTypes.some((t) => REVIEWS.test(t))).length;
  push(
    "reviews",
    "Reviews in structured data",
    "AggregateRating or Review among the page's JSON-LD types. Star ratings in the map pack were not recorded by the capture, so they are not compared.",
    rate(rev, read.length),
    `${rev} of ${plural(read.length, "page")} read`,
    rate(ourRev, ourN),
    `${ourRev} of ${plural(ourN, "sitemap page")}`,
    lack({ num: rev, den: read.length }, { num: ourRev, den: ourN }),
  );

  const packs = c.mapPacks.searches;
  const inPack = new Set(w.groups.filter((g) => g.rows.some((s) => s.kind === "local-pack")).map((g) => g.key)).size;
  push(
    "map-pack",
    "In Google's map pack",
    "The map pack Google showed for our captured searches, and who was in it.",
    null,
    packs ? `${plural(inPack, "company", "companies")} across the ${plural(packs, "map pack")} captured` : "No map pack captured",
    packs ? rate(c.mapPacks.ours, packs) : null,
    packs ? `Balkaris in ${c.mapPacks.ours} of ${packs}. ${c.gbp}` : "No map pack captured",
    packs ? inPack > 0 && c.mapPacks.ours === 0 : null,
  );

  const aiNamed = new Set(w.groups.filter((g) => g.rows.some((s) => AI_KINDS.has(s.kind))).map((g) => g.key)).size;
  const answers = new Set(w.raw.filter((s) => AI_KINDS.has(s.kind)).map((s) => `${s.engine}|${s.query}|${s.day}`)).size;
  push(
    "ai",
    "Named in AI answers",
    "The companies AI Overviews, AI Mode and the assistants named or cited; for Balkaris, the recorded checks of questions that did not name it.",
    null,
    `${plural(aiNamed, "company", "companies")} named or cited in ${plural(answers, "answer")}`,
    c.ai.asked ? rate(c.ai.named, c.ai.asked) : null,
    c.ai.asked ? `Balkaris named in ${c.ai.named} of ${c.ai.asked} questions` : "No AI check of Balkaris recorded yet",
    c.ai.asked ? aiNamed > 0 && c.ai.named === 0 : null,
  );

  let dirs: ReturnType<typeof profiles> = [];
  try {
    dirs = profiles().filter((p) => p.kind === "directory");
  } catch {
    dirs = [];
  }
  const listed = dirs.filter((p) => p.state === "exists").length;
  const platformHits = w.groups.filter((g) => w.platform(g.key) && !w.decisions.get(g.key)?.ignore);
  push(
    "directories",
    "Listed in directories",
    "Directories and platforms among the results for our searches; for Balkaris, the directory profiles the registry knows and whether each exists.",
    null,
    `${plural(platformHits.length, "directory or platform", "directories and platforms")} in the results for our searches`,
    dirs.length ? rate(listed, dirs.length) : null,
    dirs.length ? `Balkaris listed in ${listed} of the ${plural(dirs.length, "directory", "directories")} the registry knows` : "The profile registry is empty",
    dirs.length ? platformHits.length > 0 && listed < dirs.length : null,
  );

  return ok({ pagesRead: read.length, ourPages: ourN, rows }, "desk", w.at, "Their pages as the desk read them; ours as the crawl and the readiness check read them. Each row says how both sides were measured.");
}

/* ---------- directories in the results --------------------------------------------------------- */

function directoriesOf(c: Context): Reading<DirectoryRow[]> {
  const { w } = c;
  if (!w.raw.length) return off("desk", NOTHING, NOTHING_STEP);
  let regs: ReturnType<typeof profiles> = [];
  try {
    regs = profiles();
  } catch {
    regs = [];
  }
  const profileFor = (domain: string) => {
    const label = domain.startsWith("name:") ? compact(domain.slice(5)) : labelOf(domain);
    return (
      regs.find((p) => {
        if (p.url) {
          try {
            const host = new URL(p.url).hostname.replace(/^www\./, "");
            if (host === domain || host.endsWith(`.${domain}`)) return true;
          } catch {
            /* not an address */
          }
        }
        return compact(p.key.replace(/-ch$/, "")) === label;
      }) ?? null
    );
  };
  const rows: DirectoryRow[] = w.groups
    .filter((g) => w.platform(g.key) && !w.decisions.get(g.key)?.ignore)
    .map((g) => {
      const organic = g.rows.filter((s) => s.kind === "organic" && s.engine === "google" && s.position !== null).map((s) => s.position!);
      const p = profileFor(g.key);
      return {
        domain: g.key,
        name: g.key.startsWith("name:") ? g.key.slice(5) : (w.names.get(g.key) ?? null),
        seen: g.rows
          .map((s) => ({ query: s.query, engineLabel: ENGINE_LABEL[s.engine] ?? s.engine, kind: s.kind, position: s.position, day: s.day }))
          .sort((a, b) => (a.position ?? 99) - (b.position ?? 99)),
        best: organic.length ? Math.min(...organic) : null,
        ours: p ? { key: p.key, name: p.name, state: p.state, stateWhy: p.stateWhy, url: p.url, checkedAt: p.checkedAt } : null,
        /* A profile may name a task the engine never made ("local-listings"): the directories step stands in for it. */
        task: p?.ownerTaskId ? c.task([p.ownerTaskId, ...TASKS.directories]) : null,
      };
    })
    .sort((a, b) => (a.best ?? 99) - (b.best ?? 99) || b.seen.length - a.seen.length || a.domain.localeCompare(b.domain));
  return ok(rows, "desk", w.at, "The platforms among the observations; the studio's own profile from the registry, checked weekly where it has an address.");
}

/* ---------- our clusters against who ranks -------------------------------------------------- */

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function clustersOf(c: Context): Reading<ClusterCompare[]> {
  const { w, o } = c;
  if (!w.raw.length) return off("desk", NOTHING, NOTHING_STEP);
  const keys = new Set(w.groups.flatMap((g) => g.rows.map((s) => s.cluster).filter((k): k is string => !!k)));
  const phrasesOf = new Map<string, Set<string>>();
  for (const r of db.prepare("SELECT phrase, cluster FROM cc_seo_keywords WHERE cluster IS NOT NULL AND status <> 'irrelevant'").all() as { phrase: string; cluster: string }[]) {
    if (!keys.has(r.cluster)) continue;
    const s = phrasesOf.get(r.cluster) ?? new Set<string>();
    s.add(r.phrase);
    phrasesOf.set(r.cluster, s);
  }
  const out: ClusterCompare[] = [];
  for (const key of keys) {
    const cl = w.clusters.get(key);
    const rows = w.groups.flatMap((g) => g.rows.filter((s) => s.cluster === key).map((s) => ({ g, s })));
    const queries = new Map<string, { query: string; filed: "audit" | "words" | "hand"; engines: Set<string> }>();
    for (const { s } of rows) {
      const q = queries.get(s.query) ?? { query: s.query, filed: s.filed ?? "audit", engines: new Set<string>() };
      q.engines.add(ENGINE_LABEL[s.engine] ?? s.engine);
      queries.set(s.query, q);
    }
    /* who ranks: each site's best organic position across the cluster's searches */
    const bestBy = new Map<string, { g: Group; s: SightingRow & Filed }>();
    for (const r of rows) {
      if (r.s.kind !== "organic" || r.s.engine !== "google" || r.s.position === null) continue;
      const had = bestBy.get(r.g.key);
      if (!had || r.s.position < had.s.position!) bestBy.set(r.g.key, r);
    }
    const qset = new Set(queries.keys());
    /* The page that ranks for the search, then one ranking for the cluster, then the page of its sitemap for the cluster, then its home page: the first of them that was READ, and only when none was, the first, so its error is shown. */
    const pageFor = (g: Group, query: string): Page | null => {
      const order = [
        g.pages.find((p) => p.address === "ranking" && p.query === query),
        g.pages.find((p) => p.query !== null && qset.has(p.query) && p.address === "ranking"),
        g.pages.find((p) => p.topic && p.cluster === key),
        g.pages.find((p) => p.address === "home"),
      ].filter((p): p is Page => !!p);
      return order.find(readOk) ?? order[0] ?? null;
    };
    /* The six shown: "who ranks" and "their pages" are both of these, so every page counted is a site the reader sees. */
    const shown = [...bestBy.values()].sort((a, b) => a.s.position! - b.s.position! || a.g.key.localeCompare(b.g.key)).slice(0, 6);
    const organic: RivalPage[] = shown.map(({ g, s }) => {
      const p = pageFor(g, s.query);
      return {
        domain: g.key,
        name: w.names.get(g.key) ?? null,
        position: s.position!,
        query: s.query,
        page: p ? { url: p.url, address: p.topic ? "topic" : p.address, words: p.words, lang: p.lang, schemaTypes: p.schemaTypes, priceStated: p.priceStated, priceText: p.priceText, priceDoubt: p.priceDoubt, error: p.error } : null,
      };
    });
    /* our own place in the same captures: the best per search, best first */
    const googleSearches = new Set(rows.filter(({ s }) => s.kind === "organic" && s.engine === "google").map(({ s }) => s.query));
    const ourBest = new Map<string, SightingRow & Filed>();
    for (const s of w.ours) {
      if (s.kind !== "organic" || s.engine !== "google" || s.position === null || !(s.cluster === key || googleSearches.has(s.query))) continue;
      const had = ourBest.get(s.query);
      if (!had || s.position < had.position! || (s.position === had.position && s.day > had.day)) ourBest.set(s.query, s);
    }
    const ourSeen = [...ourBest.values()].sort((a, b) => a.position! - b.position! || a.query.localeCompare(b.query)).map((s) => ({ position: s.position!, query: s.query, day: s.day }));
    const ourSeenWhy = ourSeen.length || !googleSearches.size
      ? null
      : w.ours.length
        ? `Balkaris is not recorded in the Google results captured for ${googleSearches.size === 1 ? "this search" : `these ${n0(googleSearches.size)} searches`}.`
        : "Balkaris's own position in these results is not recorded on this desk: the SEO import records it where the audit saw it.";
    const mapPack = rows
      .filter(({ s }) => s.kind === "local-pack" && s.position !== null)
      .map(({ g, s }) => ({ name: s.name ?? (g.key.startsWith("name:") ? g.key.slice(5) : g.key), position: s.position!, query: s.query }))
      .sort((a, b) => a.query.localeCompare(b.query) || a.position - b.position);
    const aiBy = new Map<string, Set<string>>();
    for (const { g, s } of rows) {
      if (!AI_KINDS.has(s.kind)) continue;
      const name = g.key.startsWith("name:") ? g.key.slice(5) : g.key;
      const e = aiBy.get(name) ?? new Set<string>();
      e.add(ENGINE_LABEL[s.engine] ?? s.engine);
      aiBy.set(name, e);
    }
    /* their pages read for it: the pages of the sites shown, one per site, platforms never */
    const theirPages = shown.map(({ g, s }) => pageFor(g, s.query)).filter((p): p is Page => !!p && readOk(p));
    const theirs = {
      read: theirPages.length,
      german: theirPages.filter((p) => german(p.lang)).length,
      price: theirPages.filter((p) => p.priceStated === true).length,
      faq: theirPages.filter((p) => p.schemaTypes.includes("FAQPage")).length,
      medianWords: median(theirPages.filter((p) => p.words !== null && p.words > 0).map((p) => p.words!)),
      prices: [...new Set(theirPages.filter((p) => p.priceStated === true && p.priceText).map((p) => p.priceText!))].slice(0, 4),
      shown: shown.length,
    };
    /* our page */
    const mine = cl?.page && o.view.byPath.has(cl.page) ? ourPage(cl.page, cl.mappedBy, o) : null;
    const gap = mine ? null : cl?.page ? `The cluster names ${cl.page}, which the crawl does not know.` : cl?.pageSaid ? `No page: the audit said “${cl.pageSaid}”.` : "No page of ours answers it.";
    /* Search Console for its phrases over the window */
    const phrases = new Set([...(phrasesOf.get(key) ?? []), ...[...queries.keys()].map(normal)]);
    let search: ClusterCompare["search"];
    if (!c.qfig || !c.span) search = historyAbsent();
    else {
      const hits = [...phrases].map((p) => ({ query: p, f: c.qfig!.get(p) })).filter((x) => x.f && x.f.impressions > 0) as { query: string; f: { clicks: number; impressions: number; position: number | null } }[];
      const impressions = hits.reduce((n, x) => n + x.f.impressions, 0);
      const weighted = hits.reduce((n, x) => n + (x.f.position ?? 0) * x.f.impressions, 0);
      search = ok(
        {
          start: c.span.start,
          end: c.span.end,
          phrases: phrases.size,
          shown: hits.length,
          impressions,
          clicks: hits.reduce((n, x) => n + x.f.clicks, 0),
          position: impressions ? Math.round((weighted / impressions) * 10) / 10 : null,
          top: hits
            .sort((a, b) => b.f.impressions - a.f.impressions)
            .slice(0, 3)
            .map((x) => ({ query: x.query, impressions: x.f.impressions, position: x.f.position })),
        },
        "gsc",
        historyAt(),
        `Search Console, ${dayText(c.span.start)} – ${dayText(c.span.end)}: the cluster's ${plural(phrases.size, "phrase")} in the keyword table and the searches captured, matched word for word.`,
      );
    }
    out.push({
      cluster: { key, name: cl?.name ?? key, lang: cl?.lang ?? langOf([...queries.keys()][0] ?? "") ?? "en", priority: cl?.priority ?? "medium", rank: cl?.rank ?? null },
      queries: [...queries.values()].map((q) => ({ query: q.query, filed: q.filed, engines: [...q.engines] })),
      organic,
      ourSeen,
      ourSeenWhy,
      mapPack,
      ai: [...aiBy.entries()].map(([name, e]) => ({ name, engines: [...e] })).slice(0, 8),
      theirs,
      ours: mine,
      gap,
      search,
      brief: briefFor(cl, key, [...queries.keys()], organic, mine, w.day, ourSeen),
    });
  }
  out.sort((a, b) => PRIORITY_RANK[a.cluster.priority] - PRIORITY_RANK[b.cluster.priority] || (a.cluster.rank ?? 999) - (b.cluster.rank ?? 999) || b.organic.length - a.organic.length || a.cluster.name.localeCompare(b.cluster.name));
  return ok(out, "desk", w.at, "Who ranks is what the audit saw on its day, Balkaris's own place among them where the capture records it; their pages as the desk read them; ours as the crawl read it.");
}

/** A brief built only from the facts on the page; under the operator's 1,000 characters. */
function briefFor(cl: Cluster | undefined, key: string, queries: string[], organic: RivalPage[], mine: OurPage | null, day: string | null, ourSeen: { position: number; query: string }[] = []): ClusterCompare["brief"] {
  const name = cl?.name ?? key;
  const lang = (cl?.lang ?? "en") === "de" ? "German (de-CH)" : "English";
  const facts = (r: RivalPage): string => {
    const p = r.page;
    if (!p || p.error) return `${r.domain} at ${r.position}`;
    const bits = [p.address === "home" ? "home page" : p.address === "topic" ? "its page for this topic" : "the page that ranks", langName(p.lang), p.words !== null ? `${n0(p.words)} words` : null, p.schemaTypes.includes("FAQPage") ? "FAQ markup" : null, p.priceStated ? `states “${p.priceText ?? "a price"}”` : "no price"];
    return `${r.domain} at ${r.position} (${bits.filter(Boolean).join(", ")})`;
  };
  const head = `A ${lang} page for “${name}”, to compete in the searches captured${day ? ` on ${day}` : ""}: ${queries
    .slice(0, 3)
    .map((q) => `“${q}”`)
    .join(", ")}.`;
  const ourLine = mine
    ? `Our page now: ${mine.page.path} (${langName(mine.lang)}${mine.words !== null ? `, ${n0(mine.words)} words` : ""}${mine.faq ? ", FAQ markup" : ", no FAQ markup"}${mine.price === false ? ", no price stated" : ""}).`
    : "Balkaris has no page for it yet.";
  const placed = ourSeen[0] ? ` In the capture Balkaris was at ${ourSeen[0].position} for “${ourSeen[0].query}”.` : "";
  const tail = "Answer the searcher's question first, say who does the work and where (Balkaris, Zürich, Switzerland), add the questions clients ask, and leave every price for the owner to fill in.";
  let rivals = organic.slice(0, 4);
  for (;;) {
    const who = rivals.length ? `Who ranks, as the desk read their pages: ${rivals.map(facts).join("; ")}.` : "";
    const prompt = [head, who, `${ourLine}${placed}`, tail].filter(Boolean).join(" ");
    if (prompt.length <= 990 || !rivals.length) {
      return {
        task: { kind: "brief", prompt: prompt.slice(0, 990), depth: "deep" },
        label: mine ? "Brief to compete" : "Brief a page",
        step: `Queues a brief for the AI Operator on the studio workstation: ${mine ? `what ${mine.page.path} needs` : `a ${lang} page`} to stand beside who ranks for “${name}”. Nothing on the website changes.`,
      };
    }
    rivals = rivals.slice(0, -1);
  }
}

/* ---------- a site looked up, beside Balkaris ------------------------------------------------------ */

/** Lookups still reading in the background (a slow fact, PageSpeed above all), by domain. */
const looking = new Map<string, number>();
const OWN_DOMAIN = "balkaris.ch";

function ownSite(o: Ours | null): OwnSite {
  if (!o) return { sitemapPages: null, languages: [], schemaTypes: [], at: null };
  const langs = new Set<string>();
  for (const p of o.sitemap) {
    if (p.lang) langs.add(p.lang.split("-")[0]!.toLowerCase());
    for (const l of o.hreflang.get(p.path) ?? []) if (l && l !== "x-default") langs.add(l.split("-")[0]!.toLowerCase());
  }
  return { sitemapPages: o.view.at ? o.sitemap.length : null, languages: [...langs].sort(), schemaTypes: [...new Set(o.sitemap.flatMap((p) => p.schemaTypes))].sort(), at: o.view.at ?? null };
}

function lookupOf(asked: string, w: World, all: CompetitorRow[], o: () => Ours): Reading<LookupCard> {
  const d = web.domainOf(asked);
  if (!d.ok) return off("desk", `The desk does not read that: ${d.why}.`, "Type a site's address or its domain, like example.ch.");
  const facts = web.domainFacts(d.domain);
  const pending = (looking.get(d.domain) ?? 0) > Date.now() - 180_000;
  if (!facts) {
    return pending
      ? waiting("desk", `${d.domain} is being looked up: its facts arrive within a minute. Reload to see them.`)
      : off("desk", `${d.domain} has not been looked up in the last seven days.`, "Press Look up to read what the open web says about it: one of today's domain lookups.");
  }
  let mine: Ours | null = null;
  try {
    mine = o();
  } catch {
    mine = null;
  }
  const rows = lookupRows(facts, web.domainFacts(OWN_DOMAIN), ownSite(mine));
  const key = root(w, d.domain);
  const known = all.find((r) => r.domain === key) ?? null;
  const pages = (db.prepare("SELECT COUNT(*) AS n FROM cc_seo_comp_pages WHERE domain = ?").get(d.domain) as { n: number }).n;
  const lang = (facts.facts.home.state === "ok" ? facts.facts.home.value.lang?.slice(0, 2) : null) as WebLang | null;
  return ok<LookupCard>(
    {
      asked,
      domain: d.domain,
      home: facts.home,
      asOf: facts.asOf,
      line: pending ? `${facts.line} Some facts are still being read: reload in a moment.` : facts.line,
      pending,
      rows,
      known: known ? { key: known.domain, name: known.name, sightings: known.sightings, decision: known.decision ?? null } : null,
      pages,
      allowance: web.domainAllowance(),
      paid: keptPaid(d.domain, lang && LANGS.includes(lang) ? lang : "de"),
      brief: lookupBrief(facts, rows),
    },
    "desk",
    facts.asOf,
    "Each fact names who said it and when; a fact is kept seven days, so a second look asks nothing. Balkaris's side is the lookup of balkaris.ch, or the desk's own crawl where that lookup could not say it.",
  );
}

/** The list key a domain has, merges followed. */
function root(w: World, domain: string): string {
  let x = domain;
  for (let i = 0; i < 8; i++) {
    const m = w.decisions.get(x)?.mergedInto;
    if (!m || m === x) break;
    x = m;
  }
  return x;
}

/* ---------- who ranks: the result-page checks -------------------------------------------------------- */

/** Who came, went or moved between two captures of one phrase and engine. */
function changesOf(now: { host: string; position: number }[], before: { host: string; position: number }[] | null, since: string | null): SerpChange | null {
  if (!before || !since) return null;
  const a = new Map(now.map((r) => [r.host, r.position]));
  const b = new Map(before.map((r) => [r.host, r.position]));
  return {
    since,
    newcomers: [...a.keys()].filter((h) => !b.has(h)),
    gone: [...b.keys()].filter((h) => !a.has(h)),
    moved: [...a.entries()].filter(([h, p]) => b.has(h) && b.get(h) !== p).map(([host, to]) => ({ host, from: b.get(host)!, to })),
  };
}

function viewOf(check: SerpCheck | null, w: World): SerpView | null {
  if (!check) return null;
  const { page, ...rest } = check;
  const rows = (page?.organic ?? []).map((r) => {
    const key = domainKey(r.host) ?? r.host;
    return { position: r.position, title: r.title, url: r.url, host: r.host, key: root(w, key), known: w.byKey.has(root(w, key)), ours: /balkaris/i.test(r.host) };
  });
  let changes: SerpChange | null = null;
  if (check.state === "done" && page) {
    const before = web.serpHistory(check.phrase, { lang: check.lang, engine: check.engine, limit: 6 }).find((x) => x.id !== check.id && x.state === "done" && x.page && (x.doneAt ?? "") < (check.doneAt ?? ""));
    changes = changesOf(
      page.organic.map((r) => ({ host: domainKey(r.host) ?? r.host, position: r.position })),
      before?.page ? before.page.organic.map((r) => ({ host: domainKey(r.host) ?? r.host, position: r.position })) : null,
      before?.doneAt ?? null,
    );
  }
  return { check: rest, rows, local: page?.localPack ?? [], related: page?.related ?? [], questions: page?.questions ?? [], ads: page?.ads ?? 0, changes };
}

function serpOf(a: CompetitorsAsked, w: World): Reading<SerpPanel> {
  const lane = web.googleLane();
  const configured = web.dataforseoConfigured();
  const latest = a.serp ? web.latestSerp(a.serp, a.serpLang ?? undefined) : null;
  /* A check still waiting stands in for Google's when no done one is kept, so the person sees its state. */
  const google = latest ? (latest.google ?? (latest.pending?.engine === "google" ? latest.pending : null)) : null;
  const recent = web.recentSerps(12).map((r) => ({ id: r.id, phrase: r.phrase, lang: r.lang, engine: r.engine, state: r.state, label: r.label, requestedAt: r.requestedAt, doneAt: r.doneAt, ownPosition: r.ownPosition, requestedBy: r.requestedBy, line: r.line }));
  return ok<SerpPanel>(
    {
      lane,
      dataforseo: { configured, step: configured ? null : web.dataforseoStep() },
      phrase: a.serp ?? null,
      lang: a.serpLang ?? null,
      google: viewOf(google, w),
      duckduckgo: viewOf(latest?.duckduckgo ?? null, w),
      recent,
      langs: LANGS,
    },
    "desk",
    recent[0]?.doneAt ?? recent[0]?.requestedAt ?? new Date().toISOString(),
    "Google's page is fetched by the studio workstation from its own line (or bought from DataForSEO when it is connected); DuckDuckGo's is read by the server and is a second opinion, never Google's ranking. Every result of a finished check is kept as an observation.",
  );
}

/* ---------- the captured searches ----------------------------------------------------------------------- */

function searchesOf(a: CompetitorsAsked, w: World, qfig: Context["qfig"], span: SeoSpan | null): Reading<SearchPanel> {
  const google = [...w.groups.flatMap((g) => g.rows.map((s) => ({ g, s }))), ...w.ours.map((s) => ({ g: null as Group | null, s }))].filter(({ s }) => inGoogle(s));
  if (!google.length) return off("desk", "No Google result page is captured yet.", "Check who ranks for a phrase above, or record a Google result you looked at by hand.");
  const byQuery = new Map<string, { g: Group | null; s: SightingRow & Filed }[]>();
  for (const x of google) byQuery.set(x.s.query, [...(byQuery.get(x.s.query) ?? []), x]);
  const window = span ? `${dayText(span.start)} – ${dayText(span.end)}` : null;
  const build = (query: string, full: boolean): CapturedSearch => {
    const list = byQuery.get(query)!;
    const days = [...new Set(list.map((x) => x.s.day))].sort().reverse();
    const newest = days[0]!;
    const atNewest = list.filter((x) => x.s.day === newest);
    const first = list[0]!.s;
    const own = atNewest.find((x) => !x.g && x.s.kind === "organic" && x.s.position !== null);
    const f = qfig?.get(normal(query));
    const ours: CapturedSearch["ours"] = own
      ? { position: own.s.position, how: "capture", line: `#${own.s.position} in the capture of ${dayText(newest)}` }
      : f && f.impressions && f.position !== null
        ? { position: f.position, how: "search-console", line: `Not in the capture; Search Console's average ${f.position} over ${window} (a stand-in, not the same page)` }
        : { position: null, how: null, line: w.ours.some((s) => s.query === query) ? "Not in this capture" : !qfig ? "Not recorded in the capture; Search Console's history is not on this desk yet" : `Not recorded in the capture, and not shown for it in Search Console over ${window}` };
    const out: CapturedSearch = {
      query,
      lang: first.lang,
      cluster: w.clusterName(first.cluster),
      filed: first.filed,
      days,
      by: atNewest[0]!.s.by,
      sites: new Set(atNewest.filter((x) => x.g).map((x) => x.g!.key)).size,
      ours,
    };
    if (full) {
      const organicAt = (day: string) =>
        list
          .filter((x) => x.s.day === day && x.s.kind === "organic" && x.s.position !== null)
          .sort((p, q) => p.s.position! - q.s.position!);
      out.organic = organicAt(newest).map((x) => ({ position: x.s.position!, key: x.g?.key ?? OWN_DOMAIN, name: x.g ? (x.g.key.startsWith("name:") ? x.g.key.slice(5) : (w.names.get(x.g.key) ?? x.g.key)) : "Balkaris", url: x.s.url ?? null, title: x.s.title ?? null, ours: !x.g }));
      out.mapPack = atNewest.filter((x) => x.s.kind === "local-pack" && x.s.position !== null).sort((p, q) => p.s.position! - q.s.position!).map((x) => ({ position: x.s.position!, name: x.s.name ?? (x.g?.key.startsWith("name:") ? x.g.key.slice(5) : (x.g?.key ?? "")) }));
      out.changes = days[1] ? changesOf(organicAt(newest).map((x) => ({ host: x.g?.key ?? OWN_DOMAIN, position: x.s.position! })), organicAt(days[1]).map((x) => ({ host: x.g?.key ?? OWN_DOMAIN, position: x.s.position! })), days[1]) : null;
    }
    return out;
  };
  const rows = [...byQuery.keys()].map((q) => build(q, false)).sort((x, y) => (y.days[0] ?? "").localeCompare(x.days[0] ?? "") || x.query.localeCompare(y.query));
  return ok<SearchPanel>(
    {
      rows,
      unfiled: rows.filter((r) => !r.cluster).length,
      clusters: [...w.clusters.values()].map((c) => ({ key: c.key, name: c.name, lang: c.lang })).sort((x, y) => x.name.localeCompare(y.name)),
      chosen: a.search && byQuery.has(a.search) ? build(a.search, true) : null,
    },
    "desk",
    w.at,
    "Each search as captured: by the SEO audit in the owner's Chrome, a check through the workstation, or a person by hand. Our place is the capture's where it has one; Search Console's average is shown as a stand-in, labelled, where it has none.",
  );
}

/* ---------- the answer ------------------------------------------------------------------------ */

routes.get("/", async (c) => {
  const range = rangeFrom(c);
  const h = head(range);
  const asked = askedOf((k) => c.req.query(k));
  const owner = !!me(c)?.owner;

  let w: World;
  try {
    w = world();
  } catch (e) {
    const why = `The desk could not read its record of competitors: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
    const none = off<Stat>("desk", why);
    return c.json<SeoCompetitorsPayload>({
      head: h,
      asked,
      tiles: { seen: none, google: none, ai: none, pages: none, clusters: none },
      list: off("desk", why),
      selected: null,
      lacks: off("desk", why),
      directories: off("desk", why),
      clusters: off("desk", why),
      rules: { filing: FILING, joining: JOINING, observed: observed(null, true) },
      refresh: refreshOf([], 0),
      owner,
      lookup: null,
      serp: off("desk", why),
      searches: off("desk", why),
    });
  }

  const all = w.groups.map((g) => rowOf(g, w));
  const active = all.filter((r) => !r.decision?.ignore);
  let o: Ours | null = null;
  const oursOnce = (): Ours => (o ??= ours());
  const span = h.span;
  let qfig: Context["qfig"] = null;
  try {
    qfig = span ? new Map(queryFigures(span.start, span.end).map((r) => [normal(r.query), { clicks: r.clicks, impressions: r.impressions, position: r.position }])) : null;
  } catch {
    qfig = null;
  }
  const t = (() => {
    try {
      return tally();
    } catch {
      return [];
    }
  })();
  const packs = new Set(w.raw.filter((s) => s.kind === "local-pack").map((s) => `${s.query}|${s.day}`));
  const oursInPacks = new Set(w.raw.filter((s) => s.kind === "local-pack" && isOurs(s)).map((s) => `${s.query}|${s.day}`)).size;
  let gbp = "";
  try {
    const p = profiles().find((x) => x.key === "google-business-profile");
    gbp = !p ? "No Business Profile is in the registry." : p.state === "exists" ? "The Business Profile exists." : p.napSeen ? `The Business Profile exists as the audit saw it on ${dayText(p.napSeen.day)}; a plain request cannot read Google Maps.` : `Business Profile: ${p.stateWhy}`;
  } catch {
    gbp = "";
  }
  const ctxOnce = (): Context => ({
    w,
    o: oursOnce(),
    span,
    qfig,
    task: taskRefs(),
    ai: { asked: t.reduce((n, e) => n + e.unprompted.asked, 0), named: t.reduce((n, e) => n + e.unprompted.mentioned, 0) },
    mapPacks: { searches: packs.size, ours: oursInPacks },
    gbp,
  });
  let ctx: Context | null = null;
  const context = (): Context => (ctx ??= ctxOnce());

  const list = await reading("desk", () => listOf(w, all, asked));
  let selected: SeoCompetitorsPayload["selected"] = null;
  if (list.state === "ok") {
    /* ?open= is matched as typed, as a host (scheme, www. and path taken off), and through a merge; a key that is not there says so instead of opening another. */
    const key = asked.open ? root(w, openKeyOf(asked.open)) : null;
    const askedFor = key ? (w.byKey.get(key) ?? w.groups.find((g) => g.aliases.some((x) => `name:${x}` === asked.open)) ?? null) : null;
    if (asked.open && !askedFor) selected = off("desk", `No competitor ${asked.open} is in the desk's record.`, typedHost(asked.open) ? `Look it up instead: ${typedHost(asked.open)}.` : undefined);
    else {
      const g = askedFor ?? (list.value.rows[0] ? w.byKey.get(list.value.rows[0].domain) : undefined) ?? null;
      if (g) selected = await reading("desk", () => ok(detailOf(g, context()), "desk", w.at, "Where it was seen, what its pages say, and the same things of ours beside them."));
    }
  }

  const [lacks, directories, clusterList, lookup, serp, searches] = await Promise.all([
    reading("desk", () => lacksOf(context())),
    reading("desk", () => directoriesOf(context())),
    reading("desk", () => clustersOf(context())),
    asked.look ? reading("desk", () => lookupOf(asked.look!, w, all, oursOnce)) : Promise.resolve(null),
    reading("desk", () => serpOf(asked, w)),
    reading("desk", () => searchesOf(asked, w, qfig, span)),
  ]);

  return c.json<SeoCompetitorsPayload>({
    head: h,
    asked,
    tiles: tilesOf(w, active),
    list,
    selected,
    lacks,
    directories,
    clusters: clusterList,
    rules: { filing: FILING, joining: JOINING, observed: observed(w.day, w.raw.every((s) => s.by === "audit")) },
    refresh: refreshOf(w.allPages, duePages().length),
    owner,
    lookup,
    serp,
    searches,
  });
});

/** The weekly read's own figures: every page on its list, platforms' included; "read" is a page that answered and was read. */
function refreshOf(pages: Page[], due: number): SeoCompetitorsPayload["refresh"] {
  let j: ReturnType<typeof jobStatus>[number] | undefined;
  try {
    j = jobStatus().find((x) => x.name === "seo-competitors");
  } catch {
    j = undefined;
  }
  /* The job's note is a sentence of its own: without its closing stop, so the page can end it once. */
  const lastNote = j?.lastNote ? scrub(j.lastNote).trim().replace(/[.\s]+$/, "") || null : null;
  const newestRead = pages.map((p) => p.fetchedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return {
    lastRun: j?.lastEnd ?? null,
    lastNote,
    nextRun: j?.nextRun ?? null,
    pages: pages.length,
    fetched: pages.filter(readOk).length,
    failed: pages.filter((p) => p.fetchedAt !== null && !readOk(p)).length,
    due,
    registered: !!j,
    running: !!j?.running,
    newestRead,
  };
}

/* ---------- what a person does here ------------------------------------------------------------------- */

const fail = (status: 400 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message });
};
const who = (c: Parameters<typeof me>[0]): string => me(c)?.name ?? "desk";
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Run something after the answer, never letting it throw into the void. */
const later = (what: string, f: () => Promise<unknown>): void => {
  void f().catch((e) => note("seo-competitors", `${what} did not finish`, { tone: "warn", detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) }));
};

/** How long a lookup may hold the answer before it goes on in the background. */
export const LOOKUP_WAIT_MS = { value: 25_000 };

/**
 * POST /lookup { input, fresh? }: what the open web says about any site,
 * through the web layer (one of today's domain lookups; kept seven days).
 * Balkaris's own domain is looked up beside it when nothing of ours is kept.
 * A slow fact (PageSpeed) goes on after the answer; the card says so.
 */
routes.post("/lookup", async (c) => {
  const b = await body(c);
  const input = text(b.input, 200);
  if (input.length < 3) fail(400, "Type a site's address or its domain, like example.ch.");
  const d = web.domainOf(input);
  if (!d.ok) fail(400, `The desk does not read that: ${d.why}.`);
  const domain = (d as { domain: string }).domain;
  const by = who(c);
  looking.set(domain, Date.now());
  const run = web.lookupDomain(input, by, { fresh: b.fresh === true }).finally(() => looking.delete(domain));
  if (!web.domainFacts(OWN_DOMAIN) && domain !== OWN_DOMAIN) later("The lookup of balkaris.ch", () => web.lookupDomain(OWN_DOMAIN, by));
  const got = await Promise.race([run.then((f) => ({ f })), new Promise<null>((r) => setTimeout(() => r(null), LOOKUP_WAIT_MS.value))]);
  if (!got) {
    run.catch(() => {});
    return c.json({ ok: true, domain, href: `/seo/competitors?look=${encodeURIComponent(domain)}`, line: `Looking up ${domain}: most facts are in, the slow ones arrive within a minute.` });
  }
  return c.json({ ok: true, domain, href: `/seo/competitors?look=${encodeURIComponent(domain)}`, line: got.f.line });
});

/**
 * POST /watch { input, watch }: put a site on the list as a competitor a
 * person chose (its home page read at once), or stop watching it.
 */
routes.post("/watch", async (c) => {
  const b = await body(c);
  const input = text(b.input ?? b.domain, 200);
  const d = web.domainOf(input);
  if (!d.ok) fail(400, `The desk does not read that: ${d.why}.`);
  const domain = (d as { domain: string }).domain;
  if (/balkaris/i.test(domain)) fail(400, "Balkaris is the studio itself, not a competitor.");
  const by = who(c);
  if (b.watch === false) {
    decide(domain, { watch: false }, by);
    return c.json({ ok: true, domain, line: `${domain} is no longer watched. Its observations stay; it leaves the list when it has none.` });
  }
  const kept = web.domainFacts(domain);
  const home = kept?.facts.home.state === "ok" ? kept.facts.home.value.url : `https://${(d as { host: string }).host}/`;
  const name = kept?.facts.home.state === "ok" ? (kept.facts.home.value.title?.split(/\s[|–—-]\s/)[0]?.trim().slice(0, 80) ?? null) : null;
  const w = watchSite(domain, name, by, home);
  later(`Reading ${domain}'s home page`, () => refreshPages(() => {}, { domain, most: 4 }));
  return c.json({ ok: true, domain, href: `/seo/competitors?open=${encodeURIComponent(domain)}`, line: `${domain} is watched as a competitor${w.added ? "; its home page is being read now" : ""}. It is on the list as added by ${by}.` });
});

/**
 * POST /decide { domain, ignore?, kind?, mergeInto? }: a person's word on a
 * row. ignore hides it (its observations are kept); kind "platform" or
 * "studio" overrides the platform list ("auto" gives it back); mergeInto
 * counts it as another row (null undoes it).
 */
routes.post("/decide", async (c) => {
  const b = await body(c);
  const domain = text(b.domain, 200);
  if (!domain) fail(400, "Name the competitor: its key as the list shows it.");
  const w = world();
  if (!w.raw.some((s) => s.domain === domain) && !w.byKey.has(domain) && !w.decisions.has(domain)) fail(404, `No competitor ${domain} is in the desk's record.`);
  const change: Parameters<typeof decide>[1] = {};
  const said: string[] = [];
  if (typeof b.ignore === "boolean") {
    change.ignore = b.ignore;
    said.push(b.ignore ? "ignored: hidden from the list and its counts, its observations kept" : "no longer ignored");
  }
  if (b.kind !== undefined) {
    if (b.kind !== "platform" && b.kind !== "studio" && b.kind !== "auto") fail(400, "kind is platform, studio or auto.");
    change.kind = b.kind === "auto" ? null : (b.kind as "platform" | "studio");
    said.push(b.kind === "auto" ? "a platform or not by the desk's list again" : b.kind === "platform" ? "counted as a directory or platform" : "counted as a site or company, not a platform");
  }
  if (b.mergeInto !== undefined) {
    const into = b.mergeInto === null ? null : text(b.mergeInto, 200);
    if (into === domain) fail(400, "A competitor cannot be merged into itself.");
    if (into && root(w, into) === domain) fail(409, `${into} is already counted as ${domain}: merge the other way, or undo that first.`);
    if (into && !w.byKey.has(root(w, into))) fail(404, `No competitor ${into} is on the list to merge into.`);
    change.mergedInto = into || null;
    said.push(into ? `counted as ${into} from now on` : "counted on its own again");
  }
  if (!said.length) fail(400, "Say what to change: ignore, kind or mergeInto.");
  decide(domain, change, who(c));
  return c.json({ ok: true, domain, line: `${domain.startsWith("name:") ? domain.slice(5) : domain}: ${said.join("; ")}.` });
});

/**
 * POST /read { domain }: read a competitor's sitemap for the pages that
 * answer our clusters (they join the weekly read under that cluster, which
 * Content Gaps reads too), then read its due pages now, in the background.
 */
routes.post("/read", async (c) => {
  const b = await body(c);
  const d = web.domainOf(text(b.domain, 200));
  if (!d.ok) fail(400, `The desk does not read that: ${d.why}.`);
  const domain = (d as { domain: string }).domain;
  if (!readable(domain) && decisions().get(domain)?.kind !== "studio") fail(409, `${domain} is a platform: its pages are not read as a competitor's. Count it as a site first.`);
  const kept = web.domainFacts(domain);
  const home = kept?.facts.home.state === "ok" ? kept.facts.home.value.url : `https://${(d as { host: string }).host}/`;
  const sitemaps = kept?.facts.robots.state === "ok" ? kept.facts.robots.value.sitemaps : [];
  const siteLang = kept?.facts.home.state === "ok" ? (kept.facts.home.value.lang?.slice(0, 2) ?? null) : null;
  const got = await topicPages(domain, home, sitemaps, 8, siteLang);
  later(`Reading ${domain}'s pages`, () => refreshPages(() => {}, { domain, most: 12 }));
  return c.json({ ok: true, domain, added: got.added.length, line: `${got.line} Reading its due pages now, two seconds apart.` });
});

/**
 * POST /serp { phrase, lang? }: who ranks for a phrase, through the web
 * layer: Google through the studio workstation (or DataForSEO when it is
 * connected), and DuckDuckGo's second opinion. The phrase is filed under our
 * cluster first, so its results carry the cluster on every tab.
 */
routes.post("/serp", async (c) => {
  const b = await body(c);
  const phrase = normal(text(b.phrase, 160));
  const lang = typeof b.lang === "string" && LANGS.includes(b.lang as WebLang) ? (b.lang as WebLang) : undefined;
  const cluster = phrase.length >= 2 ? (web.fileUnder(phrase, lang ?? null)?.key ?? null) : null;
  const asked = await web.requestSerp({ phrase, lang, by: who(c), clusterKey: cluster });
  const l = asked.google?.lang ?? asked.duckduckgo?.lang ?? lang ?? "de";
  return c.json({ ok: true, line: asked.line, href: `/seo/competitors?serp=${encodeURIComponent(phrase)}&serpLang=${l}`, google: asked.google?.id ?? null, duckduckgo: asked.duckduckgo?.id ?? null });
});

/**
 * POST /paid { domain, lang? }: what DataForSEO says about a domain (what it
 * ranks for on google.ch, its visibility, its links), bought at a person's
 * press and kept seven days. While there is no account it refuses with the
 * owner's step and buys nothing.
 */
routes.post("/paid", async (c) => {
  const b = await body(c);
  const d = web.domainOf(text(b.domain, 200));
  if (!d.ok) fail(400, `The desk does not read that: ${d.why}.`);
  if (!web.dataforseoConfigured()) fail(409, `DataForSEO is not connected: no account exists. ${web.dataforseoStep()}`);
  const lang = typeof b.lang === "string" && LANGS.includes(b.lang as WebLang) ? (b.lang as WebLang) : "de";
  const domain = (d as { domain: string }).domain;
  const got = await web.paidDomainFacts(domain, lang, who(c));
  const had = [got.overview, got.ranked, got.competitors, got.backlinks].filter((f) => f.state === "ok").length;
  return c.json({ ok: true, domain, line: `DataForSEO answered ${had} of 4 questions about ${domain}; kept seven days.` });
});

/** POST /serp/:id/withdraw: take back a Google check still waiting for the workstation. */
routes.post("/serp/:id/withdraw", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) fail(400, "That is not a check's number.");
  const check = web.serpCheck(id);
  if (!check) fail(404, `There is no check ${id}.`);
  const state: Record<SerpCheck["state"], string> = { queued: "still queued", running: "being fetched now", done: "finished", failed: "over (it failed, or was taken back)" };
  if (!web.withdrawSerp(id, who(c))) fail(409, `Check ${id} is ${state[check!.state]}: only a check still queued can be taken back.`);
  return c.json({ ok: true, line: `Check ${id} for “${check!.phrase}” is taken back; nothing is asked of Google for it.` });
});

/**
 * POST /record { phrase, lang, day, results, mapPack?, ours } (the owner's):
 * a Google result page he looked at in his own browser, one result per line
 * ("1 https://example.ch/page" or just the address, in order).
 */
routes.post("/record", requireOwner, async (c) => {
  const b = await body(c);
  const phrase = normal(text(b.phrase, 160));
  if (phrase.length < 2 || phrase.length > 120) fail(400, "Write the search as it was typed: 2 to 120 characters.");
  const lang = typeof b.lang === "string" && LANGS.includes(b.lang as WebLang) ? (b.lang as WebLang) : ((langOf(phrase) ?? "de") as WebLang);
  const day = text(b.day, 10);
  if (!/^\d{4}-\d\d-\d\d$/.test(day) || Number.isNaN(Date.parse(day)) || day > new Date().toISOString().slice(0, 10)) fail(400, "day is the day you looked, YYYY-MM-DD, not in the future.");
  const lines = (typeof b.results === "string" ? b.results : "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) fail(400, "Write the results, one per line, in the order Google showed them.");
  if (lines.length > 20) fail(400, "At most 20 results: the first page is ten.");
  const organic: { position: number; domain: string; url: string | null }[] = [];
  const bad: string[] = [];
  lines.forEach((l, i) => {
    const m = /^(\d{1,2})[.)]?\s+(.+)$/.exec(l);
    const position = m ? Number(m[1]) : i + 1;
    const addr = (m ? m[2]! : l).trim();
    const host = typedHost(addr);
    if (!host) return void bad.push(addr);
    organic.push({ position, domain: domainKey(host)!, url: /^https?:\/\//i.test(addr) ? addr : null });
  });
  if (bad.length) fail(400, `Not an address: ${bad.slice(0, 3).join(", ")}. Write each result as its address (example.ch/page).`);
  if (new Set(organic.map((o) => o.position)).size !== organic.length) fail(400, "Two results have the same place.");
  const mapPack = (typeof b.mapPack === "string" ? b.mapPack : "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((name, i) => ({ position: i + 1, name: name.slice(0, 120) }));
  const ours = b.ours === null || b.ours === undefined || b.ours === "" ? null : Number(b.ours);
  if (ours !== null && (!Number.isInteger(ours) || ours < 1 || ours > 100)) fail(400, "ours is Balkaris's place, 1 to 100, or empty when it was not there.");
  const cluster = web.fileUnder(phrase, lang)?.key ?? null;
  const done = recordByHand({ phrase, lang, cluster, day, organic: organic.filter((o) => !/balkaris/i.test(o.domain)), mapPack, ours: ours ?? organic.find((o) => /balkaris/i.test(o.domain))?.position ?? null, by: who(c) });
  return c.json({ ok: true, line: done.line, href: `/seo/competitors?search=${encodeURIComponent(phrase)}` });
});

/** POST /file { query, cluster }: file a captured search under one of our clusters by hand (null: under none). */
routes.post("/file", async (c) => {
  const b = await body(c);
  const query = text(b.query, 200);
  if (!query) fail(400, "Name the search to file.");
  if (!sightings().some((s) => s.query === query)) fail(404, `No captured search “${query}” is in the desk's record.`);
  const cluster = b.cluster === null || b.cluster === "" ? null : text(b.cluster, 80);
  const list = allClusters();
  if (cluster && !list.some((x) => x.key === cluster)) fail(400, "That is not one of our clusters.");
  const n = fileSearch(query, cluster, who(c));
  const name = cluster ? (list.find((x) => x.key === cluster)?.name ?? cluster) : null;
  return c.json({ ok: true, line: `“${query}” is filed ${name ? `under ${name}` : "under no cluster"} by hand: ${n.sightings} observation${n.sightings === 1 ? "" : "s"} and ${n.pages} page${n.pages === 1 ? "" : "s"} follow, on this tab and on Content Gaps.` });
});

/** GET /export.csv: the list as filtered (every page of it), one row per competitor. */
routes.get("/export.csv", (c) => {
  const asked = askedOf((k) => c.req.query(k));
  const w = world();
  const rows = sorted(filtered(w.groups.map((g) => rowOf(g, w)), w.byKey, asked, null), asked.sort);
  return csvFile(
    c,
    "competitors",
    ["Competitor", "Site", "Platform", "Best Google position", "Best map-pack position", "AI named", "AI cited", "Observations", "Searches", "Clusters", "Pages read", "Pages with a price", "Last seen", "Watched", "Ignored", "Decided by"],
    rows.map((r) => [
      r.name ?? (r.domain.startsWith("name:") ? r.domain.slice(5) : r.domain),
      r.domain.startsWith("name:") ? "" : r.domain,
      r.platform ? "yes" : "no",
      r.bestPosition ?? "",
      r.mapPack ?? "",
      r.named,
      r.cited,
      r.sightings,
      r.queries.join(" | "),
      r.clusters.map((x) => x.name).join(" | "),
      r.pages,
      r.pricePages,
      r.lastSeen,
      r.decision?.watch ? "yes" : "",
      r.decision?.ignore ? "yes" : "",
      r.decision?.by ?? "",
    ]),
  );
});
