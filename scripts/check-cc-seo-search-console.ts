/**
 * SEO › Search Console, proved without Google or the website.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-search-console.ts
 *   npm run check:seo-search-console
 *
 * Nothing leaves this machine: a throwaway database, a stand-in for Search
 * Console, its URL Inspection and the website's sitemap on a free port of
 * 127.0.0.1, answering in the shapes Google documents, and a guard on `fetch`
 * that refuses every other host. Every query, page and figure in here is a
 * SPECIMEN ("specimen query gamma", /specimen-b); none of it describes the
 * real website.
 *
 * The real route (src/cc/routes/seo/search-console.ts) is mounted and asked
 * over HTTP, as the screen asks it. What is proved:
 *   1. the pure parts: the search box's words (-word, "exact"), a page and a
 *      part of an address, an offset past the end, Search Console's filters,
 *      and the interface's address writer in step with the server;
 *   2. the explorer from the desk's copy: totals equal the stand-in's, a window
 *      by dates that runs past the newest counted day is cut there (not read
 *      as zeros) and compared with a window as long, one with no counted day
 *      says so, query words never compare with a window Google reported none
 *      of them in, a day has no "before", an offset past the end answers the
 *      last page, -word and "exact" narrow as said;
 *   3. read live: the four figures and the chart stand on the same days, a
 *      part of an address is asked of the path only, and pages Google shows
 *      that the website no longer has are marked, counted before the filter
 *      and listed alone when asked, every page of the list and not one screen;
 *   4. URL inspection: a check Google cut short does not shrink the list to
 *      the part it reached (each address keeps its newest result, with its
 *      day), the search, a state, the three orders and an offset past the end
 *      work, a person's "requested" mark stays on screen when the engine
 *      cleared the row, an address asked by hand is not counted as the
 *      sitemap's;
 *   5. the daily check: a run Google cut short is asked again an hour later
 *      (at most three times a day), the second run asks first for what the
 *      first did not reach, a success owes nothing, and a sitemap that cannot
 *      be read is stood in for by the last check's addresses;
 *   6. the export: every row as listed, what the website has at each page, the
 *      filters in the file's name, and a cell that starts like a formula
 *      defused; the screen's payload says which sitemap file the desk's count
 *      is of.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-gsc-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "SITE_READ_REPO", "SITE_REPO", "DESK_DEV_USER"]) delete process.env[k];
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "absent.json");
process.env.SITE_READ_CLONE = "off";

let passed = 0;
let failed = 0;
function check(name: string, good: boolean, detail?: unknown): void {
  if (good) passed++;
  else failed++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${!good && detail !== undefined ? `\n     ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
}
const section = (title: string) => console.log(`\n${title}`);

/* ---- the stand-in: Search Console, URL Inspection, the website's sitemap ----------------------- */

const SITE = "https://www.balkaris.ch";
const pacificToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const dayAt = (offset: number): string => new Date(Date.parse(`${pacificToday}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const NEWEST = dayAt(-4);

type Fixture = { day: string; query: string; page: string; device: string; country: string; clicks: number; impressions: number; position: number };
const fixture: Fixture[] = [];
for (let o = -40; o <= -4; o++) {
  const day = dayAt(o);
  fixture.push({ day, query: "specimen query gamma", page: `${SITE}/specimen-b`, device: "MOBILE", country: "che", clicks: o % 3 === 0 ? 1 : 0, impressions: 4, position: 6 });
  fixture.push({ day, query: "specimen query delta", page: `${SITE}/specimen-old`, device: "DESKTOP", country: "deu", clicks: 0, impressions: 3, position: 9 });
  if (o >= -30) fixture.push({ day, query: "specimen query gone", page: `${SITE}/specimen-gone`, device: "MOBILE", country: "deu", clicks: 0, impressions: 2, position: 12 });
  if (o >= -14) fixture.push({ day, query: "balkaris specimen brand", page: `${SITE}/specimen-a`, device: "DESKTOP", country: "che", clicks: 1, impressions: 5, position: 1.5 });
  if (o >= -15) fixture.push({ day, query: "specimen insight", page: `${SITE}/insights/specimen-post`, device: "DESKTOP", country: "che", clicks: 0, impressions: 2, position: 4 });
  if (o >= -10) fixture.push({ day, query: "specimen rare", page: `${SITE}/specimen-ghost`, device: "DESKTOP", country: "usa", clicks: 0, impressions: 1, position: 30 });
}

type Filter = { dimension: string; operator?: string; expression: string };
const fieldOf = (r: Fixture, d: string): string => (d === "date" ? r.day : String((r as unknown as Record<string, unknown>)[d]));
function passes(r: Fixture, f: Filter): boolean {
  const v = fieldOf(r, f.dimension);
  const e = f.expression;
  switch (f.operator ?? "equals") {
    case "equals":
      return f.dimension === "query" ? v === e : v.toLowerCase() === e.toLowerCase();
    case "notEquals":
      return v !== e;
    case "contains":
      return v.toLowerCase().includes(e.toLowerCase());
    case "notContains":
      return !v.toLowerCase().includes(e.toLowerCase());
    case "includingRegex":
    case "excludingRegex": {
      /* RE2 writes case-insensitivity as (?i); JavaScript as a flag. */
      const i = e.startsWith("(?i)");
      const hit = new RegExp(i ? e.slice(4) : e, i ? "i" : "").test(v);
      return f.operator === "includingRegex" ? hit : !hit;
    }
    default:
      return false;
  }
}

type Body = { startDate: string; endDate: string; dimensions?: string[]; rowLimit?: number; startRow?: number; dimensionFilterGroups?: { filters: Filter[] }[] };
const gscAsked: Body[] = [];
function answer(body: Body) {
  const filters = body.dimensionFilterGroups?.[0]?.filters ?? [];
  const dims = body.dimensions ?? [];
  const by = new Map<string, { keys: string[]; clicks: number; impressions: number; w: number }>();
  for (const r of fixture) {
    if (r.day < body.startDate || r.day > body.endDate) continue;
    if (!filters.every((f) => passes(r, f))) continue;
    const keys = dims.map((d) => fieldOf(r, d));
    const k = keys.join("\u0000");
    const g = by.get(k) ?? { keys, clicks: 0, impressions: 0, w: 0 };
    g.clicks += r.clicks;
    g.impressions += r.impressions;
    g.w += r.position * r.impressions;
    by.set(k, g);
  }
  const all = [...by.values()].map((g) => ({ keys: g.keys, clicks: g.clicks, impressions: g.impressions, ctr: g.impressions ? g.clicks / g.impressions : 0, position: g.impressions ? g.w / g.impressions : 0 }));
  const from = body.startRow ?? 0;
  return { rows: all.slice(from, from + (body.rowLimit ?? 1000)) };
}

/* The sitemap the daily index check reads, and Google's answer for each address. */
const LISTED = ["/", "/specimen-a", "/specimen-b", "/specimen-c", "/specimen-d", "/specimen-e", "/insights/specimen-post", "/specimen-f"].map((p) => `${SITE}${p === "/" ? "" : p}`);
const fake = { inspectFailAfter: null as number | null, inspectSeen: 0, sitemapDown: false, inspected: [] as string[] };
const INDEXED = new Set([`${SITE}`, `${SITE}/specimen-a`, `${SITE}/specimen-b`, `${SITE}/insights/specimen-post`]);
const inspection = (url: string) => ({
  inspectionResult: {
    inspectionResultLink: `https://search.google.com/search-console/inspect?resource_id=sc-domain:balkaris.ch&id=${encodeURIComponent(url)}`,
    indexStatusResult: INDEXED.has(url)
      ? { verdict: "PASS", coverageState: "Submitted and indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", pageFetchState: "SUCCESSFUL", lastCrawlTime: `${dayAt(-6)}T10:00:00Z`, googleCanonical: url, userCanonical: url }
      : { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", pageFetchState: "PAGE_FETCH_STATE_UNSPECIFIED" },
  },
});

let HERE = "";
const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const send = (status: number, value: unknown, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(typeof value === "string" ? value : JSON.stringify(value));
  };
  const url = new URL(req.url ?? "/", HERE);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  if (url.pathname === "/sitemap.xml") {
    if (fake.sitemapDown) return send(402, "<html>payment required</html>", "text/html");
    return send(200, `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${LISTED.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`, "application/xml");
  }
  if (req.headers.authorization !== "Bearer check-token") return send(401, { error: { code: 401, message: "specimen", status: "UNAUTHENTICATED" } });
  if (url.pathname === "/gsc/sites") return send(200, { siteEntry: [{ siteUrl: "sc-domain:balkaris.ch", permissionLevel: "siteFullUser" }] });
  if (url.pathname.endsWith("/sitemaps"))
    return send(200, {
      sitemap: [
        { path: `${SITE}/sitemap.xml`, lastSubmitted: `${dayAt(-3)}T08:00:00Z`, lastDownloaded: `${dayAt(-3)}T08:01:00Z`, isPending: false, isSitemapsIndex: false, type: "sitemap", warnings: "0", errors: "1", contents: [{ type: "web", submitted: String(LISTED.length) }] },
        { path: `${SITE}/insights/feed.xml`, lastSubmitted: `${dayAt(-3)}T08:00:00Z`, lastDownloaded: `${dayAt(-3)}T08:01:00Z`, isPending: false, isSitemapsIndex: false, type: "atomFeed", warnings: "0", errors: "0", contents: [{ type: "web", submitted: "2" }] },
      ],
    });
  if (url.pathname.endsWith("/searchAnalytics/query") && req.method === "POST") {
    gscAsked.push(body as Body);
    return send(200, answer(body as Body));
  }
  if (url.pathname.endsWith("/urlInspection/index:inspect") && req.method === "POST") {
    const asked = String((body as { inspectionUrl?: string }).inspectionUrl);
    fake.inspected.push(asked);
    if (fake.inspectFailAfter !== null && ++fake.inspectSeen > fake.inspectFailAfter) return send(500, { error: { code: 500, message: "specimen backend error", status: "INTERNAL" } });
    return send(200, inspection(asked));
  }
  send(404, { error: { code: 404, message: "Not found (stand-in)" } });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
HERE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

/* ---- nothing leaves this machine ------------------------------------------ */
const realFetch = globalThis.fetch;
const refused: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(`${HERE}/`)) {
    refused.push(url.split("?")[0]!);
    throw new Error(`the check tried to leave the machine: ${url.split("?")[0]}`);
  }
  return realFetch(input as never, init);
}) as typeof fetch;

/* ---- the modules ------------------------------------------------------------ */

const { db } = await import("../src/db.ts");
const store = await import("../src/cc/store.ts");
const gsc = await import("../src/cc/search/gsc.ts");
const shared = await import("../src/cc/search/shared.ts");
const rank = await import("../src/cc/seo/rank.ts");
await import("../src/cc/seo/tables.ts");
await import("../src/cc/site/crawl.ts");
const sc = await import("../src/cc/routes/seo/search-console.ts");
const href = await import("../web/src/components/seo/search-console/href.ts");
const { Hono } = await import("hono");
import type { Vars } from "../src/cc/access.ts";
import type { ExplorerQuery, SeoSearchConsolePayload } from "../web/src/contract/seo/search-console.ts";

const app = new Hono<Vars>();
app.route("/api/v1/seo/search-console", sc.routes);
async function ask(q = ""): Promise<SeoSearchConsolePayload> {
  const res = await app.request(`/api/v1/seo/search-console${q ? `?${q}` : ""}`);
  if (res.status !== 200) throw new Error(`the route answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as SeoSearchConsolePayload;
}
const ok = <T>(r: { state: string; value?: T; reason?: string }): T => {
  if (r.state !== "ok") throw new Error(`not ok: ${r.state} ${r.reason ?? ""}`);
  return r.value as T;
};
const sum = (pick: (r: Fixture) => boolean, start: string, end: string) => {
  const rows = fixture.filter((r) => r.day >= start && r.day <= end && pick(r));
  return { clicks: rows.reduce((n, r) => n + r.clicks, 0), impressions: rows.reduce((n, r) => n + r.impressions, 0) };
};

try {
  /* ============ 1. the pure parts ============================================== */
  section("1. the pure parts");
  {
    const t = sc.parts.termsOf("Kosten -Balkaris  website");
    check("plain words must be in the query, a word with a minus must not", t.words.join(",") === "kosten,website" && t.not.join(",") === "balkaris" && t.exact === null, t);
    const e = sc.parts.termsOf('"Website Kosten"');
    check("the whole box in double quotes is that exact query", e.exact === "website kosten" && !e.words.length && !e.not.length, e);
    check("a lone minus is not a word to leave out", sc.parts.termsOf("seo -").not.length === 0);
    check("a page is its path, however it is written", sc.parts.pathParam("work") === "/work" && sc.parts.pathParam(`${SITE}/work/?x=1`) === "/work" && sc.parts.pathParam("/") === "/");
    check("a part of an address is lower case, a full address its path", sc.parts.partParam(" /Insights/ ") === "/insights/" && sc.parts.partParam(`${SITE}/insights/a?b`) === "/insights/a" && sc.parts.partParam("") === null);
    check("an offset past the end is the last page", sc.parts.within(50, 26, 25) === 25 && sc.parts.within(25, 25, 25) === 0 && sc.parts.within(10, 0, 25) === 0 && sc.parts.within(5, 26, 25) === 5);
    const base: ExplorerQuery = { dimension: "query", start: "", end: "", window: null, country: "all", device: "all", q: "", page: null, part: null, offsite: false, sort: "clicks", dir: "desc", offset: 0, limit: 25, source: "live" };
    const f = sc.parts.liveFilters({ ...base, q: "seo -balkaris", part: "/insights/" });
    const part = f.find((x) => x.dimension === "page");
    check("Search Console is asked: contains, notContains, and a part of the path only", f.some((x) => x.operator === "contains" && x.expression === "seo") && f.some((x) => x.operator === "notContains" && x.expression === "balkaris") && part?.operator === "includingRegex" && part.expression.startsWith("(?i)"), f);
    const rx = new RegExp(part!.expression.slice(4), "i");
    check("  that part is matched on the path, not on the host", rx.test(`${SITE}/insights/a`) && !new RegExp(sc.parts.liveFilters({ ...base, part: "balkaris" }).find((x) => x.dimension === "page")!.expression.slice(4), "i").test(`${SITE}/insights/a`));
    check("the exact query is Search Console's equals", sc.parts.liveFilters({ ...base, q: '"seo agentur"' }).some((x) => x.operator === "equals" && x.expression === "seo agentur"));
    check("a part of an address is read from the rows that carry pages", sc.parts.tableOf("day", { country: "all", device: "all", terms: sc.parts.termsOf(""), page: null, part: "/x" }) === "cc_seo_rank_pages");
    for (const d of ["query", "page", "date"] as const)
      for (const s of ["clicks", "position", "key"] as const) if (sc.parts.firstDir(s, d) !== href.firstDir(s, d)) check(`the screen's first direction for ${s} by ${d} is the server's`, false);
    check("the screen's first directions are the server's, every dimension and sort", true);
  }

  /* ============ 2. the explorer from the desk's copy ============================== */
  section("2. the explorer from the desk's copy");
  writeFileSync(path.join(dir, "key.json"), JSON.stringify({ client_email: "desk-check@specimen-project.iam.gserviceaccount.com", private_key: "not a key: the check never signs with it" }));
  process.env.GA4_CREDENTIALS_FILE = path.join(dir, "key.json");
  gsc.wire.bearer = async () => "check-token";
  process.env.GSC_API_BASE = `${HERE}/gsc`;
  process.env.GSC_INSPECT_BASE = `${HERE}/inspect`;
  process.env.CC_SITEMAP_URL = `${HERE}/sitemap.xml`;
  {
    const a = await gsc.checkAccess();
    check("the stand-in property is readable", a.state === "ok" && a.site === "sc-domain:balkaris.ch", a);
    const line = await rank.runSnapshot();
    check("the desk's copy is back-filled to the newest finished day", /^Back-filled/.test(line) && rank.lastSnapDay() === NEWEST, line);

    const d = await ask();
    const r = ok(d.result);
    const want = sum(() => true, r.start, r.end);
    check("the default view is the desk's copy, 30 days to the newest counted day", r.source === "snapshots" && r.end === NEWEST && shared.eachDay(r.start, r.end).length === 30, { start: r.start, end: r.end });
    check("  its totals are the stand-in's", r.totals.clicks === want.clicks && r.totals.impressions === want.impressions, { got: r.totals, want });
    check("  and the chart's days add up to them", r.days.reduce((n, x) => n + x.impressions, 0) === r.totals.impressions && r.days.length === 30);

    /* Bug: a window by dates past the last counted day was read with zeros for the missing days. */
    const start = dayAt(-8);
    const cut = await ask(`start=${start}&end=${dayAt(0)}`);
    const c = ok(cut.result);
    check("a window by dates that runs past the newest counted day ends there", c.start === start && c.end === NEWEST && c.askedEnd === dayAt(0), { start: c.start, end: c.end, askedEnd: c.askedEnd });
    check("  the window before is as long as what is left", c.previous?.end === shared.addDays(start, -1) && c.previous?.start === shared.addDays(start, -5), c.previous);
    check("  its totals are the counted days only", c.totals.impressions === sum(() => true, start, NEWEST).impressions && c.days.length === 5);
    check("  the note says the window was cut", /are left out rather than counted as zeros/.test(c.note), c.note);
    check("  the answer keeps the dates as asked, for the screen's links", cut.asked.window?.end === dayAt(0) && cut.asked.end === NEWEST);
    const none = await ask(`start=${dayAt(-2)}&end=${dayAt(0)}`);
    check("a window with no counted day says so, with the newest finished day", none.result.state === "waiting" && new RegExp(NEWEST).test(none.result.state === "waiting" ? none.result.reason : ""), none.result);
    const bad = await ask(`start=${dayAt(-2)}&end=${dayAt(-9)}`);
    check("dates that are not a window are the period's window, and say nothing was taken", bad.asked.window === null && ok(bad.result).end === NEWEST);

    /* Bug: with query words the tiles compared against a zero the table refused to compare. */
    const brand = ok((await ask(`start=${dayAt(-14)}&end=${NEWEST}&q=balkaris`)).result);
    check("query words Google reported none of in the window before: nothing compared, and said why", brand.previousTotals === null && brand.previous === null && /reported none of these queries/.test(brand.note), { prev: brand.previousTotals, note: brand.note });
    const gamma = ok((await ask(`start=${dayAt(-14)}&end=${NEWEST}&q=gamma`)).result);
    check("  words it did report before are compared", gamma.previousTotals !== null && gamma.previousTotals.impressions === sum((x) => x.query.includes("gamma"), shared.addDays(dayAt(-14), -11), shared.addDays(dayAt(-14), -1)).impressions, gamma.previousTotals);

    const without = ok((await ask("q=-balkaris")).result);
    check("-balkaris leaves the brand out", without.rows.every((x) => !x.key.includes("balkaris")) && without.rows.length > 0);
    const exact = ok((await ask(`q=${encodeURIComponent('"specimen query"')}`)).result);
    check('"specimen query" is that exact query only, not every query containing it', exact.total === 0);
    const exact2 = ok((await ask(`q=${encodeURIComponent('"specimen query gamma"')}`)).result);
    check("  and finds the one that is", exact2.total === 1 && exact2.rows[0]!.key === "specimen query gamma");

    /* Bug: a day row had a "vs before" column that could never hold a figure. */
    const dates = ok((await ask("dimension=date")).result);
    check("a day has no window before: every Dates row's before is null", dates.rows.length > 0 && dates.rows.every((x) => x.previous === null));

    /* Bug: an offset past the end printed an empty table under a pager that said otherwise. */
    const past = await ask("dimension=date&offset=100");
    const p = ok(past.result);
    check("an offset past the end answers the last page, and says which", p.offset === 25 && past.asked.offset === 25 && p.rows.length === 5 && p.total === 30, { offset: p.offset, rows: p.rows.length, total: p.total });

    const che = ok((await ask("country=che")).result);
    check("Switzerland from the desk's copy", che.source === "snapshots" && che.totals.impressions === sum((x) => x.country === "che", che.start, che.end).impressions);
  }

  /* ============ 3. read live ======================================================= */
  section("3. read live, and pages the website no longer has");
  {
    /* Bug: in a live answer the tiles summed every day Google returned and the chart drew only the copy's days. */
    const start = dayAt(-8);
    const live = ok((await ask(`dimension=date&source=live&start=${start}&end=${dayAt(0)}`)).result);
    check("live by dates: the window ends on the newest day Google has finished", live.source === "live" && live.end === NEWEST && live.askedEnd === dayAt(0), { end: live.end, askedEnd: live.askedEnd });
    check("  the four figures and the chart stand on the same days", live.days.length === shared.eachDay(start, NEWEST).length && live.days.reduce((n, x) => n + x.impressions, 0) === live.totals.impressions && live.rows.length === live.days.length, {
      days: live.days.length,
      rows: live.rows.length,
      chart: live.days.reduce((n, x) => n + x.impressions, 0),
      tiles: live.totals.impressions,
    });

    const before = gscAsked.length;
    const part = await ask("pagepart=/insights/");
    const pr = ok(part.result);
    const asked = gscAsked.slice(before);
    check("a part of an address is read live and narrows to those pages", pr.source === "live" && pr.totals.impressions === sum((x) => x.page.includes("/insights/"), pr.start, pr.end).impressions && part.asked.part === "/insights/", pr.totals);
    check("  Search Console was asked by the path", asked.some((b) => b.dimensionFilterGroups?.[0]?.filters.some((f) => f.dimension === "page" && f.operator === "includingRegex" && f.expression.includes("insights"))));

    /* The crawl, as the desk last read the website: a page, one that redirects, one gone. */
    const fetched = (lands: string, hops: number) => JSON.stringify({ hops: Array.from({ length: hops }, () => ({ url: "x", status: 308, location: lands })), lands, landed: 200, ttfb: 1, total: 1, bytes: 1, cacheControl: null, vercelCache: null });
    const putPage = db.prepare("INSERT INTO cc_pages (path, kind, status, in_sitemap, listed_by, fetched, first_seen, last_seen) VALUES (?, 'page', ?, ?, 'sitemap', ?, ?, ?)");
    const at = new Date().toISOString();
    putPage.run("/specimen-a", 200, 1, fetched("/specimen-a", 0), at, at);
    putPage.run("/specimen-b", 200, 0, fetched("/specimen-b", 0), at, at);
    putPage.run("/insights/specimen-post", 200, 1, fetched("/insights/specimen-post", 0), at, at);
    putPage.run("/specimen-old", 308, 0, fetched("/specimen-a", 1), at, at);
    putPage.run("/specimen-gone", 404, 0, fetched("/specimen-gone", 0), at, at);
    store.setState("site:crawl:finished", at);

    const pages = await ask("dimension=page&limit=2");
    const pg = ok(pages.result);
    const all = ok((await ask("dimension=page")).result);
    const state = (p: string) => all.rows.find((x) => x.key === p)?.site?.state;
    check("each page Google shows is set against the website", state("/specimen-a") === "listed" && state("/specimen-b") === "not-listed" && state("/specimen-old") === "redirects" && state("/specimen-gone") === "gone" && state("/specimen-ghost") === "unknown", all.rows.map((x) => [x.key, x.site?.state]));
    check("  a redirect says where it leads", all.rows.find((x) => x.key === "/specimen-old")?.site?.to === "/specimen-a");
    check("  the addresses the site no longer has are counted over the whole list, not one screen", pg.offsite === 3 && pg.rows.length === 2 && pg.total === all.total, { offsite: pg.offsite, rows: pg.rows.length });
    const off = await ask("dimension=page&offsite=1&limit=2");
    const o = ok(off.result);
    check("Not on the site lists only those, paged over all of them", off.asked.offsite && o.total === 3 && o.rows.length === 2 && o.rows.every((x) => ["redirects", "gone", "unknown"].includes(x.site?.state ?? "")), o.rows.map((x) => x.key));
    check("  and the figures above stay every page's", o.totals.impressions === pg.totals.impressions && /The figures above are every page's/.test(o.note));
    const offQuery = await ask("dimension=query&offsite=1");
    check("  with any other dimension it is not applied", offQuery.asked.offsite === false);
  }

  /* ============ 4. URL inspection ================================================== */
  section("4. URL inspection");
  {
    const today = store.today();
    const yesterday = shared.addDays(today, -1);
    const put = db.prepare(
      "INSERT OR REPLACE INTO cc_inspect (day, url, verdict, coverage, last_crawl, google_canonical, user_canonical, robots_state, fetch_state, indexing_state, is_indexed, canonical_ok, link, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const row = (day: string, url: string, indexed: boolean, crawl: string | null = null) =>
      put.run(day, url, indexed ? "PASS" : "NEUTRAL", indexed ? "Submitted and indexed" : url.endsWith("-c") ? "Crawled - currently not indexed" : "Discovered - currently not indexed", crawl, indexed ? url : null, url, "ALLOWED", indexed ? "SUCCESSFUL" : null, null, indexed ? 1 : 0, indexed ? 1 : null, `https://search.google.com/inspect?id=${encodeURIComponent(url)}`, `${day}T18:00:00Z`);
    /* Yesterday a whole check; today Google answered 500 after three addresses. */
    for (const u of LISTED) row(yesterday, u, INDEXED.has(u), INDEXED.has(u) ? `${shared.addDays(today, -6)}T10:00:00Z` : null);
    store.record("gsc.sitemap_addresses", LISTED.length, yesterday);
    for (const u of LISTED.slice(0, 3)) row(today, u, INDEXED.has(u), `${shared.addDays(today, -2)}T10:00:00Z`);
    store.record("gsc.sitemap_addresses", LISTED.length, today);
    /* A person marked two addresses "requested"; the engine has since cleared one of them. */
    const putOpp = db.prepare(
      "INSERT INTO cc_seo_opps (id, type, page, title, evidence, priority, priority_why, action, state, state_by, state_at, active, first_seen, last_seen) VALUES (?, 'not-indexed', ?, 't', 'e', 'high', 'w', 'a', ?, ?, ?, ?, ?, ?)",
    );
    putOpp.run("not-indexed:/specimen-c", "/specimen-c", "in-progress", "Specimen Person", `${yesterday}T20:00:00Z`, 1, yesterday, yesterday);
    putOpp.run("not-indexed:/specimen-d", "/specimen-d", "in-progress", "Specimen Person", `${yesterday}T20:00:00Z`, 0, yesterday, yesterday);
    putOpp.run("not-indexed:/specimen-e", "/specimen-e", "open", null, null, 1, yesterday, yesterday);

    const d = await ask();
    const v = ok(d.inspection);
    check("a check cut short does not shrink the list to the part it reached", v.inspected === LISTED.length && v.checked === 3 && v.dayComplete === false && v.complete === true, { inspected: v.inspected, checked: v.checked, complete: v.complete });
    check("  the addresses it did not reach keep yesterday's result, and say so", v.carried === LISTED.length - 3 && v.carriedFrom === yesterday && /cut short/.test(d.inspection.state === "ok" ? (d.inspection.note ?? "") : ""), { carried: v.carried, from: v.carriedFrom });
    check("  the counts are over every address", v.indexed === INDEXED.size && v.notIndexed === LISTED.length - INDEXED.size, { indexed: v.indexed, not: v.notIndexed });
    const all = ok((await ask("ixo=0&ix=all")).inspection);
    check("  the first page lists what to request first: not indexed, waiting before requested", !all.rows[0]!.indexed && all.rows[0]!.queue?.state === "open", all.rows.slice(0, 3).map((x) => [x.path, x.queue?.state]));
    const rows = ok((await ask("ix=not-indexed")).inspection).rows;
    check("  each row carries its own day", rows.some((x) => x.day === yesterday) && rows.every((x) => x.day === yesterday || x.day === today));
    check("a person's 'requested' mark stays on screen when the engine cleared the row", rows.find((x) => x.path === "/specimen-d")?.queue?.state === "requested" && rows.find((x) => x.path === "/specimen-d")?.queue?.by === "Specimen Person");

    const q = await ask("ixq=SPECIMEN-C");
    check("the table searches by address", ok(q.inspection).total === 1 && ok(q.inspection).rows[0]!.path === "/specimen-c" && q.inspectionAsked.q === "specimen-c");
    const s = await ask(`ixs=${encodeURIComponent("crawled - currently NOT indexed")}`);
    check("a state of Google's lists only those, whatever the case", ok(s.inspection).total === 1 && ok(s.inspection).rows[0]!.coverage === "Crawled - currently not indexed");
    const byAddress = ok((await ask("ixsort=address")).inspection).rows.map((x) => x.path);
    check("ordered by address", byAddress.join() === [...byAddress].sort().join() && byAddress[0] === "/");
    const byCrawl = ok((await ask("ixsort=crawl")).inspection).rows;
    check("ordered by last crawl, never crawled last", byCrawl[0]!.lastCrawl !== null && byCrawl.at(-1)!.lastCrawl === null && byCrawl[0]!.lastCrawl! >= byCrawl[1]!.lastCrawl!);
    const past = await ask("ix=not-indexed&ixo=60");
    check("an offset past the end of the table is its last page", past.inspectionAsked.offset === 0 && ok(past.inspection).rows.length === LISTED.length - INDEXED.size, past.inspectionAsked);

    /* An address a person asked about by hand that day, which the sitemap does not list. The check kept no list of
       its own then (results from before it did), so the desk's own read of the sitemap says which are the sitemap's. */
    row(today, `${SITE}/specimen-by-hand`, false);
    store.keep("site:sitemap", { at: new Date().toISOString(), status: 200, entries: LISTED.map((u) => ({ loc: u, path: new URL(u).pathname.replace(/\/$/, "") || "/", lastmod: null })), robots: { status: 200, sitemaps: [], rules: 0 }, issues: [] });
    const hand = ok((await ask("ixq=by-hand")).inspection);
    check("an address asked by hand is shown, marked as not the sitemap's", hand.rows[0]?.listed === false, hand.rows[0]);
    const whole = await ask();
    const w = ok(whole.inspection);
    check("  and it does not make the cut-short day look whole", w.checked === 3 && w.dayComplete === false && w.complete === true && w.of === LISTED.length, { checked: w.checked, dayComplete: w.dayComplete });
    check("the desk's own read of the sitemap is in the payload beside Google's", whole.ownSitemap?.addresses === LISTED.length && whole.ownSitemap.status === 200);
    db.prepare("DELETE FROM cc_inspect WHERE url = ?").run(`${SITE}/specimen-by-hand`);

    check("the payload says which sitemap file the desk's count is of", d.listed?.file === "/sitemap.xml" && d.listed.addresses === LISTED.length, d.listed);
    check("Google's sitemaps are read, the feed among them", d.sitemaps.state === "ok" && d.sitemaps.value.length === 2);
  }

  /* ============ 5. the daily check ================================================= */
  section("5. the daily check: retried when cut short, finishing what it missed");
  {
    const today = store.today();
    db.prepare("DELETE FROM cc_inspect WHERE day = ?").run(today);
    const planned: number[] = [];
    const waits: (() => void)[] = [];
    let asked = 0;
    gsc.inspectRetry.later = (ms, run) => {
      planned.push(ms);
      waits.push(run);
    };
    gsc.inspectRetry.ask = () => {
      asked++;
      return true;
    };
    fake.inspectFailAfter = 2;
    fake.inspectSeen = 0;
    fake.inspected = [];
    let said = "";
    try {
      await gsc.inspectJob();
    } catch (e) {
      said = e instanceof Error ? e.message : String(e);
    }
    check("a run Google cuts short fails, and says it tries again in an hour", /Trying again in an hour \(1 of 3\)/.test(said) && planned.length === 1 && planned[0] === 3_600_000, said);
    check("  the screen can say when", gsc.inspectRetryAt() !== null);
    check("  nothing is asked before the hour is over", asked === 0);
    waits[0]!();
    check("  when it is, the scheduler is asked to run the check", asked === 1);
    const reached = new Set((db.prepare("SELECT url FROM cc_inspect WHERE day = ?").all(today) as { url: string }[]).map((r) => r.url));
    fake.inspectFailAfter = null;
    fake.inspected = [];
    const line = await gsc.inspectJob();
    const missing = LISTED.length - reached.size;
    check("the second run asks first for what the first did not reach", reached.size > 0 && missing > 0 && fake.inspected.slice(0, missing).every((u) => !reached.has(u)), { reached: [...reached], asked: fake.inspected });
    check("  and finishes the day", new RegExp(`^${LISTED.length} of ${LISTED.length} addresses inspected`).test(line), line);
    check("  a success owes no retry", gsc.inspectRetryAt() === null);
    waits[0]!();
    check("  a wait that ends after a run that worked asks for nothing", asked === 1);

    /* Three failures in a day are tried again; a fourth is left for the next day. */
    fake.inspectFailAfter = 0;
    planned.length = 0;
    for (let i = 0; i < 4; i++) {
      fake.inspectSeen = 0;
      await gsc.inspectJob().catch(() => undefined);
    }
    check("at most three retries a day", planned.length === 3, planned.length);
    fake.inspectFailAfter = null;
    shared.setCount("gsc.inspect.fails", today, 0);

    /* The website not answering (402 on 3 October 2026) does not stop Google being asked about it. */
    fake.sitemapDown = true;
    const stood = await gsc.inspectAll(today);
    check("a sitemap that cannot be read: the last check's addresses are asked, and the line says so", /could not be read/.test(stood) && /402/.test(stood), stood);
    fake.sitemapDown = false;
  }

  /* ============ 6. the export ======================================================= */
  section("6. the export");
  {
    const res = await app.request("/api/v1/seo/search-console/export.csv?dimension=page&offsite=1");
    const text = await res.text();
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    check("the CSV is every row as listed: only the pages the site no longer has", res.status === 200 && lines.length === 1 + 3, lines);
    check("  with what the website has at each", /On the website/.test(lines[0]!) && lines.some((l) => /Redirects/.test(l)) && lines.some((l) => /Gone \(404\)/.test(l)));
    check("  and the filter in the file's name", /off-site\.csv"$/.test(res.headers.get("content-disposition") ?? ""), res.headers.get("content-disposition"));
    const q = await app.request(`/api/v1/seo/search-console/export.csv?q=-balkaris&pagepart=/specimen`);
    const qt = await q.text();
    check("a filtered export says so in its name", q.status === 200 && /-filtered-section\.csv"$/.test(q.headers.get("content-disposition") ?? ""), q.headers.get("content-disposition"));
    check("  and no row of it starts like a formula", !qt.split("\r\n").some((l) => /^[=+\-@]/.test(l)));
    const none = await app.request(`/api/v1/seo/search-console/export.csv?start=${dayAt(-2)}&end=${dayAt(0)}`);
    check("nothing to export is a sentence, not an empty file", none.status === 409 && /nothing to export/i.test(((await none.json()) as { error: string }).error));
  }

  /* ============ 7. the screen's address writer ====================================== */
  section("7. the screen's address writer");
  {
    const d = await ask(`start=${dayAt(-8)}&end=${dayAt(0)}&dimension=page&offsite=1&ixq=spec&offset=0`);
    const place = { asked: d.asked, range: "30d", chart: "volume" as const, ix: d.inspectionAsked, dates: d.asked.window, live: false };
    const to = new URL(href.scHref(place, { dimension: "query" }), "http://x");
    check("another dimension leaves 'Not on the site' behind and keeps the dates", !to.searchParams.has("offsite") && to.searchParams.get("start") === dayAt(-8) && to.searchParams.get("end") === dayAt(0));
    check("back to the period drops the dates", !new URL(href.scHref(place, { dates: null }), "http://x").searchParams.has("start"));
    const ixs = new URL(href.scHref({ ...place, ix: { ...place.ix, offset: 15 } }, { ixs: "Crawled - currently not indexed" }), "http://x");
    check("a state of Google's starts the table again from its first page", ixs.searchParams.get("ixs") === "Crawled - currently not indexed" && !ixs.searchParams.has("ixo"));
    const kept = href.keptFields(place, ["q"]);
    check("the search box keeps every other choice", kept.some(([k]) => k === "dimension") && kept.some(([k]) => k === "offsite") && kept.some(([k]) => k === "ixq") && !kept.some(([k]) => k === "q"));
    const back = await ask(new URL(href.scHref(place), "http://x").search.slice(1));
    check("an address the writer makes is answered as the same view", back.asked.dimension === "page" && back.asked.offsite && back.asked.window?.start === dayAt(-8) && back.inspectionAsked.q === "spec");
    check("the exact query is written as the server reads it", sc.parts.termsOf(href.exactly('say "hi" there')).exact === "say hi there");
  }

  check("nothing left this machine", refused.length === 0, refused);
} catch (e) {
  check("the check ran to the end", false, e instanceof Error ? (e.stack ?? e.message) : String(e));
} finally {
  server.close();
  try {
    db.close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
