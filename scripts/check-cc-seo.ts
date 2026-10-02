/**
 * The SEO screen's route, proved without Search Console, Bing or GA4.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo.ts
 *
 * Nothing leaves this machine: a throwaway database, no key of any kind, and
 * a guard on `fetch` that refuses every request. Every search figure in here
 * is a SPECIMEN, made up and named so ("specimen query 01", /specimen/a);
 * none of it describes the real website.
 *
 * What is proved:
 *   1. with nothing connected, every Search Console and Bing panel is absent
 *      with the source's own reason and step, never a zero, and no request is
 *      made; the crawl's panels wait for the first crawl;
 *   2. the assembling functions turn hand-made Search Console readings into
 *      exactly the figures the rules say (ranking headline, opportunities and
 *      their earlier count, gaps by group, movements, the overview);
 *   3. a comparison with a period before measurement began is absent, not 0%;
 *   4. the crawl's daily figures compare only with a day the history reaches;
 *   5. ?specimen=1 feeds the connected state only where specimenAllowed says
 *      so, and says `specimen: true` when it does; never with an https DESK_URL;
 *   6. the full lists and the report answer, and an unknown list is a 404.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "SITE_READ_REPO", "SITE_REPO"]) delete process.env[k];
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "absent.json");
process.env.SITE_READ_CLONE = "off";

/* ---- nothing leaves this machine ------------------------------------------ */
let requests = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  requests++;
  throw new Error(`the check tried to leave the machine: ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;

let passed = 0;
let failed = 0;
function check(name: string, good: boolean, detail?: unknown): void {
  if (good) passed++;
  else failed++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${!good && detail !== undefined ? `\n     ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
}

const seo = await import("../src/cc/routes/seo.ts");
const store = await import("../src/cc/store.ts");
import type { Reading } from "../web/src/contract/common.ts";
import type { SeoList, SeoPayload, SeoReport } from "../web/src/contract/seo.ts";
import type { SearchSources } from "../src/cc/routes/seo.ts";

const isOk = <T>(r: Reading<T>): r is Extract<Reading<T>, { state: "ok" }> => r.state === "ok";

async function get<T>(p: string): Promise<{ status: number; body: T }> {
  const res = await seo.routes.request(p);
  return { status: res.status, body: (await res.json()) as T };
}

try {
  /* ---- 1. nothing connected ---------------------------------------------- */
  process.env.DESK_URL = "https://desk.example.invalid";
  process.env.DESK_DEV_USER = "";
  const bare = await get<SeoPayload>("/?range=30d");
  check("the screen answers 200 with nothing connected", bare.status === 200);
  const p = bare.body;
  check("not a specimen", p.specimen === false);
  for (const [name, r] of Object.entries({
    indexed: p.tiles.indexed,
    notIndexed: p.tiles.notIndexed,
    keywordOpportunities: p.tiles.keywordOpportunities,
    ctrOpportunities: p.tiles.ctrOpportunities,
    ranking: p.ranking,
    opportunities: p.opportunities,
    gaps: p.gaps,
    movements: p.movements,
    console: p.console,
  })) {
    check(`${name} is absent, from Search Console, with a reason`, r.state !== "ok" && (r.source === "gsc" || r.source === "crawl") && r.reason.length > 10, r);
  }
  check("backlinks are absent, from Bing, with its step", p.tiles.backlinks.state === "off" && p.tiles.backlinks.source === "bing" && !!p.tiles.backlinks.step, p.tiles.backlinks);
  check("the score waits for the first crawl", p.tiles.score.state === "waiting" && p.tiles.score.source === "crawl", p.tiles.score);
  check("critical issues wait for the first crawl", p.tiles.critical.state === "waiting");
  check("landing pages are absent (GA4 has no key either)", p.landing.state !== "ok", p.landing);
  check("ten checks in the board's order", p.checks.map((c) => c.key).join() === "indexed,sitemap,robots,canonical,titles,descriptions,schema,redirects,broken,internal");
  check("Pages indexed is absent until Search Console", p.checks[0]!.reading.state !== "ok");
  check("every check leads to its part of the report", p.checks.every((c) => c.href === `/seo/report#${c.key}`));
  check("the specimen switch is refused on an https desk", (await get<SeoPayload>("/?specimen=1")).body.specimen === false);
  check("no request left the machine", requests === 0, requests);

  /* ---- 2. hand-made Search Console readings ------------------------------ */
  const at = "2026-09-30T10:00:00.000Z";
  const w = { start: "2026-09-01", end: "2026-09-30", previousStart: "2026-08-02", previousEnd: "2026-08-31", days: 30 };
  const said = <T>(value: T): Reading<T> => ({ state: "ok", value, source: "gsc", asOf: at, note: "Specimen." });
  const fig = (clicks: number, impressions: number, position: number) => ({ clicks, impressions, ctr: impressions ? Math.round((clicks / impressions) * 10000) / 100 : 0, position });
  const queries = [
    { query: "specimen query 01", ...fig(9, 300, 2.5), previous: fig(5, 200, 4) },
    { query: "specimen query 02", ...fig(3, 120, 7), previous: fig(1, 80, 12) },
    { query: "specimen query 03", ...fig(0, 90, 18), previous: null },
    { query: "specimen query 04", ...fig(0, 40, 61), previous: fig(0, 35, 70) },
  ];
  const off = { state: "off" as const, source: "gsc" as const, reason: "Specimen: not connected.", step: "Specimen step." };
  const src: SearchSources = {
    totals: said({
      window: w,
      from: w.start,
      clicks: { value: 12, previous: 6, unit: "count", series: [5, 7] },
      impressions: { value: 550, previous: 315, unit: "count", series: [250, 300] },
      ctr: { value: 2.18, previous: 1.9, unit: "percent", series: [2, 2.33] },
      position: { value: 9.1, previous: 11.2, unit: "ratio", series: [9, 9.2] },
      days: [
        { date: "2026-09-29", clicks: 5, impressions: 250, ctr: 2, position: 9, previous: null },
        { date: "2026-09-30", clicks: 7, impressions: 300, ctr: 2.33, position: 9.2, previous: null },
      ],
    }),
    buckets: said({ window: w, from: w.start, complete: true, days: [{ date: "2026-09-30", top3: 1, top10: 2, top50: 3, queries: 4 }] }),
    queries: said({ window: w, rows: queries, complete: true }),
    previousQueries: said({ rows: [{ query: "specimen query 01", position: 4, impressions: 200 }, { query: "specimen query 02", position: 12, impressions: 80 }, { query: "specimen query 09", position: 55, impressions: 10 }] }),
    opportunities: said({ window: w, floor: 30, rows: queries.filter((q) => q.position >= 4 && q.position <= 20).map((q) => ({ ...q, page: null, path: "/specimen/a" })) }),
    outliers: said({ window: w, floor: 50, rows: [] }),
    movers: said({
      window: w,
      floor: 30,
      rows: [
        { kind: "query" as const, key: "specimen query 02", previous: 12, current: 7, change: 5, impressions: 120, previousImpressions: 80, clicks: 3 },
        { kind: "page" as const, key: "https://www.balkaris.ch/specimen/b", path: "/specimen/b", previous: 9, current: 11, change: -2, impressions: 60, previousImpressions: 50, clicks: 1 },
      ],
    }),
    gaps: said({
      window: w,
      floor: 10,
      rows: [
        { query: "specimen query 02", ...fig(3, 120, 7), page: null, path: "/specimen/a" },
        { query: "specimen query 03", ...fig(0, 90, 18), page: null, path: "/specimen/a" },
        { query: "specimen query 04", ...fig(0, 40, 61), page: null, path: "/specimen/elsewhere" },
      ],
    }),
    pages: said({ window: w, rows: [{ page: "https://www.balkaris.ch/specimen/a", path: "/specimen/a", ...fig(12, 550, 8), previous: fig(6, 315, 10) }], complete: true }),
    queryPages: said({ window: w, rows: [{ query: "specimen query 02", page: "https://www.balkaris.ch/specimen/a", path: "/specimen/a", ...fig(3, 120, 7) }], complete: true }),
    indexing: said({ day: "2026-09-30", inspected: 4, of: 5, complete: false, indexed: 3, notIndexed: 1, canonicalDiffers: 0, rows: [] }),
    indexHistory: [],
    links: off as unknown as SearchSources["links"],
    linkHistory: [],
    consoleHref: null,
  };

  const ranking = seo.assembleRanking(src);
  check("ranking: the headline counts queries at 50 or better", isOk(ranking) && ranking.value.top50 === 3, ranking);
  check("ranking: the window before counts the same way", isOk(ranking) && ranking.value.previousTop50 === 2, ranking);
  check("ranking: carries Search Console's time and note", isOk(ranking) && ranking.asOf === at && ranking.source === "gsc");
  const noBefore = seo.assembleRanking({ ...src, previousQueries: null });
  check("ranking: no earlier window, no comparison (null, not 0)", isOk(noBefore) && noBefore.value.previousTop50 === null);

  const tiles = await seo.assembleTiles(src, "30d");
  check("keyword opportunities: the rule's rows counted", isOk(tiles.keywordOpportunities) && tiles.keywordOpportunities.value.value === 2, tiles.keywordOpportunities);
  check("keyword opportunities: the window before by the same rule", isOk(tiles.keywordOpportunities) && tiles.keywordOpportunities.value.previous === 2);
  const tilesNoBefore = await seo.assembleTiles({ ...src, previousQueries: null }, "30d");
  check("keyword opportunities: unmeasured window before is null", isOk(tilesNoBefore.keywordOpportunities) && tilesNoBefore.keywordOpportunities.value.previous === null);
  check("indexed: a check cut short says so and compares nothing", isOk(tiles.indexed) && tiles.indexed.value.value === 3 && tiles.indexed.value.previous === null && /4 of 5/.test(tiles.indexed.value.sub ?? ""), tiles.indexed);
  check("backlinks: Bing off stays off", tiles.backlinks.state === "off" && tiles.backlinks.reason === off.reason);

  const opps = seo.assembleOpportunities(src);
  check("opportunities: earlier position carried, new query has none", isOk(opps) && opps.value.rows[0]!.previousPosition === 12 && opps.value.rows[1]!.previousPosition === null, opps);
  check("opportunities: compared when the window before is covered and the list whole", isOk(opps) && opps.value.compared === true, opps);

  /* A young property (totals has no "before") or a list cut at the row limit: a missing earlier position is unknown, never "new". */
  const young: SearchSources = { ...src, totals: said({ ...(src.totals as Extract<SearchSources["totals"], { state: "ok" }>).value, clicks: { value: 12, previous: null, unit: "count", series: [5, 7] } }) };
  const youngOpps = seo.assembleOpportunities(young);
  check("opportunities: a window before Google's figures is not compared", isOk(youngOpps) && youngOpps.value.compared === false && youngOpps.value.rows.every((r) => r.previousPosition === null), youngOpps);
  const youngMoves = seo.assembleMovements(young);
  check("movements: none against a window before Google's figures, and why", youngMoves.state === "waiting" && /begin inside the period before/.test(youngMoves.reason), youngMoves);
  const cutList = seo.assembleOpportunities({ ...src, queries: said({ window: w, rows: queries, complete: false }) });
  check("opportunities: a list cut at the row limit is not compared", isOk(cutList) && cutList.value.compared === false);
  const youngOpen = seo.assembleOpen(young, "specimen query 02");
  check("an opened keyword on a young property is not compared", isOk(youngOpen) && youngOpen.value.compared === false && youngOpen.value.previous === null, youngOpen);
  const youngLanding = await seo.assembleLanding(young, "30d", []);
  check("landing on a young property is not compared", isOk(youngLanding) && youngLanding.value.source === "gsc" && youngLanding.value.compared === false && youngLanding.value.rows.every((r) => r.previousPosition === null), youngLanding);

  /* Apex and www addresses of one path (a Domain property after the move): two rows, two keys, told apart by host. */
  const twin = await seo.assembleLanding(
    {
      ...src,
      pages: said({
        window: w,
        complete: true,
        rows: [
          { page: "https://www.balkaris.ch/specimen/x/", path: "/specimen/x", ...fig(5, 200, 6), previous: null },
          { page: "https://balkaris.ch/specimen/x", path: "/specimen/x", ...fig(2, 90, 9), previous: null },
          { page: "https://www.balkaris.ch/specimen/y", path: "/specimen/y", ...fig(1, 50, 12), previous: null },
        ],
      }),
    },
    "30d",
    [],
  );
  check(
    "landing: two addresses with one path keep two keys and are told apart",
    isOk(twin) &&
      twin.value.source === "gsc" &&
      new Set(twin.value.rows.map((r) => r.page)).size === 3 &&
      twin.value.rows[0]!.label === "www.balkaris.ch/specimen/x/" &&
      twin.value.rows[1]!.label === "balkaris.ch/specimen/x" &&
      twin.value.rows[2]!.label === "/specimen/y",
    twin,
  );
  const twinMoves = seo.movementRows([
    { kind: "page", key: "https://www.balkaris.ch/specimen/x", path: "/specimen/x", previous: 9, current: 6, change: 3, impressions: 60, previousImpressions: 50, clicks: 1 },
    { kind: "page", key: "https://balkaris.ch/specimen/x", path: "/specimen/x", previous: 12, current: 10, change: 2, impressions: 40, previousImpressions: 40, clicks: 0 },
  ]);
  check("movements: two addresses with one path keep two keys", twinMoves[0]!.key !== twinMoves[1]!.key && twinMoves[0]!.label !== twinMoves[1]!.label, twinMoves);

  const gaps = seo.assembleGaps(src, [{ path: "/specimen/a", label: "Specimen service A", kind: "service" }, { path: "/specimen/b", label: "Specimen industry B", kind: "segment" }]);
  check("gaps: grouped by the page Google shows", isOk(gaps) && gaps.value.groups.length === 1 && gaps.value.groups[0]!.queries === 2 && gaps.value.groups[0]!.impressions === 210, gaps);
  check("gaps: the largest query named", isOk(gaps) && gaps.value.groups[0]!.top === "specimen query 02");
  check("gaps: what lands elsewhere is counted apart", isOk(gaps) && gaps.value.elsewhere.queries === 1 && gaps.value.elsewhere.impressions === 40);

  const moves = seo.assembleMovements(src);
  check("movements: a page is named by its path", isOk(moves) && moves.value.rows[1]!.label === "/specimen/b" && moves.value.total === 2, moves);

  /* One rule for every check line: opportunities never colour a line nor count as issues. */
  const opp = { severity: "opportunity" as const };
  const warn = { severity: "warning" as const };
  const crit = { severity: "critical" as const };
  check("lines: opportunities alone are neutral and named as such", JSON.stringify(seo.judged([opp, opp, opp, opp])) === JSON.stringify({ tone: "good", text: "4 opportunities" }));
  check("lines: the same for a line with a clean text of its own", JSON.stringify(seo.judged([opp], "Valid (11 types)")) === JSON.stringify({ tone: "good", text: "1 opportunity" }));
  check("lines: issues count without the opportunities beside them", JSON.stringify(seo.judged([warn, opp, opp])) === JSON.stringify({ tone: "warn", text: "1 issue" }));
  check("lines: a critical finding turns the line red", seo.judged([warn, crit]).tone === "bad");
  check("lines: nothing found says the clean text", seo.judged([], "Valid").text === "Valid");

  const consoleView = seo.assembleConsole(src);
  check("overview: days and totals as Google gave them", isOk(consoleView) && consoleView.value.days.length === 2 && consoleView.value.clicks.value === 12 && consoleView.value.href === null);

  const landing = await seo.assembleLanding(src, "30d", []);
  check("landing: Search Console's rows when it is connected", isOk(landing) && landing.value.source === "gsc" && landing.value.rows[0]!.previousPosition === 10, landing);

  const open = seo.assembleOpen(src, "Specimen Query 02");
  check("an opened keyword is found whatever its case, with its page", isOk(open) && open.value.path === "/specimen/a" && open.value.previous?.position === 12, open);
  const missing = seo.assembleOpen(src, "specimen query 99");
  check("an unknown keyword is absent with a reason, not zero", missing.state === "off" && /no query/.test(missing.reason));

  const cut = seo.assembleRanking({ ...src, buckets: off as unknown as SearchSources["buckets"] });
  check("an absent source stays absent through assembling, step and all", cut.state === "off" && cut.step === off.step);

  /* ---- 4. the crawl's history -------------------------------------------- */
  store.setState("site:crawl:finished", new Date().toISOString());
  store.record("seo.score", 90, store.today(-30));
  store.record("seo.score", 94, store.today(-3));
  store.record("seo.score", 96, store.today());
  const score = seo.crawlStat("seo.score", 30, "score", "note", 100);
  check("score: compared with the day before the period", isOk(score) && score.value.value === 96 && score.value.previous === 90 && score.value.of === 100, score);
  check("score: the line covers the period only", isOk(score) && score.value.series.join() === "94,96", score);
  const gap = seo.crawlStat("seo.score", 7, "score", "note", 100);
  check("score over 7 days: no reading within a week before the period, no comparison", isOk(gap) && gap.value.previous === null, gap);
  store.record("seo.score", 92, store.today(-9));
  const week = seo.crawlStat("seo.score", 7, "score", "note", 100);
  check("score over 7 days: the newest day on or before the period's start", isOk(week) && week.value.previous === 92, week);
  store.record("seo.issues.critical", 2, store.today());
  const critical = seo.crawlStat("seo.issues.critical", 30, "count", "note");
  check("critical: history that starts inside the period is not compared", isOk(critical) && critical.value.previous === null, critical);

  /* ---- 5. the specimen switch -------------------------------------------- */
  process.env.DESK_URL = "http://127.0.0.1:1";
  process.env.DESK_DEV_USER = "check@example.invalid";
  const spec = await get<SeoPayload>("/?specimen=1&range=90d");
  check("specimen on a workstation: says so", spec.body.specimen === true);
  check("specimen: Search Console panels are filled", isOk(spec.body.ranking) && isOk(spec.body.opportunities) && isOk(spec.body.gaps) && isOk(spec.body.movements) && isOk(spec.body.console));
  check("specimen: every row is named as a specimen", isOk(spec.body.opportunities) && spec.body.opportunities.value.rows.every((r) => r.query.startsWith("specimen query")));
  check("specimen: the stamp's note says specimen", isOk(spec.body.console) && /Specimen/.test(spec.body.console.note ?? ""));
  check("specimen: the range is followed (90 days)", isOk(spec.body.console) && spec.body.console.value.days.length === 90);
  check("specimen: Bing filled and labelled Bing", isOk(spec.body.tiles.backlinks) && spec.body.tiles.backlinks.source === "bing");
  check("without ?specimen=1 the same desk shows the real state", (await get<SeoPayload>("/")).body.specimen === false);
  process.env.NODE_ENV = "production";
  check("never in production", (await get<SeoPayload>("/?specimen=1")).body.specimen === false);
  process.env.NODE_ENV = "development";

  /* ---- 6. lists and report ----------------------------------------------- */
  const list = await get<SeoList>("/list/opportunities?specimen=1");
  check("the full opportunities list answers", list.status === 200 && list.body.name === "opportunities" && isOk(list.body.reading));
  check("an unknown list is a 404 with words", (await get<{ error: string }>("/list/nothing")).status === 404);
  const report = await get<SeoReport>("/report");
  check("the report answers", report.status === 200 && report.body.sections.length >= 10);
  check("the report's first ten sections follow the checks", report.body.sections.slice(0, 10).map((s) => s.key).join() === "indexed,sitemap,robots,canonical,titles,descriptions,schema,redirects,broken,internal");
  check("still no request left the machine", requests === 0, requests);
} finally {
  (await import("../src/db.ts")).db.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the file a moment longer; it is in the system's temp folder. */
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
