import { db } from "../../db.ts";
import { addDays, countOn, setCount } from "../search/shared.ts";
import { UA } from "../site/http.ts";
import { note, setState, state, today } from "../store.ts";
import type { Intent, KeywordSource, KeywordStatus } from "../../../web/src/contract/seo/keywords.ts";
import type { Priority } from "../../../web/src/contract/seo/common.ts";
import { lastSnapDay, queryFigures, queryPageFigures } from "./rank.ts";
import { siteView, type SiteView } from "./site.ts";
import { json, now } from "./tables.ts";
import { answers, flagsOf, langOf, normal, pageWords } from "./words.ts";

/**
 * KEYWORDS AND CLUSTERS.
 *
 * A phrase comes from one or more of four places, and keeps all of them:
 *
 *   gsc           Search Console showed the site for it (flows in daily from
 *                 the desk's own history, rank.ts)
 *   autocomplete  the weekly research found it in Google Autocomplete
 *   audit         the SEO audit's table (scripts/seo-import.ts)
 *   manual        a person added it
 *
 * Each phrase may belong to a CLUSTER: a topic in one language ("what a
 * website costs, German"), with an intent, a priority and the page that
 * answers it. A cluster with no page of its language is a GAP; every German
 * cluster is one while the site is English only.
 *
 * WHO DECIDES. The audit's judgement (relevant or not, cluster, priority,
 * page) is the starting point; the desk's rule maps what the audit did not; a
 * person overrides both, and nothing a run or an import does changes a
 * person's choice again.
 */

const ORDER: KeywordSource[] = ["gsc", "autocomplete", "audit", "manual"];
const joinSources = (list: Iterable<string>): string => {
  const s = new Set(list);
  return ORDER.filter((k) => s.has(k)).join(",");
};

export interface KeywordInput {
  phrase: string;
  lang?: string | null;
  cluster?: string | null;
  intent?: Intent | null;
  source: KeywordSource;
  /** More sources the phrase came from at once (the audit's table names where it found each phrase). */
  also?: KeywordSource[];
  status?: KeywordStatus;
  page?: string | null;
  note?: string | null;
  seed?: string | null;
  flags?: { local: boolean; question: boolean; price: boolean };
  /** Who decides the status and mapping given here: the audit, the research, a person. */
  by?: "audit" | "research" | "gsc" | string;
}

interface KeywordDb {
  id: number;
  phrase: string;
  lang: string | null;
  cluster: string | null;
  intent: string | null;
  sources: string;
  status: KeywordStatus;
  status_by: string | null;
  status_at: string | null;
  page: string | null;
  mapped_by: string | null;
  local: number;
  question: number;
  price: number;
  note: string | null;
  seed: string | null;
  first_seen: string;
  last_seen: string;
}

/** Whether a decision was a person's (anything but the desk's own sources). */
const byPerson = (by: string | null): boolean => !!by && !["audit", "rule", "research", "gsc"].includes(by);

/**
 * Add a phrase or add a source to it. Returns "added", "changed" or
 * "unchanged". What a person decided (status, page) is never overwritten.
 */
export function upsertKeyword(k: KeywordInput, at = now()): "added" | "changed" | "unchanged" {
  const phrase = normal(k.phrase);
  if (phrase.length < 2) return "unchanged";
  const had = db.prepare("SELECT * FROM cc_seo_keywords WHERE phrase = ?").get(phrase) as KeywordDb | undefined;
  const flags = k.flags ?? flagsOf(phrase);
  if (!had) {
    db.prepare(
      `INSERT INTO cc_seo_keywords (phrase, lang, cluster, intent, sources, status, status_by, status_at, page, mapped_by, local, question, price, note, seed, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      phrase,
      k.lang ?? langOf(phrase),
      k.cluster ?? null,
      k.intent ?? null,
      joinSources([k.source, ...(k.also ?? [])]),
      k.status ?? "unjudged",
      k.status && k.status !== "unjudged" ? (k.by ?? k.source) : null,
      k.status && k.status !== "unjudged" ? at : null,
      k.page ?? null,
      k.page ? (k.by === "audit" ? "audit" : (k.by ?? "rule")) : null,
      flags.local ? 1 : 0,
      flags.question ? 1 : 0,
      flags.price ? 1 : 0,
      k.note ?? null,
      k.seed ?? null,
      at,
      at,
    );
    return "added";
  }
  const sources = joinSources([...had.sources.split(",").filter(Boolean), k.source, ...(k.also ?? [])]);
  const next = {
    lang: had.lang ?? k.lang ?? langOf(phrase),
    cluster: had.cluster ?? k.cluster ?? null,
    intent: had.intent ?? k.intent ?? null,
    status: had.status,
    status_by: had.status_by,
    page: had.page,
    mapped_by: had.mapped_by,
    note: had.note ?? k.note ?? null,
  };
  /* The audit's judgement replaces the desk's own and an unjudged phrase; never a person's. */
  if (k.by === "audit" && !byPerson(had.status_by) && k.status && k.status !== "unjudged") {
    next.status = k.status;
    next.status_by = "audit";
  }
  /* The audit's page replaces the desk's rule; the audit's "no page" takes back only its own earlier mapping, never the rule's (remap maps what the audit did not). */
  if (k.by === "audit" && !byPerson(had.mapped_by) && k.page !== undefined && (k.page || had.mapped_by !== "rule")) {
    next.page = k.page;
    next.mapped_by = k.page ? "audit" : null;
  }
  if (k.by === "audit" && k.cluster && !byPerson(had.status_by)) next.cluster = k.cluster;
  if (k.by === "audit" && k.intent && !byPerson(had.status_by)) next.intent = k.intent;
  const changed =
    sources !== had.sources ||
    next.lang !== had.lang ||
    next.cluster !== had.cluster ||
    next.intent !== had.intent ||
    next.status !== had.status ||
    next.page !== had.page ||
    next.mapped_by !== had.mapped_by ||
    next.note !== had.note;
  if (!changed) return "unchanged";
  db.prepare(
    "UPDATE cc_seo_keywords SET sources = ?, lang = ?, cluster = ?, intent = ?, status = ?, status_by = ?, status_at = CASE WHEN status <> ? THEN ? ELSE status_at END, page = ?, mapped_by = ?, note = ?, last_seen = ? WHERE id = ?",
  ).run(sources, next.lang, next.cluster, next.intent, next.status, next.status_by, next.status, at, next.page, next.mapped_by, next.note, at, had.id);
  return "changed";
}

export interface ClusterInput {
  key: string;
  name: string;
  lang: string;
  intent: Intent | null;
  priority: Priority;
  rank: number | null;
  page: string | null;
  pageSaid: string | null;
  why: string | null;
  action: string | null;
  examples: string[];
  source: "audit" | "manual";
}

interface ClusterDb {
  key: string;
  name: string;
  lang: string;
  intent: string | null;
  priority: Priority;
  rank: number | null;
  page: string | null;
  mapped_by: string | null;
  page_said: string | null;
  why: string | null;
  action: string | null;
  examples: string;
  source: string;
  first_seen: string;
  updated_at: string;
}

/** Add or update a cluster from the audit. A person's mapping is kept. */
export function upsertCluster(c: ClusterInput, at = now()): "added" | "changed" | "unchanged" {
  const had = db.prepare("SELECT * FROM cc_seo_clusters WHERE key = ?").get(c.key) as ClusterDb | undefined;
  const examples = JSON.stringify(c.examples.slice(0, 12));
  if (!had) {
    db.prepare(
      "INSERT INTO cc_seo_clusters (key, name, lang, intent, priority, rank, page, mapped_by, page_said, why, action, examples, source, first_seen, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(c.key, c.name, c.lang, c.intent, c.priority, c.rank, c.page, c.page ? c.source : null, c.pageSaid, c.why, c.action, examples, c.source, at, at);
    return "added";
  }
  /* A person's mapping is kept; so is the rule's when the audit names no page (the rule maps what the audit did not). */
  const keepPage = byPerson(had.mapped_by) || (!c.page && had.mapped_by === "rule");
  const page = keepPage ? had.page : c.page;
  const mapped = keepPage ? had.mapped_by : c.page ? c.source : null;
  const same =
    had.name === c.name &&
    had.lang === c.lang &&
    had.intent === c.intent &&
    had.priority === c.priority &&
    had.rank === c.rank &&
    had.page === page &&
    had.mapped_by === mapped &&
    had.page_said === c.pageSaid &&
    had.why === c.why &&
    had.action === c.action &&
    had.examples === examples;
  if (same) return "unchanged";
  db.prepare("UPDATE cc_seo_clusters SET name = ?, lang = ?, intent = ?, priority = ?, rank = ?, page = ?, mapped_by = ?, page_said = ?, why = ?, action = ?, examples = ?, updated_at = ? WHERE key = ?").run(
    c.name,
    c.lang,
    c.intent,
    c.priority,
    c.rank,
    page,
    mapped,
    c.pageSaid,
    c.why,
    c.action,
    examples,
    at,
    c.key,
  );
  return "changed";
}

/* ---------- reading ------------------------------------------------------------------------ */

export interface Keyword {
  id: number;
  phrase: string;
  lang: string | null;
  cluster: string | null;
  intent: Intent | null;
  sources: KeywordSource[];
  status: KeywordStatus;
  page: string | null;
  mappedBy: "audit" | "rule" | "person" | null;
  flags: { local: boolean; question: boolean; price: boolean };
  firstSeen: string;
  seed: string | null;
}

const asMapped = (m: string | null): Keyword["mappedBy"] => (m === null ? null : m === "audit" || m === "rule" ? m : "person");

const toKeyword = (r: KeywordDb): Keyword => ({
  id: r.id,
  phrase: r.phrase,
  lang: r.lang,
  cluster: r.cluster,
  intent: (r.intent as Intent | null) ?? null,
  sources: r.sources.split(",").filter(Boolean) as KeywordSource[],
  status: r.status,
  page: r.page,
  mappedBy: asMapped(r.mapped_by),
  flags: { local: !!r.local, question: !!r.question, price: !!r.price },
  firstSeen: r.first_seen,
  seed: r.seed,
});

export function keywords(): Keyword[] {
  return (db.prepare("SELECT * FROM cc_seo_keywords ORDER BY id").all() as unknown as KeywordDb[]).map(toKeyword);
}

export function keywordById(id: number): Keyword | null {
  const r = db.prepare("SELECT * FROM cc_seo_keywords WHERE id = ?").get(id) as KeywordDb | undefined;
  return r ? toKeyword(r) : null;
}

export interface Cluster {
  key: string;
  name: string;
  lang: string;
  intent: Intent | null;
  priority: Priority;
  rank: number | null;
  page: string | null;
  mappedBy: "audit" | "rule" | "person" | null;
  pageSaid: string | null;
  why: string | null;
  action: string | null;
  examples: string[];
  source: string;
}

export function clusters(): Cluster[] {
  return (db.prepare("SELECT * FROM cc_seo_clusters ORDER BY COALESCE(rank, 9999), key").all() as unknown as ClusterDb[]).map((r) => ({
    key: r.key,
    name: r.name,
    lang: r.lang,
    intent: (r.intent as Intent | null) ?? null,
    priority: r.priority,
    rank: r.rank,
    page: r.page,
    mappedBy: asMapped(r.mapped_by),
    pageSaid: r.page_said,
    why: r.why,
    action: r.action,
    examples: json<string[]>(r.examples, []),
    source: r.source,
  }));
}

/* ---------- a person's changes ---------------------------------------------------------------- */

export function setKeywordStatus(id: number, status: KeywordStatus, by: string): Keyword | null {
  db.prepare("UPDATE cc_seo_keywords SET status = ?, status_by = ?, status_at = ? WHERE id = ?").run(status, by, now(), id);
  return keywordById(id);
}

export function setClusterPage(key: string, path: string | null, by: string): Cluster | null {
  db.prepare("UPDATE cc_seo_clusters SET page = ?, mapped_by = ?, updated_at = ? WHERE key = ?").run(path, path ? by : null, now(), key);
  return clusters().find((c) => c.key === key) ?? null;
}

/* ---------- mapping by rule ------------------------------------------------------------------- */

/**
 * Map what the audit and people did not: each phrase to the page of its
 * language whose title, heading or address carries every word of it (place
 * names optional), and each cluster without a page to the page most of its
 * relevant phrases map to. A mapping the rule made before and no longer finds
 * is taken away; the audit's and people's stay. A page the crawl no longer
 * knows leaves the mapping (whoever made it) in place and the reads say so.
 */
export function remap(view: SiteView = siteView()): { keywords: number; clusters: number } {
  if (!view.at) return { keywords: 0, clusters: 0 };
  const candidates = view.pages.filter((p) => p.indexable && p.inSitemap).map((p) => ({ path: p.path, lang: p.lang, words: pageWords({ path: p.path, title: p.title, h1: p.h1 }) }));
  const find = (phrase: string, lang: string | null): string | null => {
    const fits = candidates.filter((c) => (!lang || !c.lang || c.lang === lang) && answers(phrase, c.words));
    /* The shortest address that answers it: the most specific page, not the home page that names everything. */
    return fits.sort((a, b) => b.path.split("/").length - a.path.split("/").length || a.path.length - b.path.length)[0]?.path ?? null;
  };
  let k = 0;
  const update = db.prepare("UPDATE cc_seo_keywords SET page = ?, mapped_by = ? WHERE id = ?");
  for (const r of db.prepare("SELECT id, phrase, lang, page, mapped_by FROM cc_seo_keywords WHERE mapped_by IS NULL OR mapped_by = 'rule'").all() as { id: number; phrase: string; lang: string | null; page: string | null; mapped_by: string | null }[]) {
    const page = find(r.phrase, r.lang);
    if (page !== r.page) {
      update.run(page, page ? "rule" : null, r.id);
      k++;
    }
  }
  let c = 0;
  const byCluster = new Map<string, string[]>();
  for (const r of db.prepare("SELECT cluster, page FROM cc_seo_keywords WHERE cluster IS NOT NULL AND status = 'relevant' AND page IS NOT NULL").all() as { cluster: string; page: string }[]) {
    byCluster.set(r.cluster, [...(byCluster.get(r.cluster) ?? []), r.page]);
  }
  const setPage = db.prepare("UPDATE cc_seo_clusters SET page = ?, mapped_by = ?, updated_at = ? WHERE key = ?");
  for (const cl of db.prepare("SELECT key, lang, page, mapped_by FROM cc_seo_clusters WHERE mapped_by IS NULL OR mapped_by = 'rule'").all() as { key: string; lang: string; page: string | null; mapped_by: string | null }[]) {
    const pages = (byCluster.get(cl.key) ?? []).filter((p) => {
      const lang = view.byPath.get(p)?.lang;
      return !lang || lang === cl.lang;
    });
    const tally = new Map<string, number>();
    for (const p of pages) tally.set(p, (tally.get(p) ?? 0) + 1);
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (best !== cl.page) {
      setPage.run(best, best ? "rule" : null, now(), cl.key);
      c++;
    }
  }
  return { keywords: k, clusters: c };
}

/* ---------- Search Console queries flow in ------------------------------------------------- */

/**
 * Every query of the last 90 days of the desk's history into the keyword
 * table, with its source "gsc". A new query is unjudged until the audit's
 * table or a person says otherwise.
 */
export function syncFromSearch(): { added: number; touched: number } {
  const end = lastSnapDay();
  if (!end) return { added: 0, touched: 0 };
  const rows = queryFigures(addDays(end, -89), end);
  let added = 0;
  let touched = 0;
  const at = now();
  for (const r of rows) {
    const got = upsertKeyword({ phrase: r.query, source: "gsc", by: "gsc" }, at);
    if (got === "added") added++;
    else if (got === "changed") touched++;
  }
  return { added, touched };
}

/** The page Google showed most for each query over a window, from the history. */
export function shownPages(start: string, end: string): Map<string, string> {
  const out = new Map<string, { path: string; impressions: number }>();
  for (const r of queryPageFigures(start, end)) {
    const had = out.get(r.query);
    if (!had || r.impressions > had.impressions) out.set(r.query, { path: r.path, impressions: r.impressions });
  }
  return new Map([...out.entries()].map(([q, v]) => [q, v.path]));
}

/* ---------- the weekly research: Google Autocomplete ------------------------------------- */

/** At most this many requests to Google Autocomplete a week, whoever asks. The counter is in cc_state. */
export const AUTOCOMPLETE_CAP = 120;
/** At most one request a second. */
const GAP_MS = 1100;
const BUDGET_KEY = "seo:autocomplete";
const ASKED_KEY = "seo:autocomplete:asked";
/** A seed is not asked again for eight weeks. */
const REASK_DAYS = 56;

/** The ISO week of a Zurich day: "2026-W40". The budget starts again each Monday. */
export function isoWeek(day: string = today()): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function budget(): { used: number; cap: number; week: string } {
  const week = isoWeek();
  return { used: countOn(BUDGET_KEY, week), cap: AUTOCOMPLETE_CAP, week };
}

/**
 * Take one request from the week's budget, or refuse. Exported so the check
 * script can prove the refusal: the 121st request of a week is never sent.
 */
export function spend(): boolean {
  const week = isoWeek();
  const used = countOn(BUDGET_KEY, week);
  if (used >= AUTOCOMPLETE_CAP) return false;
  setCount(BUDGET_KEY, week, used + 1);
  return true;
}

/** Where the research asks. The check script replaces it with a stand-in. */
export const wire = {
  suggest: async (seed: string, lang: "de" | "en"): Promise<{ status: number; suggestions: string[] }> => {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${lang}&gl=ch&ie=utf-8&oe=utf-8&q=${encodeURIComponent(seed)}`;
    const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": lang === "de" ? "de-CH,de;q=0.9" : "en-CH,en;q=0.9" }, signal: AbortSignal.timeout(15_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const charset = /charset=([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1]?.toLowerCase() ?? "utf-8";
    const text = new TextDecoder(charset === "iso-8859-1" ? "latin1" : charset).decode(buf);
    let suggestions: string[] = [];
    try {
      const v = JSON.parse(text) as unknown[];
      suggestions = Array.isArray(v[1]) ? (v[1] as unknown[]).map(String) : [];
    } catch {
      suggestions = [];
    }
    return { status: res.status, suggestions };
  },
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
};

/**
 * The seeds to ask next: phrases of the clusters, highest priority and
 * earliest rank first, of two to five words, not asked in the last eight
 * weeks. Relevant phrases first; a cluster's own examples when it has none.
 */
function seeds(limit: number): { seed: string; lang: "de" | "en"; cluster: string; intent: Intent | null }[] {
  const asked = json<Record<string, string>>(state(ASKED_KEY), {});
  const since = addDays(today(), -REASK_DAYS);
  const rank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  const out: { seed: string; lang: "de" | "en"; cluster: string; intent: Intent | null }[] = [];
  const list = clusters()
    .filter((c) => c.lang === "de" || c.lang === "en")
    .sort((a, b) => rank[a.priority] - rank[b.priority] || (a.rank ?? 9999) - (b.rank ?? 9999));
  /* One seed per cluster per pass, so a week spreads over many clusters instead of exhausting one. */
  const queues = list.map((c) => {
    const phrases = (db.prepare("SELECT phrase FROM cc_seo_keywords WHERE cluster = ? AND status = 'relevant' ORDER BY id").all(c.key) as { phrase: string }[]).map((r) => r.phrase);
    const pool = [...new Set([...phrases, ...c.examples.map(normal)])].filter((p) => {
      const n = p.split(" ").length;
      return n >= 2 && n <= 5 && !(asked[`${c.lang}:${p}`] && asked[`${c.lang}:${p}`]! >= since);
    });
    return { c, pool };
  });
  for (let round = 0; out.length < limit && queues.some((q) => q.pool.length); round++) {
    for (const q of queues) {
      if (out.length >= limit) break;
      const seed = q.pool.shift();
      if (seed) out.push({ seed, lang: q.c.lang as "de" | "en", cluster: q.c.key, intent: q.c.intent });
    }
  }
  return out;
}

/**
 * The weekly research: expand the clusters' seeds through Google Autocomplete,
 * one request a second, never beyond the week's budget, and keep every
 * suggestion as a phrase of the seed's cluster (unjudged, source
 * "autocomplete"). Stops at Google's first 429 or 5xx.
 */
export async function research(o: { most?: number; progress?: (done: number, of: number, what?: string) => void } = {}): Promise<string> {
  const left = AUTOCOMPLETE_CAP - budget().used;
  if (left <= 0) return `This week's budget of ${AUTOCOMPLETE_CAP} Autocomplete requests is used; nothing was asked.`;
  const list = seeds(Math.min(left, o.most ?? left));
  if (!list.length) {
    return clusters().length
      ? "No seed is due: every cluster phrase was asked in the last eight weeks."
      : "No keyword cluster is known yet, so there is no seed to ask: the clusters come from the audit's keyword table (scripts/seo-import.ts, or POST /api/v1/seo/imports/audit).";
  }
  const asked = json<Record<string, string>>(state(ASKED_KEY), {});
  let sent = 0;
  let added = 0;
  let stopped: string | null = null;
  const at = now();
  for (const [i, s] of list.entries()) {
    if (!spend()) {
      stopped = `the week's budget of ${AUTOCOMPLETE_CAP} is used`;
      break;
    }
    if (sent) await wire.sleep(GAP_MS);
    sent++;
    o.progress?.(i, list.length, s.seed);
    let got: { status: number; suggestions: string[] };
    try {
      got = await wire.suggest(s.seed, s.lang);
    } catch (e) {
      stopped = `Autocomplete did not answer (${e instanceof Error ? e.message : String(e)})`;
      break;
    }
    asked[`${s.lang}:${s.seed}`] = today();
    /* Kept after every request: a run cut short by a restart does not ask the same seeds again. */
    setState(ASKED_KEY, JSON.stringify(asked));
    if (got.status === 429 || got.status >= 500) {
      stopped = `Google answered ${got.status}`;
      break;
    }
    for (const sug of got.suggestions) {
      if (upsertKeyword({ phrase: sug, lang: s.lang, cluster: s.cluster, intent: s.intent, source: "autocomplete", seed: s.seed, by: "research" }, at) === "added") added++;
    }
  }
  setState(ASKED_KEY, JSON.stringify(asked));
  o.progress?.(list.length, list.length);
  const b = budget();
  setState("seo:research:last", JSON.stringify({ at, added, sent }));
  if (added) {
    note("seo-research", `Found ${added} new search phrase${added === 1 ? "" : "s"} in Google Autocomplete`, {
      tone: "info",
      detail: `${sent} request${sent === 1 ? "" : "s"} for the clusters' seeds; ${b.used} of ${b.cap} this week.`,
      href: "/seo/keywords?source=autocomplete&sort=first-seen",
      dedupe: `seo:research:${at}`,
    });
  }
  return `${sent} request${sent === 1 ? "" : "s"}, ${added} new phrase${added === 1 ? "" : "s"}; ${b.used} of ${b.cap} used this week${stopped ? `; stopped: ${stopped}` : ""}`;
}

/** What the last research run found. */
export function lastResearch(): { at: string; added: number; sent: number } | null {
  return json<{ at: string; added: number; sent: number } | null>(state("seo:research:last"), null);
}
