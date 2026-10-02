/**
 * The desk's own read of the website (src/cc/site/), proved twice over.
 *
 *   node --env-file=work/dev.env --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-site.ts
 *
 * FIRST, THE RULES, on small hand-written pages and files, with no network:
 * the trailing slash of a canonical is not a finding (the home page's
 * canonical has none, its sitemap address has one), alt="" is decoration and
 * only a missing alt is a fault, a 71-character title is flagged with both of
 * its numbers, and the rest of the rule table, the robots.txt and sitemap
 * readers, the page-kind rule, the structured-data validator and Vercel's
 * region header each get a line. The pages are specimens: their words say
 * so, and no figure in them stands for anything real.
 *
 * THEN THE BOOKKEEPING, on specimen history written into the throwaway
 * database and removed again, with `fetch` stubbed so nothing leaves the
 * machine: a headline's comparison while the history is young, a sitemap that
 * answers 200 with no address, a crawl asked for again after a restart, the
 * PageSpeed headline taken from the newest sweep only, desktop rated by
 * desktop bands, a sweep Google refuses before its first page, and the long
 * response-time ranges.
 *
 * THEN EACH JOB ONCE against the real site, into a throwaway database in
 * work/: probe, repo, sitemap, crawl, assets, speed. Counts, timings and the
 * peak memory of each are printed; the crawl must add under 200 MB and keep
 * the process under 450 MB. One
 * full crawl per run and no more: the sitemap's "please crawl" goes to a
 * scheduler that has no jobs here, and the crawl is called once.
 *
 *   --rules-only   the first part only: no request leaves the machine.
 *   --speed-full   test the speed job's whole page list. Without it the job is
 *                  run on the home page alone (CC_PSI_PAGES=/), two runs:
 *                  Google is slow and its keyless quota is shared.
 *   --keep         leave the throwaway database in work/ to look at.
 *
 * What it never does: write to the dev database, run git in the publisher's
 * working tree (SITE_REPO is removed from the environment before anything
 * loads, so a module that reached for it would fail here), make the read
 * copy from GitHub (SITE_READ_CLONE=off), send anything anywhere, or POST.
 */
import { readdirSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "work", `check-cc-site-${process.pid}`);
mkdirSync(dir, { recursive: true });

const RULES_ONLY = process.argv.includes("--rules-only");
const SPEED_FULL = process.argv.includes("--speed-full");
const KEEP = process.argv.includes("--keep");

delete process.env.SITE_REPO;
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.SITE_READ_CLONE = "off";
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE ??= "https://www.balkaris.ch";
if (!SPEED_FULL) process.env.CC_PSI_PAGES = "/";

/* ---------- saying what happened ---------------------------------------------- */

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}
const section = (title: string) => console.log(`\n${title}`);
const mb = (b: number) => `${Math.round(b / 1_048_576)} MB`;

/* Peak resident memory, sampled every 100 ms: per stretch of work, and over the whole run. */
let peak = 0;
let peakAll = 0;
const sampler = setInterval(() => {
  const rss = process.memoryUsage().rss;
  peak = Math.max(peak, rss);
  peakAll = Math.max(peakAll, rss);
}, 100);
sampler.unref();

async function timed<T>(name: string, work: () => Promise<T>): Promise<{ value: T | null; ms: number; peak: number; error: string | null }> {
  peak = process.memoryUsage().rss;
  const t0 = performance.now();
  try {
    const value = await work();
    const ms = Math.round(performance.now() - t0);
    peak = Math.max(peak, process.memoryUsage().rss);
    console.log(`  ${name}: ${(ms / 1000).toFixed(1)} s, peak ${mb(peak)}`);
    return { value, ms, peak, error: null };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const error = e instanceof Error ? e.message : String(e);
    console.log(`  ${name}: FAILED after ${(ms / 1000).toFixed(1)} s: ${error}`);
    return { value: null, ms, peak, error };
  }
}

/* ---------- loading the code under test, after the environment is set -------- */

const { db } = await import("../src/db.ts");
const { parsePage, readSchema } = await import("../src/cc/site/parse.ts");
const { judge, judgePage, kindOf, LIMITS, RULES } = await import("../src/cc/site/rules.ts");
const { parseRobots, allowed, parseSitemap } = await import("../src/cc/site/sitemap.ts");
const { regionsOf } = await import("../src/cc/site/probes.ts");
const { abs } = await import("../src/cc/site/http.ts");
type PageView = import("../src/cc/site/rules.ts").PageView;
type PageKind = import("../src/cc/site/rules.ts").PageKind;

/* ---------- part one: the rules ------------------------------------------------- */

section("The rules, on specimen pages");

/** `n` words of obviously made-up text: "specimen word specimen word …", or `n` times the word given. */
const words = (n: number, word?: string) => Array.from({ length: n }, (_, i) => word ?? (i % 2 ? "word" : "specimen")).join(" ");

/**
 * A specimen page, complete unless a part is overridden: a menu of 400 words
 * and a footer of 50 (both outside <main>), and in <main> a heading and
 * `mainWords` words (300 unless said).
 */
function html(o: { title?: string | null; canonical?: string | null; robots?: string; body?: string; head?: string; schema?: string[]; lang?: string | null; mainWords?: number } = {}): string {
  const title = o.title === undefined ? "Specimen page" : o.title;
  const schema = o.schema ?? [JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", name: "Specimen page" })];
  return `<!doctype html><html${o.lang === null ? "" : ` lang="${o.lang ?? "en"}"`}><head>
    ${title === null ? "" : `<title>${title}</title>`}
    <meta name="description" content="A specimen description for the desk's own check.">
    ${o.canonical === null ? "" : `<link rel="canonical" href="${o.canonical ?? "https://www.balkaris.ch/specimen"}">`}
    ${o.robots ? `<meta name="robots" content="${o.robots}">` : ""}
    <meta property="og:title" content="Specimen"><meta property="og:image" content="https://www.balkaris.ch/og/specimen.jpg">
    <meta name="twitter:card" content="summary_large_image">
    ${schema.map((s) => `<script type="application/ld+json">${s}</script>`).join("")}
    ${o.head ?? ""}
  </head><body><nav><a href="/">Home</a> ${words(399, "menu")}</nav><main><h1>Specimen</h1><p>${words(o.mainWords ?? 300)}</p>${o.body ?? ""}</main><footer>${words(50, "footer")}</footer></body></html>`;
}

function view(path: string, page: string, o: Partial<PageView> = {}): PageView {
  const parsed = parsePage(page, abs(path));
  return {
    path,
    status: 200,
    inSitemap: true,
    kind: (o.kind ?? kindOf(path)) as PageKind,
    robotsHeader: null,
    facts: parsed.facts,
    inlinks: 1,
    broken: [],
    redirected: [],
    externalBroken: [],
    ...o,
  };
}
const rulesOf = (v: PageView) => judgePage(v, "/ph/og-default.webp").map((i) => i.rule);

/* The trailing slash. */
{
  const home = judgePage(view("/", html({ canonical: "https://www.balkaris.ch" }), { kind: "home", inlinks: 0 }), null);
  check("the home page's canonical without a slash is not a finding against its sitemap address with one", !home.some((i) => i.rule.startsWith("canonical")), home.map((i) => i.rule).join(", "));
  const slashed = rulesOf(view("/specimen", html({ canonical: "https://www.balkaris.ch/specimen/" })));
  check("a canonical that differs only by a trailing slash is not a finding", !slashed.some((r) => r.startsWith("canonical")), slashed.join(", "));
  const elsewhere = judgePage(view("/specimen", html({ canonical: "https://www.balkaris.ch/other-specimen" })), null).find((i) => i.rule === "canonical.mismatch");
  check("a canonical naming another page is a critical finding", elsewhere?.severity === "critical" && elsewhere.measured === "/other-specimen", elsewhere?.text);
  const twin = rulesOf(view("/specimen", html({ canonical: "https://balkaris.ch/specimen" })));
  check("a canonical on the bare domain is a finding (the canonical host is www)", twin.includes("canonical.mismatch"));
  check("no canonical at all is a warning", rulesOf(view("/specimen", html({ canonical: null }))).includes("canonical.missing"));
}

/* The title. */
{
  const t71 = "Specimen ".repeat(8).trim();
  check("the specimen title really is 71 characters", [...t71].length === 71, String([...t71].length));
  const long = judgePage(view("/specimen", html({ title: t71 })), null).find((i) => i.rule === "title.long");
  check(
    "a 71-character title is flagged with both numbers",
    long?.measured === 71 && long.limit === LIMITS.title && /\b71 characters\b/.test(long.text) && new RegExp(`over ${LIMITS.title}\\b`).test(long.text),
    long?.text,
  );
  check("a 60-character title is not flagged", !rulesOf(view("/specimen", html({ title: "x".repeat(60) }))).includes("title.long"));
  check("no title is critical", judgePage(view("/specimen", html({ title: null })), null).find((i) => i.rule === "title.missing")?.severity === "critical");
}

/* Pictures and their alt text. */
{
  const decorative = view("/specimen", html({ body: `<img src="/ph/specimen-a.webp" alt="" width="10" height="10">` }));
  const img = decorative.facts?.images[0];
  check('alt="" is read as decoration', img?.alt === "empty");
  check('alt="" is not a finding', !rulesOf(decorative).includes("images.alt-absent"));
  const bare = view("/specimen", html({ body: `<img src="/ph/specimen-b.webp"><img src="/ph/specimen-c.webp" alt="A specimen described">` }));
  const absent = judgePage(bare, null).find((i) => i.rule === "images.alt-absent");
  check("a missing alt attribute is a finding, counted once per picture without one", absent?.measured === 1 && absent.limit === 0 && absent.related?.[0] === "/ph/specimen-b.webp", absent?.text);
  check("a written alt is kept", bare.facts?.images[1]?.alt === "written" && bare.facts.images[1].altText === "A specimen described");
  const hidden = view("/specimen", html({ body: `<div aria-hidden="true"><img src="/ph/specimen-d.webp"></div>` }));
  check("a picture hidden from assistive technology is not held to the alt rule", !rulesOf(hidden).includes("images.alt-absent"));
  const linked = view("/specimen", html({ body: `<a href="/about"><img src="/ph/specimen-e.webp" alt=""></a>` }));
  check("a link holding only a picture with no alt has no name, and that is a finding", rulesOf(linked).includes("images.unnamed-link"));
  const optimised = view("/specimen", html({ body: `<img src="/_next/image?url=%2Fwork%2Fspecimen.webp&amp;w=640&amp;q=75" alt="x">` })).facts?.images[0];
  check("a picture through the optimiser is reported as its file in public/", optimised?.file === "/work/specimen.webp" && optimised.via === "optimised", JSON.stringify(optimised));
  const remote = view("/specimen", html({ body: `<img src="https://images.unsplash.com/photo-specimen?w=800" alt="x">` })).facts?.images[0];
  check("a picture from another host is reported as that host's", remote?.remote === "images.unsplash.com" && remote.file === null && remote.remoteUrl === "https://images.unsplash.com/photo-specimen");
  const video = view("/specimen", html({ body: `<video poster="/film/specimen.webp" muted></video>` })).facts?.videos[0];
  check("a video with a poster and no source in the HTML keeps its poster", video?.poster === "/film/specimen.webp" && video.file === null);
}

/* Indexing and the sitemap. */
{
  check("a page in the sitemap that says noindex is critical", rulesOf(view("/specimen", html({ robots: "noindex, follow" }))).includes("page.noindex-in-sitemap"));
  check("the X-Robots-Tag header counts as much as the tag", rulesOf(view("/specimen", html(), { robotsHeader: "noindex, nofollow" })).includes("page.noindex-in-sitemap"));
  const out = rulesOf(view("/specimen", html(), { inSitemap: false }));
  check("an indexable page outside the sitemap is a finding, and nothing else is held against it", out.length === 1 && out[0] === "page.missing-from-sitemap", out.join(", "));
  check("a noindex page outside the sitemap is clean", rulesOf(view("/specimen", html({ robots: "noindex" }), { inSitemap: false })).length === 0);
  check("a sitemap address that redirects is critical", rulesOf(view("/specimen", "", { status: 308, facts: null, redirectTo: "/elsewhere" })).includes("page.redirects"));
  check("an address that answers 404 is critical", rulesOf(view("/specimen", "", { status: 404, facts: null })).includes("page.status"));
}

/* Structured data. */
{
  check("a block that is not JSON does not parse", readSchema("{ not json").parses === false);
  const unreadable = rulesOf(view("/specimen", html({ schema: ["{ not json"] })));
  check("structured data that is not JSON is critical", unreadable.includes("schema.unreadable"));
  const crumbs = readSchema(JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home" }, { "@type": "ListItem", position: 2, name: "Specimen" }] }));
  check("a breadcrumb missing a link before the last crumb is incomplete, the last crumb may go without", crumbs.nodes[0]?.missing.join() === "itemListElement[0].item");
  const faq = readSchema(JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Specimen?" }] }));
  check("a question without an answer is incomplete", faq.nodes[0]?.missing.includes("mainEntity[0].acceptedAnswer.text") === true);
  const graph = readSchema(JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "Specimen", url: "https://example.test" }, { "@type": "Article", headline: "Specimen" }] }));
  check("a @graph is read node by node", graph.nodes.length === 2 && graph.nodes[1]?.missing.join() === "datePublished,author");
  check("a page with no structured data at all is a warning", rulesOf(view("/specimen", html({ schema: [] }))).includes("schema.none"));
  const siteOnly = rulesOf(view("/specimen", html({ schema: [JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", name: "Specimen", url: "https://example.test" })] })));
  check("a page whose structured data only describes the company is an opportunity", siteOnly.includes("schema.site-only"));
}

/* Words, links, duplicates and the score. */
{
  const v = view("/specimen", html());
  check("words are counted in <main> only: the menu and the footer are not the page's own", v.facts?.words === 301, String(v.facts?.words));
  const thin = judgePage(view("/specimen", html({ mainWords: 100 })), null).find((i) => i.rule === "content.thin");
  check("a thin page is flagged with its count and the yardstick", thin?.measured === 101 && thin.limit === LIMITS.thinWords, thin?.text);
  check("a page in the sitemap that nothing links to is an orphan", rulesOf(view("/specimen", html(), { inlinks: 0 })).includes("links.orphan"));
  check("the home page is never an orphan", !rulesOf(view("/", html({ canonical: "https://www.balkaris.ch/" }), { kind: "home", inlinks: 0 })).includes("links.orphan"));

  const a = view("/specimen-a", html({ canonical: "https://www.balkaris.ch/specimen-a", title: "One specimen title" }));
  const b = view("/specimen-b", html({ canonical: "https://www.balkaris.ch/specimen-b", title: "One specimen title" }));
  const c = view("/specimen-c", html({ canonical: "https://www.balkaris.ch/specimen-c", title: "Specimen ".repeat(8).trim() }));
  const verdict = judge([a, b, c], [], null);
  const dupes = verdict.issues.filter((i) => i.rule === "title.duplicate").map((i) => i.path);
  check("a title two pages share is a finding on both", dupes.includes("/specimen-a") && dupes.includes("/specimen-b") && !dupes.includes("/specimen-c"));
  /* All three share the description too (the specimen has one): each page
     loses the duplicate description's cost; a and b the duplicate title's;
     c the long title's. */
  const want = (rules: (keyof typeof RULES)[]) => 100 - rules.reduce((s, r) => s + RULES[r].cost, 0);
  const sa = want(["title.duplicate", "description.duplicate"]);
  const sc = want(["title.long", "description.duplicate"]);
  check("a page's score is 100 minus the cost of each rule that fired on it, once", verdict.scores.get("/specimen-a") === sa && verdict.scores.get("/specimen-c") === sc, `${verdict.scores.get("/specimen-a")} / ${verdict.scores.get("/specimen-c")}`);
  check("the site's score is the mean of the page scores", verdict.siteScore === Math.round((sa + sa + sc) / 3), String(verdict.siteScore));
  const withSite = judge([a, b, c], [{ id: "sitemap.duplicate|site", rule: "sitemap.duplicate", severity: "opportunity", path: null, text: "specimen", measured: 2, limit: 1 }], null);
  check("a site rule is taken from the site's score, once", withSite.siteScore === (verdict.siteScore as number) - RULES["sitemap.duplicate"].cost);
  const kept = judge([view("/specimen", html({ robots: "noindex" }), { inSitemap: false })], [], null);
  check("a page kept out of the sitemap has no score, and says so (null)", kept.scores.get("/specimen") === null && kept.siteScore === null);
}

/* The kind of each page. */
{
  const roster = new Map<string, "service" | "segment">([["/how-to-specimen", "segment"], ["/specimen-offer", "service"]]);
  const cases: [string, Parameters<typeof kindOf>[1], PageKind][] = [
    ["/", {}, "home"],
    ["/insights", {}, "insights"],
    ["/insights/topic/specimen", {}, "insights"],
    ["/insights/specimen-article", {}, "article"],
    ["/case-study-specimen", {}, "case"],
    ["/how-to-specimen", { roster }, "segment"],
    ["/board-preview/specimen", { roster }, "segment"],
    ["/specimen-offer", { roster }, "landing"],
    ["/specimen-offer", { priority: 0.85 }, "landing"],
    ["/specimen-legal", { priority: 0.2 }, "legal"],
    ["/specimen-service", { schemaTypes: ["Organization", "Service"] }, "service"],
    ["/specimen-about", { schemaTypes: ["Organization"] }, "standard"],
    ["/specimen-down", { before: "service" }, "service"],
  ];
  const wrong = cases.filter(([p, hint, want]) => kindOf(p, hint) !== want).map(([p, hint, want]) => `${p}: ${kindOf(p, hint)} not ${want}`);
  check("every page gets the kind the website's structure gives it", wrong.length === 0, wrong.join("; "));
}

/* robots.txt and the sitemap's XML. */
{
  const robots = parseRobots("User-agent: *\nDisallow: /api/\nAllow: /api/public\n\nUser-agent: SpecimenBot\nDisallow: /\n\nSitemap: https://www.balkaris.ch/sitemap.xml\n");
  check("robots.txt: a disallowed folder is refused", !allowed(robots, "/api/apply"));
  check("robots.txt: the longest rule wins (Allow under a Disallow)", allowed(robots, "/api/public/x"));
  check("robots.txt: an address no rule mentions is allowed", allowed(robots, "/specimen"));
  check("robots.txt: a named crawler follows its own group", !allowed(robots, "/specimen", "SpecimenBot"));
  check("robots.txt: the Sitemap line is read", robots.sitemaps[0] === "https://www.balkaris.ch/sitemap.xml");
  const map = parseSitemap(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.balkaris.ch/</loc><priority>1</priority></url><url><loc>https://www.balkaris.ch/specimen</loc><lastmod>2026-01-01</lastmod></url><url><loc>https://www.balkaris.ch/specimen/</loc></url><url><loc>https://elsewhere.example/specimen</loc></url></urlset>`,
  );
  check("sitemap: the home page is stored as /, with its priority", map.entries[0]?.path === "/" && map.entries[0].priority === 1);
  check("sitemap: lastmod is kept as written", map.entries[1]?.lastmod === "2026-01-01");
  check("sitemap: the same address twice (by a trailing slash) is one entry and a finding", map.entries.length === 2 && map.issues.some((i) => i.rule === "sitemap.duplicate"));
  check("sitemap: an address on another host is critical", map.issues.some((i) => i.rule === "sitemap.off-host" && i.severity === "critical"));
  check("sitemap: XML that is not well-formed is critical", parseSitemap("<urlset><url><loc>x</loc></urlset").issues.some((i) => i.rule === "sitemap.malformed"));
}

/* Vercel's request id. */
{
  const fn = regionsOf("fra1::iad1::specimen-1790000000000-abcdef");
  const edge = regionsOf("fra1::specimen-1790000000000-abcdef");
  check("x-vercel-id: an edge and a function region are both read", fn.edge === "fra1" && fn.fn === "iad1");
  check("x-vercel-id: an answer from the edge alone has no function region", edge.edge === "fra1" && edge.fn === null);
  check("x-vercel-id: nothing to read is nothing, not a guess", regionsOf("").edge === null);
}

/* A page that answered and was not read. */
{
  const unread: PageView = { path: "/specimen-unread", status: 200, inSitemap: true, kind: "standard", robotsHeader: null, facts: null, unread: "the answer is “image/png”, not HTML", inlinks: 0, broken: [], redirected: [], externalBroken: [] };
  const alone = judge([unread], [], null);
  const said = alone.issues.find((i) => i.rule === "page.unreadable");
  check("a page that answered 200 and was not read is a critical finding that says why", said?.severity === "critical" && /image\/png/.test(said.text), said?.text);
  check("it has no score, and a site of only such pages has none either", alone.scores.get("/specimen-unread") === null && alone.siteScore === null, `${alone.scores.get("/specimen-unread")} / ${alone.siteScore}`);
  /* A read page that scores under 100 (its title is too long), so a mean that counted the unread page as 100 would show. */
  const read = view("/specimen-read", html({ canonical: "https://www.balkaris.ch/specimen-read", title: "Specimen ".repeat(8).trim() }));
  const both = judge([unread, read], [], null);
  const readScore = both.scores.get("/specimen-read");
  check("it is left out of the site's mean, not counted as 100", readScore === 100 - RULES["title.long"].cost && both.siteScore === readScore, `site ${both.siteScore}, the read page ${readScore}`);
  check("what needs no HTML is still checked: no page links to it", alone.issues.some((i) => i.rule === "links.orphan" && i.path === "/specimen-unread"));
}

/* ---------- the bookkeeping, on specimen history; fetch is stubbed ---------------- */

section("The bookkeeping, on specimen history (no request leaves the machine)");

{
  const store = await import("../src/cc/store.ts");
  const crawlMod = await import("../src/cc/site/crawl.ts");
  const sitemapMod = await import("../src/cc/site/sitemap.ts");
  const psi = await import("../src/cc/site/psi.ts");
  const probes = await import("../src/cc/site/probes.ts");
  const { askFor } = await import("../src/cc/site/ask.ts");
  const { register } = await import("../src/cc/scheduler.ts");
  const { sources } = await import("../src/cc/sources.ts");
  await import("../src/cc/site/index.ts");
  const realFetch = globalThis.fetch;
  /** Answer every request from `answer`; anything it does not know is refused, so nothing leaves the machine. */
  const stub = (answer: (url: string, method: string) => Response | null) => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const r = answer(url, init?.method ?? "GET");
      if (!r) throw new TypeError(`fetch failed: the check's stub does not serve ${url}`);
      return r;
    }) as typeof fetch;
  };
  const clean = () => {
    globalThis.fetch = realFetch;
    db.exec("DELETE FROM cc_series; DELETE FROM cc_state; DELETE FROM cc_cache; DELETE FROM cc_activity; DELETE FROM cc_vitals; DELETE FROM cc_pages;");
  };

  /* The headline's comparison, while the history is young. Specimen values. */
  store.record("seo.score", 11, store.today(-1));
  store.record("seo.score", 22, store.today());
  store.setState("site:crawl:finished", new Date().toISOString());
  const young = crawlMod.siteScore(30);
  check("two days of history are not a 30-day comparison: previous is null", young.state === "ok" && young.value.previous === null && young.value.value === 22, JSON.stringify(young.state === "ok" ? young.value : young));
  const short = crawlMod.siteScore(1);
  check("over one day, yesterday is the comparison", short.state === "ok" && short.value.previous === 11);
  store.record("seo.score", 7, store.today(-30));
  const month = crawlMod.siteScore(30);
  check("once the history reaches the start of the period, that day is the comparison", month.state === "ok" && month.value.previous === 7, JSON.stringify(month.state === "ok" ? month.value.previous : month));
  store.record("seo.pages", 3, store.today());
  const counted = crawlMod.pageCount(30);
  check("a page count is not labelled as a score", counted.state === "ok" && !/score/i.test(counted.note ?? ""), counted.state === "ok" ? counted.note : counted.reason);
  clean();

  /* An empty sitemap that answers 200 must not wipe the addresses. */
  const urlset = (paths: string[]) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${abs(p)}</loc></url>`).join("")}</urlset>`;
  let xml = urlset(["/", "/specimen-a", "/specimen-b"]);
  stub((url) => {
    if (url.endsWith("/sitemap.xml")) return new Response(xml, { status: 200, headers: { "content-type": "application/xml" } });
    if (url.endsWith("/robots.txt")) return new Response(`User-agent: *\nAllow: /\nSitemap: ${abs("/sitemap.xml")}\n`, { status: 200, headers: { "content-type": "text/plain" } });
    return null;
  });
  await sitemapMod.refreshSitemap();
  xml = urlset([]);
  let threw = "";
  try {
    await sitemapMod.refreshSitemap();
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  const keptRead = sitemapMod.lastSitemap();
  check("an empty urlset answering 200 is a failed read, not an unlisted site", threw !== "" && keptRead?.entries.length === 3 && Boolean(keptRead.entriesAt), threw);
  check("it writes no \"Sitemap changed\" line", store.activity(20, ["sitemap"]).length === 0);
  xml = "<urlset><url><loc>not well formed</urlset";
  threw = "";
  try {
    await sitemapMod.refreshSitemap();
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  check("nor does XML that does not parse", threw !== "" && sitemapMod.lastSitemap()?.entries.length === 3, threw);
  db.exec("DELETE FROM cc_cache");
  xml = urlset([]);
  let crawlSaid = "";
  try {
    await crawlMod.crawl();
  } catch (e) {
    crawlSaid = e instanceof Error ? e.message : String(e);
  }
  check("the crawl refuses an empty list rather than call every page gone", crawlSaid !== "" && (db.prepare("SELECT COUNT(*) AS n FROM cc_pages").get() as { n: number }).n === 0, crawlSaid);
  clean();

  /* A request for a job, made again until the job has done it, at most hourly. */
  let ran = 0;
  register({ name: "specimen-ask", title: "Specimen job for the check", every: 365 * 86_400, delay: 0, run: async () => void ran++ });
  const a1 = askFor("specimen-ask", "print-1");
  const a2 = askFor("specimen-ask", "print-1");
  const a3 = askFor("specimen-ask", "print-2");
  check("askFor: asks, does not ask again for the same thing within the hour, asks at once for a new one", a1 && !a2 && a3, `${a1} ${a2} ${a3}`);
  clean();

  /* PageSpeed: the headline is the newest sweep, never all history. Specimen rows. */
  const put = db.prepare("INSERT INTO cc_vitals (at, day, path, strategy, performance, lcp_ms, cls, tbt_ms, fcp_ms, si_ms, origin_field, lighthouse) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
  for (const p of ["/specimen-gone-a", "/specimen-gone-b"]) put.run(old, store.today(-90), p, "mobile", 10, 9000, 0.5, 2000, 5000, 9000, null, "specimen");
  const fresh = new Date().toISOString();
  for (const [i, p] of ["/", "/specimen-x", "/specimen-y"].entries()) put.run(fresh, store.today(), p, "mobile", 90, 1000 + i * 100, 0.01, 100, 900, 1500, null, "specimen");
  const lcp = psi.vital("lcp", "mobile");
  check("lab LCP is the median of the newest sweep's pages only", lcp.state === "ok" && lcp.value.pages === 3 && lcp.value.value === 1100, lcp.state === "ok" ? `${lcp.value.value} ms over ${lcp.value.pages} pages` : lcp.reason);
  const runs = psi.labRuns("mobile");
  check("the run list holds no page from an older sweep", runs.state === "ok" && runs.value.length === 3 && !runs.value.some((r) => r.path.startsWith("/specimen-gone")));
  const scores = psi.labScores("mobile");
  check("Lighthouse's scores count the newest sweep's pages only", scores.state === "ok" && scores.value.pages === 3 && scores.value.performance === 90);
  check("a desktop lab FCP of 1700 ms is poor by Lighthouse's desktop bands, good by the mobile ones", psi.rate("fcp", 1700, { kind: "lab", strategy: "desktop" }) === "poor" && psi.rate("fcp", 1700, { kind: "lab", strategy: "mobile" }) === "good");
  clean();

  /* PageSpeed refused before measuring: a failed run, and never "connected". */
  stub((url) => (url.startsWith("https://pagespeedonline.googleapis.com/") ? new Response(JSON.stringify({ error: { code: 429, message: "Specimen quota sentence" } }), { status: 429, headers: { "content-type": "application/json" } }) : null));
  store.setState("site:ok:speed", new Date().toISOString());
  let speedSaid = "";
  try {
    await psi.speedJob.run({ progress: () => {} });
  } catch (e) {
    speedSaid = e instanceof Error ? e.message : String(e);
  }
  check("a sweep refused before its first page is a failed run", /^Nothing measured/.test(speedSaid), speedSaid);
  check("and the job then waits 24 hours as not ready, neither running nor failing", psi.speedJob.ready?.() === false && psi.speedPausedUntil() !== null);
  const source = sources().find((s) => s.id === "psi");
  const keyless = !process.env.GOOGLE_API_KEY;
  check(
    "PageSpeed is not reported connected, nor answered at a time it measured nothing",
    source !== undefined && source.lastOk === null && source.state === (keyless ? "off" : "waiting") && (!keyless || Boolean(source.step)),
    source ? `${source.state}, last answered ${source.lastOk}` : "no report",
  );
  clean();
  const stoppedYesterday = JSON.stringify({ said: "Specimen quota sentence", keyed: false, measuredBefore: 0, at: new Date(Date.now() - 25 * 3_600_000).toISOString() });
  store.setState("psi:stopped", store.today(-1));
  store.setState("psi:stopped:said", stoppedYesterday);
  store.setState("site:ok:speed", new Date().toISOString());
  const after = sources().find((s) => s.id === "psi");
  check("nor after midnight, once the pause is over", after?.lastOk === null && after.state !== "connected" && psi.speedJob.ready?.() === true, after ? `${after.state}, last answered ${after.lastOk}` : "no report");
  clean();

  /* The long response-time ranges: real counts, and no percentile of medians. */
  for (const d of [3, 2, 1]) {
    store.record("response.home.ttfb", 100 + d, store.today(-d));
    store.record("uptime.checks", 720, store.today(-d));
    store.record("uptime.failed", d, store.today(-d));
  }
  store.setState("probe:last", String(Date.now()));
  const long = probes.responseTimes("90d");
  check(
    "90 days: each day carries the checks it is the median of, and there is no 95th percentile",
    long.state === "ok" && long.value.p95TtfbMs === null && long.value.points.every((p, i) => p.checks === 720 - (3 - i)),
    long.state === "ok" ? long.value.points.map((p) => `${p.at} ${p.checks}`).join(", ") : long.reason,
  );
  clean();
}

/* Nothing here runs git in, or names, the publisher's working tree. */
{
  const siteDir = path.join(root, "src", "cc", "site");
  const offenders = readdirSync(siteDir)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => /process\.env\.SITE_REPO\b|env\[["']SITE_REPO["']\]/.test(readFileSync(path.join(siteDir, f), "utf8")));
  check("no file in src/cc/site reads SITE_REPO", offenders.length === 0, offenders.join(", "));
  const repoSrc = readFileSync(path.join(siteDir, "repo.ts"), "utf8");
  check("every git call names its own --git-dir and none sets a working directory", /"--git-dir", DIR\(\)/.test(repoSrc) && !/\bcwd\s*:/.test(repoSrc));
}

/* ---------- part two: each job once, against the real site ---------------------- */

if (RULES_ONLY) {
  finish();
} else {
  await liveRun();
  finish();
}

async function liveRun(): Promise<void> {
  const site = await import("../src/cc/site/index.ts");
  const { probeJob } = await import("../src/cc/site/probes.ts");
  const { fetchRepo } = await import("../src/cc/site/repo.ts");
  const { refreshSitemap } = await import("../src/cc/site/sitemap.ts");
  const { scanAssets } = await import("../src/cc/site/assets.ts");
  const { sweep } = await import("../src/cc/site/psi.ts");
  const { activity } = await import("../src/cc/store.ts");

  section(`Each job once, against ${process.env.SITE_BASE}, into ${path.relative(root, dir)}`);
  check("the check writes to its own database, not the dev one", path.resolve(String(process.env.DESK_DB)).startsWith(dir));

  /* The read copy missing, with making it switched off: a plain failure. */
  {
    const real = process.env.SITE_READ_REPO;
    process.env.SITE_READ_REPO = path.join(dir, "no-such-copy.git");
    let said = "";
    try {
      await fetchRepo();
    } catch (e) {
      said = e instanceof Error ? e.message : String(e);
    }
    check("a missing read copy is a failed run with a plain message, never a clone here", /switched off/.test(said), said);
    check("without a read copy the repository's readings are off, with the step", site.deployments().state === "off" && (await site.structure()) === null);
    if (real === undefined) delete process.env.SITE_READ_REPO;
    else process.env.SITE_READ_REPO = real;
  }

  /* probe */
  const probe = await timed("probe", () => probeJob.run({ progress: () => {} }));
  const latest = site.latest();
  if (latest.state === "ok") {
    for (const s of latest.value) console.log(`    ${s.target.padEnd(9)} ${String(s.status).padEnd(4)} ${String(s.ttfbMs ?? "-").padStart(5)} ms first byte  cache ${s.cache ?? "-"}  edge ${s.region ?? "-"}${s.functionRegion ? `  function ${s.functionRegion}` : ""}${s.failure ? `  ${s.failure}` : ""}`);
  }
  check("probe: every target answered what it should", probe.error === null && latest.state === "ok" && latest.value.every((s) => s.ok), probe.value ?? probe.error ?? "");
  const fnp = site.functionProbe();
  check("probe: the function probe reached a function and was turned away (405), as it should be", fnp.state === "ok" && fnp.value.status === 405 && fnp.value.functionRegion !== null, fnp.state === "ok" ? `${fnp.value.status}, function in ${fnp.value.functionRegion}` : fnp.reason);
  const cert = site.certificate();
  check("probe: the certificates were read", cert.state === "ok" && cert.value.every((c) => c.daysLeft !== null && c.trusted), cert.state === "ok" ? cert.value.map((c) => `${c.host} ${c.daysLeft} days`).join(", ") : cert.reason);
  const dns = site.dns();
  check(
    "probe: DNS answered for both host names",
    dns.state === "ok" && dns.value.every((d) => d.problem === null && d.a.length + d.aaaa.length > 0),
    dns.state === "ok" ? dns.value.map((d) => `${d.host}: ${d.problem ?? `${d.a.length + d.aaaa.length} addresses`}${d.cname.length ? `, alias of ${d.cname[0]}` : ""}, by the ${d.via === "system" ? "system's lookup" : "named DNS servers"}`).join("; ") : dns.reason,
  );
  check("probe: uptime has a figure after one round", site.uptime("24h").state === "ok");

  /* repo */
  const repo = await timed("repo", () => fetchRepo());
  if (repo.value) console.log(`    at ${repo.value.head.slice(0, 7)}, ${repo.value.fresh.length} commits recorded`);
  check("repo: fetched into the desk's own ref and recorded the history", repo.error === null && (repo.value?.fresh.length ?? 0) > 0, repo.error ?? "");
  const notes = activity(100, ["deploy", "insight"]);
  check("repo: the first fetch speaks about the last fortnight only, twenty lines at most", notes.length <= 20, `${notes.length} lines`);
  const again = await timed("repo, again", () => fetchRepo());
  check("repo: a second fetch finds nothing new and writes nothing twice", again.value?.fresh.length === 0 && activity(100, ["deploy", "insight"]).length === notes.length);
  const versions = await site.siteVersions().catch((e: unknown) => String(e));
  console.log(`    the website declares ${typeof versions === "string" ? versions : `next ${versions.next.declared} (installs ${versions.next.installed}), react ${versions.react.declared} (installs ${versions.react.installed})`}`);
  check("repo: the framework versions are read from the website's own package files", typeof versions !== "string" && versions.next.installed !== null && versions.react.declared !== null);
  const changed = await site.lastChange("public/og");
  check("repo: the last change under a folder has a time and an author", Boolean(changed?.at && changed.author), changed ? `${changed.at.slice(0, 10)} by ${changed.author}` : "none");
  const shape = await site.structure();
  console.log(`    the website's source: ${shape?.routes.length ?? 0} fixed routes, ${shape?.roster.length ?? 0} marketing pages, ${shape?.redirects.length ?? 0} redirects (${shape?.redirects.filter((r) => r.by === "desk").length ?? 0} approved on the desk), ${shape?.unlisted.length ?? 0} unlisted articles, default share picture ${shape?.defaultShare}`);
  check("repo: the website's structure is read", Boolean(shape && shape.routes.length && shape.roster.length && shape.redirects.length && shape.defaultShare));

  /* sitemap */
  const map = await timed("sitemap", () => refreshSitemap());
  if (map.value) console.log(`    ${map.value.read.entries.length} addresses, ${map.value.read.entries.filter((e) => e.lastmod).length} with a lastmod, robots.txt: ${map.value.read.robots.rules} rules for every crawler, sitemap named: ${map.value.read.robots.sitemaps.join(", ")}`);
  for (const i of map.value?.read.issues ?? []) console.log(`    ${i.severity}: ${i.text}`);
  check("sitemap: read and valid", map.error === null && (map.value?.read.entries.length ?? 0) > 0 && !map.value?.read.issues.some((i) => i.severity === "critical"));

  /* crawl: the one full crawl of this run */
  let lastProgress = 0;
  const before = process.memoryUsage().rss;
  const crawl = await timed("crawl", () =>
    site.crawl((done, of) => {
      if (done - lastProgress >= 25 || done === of) {
        lastProgress = done;
        console.log(`    ${done} of ${of} pages, ${mb(process.memoryUsage().rss)} now`);
      }
    }),
  );
  const s = crawl.value;
  if (s) {
    console.log(`    ${s.pages} pages (${s.inSitemap} in the sitemap, ${s.outsideSitemap} kept out of it) in ${s.seconds} s; score ${s.siteScore}; ${s.issues.critical} critical, ${s.issues.warning} warnings, ${s.issues.opportunity} opportunities`);
    console.log(`    links: ${s.links.internal} internal, ${s.links.external} external; ${s.links.targetsChecked} other addresses on the site asked, ${s.links.externalChecked} outside addresses asked`);
  }
  check("crawl: finished, with the repository's pages beside the sitemap's", crawl.error === null && Boolean(s && s.pages > s.inSitemap && !s.withoutRepo), crawl.error ?? "");
  /* What the crawl itself adds is what matters on the box, where the desk
     starts lower than this script does. On the workstation V8 sizes its heap
     from the machine's memory and collects late, so this is an upper bound;
     the box caps the heap (NODE_OPTIONS in deploy/balkaris-desk.service). */
  check(`crawl: adds under 200 MB to the process, and the process stays under 450 MB`, crawl.peak - before < 200 * 1_048_576 && crawl.peak < 450 * 1_048_576, `${mb(before)} before, peak ${mb(crawl.peak)}, so ${mb(crawl.peak - before)} added`);
  const kinds = site.kinds();
  if (kinds.state === "ok") console.log(`    kinds: ${kinds.value.map((k) => `${k.label} ${k.value}`).join(", ")}`);
  const counts = site.issueCounts();
  if (counts.state === "ok") for (const r of counts.value.byRule) console.log(`    ${r.severity.padEnd(11)} ${String(r.count).padStart(3)}  ${r.title} (${r.rule}, costs ${r.cost})`);
  const inv = site.inventory();
  /* Scored: in the sitemap, and either read or not answering 200 (a page that answered and was not read has none). */
  check("crawl: every page has a kind, and a score exactly when it is in the sitemap and was judged", inv.state === "ok" && inv.value.every((p) => p.kind && (p.inSitemap && (p.status !== 200 || p.words !== null) ? p.score !== null : p.score === null)));
  const unreadable = site.issues({ rule: "page.unreadable" });
  if (unreadable.state === "ok") for (const u of unreadable.value) console.log(`    unreadable: ${u.path}: ${u.text}`);
  const externalMid = db.prepare("SELECT COUNT(*) AS n FROM cc_targets WHERE internal = 0 AND status BETWEEN 300 AND 399").get() as { n: number };
  check("crawl: an outside link's status is its final answer, never the redirect on the way", externalMid.n === 0, `${externalMid.n} outside targets stored with a 3xx`);
  const homeFacts = site.page("/");
  const homeIssues = site.issues({ path: "/" });
  check(
    "crawl: the live home page's canonical is not reported against its sitemap address",
    homeIssues.state === "ok" && !homeIssues.value.some((i) => i.rule.startsWith("canonical")),
    homeFacts.state === "ok" ? `canonical ${homeFacts.value.facts?.canonical}, sitemap ${site.lastSitemap()?.entries.find((e) => e.path === "/")?.loc}` : "",
  );
  const redirects = site.redirects();
  if (redirects.state === "ok") {
    const by = (o: string) => redirects.value.filter((r) => r.outcome === o).length;
    console.log(`    redirects: ${redirects.value.length} tried, ${by("ok")} ok, ${by("chain")} chained, ${by("broken")} broken, ${by("untested")} untested`);
    for (const r of redirects.value.filter((x) => x.outcome !== "ok")) console.log(`      ${r.outcome}: ${r.source} → ${r.destination}: ${r.remark}`);
  }
  check("crawl: every redirect the site promises was tried", redirects.state === "ok" && redirects.value.length > 1);
  const orphans = site.orphans();
  const broken = site.brokenLinks();
  const ext = site.externalLinks("broken");
  const unchecked = site.externalLinks("unchecked");
  console.log(`    orphans ${orphans.state === "ok" ? orphans.value.length : "?"}, broken internal links ${broken.state === "ok" ? broken.value.length : "?"}, outside links gone ${ext.state === "ok" ? ext.value.length : "?"}, outside links that would not say ${unchecked.state === "ok" ? unchecked.value.length : "?"}`);
  const score = site.siteScore();
  check("crawl: the day's score, page count and issue counts are in the history", score.state === "ok" && site.pageCount().state === "ok" && site.issueTrend("critical").state === "ok");
  const hits = site.searchPages("insights");
  check("search: pages are found by address and title", hits.length > 0, hits.slice(0, 2).map((h) => h.title).join(" | "));

  /* assets */
  const assets = await timed("assets", () => scanAssets());
  if (assets.value) console.log(`    ${assets.value.files} files, ${mb(assets.value.bytes)}, ${assets.value.measured} pictures measured, ${assets.value.unreadable} unreadable`);
  check("assets: every file in public/ listed and the pictures measured", assets.error === null && (assets.value?.files ?? 0) > 0 && (assets.value?.measured ?? 0) > 0, assets.error ?? "");
  const totals = site.assetTotals();
  if (totals.state === "ok") {
    const t = totals.value;
    console.log(`    by kind: ${t.byKind.map((k) => `${k.label} ${k.value} (${mb(k.bytes)})`).join(", ")}`);
    console.log(`    flags: ${Object.entries(t.flagged).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    console.log(`    <img> uses: ${t.alt.written} with alt text, ${t.alt.empty} alt="" (decoration), ${t.alt.absent} with no alt attribute; ${t.decorativeEverywhere} files decorative everywhere`);
  }
  const folders = site.folders();
  if (folders.state === "ok") {
    console.log(`    folders served without a browser cache: ${folders.value.filter((f) => f.cacheControl !== null && f.maxAge === 0).map((f) => f.folder).join(", ") || "none"}`);
    const unknown = folders.value.filter((f) => f.cacheControl === null);
    if (unknown.length) console.log(`    folders whose caching is not known (no 200 with a Cache-Control): ${unknown.map((f) => `${f.folder} (${f.status || "no answer"})`).join(", ")}`);
  }
  const remote = site.remoteImages();
  if (remote.state === "ok") console.log(`    pictures from other hosts: ${remote.value.length} (${[...new Set(remote.value.map((r) => r.host))].join(", ")})`);
  const shares = site.sharePictures();
  check("assets: every crawled page's share picture is known", shares.state === "ok" && shares.value.length === (inv.state === "ok" ? inv.value.filter((p) => p.status === 200).length : -1));
  const again2 = await timed("assets, again", () => scanAssets());
  check("assets: a second scan measures nothing again (pictures are remembered by blob id)", again2.value?.measured === 0, `${again2.value?.measured} measured`);

  /* speed */
  const speed = await timed(`speed (${process.env.CC_PSI_PAGES ? `pages ${process.env.CC_PSI_PAGES}` : "the whole list"})`, () => sweep());
  if (speed.value) console.log(`    ${speed.value.runs} runs, ${speed.value.failed} failed${speed.value.stopped ? `, stopped: ${site.speedQuota()?.said}` : ""}; field data: ${speed.value.runs > speed.value.failed ? (speed.value.hasField ? "yes" : "none") : "not known"}`);
  const lab = site.vital("lcp", "mobile");
  const inp = site.vital("inp", "mobile");
  console.log(`    LCP (mobile): ${lab.state === "ok" ? `${Math.round(lab.value.value)} ms, ${lab.value.kind}` : `${lab.state}: ${lab.reason}`}`);
  console.log(`    INP (mobile): ${inp.state === "ok" ? `${inp.value.value} ms, ${inp.value.kind}` : `${inp.state}: ${inp.reason}`}`);
  check("speed: the job ran to an honest end (measured, or stopped by Google's quota and said so)", speed.error === null && Boolean(speed.value && (speed.value.runs > speed.value.failed || speed.value.stopped)), speed.error ?? "");
  check("speed: INP is never a lab figure", inp.state !== "ok" || inp.value.kind === "field");

  /* The desk's own server. */
  const box = site.box();
  if (box.state === "ok") console.log(`    the desk's server (this machine here): ${box.value.cpus} CPUs, ${mb(box.value.memory.available)} of ${mb(box.value.memory.total)} free, node ${box.value.process.node}`);
  check("box: the desk's own server is labelled as the desk's", box.state === "ok" && box.value.of === "desk");

  console.log(`\n  rows written: ${(["cc_pages", "cc_links", "cc_targets", "cc_issues", "cc_assets", "cc_probes", "cc_commits", "cc_vitals", "cc_activity"] as const).map((t) => `${t} ${(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n}`).join(", ")}`);
}

function finish(): never {
  clearInterval(sampler);
  console.log(`\n${passed} passed, ${failed} failed. Peak memory of the whole run: ${mb(Math.max(peakAll, process.memoryUsage().rss))}.`);
  db.close();
  if (!KEEP) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      console.log(`  (the throwaway database is still open; remove ${path.relative(root, dir)} by hand)`);
    }
  } else console.log(`  kept: ${path.relative(root, dir)}`);
  process.exit(failed ? 1 : 0);
}
