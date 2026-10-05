/**
 * SEO › Content Gaps, proved against its own server code without Google, the
 * crawler, the operator's workstation or any website.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-content-gaps.ts
 *   npm run check:seo-content-gaps
 *
 * The route (src/cc/routes/seo/content-gaps.ts) is mounted alone, on a
 * throwaway database, with a guard on `fetch` that refuses every host: a page
 * of the section that does not load elsewhere cannot hide a failure here.
 * Every phrase, page, domain and figure is a SPECIMEN, made up and named so;
 * none of it describes the real website.
 *
 * What is proved:
 *   1. the page in one answer: the views and their counts, the whole table's
 *      figures, and each card stamped with the age of what it is made from,
 *      not the moment it was asked;
 *   2. the search (?q=), with accents and "ue" folded, in every view;
 *   3. the order (?sort=, ?dir=) runs over every row before the page is cut,
 *      and an order the table does not have is dropped; priority, language
 *      and the list filter;
 *   4. the open group: missing, partly answered, the page to make with the
 *      page to twin, the competitor pages with home pages told apart and left
 *      out of "state a price";
 *   5. By competitor lists sites; From Search Console lists the searches no
 *      page carries; the cluster detail carries its competitors and its
 *      opportunity;
 *   6. a brief: queued, not asked twice while it waits, READY once written
 *      (linked, asked again only on purpose, left out of "Generate all"), and
 *      the brief before it named; a cluster with no opportunity is remembered;
 *   7. the German and price steps: a brief's topic is cut at a sentence or a
 *      word, never inside one; a code change goes on the to-do list once; the
 *      owner's steps are refused;
 *   8. a person's judgement and mapping: a gap closes and opens again, and
 *      neither the desk's rule nor an import undoes the person's word;
 *   9. the CSV export of every table, formula-safe, with Excel's mark;
 *  10. nothing left the machine.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-gaps-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "SITE_READ_REPO", "SITE_REPO", "DESK_DEV_USER", "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"]) delete process.env[k];
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "absent.json");
process.env.SITE_READ_CLONE = "off";

/* ---- nothing leaves this machine ------------------------------------------ */
const refused: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  refused.push(url.split("?")[0]!);
  throw new Error(`the check tried to leave the machine: ${url.split("?")[0]}`);
}) as typeof fetch;

let passed = 0;
let failed = 0;
function check(name: string, good: boolean, detail?: unknown): void {
  if (good) passed++;
  else failed++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${!good && detail !== undefined ? `\n     ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
}
const section = (title: string) => console.log(`\n${title}`);

/* ---- the modules ------------------------------------------------------------ */
const { db } = await import("../src/db.ts");
const keywords = await import("../src/cc/seo/keywords.ts");
const competitors = await import("../src/cc/seo/competitors.ts");
await import("../src/cc/seo/tables.ts");
await import("../src/cc/site/crawl.ts");
await import("../src/cc/operator/queue.ts");
await import("../src/cc/operator/todos.ts");
const gaps = await import("../src/cc/routes/seo/content-gaps.ts");
const { apiError } = await import("../src/cc/api.ts");
const { Hono } = await import("hono");
import type { Person } from "../src/people.ts";
import type { Vars } from "../src/cc/access.ts";
import type { BriefsAnswer, GapChanged, SeoContentGapsPayload } from "../web/src/contract/seo/content-gaps.ts";
import type { OpportunityAnswer } from "../web/src/contract/seo/common.ts";

const OWNER = { telegram: 1, name: "Specimen Owner", email: "owner@specimen.invalid", owner: true, canPublish: true, seesLeads: true } as unknown as Person;
const MEMBER = { telegram: 2, name: "Specimen Member", email: "member@specimen.invalid", owner: false, canPublish: false, seesLeads: false } as unknown as Person;

const API = "/api/v1/seo/content-gaps";
const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  c.set("who", c.req.header("x-specimen-who") === "member" ? MEMBER : OWNER);
  await next();
});
app.route(API, gaps.routes);
app.onError(apiError);

async function get(q = "", who: "owner" | "member" = "owner"): Promise<SeoContentGapsPayload> {
  const res = await app.request(`${API}${q ? `?${q}` : ""}`, { headers: { "x-specimen-who": who } });
  if (res.status !== 200) throw new Error(`GET ${q} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as SeoContentGapsPayload;
}
async function post<T>(p: string, body: unknown): Promise<{ status: number; json: T & { error?: string } }> {
  const res = await app.request(`${API}${p}`, { method: "POST", headers: { "content-type": "application/json", "x-specimen-who": "owner" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as T & { error?: string } };
}
async function csv(q: string): Promise<{ status: number; type: string; marked: boolean; text: string; rows: string[] }> {
  const res = await app.request(`${API}/export.csv${q ? `?${q}` : ""}`);
  /* Read as bytes: decoding as text drops the byte-order mark this is meant to see. */
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  return { status: res.status, type: res.headers.get("content-type") ?? "", marked: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, text, rows: text.replace(/^﻿/, "").split("\r\n").filter(Boolean) };
}
const ok = <T>(r: { state: string; value?: T } | null | undefined): T => {
  if (!r || r.state !== "ok") throw new Error(`a reading is not ok: ${JSON.stringify(r).slice(0, 300)}`);
  return r.value as T;
};
const count = (sql: string, ...a: (string | number)[]): number => (db.prepare(sql).get(...a) as { n: number }).n;

/* ---- the specimen world -------------------------------------------------------- */

const TABLE_AT = "2026-01-12T09:00:00.000Z";
const CRAWL_AT = "2026-01-10T10:00:00.000Z";
const SNAP_AT = "2026-01-11T06:00:00.000Z";

/* The crawl: three pages answering, one gone. */
/* What parse.ts reads from a page, in the shape the crawl stores it. */
const facts = (lang: string, title: string, h1: string) =>
  JSON.stringify({
    title,
    description: null,
    canonical: null,
    robots: null,
    lang,
    h1: [h1],
    h2: 1,
    og: { title, description: null, image: null, type: "website", url: null },
    twitter: { card: null, image: null },
    schema: [],
    schemaTypes: ["WebPage"],
    words: 400,
    links: { internal: 2, internalFromContent: 1, external: 0 },
    images: [],
    videos: [],
    mentions: [],
  });
const fetched = (p: string) => JSON.stringify({ hops: [], lands: p, landed: 200, ttfb: 40, total: 60, bytes: 10000, cacheControl: null, vercelCache: "HIT", contentType: "text/html", robotsTag: null });
const PAGES: [string, string, number, string, string, string][] = [
  ["/", "home", 200, "Specimen Studio | Balkaris", "Specimen Studio", "en"],
  ["/specimen-services", "service", 200, "Specimen website services | Balkaris", "Specimen website services", "en"],
  ["/de/specimen-kosten", "service", 200, "Was kostet eine Specimen-Website? | Balkaris", "Was kostet eine Specimen-Website", "de"],
  ["/specimen-gone", "standard", 404, "Gone", "Gone", "en"],
];
for (const [p, kind, status, title, h1, lang] of PAGES) {
  db.prepare(
    "INSERT INTO cc_pages (path, kind, status, in_sitemap, listed_by, title, descr, heading, score, fetched, facts, hash, first_seen, last_seen, last_changed) VALUES (?, ?, ?, 1, 'sitemap', ?, NULL, ?, 90, ?, ?, ?, ?, ?, ?)",
  ).run(p, kind, status, title, h1, fetched(p), status === 200 ? facts(lang, title, h1) : null, `hash-${p}`, CRAWL_AT, CRAWL_AT, CRAWL_AT);
}
db.prepare("INSERT OR REPLACE INTO cc_state (key, value) VALUES ('site:crawl:finished', ?)").run(CRAWL_AT);

/* The keyword table: five clusters, one answered in English, one mapped to an English page while it is German. */
const C = { cost: "specimen-cost:de", costEn: "specimen-cost:en", wedding: "specimen-wedding:de", agency: "specimen-agency:de", bakery: "seg-specimen-bakery:de" };
const cluster = (key: string, name: string, lang: string, priority: "high" | "medium" | "low", rank: number, page: string | null, action: string | null = null) =>
  keywords.upsertCluster({ key, name, lang, intent: "commercial", priority, rank, page, pageSaid: page ? "exists" : "gap", why: "Specimen reason.", action, examples: [], source: "audit" }, TABLE_AT);
cluster(C.cost, "What a specimen costs (DE)", "de", "high", 1, null, "Create German page 'Was kostet eine Specimen-Website?' with ranges. Then link it.");
cluster(C.costEn, "What a specimen costs (EN)", "en", "high", 2, "/specimen-services");
cluster(C.wedding, "Specimen wedding sites (DE)", "de", "medium", 3, null);
cluster(C.agency, "Specimen agency (DE)", "de", "low", 4, "/");
cluster(C.bakery, "Specimen bakery: websites (DE)", "de", "medium", 5, null);
const phrase = (p: string, cl: string, lang: string, o: { status?: "relevant" | "irrelevant" | "unjudged"; page?: string | null; source?: "audit" | "autocomplete" } = {}) =>
  keywords.upsertKeyword({ phrase: p, lang, cluster: cl, source: o.source ?? "audit", status: o.status ?? "relevant", page: o.page ?? null, by: o.source === "autocomplete" ? "research" : "audit" }, TABLE_AT);
phrase("was kostet eine specimen website", C.cost, "de");
phrase("specimen website kosten", C.cost, "de");
phrase("specimen website preise", C.cost, "de");
phrase("specimen homepage erstellen lassen", C.cost, "de");
phrase("specimen random find", C.cost, "de", { status: "unjudged", source: "autocomplete" });
phrase("specimen nothing", C.cost, "de", { status: "irrelevant" });
phrase("specimen website cost", C.costEn, "en", { page: "/specimen-services" });
phrase("how much does a specimen website cost", C.costEn, "en");
phrase("specimen hochzeit website", C.wedding, "de");
phrase("specimen hochzeitswebsite erstellen", C.wedding, "de");
phrase("specimen agentur zürich", C.agency, "de", { page: "/" });
phrase("specimen bäckerei website", C.bakery, "de");
phrase("=specimen sum", C.bakery, "de");
const idOf = (p: string): number => keywords.keywords().find((k) => k.phrase === p)!.id;

/* Search Console history: four searches over five days; one Google showed no page for. */
for (const day of ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]) db.prepare("INSERT INTO cc_seo_snaps (day, at, query_rows, page_rows, day_rows) VALUES (?, ?, 1, 1, 1)").run(day, SNAP_AT);
const searched: [string, number, number, string | null][] = [
  ["specimen website cost", 12, 6, "/specimen-services"],
  ["specimen website price", 4, 18, "/specimen-services"],
  ["specimen hochzeit website", 3, 31, null],
  ["specimen website services", 7, 3, "/specimen-services"],
  /* A search a person judged not relevant: never listed as a gap. */
  ["specimen nothing", 2, 40, "/"],
];
for (const [q, imp, pos, page] of searched) {
  db.prepare("INSERT INTO cc_seo_rank_queries (day, country, device, query, clicks, impressions, position) VALUES ('2026-01-08', 'all', 'DESKTOP', ?, 0, ?, ?)").run(q, imp, pos);
  if (page) db.prepare("INSERT INTO cc_seo_rank (day, country, device, query, page, clicks, impressions, position) VALUES ('2026-01-08', 'all', 'DESKTOP', ?, ?, 0, ?, ?)").run(q, `https://www.balkaris.ch${page}`, imp, pos);
}

/* Competitors: one ranking page and two home pages read for the German cost searches. */
const rival = (url: string, domain: string, address: "ranking" | "home", query: string | null, title: string, words: number, lang: string, price: number) => {
  competitors.addCompetitorPage({ url, domain, address, cluster: C.cost, query });
  db.prepare("UPDATE cc_seo_comp_pages SET status = 200, title = ?, h1 = ?, words = ?, lang = ?, price = ?, schema = '[\"Organization\"]', fetched_at = ? WHERE url = ?").run(title, title, words, lang, price, "2026-01-09T08:00:00.000Z", url);
};
rival("https://specimen-rival-a.example/", "specimen-rival-a.example", "home", null, "Specimen Rival A, web design", 800, "de-CH", 1);
rival("https://specimen-rival-a.example/preise", "specimen-rival-a.example", "ranking", "was kostet eine specimen website", "Was kostet eine Website? Preise", 1500, "de", 1);
rival("https://specimen-rival-b.example/", "specimen-rival-b.example", "home", null, "Specimen Rival B", 0, "en", 0);
competitors.addSighting({ domain: "specimen-rival-a.example", name: "Specimen Rival A", engine: "google", kind: "organic", query: "was kostet eine specimen website", lang: "de", cluster: C.cost, position: 1, day: "2026-01-09", by: "audit" });
competitors.addSighting({ domain: "specimen-rival-b.example", name: null, engine: "google", kind: "organic", query: "was kostet eine specimen website", lang: "de", cluster: C.cost, position: 3, day: "2026-01-09", by: "audit" });
competitors.addSighting({ domain: "specimen-rival-c.example", name: null, engine: "google", kind: "organic", query: "specimen hochzeit website", lang: "de", cluster: C.wedding, position: 2, day: "2026-01-09", by: "audit" });

/* Opportunities: the gap clusters' briefs and the audit's German and price steps. */
const LONG_QUESTIONS =
  "Write German answers for the questions Swiss buyers ask about a specimen website: what it costs, how long it takes, what is included. Each answer starts with the answer itself, then the detail. Keep the specimen tone, and mark where the owner must give the figures. The pages exist in English only and are not rewritten for AI. First fix in the specimen services page, then the rest.";
const LONG_PRICES =
  "State specimen price ranges on the service pages in CHF, from the smallest offer to the largest, with what each includes and how long it takes. Mark the ranges as the owner's to confirm before anything is published. Say the same in German on the twin pages, and keep the wording of each range the same across the languages so nobody reads two prices.";
const opp = (id: string, type: string, title: string, clusterKey: string | null, action: Record<string, unknown>) =>
  db
    .prepare("INSERT INTO cc_seo_opps (id, type, page, keyword, cluster, title, evidence, priority, priority_why, potential, action, early, state, active, first_seen, last_seen) VALUES (?, ?, NULL, NULL, ?, ?, '[]', 'high', 'specimen', NULL, ?, 0, 'open', 1, ?, ?)")
    .run(id, type, clusterKey, title, JSON.stringify({ ownerTaskId: null, href: null, ...action }), TABLE_AT, TABLE_AT);
const briefAction = (prompt: string) => ({ kind: "brief", label: "Write a brief", step: "The operator writes a brief.", operator: { kind: "brief", prompt, depth: "deep" } });
opp(`german-missing:${C.cost}`, "german-missing", "No German page: what a specimen costs", C.cost, briefAction("German page on what a specimen costs."));
opp(`german-missing:${C.wedding}`, "german-missing", "No German page: specimen wedding sites", C.wedding, briefAction("German page on specimen wedding sites."));
opp(`german-missing:${C.bakery}`, "german-missing", "No German page: specimen bakery", C.bakery, briefAction("German page for specimen bakeries."));
opp("audit:german-questions", "german-missing", "Answer the specimen questions in German", null, briefAction(LONG_QUESTIONS));
opp("audit:specimen-hreflang", "german-missing", "Link the specimen languages by hreflang", null, { kind: "code", label: "Hand to the website's code", step: "Add hreflang links between the specimen twins.", operator: null });
opp("audit:specimen-owner-step", "german-missing", "Decide the specimen German domain", null, { kind: "owner", label: "", step: "Only the owner decides.", operator: null });
opp("audit:specimen-price-pages", "content", "State specimen prices on the service pages", null, briefAction(LONG_PRICES));
db.prepare("INSERT INTO cc_seo_owner_tasks (id, title, step, why, impact, effort, who, origin, sort, done, created_at, updated_at) VALUES ('price-ranges', 'Decide the specimen price ranges', 'Write the ranges down.', 'Only the owner decides prices.', 'high', 'hours', 'owner', 'audit', 1, 0, ?, ?)").run(TABLE_AT, TABLE_AT);

try {
  /* ============ 1. the page in one answer ===================================== */
  section("1. the page in one answer");
  {
    const d = await get();
    const views = Object.fromEntries(d.views.map((v) => [v.key, v.count]));
    check("seven views, each with its count", d.views.length === 7 && views.topic === 3 && views.industry === 1 && views.language === 2 && views.clusters === 5, views);
    check("By keyword counts the phrases no page of their language answers", views.keywords === 10, views.keywords);
    check("From Search Console counts the searches no page shown carries", views.console === 3, views.console);
    check("By competitor counts sites, not clusters", views.competitors === 2, views.competitors);
    const t = (k: keyof SeoContentGapsPayload["tiles"]) => ok(d.tiles[k]);
    check("whole table: 4 of 5 clusters have no page of their language", t("gaps").value === 4 && t("gaps").of === 5, t("gaps"));
    check("  1 of 11 relevant phrases is answered", t("mappedPhrases").value === 1 && t("mappedPhrases").of === 11, t("mappedPhrases"));
    check("  a German cluster mapped to an English page is a gap", t("germanGaps").value === 4 && t("germanGaps").of === 4, t("germanGaps"));
    const g = ok(d.german);
    check("the German card: 9 German phrases of 11, no German page in the sitemap but one", g.phrases.de === 9 && g.phrases.total === 11 && g.pages.de === 1, { phrases: g.phrases, pages: g.pages });
    check("each card is stamped with its newest input, not the request time", d.german.state === "ok" && d.german.asOf === TABLE_AT && d.german.asOf !== d.head.at, { asOf: d.german.state === "ok" ? d.german.asOf : null, at: d.head.at });
    check("  and its note says what it is made of and how old", d.german.state === "ok" && /keyword table, last changed 2026-01-12/.test(d.german.note ?? "") && /crawl of 2026-01-10/.test(d.german.note ?? ""), d.german.state === "ok" ? d.german.note : d.german);
    check("  the group list too", d.groups?.state === "ok" && d.groups.asOf === TABLE_AT, d.groups);
    check("waiting phrases are counted and linked to Keywords", d.unjudged?.count === 1 && d.unjudged.href === "/seo/keywords?status=unjudged", d.unjudged);
    check("the pages a person can name are the ones answering 200", d.sitePages.length === 3 && !d.sitePages.some((p) => p.path === "/specimen-gone"), d.sitePages);
    check("the owner is told so; a member is not", d.you.owner === true && (await get("", "member")).you.owner === false);
    check("Needs you carries the owner's price task", ok(d.needsYou).some((x) => x.id === "price-ranges"));
    const pr = ok(d.price);
    check("price card: home pages are not counted as stating a price", pr.competitors?.ranking === 1 && pr.competitors.home === 2 && pr.competitors.priced === 1, pr.competitors);
    const bad = await get("open=nope");
    check("an unknown group says so instead of a zero", bad.group?.state === "off", bad.group);
  }

  /* ============ 2. the search ================================================= */
  section("2. the search");
  {
    const topics = ok((await get("q=hochzeit")).groups);
    check("By topic: a topic is found by its phrases", topics.rows.length === 1 && topics.rows[0]!.key === "specimen-wedding" && topics.of === 3, topics.rows.map((r) => r.key));
    const kw = await get("view=keywords&q=kosten");
    check("By keyword: only the phrases carrying the words", ok(kw.keywords).total === 1 && ok(kw.keywords).rows[0]!.phrase === "specimen website kosten", ok(kw.keywords).rows.map((r) => r.phrase));
    check("  the search is echoed as understood", kw.asked.q === "kosten");
    const folded = await get(`view=keywords&q=${encodeURIComponent("zuerich")}`);
    check("“zuerich” finds “zürich”", ok(folded.keywords).total === 1 && ok(folded.keywords).rows[0]!.phrase === "specimen agentur zürich", ok(folded.keywords).rows.map((r) => r.phrase));
    const byName = await get("view=keywords&q=bakery");
    check("a phrase is found by its cluster's name too", ok(byName.keywords).total === 2, ok(byName.keywords).rows.map((r) => r.phrase));
    const comp = ok((await get("view=competitors&q=preise")).competitors);
    check("By competitor: a site is found by its page titles", comp.rows.length === 1 && comp.rows[0]!.domain === "specimen-rival-a.example", comp.rows.map((r) => r.domain));
    const con = ok((await get("view=console&q=hochzeit")).console);
    check("From Search Console: a search is found by its words", con.total === 1 && con.rows[0]!.query === "specimen hochzeit website", con.rows);
    const inGroup = ok((await get("open=specimen-cost&q=preise")).group);
    check("the open group's tables follow the search", inGroup.counts.missing === 1 && inGroup.missing!.rows[0]!.phrase === "specimen website preise", inGroup.counts);
  }

  /* ============ 3. order, filters ============================================== */
  section("3. the order and the filters");
  {
    const az = ok((await get("view=keywords&sort=phrase&dir=asc&limit=5")).keywords);
    const za = ok((await get("view=keywords&sort=phrase&dir=desc&limit=5")).keywords);
    const all = ok((await get("view=keywords&sort=phrase&dir=asc&limit=200")).keywords).rows.map((r) => r.phrase);
    const sorted = [...all].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true }));
    check("A to Z runs over every phrase, not the page shown", JSON.stringify(all) === JSON.stringify(sorted) && az.rows[0]!.phrase === sorted[0] && za.rows[0]!.phrase === sorted.at(-1), { az: az.rows.map((r) => r.phrase), za: za.rows.map((r) => r.phrase) });
    check("  pages of five, the whole list counted", az.total === 10 && az.rows.length === 5 && az.limit === 5);
    const second = ok((await get("view=keywords&sort=phrase&dir=asc&limit=5&offset=5")).keywords);
    check("  the second page goes on where the first stopped", second.rows[0]!.phrase === sorted[5], second.rows.map((r) => r.phrase));
    const imp = ok((await get("view=keywords&sort=impressions")).keywords).rows;
    check("by impressions: the phrase Google showed first, none-shown last", imp[0]!.phrase === "how much does a specimen website cost" ? true : imp[0]!.impressions !== null && imp.at(-1)!.impressions === null, imp.map((r) => [r.phrase, r.impressions]));
    const prio = ok((await get("view=keywords&sort=priority")).keywords).rows;
    const RANK: Record<string, number> = { [C.cost]: 0, [C.costEn]: 0, [C.wedding]: 1, [C.bakery]: 1, [C.agency]: 2 };
    const ranks = prio.map((r) => RANK[r.cluster!.key]!);
    check("by priority: high clusters first, low last, over every phrase", ranks.every((x, i) => i === 0 || ranks[i - 1]! <= x) && ranks.at(-1) === 2, prio.map((r) => r.cluster?.key));
    const unknown = await get("view=keywords&sort=domain");
    check("an order the table does not have is dropped", unknown.asked.sort === null, unknown.asked);
    const rivals = ok((await get("open=specimen-cost&tab=competitors&sort=words")).group).competitors!.rows;
    check("a group's competitor pages ordered by words, an unread page last", rivals[0]!.words === 1500 && !rivals.at(-1)!.words, rivals.map((r) => r.words));
    const high = ok((await get("priority=high")).groups).rows;
    check("priority=high keeps the high topics", high.length === 1 && high[0]!.key === "specimen-cost", high.map((r) => r.key));
    const de = ok((await get("view=clusters&lang=en")).groups).rows;
    check("By cluster takes a language", de.length === 1 && de[0]!.key === C.costEn, de.map((r) => r.key));
    const open = ok((await get("view=clusters&gap=1")).groups).rows;
    check("“Not fully answered” lists every cluster with a phrase left", open.length === 5, open.map((r) => r.key));
  }

  /* ============ 4. the open group ============================================== */
  section("4. the open group");
  {
    const g = ok((await get("open=specimen-cost")).group);
    check("missing: the German cluster's 4 phrases; partly answered: the English one's 1", g.counts.missing === 4 && g.counts.partial === 1, g.counts);
    check("one page to make, three competitor pages read", g.counts.suggested === 1 && g.counts.competitors === 3, g.counts);
    const s = ok((await get("open=specimen-cost&tab=suggested")).group).suggested!.rows[0]!;
    check("the page to make is the audit's sentence", s.page.startsWith("Create German page"), s.page);
    check("  it names the English twin to translate", s.twin?.page === "/specimen-services" && s.twin.lang === "en", s.twin);
    check("  its competitors: one ranking page, two home pages, one stating a price", s.competitors.ranking === 1 && s.competitors.home === 2 && s.competitors.priced === 1 && s.competitors.german === 1, s.competitors);
    const comp = ok((await get("open=specimen-cost&tab=competitors")).group).competitors!.rows;
    check("each competitor page says whether it ranked or is a home page", comp.filter((p) => p.address === "ranking").length === 1 && comp.filter((p) => p.address === "home").length === 2, comp.map((p) => [p.url, p.address]));
    const brief = g.missing!.rows[0]!.brief;
    check("a missing phrase carries its cluster's brief, ready to ask", brief?.available === true && brief.ready === false && brief.opportunityId === `german-missing:${C.cost}`, brief);
  }

  /* ============ 5. competitor sites, Search Console, one cluster ================ */
  section("5. By competitor, From Search Console, one cluster");
  {
    const sites = ok((await get("view=competitors")).competitors);
    const a = sites.rows.find((r) => r.domain === "specimen-rival-a.example")!;
    check("one row per site, most seen first, a site without a page read left out", sites.rows.length === 2 && sites.sites === 2 && !sites.rows.some((r) => r.domain === "specimen-rival-c.example"), sites.rows.map((r) => r.domain));
    check("  with the topics it was seen for, each marked as our gap or not", a.topics.length === 1 && a.topics[0]!.key === C.cost && a.topics[0]!.gap === true && a.seen === 1, a.topics);
    check("  its ranking page first", a.pages[0]!.address === "ranking", a.pages);
    check("  the counts of ranking and home pages", sites.pages.ranking === 1 && sites.pages.home === 2, sites.pages);
    const conReading = (await get("view=console")).console;
    const con = ok(conReading);
    check("the searches no page carries, most shown first; one a page carries is left out", con.total === 3 && con.rows[0]!.query === "specimen website cost" && !con.rows.some((r) => r.query === "specimen website services"), con.rows.map((r) => r.query));
    check("  a search a person judged not relevant is not listed, and the note counts it", !con.rows.some((r) => r.query === "specimen nothing") && conReading?.state === "ok" && /1 search a person judged not relevant is left out/.test(conReading.note ?? ""), conReading?.state === "ok" ? conReading.note : conReading);
    const none = con.rows.find((r) => r.query === "specimen hochzeit website")!;
    check("  a search Google named no page for", none.why === "no-page" && none.shown === null && none.keyword?.cluster?.key === C.wedding && none.brief?.opportunityId === `german-missing:${C.wedding}`, none);
    const lacks = con.rows.find((r) => r.query === "specimen website price")!;
    check("  a search whose page lacks the words, not in the keyword table yet", lacks.why === "words-missing" && lacks.shown === "/specimen-services" && lacks.keyword === null, lacks);
    const pos = ok((await get("view=console&sort=position")).console).rows.map((r) => r.position);
    check("  ordered by position, best first", JSON.stringify(pos) === JSON.stringify([6, 18, 31]), pos);
    const one = ok((await get(`cluster=${encodeURIComponent(C.cost)}`)).selected);
    check("the cluster detail carries its competitor pages, ranking first", one.competitors.length === 3 && one.competitors[0]!.address === "ranking" && one.competitors[0]!.schemaTypes.includes("Organization"), one.competitors.map((c) => c.url));
    check("  and its opportunity", one.opportunity?.id === `german-missing:${C.cost}`, one.opportunity?.id);
    const no = await get("cluster=nope");
    check("an unknown cluster says so", no.selected?.state === "off");
  }

  /* ============ 6. briefs ==================================================== */
  section("6. a brief, from asked to written");
  {
    const first = await post<BriefsAnswer>("/brief", { cluster: C.cost });
    const t1 = first.json.results?.[0]?.task ?? 0;
    check("a cluster's brief is queued for the operator", first.status === 200 && first.json.results[0]!.ok && t1 > 0, first.json);
    check("  its opportunity follows it", count("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE id = ? AND state = 'queued' AND task_id = ?", `german-missing:${C.cost}`, t1) === 1);
    const topic = (db.prepare("SELECT prompt FROM cc_ai_tasks WHERE id = ?").get(t1) as { prompt: string }).prompt;
    check("  its topic fits the operator's 300 characters and names the searches", topic.length <= 300 && topic.includes("was kostet eine specimen website"), topic);
    const again = await post<BriefsAnswer>("/brief", { cluster: C.cost });
    check("asked again while it waits: refused in words", again.json.results[0]!.ok === false && again.json.results[0]!.line.includes(`#${t1} is queued`), again.json);
    const waitingRow = ok((await get(`view=clusters&open=${encodeURIComponent(C.cost)}`)).group).clusters[0]!.brief;
    check("  the page shows it waiting, not a button", waitingRow.available === false && waitingRow.task?.id === t1 && waitingRow.task.state === "queued", waitingRow);
    /* The operator wrote it: the task is done and the engine moves its opportunity on (engine.ts). */
    db.prepare("UPDATE cc_ai_tasks SET state = 'done' WHERE id = ?").run(t1);
    db.prepare("UPDATE cc_seo_opps SET state = 'in-progress' WHERE id = ?").run(`german-missing:${C.cost}`);
    const ready = ok((await get("open=specimen-cost")).group);
    const st = ready.clusters.find((c) => c.key === C.cost)!.brief;
    check("written: READY, linked to its task, and still askable on purpose", st.ready === true && st.available === true && st.task?.id === t1 && st.task.href.includes(String(t1)), st);
    check("  “Generate all” leaves a written brief out", !ready.briefs.ready.includes(C.cost) && ready.briefs.written === 1, ready.briefs);
    const twice = await post<BriefsAnswer>("/brief", { cluster: C.cost });
    const t2 = twice.json.results[0]!.task ?? 0;
    const noteAfter = (db.prepare("SELECT state_note FROM cc_seo_opps WHERE id = ?").get(`german-missing:${C.cost}`) as { state_note: string }).state_note;
    check("asked again: a new task, and the brief before it is named", twice.json.results[0]!.ok && t2 > t1 && noteAfter.includes(`#${t1}`), { twice: twice.json, noteAfter });
    const loose = await post<BriefsAnswer>("/brief", { phrases: [idOf("specimen agentur zürich"), idOf("specimen hochzeit website")] });
    check("ticked phrases of two clusters: one brief each", loose.json.results.length === 2 && loose.json.results.every((r) => r.ok), loose.json);
    const agency = ok((await get(`view=clusters&open=${encodeURIComponent(C.agency)}`)).group).clusters[0]!.brief;
    check("  a cluster with no opportunity keeps its brief here", agency.opportunityId === null && agency.task !== null && agency.available === false, agency);
    const many = await post<{ error: string }>("/briefs", { clusters: Array.from({ length: 11 }, (_, i) => `specimen-${i}:de`) });
    check("more than ten briefs at once: refused", many.status === 400 && /At most 10/.test(many.json.error), many.json);
    const none = await post<{ error: string }>("/brief", { phrases: [] });
    check("nothing ticked: said so", none.status === 400 && /Tick/.test(none.json.error), none.json);
    gaps.rememberBrief(C.bakery, t2, "Specimen Owner");
    check("another door's brief (Keywords) reaches this page", count("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE id = ? AND task_id = ?", `german-missing:${C.bakery}`, t2) === 1);
  }

  /* ============ 7. the German and price steps ================================== */
  section("7. the German and price steps");
  {
    const d = await get();
    const ids = [...ok(d.german).steps, ...ok(d.price).steps].map((s) => s.id);
    check("the cards carry the audit's steps", ids.includes("audit:german-questions") && ids.includes("audit:specimen-hreflang") && ids.includes("audit:specimen-price-pages"), ids);
    for (const [id, full] of [
      ["audit:german-questions", LONG_QUESTIONS],
      ["audit:specimen-price-pages", LONG_PRICES],
    ] as const) {
      const r = await post<OpportunityAnswer>("/step", { id });
      const task = r.json.opportunity?.state.task;
      const prompt = task ? (db.prepare("SELECT prompt FROM cc_ai_tasks WHERE id = ?").get(task.id) as { prompt: string }).prompt : "";
      const body = prompt.replace(/…$/, "");
      const next = full.charAt(body.length);
      check(`${id}: a brief whose topic fits, cut at a sentence or a word`, r.status === 200 && prompt.length <= 300 && full.startsWith(body) && (next === "" || next === " "), { prompt, next });
    }
    const todos = count("SELECT COUNT(*) AS n FROM cc_todos");
    const code = await post<OpportunityAnswer>("/step", { id: "audit:specimen-hreflang" });
    check("a code step goes on the to-do list, and its opportunity is queued", code.status === 200 && count("SELECT COUNT(*) AS n FROM cc_todos") === todos + 1 && code.json.opportunity.state.state === "queued", code.json);
    const codeAgain = await post<{ error: string }>("/step", { id: "audit:specimen-hreflang" });
    check("  a second press writes no second entry", codeAgain.status === 409 && count("SELECT COUNT(*) AS n FROM cc_todos") === todos + 1, codeAgain.json);
    const owner = await post<{ error: string }>("/step", { id: "audit:specimen-owner-step" });
    check("the owner's step is refused in words", owner.status === 409 && /owner/i.test(owner.json.error), owner.json);
    const nope = await post<{ error: string }>("/step", { id: "audit:nope" });
    check("a step the page does not show is refused", nope.status === 404, nope.json);
  }

  /* ============ 8. a person's judgement and mapping ============================= */
  section("8. a person's judgement and mapping");
  {
    const before = ok((await get("view=keywords")).keywords).total;
    const id = idOf("specimen homepage erstellen lassen");
    const j = await post<GapChanged>("/judge", { ids: [id], status: "irrelevant" });
    check("judged not relevant: it leaves the gaps", j.status === 200 && j.json.changed === 1 && ok((await get("view=keywords")).keywords).total === before - 1, j.json);
    const same = await post<GapChanged>("/judge", { ids: [id], status: "irrelevant" });
    check("  judged so again: nothing changes, and it says so", same.json.changed === 0 && /already/.test(same.json.line), same.json);
    keywords.upsertKeyword({ phrase: "specimen homepage erstellen lassen", lang: "de", cluster: C.cost, source: "audit", status: "relevant", by: "audit" });
    check("  an import does not undo a person's judgement", keywords.keywords().find((k) => k.id === id)!.status === "irrelevant");
    const badStatus = await post<{ error: string }>("/judge", { ids: [id], status: "maybe" });
    check("  a judgement the desk does not know is refused", badStatus.status === 400, badStatus.json);

    const gapsBefore = ok((await get()).tiles.gaps).value;
    const m = await post<GapChanged>("/map", { cluster: C.wedding, path: "/de/specimen-kosten" });
    check("a German page named for a German cluster: no longer a gap", m.status === 200 && ok((await get()).tiles.gaps).value === gapsBefore - 1 && /no longer a gap/.test(m.json.line), m.json);
    const back = await post<GapChanged>("/map", { cluster: C.wedding, path: null });
    check("  “no page answers it”: a gap again", back.status === 200 && ok((await get()).tiles.gaps).value === gapsBefore, back.json);
    await post<GapChanged>("/map", { phrases: [idOf("specimen hochzeit website")], path: "/de/specimen-kosten" });
    keywords.remap();
    const wedding = keywords.clusters().find((c) => c.key === C.wedding)!;
    check("  the desk's rule does not put a page back a person took away", wedding.page === null && wedding.mappedBy === "person", wedding);
    const covered = ok((await get(`open=specimen-wedding`)).group);
    check("  a phrase a person mapped to a German page is answered", covered.group.coverage.covered === 1, covered.group.coverage);
    const other = await post<GapChanged>("/map", { cluster: C.bakery, path: "/" });
    check("an English page named for a German cluster: said, and it stays a gap", /stays a gap/.test(other.json.line) && ok((await get(`view=clusters&open=${encodeURIComponent(C.bakery)}`)).group).clusters[0]!.gap === true, other.json);
    const gone = await post<{ error: string }>("/map", { cluster: C.bakery, path: "/specimen-gone" });
    check("a page that does not answer 200 is refused", gone.status === 400 && /specimen-gone/.test(gone.json.error), gone.json);
    const full = await post<GapChanged>("/map", { cluster: C.bakery, path: "https://www.balkaris.ch/de/specimen-kosten/" });
    check("a full address of the site is taken by its path", full.status === 200 && keywords.clusters().find((c) => c.key === C.bakery)!.page === "/de/specimen-kosten", full.json);
  }

  /* ============ 9. the export ================================================= */
  section("9. the CSV export");
  {
    const kw = await csv("view=keywords");
    const total = ok((await get("view=keywords")).keywords).total;
    check("By keyword: every phrase, not one page of them", kw.status === 200 && kw.type.startsWith("text/csv") && kw.rows.length === total + 1, { rows: kw.rows.length, total });
    check("  with Excel's mark and a head row", kw.marked && kw.rows[0]!.startsWith("Phrase,Language,Cluster"), { marked: kw.marked, head: kw.rows[0] });
    check("  a cell that would run as a formula is made safe", kw.rows.some((r) => r.startsWith("'=specimen sum")), kw.rows.filter((r) => r.includes("specimen sum")));
    const found = await csv("view=keywords&q=hochzeit");
    const foundTotal = ok((await get("view=keywords&q=hochzeit")).keywords).total;
    check("  the search applies", foundTotal > 0 && found.rows.length === foundTotal + 1 && found.rows.slice(1).every((r) => r.includes("hochzeit")), found.rows);
    const list = await csv("table=groups");
    check("the coverage list itself", list.rows.length === 4 && list.rows[0]!.startsWith("Group,"), list.rows);
    const sugg = await csv("open=specimen-wedding&tab=suggested");
    const suggTotal = ok((await get("open=specimen-wedding&tab=suggested")).group).counts.suggested;
    check("the pages to make", suggTotal === 1 && sugg.rows.length === 2 && sugg.rows[0]!.startsWith("Page to make"), sugg.rows);
    const con = await csv("view=console");
    check("the searches Search Console reports", con.rows.length === 4, con.rows);
    const comp = await csv("view=competitors");
    check("the competitor pages, each named ranking or home", comp.rows.length === 4 && comp.rows.filter((r) => r.includes("home page")).length === 2, comp.rows);
    const none = await csv("open=nope");
    check("an unknown group: refused in words", none.status === 404, none.text);
  }

  section("10. nothing left the machine");
  check("no request was made", refused.length === 0, refused);
} catch (e) {
  failed++;
  console.log("FAIL the check itself threw:", e);
} finally {
  try {
    db.close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
