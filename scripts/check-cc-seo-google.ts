/**
 * What the desk does at Google and the other search engines, and the Technical
 * page that draws it, proved without Google, without IndexNow and without the
 * website.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-google.ts
 *   npm run check:seo-google
 *
 * Nothing leaves this machine: a throwaway database, every outbound request of
 * src/cc/seo/google-actions.ts answered by a stand-in `wire` that writes down
 * what was asked, and a guard on `fetch` that refuses every host. Every page,
 * key and figure in here is a SPECIMEN (/specimen-a…, a made-up key).
 *
 * What is proved:
 *   1. a cut-short daily index check is not the site: each address keeps its
 *      newest answer, an address a person asked about later is that answer,
 *      one that left the sitemap is not carried, and a person's answer on a
 *      later day is not taken for a check of the site;
 *   2. the Technical page: its figures come from that, it asks nobody while it
 *      draws (no request, the sitemaps from the kept copy), the duplicate line
 *      leads to its own panel, the filters narrow and say how they were read,
 *      the export is a file with the mark and refuses what it does not know;
 *      a title or description fix names its rule's own pages;
 *   3. nothing is submitted or announced while the website does not answer
 *      200, by the probe or by asking it, and Google or the engines are then
 *      not asked at all;
 *   4. a sitemap is submitted with the write token, only the site's own, and
 *      a refusal by Google is said in a sentence and written to the activity;
 *   5. one address inspected now: counted against the day's allowance, kept,
 *      read in plain words, refused past the allowance and outside the site;
 *   6. the Request indexing queue: the console link is for exactly that
 *      address, "Mark requested" marks and takes back, the link check says
 *      whether indexed pages link to it, and the Indexing API is never called;
 *   7. IndexNow: no key says so with the step; the first look is a baseline;
 *      a changed lastmod is "changed"; each engine's answer is said; nothing
 *      accepted marks nothing; one address is asked first;
 *   8. the addresses: every POST answers { ok, line } or { error }, and the
 *      gate lets the pages that draw /seo/google reach it;
 *   9. the crawler's tools on Technical: the day's audits listed and reopened
 *      by address, "Audit again" of a refused address drops nothing, and an
 *      extraction rule tried now on one page of the site keeps nothing.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-google-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "SITE_READ_REPO", "SITE_REPO", "DESK_DEV_USER"]) delete process.env[k];
/* A key file that is a key file only in shape: the token is the stand-in's, never Google's. */
const KEY_FILE = path.join(dir, "specimen-key.json");
writeFileSync(KEY_FILE, JSON.stringify({ client_email: "specimen@specimen.invalid", private_key: "specimen, never signed with" }));
process.env.GA4_CREDENTIALS_FILE = KEY_FILE;
process.env.SITE_READ_CLONE = "off";

/* ---- nothing leaves this machine ------------------------------------------ */
let leaks = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  leaks++;
  throw new Error(`the check tried to leave the machine: ${String(input instanceof Request ? input.url : input).split("?")[0]}`);
}) as typeof fetch;

let passed = 0;
let failedN = 0;
function check(name: string, good: boolean, detail?: unknown): void {
  if (good) passed++;
  else failedN++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${!good && detail !== undefined ? `\n     ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
}
const section = (title: string) => console.log(`\n${title}`);

/* ---- the modules ------------------------------------------------------------ */

const { db } = await import("../src/db.ts");
const store = await import("../src/cc/store.ts");
const shared = await import("../src/cc/search/shared.ts");
await import("../src/cc/search/gsc.ts");
await import("../src/cc/site/index.ts");
const indexation = await import("../src/cc/seo/indexation.ts");
const ga = await import("../src/cc/seo/google-actions.ts");
const seo = await import("../src/cc/routes/seo.ts");
const technical = await import("../src/cc/routes/seo/technical.ts");
const grants = await import("../src/grants.ts");
const { apiError } = await import("../src/cc/api.ts");
const { Hono } = await import("hono");
const { readFileSync } = await import("node:fs");
import type { Person } from "../src/people.ts";
import type { Vars } from "../src/cc/access.ts";

const OWNER = { telegram: 1, name: "Specimen Owner", email: "owner@specimen.invalid", owner: true } as unknown as Person;

const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  c.set("who", OWNER);
  await next();
});
app.route("/", seo.routes);
app.onError(apiError);
async function ask<T = Record<string, unknown>>(p: string, body?: unknown): Promise<{ status: number; json: T; text: string; type: string }> {
  const res = await app.request(p, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  /* Decoded keeping a byte-order mark, which res.text() would drop: the export's mark is part of what is proved. */
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json: json as T, text, type: res.headers.get("content-type") ?? "" };
}

/* ---- the stand-in wire -------------------------------------------------------- */

type Call = { what: string; method?: string; url: string; write?: boolean; body?: unknown };
let calls: Call[] = [];
let googleAnswer: (method: string, url: string, body: unknown) => { status: number; json: unknown } = () => ({ status: 200, json: {} });
let statusOf: (url: string) => number = () => 200;
let engineAnswer: (endpoint: string) => number = () => 200;
let keyIs: string | null = null;
let pauses = 0;

ga.wire.bearer = async (write) => {
  calls.push({ what: "token", url: "", write });
  return write ? "specimen-write-token" : "specimen-read-token";
};
ga.wire.google = async (method, url, bearerToken, body) => {
  calls.push({ what: "google", method, url, write: bearerToken === "specimen-write-token", body });
  return googleAnswer(method, url, body);
};
ga.wire.status = async (url) => {
  calls.push({ what: "status", url });
  return statusOf(url);
};
ga.wire.announce = async (endpoint, body) => {
  calls.push({ what: "announce", url: endpoint, body });
  return engineAnswer(endpoint);
};
ga.wire.key = async () => keyIs;
ga.wire.pause = async () => {
  pauses++;
};
const asked = (what: string): Call[] => calls.filter((c) => c.what === what);

/* ---- specimen state ------------------------------------------------------------ */

const SITE = "https://www.balkaris.ch";
const PATHS = ["/", "/specimen-a", "/specimen-b", "/specimen-c", "/specimen-d", "/specimen-e", "/specimen-f", "/specimen-g", "/specimen-h", "/specimen-i"];
const today = store.today();
const D1 = shared.addDays(today, -2);
const D2 = shared.addDays(today, -1);
const access = (permission: string, state = "ok") =>
  store.setState("gsc.access", JSON.stringify({ state, site: state === "ok" ? "sc-domain:balkaris.ch" : null, permission, readable: ["sc-domain:balkaris.ch"], checkedAt: new Date().toISOString(), detail: "" }));
store.setState("gsc.access.asked", "");

function sitemap(entries: { path: string; lastmod: string | null }[]): void {
  store.keep("site:sitemap", {
    at: new Date().toISOString(),
    status: 200,
    entries: entries.map((e) => ({ path: e.path, loc: `${SITE}${e.path === "/" ? "/" : e.path}`, lastmod: e.lastmod, priority: 0.5, changefreq: null })),
    robots: { status: 200, sitemaps: [`${SITE}/sitemap.xml`], rules: 1 },
    issues: [],
  });
}
sitemap(PATHS.map((p) => ({ path: p, lastmod: "2026-09-01" })));

const putInspect = db.prepare(
  `INSERT OR REPLACE INTO cc_inspect (day, url, verdict, coverage, last_crawl, google_canonical, user_canonical, robots_state, fetch_state, indexing_state, is_indexed, canonical_ok, link, checked_at)
   VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'ALLOWED', 'SUCCESSFUL', 'INDEXING_ALLOWED', ?, NULL, NULL, ?)`,
);
const inspectRow = (day: string, p: string, indexed: boolean) =>
  putInspect.run(day, `${SITE}${p === "/" ? "/" : p}`, indexed ? "PASS" : "NEUTRAL", indexed ? "Submitted and indexed" : "Crawled - currently not indexed", indexed ? 1 : 0, `${day}T18:00:00.000Z`);

/* The whole check of D1: six of ten indexed. */
PATHS.forEach((p, i) => inspectRow(D1, p, i < 6));
store.record("gsc.sitemap_addresses", PATHS.length, D1);
store.record("gsc.inspected", PATHS.length, D1);
store.record("gsc.indexed", 6, D1);
store.record("gsc.not_indexed", 4, D1);
/* D2 was cut short after three addresses: two of them now say "not indexed" where D1 said indexed. */
inspectRow(D2, "/", true);
inspectRow(D2, "/specimen-a", false);
inspectRow(D2, "/specimen-b", false);
store.record("gsc.sitemap_addresses", PATHS.length, D2);

/* The probe: the website answering 402 a minute ago. */
const probe = (status: number, minutesAgo: number) =>
  db.prepare("INSERT INTO cc_probes (at, day, target, status, ok) VALUES (?, ?, 'home', ?, ?)").run(new Date(Date.now() - minutesAgo * 60_000).toISOString(), today, status, status === 200 ? 1 : 0);

try {
  /* ============ 1. a cut-short check is not the site ============================== */
  section("1. a cut-short daily index check");
  {
    const ins = indexation.latestInspection()!;
    check("the newest check day is the cut-short one", ins.day === D2, ins.day);
    check("it says it is not complete, and how much it reached", ins.complete === false && ins.checked === 3 && ins.carried === 7 && ins.of === 10, ins);
    check("every sitemap address has an answer: none is lost to the cut", ins.rows.length === 10 && ins.missing === 0);
    check("the indexed count is the site's (3 carried from the whole day, 1 from the cut one), not the fragment's (1 of 3)", ins.rows.filter((r) => r.indexed).length === 4, ins.rows.filter((r) => r.indexed).map((r) => r.path));
    check("each row says which day its answer is from", ins.rows.find((r) => r.path === "/specimen-c")?.day === D1 && ins.rows.find((r) => r.path === "/specimen-a")?.day === D2);
    check("the last whole day is named", ins.wholeDay === D1, ins.wholeDay);

    /* A person asks about one address today: that is Google's newest word on it, and today is not a check of the site. */
    inspectRow(today, "/specimen-g", true);
    const after = indexation.latestInspection()!;
    check("a person's answer of a later day does not become the check day", after.day === D2, after.day);
    check("…and it is that address's answer", after.rows.find((r) => r.path === "/specimen-g")?.indexed === true && after.rows.find((r) => r.path === "/specimen-g")?.day === today);

    /* An address that left the sitemap is not carried. */
    sitemap(PATHS.filter((p) => p !== "/specimen-i").map((p) => ({ path: p, lastmod: "2026-09-01" })));
    const left = indexation.latestInspection()!;
    check("an address that left the sitemap is not carried", !left.rows.some((r) => r.path === "/specimen-i"), left.rows.map((r) => r.path));
    sitemap(PATHS.map((p) => ({ path: p, lastmod: "2026-09-01" })));
  }

  /* ============ 2. the Technical page ================================================ */
  section("2. the Technical page");
  access("siteFullUser");
  probe(402, 1);
  {
    calls = [];
    const before = leaks;
    const r = await ask<Record<string, any>>("/technical?range=30d");
    check("GET /technical answers 200", r.status === 200, r.json?.error ?? r.status);
    const ix = r.json.indexation;
    check("the index card is the site's: 5 of 10 indexed (one asked since), not 1 of 3", ix.state === "ok" && ix.value.indexed === 5 && ix.value.of === 10 && ix.value.inspected === 10, ix.value ?? ix);
    check("…and says how it was put together", ix.value.complete === false && ix.value.checked === 3 && ix.value.carried === 6 && ix.value.later === 1 && ix.value.wholeDay === D1 && /reached 3 of 10/.test(ix.note ?? "") && /1 address was asked about since/.test(ix.note ?? ""), ix.note);
    const line = r.json.checks.find((l: { key: string }) => l.key === "in-index");
    check("the checklist line counts the same 5 of 10, with the part said", line.reading.value.count === 5 && line.reading.value.of === 10 && /reached 3 of 10/.test(line.reading.note ?? ""), line.reading);
    check("the duplicate-content line leads to its own panel", r.json.checks.find((l: { key: string }) => l.key === "duplicates").href === "#duplicates");
    check("drawing the page asked nobody outside the desk", leaks === before && calls.length === 0, { leaks: leaks - before, calls });
    check("the sitemaps Google knows are the kept copy, not a live read (none kept yet: it says so)", r.json.submitted.state === "waiting" && /not been read/.test(r.json.submitted.reason), r.json.submitted);
    check("the Google panel is in the payload", r.json.google && r.json.google.access.canWrite === true && r.json.google.queue && r.json.google.requestLine.includes("job postings"), Object.keys(r.json.google ?? {}));
    check("the panel says the website is not answering", r.json.google.site.ok === false && r.json.google.site.status === 402 && /nothing is submitted or announced/.test(r.json.google.site.line), r.json.google.site);
    check("the Sitemaps report link is there for the errors Google only counts", r.json.sitemapsHref === "https://search.google.com/search-console/sitemaps?resource_id=sc-domain%3Abalkaris.ch", r.json.sitemapsHref);
    check("the filters are read back as all by default", JSON.stringify(r.json.asked) === JSON.stringify({ q: "", sev: "all", index: "all", device: "mobile" }), r.json.asked);

    const f = await ask<Record<string, any>>("/technical?sev=nonsense&index=not&device=desktop&q=%20%20specimen%20");
    check("an unknown filter value is read as all, a known one kept, the words tidied", JSON.stringify(f.json.asked) === JSON.stringify({ q: "specimen", sev: "all", index: "not", device: "desktop" }), f.json.asked);

    const csv = await ask("/technical/export.csv?what=index&index=not");
    const lines = csv.text.split("\r\n").filter(Boolean);
    check("the index export is a CSV with the byte-order mark", csv.status === 200 && csv.type.startsWith("text/csv") && csv.text.charCodeAt(0) === 0xfeff, { status: csv.status, type: csv.type });
    check("…holding only what ?index=not leaves (5 not indexed of 10)", lines.length === 1 + 5 && lines.slice(1).every((l) => l.includes(",no,")), lines);
    const bad = await ask<{ error: string }>("/technical/export.csv?what=everything");
    check("an export it does not know is refused in a sentence", bad.status === 400 && /issues, pages, redirects, index/.test(bad.json.error), bad.json);
    const none = await ask<{ error: string }>("/technical/export.csv?what=issues");
    check("an export with nothing yet answers 409, not an empty file", none.status === 409 && /nothing to export/.test(none.json.error), none);

    /* The title-and-description button names the rule's own pages, and none is offered when every page has work in hand. */
    const inHand = { waiting: new Set(["/specimen-a"]), tasked: new Set(["/specimen-b"]) };
    const some = technical.parts.scopedFix("description.long", ["/specimen-a", "/specimen-b", "/specimen-c"], inHand);
    check("a description fix names only the rule's pages with no proposal waiting and no task open", JSON.stringify(some.fix?.task.paths) === JSON.stringify(["/specimen-c"]) && /2 pages/.test(some.fixNote ?? ""), some);
    const nonePart = technical.parts.scopedFix("title.long", ["/specimen-a"], inHand);
    check("with every page in hand there is no button, only the reason", nonePart.fix === null && /already has a proposal waiting/.test(nonePart.fixNote ?? ""), nonePart);
    const many = technical.parts.scopedFix("title.long", ["/1", "/2", "/3", "/4", "/5", "/6", "/7"], { waiting: new Set(), tasked: new Set() });
    check("at most five pages to one task, and the rest said", many.fix?.task.paths?.length === 5 && /first 5 of 7/.test(many.fixNote ?? ""), many);
    const redirect = technical.parts.scopedFix("links.broken", ["/x"], inHand);
    check("a redirect fix is not narrowed", redirect.fix?.task.kind === "redirect" && redirect.fixNote === null);
  }

  /* ============ 3. nothing while the website does not answer 200 ===================== */
  section("3. the website not answering");
  {
    calls = [];
    let said = "";
    try {
      await ga.submitSitemap("/sitemap.xml", OWNER);
    } catch (e) {
      said = e instanceof ga.Cannot ? `${e.status} ${e.message}` : String(e);
    }
    check("a sitemap is not submitted while the probe saw 402", said.startsWith("409 Not submitted: the website answered 402"), said);
    check("…and Google was not asked, nor a token fetched", asked("google").length === 0 && asked("token").length === 0, calls);

    keyIs = "0123456789abcdef0123456789abcdef";
    said = "";
    try {
      await ga.announce({ paths: ["/specimen-a"] }, OWNER);
    } catch (e) {
      said = e instanceof ga.Cannot ? `${e.status} ${e.message}` : String(e);
    }
    check("nothing is announced to IndexNow while the probe saw 402", said.startsWith("409 Not announced: the website answered 402"), said);
    check("…and no engine was told", asked("announce").length === 0, calls);

    /* The probe's look is old: the website itself is asked, once. */
    db.prepare("DELETE FROM cc_probes").run();
    probe(200, 30);
    calls = [];
    statusOf = () => 402;
    said = "";
    try {
      await ga.submitSitemap("/sitemap.xml", OWNER);
    } catch (e) {
      said = e instanceof ga.Cannot ? `${e.status} ${e.message}` : String(e);
    }
    check("with an old probe the website is asked, and its 402 refuses", said.includes("402 when the desk asked it just now") && asked("status").length === 1 && asked("google").length === 0, { said, calls });
    statusOf = () => 200;
  }

  /* ============ 4. submit a sitemap ===================================================== */
  section("4. submit a sitemap");
  {
    db.prepare("DELETE FROM cc_probes").run();
    probe(200, 1);
    calls = [];
    googleAnswer = (method, url) => {
      if (method === "PUT") return { status: 204, json: null };
      if (url.endsWith("/sitemaps")) return { status: 200, json: { sitemap: [{ path: `${SITE}/sitemap.xml`, lastSubmitted: new Date().toISOString(), lastDownloaded: null, isPending: true, errors: "0", warnings: "0", contents: [{ submitted: "10" }] }] } };
      return { status: 404, json: {} };
    };
    const line = await ga.submitSitemap("/sitemap.xml", OWNER);
    const put = asked("google").find((c) => c.method === "PUT");
    check("the sitemap file is asked first (it must answer 200)", asked("status")[0]?.url === `${SITE}/sitemap.xml`, calls);
    check("submitted with the write token, to Search Console's sitemaps.submit for the property", !!put && put.write === true && put.url.endsWith(`/sites/${encodeURIComponent("sc-domain:balkaris.ch")}/sitemaps/${encodeURIComponent(`${SITE}/sitemap.xml`)}`), put);
    check("reads with the read-only token", asked("google").filter((c) => c.method === "GET").every((c) => c.write === false));
    check("the list is read again and kept, so the row shows the new time", store.kept<{ path: string; isPending: boolean }[]>("gsc:sitemaps")?.value[0]?.isPending === true);
    check("the answer is one plain sentence", /^Submitted \/sitemap\.xml to Google \(Search Console answered 204\)/.test(line), line);
    const act = db.prepare("SELECT text, actor, tone FROM cc_activity WHERE kind = 'seo-action' AND dedupe LIKE 'google:sitemap:%' ORDER BY id DESC LIMIT 1").get() as { text: string; actor: string; tone: string };
    check("written to the activity with who did it", act?.text === "Submitted the sitemap /sitemap.xml to Google" && act.actor === OWNER.name && act.tone === "good", act);

    calls = [];
    let said = "";
    try {
      await ga.submitSitemap("https://elsewhere.example/sitemap.xml", OWNER);
    } catch (e) {
      said = e instanceof ga.Cannot ? `${e.status} ${e.message}` : String(e);
    }
    check("another site's address is refused before anything is asked", said.startsWith("400 The desk submits only the website's own sitemaps") && calls.length === 0, { said, calls });

    googleAnswer = (method) => (method === "PUT" ? { status: 403, json: { error: { message: "User does not have sufficient permission" } } } : { status: 200, json: { sitemap: [] } });
    said = "";
    try {
      await ga.submitSitemap("/sitemap.xml", OWNER);
    } catch (e) {
      said = e instanceof ga.Cannot ? `${e.status} ${e.message}` : String(e);
    }
    check("Google's refusal is said as a sentence with its status", said.startsWith("502 Google refused (403)"), said);
    const warn = db.prepare("SELECT text, tone FROM cc_activity WHERE dedupe LIKE 'google:sitemap:%' ORDER BY id DESC LIMIT 1").get() as { text: string; tone: string };
    check("…and written to the activity as a warning", warn.tone === "warn" && /did not take/.test(warn.text), warn);

    access("siteRestrictedUser");
    calls = [];
    said = "";
    try {
      await ga.submitSitemap("/sitemap.xml", OWNER);
    } catch (e) {
      said = e instanceof ga.Cannot ? `${e.status} ${e.message}` : String(e);
    }
    check("a Restricted user may not submit: said with the step, nothing asked", said.startsWith("409") && /Full/.test(said) && calls.length === 0, said);
    access("siteFullUser");
    googleAnswer = () => ({ status: 200, json: {} });
  }

  /* ============ 5. inspect one address now ============================================== */
  section("5. inspect one address now");
  {
    calls = [];
    const day = shared.dayIn("America/Los_Angeles");
    const usedBefore = shared.countOn("gsc.inspect.used", day);
    googleAnswer = (_m, _u, body) => ({
      status: 200,
      json: {
        inspectionResult: {
          inspectionResultLink: "https://search.google.com/search-console/inspect?resource_id=sc-domain:balkaris.ch&id=specimen",
          indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", lastCrawlTime: "2026-09-30T10:00:00Z", googleCanonical: `${SITE}/specimen-b`, userCanonical: `${SITE}/specimen-b`, robotsTxtState: "ALLOWED", pageFetchState: "SUCCESSFUL", indexingState: "INDEXING_ALLOWED", crawledAs: "MOBILE", referringUrls: [`${SITE}/`] },
          richResultsResult: { verdict: "PASS", detectedItems: [{ richResultType: "Breadcrumbs", items: [{ name: "x", issues: [{ issueMessage: "Missing field specimen", severity: "WARNING" }] }] }] },
          mobileUsabilityResult: { verdict: "PASS" },
        },
        asked: body,
      },
    });
    const r = await ask<Record<string, any>>("/google/inspect", { path: "/specimen-b" });
    check("POST /google/inspect answers { ok, line, inspection, quota }", r.status === 200 && r.json.ok === true && typeof r.json.line === "string", r.json);
    const sent = asked("google")[0];
    check("Google's URL Inspection is asked for that address on the property, with the read token", !!sent && sent.url.endsWith("/urlInspection/index:inspect") && (sent.body as { inspectionUrl: string; siteUrl: string }).inspectionUrl === `${SITE}/specimen-b` && (sent.body as { siteUrl: string }).siteUrl === "sc-domain:balkaris.ch" && sent.write === false, sent);
    check("it is counted against the day's allowance", shared.countOn("gsc.inspect.used", day) === usedBefore + 1 && r.json.quota.used === usedBefore + 1);
    check("in plain words: indexed, and what it was before", r.json.inspection.indexed === true && /^In Google's index/.test(r.json.line) && /Was: Crawled - currently not indexed/.test(r.json.line), r.json.line);
    check("the canonical Google chose, last crawl, phone, rich results", r.json.inspection.canonical.agrees === true && r.json.inspection.lastCrawl === "2026-09-30T10:00:00Z" && /phone/.test(r.json.inspection.mobile.line) && /Breadcrumbs/.test(r.json.inspection.rich.line) && /1 warning/.test(r.json.inspection.rich.line), r.json.inspection);
    check("kept under today in the index table, so every screen sees it", (db.prepare("SELECT is_indexed FROM cc_inspect WHERE day = ? AND url = ?").get(today, `${SITE}/specimen-b`) as { is_indexed: number } | undefined)?.is_indexed === 1);
    const kept = await ask<Record<string, any>>("/google/inspect?path=/specimen-b");
    check("GET /google/inspect gives the kept answer back", kept.json.state === "ok" && kept.json.value.path === "/specimen-b" && kept.json.value.by === OWNER.name, kept.json);
    check("written to the activity with who asked", !!db.prepare("SELECT 1 FROM cc_activity WHERE dedupe LIKE 'google:inspect:/specimen-b:%' AND actor = ?").get(OWNER.name));

    const out = await ask<{ error: string }>("/google/inspect", { path: "https://elsewhere.example/page" });
    check("an address outside the site is refused (400)", out.status === 400 && /website's own addresses/.test(out.json.error), out.json);

    shared.setCount("gsc.inspect.used", day, 2000);
    calls = [];
    const spent = await ask<{ error: string }>("/google/inspect", { path: "/specimen-c" });
    check("past Google's 2,000 a day it refuses and asks nothing", spent.status === 409 && /2,000/.test(spent.json.error) && asked("google").length === 0, spent.json);
    shared.setCount("gsc.inspect.used", day, usedBefore + 1);

    const plain = ga.readInspection({ inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed", googleCanonical: `${SITE}/other`, userCanonical: `${SITE}/specimen-d` } } }, `${SITE}/specimen-d`, "x", new Date().toISOString(), null, "sc-domain:balkaris.ch");
    check("not indexed: Google's reason, what it means, and another canonical named", !plain.indexed && plain.line === "Not in Google's index: Discovered - currently not indexed." && /knows the address/.test(plain.meaning) && plain.canonical.agrees === false && /another canonical/.test(plain.canonical.line), plain);
    check("no rich results for a page Google has not indexed, said so", /only for a page it has indexed/.test(plain.rich.line));
  }

  /* ============ 6. the Request indexing queue ============================================ */
  section("6. the Request indexing queue");
  {
    const opp = db.prepare(
      `INSERT INTO cc_seo_opps (id, type, page, title, evidence, priority, priority_why, action, first_seen, last_seen) VALUES (?, 'not-indexed', ?, 'Not in Google''s index', '[]', ?, 'specimen', '{}', ?, ?)`,
    );
    const at = new Date().toISOString();
    opp.run("not-indexed:/specimen-f", "/specimen-f", "high", at, at);
    opp.run("not-indexed:/specimen-h", "/specimen-h", "low", at, at);
    store.setState("site:crawl:finished", at);
    const link = db.prepare("INSERT OR REPLACE INTO cc_links (source, target, text, internal, place) VALUES (?, ?, ?, 1, ?)");
    link.run("/", "/specimen-f", "Specimen F in the text", "main");
    link.run("/specimen-h", "/specimen-f", "menu", "chrome");

    const q = ga.queue();
    check("the queue lists the pages Google has not indexed, most important first", q.state === "ok" && q.value.rows.map((r) => r.path).join() === "/specimen-f,/specimen-h", q);
    if (q.state === "ok") {
      const c = q.value.rows[0]!;
      check("the console link opens Search Console's inspection of exactly that address", c.consoleHref === `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent("sc-domain:balkaris.ch")}&id=${encodeURIComponent(`${SITE}/specimen-f`)}`, c.consoleHref);
      check("the link check counts a link in an indexed page's own text", c.links?.fromIndexed === 1 && c.links.fromContent === 1 && c.links.tone === "good", c.links);
      const h = q.value.rows[1]!;
      check("a page nothing indexed links to is said to need a link", h.links?.tone === "bad" && /No page Google has indexed links to it/.test(h.links.line), h.links);
    }
    const lc = ga.linkCheck("/specimen-f");
    check("the link check answers for one page on its own", lc.state === "ok" && lc.value.total === 2, lc);

    const marked = await ask<{ ok: boolean; line: string }>("/google/requested", { path: "/specimen-f", requested: true });
    check("Mark requested marks the page, in a sentence", marked.status === 200 && marked.json.ok && /requested in Search Console/.test(marked.json.line), marked.json);
    check("…as the person's, on the opportunity", (db.prepare("SELECT state, state_by FROM cc_seo_opps WHERE id = 'not-indexed:/specimen-f'").get() as { state: string; state_by: string }).state_by === OWNER.name);
    const panel = await ga.panel();
    check("the panel's last steps show it", panel.recent.some((d) => d.text === "Requested indexing: /specimen-f"), panel.recent);
    const back = await ask<{ ok: boolean; line: string }>("/google/requested", { path: "/specimen-f", requested: false });
    check("…and takes it back", back.json.line === "Mark taken back." && (db.prepare("SELECT state FROM cc_seo_opps WHERE id = 'not-indexed:/specimen-f'").get() as { state: string }).state === "open", back.json);
    const badBody = await ask<{ error: string }>("/google/requested", { path: "/specimen-f" });
    check("a body without requested: true or false is refused in a sentence", badBody.status === 400 && /requested/.test(badBody.json.error));

    const src = readFileSync(new URL("../src/cc/seo/google-actions.ts", import.meta.url), "utf8");
    check("the Indexing API is never called: no request names it", !calls.some((c) => /indexing\.googleapis\.com/.test(c.url)) && !/indexing\.googleapis\.com/.test(src));
  }

  /* ============ 7. IndexNow ============================================================= */
  section("7. IndexNow");
  {
    keyIs = null;
    store.forget("google:indexnow:key");
    const noKey = await ga.indexNowState();
    check("no key file: off, with the website change that adds it", noKey.state === "off" && /public\/<key>\.txt/.test(noKey.step ?? ""), noKey);

    keyIs = "0123456789abcdef0123456789abcdef";
    store.forget("google:indexnow:key");
    const first = await ga.indexNowState();
    check("the first look is a baseline: nothing reported as changed", first.state === "ok" && first.value.changed.paths.length === 0 && first.value.keyFile === "/0123456789abcdef0123456789abcdef.txt", first);

    sitemap(PATHS.map((p) => ({ path: p, lastmod: p === "/specimen-a" ? "2026-10-04" : "2026-09-01" })).concat([{ path: "/specimen-new", lastmod: "2026-10-04" }]));
    const changed = await ga.indexNowState();
    check("a re-dated and a new address are changed since", changed.state === "ok" && changed.value.changed.paths.sort().join() === "/specimen-a,/specimen-new", changed.state === "ok" ? changed.value.changed : changed);

    calls = [];
    pauses = 0;
    engineAnswer = (e) => (e.includes("bing") ? 200 : e.includes("yandex") ? 202 : e.includes("seznam") ? 403 : e.includes("naver") ? 422 : 0);
    const done = await ga.announce({ changed: true }, OWNER);
    const posts = asked("announce");
    const body = posts[0]?.body as { host: string; key: string; keyLocation: string; urlList: string[] };
    check("each of the five engines is told, at its own door", posts.length === 5 && ga.ENGINES.every((e) => posts.some((p) => p.url === e.endpoint)), posts.map((p) => p.url));
    check("with the host, the key, where the key file is, and the changed addresses", body.host === "www.balkaris.ch" && body.key === keyIs && body.keyLocation === `${SITE}/${keyIs}.txt` && body.urlList.sort().join() === `${SITE}/specimen-a,${SITE}/specimen-new`, body);
    check("a breath between engines", pauses >= 4, pauses);
    check("which engines accepted is said", /^Told Bing, Yandex about 2 addresses\. Not taken by: Seznam \(refused the key/.test(done.line) && /Yep \(did not answer\)/.test(done.line), done.line);
    const again = await ga.indexNowState();
    check("what was announced is no longer changed", again.state === "ok" && again.value.changed.paths.length === 0 && again.value.last?.addresses === 2, again);
    let said = "";
    try {
      await ga.announce({ changed: true }, OWNER);
    } catch (e) {
      said = e instanceof ga.Cannot ? `${e.status} ${e.message}` : String(e);
    }
    check("nothing changed: nothing to announce, in a sentence", said.startsWith("409 Nothing to announce"), said);

    /* One address: it is asked first, and an error is not announced. */
    calls = [];
    statusOf = (u) => (u.endsWith("/specimen-b") ? 500 : 200);
    said = "";
    try {
      await ga.announce({ paths: ["/specimen-b"] }, OWNER);
    } catch (e) {
      said = e instanceof ga.Cannot ? `${e.status} ${e.message}` : String(e);
    }
    check("one address that answers 500 is not announced", said.startsWith("409 Not announced: /specimen-b answered 500") && asked("announce").length === 0, said);
    statusOf = () => 200;

    calls = [];
    engineAnswer = () => 403;
    said = "";
    try {
      await ga.announce({ paths: ["/specimen-c"] }, OWNER);
    } catch (e) {
      said = e instanceof ga.Cannot ? `${e.status} ${e.message}` : String(e);
    }
    check("no engine accepting: 502, and nothing marked as announced", said.startsWith("502 No engine accepted") && !(db.prepare("SELECT at FROM cc_seo_announced WHERE path = '/specimen-c'").get() as { at: string | null } | undefined)?.at, said);
    engineAnswer = () => 200;

    const r = await ask<{ error: string }>("/google/indexnow", { paths: [] });
    check("POST /google/indexnow without addresses is refused in a sentence", r.status === 400 && /changed/.test(r.json.error), r.json);
    const ok1 = await ask<{ ok: boolean; line: string; answers: unknown[] }>("/google/indexnow", { paths: ["/specimen-d"] });
    check("POST /google/indexnow { paths } answers { ok, line, answers }", ok1.status === 200 && ok1.json.ok && ok1.json.answers.length === 5 && /^Told Bing, Yandex, Seznam, Naver, Yep about \/specimen-d/.test(ok1.json.line), ok1.json);
  }

  /* ============ 8. the gate ============================================================== */
  section("8. who may reach /seo/google");
  {
    const as = (g: Record<string, "none" | "view" | "edit">) => ({ owner: false, revoked: false, grants: g });
    const post = (g: Record<string, "none" | "view" | "edit">) => grants.judge(as(g), "/api/v1/seo/google/inspect", "POST").ok;
    check("edit on Technical may press Inspect now", post({ seo: "view", "page:seo/technical": "edit" }));
    check("edit on Search Console may too (its tab draws the buttons)", post({ seo: "view", "page:seo/search-console": "edit" }));
    check("edit on Pages may too", post({ seo: "view", "page:seo/pages": "edit" }));
    check("view only on all three may not", !post({ seo: "view" }));
    check("view may read the panel", grants.judge(as({ seo: "view" }), "/api/v1/seo/google", "GET").ok);
    check("Technical's opportunity buttons reach their address with Opportunities off", grants.judge(as({ seo: "edit", "page:seo/opportunities": "none" }), "/api/v1/seo/opportunities/act", "POST").ok);
    check("the inspection job runs for a person on SEO", grants.judge(as({ seo: "edit" }), "/api/v1/jobs/gsc-inspect/run", "POST").ok);
  }

  /* ============ 9. the crawler's tools: audits kept, audited again, a rule tried now ======= */
  section("9. the crawler's tools");
  {
    const spider = await import("../src/cc/routes/spider.ts");
    const tools = new Hono<Vars>();
    tools.use("*", async (c, next) => {
      c.set("who", OWNER);
      await next();
    });
    tools.route("/", spider.routes);
    tools.onError(apiError);
    const call = async <T,>(p: string, body?: unknown): Promise<{ status: number; json: T }> => {
      const res = await tools.request(p, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: res.status, json: (await res.json()) as T };
    };

    const specimen = { url: "https://specimen-rival.example/", finalUrl: "https://specimen-rival.example/", at: new Date().toISOString(), cached: false, status: 200, redirects: [], loop: false, timing: { ttfbMs: 1, totalMs: 2 }, bytes: 10, truncated: false, headers: {}, facts: null, unread: null, issues: [], score: 97, error: null };
    store.keep("spider:audit:https://specimen-rival.example/", specimen);
    const list = await call<{ url: string; score: number }[]>("/audits");
    check("GET /spider/audits lists the audits kept, with their score", list.status === 200 && list.json.length === 1 && list.json[0]!.url === "https://specimen-rival.example/" && list.json[0]!.score === 97, list.json);
    const one = await call<{ url: string; cached: boolean }>("/audits?url=specimen-rival.example");
    check("…and gives one back whole by its address, marked as kept", one.status === 200 && one.json.cached === true, one.json);
    const none = await call<{ error: string }>("/audits?url=https://never-audited.example/");
    check("an address with no kept audit is a 404 in a sentence", none.status === 404 && /kept for a day/.test(none.json.error), none.json);
    const refused = await call<{ error: string }>("/audit", { url: "http://localhost/", fresh: true });
    check("“Audit again” of a refused address drops nothing and says why", refused.status === 400 && /local or internal/.test(refused.json.error) && !!store.kept("spider:audit:https://specimen-rival.example/"), refused.json);

    let fetched: string[] = [];
    spider.tryWire.fetch = async (url) => {
      fetched.push(url);
      return { status: 200, url, error: null, body: '<html><head><title>T</title></head><body><main><p class="price">CHF 300</p><p class="price">CHF 900</p></main></body></html>' };
    };
    const tried = await call<{ path: string; matches: string[]; count: number }>("/extract/try", { kind: "css", expression: ".price", path: "/specimen-a" });
    check("a rule is tried now on one page of the site, nothing kept", tried.status === 200 && tried.json.count === 2 && tried.json.matches.join("|") === "CHF 300|CHF 900" && fetched[0] === `${SITE}/specimen-a`, tried.json);
    check("…and it added no rule", (db.prepare("SELECT COUNT(*) AS n FROM cc_extract_rules").get() as { n: number }).n === 0);
    const badRule = await call<{ error: string }>("/extract/try", { kind: "regex", expression: "", path: "/" });
    check("a rule with no expression is refused before any page is read", badRule.status === 400 && fetched.length === 1, badRule.json);
    const outside = await call<{ error: string }>("/extract/try", { kind: "css", expression: "p", path: "https://elsewhere.example/" });
    check("a page outside the site is refused", outside.status === 400 && /website's own pages/.test(outside.json.error), outside.json);
    spider.tryWire.fetch = async (url) => ({ status: 402, url, error: null, body: null });
    const down = await call<{ error: string }>("/extract/try", { kind: "css", expression: "p", path: "/" });
    check("a page that does not answer 200 is said, with what it answered", down.status === 409 && /answered 402/.test(down.json.error), down.json);
  }
} catch (e) {
  failedN++;
  console.log("FAIL the check threw:", e);
}

console.log(`\n${passed} passed, ${failedN} failed${leaks ? `; ${leaks} request(s) tried to leave the machine` : ""}`);
process.exit(failedN || leaks ? 1 : 0);
