import { db } from "../db.ts";
import { pageLevel, pageOfHref } from "../grants.ts";
import type { Person } from "../people.ts";
import type { SearchHit } from "../../web/src/contract/common.ts";

/**
 * The search box in the top bar.
 *
 * It answers from what the desk has, by title: the sixteen sections (and the
 * SEO section's own pages), and the desk's own articles and shared links.
 * Everything else arrives through `registerSearch` from the module that holds
 * it: the crawl's pages and the website's files (src/cc/site/index.ts),
 * Search Console's queries and the engine's enquiries (src/cc/search/index.ts),
 * and the SEO section's tracked phrases, clusters, competitors, opportunities,
 * tasks and crawl findings (src/cc/seo/find.ts).
 *
 * ACCESS. A hit that leads into a part of the desk the owner did not give
 * this person (src/grants.ts) is never sent: sections, articles and every
 * registered searcher's hits alike, by the address each one leads to.
 *
 * KEYWORDS LEAD TO THE KEYWORDS PAGE. A query Search Console reported used to
 * lead to /seo?open=<query>, the earlier one-screen SEO, which the Overview
 * hands on to /seo/legacy: no SEO head, no tabs. Such a hit is sent to the
 * Keywords page instead, listing the phrase (and opening it when the desk
 * tracks it), and one the SEO section already found as a tracked phrase is
 * not listed twice (`keywordView`).
 *
 * ENQUIRIES. A hit of kind "lead" carries somebody's name. Whatever a
 * registered searcher returns, a person who may not read enquiries
 * (`Person.seesLeads`) is never sent one: the rule is applied here, once, to
 * everything, so a searcher that forgets cannot leak. A searcher is also
 * handed the person, so one that reads enquiries should not even ask the
 * engine for somebody who may not see the answer.
 */

/** A section of the command center: its key in the API, its name in the sidebar, where it lives. */
export interface Section {
  /** The key: /api/v1/<name>, src/cc/routes/<name>.ts. */
  name: string;
  /** What the sidebar calls it. */
  title: string;
  /** Its address in the interface. */
  href: string;
}

/**
 * The sixteen, in the sidebar's order.
 *
 * Site Health is NOT at /health: that address is the desk server's own
 * "are you up" answer, which Caddy and the uptime check ask, and it has to
 * stay a line of JSON.
 */
export const SECTIONS: Section[] = [
  { name: "overview", title: "Command Center", href: "/" },
  { name: "insights", title: "Insights", href: "/insights" },
  { name: "traffic", title: "Traffic", href: "/traffic" },
  { name: "seo", title: "SEO", href: "/seo" },
  { name: "pages", title: "Pages", href: "/pages" },
  { name: "content", title: "Content", href: "/content" },
  { name: "conversions", title: "Conversions", href: "/conversions" },
  { name: "leads", title: "Leads", href: "/leads" },
  { name: "experiments", title: "Experiments", href: "/experiments" },
  { name: "health", title: "Site Health", href: "/site-health" },
  { name: "hosting", title: "Hosting", href: "/hosting" },
  { name: "automations", title: "Automations", href: "/automations" },
  { name: "assets", title: "Assets", href: "/assets" },
  { name: "operator", title: "AI Operator", href: "/operator" },
  { name: "settings", title: "Settings", href: "/settings" },
  /* Members, not Activity: the search box finds the page everybody given Team may open; the owner's pages are in its submenu. */
  { name: "team", title: "Team", href: "/team/members" },
];

/**
 * The SEO section's own pages, so the search box finds "Keywords",
 * "Backlinks" or "seo tech" by name. Kept apart from SECTIONS, which also
 * mounts one API router per entry. The same eleven, in the same order, as the
 * interface's list (web/src/components/seo/nav/pages.ts): keep the two in step.
 */
export const SEO_PAGES: Section[] = [
  { name: "seo-overview", title: "Overview", href: "/seo" },
  { name: "seo-opportunities", title: "Opportunities", href: "/seo/opportunities" },
  { name: "seo-pages", title: "Pages", href: "/seo/pages" },
  { name: "seo-keywords", title: "Keywords", href: "/seo/keywords" },
  { name: "seo-content-gaps", title: "Content Gaps", href: "/seo/content-gaps" },
  { name: "seo-backlinks", title: "Backlinks", href: "/seo/backlinks" },
  { name: "seo-technical", title: "Technical", href: "/seo/technical" },
  { name: "seo-search-console", title: "Search Console", href: "/seo/search-console" },
  { name: "seo-competitors", title: "Competitors", href: "/seo/competitors" },
  { name: "seo-ai-search", title: "AI Search", href: "/seo/ai-search" },
  { name: "seo-automations", title: "Automations", href: "/seo/automations" },
];

/**
 * Something else that can be searched: pages, keywords, assets, enquiries.
 *
 * Given the query as typed (trimmed, at most 80 characters) and the person
 * asking. Return the best few, best first; an empty list when nothing fits.
 * It may be async, it has two and a half seconds, and if it throws the search
 * goes on without it.
 */
export type Searcher = (q: string, who: Person) => SearchHit[] | Promise<SearchHit[]>;

const searchers: Searcher[] = [];

/** Add a source to the search box. Call it once, when the collector's module loads. */
export function registerSearch(...list: Searcher[]): void {
  searchers.push(...list);
}

/** How many hits one source may contribute, so the newest articles cannot push the sections off the list. */
const PER_SOURCE = 8;
const PATIENCE_MS = 2500;

const wordsOf = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);

/** Every word of the query is somewhere in the text. */
const has = (text: string, words: string[]): boolean => {
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
};

/** Sections whose name contains the query, those that BEGIN a word with it first ("se" is SEO before Assets). */
function sections(words: string[]): SearchHit[] {
  const begins = (s: Section) => `${s.title} ${s.name}`.toLowerCase().split(/\s+/).some((w) => w.startsWith(words[0]));
  return SECTIONS.filter((s) => has(`${s.title} ${s.name}`, words))
    .sort((a, b) => Number(begins(b)) - Number(begins(a)))
    .map((s): SearchHit => ({ kind: "section", title: s.title, href: s.href }));
}

/**
 * SEO's pages whose name has a word of the query in it, every word found in
 * "SEO <name>": "keywords" and "seo key" find Keywords, "seo" alone finds only
 * the SEO section above.
 */
function seoPages(words: string[]): SearchHit[] {
  return SEO_PAGES.filter((p) => has(`seo ${p.title}`, words) && words.some((w) => p.title.toLowerCase().includes(w))).map(
    (p): SearchHit => ({ kind: "section", title: p.title, sub: "SEO", href: p.href }),
  );
}

const DRAFT_STATE: Record<string, string> = {
  draft: "written, not on the site",
  unlisted: "live at its address, not listed",
  listed: "published",
};

/**
 * The desk's own articles and links, newest first.
 *
 * A link that has been written up is found by the article's title as well as
 * the source's, and leads to the article; one that has not leads to the link.
 * The article's title is inside the stored post, so SQLite reads it out of the
 * JSON: a scan, which is fine for a table that grows by a dozen rows a day.
 */
function deskRows(words: string[]): SearchHit[] {
  /* LIKE's own wildcards are escaped, so "50%" looks for a percent sign. */
  const like = words.map((w) => `%${w.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  const title = "(coalesce(CASE WHEN json_valid(d.post) THEN json_extract(d.post, '$.title') END, '') || ' ' || coalesce(l.title, ''))";
  const rows = db
    .prepare(
      `SELECT l.id, l.url, l.title, l.site, l.platform, l.state,
              d.id AS draft_id, d.state AS draft_state,
              CASE WHEN json_valid(d.post) THEN json_extract(d.post, '$.title') END AS draft_title
         FROM links l
         LEFT JOIN drafts d ON d.id = (SELECT MAX(id) FROM drafts WHERE link_id = l.id)
        WHERE ${like.map(() => `${title} LIKE ? ESCAPE '\\'`).join(" AND ")}
        ORDER BY l.id DESC LIMIT ?`,
    )
    .all(...like, PER_SOURCE) as {
    id: number;
    url: string;
    title: string | null;
    site: string | null;
    platform: string | null;
    state: string;
    draft_id: number | null;
    draft_state: string | null;
    draft_title: string | null;
  }[];

  return rows.map((r): SearchHit =>
    r.draft_id
      ? {
          kind: "insight",
          title: r.draft_title ?? r.title ?? r.url,
          sub: `Article, ${DRAFT_STATE[r.draft_state ?? ""] ?? r.draft_state ?? "written"}`,
          href: `/insights/${r.draft_id}`,
        }
      : {
          kind: "insight",
          title: r.title ?? r.url,
          sub: `Shared link${r.site || r.platform ? ` from ${r.site ?? r.platform}` : ""}, ${r.state}`,
          href: `/insights/link/${r.id}`,
        },
  );
}

/**
 * Where a phrase is on the Keywords page: listed (?q=, every status) and, when
 * the desk tracks it, opened (?open=<id>, as src/cc/seo/find.ts sends its own
 * hits). The phrase is matched as the keyword table keeps it: lower case,
 * spaces collapsed.
 */
export function keywordView(query: string): string {
  const phrase = query.toLowerCase().replace(/\s+/g, " ").trim();
  let id: number | null = null;
  try {
    id = (db.prepare("SELECT id FROM cc_seo_keywords WHERE phrase = ?").get(phrase) as { id: number } | undefined)?.id ?? null;
  } catch {
    /* a desk before the SEO engine's tables: the list alone */
  }
  return `/seo/keywords?q=${encodeURIComponent(phrase)}&status=all${id !== null ? `&open=${id}` : ""}`;
}

/** A hit that still leads to the earlier SEO screen's keyword view (/seo?open=<query>) is sent to the Keywords page. */
function rehome(h: SearchHit): SearchHit {
  if (h.kind !== "keyword" || !h.href.startsWith("/seo?open=")) return h;
  let query = h.title;
  try {
    query = new URLSearchParams(h.href.slice("/seo?".length)).get("open") ?? h.title;
  } catch {
    /* keep the title */
  }
  return { ...h, href: keywordView(query) };
}

/** One searcher's answer, or nothing if it threw, answered nonsense or took too long. */
async function ask(fn: Searcher, q: string, who: Person): Promise<SearchHit[]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const got = await Promise.race([
      Promise.resolve(fn(q, who)),
      new Promise<SearchHit[]>((_, no) => {
        timer = setTimeout(() => no(new Error("took too long")), PATIENCE_MS);
      }),
    ]);
    if (!Array.isArray(got)) return [];
    return got.filter((h) => h && typeof h.title === "string" && typeof h.href === "string").slice(0, PER_SOURCE);
  } catch (e) {
    console.warn(`cc search: a source was skipped: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the search box shows for `query`, for this person: sections first, then
 * the desk's articles and links, then whatever the collectors registered.
 * Fewer than two characters finds nothing. Up to 40: the palette groups them by
 * kind and shows thirty, and the SEO section alone may bring two dozen.
 */
export async function find(query: string, who: Person, limit = 40): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 80);
  const words = wordsOf(q);
  if (q.length < 2 || !words.length) return [];

  const hits: SearchHit[] = [...sections(words), ...seoPages(words)];
  try {
    hits.push(...deskRows(words));
  } catch (e) {
    console.warn(`cc search: the desk's own rows were skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
  for (const part of await Promise.all(searchers.map((fn) => ask(fn, q, who)))) hits.push(...part.map(rehome));

  const seen = new Set<string>();
  /* Nothing from a part of the desk the owner did not give them: the hit would lead to a refusal, and its title is already a look. */
  const mayOpen = (h: SearchHit): boolean => {
    const page = pageOfHref(h.href);
    return !page || pageLevel(who, page.key) !== "none";
  };
  /* A phrase both Search Console and the keyword table know leads to one address (`keywordView`), so it is listed once. */
  return hits
    .filter((h) => h.kind !== "lead" || who.seesLeads)
    .filter(mayOpen)
    .filter((h) => !seen.has(`${h.kind} ${h.href}`) && !!seen.add(`${h.kind} ${h.href}`))
    .slice(0, limit);
}
