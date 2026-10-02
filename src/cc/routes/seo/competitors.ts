import { Hono } from "hono";
import { db } from "../../../db.ts";
import type { Vars } from "../../access.ts";
import { status as jobStatus } from "../../scheduler.ts";
import { off, ok, reading } from "../../store.ts";
import { scrub } from "../../system.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { ReadinessCheck } from "../../../../web/src/contract/seo/ai-search.ts";
import type { Priority, SeoSpan } from "../../../../web/src/contract/seo/common.ts";
import type {
  BesideRow,
  ClusterCompare,
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
import { competitorNames, competitorPages, ENGINE_LABEL, PLATFORMS, sightings, type CompPageRow, type SightingRow } from "../../seo/competitors.ts";
import { clusters as allClusters, type Cluster } from "../../seo/keywords.ts";
import { ownerTasks } from "../../seo/owner.ts";
import { profiles } from "../../seo/presence.ts";
import { queryFigures, rate } from "../../seo/rank.ts";
import { pageReadiness } from "../../seo/readiness.ts";
import { pageRef, type SitePage, type SiteView } from "../../seo/site.ts";
import { langOf, normal, pageWords, PLACES, tokens } from "../../seo/words.ts";
import { head, historyAbsent, historyAt, int, rangeFrom, view } from "./shared.ts";

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

function askedOf(q: (k: string) => string | undefined): CompetitorsAsked {
  const cluster = (q("cluster") ?? "").trim().slice(0, 80);
  const open = (q("open") ?? "").trim().slice(0, 160);
  return {
    engine: pick(ENGINES, q("engine"), "all"),
    type: pick(TYPES, q("type"), "all"),
    cluster: cluster || null,
    q: (q("q") ?? "").trim().slice(0, 80),
    sort: pick(SORTS, q("sort"), "seen"),
    offset: int(q("offset"), 0, 0, 10_000),
    limit: int(q("limit"), LIMIT, 5, 50),
    open: open || null,
  };
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
  filed: "audit" | "words" | null;
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
  return (query, lang, stored) => {
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
}

function world(): World {
  const list = allClusters();
  const clusters = new Map(list.map((c) => [c.key, c]));
  const file = filer(list);
  const raw = sightings();
  const others = raw.filter((s) => !isOurs(s));
  const own = raw.filter(isOurs).map((s) => ({ ...s, ...file(s.query, s.lang, s.cluster) }));
  const names = competitorNames();
  const allPages = competitorPages().map(sane);
  const pages = allPages.filter((p) => !isPlatform(p.domain));
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
  const root = (k: string): string => {
    let x = k;
    for (let i = 0; i < 8 && target.get(x) !== x; i++) x = target.get(x)!;
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
  for (const p of pages) byKey.get(p.domain)?.pages.push(p);
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
  };
}

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
  const organic = g.rows.filter((s) => s.kind === "organic" && s.position !== null).map((s) => s.position!);
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
    platform: isPlatform(g.key),
    engines: engines.map((key) => ({ key, label: ENGINE_LABEL[key] ?? key })),
    mapPack: local.length ? Math.min(...local) : null,
    alsoNamed: g.aliases.filter((a) => a.toLowerCase() !== (name ?? "").toLowerCase()),
    has: hasOf(g.pages),
    clusters: clusterKeys.map((k) => w.clusterName(k)!),
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
    address: p.address,
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
  const searches = new Set(w.groups.flatMap((g) => g.rows.filter((s) => GOOGLE_KINDS.has(s.kind)).map((s) => s.query)));
  const questions = new Set(w.groups.flatMap((g) => g.rows.map((s) => s.query)));
  const inGoogle = studios.filter((r) => r.bestPosition !== null || r.mapPack !== null);
  const inAi = rows.filter((r) => r.named + r.cited > 0);
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
    google: ok(stat(inGoogle.length, `in the top results of ${plural(searches.size, "Google search", "Google searches")}, map pack included`), "desk", at, `${note} Of the sites and companies, platforms apart.`),
    ai: ok(
      stat(inAi.length, asked ? `Balkaris: named in ${named} of ${asked} questions that did not name it` : "No AI check of Balkaris is recorded yet"),
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

function filtered(rows: CompetitorRow[], g: Map<string, Group>, a: CompetitorsAsked, skip: "engine" | "type" | "cluster" | null): CompetitorRow[] {
  const words = a.q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    const group = g.get(r.domain)!;
    if (skip !== "engine" && a.engine === "google" && !group.rows.some((s) => GOOGLE_KINDS.has(s.kind))) return false;
    if (skip !== "engine" && a.engine === "ai" && !group.rows.some((s) => AI_KINDS.has(s.kind))) return false;
    if (skip !== "type" && a.type === "studios" && r.platform) return false;
    if (skip !== "type" && a.type === "platforms" && !r.platform) return false;
    if (skip !== "cluster" && a.cluster && !r.clusters.some((c) => c.key === a.cluster)) return false;
    if (words.length) {
      const hay = `${r.domain} ${r.name ?? ""} ${r.alsoNamed.join(" ")}`.toLowerCase();
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
  if (!w.raw.length) return off("desk", NOTHING, NOTHING_STEP);
  const rows = sorted(filtered(all, w.byKey, a, null), a.sort);
  const forEngines = filtered(all, w.byKey, a, "engine");
  const forTypes = filtered(all, w.byKey, a, "type");
  const forClusters = filtered(all, w.byKey, a, "cluster");
  const has = (r: CompetitorRow, kinds: Set<string>) => w.byKey.get(r.domain)!.rows.some((s) => kinds.has(s.kind));
  const clusterCounts = new Map<string, number>();
  for (const r of forClusters) for (const c of r.clusters) clusterCounts.set(c.key, (clusterCounts.get(c.key) ?? 0) + 1);
  return ok(
    {
      total: rows.length,
      rows: rows.slice(a.offset, a.offset + a.limit),
      engines: [
        { key: "all", label: "All", count: forEngines.length },
        { key: "google", label: "Google results", count: forEngines.filter((r) => has(r, GOOGLE_KINDS)).length },
        { key: "ai", label: "AI answers", count: forEngines.filter((r) => has(r, AI_KINDS)).length },
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
  const organic = g.rows.filter((s) => s.kind === "organic" && s.position !== null).sort((a, b) => a.position! - b.position!);
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
        ? `“${priced[0]!.priceText ?? "a CHF amount"}” on ${priced[0]!.address === "home" ? "its home page" : "the page that ranks"}`
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
    const words = read.filter((p) => p.words !== null).map((p) => `${p.words ? n0(p.words) : "no text in its HTML"} (${p.address === "home" ? "home page" : "the page that ranks"})`);
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
    const same = w.ours.find((s) => s.kind === "organic" && s.position !== null && s.query === best.query && s.day === best.day) ?? null;
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
  };
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
  const platformHits = w.groups.filter((g) => isPlatform(g.key));
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
    .filter((g) => isPlatform(g.key))
    .map((g) => {
      const organic = g.rows.filter((s) => s.kind === "organic" && s.position !== null).map((s) => s.position!);
      const p = profileFor(g.key);
      return {
        domain: g.key,
        name: g.key.startsWith("name:") ? g.key.slice(5) : (w.names.get(g.key) ?? null),
        seen: g.rows
          .map((s) => ({ query: s.query, engineLabel: ENGINE_LABEL[s.engine] ?? s.engine, kind: s.kind, position: s.position, day: s.day }))
          .sort((a, b) => (a.position ?? 99) - (b.position ?? 99)),
        best: organic.length ? Math.min(...organic) : null,
        ours: p ? { key: p.key, name: p.name, state: p.state, stateWhy: p.stateWhy, url: p.url, checkedAt: p.checkedAt } : null,
        task: p?.ownerTaskId ? c.task([p.ownerTaskId]) : null,
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
    const queries = new Map<string, { query: string; filed: "audit" | "words"; engines: Set<string> }>();
    for (const { s } of rows) {
      const q = queries.get(s.query) ?? { query: s.query, filed: s.filed ?? "audit", engines: new Set<string>() };
      q.engines.add(ENGINE_LABEL[s.engine] ?? s.engine);
      queries.set(s.query, q);
    }
    /* who ranks: each site's best organic position across the cluster's searches */
    const bestBy = new Map<string, { g: Group; s: SightingRow & Filed }>();
    for (const r of rows) {
      if (r.s.kind !== "organic" || r.s.position === null) continue;
      const had = bestBy.get(r.g.key);
      if (!had || r.s.position < had.s.position!) bestBy.set(r.g.key, r);
    }
    const qset = new Set(queries.keys());
    const pageFor = (g: Group, query: string): Page | null =>
      g.pages.find((p) => p.address === "ranking" && p.query === query) ?? g.pages.find((p) => p.query !== null && qset.has(p.query) && p.address === "ranking") ?? g.pages.find((p) => p.address === "home") ?? null;
    /* The six shown: "who ranks" and "their pages" are both of these, so every page counted is a site the reader sees. */
    const shown = [...bestBy.values()].sort((a, b) => a.s.position! - b.s.position! || a.g.key.localeCompare(b.g.key)).slice(0, 6);
    const organic: RivalPage[] = shown.map(({ g, s }) => {
      const p = pageFor(g, s.query);
      return {
        domain: g.key,
        name: w.names.get(g.key) ?? null,
        position: s.position!,
        query: s.query,
        page: p ? { url: p.url, address: p.address, words: p.words, lang: p.lang, schemaTypes: p.schemaTypes, priceStated: p.priceStated, priceText: p.priceText, priceDoubt: p.priceDoubt, error: p.error } : null,
      };
    });
    /* our own place in the same captures: the best per search, best first */
    const googleSearches = new Set(rows.filter(({ s }) => s.kind === "organic").map(({ s }) => s.query));
    const ourBest = new Map<string, SightingRow & Filed>();
    for (const s of w.ours) {
      if (s.kind !== "organic" || s.position === null || !(s.cluster === key || googleSearches.has(s.query))) continue;
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
    const bits = [p.address === "home" ? "home page" : "the page that ranks", langName(p.lang), p.words !== null ? `${n0(p.words)} words` : null, p.schemaTypes.includes("FAQPage") ? "FAQ markup" : null, p.priceStated ? `states “${p.priceText ?? "a price"}”` : "no price"];
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

/* ---------- the answer ------------------------------------------------------------------------ */

routes.get("/", async (c) => {
  const range = rangeFrom(c);
  const h = head(range);
  const asked = askedOf((k) => c.req.query(k));

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
      refresh: refreshOf(0, 0),
    });
  }

  const all = w.groups.map((g) => rowOf(g, w));
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
    const askedFor = asked.open ? (w.byKey.get(asked.open) ?? w.groups.find((g) => g.aliases.some((a) => `name:${a}` === asked.open)) ?? null) : null;
    const g = askedFor ?? (list.value.rows[0] ? w.byKey.get(list.value.rows[0].domain) : undefined) ?? null;
    if (g) selected = await reading("desk", () => ok(detailOf(g, context()), "desk", w.at, "Where it was seen, what its pages say, and the same things of ours beside them."));
    else if (asked.open) selected = off("desk", `No competitor ${asked.open} is in the desk's record.`);
  }

  const [lacks, directories, clusterList] = await Promise.all([reading("desk", () => lacksOf(context())), reading("desk", () => directoriesOf(context())), reading("desk", () => clustersOf(context()))]);

  /* The weekly read's own figures: every page on its list, platforms' included. */
  const known = w.allPages.length;
  const fetched = w.allPages.filter((p) => p.fetchedAt !== null).length;
  const newestRead = w.allPages.map((p) => p.fetchedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return c.json<SeoCompetitorsPayload>({
    head: h,
    asked,
    tiles: tilesOf(w, all),
    list,
    selected,
    lacks,
    directories,
    clusters: clusterList,
    rules: { filing: FILING, joining: JOINING, observed: observed(w.day, w.raw.every((s) => s.by === "audit")) },
    refresh: refreshOf(known, fetched, newestRead),
  });
});

function refreshOf(pages: number, fetched: number, newestRead: string | null = null): SeoCompetitorsPayload["refresh"] {
  let j: ReturnType<typeof jobStatus>[number] | undefined;
  try {
    j = jobStatus().find((x) => x.name === "seo-competitors");
  } catch {
    j = undefined;
  }
  /* The job's note is a sentence of its own: without its closing stop, so the page can end it once. */
  const lastNote = j?.lastNote ? scrub(j.lastNote).trim().replace(/[.\s]+$/, "") || null : null;
  return { lastRun: j?.lastEnd ?? null, lastNote, nextRun: j?.nextRun ?? null, pages, fetched, registered: !!j, running: !!j?.running, newestRead };
}
