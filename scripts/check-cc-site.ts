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
 * The spider's parts the same way: duplicate content (the md5 of the own
 * text, the MinHash estimate against the exact share, a copy, a near copy
 * above and a looser one below the line, pages that are only template, a
 * canonical twin, shared headings, a family of eight near copies among
 * sixty pages, a page nested 1,000 deep read in one pass), custom
 * extraction (CSS, regex and the XPath subset; a bad selector, a
 * catastrophic pattern and an XPath outside the subset refused; selectors
 * and patterns that are slow on the desk's test page refused, timed in the
 * extraction thread while the desk's own keeps turning; a pattern that runs
 * too long stopped; a selector that runs past a page's deadline stopped,
 * named, and the page read again without it; a page whose parse runs past
 * it failed), redirect loops, and the audit's guard (loopback, private,
 * link-local and metadata addresses refused, written as IPs, IPv6 forms of
 * them, as names that resolve to them, and as the target of a redirect;
 * refusals cost nobody a turn of the hour, and one person's share ends at
 * ten), with DNS and the request itself replaced so nothing leaves the
 * machine. And the audit's real request against a server of the check's own
 * on 127.0.0.1:3491 (the guard is the fetch's, not the request's, so the
 * request is called directly): a gzip, deflate or brotli body that trickles,
 * one that stalls after its headers and one whose connection is reset all
 * end at the time limit or sooner.
 *
 * THEN THE BOOKKEEPING, on specimen history written into the throwaway
 * database and removed again, with `fetch` stubbed so nothing leaves the
 * machine: a headline's comparison while the history is young, a sitemap that
 * answers 200 with no address, a crawl asked for again after a restart, the
 * PageSpeed headline taken from the newest sweep only, desktop rated by
 * desktop bands, a sweep Google refuses before its first page, the long
 * response-time ranges, and two whole crawls of a five-page specimen site
 * (two pages with one text, a link into a redirect loop, the bare domain
 * redirecting to itself, four extraction rules, one of them too slow for a
 * deep page and stopped there, then switched off at the second crawl; one
 * switched off by hand keeps what it found) through the real crawl, its
 * parsing thread and its tables.
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
import { createHash } from "node:crypto";
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
const mb = (b: number) => `${Math.round(b / 1_048_576)} MB`;
const section = (title: string) => console.log(`\n${title}  [process ${mb(process.memoryUsage().rss)}, peak so far ${mb(Math.max(peakAll, process.memoryUsage().rss))}]`);

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
const { parsePage, readSchema, contentPrint, normaliseText, PRINT } = await import("../src/cc/site/parse.ts");
const { judge, judgePage, kindOf, LIMITS, RULES, redirectLoop, similarity, templatePages } = await import("../src/cc/site/rules.ts");
const extract = await import("../src/cc/site/extract.ts");
const auditMod = await import("../src/cc/site/audit.ts");
const { parseRobots, allowed, parseSitemap } = await import("../src/cc/site/sitemap.ts");
const { regionsOf } = await import("../src/cc/site/probes.ts");
const { abs } = await import("../src/cc/site/http.ts");
type PageView = import("../src/cc/site/rules.ts").PageView;
type PageKind = import("../src/cc/site/rules.ts").PageKind;
type ContentPrint = import("../src/cc/site/parse.ts").ContentPrint;

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
  /* All three share the description, the heading and the text too (the
     specimen has one of each): each page loses the cost of the duplicate
     description, heading and text; a and b the duplicate title's; c the long
     title's. */
  const want = (rules: (keyof typeof RULES)[]) => 100 - rules.reduce((s, r) => s + RULES[r].cost, 0);
  const sa = want(["title.duplicate", "description.duplicate", "h1.duplicate", "content.duplicate"]);
  const sc = want(["title.long", "description.duplicate", "h1.duplicate", "content.duplicate"]);
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

/* ---------- the spider: duplicates, extraction, loops, the audit's guard --------- */

section("Duplicate content, on a specimen site");

/** `n` made-up words from a seed: the same seed gives the same words, two seeds share almost none. */
function prose(seed: number, n: number): string {
  const syl = ["ka", "lo", "mi", "ra", "tu", "ve", "zo", "pe", "su", "di", "no", "fa", "ri", "go", "be", "xu", "ha", "ji", "wo", "ce"];
  let s = seed * 7919 + 13;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648);
  return Array.from({ length: n }, () => `${syl[next() % 20]}${syl[next() % 20]}${syl[next() % 20]}`).join(" ");
}
/** The same words with every `every`-th one swapped for another. */
const alter = (text: string, every: number) =>
  text
    .split(" ")
    .map((w, i) => (i % every === every - 1 ? `swapped${i}` : w))
    .join(" ");
/** The template every specimen page carries inside <main>, as the site's do: a box, a list of capabilities, a stock heading. */
const TEMPLATE = `<aside><p>Work with the specimen studio: strategy, content and technology in one place, from the first call to the last delivery, for every specimen client.</p></aside>
  <ul><li><a href="/specimen-cap-1">Specimen capability one</a></li><li><a href="/specimen-cap-2">Specimen capability two</a></li><li><a href="/specimen-cap-3">Specimen capability three</a></li></ul>
  <h2>Asked before deciding</h2><p>Every specimen answer here is the same on every specimen page of this made-up site, word for word.</p>`;
function sitePage(o: { path: string; own: string; h1?: string; h2?: string[]; robots?: string; canonical?: string }): string {
  const w = o.own ? o.own.split(" ") : [];
  const paras = Array.from({ length: Math.ceil(w.length / 60) }, (_, i) => w.slice(i * 60, i * 60 + 60));
  return `<!doctype html><html lang="en"><head><title>Specimen ${o.path}</title><meta name="description" content="Specimen ${o.path}">
    <link rel="canonical" href="${o.canonical ?? `https://www.balkaris.ch${o.path}`}">${o.robots ? `<meta name="robots" content="${o.robots}">` : ""}
    <meta property="og:title" content="Specimen"><meta property="og:image" content="https://www.balkaris.ch/og/specimen.jpg"><meta name="twitter:card" content="summary">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"Specimen"}</script></head>
    <body><nav><a href="/">Home</a> ${words(40, "menu")}</nav><main><nav aria-label="Breadcrumb"><a href="/">Home</a> Specimen trail</nav>
    <h1>${o.h1 ?? `Specimen heading for ${o.path}`}</h1>${(o.h2 ?? []).map((h) => `<h2>${h}</h2>`).join("")}${paras.map((p) => `<p>${p.join(" ")}</p>`).join("")}${TEMPLATE}</main>
    <footer>${words(20, "footer")}</footer></body></html>`;
}
const dupView = (o: Parameters<typeof sitePage>[0] & { inSitemap?: boolean }): PageView => view(o.path, sitePage(o), { inSitemap: o.inSitemap ?? true, kind: "standard" });

{
  /* The md5 is of the normalised own text: <main> without its navigation, block by block, folded. */
  const tiny = parsePage(`<html><body><nav>Menu words</nav><main><nav>Trail</nav><p>Hello,   World!</p><p>Second <a href="/x">line</a> — here.</p><form><label>Name</label></form></main></body></html>`, abs("/specimen-tiny")).facts.content;
  const wantText = "hello world\nsecond line here";
  check("the own text's md5 is the md5 of the normalised text of <main>, without its navigation and forms", tiny?.md5 === createHash("md5").update(wantText).digest("hex") && tiny.words === 5, `${tiny?.md5} for ${tiny?.words} words`);
  check("each block is listed with its words", tiny?.blocks.length === 2 && tiny.blocks[1]?.[1] === 3, JSON.stringify(tiny?.blocks));

  /* The MinHash estimate. */
  const shingles = (t: string) => {
    const w = normaliseText(t).split(" ");
    return new Set(w.length < PRINT.shingle ? [w.join(" ")] : Array.from({ length: w.length - PRINT.shingle + 1 }, (_, i) => w.slice(i, i + PRINT.shingle).join(" ")));
  };
  const jaccard = (a: string, b: string) => {
    const A = shingles(a);
    const B = shingles(b);
    const both = [...A].filter((x) => B.has(x)).length;
    return both / (A.size + B.size - both);
  };
  const shortA = prose(1, 60);
  const shortB = alter(shortA, 9);
  const exactShort = similarity(contentPrint([normaliseText(shortA)]), contentPrint([normaliseText(shortB)]));
  check("two pages short enough to be kept whole are compared exactly", Math.abs(exactShort.value - jaccard(shortA, shortB)) < 1e-9, `${exactShort.value.toFixed(3)} against ${jaccard(shortA, shortB).toFixed(3)}`);
  const longA = prose(2, 2000);
  const longB = alter(longA, 40);
  const est = similarity(contentPrint([normaliseText(longA)]), contentPrint([normaliseText(longB)]));
  check("for long pages the bottom-k sketch estimates the share of shingles within 0.08", Math.abs(est.value - jaccard(longA, longB)) < 0.08, `estimated ${est.value.toFixed(3)}, exact ${jaccard(longA, longB).toFixed(3)}, from ${est.sample} hashes`);

  /* A specimen site: every page carries the template; six fillers make it the site's. */
  const near = prose(30, 320);
  const loose = prose(40, 300);
  const pages: PageView[] = [
    ...Array.from({ length: 6 }, (_, i) => dupView({ path: `/specimen-fill-${i}`, own: prose(100 + i, 300) })),
    /* A copy is a copy heading and all. */
    dupView({ path: "/specimen-copy-a", own: prose(20, 300), h1: "Specimen copy" }),
    dupView({ path: "/specimen-copy-b", own: prose(20, 300), h1: "Specimen copy" }),
    dupView({ path: "/specimen-near-a", own: near }),
    dupView({ path: "/specimen-near-b", own: alter(near, 80) }),
    dupView({ path: "/specimen-far-a", own: loose }),
    dupView({ path: "/specimen-far-b", own: `${loose.split(" ").slice(0, 150).join(" ")} ${prose(41, 150)}` }),
    /* Nothing of their own but a two-word heading: the template (about 56 words) would make them copies if it counted. */
    dupView({ path: "/specimen-bare-a", own: "", h1: "Specimen bare" }),
    dupView({ path: "/specimen-bare-b", own: "", h1: "Specimen bare" }),
    dupView({ path: "/specimen-solo", own: prose(50, 300), h1: "Specimen solo" }),
    dupView({ path: "/specimen-solo-twin", own: prose(50, 300), h1: "Specimen solo", robots: "noindex", canonical: "https://www.balkaris.ch/specimen-solo", inSitemap: false }),
    dupView({ path: "/specimen-solo-copy", own: prose(50, 300), h1: "Specimen solo", canonical: "https://www.balkaris.ch/specimen-solo" }),
    dupView({ path: "/specimen-h1-a", own: prose(60, 300), h1: "Specimen heading, shared!" }),
    dupView({ path: "/specimen-h1-b", own: prose(61, 300), h1: "specimen  heading shared" }),
    dupView({ path: "/specimen-h2-a", own: prose(70, 300), h2: ["Specimen outline one", "Specimen outline two", "Specimen outline three"] }),
    dupView({ path: "/specimen-h2-b", own: prose(71, 300), h2: ["Specimen outline three", "Specimen outline one", "Specimen outline two"] }),
    dupView({ path: "/specimen-h2-c", own: prose(72, 300), h2: ["Specimen pair five", "Specimen pair six"] }),
    dupView({ path: "/specimen-h2-d", own: prose(73, 300), h2: ["Specimen pair six", "Specimen pair five"] }),
  ];
  const verdict = judge(pages, [], null);
  const on = (rule: string, path: string) => verdict.issues.filter((i) => i.rule === rule && i.path === path);
  const exact = on("content.duplicate", "/specimen-copy-a")[0];
  check("an exact copy is content.duplicate on both pages, each naming the other", exact?.related?.[0] === "/specimen-copy-b" && on("content.duplicate", "/specimen-copy-b")[0]?.related?.[0] === "/specimen-copy-a", exact?.text);
  check("an exact copy is not also reported as a near one", on("content.near-duplicate", "/specimen-copy-a").length === 0);
  const nearHit = on("content.near-duplicate", "/specimen-near-a")[0];
  check(
    `a page with one word in eighty changed is a near duplicate, with its similarity (at or above ${LIMITS.nearDuplicate})`,
    nearHit !== undefined && typeof nearHit.measured === "number" && nearHit.measured >= LIMITS.nearDuplicate && nearHit.related?.[0] === "/specimen-near-b" && nearHit.limit === LIMITS.nearDuplicate,
    nearHit?.text,
  );
  const farPair = similarity(pages.find((p) => p.path === "/specimen-far-a")?.facts?.content as ContentPrint, pages.find((p) => p.path === "/specimen-far-b")?.facts?.content as ContentPrint);
  check(`two pages sharing half their text (${farPair.value.toFixed(2)}) are below the line and not flagged`, farPair.value < LIMITS.nearDuplicate && on("content.near-duplicate", "/specimen-far-a").length === 0);
  const bareA = pages.find((p) => p.path === "/specimen-bare-a")?.facts?.content;
  const bareB = pages.find((p) => p.path === "/specimen-bare-b")?.facts?.content;
  check(
    "two pages that hold only the site's template share an md5 and are still not flagged",
    bareA?.md5 === bareB?.md5 && !verdict.issues.some((i) => i.path?.startsWith("/specimen-bare") && i.rule.startsWith("content.") && i.rule !== "content.thin"),
    `template on ≥ ${templatePages(pages.length)} other pages`,
  );
  check("no page is flagged against itself", !verdict.issues.some((i) => i.rule.startsWith("content.") && i.related?.includes(i.path ?? "")));
  check(
    "a noindex twin that names a page as its canonical, and an indexable one that does, are never its duplicates",
    !verdict.issues.some((i) => (i.rule === "content.duplicate" || i.rule === "content.near-duplicate") && (i.path?.startsWith("/specimen-solo") || i.related?.some((r) => r.startsWith("/specimen-solo")))),
    verdict.issues.filter((i) => i.path?.startsWith("/specimen-solo")).map((i) => `${i.path} ${i.rule}`).join(", "),
  );
  check("the fillers, alike only in the template, flag nothing", !verdict.issues.some((i) => i.path?.startsWith("/specimen-fill") && /duplicate/.test(i.rule)), verdict.issues.filter((i) => i.path?.startsWith("/specimen-fill") && /duplicate/.test(i.rule)).map((i) => i.rule).join(", "));
  const h1 = on("h1.duplicate", "/specimen-h1-a")[0];
  check("one <h1> on two pages, case and punctuation aside, is h1.duplicate on both", h1?.related?.[0] === "/specimen-h1-b" && on("h1.duplicate", "/specimen-h1-b").length === 1, h1?.text);
  check(
    "pages with headings of their own share none, and a canonical twin's shared heading is not held against it",
    verdict.issues.filter((i) => i.rule === "h1.duplicate").every((i) => /^\/specimen-(h1|copy|bare)-/.test(i.path ?? "")),
    verdict.issues.filter((i) => i.rule === "h1.duplicate").map((i) => i.path).join(", "),
  );
  check("three own subheadings in any order on two pages are h2.duplicate; the template one does not count", on("h2.duplicate", "/specimen-h2-a")[0]?.related?.[0] === "/specimen-h2-b" && on("h2.duplicate", "/specimen-h2-b").length === 1);
  check(`two shared subheadings are a format, not a copy (fewer than ${LIMITS.h2SetMin})`, on("h2.duplicate", "/specimen-h2-c").length === 0 && on("h2.duplicate", "/specimen-h2-d").length === 0);
  check("a page with only the template's subheading has no h2 finding", on("h2.duplicate", "/specimen-fill-0").length === 0);
  /* The value a near finding carries is the share of five-word runs with the template left out, as similarity() computes it. */
  const templateHere = (h: string) => {
    const n = pages.filter((p) => p.path !== "/specimen-near-a" && p.path !== "/specimen-near-b" && p.facts?.content?.blocks.some(([b]) => b === h)).length;
    return n >= templatePages(pages.length);
  };
  const wantNear = similarity(pages.find((p) => p.path === "/specimen-near-a")?.facts?.content as ContentPrint, pages.find((p) => p.path === "/specimen-near-b")?.facts?.content as ContentPrint, templateHere).value;
  check("the similarity a near finding reports is the share with the template left out", nearHit?.measured === Math.round(wantNear * 100) / 100, `${nearHit?.measured} against ${wantNear.toFixed(3)}`);

  /* A family: eight pages made from one set of paragraphs (300 words each, 25 of their own: about 90 % alike), among sixty
     pages of their own. Those paragraphs stand on more pages than the template line (5 %: 4 of 68), and still are not template. */
  const familyText = prose(80, 300);
  const famSite: PageView[] = [];
  /* One page at a time, with a turn of the event loop after each: a closed jsdom window is only let go of then. */
  for (let i = 0; i < 68; i++) {
    famSite.push(i < 60 ? dupView({ path: `/specimen-own-${i}`, own: prose(400 + i, 250 + (i % 7) * 10) }) : dupView({ path: `/specimen-family-${i - 60}`, own: `${prose(500 + i, 25)} ${familyText}` }));
    await new Promise((r) => setImmediate(r));
  }
  const famVerdict = judge(famSite, [], null);
  const famNear = famVerdict.issues.filter((i) => i.rule === "content.near-duplicate");
  check(
    `a family of eight near copies is found whole (8 × 7 = 56 findings), though its paragraphs stand on more than ${templatePages(famSite.length)} other pages`,
    famNear.length === 56 && famNear.every((i) => i.path?.startsWith("/specimen-family-") && i.related?.[0]?.startsWith("/specimen-family-") && (i.measured as number) >= LIMITS.nearDuplicate),
    `${famNear.length} findings, ${[...new Set(famNear.map((i) => i.measured))].slice(0, 4).join(", ")}`,
  );
  check("and the sixty pages of their own, alike only in the template, flag nothing", !famVerdict.issues.some((i) => i.path?.startsWith("/specimen-own-") && /^content\.(near-)?duplicate$/.test(i.rule)));

  /* Deep nesting: the own text is read in one pass, not one step per ancestor of every text node. */
  const { JSDOM } = await import("jsdom");
  const nested = `<!doctype html><html><body><main>${"<div>a".repeat(1000)}</main></body></html>`;
  let t = performance.now();
  new JSDOM(nested).window.close();
  const jsdomMs = performance.now() - t;
  t = performance.now();
  const nestedFacts = parsePage(nested, abs("/specimen-nested")).facts;
  const parseMs = performance.now() - t;
  check(
    "a page nested 1,000 deep is read in about the time jsdom takes to build it",
    nestedFacts.words === 1000 && nestedFacts.content?.words === 1000 && parseMs < jsdomMs * 2 + 500,
    `jsdom ${Math.round(jsdomMs)} ms, the whole read ${Math.round(parseMs)} ms`,
  );
}

section("Custom extraction");

{
  const ok = (r: ReturnType<typeof extract.validateRule>) => r.ok;
  const why = (r: ReturnType<typeof extract.validateRule>) => (r.ok ? "accepted" : r.reason);
  const v = extract.validateRule;
  check("css: a selector is accepted", ok(v({ name: "Prices", kind: "css", expression: "span.price", attribute: null })));
  const badCss = v({ name: "Broken", kind: "css", expression: "div[data-x=", attribute: null });
  check("css: a selector the parser rejects is refused, with the reason", !badCss.ok && /not valid/.test(why(badCss)), why(badCss));
  check("regex: a pattern with a group to keep is accepted", ok(v({ name: "Price", kind: "regex", expression: "/price: (\\d+)/i", attribute: "1" })));
  const nested = v({ name: "Bad", kind: "regex", expression: "(a+)+$", attribute: null });
  check("regex: nested unbounded repetition is refused as catastrophic, with the reason", !nested.ok && /catastrophic/.test(why(nested)), why(nested));
  const nested2 = v({ name: "Bad", kind: "regex", expression: "^(\\w+\\s?)*$", attribute: null });
  check("regex: (\\w+\\s?)* is refused the same way", !nested2.ok && /catastrophic/.test(why(nested2)), why(nested2));

  /* Timing, in the extraction thread. The desk's own thread must keep turning meanwhile: a timer that should fire every 20 ms is counted. */
  const trial = async (kind: "css" | "regex" | "xpath", expression: string) => {
    let ticks = 0;
    const beat = setInterval(() => ticks++, 20);
    const t = performance.now();
    const r = await extract.trialRule({ kind, expression });
    const ms = performance.now() - t;
    clearInterval(beat);
    return { r, ms, ticks, said: r.ok ? `accepted, ${r.ms} ms` : r.reason };
  };
  const slow = await trial("regex", "^(a|aa)+$");
  check("regex: an overlapping alternation that stalls on the test strings is refused, quickly", !slow.r.ok && /took more than/.test(slow.said) && slow.ms < 3000, `${slow.said} (${Math.round(slow.ms)} ms)`);
  for (const sel of [".price div div div div span", ".price div div div div div div span", "x * * * * * * * * * * * *"]) {
    const t = await trial("css", sel);
    check(
      `css: “${sel}” is refused for its time on the desk's test page, within ${extract.EXTRACT.trialWallMs / 1000} s, and the desk's own thread kept turning`,
      !t.r.ok && /test page/.test(t.said) && t.ms < extract.EXTRACT.trialWallMs + 1500 && t.ticks >= Math.floor(t.ms / 20 / 3),
      `${t.said.slice(0, 120)} (${Math.round(t.ms)} ms, ${t.ticks} ticks)`,
    );
  }
  const fine: [("css" | "regex" | "xpath"), string][] = [
    ["css", "span.price"],
    ["css", "main h1"],
    ["css", "ul li a"],
    ["css", "meta[property='og:type']"],
    ["css", "a[rel~=nofollow]"],
    ["css", "div.level > p.p1"],
    ["css", "main div span.s3"],
    ["xpath", "//a[@rel='nofollow']/@href"],
    ["xpath", "//div//p[2]/text()"],
    ["regex", 'data-price="(\\d+)"'],
  ];
  for (const [kind, expression] of fine) {
    const t = await trial(kind, kind === "xpath" ? ((xpathCheck(expression) as { xpath: string }).xpath ?? expression) : expression);
    check(`${kind}: “${expression}” is quick on the desk's test page and accepted`, t.r.ok, t.said);
  }
  const backref = v({ name: "Bad", kind: "regex", expression: "(\\w)\\1", attribute: null });
  check("regex: a back-reference is refused", !backref.ok && /Back-references/.test(why(backref)), why(backref));
  const noGroup = v({ name: "Bad", kind: "regex", expression: "price: \\d+", attribute: "2" });
  check("regex: a capture group that does not exist is refused", !noGroup.ok && /group 2 does not exist/.test(why(noGroup)), why(noGroup));
  const flags = v({ name: "Bad", kind: "regex", expression: "/x/y", attribute: null });
  check("regex: a flag other than i, m, s, u is refused", !flags.ok, why(flags));
  for (const x of ["//a[@rel='nofollow']/@href", "//h2/text()", '//meta[@property="og:type"]/@content', "/html/body//p[2]", "//*[contains(@class,'price')]", "//li[last()]"]) {
    const r = xpathCheck(x);
    check(`xpath: “${x}” is inside the subset`, r.ok, r.ok ? r.xpath : r.reason);
  }
  for (const x of ["//p[count(a)>1]", "//div/ancestor::section", "//a | //b", "p/a", "//p/..", "//a[@x='1' and @y='2']"]) {
    const r = v({ name: "Bad", kind: "xpath", expression: x, attribute: null });
    check(`xpath: “${x}” is refused, with the reason`, !r.ok, why(r));
  }

  /* Running them on a specimen page, in the same pass as the facts. */
  const items = Array.from({ length: 30 }, (_, i) => `<li><span class="price" data-sku="SPEC-${i}">CHF ${i}.00</span></li>`).join("");
  const page = `<!doctype html><html><head><meta property="og:type" content="specimen"></head><body><main><h1>Specimen</h1><p class="long">${"x".repeat(500)}</p><ul>${items}</ul><a rel="nofollow" href="/specimen-off">Off</a><a href="/specimen-on">On</a></main></body></html>`;
  const rules = [
    { id: 1, kind: "css" as const, expression: "span.price", attribute: null },
    { id: 2, kind: "css" as const, expression: "span.price", attribute: "data-sku" },
    { id: 3, kind: "regex" as const, expression: "/data-sku=\"(SPEC-\\d+)\"/", attribute: "1" },
    { id: 4, kind: "xpath" as const, expression: "//a[@rel='nofollow']/@href", attribute: null },
    { id: 5, kind: "xpath" as const, expression: '//meta[@property="og:type"]/@content', attribute: null },
    { id: 6, kind: "css" as const, expression: "p.long", attribute: null },
    { id: 7, kind: "xpath" as const, expression: "//h1/text()", attribute: null },
  ];
  let found: ReturnType<typeof extract.runRules> = [];
  const parsed = parsePage(page, abs("/specimen-extract"), { visit: (doc) => (found = extract.runRules(doc, page, rules)) });
  const by = (id: number) => found.find((f) => f.rule === id);
  check("css: the text of each match, the first 20 kept, all 30 counted", by(1)?.matches.length === 20 && by(1)?.matches[0] === "CHF 0.00" && by(1)?.count === 30, JSON.stringify(by(1)?.matches.slice(0, 2)));
  check("css: an attribute instead of the text", by(2)?.matches[3] === "SPEC-3");
  check("regex: the capture group, run on the HTML as served", by(3)?.matches[19] === "SPEC-19" && by(3)?.count === 30, JSON.stringify(by(3)?.matches.slice(0, 2)));
  check("xpath: an attribute of the elements a predicate picks", JSON.stringify(by(4)?.matches) === '["/specimen-off"]', JSON.stringify(by(4)));
  check("xpath: a meta tag's content in the head", by(5)?.matches[0] === "specimen");
  check("xpath: text()", by(7)?.matches[0] === "Specimen");
  check(`a value is cut at ${extract.EXTRACT.chars} characters`, by(6)?.matches[0]?.length === extract.EXTRACT.chars && by(6)?.matches[0]?.endsWith("…") === true);
  check("the facts are read in the same pass", parsed.facts.h1[0] === "Specimen");
  const t1 = performance.now();
  let stopped = "";
  try {
    extract.runRegex("(a+)+$", "", `${"a".repeat(40)}!`, null);
  } catch (e) {
    stopped = e instanceof Error ? e.message : String(e);
  }
  check(`a pattern that slips through is stopped after ${extract.EXTRACT.regexMs} ms, not left to hang`, /more than 50 ms/.test(stopped) && performance.now() - t1 < 1000, `${stopped} (${Math.round(performance.now() - t1)} ms)`);

  /* The page's deadline, short here (1.5 s; the crawl's is EXTRACT.pageMs).
     A selector that slipped past the trial (kept before it existed, say) on
     a page deeper than the test page: stopped, named, the page read again
     without it; a second page sent meanwhile is answered by a fresh thread. */
  const deepSpans = `<!doctype html><html><body><main><h1>Specimen deep</h1>${"<div><span>specimen</span>".repeat(40)}${"</div>".repeat(40)}</main></body></html>`;
  const deepRules = [
    { id: 1, kind: "css" as const, expression: "main h1", attribute: null },
    { id: 2, kind: "css" as const, expression: "x div div div div div div span", attribute: null },
    { id: 3, kind: "regex" as const, expression: "specimen", attribute: null },
  ];
  const t2 = performance.now();
  const [slowPage, nextPage] = await Promise.all([
    extract.parseWithRules(deepSpans, abs("/specimen-deep"), deepRules, undefined, 1500).catch((e: unknown) => e as Error),
    extract.parseWithRules(page, abs("/specimen-next"), [rules[0] as (typeof rules)[number]], undefined, 1500).catch((e: unknown) => e as Error),
  ]);
  const tookDeep = Math.round(performance.now() - t2);
  const sp = slowPage instanceof Error ? null : slowPage;
  const byId = (id: number) => sp?.found.find((f) => f.rule === id);
  check(
    "a selector past the page's deadline is stopped and named; the page is read again without it, and the other rules' answers stand",
    sp !== null && JSON.stringify(sp.overran) === "[2]" && /ran for more than 1\.5 seconds/.test(byId(2)?.error ?? "") && byId(1)?.matches[0] === "Specimen deep" && byId(3)?.count === 40 && sp.parsed.facts.h1[0] === "Specimen deep" && tookDeep < 6000,
    sp ? `${JSON.stringify(sp.found.map((f) => [f.rule, f.count, f.error ?? "", f.ms]))} in ${tookDeep} ms` : String(slowPage),
  );
  check("each rule's time on the page is kept", typeof byId(1)?.ms === "number" && typeof byId(3)?.ms === "number", JSON.stringify(sp?.found.map((f) => f.ms)));
  check("a page sent while the thread was stuck is answered by a fresh thread", !(nextPage instanceof Error) && nextPage.found[0]?.count === 30, nextPage instanceof Error ? nextPage.message : "");
  const deepParse = `<!doctype html><html><body><main>${"<div>a".repeat(8000)}</main></body></html>`;
  const t3 = performance.now();
  let deepSaid = "";
  try {
    await extract.parseWithRules(deepParse, abs("/specimen-nested"), [], undefined, 1500);
    deepSaid = "parsed";
  } catch (e) {
    deepSaid = e instanceof Error ? e.message : String(e);
  }
  check("a page whose parse itself runs past the deadline fails with the reason, at the deadline", /took more than 1\.5 seconds to read/.test(deepSaid) && performance.now() - t3 < 5000, `${deepSaid} (${Math.round(performance.now() - t3)} ms)`);
  await extract.closeExtractor();
}

/** The XPath subset, through the full validator (it also evaluates the expression once). */
function xpathCheck(x: string): { ok: true; xpath: string } | { ok: false; reason: string } {
  const r = extract.validateRule({ name: "Specimen", kind: "xpath", expression: x, attribute: null });
  return r.ok ? { ok: true, xpath: r.rule.expression } : r;
}

section("Redirect loops");

{
  const u = (p: string) => `https://www.balkaris.ch${p}`;
  check("A → B → A is a loop, with its hops", JSON.stringify(redirectLoop([{ url: u("/a") }, { url: u("/b") }, { url: u("/a") }, { url: u("/b") }, { url: u("/a") }], u("/b"), 308)) === JSON.stringify([u("/a"), u("/b"), u("/a")]));
  check("an address that redirects to itself is a loop", JSON.stringify(redirectLoop([{ url: u("/a") }], u("/a"), 301)) === JSON.stringify([u("/a"), u("/a")]));
  check("a chain that lands is not a loop", redirectLoop([{ url: u("/a") }, { url: u("/b") }], u("/c"), 200) === null);
  check("a chain that comes back to an address and lands there (a cookie set on the way) is not a loop", redirectLoop([{ url: u("/a") }, { url: u("/b") }], u("/a"), 200) === null);
  check("no redirect is no loop", redirectLoop([], u("/a"), 308) === null);
}

section("The audit's guard (DNS and the request replaced: nothing leaves the machine)");

{
  const { guardUrl, isPublicAddress, fetchGuarded, audit, Refused } = auditMod;
  const refusedBy = (raw: string): string => {
    try {
      guardUrl(raw);
      return "";
    } catch (e) {
      return e instanceof Refused ? e.message : `threw ${String(e)}`;
    }
  };
  for (const [raw, kind] of [
    ["http://127.0.0.1/", /loopback/],
    ["http://10.1.2.3/admin", /private network/],
    ["http://169.254.169.254/latest/meta-data/", /link-local.*metadata/],
    ["http://[::1]/", /loopback/],
    ["http://[::ffff:10.0.0.1]/", /IPv4-mapped form of a private/],
    ["http://[::ffff:0:7f00:1]/", /IPv4-translated form of a loopback/],
    ["http://[::ffff:0:a00:1]/", /IPv4-translated form of a private/],
    ["http://[::ffff:0:808:808]/", /IPv4-translated address/],
    ["http://[3fff::1]/", /documentation address \(3fff::\/20\)/],
    ["http://[fd00:ec2::254]/", /private network/],
    ["http://0x7f.1/", /loopback/],
    ["http://2130706433/", /loopback/],
    ["http://localhost/", /local or internal name/],
    ["http://metadata.google.internal/computeMetadata/v1/", /local or internal name/],
    ["http://printer/", /no dot/],
    ["ftp://example.com/", /Only http and https/],
    ["https://user:secret@example.com/", /user name or password/],
    ["https://example.com:6379/", /ports/],
  ] as [string, RegExp][]) {
    const said = refusedBy(raw);
    check(`refused: ${raw}`, kind.test(said), said || "accepted");
  }
  check("public addresses pass: 8.8.8.8, 2606:4700::1111", isPublicAddress("8.8.8.8") === null && isPublicAddress("2606:4700::1111") === null);
  check("carrier-grade NAT, NAT64 and 6to4 forms of private addresses do not", /carrier-grade/.test(isPublicAddress("100.100.100.200") ?? "") && /NAT64 form of a link-local/.test(isPublicAddress("64:ff9b::a9fe:a9fe") ?? "") && /6to4 form of a private/.test(isPublicAddress("2002:a00:1::") ?? ""));

  /* DNS and the request, replaced. */
  const names: Record<string, string[]> = {
    "public-specimen.example": ["93.184.216.34"],
    "private-specimen.example": ["10.0.0.7"],
    "mixed-specimen.example": ["93.184.216.34", "192.168.1.1"],
    "meta-specimen.example": ["169.254.169.254"],
    "dual-specimen.example": ["2606:4700::1111", "93.184.216.34"],
  };
  const resolve: import("../src/cc/site/audit.ts").Resolver = async (host) => {
    const hit = names[host];
    if (!hit) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return hit.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  const asked: { url: string; to: string; at: number }[] = [];
  const pages: Record<string, { status: number; headers: Record<string, string>; body?: string }> = {};
  const transport: import("../src/cc/site/audit.ts").Transport = async (url, to) => {
    asked.push({ url: url.toString(), to: to.address, at: Date.now() });
    const p = pages[url.toString()];
    if (!p) throw new Error(`the check's transport does not serve ${url}`);
    return { status: p.status, headers: p.headers, read: async () => ({ text: p.body ?? "", bytes: Buffer.byteLength(p.body ?? ""), truncated: false }), drop: () => {} };
  };
  const refusedFetch = async (raw: string): Promise<string> => {
    try {
      await fetchGuarded(raw, { resolve, transport });
      return "";
    } catch (e) {
      return e instanceof Refused ? e.message : `threw ${String(e)}`;
    }
  };
  check("a name that resolves to a private address is refused before any request", /resolves to 10\.0\.0\.7, a private network address/.test(await refusedFetch("https://private-specimen.example/")) && asked.length === 0);
  check("a name with one private address among public ones is refused", /192\.168\.1\.1/.test(await refusedFetch("https://mixed-specimen.example/")));
  check("a name that resolves to the metadata address is refused", /169\.254\.169\.254.*link-local/.test(await refusedFetch("http://meta-specimen.example/latest/meta-data/")));
  {
    /* A lookup that never answers counts against the fetch's time limit. (AbortSignal.timeout's timer does
       not keep a process alive; in the desk the server does, here this timer stands in for it.) */
    const alive = setTimeout(() => {}, 5000);
    const t = performance.now();
    let said = "";
    try {
      await fetchGuarded("https://silent-specimen.example/", { resolve: () => new Promise(() => {}), transport, timeoutMs: 800 });
    } catch (e) {
      said = e instanceof Refused ? e.message : `threw ${String(e)}`;
    }
    clearTimeout(alive);
    check("a name whose lookup never answers is given up at the time limit", /could not be looked up in time/.test(said) && performance.now() - t < 2000, `${said} (${Math.round(performance.now() - t)} ms)`);
  }

  pages["https://public-specimen.example/to-private"] = { status: 302, headers: { location: "http://10.0.0.1/admin" } };
  const toPrivate = await fetchGuarded("https://public-specimen.example/to-private", { resolve, transport });
  check("a redirect to a private address is not followed, and says so", /does not fetch.*10\.0\.0\.1.*private network/.test(toPrivate.error ?? "") && asked.length === 1 && asked[0]?.to === "93.184.216.34", toPrivate.error ?? "");
  pages["https://public-specimen.example/to-name"] = { status: 301, headers: { location: "http://private-specimen.example/" } };
  const toName = await fetchGuarded("https://public-specimen.example/to-name", { resolve, transport });
  check("a redirect to a name that resolves to one is not followed either", /resolves to 10\.0\.0\.7/.test(toName.error ?? "") && !asked.some((a) => a.to === "10.0.0.7"), toName.error ?? "");
  pages["https://public-specimen.example/to-local"] = { status: 307, headers: { location: "http://localhost:3400/api/v1/me" } };
  const toLocal = await fetchGuarded("https://public-specimen.example/to-local", { resolve, transport });
  check("nor a redirect to the desk itself", /does not fetch/.test(toLocal.error ?? "") && !asked.some((a) => a.url.includes("localhost")), toLocal.error ?? "");
  check("every request went to the address that was checked", asked.every((a) => a.to === "93.184.216.34"));
  let handed: import("../src/cc/site/audit.ts").Vetted | null = null;
  await fetchGuarded("https://dual-specimen.example/", {
    resolve,
    transport: async (_u, to) => {
      handed = to;
      return { status: 404, headers: {}, read: async () => ({ text: "", bytes: 0, truncated: false }), drop: () => {} };
    },
  });
  const h = handed as import("../src/cc/site/audit.ts").Vetted | null;
  check("a name with public IPv4 and IPv6 addresses: the connection is handed those, IPv4 first, and no other", h?.address === "93.184.216.34" && h.all.map((x) => x.address).join() === "93.184.216.34,2606:4700::1111", JSON.stringify(h));

  /* An audit end to end, on a specimen page behind one redirect on the same host. */
  asked.length = 0;
  pages["https://public-specimen.example/old"] = { status: 301, headers: { location: "/specimen" } };
  pages["https://public-specimen.example/specimen"] = {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "max-image-preview:large", "cache-control": "public, max-age=60" },
    body: `<!doctype html><html lang="en"><head><title>${"Specimen title ".repeat(6).trim()}</title><meta name="description" content="A specimen page."><link rel="canonical" href="https://www.public-specimen.example/specimen">
      <link rel="alternate" hreflang="de" href="/de/specimen"><meta property="og:title" content="Specimen"><meta property="og:image" content="/og.jpg"><meta name="twitter:card" content="summary">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Specimen"}</script></head>
      <body><main><h1>Specimen</h1><h2>Specimen part</h2><p>${words(300)}</p><img src="/specimen.webp"><a href="/other">Other</a><a href="https://elsewhere.example/">Out</a></main></body></html>`,
  };
  const a = await audit("https://public-specimen.example/old#top", { resolve, transport });
  const rulesSeen = a.issues.map((i) => i.rule);
  check("audit: follows the redirect and reads the page", a.status === 200 && a.finalUrl === "https://public-specimen.example/specimen" && a.redirects.length === 1 && a.url === "https://public-specimen.example/old", `${a.status} ${a.finalUrl}`);
  check("audit: the requests to one host are two seconds apart", asked.length === 2 && (asked[1]?.at ?? 0) - (asked[0]?.at ?? 0) >= 1900, asked.map((x) => x.at - (asked[0]?.at ?? 0)).join(", ") + " ms");
  check("audit: the facts the crawl reads", a.facts?.title?.startsWith("Specimen title") === true && a.facts.h2[0] === "Specimen part" && a.facts.hreflang[0]?.href === "https://public-specimen.example/de/specimen" && a.facts.schema.types.includes("Article") && a.facts.images.altAbsent === 1 && a.facts.links.internal === 1 && a.facts.links.external === 1, JSON.stringify(a.facts?.links));
  check("audit: its canonical is held against its own host, not the website's", a.issues.some((i) => i.rule === "canonical.mismatch" && /www\.public-specimen\.example; this page is on public-specimen\.example/.test(i.text)), a.issues.find((i) => i.rule === "canonical.mismatch")?.text);
  check("audit: the page rules apply, nothing that needs a whole site does", rulesSeen.includes("title.long") && rulesSeen.includes("schema.incomplete") && rulesSeen.includes("images.alt-absent") && !rulesSeen.includes("links.orphan") && !rulesSeen.includes("page.missing-from-sitemap"), rulesSeen.join(", "));
  const fired = [...new Set(a.issues.filter((i) => RULES[i.rule as keyof typeof RULES].scope === "page").map((i) => i.rule))];
  check("audit: scored as the crawl scores a page", a.score === 100 - fired.reduce((s, r) => s + RULES[r as keyof typeof RULES].cost, 0), `${a.score}`);
  check("audit: the headers that matter, and only those", a.headers["x-robots-tag"] === "max-image-preview:large" && a.headers["cache-control"] === "public, max-age=60" && !("set-cookie" in a.headers));
  const again = await audit("https://public-specimen.example/old", { resolve, transport });
  check("audit: asked again within the day, it is answered from what was kept, and the site is not asked", again.cached && asked.length === 2);
  pages["https://public-specimen.example/round"] = { status: 302, headers: { location: "/round" } };
  const round = await audit("https://public-specimen.example/round", { resolve, transport });
  check("audit: a loop is a loop", round.loop && round.issues.some((i) => i.rule === "redirect.loop") && round.facts === null, round.issues.map((i) => i.text).join(" | "));
  let refusedAudit = "";
  try {
    await audit("http://169.254.169.254/latest/meta-data/", { resolve, transport });
  } catch (e) {
    refusedAudit = e instanceof Refused ? e.message : String(e);
  }
  check("audit: the metadata address is refused outright", /link-local/.test(refusedAudit), refusedAudit);

  /* Turns of the hour: only an audit that sent a request takes one, and one person's share ends at AUDIT.perPersonHour. */
  {
    const { AUDIT, TooMany } = auditMod;
    const many: import("../src/cc/site/audit.ts").Resolver = async (host) => {
      if (/^t\d+-specimen\.example$/.test(host)) return [{ address: "93.184.216.34", family: 4 }];
      if (/^p\d+-specimen\.example$/.test(host)) return [{ address: "10.0.0.9", family: 4 }];
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    };
    const small: import("../src/cc/site/audit.ts").Transport = async () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      read: async () => ({ text: `<!doctype html><html lang="en"><head><title>Specimen</title></head><body><main><h1>Specimen</h1><p>${words(40)}</p></main></body></html>`, bytes: 100, truncated: false }),
      drop: () => {},
    });
    const outcome = async (host: string, who: string): Promise<string> => {
      try {
        await audit(`https://${host}/`, { resolve: many, transport: small, who });
        return "ok";
      } catch (e) {
        return e instanceof TooMany ? "too many" : e instanceof Refused ? "refused" : `threw ${String(e)}`;
      }
    };
    const said: string[] = [];
    for (let i = 0; i < AUDIT.perPersonHour - 1; i++) said.push(await outcome(`t${i}-specimen.example`, "specimen-person"));
    for (let i = 0; i < 3; i++) said.push(await outcome(`p${i}-specimen.example`, "specimen-person"));
    said.push(await outcome("no-such-specimen.example", "specimen-person"));
    const last = await outcome(`t${AUDIT.perPersonHour - 1}-specimen.example`, "specimen-person");
    check(
      `audit: addresses refused by the guard or the lookup take no turn: ${AUDIT.perPersonHour - 1} audits, 4 refusals, and the ${AUDIT.perPersonHour}th still goes`,
      said.slice(0, AUDIT.perPersonHour - 1).every((s) => s === "ok") && said.slice(AUDIT.perPersonHour - 1).every((s) => s === "refused") && last === "ok",
      `${said.join(", ")}; then ${last}`,
    );
    const over = await outcome(`t${AUDIT.perPersonHour}-specimen.example`, "specimen-person");
    const other = await outcome(`t${AUDIT.perPersonHour + 1}-specimen.example`, "specimen-other");
    check(`audit: one person's share ends at ${AUDIT.perPersonHour} an hour, and someone else may still ask`, over === "too many" && other === "ok", `${over}, then ${other}`);
  }
  db.exec("DELETE FROM cc_cache");
  await extract.closeExtractor();
}

section("The audit's real request, against a server of the check's own on 127.0.0.1:3491");

{
  const http = await import("node:http");
  const zlib = await import("node:zlib");
  const { nodeTransport, fetchGuarded } = auditMod;
  const PAGE = "<!doctype html><html><body><main><h1>Specimen served here</h1></main></body></html>";
  const timers = new Set<NodeJS.Timeout>();
  const server = http.createServer((req, res) => {
    const u = req.url ?? "/";
    if (u === "/gzip-whole") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(zlib.gzipSync(PAGE));
      return;
    }
    const trickle = /^\/(gzip|deflate|br)-trickle$/.exec(u);
    if (trickle) {
      const coding = trickle[1] as "gzip" | "deflate" | "br";
      const z = coding === "gzip" ? zlib.createGzip() : coding === "deflate" ? zlib.createDeflate() : zlib.createBrotliCompress();
      res.writeHead(200, { "content-type": "text/html", "content-encoding": coding });
      z.pipe(res);
      z.write("<!doctype html><html><body><main>");
      const beat = setInterval(() => {
        z.write("<p>specimen</p>");
        z.flush();
      }, 200);
      timers.add(beat);
      res.on("close", () => {
        clearInterval(beat);
        timers.delete(beat);
        z.destroy();
      });
      return;
    }
    if (u === "/gzip-stall") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.flushHeaders();
      return;
    }
    if (u === "/gzip-reset") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.write(zlib.gzipSync(PAGE.repeat(50)).subarray(0, 40));
      const cut = setTimeout(() => req.socket.destroy(), 200);
      timers.add(cut);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  let listening = "";
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(3491, "127.0.0.1", () => resolve());
    });
  } catch (e) {
    listening = e instanceof Error ? e.message : String(e);
  }
  check("the check's own server listens on 127.0.0.1:3491", listening === "", listening);
  if (!listening) {
    const local = { address: "127.0.0.1", family: 4 as const, all: [{ address: "127.0.0.1", family: 4 as const }] };
    const readFor = async (path: string, ms: number): Promise<{ ok: boolean; ms: number; said: string }> => {
      const t = performance.now();
      try {
        const answer = await nodeTransport(new URL(`http://127.0.0.1:3491${path}`), local, AbortSignal.timeout(ms));
        const body = await answer.read(2_000_000);
        return { ok: true, ms: performance.now() - t, said: body.text };
      } catch (e) {
        return { ok: false, ms: performance.now() - t, said: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
      }
    };
    const whole = await readFor("/gzip-whole", 1500);
    check("a gzip body is read and decompressed", whole.ok && whole.said.includes("Specimen served here"), whole.said.slice(0, 80));
    for (const coding of ["gzip", "deflate", "br"]) {
      const r = await readFor(`/${coding}-trickle`, 1500);
      check(`a ${coding} body that trickles on is cut at the time limit (1.5 s), not read for ever`, !r.ok && r.ms >= 1400 && r.ms < 3000, `${r.said.slice(0, 80)} after ${Math.round(r.ms)} ms`);
    }
    const stall = await readFor("/gzip-stall", 1500);
    check("a gzip answer that stalls after its headers ends at the time limit", !stall.ok && stall.ms >= 1400 && stall.ms < 3000, `${stall.said.slice(0, 80)} after ${Math.round(stall.ms)} ms`);
    const reset = await readFor("/gzip-reset", 5000);
    check("a gzip answer whose connection is reset mid-body ends at once, with an error", !reset.ok && reset.ms < 2000, `${reset.said.slice(0, 80)} after ${Math.round(reset.ms)} ms`);
    /* The whole fetch, through the guard: a public name, its request sent to the check's server instead. */
    const publicName: import("../src/cc/site/audit.ts").Resolver = async () => [{ address: "93.184.216.34", family: 4 }];
    const t = performance.now();
    const g = await fetchGuarded("https://slow-specimen.example/", { resolve: publicName, transport: (_u, _to, signal) => nodeTransport(new URL("http://127.0.0.1:3491/gzip-trickle"), local, signal), timeoutMs: 1500 });
    const took = performance.now() - t;
    check("the guarded fetch of a trickling gzip page ends at its time limit and says so", g.status === 200 && /did not arrive within 1\.5 seconds/.test(g.error ?? "") && took < 3000, `${g.error} after ${Math.round(took)} ms`);
  }
  for (const t of timers) clearTimeout(t);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

  /* One whole crawl of a specimen site, every answer stubbed: duplicates,
     extraction rules and redirect loops through the real crawl, its parsing
     thread and its tables. */
  {
    const realRepo = process.env.SITE_READ_REPO;
    process.env.SITE_READ_REPO = path.join(dir, "no-such-copy.git");
    store.setState("probe:last", String(Date.now()));
    const shared = prose(90, 300);
    const specimen: Record<string, string> = {
      "/": sitePage({ path: "/", own: `${prose(91, 300)}`, h1: "Specimen home" }).replace("</main>", `<a href="/specimen-a">A</a><a href="/specimen-b">B</a><a href="/specimen-c">C</a><a href="/specimen-loop">Loop</a></main>`),
      "/specimen-a": sitePage({ path: "/specimen-a", own: shared, h1: "Specimen twin" }).replace("</main>", `<a href="/" data-price="11">Home</a></main>`),
      "/specimen-b": sitePage({ path: "/specimen-b", own: shared, h1: "Specimen twin" }).replace("</main>", `<a href="/" data-price="12">Home</a></main>`),
      "/specimen-c": sitePage({ path: "/specimen-c", own: prose(92, 300), h1: "Specimen third" }).replace("</main>", `<a href="/">Home</a></main>`),
      /* Forty levels deep: deeper than the desk's test page, so a selector that passed its trial can still be slow here. */
      "/specimen-deep": sitePage({ path: "/specimen-deep", own: prose(93, 300), h1: "Specimen deep" }).replace("</main>", `${"<div><span>specimen</span>".repeat(40)}${"</div>".repeat(40)}<a href="/">Home</a></main>`),
    };
    const r1 = await crawlMod.addExtractRule({ name: "Main heading", kind: "css", expression: "main h1" }, "the check");
    const r2 = await crawlMod.addExtractRule({ name: "Specimen price", kind: "regex", expression: 'data-price="(\\d+)"', attribute: "1", scope: "/specimen-" }, "the check");
    const r3 = await crawlMod.addExtractRule({ name: "Links home", kind: "xpath", expression: "//main//a[@href='/']/@href" }, "the check");
    check("extraction: three rules kept, each with who added it", r1.ok && r2.ok && r3.ok && crawlMod.extractRules().length === 3 && crawlMod.extractRules()[0]?.addedBy === "the check", [r1, r2, r3].map((r) => (r.ok ? r.rule.id : r.reason)).join(", "));
    const slowSel = "x div div div div div div span";
    const refusedSlow = await crawlMod.addExtractRule({ name: "Slow specimen", kind: "css", expression: slowSel }, "the check");
    check("extraction: a selector that is slow on the desk's test page is not kept, with the reason", !refusedSlow.ok && /test page/.test(refusedSlow.reason) && crawlMod.extractRules().length === 3, refusedSlow.ok ? "kept" : refusedSlow.reason.slice(0, 140));
    /* The same selector as a rule kept before the trial existed: written straight into the table. */
    const r4 = Number(
      db.prepare("INSERT INTO cc_extract_rules (name, kind, expression, attribute, scope, enabled, added_by, added_at) VALUES ('Slow specimen', 'css', ?, NULL, '/specimen-deep', 1, 'the check', ?)").run(slowSel, new Date().toISOString()).lastInsertRowid,
    );
    /* A short deadline for these crawls (1.5 s; the real one is EXTRACT.pageMs), put back below. */
    const realPageMs = extract.EXTRACT.pageMs;
    Object.assign(extract.EXTRACT, { pageMs: 1500 });
    const urlsetOf = (paths: string[]) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${abs(p)}</loc></url>`).join("")}</urlset>`;
    const html200 = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    const moved = (to: string) => new Response(null, { status: 308, headers: { location: to } });
    stub((url) => {
      const u = new URL(url);
      if (u.host === "balkaris.ch") return moved("https://balkaris.ch/");
      if (u.pathname === "/sitemap.xml") return new Response(urlsetOf(Object.keys(specimen)), { status: 200, headers: { "content-type": "application/xml" } });
      if (u.pathname === "/robots.txt") return new Response(`User-agent: *\nAllow: /\nSitemap: ${abs("/sitemap.xml")}\n`, { status: 200, headers: { "content-type": "text/plain" } });
      if (u.pathname === "/specimen-loop") return moved("/specimen-loop-b");
      if (u.pathname === "/specimen-loop-b") return moved("/specimen-loop");
      const page = specimen[u.pathname === "" ? "/" : u.pathname];
      return page ? html200(page) : null;
    });
    let crawled = "";
    try {
      await crawlMod.crawl();
    } catch (e) {
      crawled = e instanceof Error ? e.message : String(e);
    }
    check("the specimen crawl ran", crawled === "", crawled);
    const all = crawlMod.issues();
    const found = all.state === "ok" ? all.value : [];
    const loopHit = found.find((i) => i.rule === "redirect.loop" && i.related?.[0] === "/specimen-loop");
    check("a link into a redirect loop: redirect.loop with its hops and who links there", JSON.stringify(loopHit?.related) === JSON.stringify(["/specimen-loop", "/specimen-loop-b", "/specimen-loop"]) && /Linked from \//.test(loopHit?.text ?? ""), loopHit?.text);
    check(
      "and the page carrying the link has a broken link, not a redirected one",
      found.some((i) => i.rule === "links.broken" && i.path === "/" && i.related?.includes("/specimen-loop (308)")) && !found.some((i) => i.rule === "links.redirected" && i.path === "/"),
      found.filter((i) => i.path === "/" && i.rule.startsWith("links.")).map((i) => `${i.rule}: ${i.text}`).join(" | "),
    );
    const hosting = crawlMod.redirects();
    const bare = hosting.state === "ok" ? hosting.value.find((r) => r.by === "hosting") : undefined;
    check("a redirect rule that loops (here the bare domain to itself) is redirect.loop, not redirect.broken", Boolean(bare?.loop) && bare?.outcome === "broken" && found.some((i) => i.rule === "redirect.loop" && i.related?.[0] === "https://balkaris.ch/") && !found.some((i) => i.rule === "redirect.broken"), bare?.remark);
    check("two pages with one text: content.duplicate on both", found.filter((i) => i.rule === "content.duplicate").map((i) => i.path).sort().join() === "/specimen-a,/specimen-b");
    const dupes = crawlMod.contentDuplicates();
    check("the duplicates read back as groups", dupes.state === "ok" && dupes.value.exact.length === 1 && dupes.value.exact[0]?.pages.join() === "/specimen-a,/specimen-b" && dupes.value.h1[0]?.heading === "Specimen twin", JSON.stringify(dupes.state === "ok" ? dupes.value : dupes));
    const stored = db.prepare("SELECT facts FROM cc_pages WHERE path = '/specimen-a'").get() as { facts: string } | undefined;
    check("each page's own-text fingerprint is stored with its facts", /"md5":"[0-9a-f]{32}"/.test(stored?.facts ?? ""));
    const res1 = r1.ok ? crawlMod.extractResults(r1.rule.id) : null;
    const res2 = r2.ok ? crawlMod.extractResults(r2.rule.id) : null;
    const res3 = r3.ok ? crawlMod.extractResults(r3.rule.id) : null;
    check(
      "extraction: a css rule ran on every page, its time on each kept",
      res1?.pages.length === 5 && res1.pages.find((p) => p.path === "/")?.matches[0] === "Specimen home" && res1.rule.pagesMatched === 5 && res1.pages.every((p) => typeof p.ms === "number") && typeof res1.rule.slowestMs === "number",
      JSON.stringify(res1?.pages.map((p) => `${p.path}=${p.matches.join("|")} ${p.ms} ms`)),
    );
    check("extraction: a regex rule ran only in its scope, with its group", res2?.pages.length === 4 && res2.pages.find((p) => p.path === "/specimen-a")?.matches[0] === "11" && res2.pages.find((p) => p.path === "/specimen-c")?.count === 0, JSON.stringify(res2?.pages.map((p) => `${p.path}=${p.matches.join("|")}`)));
    /* The breadcrumb's link home and the page's own: two. */
    const onB = res3?.pages.find((p) => p.path === "/specimen-b");
    check("extraction: an xpath rule's attribute values", onB?.count === 2 && onB.matches.every((m) => m === "/"), JSON.stringify(res3?.pages.map((p) => `${p.path}=${p.matches.join("|")}`)));
    const slowRes = crawlMod.extractResults(r4);
    const slowOnDeep = slowRes?.pages.find((p) => p.path === "/specimen-deep");
    const deepHeading = res1?.pages.find((p) => p.path === "/specimen-deep");
    check(
      "extraction: a rule past the page's deadline is stopped there, says so, and the page and the other rules are read all the same",
      /ran for more than 1\.5 seconds/.test(slowOnDeep?.error ?? "") && deepHeading?.matches[0] === "Specimen deep" && store.state(`extract:overran:${r4}`) === "1" && slowRes?.rule.enabled === true,
      `${slowOnDeep?.error}; heading ${deepHeading?.matches[0]}; overran ${store.state(`extract:overran:${r4}`)}`,
    );

    /* A second crawl, with the price rule switched off by hand: what it found is kept; the slow rule overruns again and is switched off. */
    const off = r2.ok ? crawlMod.toggleExtractRule(r2.rule.id) : null;
    const lastRun1 = res1?.rule.lastRun ?? "";
    let crawled2 = "";
    try {
      await crawlMod.crawl();
    } catch (e) {
      crawled2 = e instanceof Error ? e.message : String(e);
    }
    check("the second specimen crawl ran", crawled2 === "", crawled2);
    const res2After = r2.ok ? crawlMod.extractResults(r2.rule.id) : null;
    check(
      "extraction: a rule switched off keeps what it found at the last crawl it ran in",
      off?.ok === true && !off.rule.enabled && res2After?.pages.length === 4 && res2After.rule.pagesRun === 4 && res2After.rule.lastRun === res2?.rule.lastRun && res2After.pages.find((p) => p.path === "/specimen-a")?.matches[0] === "11",
      `${res2After?.pages.length} pages, last run ${res2After?.rule.lastRun} (before ${res2?.rule.lastRun})`,
    );
    const res1After = r1.ok ? crawlMod.extractResults(r1.rule.id) : null;
    check("extraction: a rule that is on is run again", (res1After?.rule.lastRun ?? "") > lastRun1 && res1After?.pages.length === 5, `${lastRun1} → ${res1After?.rule.lastRun}`);
    const slowAfter = crawlMod.extractRule(r4);
    const saidOff = store.activity(50, ["crawl"]).find((a) => /Extraction rule switched off: Slow specimen/.test(a.text));
    check("extraction: a rule that overran in two crawls running is switched off, with a line in the feed", slowAfter?.enabled === false && Boolean(saidOff) && /2 crawls running/.test(saidOff?.detail ?? ""), `${slowAfter?.enabled}; ${saidOff?.text}: ${saidOff?.detail}`);
    Object.assign(extract.EXTRACT, { pageMs: realPageMs });
    check("extraction: a rule deleted goes with what it found", r1.ok && crawlMod.deleteExtractRule(r1.rule.id) && crawlMod.extractResults(r1.rule.id) === null && (db.prepare("SELECT COUNT(*) AS n FROM cc_extract_results WHERE rule = ?").get(r1.ok ? r1.rule.id : 0) as { n: number }).n === 0);
    if (realRepo === undefined) delete process.env.SITE_READ_REPO;
    else process.env.SITE_READ_REPO = realRepo;
    clean();
    db.exec("DELETE FROM cc_links; DELETE FROM cc_targets; DELETE FROM cc_issues; DELETE FROM cc_extract_results; DELETE FROM cc_extract_rules;");
  }
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
