/**
 * SEO › Pages (src/cc/routes/seo/pages.ts), proved without Google, GA4 or the website.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-pages.ts
 *   npm run check:seo-pages
 *
 * Nothing leaves this machine: a throwaway database, a specimen website read
 * by the desk's real crawl through a stubbed `fetch`, specimen days of Search
 * Console history and of the daily URL Inspection written into the tables the
 * desk keeps them in, and the route's one outbound request (the live lookup
 * of an address) answered by a fake wire. After the crawl, `fetch` refuses
 * every host. Every page, phrase and figure here is a SPECIMEN, made up and
 * named so (/specimen-lonely, "specimen wombat consulting"); none describes
 * the real website.
 *
 * What is proved, each against the route as the interface asks it:
 *   1. the question: an unknown value is replaced by its default and echoed so;
 *      an offset past the end opens the last page, not its last row; the
 *      optional columns are kept in the table's order;
 *   2. Google's index: each address shows its newest answer of the last week
 *      (a cut-short check blanks nothing; one asked by hand counts), the tile
 *      says how many come from an earlier check, "Not inspected" is a filter,
 *      and the summary says the true reason for an address without an answer;
 *   3. the search: words in the description, the main heading (typographic
 *      quotes folded) or a search the page is shown for; a pasted address of
 *      the site opens its page; another website's address finds nothing;
 *   4. the filters: every group's counts are narrowed by the other groups;
 *      sitemap, links in, finding, language, change against the window before;
 *      country and device change the figures;
 *   5. the tiles: the position line keeps a gap for a day without impressions;
 *   6. without Search Console a row has no clicks and no impressions (null,
 *      never zero), and the export leaves those cells empty;
 *   7. the summary: an empty issue list does not claim Google has a page it
 *      never inspected; the AI-readiness check says it never reads a page kept
 *      out of the sitemap; the AI quick actions carry the page's searches and
 *      headings within the operator's 1,000 characters;
 *   8. the export: its columns, the ticked rows only, a cell that looks like a
 *      formula is not run by a spreadsheet;
 *   9. the live lookup of an address the crawl does not read: redirects
 *      followed and said, Vercel's DEPLOYMENT_DISABLED said for what it is,
 *      one request a second to the website at most, an answer kept two
 *      minutes, another website refused, a redirect offered only where the
 *      desk's own rules allow one.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-pages-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
process.env.SITE_READ_CLONE = "off";
process.env.SITE_READ_REPO = path.join(dir, "no-such-copy.git");
for (const k of ["BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "SITE_REPO", "DESK_DEV_USER", "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "CC_PSI_PAGES"]) delete process.env[k];
/* A specimen key file, so the desk believes a Google account exists; nothing is ever signed with it (access is written down as already checked, and every request is refused). */
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "specimen-key.json");
writeFileSync(process.env.GA4_CREDENTIALS_FILE, JSON.stringify({ client_email: "specimen@specimen-project.iam.gserviceaccount.com", private_key: "specimen, never used" }));
process.env.GSC_SITE = "sc-domain:balkaris.ch";

let passed = 0;
let failed = 0;
function check(name: string, good: boolean, detail?: unknown): void {
  if (good) passed++;
  else failed++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${!good && detail !== undefined ? `\n     ${JSON.stringify(detail).slice(0, 700)}` : ""}`);
}
const section = (title: string) => console.log(`\n${title}`);

/* ---- the specimen website, served to the crawl only ------------------------ */

const SITE = "https://www.balkaris.ch";
const realFetch = globalThis.fetch;
let refused: string[] = [];
let serve: ((url: string) => Response | null) | null = null;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const r = serve?.(url) ?? null;
  if (!r) {
    refused.push(url.split("?")[0]!);
    throw new TypeError(`fetch failed: the check does not let ${url.split("?")[0]} leave the machine`);
  }
  return r;
}) as typeof fetch;

const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i % 17}`).join(" ");
function page(o: { path: string; title: string; description: string; h1: string; lang?: string; robots?: string; main?: string; nav?: string; words?: number }): string {
  return `<!doctype html><html lang="${o.lang ?? "en"}"><head><title>${o.title}</title><meta name="description" content="${o.description}">
    <link rel="canonical" href="${SITE}${o.path === "/" ? "" : o.path}">${o.robots ? `<meta name="robots" content="${o.robots}">` : ""}
    <meta property="og:image" content="${SITE}/og/specimen.jpg"></head>
    <body><nav><a href="/">Home</a>${o.nav ?? ""}</nav><main><h1>${o.h1}</h1><h2>Specimen section one</h2><p>${words(o.words ?? 300, "specimen")}</p>${o.main ?? ""}</main><footer>Specimen footer</footer></body></html>`;
}
const SPECIMEN: Record<string, string> = {
  "/": page({
    path: "/",
    title: "Specimen home | Balkaris",
    description: "The specimen home page of a made-up site.",
    h1: "Specimen home",
    nav: `<a href="/specimen-standard">Standard</a>`,
    main: `<p><a href="/case-study-specimen">A specimen case</a> and <a href="/insights/specimen-article">a specimen article</a>.</p>`,
  }),
  "/case-study-specimen": page({
    path: "/case-study-specimen",
    title: "A specimen case study whose title runs on far past what a result shows | Balkaris",
    description: "How a specimen client was helped, in made-up words.",
    h1: "Specimen case",
    lang: "de",
  }),
  "/insights/specimen-article": page({ path: "/insights/specimen-article", title: "Specimen article | Balkaris", description: "A specimen piece about quokka gardening.", h1: "Let’s build specimen bridges" }),
  "/specimen-standard": page({ path: "/specimen-standard", title: "Specimen standard | Balkaris", description: "A specimen standard page.", h1: "Specimen standard" }),
  "/specimen-lonely": page({ path: "/specimen-lonely", title: "Specimen lonely | Balkaris", description: "Nobody links to this specimen.", h1: "Specimen lonely" }),
  "/specimen-new": page({ path: "/specimen-new", title: "=SUM(1,1) specimen | Balkaris", description: "A specimen no index check has reached.", h1: "Specimen new" }),
  "/board-preview/specimen-hidden": page({ path: "/board-preview/specimen-hidden", title: "Specimen hidden | Balkaris", description: "A specimen kept out of search.", h1: "Specimen hidden", robots: "noindex" }),
};
const html200 = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const urlset = (paths: string[]) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`;
serve = (url) => {
  const u = new URL(url);
  if (u.host === "balkaris.ch") return new Response(null, { status: 308, headers: { location: `${SITE}${u.pathname}` } });
  if (u.host !== "www.balkaris.ch") return null;
  if (u.pathname === "/sitemap.xml") return new Response(urlset(Object.keys(SPECIMEN)), { status: 200, headers: { "content-type": "application/xml" } });
  if (u.pathname === "/robots.txt") return new Response(`User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`, { status: 200, headers: { "content-type": "text/plain" } });
  const p = SPECIMEN[u.pathname === "" ? "/" : u.pathname];
  return p ? html200(p) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
};

/* ---- the code under test, loaded after the environment is set -------------- */

const { db } = await import("../src/db.ts");
const store = await import("../src/cc/store.ts");
await import("../src/cc/site/index.ts");
const crawlMod = await import("../src/cc/site/crawl.ts");
await import("../src/cc/seo/tables.ts");
const pagesMod = await import("../src/cc/routes/seo/pages.ts");
const { Hono } = await import("hono");
type Vars = import("../src/cc/access.ts").Vars;
type Payload = import("../web/src/contract/seo/pages.ts").SeoPagesPayload;
type Lookup = import("../web/src/contract/common.ts").Reading<import("../web/src/contract/seo/pages.ts").PageLookup>;
type Got = import("../src/cc/site/http.ts").Got;
const T = pagesMod._test;

const app = new Hono<Vars>();
app.route("/api/v1/seo/pages", pagesMod.routes);
async function screen(q = ""): Promise<Payload> {
  const r = await app.request(`/api/v1/seo/pages${q ? `?${q}` : ""}`);
  if (r.status !== 200) throw new Error(`GET /api/v1/seo/pages?${q} answered ${r.status}: ${await r.text()}`);
  return (await r.json()) as Payload;
}
const rowsOf = (d: Payload) => (d.list.state === "ok" ? d.list.value.rows : []);
const pathsOf = (d: Payload) => rowsOf(d).map((r) => r.page.path);
const totalOf = (d: Payload) => (d.list.state === "ok" ? d.list.value.total : -1);

/* ---- the specimen crawl ------------------------------------------------------ */

section("The specimen site, read by the desk's own crawl");
store.setState("probe:last", String(Date.now()));
let crawled = "";
try {
  await crawlMod.crawl();
} catch (e) {
  crawled = e instanceof Error ? e.message : String(e);
}
check("the specimen crawl ran", crawled === "", crawled);
/* The website keeps this page out of its sitemap; the crawl learns that from the repository, which a check has not: said here instead. */
db.prepare("UPDATE cc_pages SET in_sitemap = 0 WHERE path = '/board-preview/specimen-hidden'").run();
serve = null;
refused = [];

/* ---- specimen Search Console history ----------------------------------------- */

const N = store.today(-3);
const day = (o: number): string => {
  const d = new Date(`${N}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + o);
  return d.toISOString().slice(0, 10);
};
const GAP = [day(-10), day(-11)];
type Fig = { day: string; country: string; device: string; page: string; query: string; clicks: number; impressions: number; position: number };
const figs: Fig[] = [];
for (let o = -69; o <= 0; o++) {
  const d = day(o);
  if (GAP.includes(d)) continue;
  const now = o >= -29;
  figs.push({ day: d, country: "all", device: "DESKTOP", page: `${SITE}/`, query: "specimen balkaris home", clicks: now && o % 5 === 0 ? 1 : 0, impressions: now ? 2 : 1, position: 3 });
  if (now ? o % 3 === 0 : true) {
    for (const country of ["all", "che"]) figs.push({ day: d, country, device: "MOBILE", page: `${SITE}/case-study-specimen`, query: "specimen wombat consulting", clicks: 0, impressions: now ? 1 : 3, position: 8 });
  }
  if (o % 10 === 0) figs.push({ day: d, country: "all", device: "DESKTOP", page: `${SITE}/insights/specimen-article`, query: "specimen quokka gardening", clicks: 0, impressions: 1, position: 12 });
  if (now && o % 6 === 0) figs.push({ day: d, country: "all", device: "MOBILE", page: `${SITE}/old-specimen-address`, query: "specimen old thing", clicks: 0, impressions: 1, position: 20 });
}
/* Google's other spelling of the host: the same page to the desk. */
figs.push({ day: day(-1), country: "all", device: "DESKTOP", page: "https://balkaris.ch/specimen-standard", query: "specimen standard thing", clicks: 0, impressions: 1, position: 30 });
const insRank = db.prepare("INSERT INTO cc_seo_rank (day, country, device, query, page, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
const insPage = db.prepare("INSERT INTO cc_seo_rank_pages (day, country, device, page, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?, ?)");
const insDay = db.prepare("INSERT OR REPLACE INTO cc_seo_rank_days (day, country, device, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?)");
const insSnap = db.prepare("INSERT INTO cc_seo_snaps (day, at, query_rows, page_rows, day_rows) VALUES (?, ?, ?, ?, ?)");
for (const f of figs) {
  insRank.run(f.day, f.country, f.device, f.query, f.page, f.clicks, f.impressions, f.position);
  insPage.run(f.day, f.country, f.device, f.page, f.clicks, f.impressions, f.position);
}
const dayTotals = new Map<string, { c: number; i: number; w: number }>();
for (const f of figs) {
  const k = `${f.day}|${f.country}|${f.device}`;
  const t = dayTotals.get(k) ?? { c: 0, i: 0, w: 0 };
  t.c += f.clicks;
  t.i += f.impressions;
  t.w += f.position * f.impressions;
  dayTotals.set(k, t);
}
/* Two impressions Google counts for the site without naming a page. */
const unnamedKey = `${day(-2)}|all|TABLET`;
dayTotals.set(unnamedKey, { c: 0, i: 2, w: 10 });
for (const [k, t] of dayTotals) {
  const [d, country, device] = k.split("|");
  insDay.run(d!, country!, device!, t.c, t.i, t.i ? t.w / t.i : 0);
}
for (let o = -69; o <= 0; o++) insSnap.run(day(o), new Date().toISOString(), 1, GAP.includes(day(o)) ? 0 : 1, 1);

/* ---- specimen URL Inspection: a whole check, a cut-short one, one asked by hand ---- */

const D0 = store.today(-2);
const D = store.today(-1);
const HAND = store.today();
const insIns = db.prepare(
  "INSERT INTO cc_inspect (day, url, verdict, coverage, last_crawl, google_canonical, user_canonical, robots_state, fetch_state, indexing_state, is_indexed, canonical_ok, link, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ALLOWED', 'SUCCESSFUL', 'INDEXING_ALLOWED', ?, ?, ?, ?)",
);
const inspect = (d: string, p: string, indexed: boolean, coverage: string, canonical: string = `${SITE}${p}`) =>
  insIns.run(d, `${SITE}${p}`, indexed ? "PASS" : "NEUTRAL", coverage, `${d}T08:00:00Z`, canonical, `${SITE}${p}`, indexed ? 1 : 0, canonical === `${SITE}${p}` ? 1 : 0, `https://search.google.com/search-console/inspect?specimen=${encodeURIComponent(p)}`, `${d}T09:00:00Z`);
inspect(D0, "/", true, "Submitted and indexed");
inspect(D0, "/case-study-specimen", true, "Submitted and indexed");
inspect(D0, "/insights/specimen-article", false, "Crawled - currently not indexed");
inspect(D0, "/specimen-standard", true, "Submitted and indexed", `${SITE}/`);
inspect(D0, "/specimen-lonely", false, "Discovered - currently not indexed");
inspect(D, "/", true, "Submitted and indexed");
inspect(HAND, "/specimen-lonely", true, "Submitted and indexed");
store.record("gsc.sitemap_addresses", 6, D0);
store.record("gsc.sitemap_addresses", 6, D);
/* Search Console's access, written down as already checked: every read below is from the desk's own tables. */
store.setState("gsc.access", JSON.stringify({ state: "ok", site: "sc-domain:balkaris.ch", permission: "siteFullUser", readable: ["sc-domain:balkaris.ch"], checkedAt: new Date().toISOString(), detail: "" }));
store.setState("gsc.access.asked", "sc-domain:balkaris.ch");

/* ---- 1. the question ------------------------------------------------------- */

section("1. The question as the server read it");
const base = await screen();
check("the screen answers with every page the crawl read", totalOf(base) === 7, totalOf(base));
const bogus = await screen("type=nonsense&finding=nope&lang=xx&status=what&sort=bogus");
check("unknown values are replaced by their defaults, and the echo says so", bogus.query.type === "all" && bogus.query.finding === "all" && bogus.query.lang === "all" && bogus.query.status === "all" && bogus.query.sort === "impressions" && totalOf(bogus) === 7, bogus.query);
const past = await screen("limit=5&offset=100");
check("an offset past the end opens the last page from its start, not its last row", past.query.offset === 5 && rowsOf(past).length === 2, { offset: past.query.offset, rows: rowsOf(past).length });
check("lastPageOffset: inside the list it is kept; past it, the last page's start", T.lastPageOffset(3, 7, 5) === 3 && T.lastPageOffset(7, 7, 5) === 5 && T.lastPageOffset(10, 10, 5) === 5 && T.lastPageOffset(4, 0, 5) === 0);
const cols = await screen("cols=words,title,bogus,sessions");
check("optional columns: unknown ones dropped, kept in the table's order", JSON.stringify(cols.query.cols) === JSON.stringify(["title", "sessions", "words"]), cols.query.cols);
check("asked for Organic sessions without GA4: the column's reading says why, and no row invents a figure", cols.organic.state !== "ok" && cols.organic.reason.length > 0 && rowsOf(cols).every((r) => r.organic === null), cols.organic);
check("without the column, GA4 is not asked at all", base.organic.state === "off" && /not shown/.test(base.organic.reason), base.organic);

/* ---- 2. Google's index ----------------------------------------------------- */

section("2. Google's index: each address's newest answer");
const byPath = new Map(rowsOf(await screen("limit=50")).map((r) => [r.page.path, r]));
check("the newest check reached / alone, and / shows that day", byPath.get("/")?.index?.day === D, byPath.get("/")?.index);
check("an address the cut-short check did not reach keeps the answer of the check before, with its day", byPath.get("/case-study-specimen")?.index?.day === D0 && byPath.get("/case-study-specimen")?.index?.indexed === true, byPath.get("/case-study-specimen")?.index);
check("an address asked about by hand after the newest check shows that answer", byPath.get("/specimen-lonely")?.index?.day === HAND && byPath.get("/specimen-lonely")?.index?.indexed === true, byPath.get("/specimen-lonely")?.index);
check("a page no check reached, and a page kept out of the sitemap, have none", byPath.get("/specimen-new")?.index === null && byPath.get("/board-preview/specimen-hidden")?.index === null);
check(
  "the basis says the newest check was cut short and how many answers are carried",
  base.index.state === "ok" && base.index.value.newest === D && base.index.value.complete === false && base.index.value.carried === 3 && base.index.value.oldest === D0,
  base.index,
);
const idxTile = base.tiles.indexed.state === "ok" ? base.tiles.indexed.value : null;
check("the Indexed tile: 4 of the 6 sitemap pages, and under it how many lean on an earlier check and how many were never asked", idxTile?.value === 4 && idxTile.of === 6 && /3 from an earlier check/.test(idxTile.sub ?? "") && /1 not inspected yet/.test(idxTile.sub ?? ""), idxTile);
const notIns = await screen("status=not-inspected");
check("Status › Not inspected lists exactly the pages without an answer", JSON.stringify(pathsOf(notIns).sort()) === JSON.stringify(["/board-preview/specimen-hidden", "/specimen-new"]), pathsOf(notIns));
const newSum = await screen("open=/specimen-new");
const newIdx = newSum.selected?.state === "ok" ? newSum.selected.value.index : null;
check("a sitemap page no recent check reached: waiting, and the reason names the cut-short check, not the sitemap", newIdx?.state === "waiting" && /cut short/.test(newIdx.reason) && !/not listed there/.test(newIdx.reason), newIdx);
const hidSum = await screen("open=/board-preview/specimen-hidden");
const hid = hidSum.selected?.state === "ok" ? hidSum.selected.value : null;
check("a page kept out of the sitemap: off, because the check only asks about sitemap addresses", hid?.index.state === "off" && /sitemap only/.test(hid.index.reason), hid?.index);
const caseSum = await screen("open=/case-study-specimen");
const caseIdx = caseSum.selected?.state === "ok" ? caseSum.selected.value.index : null;
check("a carried answer says which check it is from and that the newest did not reach it", caseIdx?.state === "ok" && caseIdx.value.day === D0 && caseIdx.value.newest === D && /did not reach/.test(caseIdx.note ?? ""), caseIdx);
const stdSum = await screen("open=/specimen-standard");
const stdIdx = stdSum.selected?.state === "ok" ? stdSum.selected.value.index : null;
check("Google's chosen canonical against the declared one: differs, both named", stdIdx?.state === "ok" && stdIdx.value.canonicalOk === false && stdIdx.value.googleCanonical === `${SITE}/` && stdIdx.value.userCanonical === `${SITE}/specimen-standard`, stdIdx);
const newest = T.newestPerAddress([
  { path: "/a", day: "2026-01-01", indexed: false } as never,
  { path: "/a", day: "2026-01-03", indexed: true } as never,
  { path: "/a", day: "2026-01-02", indexed: false } as never,
]);
check("newestPerAddress: of several days, the newest answer per address", (newest.get("/a") as unknown as { day: string }).day === "2026-01-03");

/* ---- 3. the search ---------------------------------------------------------- */

section("3. The search");
const byDesc = await screen("q=quokka");
check("a word of the description finds the page", JSON.stringify(pathsOf(byDesc)) === JSON.stringify(["/insights/specimen-article"]), pathsOf(byDesc));
const byHeading = await screen(`q=${encodeURIComponent("Let's build")}`);
check("the main heading, a typographic quote matched by a plain one", JSON.stringify(pathsOf(byHeading)) === JSON.stringify(["/insights/specimen-article"]), pathsOf(byHeading));
const byQuery = await screen("q=wombat");
check("a search Google showed the page for finds it, and the list says where it looked", JSON.stringify(pathsOf(byQuery)) === JSON.stringify(["/case-study-specimen"]) && byQuery.list.state === "ok" && /searches Google showed/.test(byQuery.list.value.searchedIn ?? ""), byQuery.list.state === "ok" ? byQuery.list.value.searchedIn : byQuery.list);
const pasted = await screen(`q=${encodeURIComponent(`${SITE}/case-study-specimen?utm_source=x#top`)}`);
check(
  "a pasted address of the site, query and fragment included, finds its page and opens it",
  JSON.stringify(pathsOf(pasted)) === JSON.stringify(["/case-study-specimen"]) && pasted.selected?.state === "ok" && pasted.selected.value.row.page.path === "/case-study-specimen" && pasted.lookup === null,
  pathsOf(pasted),
);
const bare = await screen(`q=${encodeURIComponent("balkaris.ch/specimen-standard")}`);
check("the host without www or https is the site's too", JSON.stringify(pathsOf(bare)) === JSON.stringify(["/specimen-standard"]), pathsOf(bare));
const foreign = await screen(`q=${encodeURIComponent("https://specimen-rival.example/case-study-specimen")}`);
check("another website's address finds nothing and says why", totalOf(foreign) === 0 && foreign.lookup?.state === "off" && /another website/.test(foreign.lookup.reason), foreign.lookup);
check(
  "addressIn: the site's addresses, another host, plain words",
  JSON.stringify(T.addressIn("https://balkaris.ch/about/")) === JSON.stringify({ path: "/about" }) &&
    JSON.stringify(T.addressIn("www.balkaris.ch/about?x=1")) === JSON.stringify({ path: "/about" }) &&
    JSON.stringify(T.addressIn("/about#team")) === JSON.stringify({ path: "/about" }) &&
    JSON.stringify(T.addressIn("https://specimen.example/x")) === JSON.stringify({ foreign: "specimen.example" }) &&
    T.addressIn("about us") === null &&
    T.addressIn("wombat") === null,
);

/* ---- 4. the filters -------------------------------------------------------- */

section("4. The filters and their counts");
const two = await screen("type=article&status=not-indexed");
check("two groups at once: the list is what both leave", JSON.stringify(pathsOf(two)) === JSON.stringify(["/insights/specimen-article"]), pathsOf(two));
const ofType = (await screen("type=article")).facets;
check(
  "each group is counted over what the OTHER groups leave: with Page type = article, Status counts articles only",
  ofType.status.find((s) => s.key === "not-indexed")?.count === 1 && ofType.status.find((s) => s.key === "indexed")?.count === 0 && ofType.all.status === 1 && ofType.all.type === 7,
  { status: ofType.status, all: ofType.all },
);
const sitemapOut = await screen("sitemap=out");
check("Sitemap › kept out of it", JSON.stringify(pathsOf(sitemapOut)) === JSON.stringify(["/board-preview/specimen-hidden"]), pathsOf(sitemapOut));
const menus = await screen("links=menus");
/* The home page is linked from every page's menu ("Home") and from no page's content. */
check("Links in › menus and footer only", JSON.stringify([...pathsOf(menus)].sort()) === JSON.stringify(["/", "/specimen-standard"]), pathsOf(menus));
const none = await screen("links=none");
check("Links in › nobody links here", ["/specimen-lonely", "/specimen-new"].every((p) => pathsOf(none).includes(p)) && !pathsOf(none).includes("/case-study-specimen"), pathsOf(none));
const long = await screen("finding=title.long");
check("Finding › one rule of the crawl", pathsOf(long).includes("/case-study-specimen") && base.facets.findings.some((f) => f.key === "title.long" && f.count >= 1), { rows: pathsOf(long), facet: base.facets.findings.find((f) => f.key === "title.long") });
const de = await screen("lang=de");
check("Language: offered when the site has two, and it filters", base.facets.langs.length === 2 && JSON.stringify(pathsOf(de)) === JSON.stringify(["/case-study-specimen"]), { langs: base.facets.langs, rows: pathsOf(de) });
check("the window before is compared: each row carries it", base.search.state === "ok" && base.search.value.previous !== null && rowsOf(base).every((r) => r.previous !== null), base.search);
const up = await screen("moved=up");
const down = await screen("moved=down");
/* Now against before: / 56 against 30, /specimen-standard 1 against 0; the case study 10 against 60, the article 2 against 3 (a gap day took one). */
check(
  "Change › more impressions, and fewer",
  JSON.stringify([...pathsOf(up)].sort()) === JSON.stringify(["/", "/specimen-standard"]) && JSON.stringify([...pathsOf(down)].sort()) === JSON.stringify(["/case-study-specimen", "/insights/specimen-article"]),
  { up: pathsOf(up), down: pathsOf(down) },
);
const byChange = await screen("sort=change");
check("sorted by change: the biggest gain first, a row without one last", pathsOf(byChange)[0] === "/" && pathsOf(byChange).indexOf("/case-study-specimen") > pathsOf(byChange).indexOf("/insights/specimen-article"), pathsOf(byChange));
const home = (d: Payload) => rowsOf(d).find((r) => r.page.path === "/");
const kase = (d: Payload) => rowsOf(d).find((r) => r.page.path === "/case-study-specimen");
const che = await screen("country=che&limit=50");
check("Switzerland only: the home page, never shown there, has 0; the case study keeps its Swiss impressions", home(che)?.impressions === 0 && (kase(che)?.impressions ?? 0) > 0 && che.search.state === "ok" && che.search.value.country === "che", { home: home(che)?.impressions, case: kase(che)?.impressions });
const mobile = await screen("device=mobile&limit=50");
check("phones only: the desktop-only home page has 0", home(mobile)?.impressions === 0 && (kase(mobile)?.impressions ?? 0) > 0, { home: home(mobile)?.impressions, case: kase(mobile)?.impressions });
const std = rowsOf(await screen("limit=50")).find((r) => r.page.path === "/specimen-standard");
check("two spellings of the host are one page", std?.impressions === 1, std?.impressions);
check(
  "elsewhere: the address Google counted that the crawl does not read",
  base.elsewhere.state === "ok" && base.elsewhere.value.addresses === 1 && base.elsewhere.value.top[0]?.path === "/old-specimen-address",
  base.elsewhere,
);
check("the impressions Google counted without a page are said, not spread over rows", base.search.state === "ok" && base.search.value.unnamed?.impressions === 2, base.search.state === "ok" ? base.search.value.unnamed : null);

/* ---- 5. the tiles ------------------------------------------------------------ */

section("5. The tiles");
const pd = base.tiles.positionDays;
check("the position line has one point a day, a gap where no impression was", pd.length === 30 && pd.filter((v) => v === null).length === 2 && pd.filter((v) => v !== null).length === 28, pd);

/* ---- 6. without Search Console --------------------------------------------- */

section("6. Without Search Console");
const keptSnaps = db.prepare("SELECT * FROM cc_seo_snaps").all() as Record<string, unknown>[];
db.prepare("DELETE FROM cc_seo_snaps").run();
store.setState("gsc.access", "null");
const off = await screen("limit=50");
check("the search reading is off and says why", off.search.state === "off", off.search);
check("no row has a click or an impression: null, never a zero", rowsOf(off).every((r) => r.clicks === null && r.impressions === null && r.position === null), rowsOf(off).map((r) => [r.clicks, r.impressions]));
check("the traffic filter is not offered", off.facets.traffic.length === 0);
const offCsv = await (await app.request("/api/v1/seo/pages/export.csv")).text();
const offRow = offCsv.split("\r\n").find((l) => l.startsWith("/,"))!.split(",");
check("the export leaves those cells empty", offRow[9] === "" && offRow[10] === "", offRow.slice(9, 13));
check("nothing tried to leave the machine", refused.length === 0, refused);
const putBack = db.prepare("INSERT INTO cc_seo_snaps (day, at, query_rows, page_rows, day_rows) VALUES (?, ?, ?, ?, ?)");
for (const s of keptSnaps) putBack.run(String(s.day), String(s.at), Number(s.query_rows), Number(s.page_rows), Number(s.day_rows));
store.setState("gsc.access", JSON.stringify({ state: "ok", site: "sc-domain:balkaris.ch", permission: "siteFullUser", readable: ["sc-domain:balkaris.ch"], checkedAt: new Date().toISOString(), detail: "" }));

/* ---- 7. the summary --------------------------------------------------------- */

section("7. One page summarised");
check("a page kept out of the sitemap: the AI-readiness check says it never reads it (off, not waiting)", hid?.readiness.state === "off" && /kept out of the sitemap/.test(hid.readiness.reason), hid?.readiness);
check("its issue list has no Google line: Google was never asked", hid?.issues.state === "ok" && !hid.issues.value.some((i) => i.key === "index"), hid?.issues);
const art = (await screen("open=/insights/specimen-article")).selected;
const artV = art?.state === "ok" ? art.value : null;
check("a page Google has not indexed: Google's state is its first issue", artV?.issues.state === "ok" && artV.issues.value[0]?.key === "index" && artV.issues.value[0].level === "high", artV?.issues);
const homeSum = (await screen("open=/")).selected;
const hv = homeSum?.state === "ok" ? homeSum.value : null;
const content = hv?.actions.find((a) => a.key === "content");
const promptOf = (t: { kind: string; prompt?: string } | null | undefined): string => (t?.kind === "ask" ? (t.prompt ?? "") : "");
const prompt = promptOf(content?.task);
check("Improve content with AI: the page's searches and headings are written into the question", /specimen balkaris home/.test(prompt) && /section headings/.test(prompt), prompt);
check("every question fits the operator's limit", (hv?.actions ?? []).every((a) => promptOf(a.task).length <= T.PROMPT_MOST), hv?.actions.map((a) => promptOf(a.task).length));
check("the step says what the operator is not given", /not given the page's full text/.test(content?.step ?? ""), content?.step);
check("a count of one is said in the singular", !/\(1 impressions/.test(prompt), prompt);
const many = T.promptWith("Q?", [{ lead: "Items:", items: Array.from({ length: 200 }, (_, i) => `item number ${i}.`) }]);
check("promptWith: a list that does not fit is cut at an item, never mid-item, and no double full stop", many.length <= T.PROMPT_MOST && many.endsWith(".") && !many.includes("..") && /item number \d+\.$/.test(many), many.slice(-60));
check("the page's keywords: its searches, most impressions first", hv?.keywords.state === "ok" && hv.keywords.value.rows[0]?.query === "specimen balkaris home", hv?.keywords);
check("PageSpeed: not on the measured list, said so (off), not invented", hv?.speed.state !== "ok", hv?.speed);

/* ---- 8. the export ---------------------------------------------------------- */

section("8. The export");
const csvR = await app.request("/api/v1/seo/pages/export.csv?type=all");
/* Read as bytes: text() would drop the byte-order mark a spreadsheet needs to read the file as UTF-8. */
const csvBytes = new Uint8Array(await csvR.arrayBuffer());
const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csvBytes).replace(/^﻿/, "");
const lines = csv.split("\r\n").filter(Boolean);
const heads = lines[0]!.match(/("[^"]*"|[^,]+)/g) ?? [];
check(
  "a CSV with a byte-order mark, its 29 columns, every row",
  csvR.headers.get("content-type")?.startsWith("text/csv") === true && csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf && heads.length === 29 && lines.length === 8,
  { lines: lines.length, heads: heads.length, first: [...csvBytes.slice(0, 3)] },
);
check("a cell that starts like a formula is not run by a spreadsheet", csv.includes(`"'=SUM(1,1) specimen`), lines.find((l) => l.startsWith("/specimen-new")));
const picked = await (await app.request("/api/v1/seo/pages/export.csv?path=/&path=%2Fcase-study-specimen")).text();
check("only the ticked rows", picked.split("\r\n").filter(Boolean).length === 3);
check("the export's name says the window and that rows were picked", /-selected\.csv/.test((await app.request("/api/v1/seo/pages/export.csv?path=/")).headers.get("content-disposition") ?? ""));

/* ---- 9. the live lookup ----------------------------------------------------- */

section("9. An address the crawl does not read, looked up live");
const asked: { url: string; at: number }[] = [];
const got = (o: Partial<Got> & { url: string; status: number }): Got => ({ hops: [], headers: {}, ttfb: 40, total: 60, bytes: o.body?.length ?? 0, body: null, ...o });
pagesMod.wire.get = async (url: string): Promise<Got> => {
  asked.push({ url, at: Date.now() });
  if (url.endsWith("/old-specimen-address"))
    return got({ url: `${SITE}/insights/specimen-article`, status: 200, hops: [{ url, status: 308, location: "/insights/specimen-article" }], headers: { "content-type": "text/html" }, body: SPECIMEN["/insights/specimen-article"]! });
  if (url.endsWith("/specimen-switched-off")) return got({ url, status: 402, headers: { "x-vercel-error": "DEPLOYMENT_DISABLED", "content-type": "text/plain" }, body: "Payment required" });
  return got({ url, status: 404, headers: { "content-type": "text/html" }, body: "<html><body>Not found</body></html>" });
};
T.forgetLookups();
const look = await screen("open=/old-specimen-address");
const lv = look.lookup?.state === "ok" ? look.lookup.value : null;
check("?open= of an address the crawl does not read: a lookup in the summary's place, not a summary", look.selected === null && lv !== null && lv.known === false, look.lookup);
const live = lv?.live.state === "ok" ? lv.live.value : null;
check("the redirect is followed and said: where it lands, by which hop", live?.status === 200 && live.landsOn === "/insights/specimen-article" && live.hops[0]?.status === 308, live);
check("the page it lands on is read: title, heading, words", live?.page?.title === "Specimen article | Balkaris" && live.page.h1[0] === "Let’s build specimen bridges" && live.page.words > 100, live?.page);
check("what Google counted for exactly that address, and its search", lv?.search.state === "ok" && lv.search.value.impressions === 5 && lv.search.value.keywords[0]?.query === "specimen old thing", lv?.search);
check("not inspected: the daily check asks about sitemap addresses only", lv?.index.state === "off", lv?.index);
check("a redirect may be proposed: it is not in the sitemap and did not answer 200 at the crawl", lv?.mayRedirect.ok === true && lv.redirect === null, lv?.mayRedirect);
const again = await screen("open=/old-specimen-address&type=article");
check("the same address within two minutes is not asked again", asked.length === 1 && again.lookup?.state === "ok", asked.length);
const t0 = Date.now();
const offSite = (await (await app.request("/api/v1/seo/pages/lookup?url=%2Fspecimen-switched-off")).json()) as Lookup;
const waited = asked.length === 2 ? asked[1]!.at - asked[0]!.at : -1;
check("one request a second to the website at most", waited >= 950, { waited, took: Date.now() - t0 });
const offLive = offSite.state === "ok" && offSite.value.live.state === "ok" ? offSite.value.live.value : null;
check("Vercel's switched-off deployment is said for what it is, and the address is not called missing", offLive?.status === 402 && offLive.error === "DEPLOYMENT_DISABLED" && offLive.page === null, offLive);
const typed = await screen(`q=${encodeURIComponent(`${SITE}/specimen-never-was`)}`);
check("a whole address typed into the search that matches no row is looked up live", totalOf(typed) === 0 && typed.lookup?.state === "ok" && typed.lookup.value.path === "/specimen-never-was", typed.lookup);
const known = (await (await app.request("/api/v1/seo/pages/lookup?url=%2Fspecimen-standard")).json()) as Lookup;
check("a live page of the sitemap: no redirect may be proposed from it, and the reason is the desk's own", known.state === "ok" && known.value.known && !known.value.mayRedirect.ok && /sitemap|200/.test(known.value.mayRedirect.why ?? ""), known.state === "ok" ? known.value.mayRedirect : known);
const elsewhereLook = (await (await app.request(`/api/v1/seo/pages/lookup?url=${encodeURIComponent("https://specimen-rival.example/x")}`)).json()) as Lookup;
check("another website is refused before any request", elsewhereLook.state === "off" && /another website/.test(elsewhereLook.reason) && asked.every((a) => a.url.startsWith(SITE)), elsewhereLook);
const empty = (await (await app.request("/api/v1/seo/pages/lookup")).json()) as Lookup;
check("no address: refused with the step", empty.state === "off" && /Give an address/.test(empty.reason), empty);
check("saysNoindex: noindex and none are; max-image-preview:none is not", T.saysNoindex("noindex, follow") && T.saysNoindex("none") && !T.saysNoindex("max-image-preview:none") && !T.saysNoindex(null));
check("nothing but the fake wire left the route", refused.length === 0, refused);

/* ---- the end ---------------------------------------------------------------- */

globalThis.fetch = realFetch;
try {
  db.close();
} catch {
  /* already closed */
}
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* Windows may hold the file a moment longer; the folder is in the system's temp. */
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
