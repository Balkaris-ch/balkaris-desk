/**
 * SEO › Opportunities, proved without Google, the website or the network.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-opportunities.ts
 *   npm run check:seo-opportunities
 *
 * A throwaway database and a guard on `fetch` that refuses every host: the
 * page and the engine read only the desk's own tables. Every figure, phrase,
 * page and name in here is a SPECIMEN, made up and named so (/specimen-a,
 * "specimen phrase"); none of it describes the real website.
 *
 * What is proved:
 *   1. GET /: the search box finds a word in a row's evidence and in its
 *      topic's phrases; every facet counts with the other filters applied (a
 *      chip's number is the length of the list it leads to); a decision is
 *      listed whether or not the rules still find it; "no longer found" counts
 *      with the filters; a quoted query is credited to its phrase; the
 *      "View all" links carry every judgement or lead to the page's queries;
 *      Switzerland alone; the new orders; bad values fall back;
 *   2. GET /export.csv: every matching row, unknown left empty, never zero;
 *   3. the changes: "Mark indexing requested" in bulk, a decision for more
 *      than fifty at once, back to open with a reason, a code step on the
 *      to-do list, each in the opportunity's own history;
 *   4. the engine: an index check cut short clears nothing it did not reach
 *      (the bug of 2026-10-03), an address with no result at all is kept,
 *      a whole check clears what Google now indexes; slow pages from two slow
 *      lab runs in a row; a crawl of a site that did not answer clears none
 *      of the crawl's rows; a catch-all cluster is not a gap.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-opps-"));
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
await import("../src/cc/seo/tables.ts");
await import("../src/cc/search/gsc.ts");
await import("../src/cc/site/psi.ts");
await import("../src/cc/operator/tables.ts");
const engine = await import("../src/cc/seo/engine.ts");
const rules = await import("../src/cc/seo/rules.ts");
const opps = await import("../src/cc/routes/seo/opportunities.ts");
const { apiError } = await import("../src/cc/api.ts");
const { Hono } = await import("hono");
import type { Person } from "../src/people.ts";
import type { Vars } from "../src/cc/access.ts";
import type { Found } from "../src/cc/seo/engine.ts";
import type { OpportunitiesActed, OpportunityAnswer } from "../web/src/contract/seo/common.ts";
import type { SeoOpportunitiesPayload } from "../web/src/contract/seo/opportunities.ts";

const OWNER = { telegram: 1, name: "Specimen Owner", email: "owner@specimen.invalid", owner: true, canPublish: true, seesLeads: true } as unknown as Person;

const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  c.set("who", OWNER);
  await next();
});
app.route("/", opps.routes);
app.onError(apiError);

async function get(q = ""): Promise<SeoOpportunitiesPayload> {
  const res = await app.request(`/${q ? `?${q}` : ""}`);
  return (await res.json()) as SeoOpportunitiesPayload;
}
async function post<T>(p: string, body: unknown): Promise<{ status: number; json: T & { error?: string } }> {
  const res = await app.request(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as T & { error?: string } };
}
const ids = (p: SeoOpportunitiesPayload): string[] => (p.list.state === "ok" ? p.list.value.rows.map((r) => r.id) : []);
const total = (p: SeoOpportunitiesPayload): number => (p.list.state === "ok" ? p.list.value.total : -1);

/* ---- the days ------------------------------------------------------------- */
const dayAt = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const SITE = "https://www.balkaris.ch";
const AT = new Date().toISOString();

/* ---- the specimen history: one search in two spellings, Switzerland apart ---- */
{
  const q = db.prepare("INSERT INTO cc_seo_rank_queries (day, country, device, query, clicks, impressions, position) VALUES (?, ?, 'DESKTOP', ?, 0, ?, ?)");
  const r = db.prepare("INSERT INTO cc_seo_rank (day, country, device, query, page, clicks, impressions, position) VALUES (?, ?, 'DESKTOP', ?, ?, 0, ?, ?)");
  const p = db.prepare("INSERT INTO cc_seo_rank_pages (day, country, device, page, clicks, impressions, position) VALUES (?, ?, 'DESKTOP', ?, 0, ?, ?)");
  const s = db.prepare("INSERT INTO cc_seo_snaps (day, at, query_rows, page_rows, day_rows) VALUES (?, ?, 1, 1, 1)");
  for (let o = -40; o <= -3; o++) {
    const day = dayAt(o);
    s.run(day, AT);
    for (const [country, quoted, plain] of [["all", 3, 1], ["che", 1, 0]] as const) {
      q.run(day, country, '"specimen phrase"', quoted, 6);
      r.run(day, country, '"specimen phrase"', `${SITE}/specimen-a`, quoted, 6);
      if (plain) {
        q.run(day, country, "specimen phrase", plain, 8);
        r.run(day, country, "specimen phrase", `${SITE}/specimen-a`, plain, 8);
      }
      p.run(day, country, `${SITE}/specimen-a`, quoted + plain, 6.5);
    }
  }
  const kw = db.prepare("INSERT INTO cc_seo_keywords (phrase, lang, cluster, status, sources, first_seen, last_seen) VALUES (?, ?, ?, ?, 'audit', ?, ?)");
  kw.run("specimen phrase", "en", "specimen-cluster:en", "relevant", AT, AT);
  kw.run("specimen phrase irrelevant", "en", "specimen-cluster:en", "irrelevant", AT, AT);
  kw.run("specimen preis", "de", "specimen-gap:de", "relevant", AT, AT);
  const cl = db.prepare("INSERT INTO cc_seo_clusters (key, name, lang, priority, source, first_seen, updated_at) VALUES (?, ?, ?, 'medium', 'audit', ?, ?)");
  cl.run("specimen-cluster:en", "Specimen services", "en", AT, AT);
  cl.run("specimen-gap:de", "Specimen prices (DE)", "de", AT, AT);
}

/* ---- the specimen opportunities, kept by the engine's own persist() ------- */
const ev = (label: string, value: string) => ({ label, value, source: "desk" as const, asOf: null });
const found = (o: Partial<Found> & Pick<Found, "id" | "type">): Found => ({
  page: null,
  keyword: null,
  cluster: null,
  title: `Specimen ${o.id}`,
  evidence: [ev("Specimen", "measured")],
  priority: "medium",
  priorityWhy: "Medium: a specimen.",
  potential: null,
  action: { kind: "brief", label: "Write a brief", step: "A specimen brief.", operator: { kind: "brief", prompt: "A specimen brief.", depth: "deep" }, ownerTaskId: null, href: null },
  early: false,
  ...o,
});
const code = (step: string) => ({ kind: "code" as const, label: "Hand to the website's code", step, operator: null, ownerTaskId: null, href: null });
const NEAR = 'near-page-one:"specimen phrase"';
const SEEDED: Found[] = [
  found({ id: NEAR, type: "near-page-one", page: "/specimen-a", keyword: '"specimen phrase"', cluster: "specimen-cluster:en", potential: { clicksPerMonth: 2, targetPosition: 3, basis: "specimen" } as never }),
  found({ id: "low-ctr:/specimen-a", type: "low-ctr", page: "/specimen-a" }),
  found({ id: "technical:title.long:/specimen-b", type: "technical", page: "/specimen-b", action: code("Shorten the specimen title.") }),
  found({ id: "technical:links.broken:/specimen-d", type: "technical", page: "/specimen-d", action: code("Mend the specimen link.") }),
  found({
    id: "not-indexed:/specimen-c",
    type: "not-indexed",
    page: "/specimen-c",
    action: { kind: "chrome", label: "Request indexing", step: "Request it.", operator: null, ownerTaskId: null, href: "https://search.google.com/search-console/inspect?specimen" },
  }),
  found({ id: "german-missing:specimen-gap:de", type: "german-missing", cluster: "specimen-gap:de", evidence: [ev("People search for", "specimen kostenrechner")] }),
  ...Array.from({ length: 120 }, (_, i) => found({ id: `thin-content:/bulk-${i}`, type: "thin-content", page: `/bulk-${i}`, priority: "low", priorityWhy: "Low: a specimen." })),
];
engine.persist(SEEDED, new Set());

try {
  /* ============ 1. GET / ======================================================== */
  section("1. the page");
  {
    const all = await get();
    check("the list answers, every specimen row to do", all.list.state === "ok" && total(all) === SEEDED.length, total(all));
    const k = await get("q=kosten");
    check("the search finds a word that is only in a row's evidence", ids(k).join() === "german-missing:specimen-gap:de", ids(k));
    const preis = await get("q=preis");
    check("  and a word that is only one of its topic's phrases", ids(preis).includes("german-missing:specimen-gap:de"), ids(preis));
    const sumTypes = k.facets.types.reduce((n, t) => n + t.count, 0);
    check("the facets count with the search applied: the chips add up to the list", k.facets.all === 1 && sumTypes === 1 && k.facets.priorities.reduce((n, p) => n + p.count, 0) === 1, k.facets);
    const thin = await get("type=thin-content&q=bulk");
    check("  a chip's count is the length of the list it leads to", thin.facets.types.find((t) => t.type === "thin-content")?.count === total(thin) && total(thin) === 120, { chip: thin.facets.types, total: total(thin) });

    /* A decision the rules no longer find: done, then not found by a crawl that looked. */
    await post("/state", { id: "technical:title.long:/specimen-b", state: "done" });
    engine.persist(SEEDED.filter((f) => f.id !== "technical:title.long:/specimen-b"), new Set(["crawl"]));
    const done = await get("state=done");
    check("'Done' lists the row the rules stopped finding (the work that landed)", ids(done).includes("technical:title.long:/specimen-b") && done.asked.active === "all" && done.asked.activeDefault === "all", { ids: ids(done), asked: done.asked });
    const todo = await get();
    check("  and the to-do list does not", !ids(todo).includes("technical:title.long:/specimen-b") && todo.asked.active === "1" && todo.facets.cleared === 1, todo.facets.cleared);
    check("'no longer found' counts with the filters", (await get("q=specimen-b")).facets.cleared === 1 && (await get("q=nothing-like-this")).facets.cleared === 0);
    const gone = await get("active=0&state=open,queued,in-progress,done,dismissed");
    check("  and lists exactly those", ids(gone).join() === "technical:title.long:/specimen-b", ids(gone));

    const near = await get(`open=${encodeURIComponent(NEAR)}`);
    const d = near.selected?.state === "ok" ? near.selected.value : null;
    const f = d?.figures.state === "ok" ? d.figures.value : null;
    check("the detail quotes a quoted query once", f?.label === "“specimen phrase”", f?.label);
    const panel = d?.cluster.state === "ok" ? d.cluster.value : null;
    const row = panel?.rows.find((r) => r.phrase === "specimen phrase");
    const days = 28;
    check("Google's quoted query is credited to its phrase (both spellings added)", !!row && row.impressions !== null && row.impressions >= days * 4 - 8 && row.position !== null, row);
    check("'View all' shows every judgement, as the total counts them", panel?.href === "/seo/keywords?cluster=specimen-cluster%3Aen&status=all" && panel.total === 2, panel?.href);
    check("the results as the public sees them: Google and Bing for Switzerland, without the searcher's quotes", d?.lookups.length === 2 && d.lookups[0]!.href.includes("q=specimen%20phrase&gl=ch") && d.lookups[1]!.href.includes("cc=ch"), d?.lookups);
    const page = await get(`open=${encodeURIComponent("low-ctr:/specimen-a")}`);
    const pp = page.selected?.state === "ok" && page.selected.value.cluster.state === "ok" ? page.selected.value.cluster.value : null;
    check("a page's searches lead to Search Console's queries for that page, the same set", pp?.kind === "page" && pp.href === "/seo/search-console?dimension=query&page=%2Fspecimen-a" && pp.total === 2, pp);

    const che = await get("country=che");
    const nowAll = todo.list.state === "ok" ? todo.list.value.rows.find((r) => r.id === NEAR)?.now : null;
    const nowChe = che.list.state === "ok" ? che.list.value.rows.find((r) => r.id === NEAR)?.now : null;
    check("Switzerland alone: the rows' figures are Switzerland's", che.asked.country === "che" && che.rank.state === "ok" && che.rank.value.country === "che" && !!nowAll && !!nowChe && nowChe.impressions < nowAll.impressions, { nowAll, nowChe });
    const shown = await get("sort=shown");
    /* The page is shown for both spellings (4 a day), the quoted query alone 3 a day; a row with nothing to measure comes after both. */
    check("'Most shown in Google' puts the most impressions first", shown.asked.sort === "shown" && ids(shown).slice(0, 2).join() === `low-ctr:/specimen-a,${NEAR}`, ids(shown).slice(0, 3));
    const posd = await get("sort=position");
    check("'Best position first' puts a ranked row first", ["low-ctr:/specimen-a", NEAR].includes(ids(posd)[0]!), ids(posd).slice(0, 3));
    /* Keywords' "Its opportunities (n)" counts the rows whose subject is exactly that phrase; ?keyword= lands on those n. */
    const exact = await get(`keyword=${encodeURIComponent('"Specimen   Phrase"')}`);
    check("?keyword= keeps exactly the phrase's opportunities (spelt as Keywords spells it: case, spaces and quotes folded)", exact.asked.keyword === "specimen phrase" && ids(exact).join() === NEAR, { asked: exact.asked.keyword, ids: ids(exact) });
    check("  and a phrase nothing is filed under lists nothing", ids(await get("keyword=nothing%20like%20it")).length === 0);
    const bad = await get("sort=bogus&limit=500&active=maybe&state=nope&country=xx");
    check("bad values fall back, never a 400", bad.asked.sort === "priority" && bad.asked.limit === 200 && bad.asked.active === "1" && bad.asked.states.join() === "open,queued,in-progress" && bad.asked.country === "all", bad.asked);
    check("the engine's inputs say what was read: no crawl, no index check, Bing not connected", all.inputs.state === "ok" && all.inputs.value.inputs.find((i) => i.key === "bing")?.state === "off" && all.inputs.value.inputs.find((i) => i.key === "index")?.state === "unread", all.inputs);
  }

  /* ============ 2. GET /export.csv =========================================== */
  section("2. the export");
  {
    const res = await app.request("/export.csv?q=kosten");
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    check("the list as filtered, as CSV, every matching row", res.status === 200 && /text\/csv/.test(res.headers.get("content-type") ?? "") && lines.length === 2 && lines[1]!.includes("german-missing:specimen-gap:de"), { status: res.status, lines });
    const every = await (await app.request("/export.csv")).text();
    check("  not one page of it: all to-do rows", every.trim().split(/\r?\n/).length === 1 + SEEDED.length - 1, every.trim().split(/\r?\n/).length);
    const near = every.split(/\r?\n/).find((l) => l.includes(NEAR.replace(/"/g, '""')));
    const thin = every.split(/\r?\n/).find((l) => l.includes("thin-content:/bulk-0,") || l.endsWith("thin-content:/bulk-0"));
    check("  a page Google did not show reads empty, not 0", !!thin && !/,0,0,0,/.test(thin) && !!near, { thin, near });
  }

  /* ============ 3. the changes ============================================== */
  section("3. the changes");
  {
    const r = await post<OpportunitiesActed>("/act", { ids: ["not-indexed:/specimen-c", "low-ctr:/specimen-a"], requested: true });
    check("'Mark indexing requested' in bulk marks the address waiting for it", r.status === 200 && r.json.results.find((x) => x.id === "not-indexed:/specimen-c")?.ok === true, r.json);
    check("  and refuses any other row with the reason", r.json.results.find((x) => x.id === "low-ctr:/specimen-a")?.ok === false, r.json.results);
    check("  in progress now", engine.opportunity("not-indexed:/specimen-c")?.state.state === "in-progress");
    const back = await post<OpportunityAnswer>("/state", { id: "not-indexed:/specimen-c", state: "open", note: "Pressed by mistake" });
    check("back to open from in progress, with the reason kept", back.json.opportunity?.state.state === "open" && back.json.opportunity.state.note === "Pressed by mistake", back.json);
    const bulk = Array.from({ length: 120 }, (_, i) => `thin-content:/bulk-${i}`);
    const many = await post<OpportunitiesActed>("/state", { ids: bulk, state: "dismissed" });
    check("a decision for a whole page of the list (120 rows, more than the old 50)", many.status === 200 && many.json.results.filter((x) => x.ok).length === 120, { status: many.status, error: many.json.error });
    const tooMany = await post<OpportunitiesActed>("/act", { ids: bulk.slice(0, 11) });
    check("  operator tasks stay ten at most", tooMany.status === 400 && /10/.test(tooMany.json.error ?? ""), tooMany.json);
    const todo = await post<OpportunityAnswer>("/act", { id: "technical:links.broken:/specimen-d" });
    const kept = (db.prepare("SELECT COUNT(*) AS n FROM cc_todos").get() as { n: number }).n;
    check("a change to the website's code goes on the to-do list, queued with its number", todo.json.opportunity?.state.state === "queued" && kept === 1 && /#\d+/.test(todo.json.opportunity.state.note ?? ""), todo.json);
    const again = await post<OpportunityAnswer>("/act", { id: "technical:links.broken:/specimen-d" });
    check("  pressed again, it is refused, not added twice", again.status === 409 && (db.prepare("SELECT COUNT(*) AS n FROM cc_todos").get() as { n: number }).n === 1, again.json);
    const hist = await get(`open=${encodeURIComponent("not-indexed:/specimen-c")}&state=open,queued,in-progress,done,dismissed`);
    const trail = hist.selected?.state === "ok" ? hist.selected.value.trail : [];
    check("its history lists what people did, newest first", trail.length >= 2 && /Opened again/.test(trail[0]!.text) && trail.some((t) => /Request indexing/.test(t.text)), trail);
    const bogus = await post("/state", { id: "no-such:thing", state: "done" });
    check("an unknown opportunity is a 404 with a sentence", bogus.status === 404 && /no opportunity/i.test((bogus.json as { error?: string }).error ?? ""), bogus);
  }

  /* ============ 4. the engine ============================================== */
  section("4. the engine");
  {
    const ins = db.prepare(
      "INSERT INTO cc_inspect (day, url, coverage, is_indexed, link, checked_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const size = (day: string, n: number) => db.prepare("INSERT INTO cc_series (metric, day, value) VALUES ('gsc.sitemap_addresses', ?, ?) ON CONFLICT(metric, day) DO UPDATE SET value = excluded.value").run(day, n);
    const CRAWLED = "Crawled - currently not indexed";
    const inspect = (day: string, rows: [string, boolean][]) => {
      for (const [p, indexed] of rows) ins.run(day, `${SITE}${p}`, indexed ? "Submitted and indexed" : CRAWLED, indexed ? 1 : 0, `https://search.google.com/search-console/inspect?specimen=${p}`, `${day}T06:00:00Z`);
    };
    const active = (id: string): boolean => !!(db.prepare("SELECT active FROM cc_seo_opps WHERE id = ?").get(id) as { active: number } | undefined)?.active;
    const NI = ["/ni-a", "/ni-b", "/ni-c"].map((p) => `not-indexed:${p}`);

    /* A whole check: three addresses not indexed. */
    const d1 = dayAt(-12);
    inspect(d1, [["/ni-a", false], ["/ni-b", false], ["/ni-c", false], ["/ni-d", true]]);
    size(d1, 4);
    await engine.runEngine();
    check("a whole index check: one row per address not indexed", NI.every(active) && !active("not-indexed:/ni-d"));

    /* Cut short: the next check reached one address of four. */
    const d2 = dayAt(-10);
    inspect(d2, [["/ni-a", false]]);
    size(d2, 4);
    const line = await engine.runEngine();
    check("an index check cut short clears nothing it did not reach (2026-10-03: 34 of 40 cleared)", NI.every(active), NI.map((id) => [id, active(id)]));
    check("  the run says it read the index in part", /read in part: the index check of/.test(line), line);
    const input = engine.engineInputs().find((i) => i.key === "index");
    check("  and the page says so: partial, 1 of 4 reached", input?.state === "partial" && /reached 1 of 4/.test(input.line), input);

    /* Cut short again, a week on: the other addresses have no result at all now. */
    const d3 = dayAt(-1);
    inspect(d3, [["/ni-a", false]]);
    size(d3, 4);
    await engine.runEngine();
    check("an address with no result in the last week is kept as it was, never read as indexed", NI.every(active), NI.map((id) => [id, active(id)]));

    /* A whole check: /ni-a is indexed now. */
    const d4 = dayAt(0);
    inspect(d4, [["/ni-a", true], ["/ni-b", false], ["/ni-c", false], ["/ni-d", true]]);
    size(d4, 4);
    await engine.runEngine();
    const why = (db.prepare("SELECT cleared_why AS w FROM cc_seo_opps WHERE id = 'not-indexed:/ni-a'").get() as { w: string | null }).w;
    check("a whole check clears what Google indexes now, with the reason", !active("not-indexed:/ni-a") && active("not-indexed:/ni-b") && active("not-indexed:/ni-c") && /indexed now/.test(why ?? ""), why);

    /* Slow pages: two slow mobile lab runs in a row. */
    const v = db.prepare("INSERT INTO cc_vitals (at, day, path, strategy, performance, lcp_ms) VALUES (?, ?, ?, 'mobile', ?, ?)");
    v.run(AT, dayAt(-2), "/slow-a", 40, 5200);
    v.run(AT, dayAt(-1), "/slow-a", 35, 6100);
    v.run(AT, dayAt(-2), "/slow-b", 90, 2000);
    v.run(AT, dayAt(-1), "/slow-b", 45, 5000);
    v.run(AT, dayAt(-1), "/slow-c", 60, 4500);
    await engine.runEngine();
    const slowA = engine.opportunity("technical:speed:/slow-a");
    check("a page slow in two lab runs in a row is listed, with its figures and the report's link", !!slowA?.active && slowA.evidence.some((e) => e.value === "6.1 s") && /pagespeed\.web\.dev/.test(slowA.action.href ?? ""), slowA?.evidence);
    check("  one slow run after a fast one is not, one run alone is", !engine.opportunity("technical:speed:/slow-b") && !!engine.opportunity("technical:speed:/slow-c")?.active);

    /* A crawl of a site that did not answer: 402 for every page. */
    const read = engine.crawlRead({ at: AT, pages: [1, 2, 3, 4].map((i) => ({ path: `/p${i}`, inSitemap: true, status: 402 })), byPath: new Map() } as never);
    check("a crawl that read none of the site is not a reading of it", read.readable === false && read.mostly === 402 && read.answered === 0, read);
    engine.persist([found({ id: "internal-links:/specimen-e", type: "internal-links", page: "/specimen-e", action: code("Link it.") })], new Set(["crawl"]));
    engine.persist([], new Set(["index", "search", "drops", "clusters", "readiness", "audit", "speed", "targets"]));
    check("  so the crawl's rows are kept while the crawl family has not looked", active("internal-links:/specimen-e") && engine.familyOf("internal-links:/specimen-e") === "crawl" && engine.familyOf("technical:speed:/x") === "speed");

    /* A catch-all group of leftover phrases is not a topic. */
    check("a catch-all cluster is not a gap", rules.CATCH_ALL.test("other:de") && rules.CATCH_ALL.test("marketing-generic:de") && !rules.CATCH_ALL.test("web-industry:de"));
    engine.persist([found({ id: "german-missing:other:de", type: "german-missing", cluster: "other:de" })], new Set());
    engine.persist([], new Set(["clusters"]));
    const cw = (db.prepare("SELECT cleared_why AS w FROM cc_seo_opps WHERE id = 'german-missing:other:de'").get() as { w: string }).w;
    check("  one kept from before is cleared, saying why", /catch-all/.test(cw), cw);

    const steps = (db.prepare("SELECT action FROM cc_seo_opps").all() as { action: string }[]).map((r) => (JSON.parse(r.action) as { step: string }).step);
    check("no step reads '..' (a finding's own full stop and the step's)", !steps.some((s) => /[^.]\.\.[^.]/.test(s)), steps.find((s) => /[^.]\.\.[^.]/.test(s)));
    const m = engine.byPhrase([
      { query: '"specimen phrase"', clicks: 1, impressions: 3, position: 6 },
      { query: "specimen phrase", clicks: 0, impressions: 1, position: 10 },
    ]);
    check("Search Console's spellings of one phrase are added, the position weighted", m.get("specimen phrase")?.impressions === 4 && m.get("specimen phrase")?.position === 7, [...m]);
    check("a query is quoted without the searcher's own quotes", engine.shownQuery('"specimen phrase"') === "specimen phrase");
  }

  section("nothing left the machine");
  check("no request went out", refused.length === 0, refused);
} catch (err) {
  failed++;
  console.log(`FAIL the check stopped: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
} finally {
  try {
    db.close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
