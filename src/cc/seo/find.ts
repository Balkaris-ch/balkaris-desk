import { db } from "../../db.ts";
import { registerSearch } from "../find.ts";
import { RULES } from "../site/rules.ts";
import type { SearchHit } from "../../../web/src/contract/common.ts";
import type { OpportunityType } from "../../../web/src/contract/seo/common.ts";
import { TYPE_LABEL } from "./rules.ts";

/**
 * THE SEO SECTION IN THE TOP BAR'S SEARCH BOX (src/cc/find.ts).
 *
 * Until 5 October 2026 the box knew only the 27 queries Search Console had
 * reported in thirty days: "agentur" found nothing although 224 tracked
 * phrases hold it, and a competitor's domain, an opportunity, an owner's step
 * or a crawl finding could not be found at all. Each searcher below reads one
 * of the SEO engine's own tables, so a keystroke costs no request to anybody.
 *
 *   tracked phrases  cc_seo_keywords       -> the phrase on Keywords (?q= lists it, ?open= opens it)
 *   topic clusters   cc_seo_clusters       -> Keywords filtered to the cluster, or the gap on Content Gaps
 *   competitors      cc_seo_competitors    -> Competitors, opened on that domain (?open=)
 *   opportunities    cc_seo_opps (active)  -> Opportunities, opened on it (?open=)
 *   SEO tasks        cc_seo_owner_tasks    -> the list of every task, opened on it
 *   crawl findings   cc_issues             -> the page on SEO > Pages with that rule, or Technical's issues
 *
 * WHICH KIND A HIT IS. The palette (web/src/components/shell/CommandPalette.tsx)
 * groups hits under six kinds and drops any other, so a competitor is sent as a
 * "page" (a website) and an opportunity or a task as an "insight", each with
 * its own name at the start of the second line. When the palette learns kinds
 * of their own, `AS` below is the one place to change.
 *
 * ACCESS is the search box's own rule, applied in find.ts to every hit by the
 * address it leads to: a hit into an SEO page this person was not given is
 * never sent.
 */

/** The palette's kind for each of the SEO section's things. */
const AS = {
  phrase: "keyword",
  cluster: "keyword",
  competitor: "page",
  opportunity: "insight",
  task: "insight",
  finding: "page",
} as const satisfies Record<string, SearchHit["kind"]>;

/** How many of each a search lists: a long list of one kind would push the others out of the box. */
const MANY = { phrase: 6, cluster: 3, competitor: 5, opportunity: 5, task: 3, finding: 4 } as const;

/** What a person typed, as lower-case words (at most six). */
const wordsOf = (q: string): string[] =>
  q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);

/** LIKE patterns for the words, with LIKE's own wildcards escaped: "50%" looks for a percent sign. */
const likes = (words: string[]): string[] => words.map((w) => `%${w.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);

/** "a LIKE ? AND b LIKE ?" over one SQL expression, once per word. */
const every = (expr: string, words: string[]): string => words.map(() => `${expr} LIKE ? ESCAPE '\\'`).join(" AND ");

/**
 * How well a text answers the query: 0 the whole of it, 1 it begins with it,
 * 2 a word of it begins with it, 3 it is somewhere inside. Lower is better.
 */
function closeness(text: string, q: string): number {
  const t = text.toLowerCase();
  const s = q.toLowerCase().trim();
  if (t === s) return 0;
  if (t.startsWith(s)) return 1;
  if (t.split(/[\s/._:-]+/).some((w) => w.startsWith(s.split(/\s+/)[0] ?? s))) return 2;
  return 3;
}

/** Rows of a query, or none when a table is not there yet (a desk before the engine's first start). */
function rows<T>(sql: string, ...args: (string | number)[]): T[] {
  try {
    return db.prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/* ---------- tracked phrases ------------------------------------------------------------------ */

const STATUS_SAYS: Record<string, string> = { relevant: "relevant", weak: "weak", unjudged: "not judged yet", irrelevant: "judged irrelevant" };
const STATUS_RANK: Record<string, number> = { relevant: 0, weak: 1, unjudged: 2, irrelevant: 3 };

/** The Keywords page listing the phrase (?q=, every status) and opening its own view (?open=). */
export const phraseHref = (id: number, phrase: string): string => `/seo/keywords?q=${encodeURIComponent(phrase)}&status=all&open=${id}`;

/**
 * The tracked phrases that hold every word, the closest first, then those a
 * person judged relevant, then those Google showed the site for most. A phrase
 * judged irrelevant is still found (somebody may want to judge it again) but
 * comes last.
 */
export function phrases(q: string): SearchHit[] {
  const words = wordsOf(q);
  if (!words.length) return [];
  const found = rows<{ id: number; phrase: string; status: string; cluster: string | null; cluster_name: string | null; page: string | null; sources: string }>(
    `SELECT k.id, k.phrase, k.status, k.cluster, c.name AS cluster_name, k.page, k.sources
       FROM cc_seo_keywords k LEFT JOIN cc_seo_clusters c ON c.key = k.cluster
      WHERE ${every("k.phrase", words)}
      ORDER BY length(k.phrase) LIMIT 200`,
    ...likes(words),
  );
  if (!found.length) return [];
  /* Google's own figure per query over the desk's history: whole property, every device. */
  const shown = new Map<string, number>();
  const marks = found.map(() => "?").join(",");
  for (const r of rows<{ query: string; n: number }>(
    `SELECT query, SUM(impressions) AS n FROM cc_seo_rank_queries WHERE country = 'all' AND query IN (${marks}) GROUP BY query`,
    ...found.map((f) => f.phrase),
  )) {
    shown.set(r.query, r.n);
  }
  return found
    .map((f) => ({ f, close: closeness(f.phrase, q), rank: STATUS_RANK[f.status] ?? 2, seen: shown.get(f.phrase) ?? 0 }))
    .sort((a, b) => a.close - b.close || a.rank - b.rank || b.seen - a.seen || a.f.phrase.length - b.f.phrase.length)
    .slice(0, MANY.phrase)
    .map(({ f, seen }): SearchHit => ({
      kind: AS.phrase,
      title: f.phrase,
      sub: [
        `Tracked phrase, ${STATUS_SAYS[f.status] ?? f.status}`,
        f.cluster_name ?? null,
        f.page ? `answered by ${f.page}` : null,
        seen ? `Google showed the site ${plural(seen, "time")}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: phraseHref(f.id, f.phrase),
    }));
}

/* ---------- topic clusters ------------------------------------------------------------------- */

/** Clusters by name or key. One that no page answers is a gap and opens on Content Gaps; one with a page lists its phrases on Keywords. */
export function clusterHits(q: string): SearchHit[] {
  const words = wordsOf(q);
  if (!words.length) return [];
  const found = rows<{ key: string; name: string; page: string | null; n: number }>(
    `SELECT c.key, c.name, c.page, (SELECT COUNT(*) FROM cc_seo_keywords k WHERE k.cluster = c.key AND k.status != 'irrelevant') AS n
       FROM cc_seo_clusters c
      WHERE ${every("(c.name || ' ' || c.key)", words)}
      LIMIT 50`,
    ...likes(words),
  );
  return found
    .sort((a, b) => closeness(a.name, q) - closeness(b.name, q) || b.n - a.n)
    .slice(0, MANY.cluster)
    .map((c): SearchHit => ({
      kind: AS.cluster,
      title: c.name,
      sub: `Topic cluster · ${plural(c.n, "tracked phrase")} · ${c.page ? `answered by ${c.page}` : "no page answers it yet"}`,
      href: c.page ? `/seo/keywords?cluster=${encodeURIComponent(c.key)}&status=all` : `/seo/content-gaps?view=clusters&open=${encodeURIComponent(c.key)}`,
    }));
}

/* ---------- competitors ---------------------------------------------------------------------- */

/** A domain as people type it: no scheme, no "www.", no path. */
const bareDomain = (q: string): string =>
  q
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");

/**
 * Competitors by domain or name, with how many of our searches each was seen
 * for. A competitor known only by name (seen in an AI answer, no website) is
 * kept under "name:<name>" and found by that name.
 */
export function competitorHits(q: string): SearchHit[] {
  const typed = /\.[a-z]{2,}$/i.test(bareDomain(q)) ? bareDomain(q) : q;
  const words = wordsOf(typed);
  if (!words.length) return [];
  const found = rows<{ domain: string; name: string | null; queries: number; engines: string | null }>(
    `SELECT c.domain, c.name,
            (SELECT COUNT(DISTINCT s.query) FROM cc_seo_sightings s WHERE s.domain = c.domain) AS queries,
            (SELECT group_concat(DISTINCT s.engine) FROM cc_seo_sightings s WHERE s.domain = c.domain) AS engines
       FROM cc_seo_competitors c
      WHERE ${every("(c.domain || ' ' || coalesce(c.name, ''))", words)}
      LIMIT 60`,
    ...likes(words),
  );
  const shown = (d: string, n: string | null): string => (d.startsWith("name:") ? (n ?? d.slice(5)) : d);
  return found
    .sort((a, b) => closeness(shown(a.domain, a.name), typed) - closeness(shown(b.domain, b.name), typed) || b.queries - a.queries)
    .slice(0, MANY.competitor)
    .map((c): SearchHit => {
      const engines = (c.engines ?? "").split(",").filter(Boolean);
      const where = engines.length ? ` in ${engines.some((e) => e.startsWith("google")) ? "Google" : ""}${engines.some((e) => e.startsWith("google")) && engines.some((e) => !e.startsWith("google")) ? " and " : ""}${engines.some((e) => !e.startsWith("google")) ? "AI answers" : ""}` : "";
      return {
        kind: AS.competitor,
        title: shown(c.domain, c.name),
        sub: [
          "Competitor",
          c.domain.startsWith("name:") ? "named, no website known" : c.name && c.name.toLowerCase() !== c.domain ? c.name : null,
          c.queries ? `seen${where} for ${plural(c.queries, "of our searches", "of our searches")}` : "not seen for our searches yet",
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/seo/competitors?open=${encodeURIComponent(c.domain)}`,
      };
    });
}

/* ---------- opportunities -------------------------------------------------------------------- */

const STATE_SAYS: Record<string, string> = { open: "open", queued: "queued", "in-progress": "in progress", done: "done", dismissed: "dismissed" };
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Opportunities the rules still find, by title, page, phrase or cluster: the
 * titles are short and alike ("Title is cut in results"), so the page is what
 * a person usually types. Those still to do come first, then by priority.
 */
export function opportunityHits(q: string): SearchHit[] {
  const words = wordsOf(q);
  if (!words.length) return [];
  const text = "(o.title || ' ' || o.type || ' ' || coalesce(o.page, '') || ' ' || coalesce(o.keyword, '') || ' ' || coalesce(c.name, o.cluster, ''))";
  const found = rows<{ id: string; type: string; title: string; page: string | null; keyword: string | null; cluster: string | null; priority: string; state: string }>(
    `SELECT o.id, o.type, o.title, o.page, o.keyword, coalesce(c.name, o.cluster) AS cluster, o.priority, o.state
       FROM cc_seo_opps o LEFT JOIN cc_seo_clusters c ON c.key = o.cluster
      WHERE o.active = 1 AND ${every(text, words)}
      ORDER BY CASE WHEN o.state IN ('open', 'queued', 'in-progress') THEN 0 ELSE 1 END,
               CASE o.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, o.id
      LIMIT 80`,
    ...likes(words),
  );
  const label = (t: string): string => TYPE_LABEL[t as OpportunityType] ?? t;
  return found
    .map((o) => ({ o, close: Math.min(closeness(o.page ?? "", q), closeness(o.keyword ?? "", q), closeness(o.title, q)) }))
    .sort((a, b) => Number(!["open", "queued", "in-progress"].includes(a.o.state)) - Number(!["open", "queued", "in-progress"].includes(b.o.state)) || a.close - b.close || (PRIORITY_RANK[a.o.priority] ?? 2) - (PRIORITY_RANK[b.o.priority] ?? 2))
    .slice(0, MANY.opportunity)
    .map(({ o }): SearchHit => {
      const subject = o.page ?? (o.keyword ? `“${o.keyword}”` : o.cluster);
      return {
        kind: AS.opportunity,
        title: subject && !o.title.includes(subject) ? `${o.title}: ${subject}` : o.title,
        sub: `Opportunity · ${label(o.type)} · ${o.priority} priority · ${STATE_SAYS[o.state] ?? o.state}`,
        href: `/seo/opportunities?open=${encodeURIComponent(o.id)}`,
      };
    });
}

/* ---------- SEO tasks ------------------------------------------------------------------------ */

const DOER_SAYS: Record<string, string> = { owner: "the owner's own step", "lead-chrome": "a step in the owner's browser", code: "a change to the website's code", content: "content to write" };

/** Every SEO task by its title, its exact step or its note: open ones first. Opens the list of every task on it. */
export function taskHits(q: string): SearchHit[] {
  const words = wordsOf(q);
  if (!words.length) return [];
  const found = rows<{ id: string; title: string; who: string; done: number; impact: string }>(
    `SELECT id, title, who, done, impact FROM cc_seo_owner_tasks
      WHERE ${every("(title || ' ' || step || ' ' || coalesce(note, '') || ' ' || id)", words)}
      ORDER BY done, CASE impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, sort
      LIMIT 40`,
    ...likes(words),
  );
  return found
    .sort((a, b) => a.done - b.done || closeness(a.title, q) - closeness(b.title, q))
    .slice(0, MANY.task)
    .map((t): SearchHit => ({
      kind: AS.task,
      title: t.title,
      sub: `SEO task · ${DOER_SAYS[t.who] ?? t.who} · ${t.done ? "done" : `${t.impact} impact, open`}`,
      href: `/seo/list/tasks?open=${encodeURIComponent(t.id)}`,
    }));
}

/* ---------- crawl findings ------------------------------------------------------------------- */

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, opportunity: 2 };
const SEVERITY_SAYS: Record<string, string> = { critical: "critical", warning: "warning", opportunity: "suggestion" };

/**
 * The crawl's findings by the rule's name ("title too long"), its id
 * ("title.long"), the page or the finding's own sentence. A finding on a page
 * opens that page on SEO > Pages with the rule chosen; a site-wide one opens
 * Technical's list of issues.
 */
export function findingHits(q: string): SearchHit[] {
  const words = wordsOf(q);
  if (!words.length) return [];
  const all = rows<{ id: string; rule: string; severity: string; path: string | null; text: string }>("SELECT id, rule, severity, path, text FROM cc_issues LIMIT 5000");
  const titleOf = (rule: string): string => (RULES as Record<string, { title: string } | undefined>)[rule]?.title ?? rule;
  return all
    .filter((f) => {
      const t = `${titleOf(f.rule)} ${f.rule} ${f.path ?? ""} ${f.text}`.toLowerCase();
      return words.every((w) => t.includes(w));
    })
    .map((f) => ({ f, close: Math.min(closeness(titleOf(f.rule), q), closeness(f.path ?? "", q), closeness(f.rule, q)) }))
    .sort((a, b) => a.close - b.close || (SEVERITY_RANK[a.f.severity] ?? 3) - (SEVERITY_RANK[b.f.severity] ?? 3) || (a.f.path ?? "").localeCompare(b.f.path ?? ""))
    .slice(0, MANY.finding)
    .map(({ f }): SearchHit => ({
      kind: AS.finding,
      title: f.path ? `${titleOf(f.rule)}: ${f.path}` : titleOf(f.rule),
      sub: `SEO issue · ${SEVERITY_SAYS[f.severity] ?? f.severity} · ${f.text.length > 110 ? `${f.text.slice(0, 109).trimEnd()}…` : f.text}`,
      href: f.path ? `/seo/pages?finding=${encodeURIComponent(f.rule)}&open=${encodeURIComponent(f.path)}` : "/seo/technical#issues",
    }));
}

/* ---------- the open web: research a phrase, look up a site ---------------------------------- */

/**
 * Two rows that lead to the web layer (src/cc/seo/web/) instead of a table:
 * a phrase nobody tracks is offered for research on Keywords (?research=), and
 * a typed domain that is not on the competitor list for a lookup on
 * Competitors (?look=). Both pages draw what the web layer kept or what asking
 * would cost: following the link asks the web nothing, only the button there
 * does.
 */
export function webHits(q: string): SearchHit[] {
  const typed = q.replace(/\s+/g, " ").trim();
  if (typed.length < 3 || typed.length > 120) return [];
  const domain = bareDomain(typed);
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain)) {
    if (domain === "balkaris.ch") return [];
    const known = rows<{ domain: string }>("SELECT domain FROM cc_seo_competitors WHERE domain = ? LIMIT 1", domain).length > 0;
    return known ? [] : [{ kind: AS.competitor, title: `Look up ${domain}`, sub: "Competitors · its public facts beside Balkaris, read when you press Look up", href: `/seo/competitors?look=${encodeURIComponent(domain)}` }];
  }
  const phrase = typed.toLowerCase();
  if (/[<>]/.test(phrase)) return [];
  const tracked = rows<{ id: number }>("SELECT id FROM cc_seo_keywords WHERE phrase = ? LIMIT 1", phrase).length > 0;
  return tracked ? [] : [{ kind: AS.phrase, title: `Research “${phrase}” on the web`, sub: "Keywords · Google’s and Bing’s suggestions for it, asked when you press Research", href: `/seo/keywords?research=${encodeURIComponent(phrase)}` }];
}

registerSearch(phrases, clusterHits, competitorHits, opportunityHits, taskHits, findingHits, webHits);
