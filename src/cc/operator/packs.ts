import { db } from "../../db.ts";
import type { Depth, Given } from "../../../web/src/contract/operator.ts";
import type { SourceId } from "../../../web/src/contract/common.ts";
import { articleStats, channels, eventByPage, GA4_NOTE, pages as gaPages, totals, type GaRange, type Read } from "../ga4.ts";
import { opportunities as searchOpportunities } from "../search/gsc.ts";
import { brokenLinks, crawlSummary, inventory, issueCounts, issues, LIMITS, lastSitemap, page as pageDetail, type PageRow } from "../site/index.ts";
import { abs, get } from "../site/http.ts";
import { cached } from "../store.ts";

/**
 * The context a task is given: the desk's own stored data, cut down to what a
 * small local model can hold.
 *
 * The workstation's model has a context of a few thousand tokens and no other
 * knowledge of this website. So everything it may say must be in what this
 * file assembles, and what this file assembles must be small: compact lines,
 * the worst or busiest first, and a stated cut ("12 more not shown") rather
 * than a silent one. Every block says where it came from and when, and that
 * travels with the answer to the screen, so a person can see what the model
 * knew when it said something.
 *
 * Packs are made on the box, when a task is made (an audit's when its crawl
 * has finished). Nothing here asks a slow source without its cache: the GA4
 * reads keep their own, the crawl and the sitemap are tables, and the one
 * page excerpt a metadata task needs is kept for a day.
 *
 * A block whose source is not connected is still a block: it says so, in the
 * source's own words, and the model is told not to answer that part.
 */

/** One block of a pack: what the screen is told (Given) and the lines the model reads. */
export interface Block extends Given {
  text: string;
}

/**
 * THE BRAND IS THE WEBSITE'S TO ADD. Its root layout (app/layout.tsx) gives
 * every page title the template "%s | Balkaris", and an approved title from
 * content/desk/overrides.json goes through pageMeta (lib/seo.tsx) as the
 * page's own part. So the crawl reads "Services | Balkaris", the model is
 * given and writes only "Services", the override stores "Services", and the
 * page shows "Services | Balkaris". A title stored with the brand would show
 * it twice.
 *
 * ONLY WHERE IT FITS. Since 3 October 2026 (website 7b00b41, lib/seo.tsx
 * `withBrand`) the brand is added only when the whole title still fits in 60
 * characters; a longer own part is shown alone, so a question or a price is
 * never cut for the brand's sake.
 */
export const BRAND = " | Balkaris";

/** The website's room for a whole title (lib/seo.tsx TITLE_ROOM). */
const SITE_TITLE_ROOM = 60;

/** The page's own part of a title: the brand the website appends, taken off (with any separator a model put before it). */
export function ownTitle(t: string): string;
export function ownTitle(t: string | null): string | null;
export function ownTitle(t: string | null): string | null {
  if (t === null) return null;
  return t.replace(/(?:\s*\|\s*|\s+[–—:-]\s+)Balkaris\s*$/i, "").trim();
}

/** The title a page shows when its own part is `own`: the brand after it where both fit, else the own part alone. */
export const shownTitle = (own: string): string => (own.length + BRAND.length <= SITE_TITLE_ROOM ? `${own}${BRAND}` : own);

/** A page a metadata task writes for: everything the model may use, and nothing else. */
export interface MetaTarget {
  path: string;
  lang: string | null;
  kind: string;
  /** The title as the crawl read it on the live page, the brand included: what Google shows now. */
  shown: string | null;
  /** Its own part, without the brand the website appends: what an override replaces. */
  title: string | null;
  description: string | null;
  h1: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  excerpt: string | null;
  /** The findings that made it a target, in the crawl's words. */
  findings: string[];
}

/** An address that no longer answers, with the pages the rules offer as its new home. */
export interface RedirectTarget {
  from: string;
  status: number;
  /** "404", or "gone from the sitemap on 2026-09-30". */
  why: string;
  linkedFrom: { path: string; text: string }[];
  candidates: { path: string; title: string | null }[];
}

export interface Pack {
  builtAt: string;
  range: GaRange;
  depth: Depth;
  blocks: Block[];
  /** Every address the crawl knows: what a model's answer may name. */
  known: string[];
  meta?: MetaTarget[];
  redirects?: RedirectTarget[];
  /** Addresses that could not be offered, and why: shown with the result. */
  skipped?: string[];
}

/** How many characters of data a task is given, by depth. About four characters a token. */
export const BUDGET: Record<Depth, number> = { quick: 6_000, deep: 12_000 };

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** Lines under a head, cut at `room` characters with the cut said out loud. */
function fit(head: string, rows: string[], room: number): string {
  const out = [head];
  let used = head.length;
  let shown = 0;
  for (const r of rows) {
    if (used + r.length + 1 > room && shown > 0) break;
    out.push(r);
    used += r.length + 1;
    shown++;
  }
  if (shown < rows.length) out.push(`(${rows.length - shown} more not shown)`);
  return out.join("\n");
}

const absent = (name: string, label: string, source: SourceId, state: "waiting" | "off", reason: string): Block => ({
  name,
  label,
  source,
  asOf: null,
  state,
  note: reason,
  text: `${label.toUpperCase()}: NOT AVAILABLE. ${reason} Do not answer anything that needs it; say it is not available.`,
});

/**
 * A change between two counts, written the way the desk writes them
 * everywhere: two small numbers as "3 → 5", a percentage only when the
 * count before is big enough to carry one, nothing at all when the period
 * before was not measured.
 */
export function change(now: number, before: number | null): string {
  if (before === null) return "no period before to compare";
  if (before < 20 || now < 20) return `${before} → ${now}`;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% (from ${before})`;
}

/* ---------- traffic: GA4 -------------------------------------------------- */

function gaAbsent<T>(r: Read<T>, label: string): Block {
  const state = r.off ? "off" : "waiting";
  return absent("traffic", label, "ga4", state, `${r.error ?? "GA4 has not answered yet."}${r.step ? ` ${r.step}` : ""}`);
}

export async function trafficBlock(range: GaRange, room: number): Promise<Block> {
  const label = "Traffic";
  const t = await totals(range);
  if (!t.data) return gaAbsent(t, label);
  const [ch, pg, leads, meets] = await Promise.all([channels(range), gaPages(range), eventByPage("generate_lead", range), eventByPage("book_meeting", range)]);
  const span = t.data.span;
  const cur = t.data.current;
  const prev = t.data.previous;
  const head = [
    `TRAFFIC — Google Analytics 4, consenting visitors only (GA4 loads after the cookie banner is accepted, so these are an undercount).`,
    `Period: ${span.start} to ${span.end} (${span.days} days)${span.partial ? `, measured only from ${span.since}` : ""}. ${
      span.previous ? `Period before: ${span.previous.start} to ${span.previous.end}.` : "The period before was not measured, so nothing may be compared with it."
    }`,
    `Visitors: ${cur.activeUsers} (${change(cur.activeUsers, prev?.activeUsers ?? null)})`,
    `New visitors: ${cur.newUsers} (${change(cur.newUsers, prev?.newUsers ?? null)})`,
    `Sessions: ${cur.sessions} (${change(cur.sessions, prev?.sessions ?? null)})`,
    `Engaged sessions: ${cur.engagedSessions} (${change(cur.engagedSessions, prev?.engagedSessions ?? null)})`,
    `Page views: ${cur.screenPageViews} (${change(cur.screenPageViews, prev?.screenPageViews ?? null)})`,
  ].join("\n");

  const rows: string[] = [];
  if (ch.data) {
    rows.push("Sessions by channel:");
    for (const r of ch.data.rows.slice(0, 8)) rows.push(`- ${r.label}: ${r.sessions} sessions (${change(r.sessions, r.previous?.sessions ?? null)})`);
  }
  if (pg.data) {
    rows.push("Pages with the most views:");
    for (const r of pg.data.rows.slice(0, 12)) rows.push(`- ${r.path}: ${r.views} views by ${r.users} visitors (views ${change(r.views, r.previous?.views ?? null)})`);
  }
  for (const [read, what] of [
    [leads, "Enquiries sent (generate_lead), by the page they were sent from"],
    [meets, "Meetings booked (book_meeting), by page"],
  ] as const) {
    if (!read.data) continue;
    if (!read.data.rows.length) rows.push(`${what}: none in this period.`);
    else {
      rows.push(`${what}:`);
      for (const r of read.data.rows.slice(0, 6)) rows.push(`- ${r.path}: ${r.count} (${change(r.count, r.previous?.count ?? null)})`);
    }
  }
  return { name: "traffic", label, source: "ga4", asOf: iso(t.at), state: "ok", note: GA4_NOTE, text: fit(head, rows, room) };
}

/* ---------- the crawl: pages and findings ------------------------------------ */

const statusWord = (r: PageRow): string => (r.status === 200 ? "200" : r.status === 0 ? "no answer" : r.redirectTo ? `${r.status} to ${r.redirectTo}` : String(r.status));

export function pagesBlock(room: number): Block {
  const inv = inventory();
  if (inv.state !== "ok") return absent("pages", "Pages", "crawl", inv.state, inv.reason);
  const rows = [...inv.value]
    .sort((a, b) => Number(b.inSitemap) - Number(a.inSitemap) || (a.score ?? 101) - (b.score ?? 101) || a.path.localeCompare(b.path))
    .map((r) => `${r.path} | ${r.kindLabel} | ${statusWord(r)} | ${r.score === null ? "not scored" : `score ${r.score}`} | ${r.issues.critical}/${r.issues.warning}/${r.issues.opportunity} | ${r.title ?? "no title"}`);
  const head = `PAGES — the desk's own crawl of the website, ${inv.value.length} addresses. Columns: address | kind | what it answers | the desk's own score out of 100 | findings critical/warnings/opportunities | title.`;
  return { name: "pages", label: "Pages", source: "crawl", asOf: inv.asOf, state: "ok", note: "The desk's own read of every page, and its own score by its stated rules: not a Google figure.", text: fit(head, rows, room) };
}

export function issuesBlock(room: number): Block {
  const counts = issueCounts();
  const all = issues();
  const sum = crawlSummary();
  if (counts.state !== "ok" || all.state !== "ok") {
    const r = counts.state !== "ok" ? counts : all;
    return absent("issues", "Findings", "crawl", r.state === "ok" ? "waiting" : r.state, r.state === "ok" ? "" : r.reason);
  }
  const s = sum.state === "ok" ? sum.value : null;
  const head = [
    `FINDINGS — the desk's crawl${s ? ` of ${s.pages} addresses, finished ${s.finished}` : ""}. Severity: critical, warning, opportunity.`,
    s?.siteScore != null ? `Site score: ${s.siteScore} out of 100, by the desk's own stated rules (not a Google figure).` : "The site has no score yet.",
    `Critical: ${counts.value.critical}. Warnings: ${counts.value.warning}. Opportunities: ${counts.value.opportunity}.`,
    "By rule (findings):",
    ...counts.value.byRule.map((r) => `- ${r.title} (${r.severity}): ${r.count}`),
    "Findings, worst first:",
  ].join("\n");
  const rows = all.value.map((f) => `- [${f.severity}] ${f.path ?? "the site"}: ${f.text}`);
  return { name: "issues", label: "Findings", source: "crawl", asOf: all.asOf, state: "ok", note: "The desk's own rules (src/cc/site/rules.ts): yardsticks, not Google's law.", text: fit(head, rows, room) };
}

/* ---------- articles: the desk's drafts and their GA4 figures ----------------------- */

interface DraftDb {
  id: number;
  slug: string;
  state: string;
  title: string | null;
  created_at: string;
}

export const drafts = (): DraftDb[] =>
  db.prepare("SELECT id, slug, state, json_extract(post, '$.title') AS title, created_at FROM drafts ORDER BY id DESC").all() as unknown as DraftDb[];

export async function insightsBlock(range: GaRange, room: number): Promise<Block> {
  const list = drafts();
  const stats = await articleStats(range);
  const views = new Map((stats.data?.rows ?? []).map((r) => [r.path, r]));
  const head = [
    `INSIGHTS — the articles the desk wrote (its own database), newest first${stats.data ? `, with GA4 figures for ${stats.data.span.start} to ${stats.data.span.end}, consenting visitors only` : `; GA4 figures not available: ${stats.error ?? "not read yet"}`}.`,
    "State: draft = written, not on the site; unlisted = live at its address, in no menu; listed = in the menus and the sitemap.",
  ].join("\n");
  const rows = list.map((d) => {
    const path = `/insights/${d.slug}`;
    const v = views.get(path);
    const figures = d.state === "draft" ? "" : v ? ` | ${v.views} views, ${v.users} visitors, ${v.entrances} sessions began here` : stats.data ? " | no views in the period" : "";
    return `"${d.title ?? d.slug}" | ${d.state} | written ${d.created_at.slice(0, 10)} | ${path}${figures}`;
  });
  if (!list.length) rows.push("The desk has written no articles yet.");
  return { name: "insights", label: "Articles", source: "desk", asOf: new Date().toISOString(), state: "ok", note: stats.data ? GA4_NOTE : undefined, text: fit(head, rows, room) };
}

/* ---------- one page in depth -------------------------------------------------------- */

export async function pageBlock(path: string, range: GaRange, room: number): Promise<Block> {
  const p = pageDetail(path);
  if (p.state !== "ok") return absent("page", `Page ${path}`, "crawl", p.state, p.reason);
  const v = p.value;
  const ga = await gaPages(range);
  const row = ga.data?.rows.find((r) => r.path === path);
  const lines = [
    `ONE PAGE — ${v.path} (${v.kindLabel}), read by the desk's crawl.`,
    `Answers: ${statusWord(v)}. In the sitemap: ${v.inSitemap ? "yes" : "no"}. Indexable: ${v.indexable ? "yes" : "no"}. Language: ${v.facts?.lang ?? "not declared"}.`,
    `Title (${v.title?.length ?? 0} characters): ${v.title ?? "none"}`,
    `Description (${v.description?.length ?? 0} characters): ${v.description ?? "none"}`,
    `Main heading: ${v.h1 ?? "none"}`,
    `Words of its own content: ${v.words ?? "not read"}. Other pages linking here: ${v.inlinks}, of them from their content: ${v.inlinksFromContent}.`,
    `The desk's score: ${v.score ?? "not scored"}.`,
    row ? `GA4 for ${ga.data!.span.start} to ${ga.data!.span.end}, consenting visitors only: ${row.views} views by ${row.users} visitors (views ${change(row.views, row.previous?.views ?? null)}).` : ga.data ? "GA4: no views in the period." : `GA4: not available (${ga.error ?? "not read"}).`,
    "Findings:",
    ...(v.findings.length ? v.findings.map((f) => `- [${f.severity}] ${f.text}`) : ["- none"]),
  ];
  return { name: "page", label: `Page ${path}`, source: "crawl", asOf: p.asOf, state: "ok", text: fit(lines.slice(0, 8).join("\n"), lines.slice(8), room) };
}

/* ---------- Search Console, when connected ---------------------------------------------- */

export async function searchBlock(range: GaRange, room: number): Promise<Block> {
  const label = "Search Console";
  const r = await searchOpportunities(range === "24h" ? "7d" : range);
  if (r.state !== "ok") return absent("search", label, "gsc", r.state, `${r.reason}${r.state === "off" && r.step ? ` ${r.step}` : ""}`);
  const early = r.value.early;
  const head = `SEARCH — Google Search Console, ${r.value.window.start} to ${r.value.window.end}: queries where the site shows on Google's first two pages without being at the top (average position 4 to 20, at least ${r.value.floor === 1 ? "one impression" : `${r.value.floor} impressions`}). Position is Google's average position, not a tracked rank.${early ? ` ${early.line} Rows marked EARLY were shown fewer than ${early.standard} times: treat them as signals, not findings.` : ""}`;
  const rows = r.value.rows
    .slice(0, 25)
    .map((q) => `- "${q.query}": ${q.impressions} impressions, ${q.clicks} clicks, average position ${q.position.toFixed(1)}${q.path ? `, page ${q.path}` : ""}${q.early ? " (EARLY)" : ""}`);
  if (!rows.length) rows.push("- none at present");
  return { name: "search", label, source: "gsc", asOf: r.asOf, state: "ok", note: "Google's average position, not a tracked rank.", text: fit(head, rows, room) };
}

/* ---------- the pages a metadata task writes for ---------------------------------------- */

const META_RULES = new Set(["title.missing", "title.long", "title.duplicate", "description.missing", "description.long", "description.duplicate"]);

/** Most pages one metadata task writes for: a small model writes five well, not twenty. */
export const META_MOST = 5;

/** The page's own words, roughly, for a model writing its description: the start of <main>, as text. Kept a day. */
async function excerpt(path: string, chars: number): Promise<string | null> {
  try {
    const got = await cached(`op:excerpt:${path}`, 24 * 3_600_000, async () => {
      const g = await get(abs(path), { timeout: 15_000 });
      if (g.status !== 200 || !g.body) throw new Error(`answered ${g.status || "nothing"}`);
      const html = g.body;
      const main = /<main[\s>][\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<body[\s>][\s\S]*?<\/body>/i.exec(html)?.[0] ?? "";
      const text = main
        .replace(/<(script|style|svg|noscript|template|nav|footer|header)[\s>][\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'")
        .replace(/&ldquo;|&rdquo;/g, '"')
        .replace(/&mdash;/g, "—")
        .replace(/&ndash;/g, "–")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
      return text.slice(0, 2000);
    });
    return got.value ? got.value.slice(0, chars) : null;
  } catch {
    return null;
  }
}

/**
 * The pages a metadata task writes for: the ones asked for, or the pages in
 * the sitemap whose title or description breaks a rule, worst first, leaving
 * out pages that already have a proposal waiting.
 */
export async function metaTargets(asked: string[] | undefined, depth: Depth): Promise<{ targets: MetaTarget[]; skipped: string[]; more: number }> {
  const inv = inventory();
  if (inv.state !== "ok") throw new Error(inv.reason);
  const byPath = new Map(inv.value.map((r) => [r.path, r]));
  const waiting = new Set((db.prepare("SELECT address FROM cc_proposals WHERE kind = 'meta' AND state = 'waiting'").all() as { address: string }[]).map((r) => r.address));
  const skipped: string[] = [];
  let paths: string[];
  if (asked?.length) {
    paths = [];
    for (const p of asked) {
      const r = byPath.get(p);
      if (!r) skipped.push(`${p}: the crawl knows no page at this address.`);
      else if (r.status !== 200) skipped.push(`${p}: it answers ${statusWord(r)}, so it has no title to change.`);
      else paths.push(p);
    }
  } else {
    const all = issues();
    if (all.state !== "ok") throw new Error(all.reason);
    const seen = new Set<string>();
    paths = [];
    for (const f of all.value) {
      if (!f.path || !META_RULES.has(f.rule) || seen.has(f.path)) continue;
      const r = byPath.get(f.path);
      if (!r || !r.inSitemap || r.status !== 200) continue;
      seen.add(f.path);
      if (waiting.has(f.path)) skipped.push(`${f.path}: a proposal for it is already waiting.`);
      else paths.push(f.path);
    }
  }
  const more = Math.max(0, paths.length - META_MOST);
  const targets: MetaTarget[] = [];
  for (const path of paths.slice(0, META_MOST)) {
    const d = pageDetail(path);
    if (d.state !== "ok") continue;
    const v = d.value;
    targets.push({
      path,
      lang: v.facts?.lang ?? null,
      kind: v.kindLabel,
      shown: v.title,
      title: ownTitle(v.title),
      description: v.description,
      h1: v.h1,
      ogTitle: v.facts?.og.title ?? null,
      ogDescription: v.facts?.og.description ?? null,
      excerpt: await excerpt(path, depth === "quick" ? 500 : 900),
      findings: v.findings.filter((f) => META_RULES.has(f.rule)).map((f) => f.text),
    });
  }
  return { targets, skipped, more };
}

export function metaBlock(targets: MetaTarget[], asOf: string | null): Block {
  const text = targets
    .map((t, i) =>
      [
        `[${i + 1}] path: ${t.path}   language: ${t.lang ?? "not declared (the site writes English)"}   kind: ${t.kind}`,
        `current title, without the "${BRAND.trim()}" the site adds (${t.title?.length ?? 0} characters): ${t.title || "none"}`,
        `current description (${t.description?.length ?? 0} characters): ${t.description ?? "none"}`,
        `main heading: ${t.h1 ?? "none"}`,
        `share title: ${t.ogTitle ?? "none"}`,
        `share description: ${t.ogDescription ?? "none"}`,
        `the start of the page's text: ${t.excerpt ?? "not read"}`,
        `what the desk found: ${t.findings.length ? t.findings.join(" ") : "nothing; a person asked for this page."}`,
      ].join("\n"),
    )
    .join("\n\n");
  return { name: "targets", label: "Pages to rewrite", source: "crawl", asOf, state: "ok", text: `PAGES\n${text}` };
}

/* ---------- addresses that no longer answer, and where they could go -------------------- */

/** The website accepts a redirect only between plain addresses on the site (next.config.ts `deskRedirects`). */
export const PLAIN = /^\/[a-z0-9][a-z0-9/_-]*$/i;

const STOP = new Set(["the", "and", "for", "of", "in", "a", "an", "to", "how", "with", "your", "my", "our", "on", "at", "by", "is", "are", "you", "we", "it", "what", "why", "page", "www", "balkaris", "ch"]);
const words = (s: string | null | undefined): string[] =>
  (s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9äöüéèàç]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/** Most addresses one redirect task ranks for. */
export const REDIRECT_MOST = 6;

/**
 * Addresses that no longer answer (internal links to them are broken, or the
 * crawl saw them leave the site), each with up to five candidates the RULES
 * choose: live pages in the sitemap sharing words with the old address or
 * with the words of the links that pointed to it, and the section it sat in.
 * The model only ranks these; it never names an address of its own.
 */
export function redirectTargets(): { targets: RedirectTarget[]; skipped: string[]; asOf: string | null } {
  const inv = inventory();
  if (inv.state !== "ok") throw new Error(inv.reason);
  const live = inv.value.filter((r) => r.status === 200 && r.inSitemap && r.indexable);
  const known = new Map(inv.value.map((r) => [r.path, r]));
  const inMap = new Set((lastSitemap()?.entries ?? []).map((e) => e.path));
  const taken = new Set((db.prepare("SELECT address FROM cc_proposals WHERE kind = 'redirect' AND state IN ('waiting','approved','applied')").all() as { address: string }[]).map((r) => r.address));
  const skipped: string[] = [];

  const sources = new Map<string, { status: number; why: string; linkedFrom: { path: string; text: string }[] }>();
  const broken = brokenLinks();
  if (broken.state === "ok") {
    for (const b of broken.value) {
      sources.set(b.target, { status: b.status, why: `answers ${b.status || "nothing"}`, linkedFrom: b.sources.slice(0, 4).map((s) => ({ path: s.path, text: s.text })) });
    }
  }
  /* Pages the crawl saw leave the site in the last three months, which links
     and search results elsewhere may still point to. */
  const gone = db.prepare("SELECT text, at FROM cc_activity WHERE kind = 'page' AND text LIKE 'Page gone: %' AND at >= ? ORDER BY at DESC").all(new Date(Date.now() - 90 * 86_400_000).toISOString()) as { text: string; at: string }[];
  for (const g of gone) {
    const path = g.text.slice("Page gone: ".length).trim();
    if (!sources.has(path) && known.get(path)?.status !== 200) sources.set(path, { status: 0, why: `left the site on ${g.at.slice(0, 10)}`, linkedFrom: [] });
  }

  const targets: RedirectTarget[] = [];
  for (const [from, s] of sources) {
    if (!PLAIN.test(from) || from.length > 200) {
      skipped.push(`${from}: not a plain address, and the website accepts redirects only between plain addresses.`);
      continue;
    }
    if (inMap.has(from)) {
      skipped.push(`${from}: it is in the sitemap, so it is a page that is down, not a page that moved; a redirect would hide it.`);
      continue;
    }
    if (taken.has(from)) continue;
    const mine = new Set([...words(from), ...s.linkedFrom.flatMap((l) => words(l.text))]);
    const section = from.split("/").slice(0, -1).join("/") || null;
    const scored = live
      .filter((r) => r.path !== from)
      .map((r) => {
        let score = 0;
        for (const w of words(r.path)) if (mine.has(w)) score += 2;
        for (const w of new Set(words(r.title))) if (mine.has(w)) score += 1;
        if (section && r.path === section) score += 2;
        return { r, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.r.path.length - b.r.path.length)
      .slice(0, 5)
      .map((x) => ({ path: x.r.path, title: x.r.title }));
    if (!scored.length) {
      skipped.push(`${from}: no live page shares a word with it or with the links to it, so there is nothing to offer.`);
      continue;
    }
    targets.push({ from, status: s.status, why: s.why, linkedFrom: s.linkedFrom, candidates: scored });
    if (targets.length >= REDIRECT_MOST) break;
  }
  return { targets, skipped, asOf: inv.asOf };
}

export function redirectBlock(targets: RedirectTarget[], asOf: string | null): Block {
  const text = targets
    .map((t, i) =>
      [
        `[${i + 1}] from: ${t.from} (${t.why})`,
        t.linkedFrom.length ? `    linked from: ${t.linkedFrom.map((l) => `${l.path}${l.text ? ` ("${l.text.slice(0, 60)}")` : ""}`).join(", ")}` : "    no page on the site links to it now",
        "    candidates:",
        ...t.candidates.map((c) => `    - ${c.path}${c.title ? `: ${c.title}` : ""}`),
      ].join("\n"),
    )
    .join("\n\n");
  return { name: "candidates", label: "Addresses and candidates", source: "crawl", asOf, state: "ok", text: `ADDRESSES\n${text}` };
}

/* ---------- putting a pack together ---------------------------------------------------- */

export const knownPaths = (): string[] => {
  const inv = inventory();
  return inv.state === "ok" ? inv.value.map((r) => r.path) : [];
};

/** The blocks for a context choice, sharing the budget. */
export async function contextBlocks(choice: string, range: GaRange, room: number, path?: string): Promise<Block[]> {
  const out: Block[] = [];
  const share = (n: number) => Math.floor(room / n);
  switch (choice) {
    case "pages":
      out.push(pagesBlock(room));
      break;
    case "traffic":
      out.push(await trafficBlock(range, room));
      break;
    case "issues":
      out.push(issuesBlock(room));
      break;
    case "insights":
      out.push(await insightsBlock(range, room));
      break;
    case "none":
      break;
    default:
      out.push(await trafficBlock(range, share(3)), pagesBlock(share(3)), issuesBlock(share(3)));
  }
  if (path) out.unshift(await pageBlock(path, range, Math.min(2500, share(2))));
  return out;
}

/**
 * The longest title and description the operator proposes: the crawl's own
 * yardsticks (rules.ts LIMITS), and never more than 60 and 155. The website
 * itself accepts up to 110 and 300 (lib/desk.ts); a proposal stays well
 * inside both.
 */
export const TITLE_MOST = Math.min(60, LIMITS.title);
export const DESCRIPTION_MOST = Math.min(155, LIMITS.description);
/** The longest own part of a title: the whole room, since a title that long is shown without the brand (shownTitle). */
export const OWN_TITLE_MOST = TITLE_MOST;
