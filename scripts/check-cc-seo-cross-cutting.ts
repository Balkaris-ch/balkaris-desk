/**
 * What belongs to no single SEO tab, proved without Google, the website or any
 * network: the top bar's search box over the SEO section, the full SEO audit,
 * the tab strip's counts and the figures several pages share, every SEO task
 * in one list, and the byte-order mark on every CSV.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-cross-cutting.ts
 *   npm run check:seo-cross
 *
 * A throwaway database and a guard on `fetch` that refuses every host: the
 * audit's jobs are stand-ins registered under the real jobs' names, so the
 * audit's own logic (order, freshness, a job already running, a cut-short
 * index check, a failed step, a step that cannot run) is what is proved, not
 * Google's answers. Every phrase, page, domain and task in here is a SPECIMEN,
 * made up and named so; none of it describes the real website.
 *
 * What is proved:
 *   1. the search box finds tracked phrases, clusters, competitors (by domain,
 *      by a pasted address, by name), opportunities (by page), SEO tasks and
 *      crawl findings, each leading to its own view; a keyword hit that still
 *      leads to the earlier screen is sent to the Keywords page, and a phrase
 *      found twice is listed once; access follows the address a hit leads to;
 *   2. the full audit runs its steps one after the other in the stated order,
 *      uses a fresh run instead of a new one, follows a job already running
 *      instead of asking twice, finishes a cut-short index check whatever the
 *      hour, skips what cannot run and says why, runs on past a failed step,
 *      answers the running audit to a second press, keeps every audit with the
 *      counts before and after, and a deep audit adds the research steps;
 *   3. the engine's addresses: /nav carries a count for each tab with work
 *      waiting, /figures counts once what several pages show, the audits are
 *      listed and exported, every SEO task in one list with its filters and
 *      `open`, a task written by hand (the same words twice are one task),
 *      a note without a done mark, and the owner's own steps refused to others;
 *   4. every CSV of the section starts with the byte-order mark, whichever
 *      page wrote it;
 *   5. the task list opens from the Overview's access as well.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-cross-"));
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
const section = (t: string) => console.log(`\n${t}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---- the modules ------------------------------------------------------------ */
const { db } = await import("../src/db.ts");
const store = await import("../src/cc/store.ts");
const scheduler = await import("../src/cc/scheduler.ts");
const seo = await import("../src/cc/routes/seo.ts");
const shared = await import("../src/cc/routes/seo/shared.ts");
const audit = await import("../src/cc/seo/audit.ts");
const owner = await import("../src/cc/seo/owner.ts");
const figures = await import("../src/cc/seo/figures.ts");
const finder = await import("../src/cc/find.ts");
const seoFind = await import("../src/cc/seo/find.ts");
const grants = await import("../src/grants.ts");
const { apiError } = await import("../src/cc/api.ts");
const { Hono } = await import("hono");
import type { Person } from "../src/people.ts";
import type { Vars } from "../src/cc/access.ts";
import type { SearchHit } from "../web/src/contract/common.ts";

const OWNER = { telegram: 1, name: "Specimen Owner", email: "owner@specimen.invalid", owner: true, canPublish: true, seesLeads: true } as unknown as Person;
const MEMBER = { telegram: 2, name: "Specimen Member", email: "member@specimen.invalid", owner: false, canPublish: false, seesLeads: false } as unknown as Person;

/* A page that writes its CSV by hand, without the mark: loaded under a page's name before anything
   asks for that page, so the section's router hands it its requests (proof that the mark is added
   to every page's CSV, not only to those that use the shared writer). */
const pages = mkdtempSync(path.join(ROOT, "work", "check-seo-cross-"));
const bare = path.join(pages, "bare.ts");
writeFileSync(bare, 'import { Hono } from "hono";\nexport const routes = new Hono();\nroutes.get("/export.csv", (c) => c.body("Phrase,Note\\r\\nspecimen für,ä\\r\\n", 200, { "content-type": "text/csv; charset=utf-8" }));\n');
const bareLoad = await seo.loadPage("competitors", bare);

const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  const who = c.req.header("x-specimen-who");
  if (who) c.set("who", who === "owner" ? OWNER : MEMBER);
  await next();
});
app.route("/", seo.routes);
app.onError(apiError);
async function ask<T = Record<string, unknown>>(p: string, o: { who?: "owner" | "member"; method?: string; body?: unknown } = {}): Promise<{ status: number; json: T; text: string; bytes: Uint8Array; type: string; disposition: string }> {
  const res = await app.request(p, {
    method: o.method ?? "GET",
    headers: { ...(o.who ? { "x-specimen-who": o.who } : {}), ...(o.body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let json = {} as T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    /* a CSV */
  }
  return { status: res.status, json, text, bytes, type: res.headers.get("content-type") ?? "", disposition: res.headers.get("content-disposition") ?? "" };
}
const marked = (b: Uint8Array): boolean => b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
const count = (sql: string, ...a: (string | number)[]): number => (db.prepare(sql).get(...a) as { n: number }).n;

/* ---- specimen rows ------------------------------------------------------------ */
const NOW = new Date().toISOString();
const DAY = store.today();
function seed(): void {
  const cl = db.prepare("INSERT INTO cc_seo_clusters (key, name, lang, priority, page, source, first_seen, updated_at) VALUES (?, ?, ?, 'high', ?, 'specimen', ?, ?)");
  cl.run("specimen-cost:de", "Specimen website cost (DE)", "de", null, NOW, NOW);
  cl.run("specimen-brand:en", "Specimen brand (EN)", "en", "/specimen-a", NOW, NOW);
  const kw = db.prepare("INSERT INTO cc_seo_keywords (phrase, lang, cluster, sources, status, first_seen, last_seen) VALUES (?, 'de', ?, 'audit', ?, ?, ?)");
  kw.run("specimen agentur zürich", "specimen-cost:de", "relevant", NOW, NOW);
  kw.run("specimen agentur basel", "specimen-cost:de", "irrelevant", NOW, NOW);
  kw.run("specimen agentur", "specimen-cost:de", "unjudged", NOW, NOW);
  kw.run("specimen 50% rabatt", "specimen-cost:de", "weak", NOW, NOW);
  const comp = db.prepare("INSERT INTO cc_seo_competitors (domain, name, first_seen, updated_at) VALUES (?, ?, ?, ?)");
  comp.run("specimen-rival.example", "Specimen Rival GmbH", NOW, NOW);
  comp.run("name:Specimen Named Studio", "Specimen Named Studio", NOW, NOW);
  db.prepare("INSERT INTO cc_seo_sightings (domain, engine, kind, query, day, by) VALUES ('specimen-rival.example', 'google', 'organic', 'specimen agentur zürich', ?, 'specimen')").run(DAY);
  const opp = db.prepare(
    "INSERT INTO cc_seo_opps (id, type, page, keyword, cluster, title, evidence, priority, priority_why, action, state, active, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 'specimen', ?, ?, ?, ?, ?)",
  );
  opp.run("technical:title.long:/specimen-a", "technical", "/specimen-a", null, null, "Title is cut in results", "medium", "{}", "open", 1, NOW, NOW);
  opp.run("not-indexed:/specimen-b", "not-indexed", "/specimen-b", null, null, "Not in Google's index: specimen", "high", "{}", "open", 1, NOW, NOW);
  opp.run("entity:specimen-bing", "entity", null, null, null, "Set up the specimen webmaster account", "high", JSON.stringify({ ownerTaskId: "specimen-bing" }), "open", 1, NOW, NOW);
  opp.run("thin-content:/specimen-gone", "thin-content", "/specimen-gone", null, null, "Thin page: specimen", "low", "{}", "open", 0, NOW, NOW);
  owner.upsertOwnerTask({ id: "specimen-bing", step: "Create the specimen webmaster account and verify the specimen site.", why: "Specimen reason.", impact: "high", effort: "hours", who: "owner", origin: "SEO audit (specimen), 1 Jan 2026", sort: 1 });
  owner.upsertOwnerTask({ id: "specimen-code", step: "Add the specimen answer field to the specimen pages.", why: null, impact: "medium", effort: "days", who: "code", origin: "SEO audit (specimen), 1 Jan 2026", sort: 2 });
  owner.upsertOwnerTask({ id: "specimen-chrome", step: "Request indexing for the specimen page in the owner's browser.", why: null, impact: "low", effort: "hours", who: "lead-chrome", origin: "SEO audit (specimen), 1 Jan 2026", sort: 3 });
  const iss = db.prepare("INSERT INTO cc_issues (id, rule, severity, path, text, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)");
  iss.run("title.long|/specimen-a", "title.long", "warning", "/specimen-a", "Title is 64 characters; over 60 is cut in results.", NOW, NOW);
  iss.run("content.thin|/specimen-c", "content.thin", "opportunity", "/specimen-c", "Own content is 99 words.", NOW, NOW);
  store.record("seo.opps.open", 3);
}

try {
  seed();

  /* ============ 1. the search box ============================================== */
  section("1. the top bar's search box finds the SEO section's things");
  {
    const hits = await finder.find("agentur", OWNER);
    const kw = hits.filter((h) => h.kind === "keyword" && h.href.startsWith("/seo/keywords?q="));
    const zurich = kw.find((h) => h.title === "specimen agentur zürich");
    const id = (db.prepare("SELECT id FROM cc_seo_keywords WHERE phrase = 'specimen agentur zürich'").get() as { id: number }).id;
    check("a tracked phrase is found by a word of it, leading to its own view on Keywords", !!zurich && zurich.href === `/seo/keywords?q=${encodeURIComponent("specimen agentur zürich")}&status=all&open=${id}`, kw);
    const close = (await finder.find("specimen agentur", OWNER)).filter((h) => h.kind === "keyword").map((h) => h.title);
    check("  the whole phrase first, then by judgement: relevant before irrelevant", close.join("|") === "specimen agentur|specimen agentur zürich|specimen agentur basel", close);
    check("  and the second line says how it was judged and its cluster", /Tracked phrase, relevant · Specimen website cost \(DE\)/.test(zurich?.sub ?? ""), zurich);
    const pct = await finder.find("50%", OWNER);
    check("LIKE's own wildcards are escaped: '50%' finds the phrase with a percent sign and nothing else", pct.filter((h) => h.kind === "keyword" && !h.href.includes("research=")).map((h) => h.title).join("|") === "specimen 50% rabatt", pct);
    check("  a phrase nobody tracks is offered for research on the web (?research=), which asks nothing until pressed", pct.some((h) => h.href === "/seo/keywords?research=50%25"), pct);
    check("  a tracked phrase typed whole is not offered for research again", !(await finder.find("specimen agentur", OWNER)).some((h) => h.href.includes("research=")));
    const unknownSite = await finder.find("https://www.other-studio.example/about", OWNER);
    check("  a domain not on the list is offered for a lookup on Competitors (?look=)", unknownSite.some((h) => h.href === "/seo/competitors?look=other-studio.example") && !unknownSite.some((h) => h.href.includes("research=")), unknownSite);
    check("  one on the list is not", !(await finder.find("specimen-rival.example", OWNER)).some((h) => h.href.includes("look=")));

    const byDomain = await finder.find("specimen-rival.example", OWNER);
    const rival = byDomain.find((h) => h.href === "/seo/competitors?open=specimen-rival.example");
    check("a competitor is found by its domain and opens on Competitors (?open=<domain>)", !!rival && /Competitor · Specimen Rival GmbH · seen in Google for 1 of our searches/.test(rival.sub ?? ""), byDomain);
    const pasted = await finder.find("https://www.specimen-rival.example/leistungen", OWNER);
    check("  and by an address pasted whole", pasted.some((h) => h.href === "/seo/competitors?open=specimen-rival.example"), pasted);
    const named = await finder.find("named studio", OWNER);
    check("  one known only by name, by that name", named.some((h) => h.title === "Specimen Named Studio" && h.href === `/seo/competitors?open=${encodeURIComponent("name:Specimen Named Studio")}`), named);

    const byPage = await finder.find("/specimen-a", OWNER);
    check("an opportunity is found by its page and opens on Opportunities", byPage.some((h) => h.href === `/seo/opportunities?open=${encodeURIComponent("technical:title.long:/specimen-a")}` && h.title === "Title is cut in results: /specimen-a"), byPage);
    check("  a crawl finding on that page opens the page on SEO › Pages with its rule", byPage.some((h) => h.href === "/seo/pages?finding=title.long&open=%2Fspecimen-a" && /^SEO issue · warning/.test(h.sub ?? "")), byPage);
    check("  one the rules no longer find is not offered", !(await finder.find("specimen-gone", OWNER)).some((h) => h.href.includes("thin-content")));
    const byRule = await finder.find("thin", OWNER);
    check("a finding is found by the rule's name", byRule.some((h) => h.href === "/seo/pages?finding=content.thin&open=%2Fspecimen-c"), byRule);

    const task = await finder.find("webmaster account", OWNER);
    check("an SEO task is found by its words and opens the list of every task on it", task.some((h) => h.href === "/seo/list/tasks?open=specimen-bing" && /SEO task · the owner's own step/.test(h.sub ?? "")), task);
    check("  and the opportunity waiting on it as well", task.some((h) => h.href === `/seo/opportunities?open=${encodeURIComponent("entity:specimen-bing")}`), task);

    const gap = await finder.find("website cost", OWNER);
    check("a cluster no page answers opens as a gap on Content Gaps", gap.some((h) => h.href === `/seo/content-gaps?view=clusters&open=${encodeURIComponent("specimen-cost:de")}` && /3 tracked phrases · no page answers it yet/.test(h.sub ?? "")), gap);
    const brand = await finder.find("specimen brand", OWNER);
    check("  one a page answers lists its phrases on Keywords", brand.some((h) => h.href === `/seo/keywords?cluster=${encodeURIComponent("specimen-brand:en")}&status=all`), brand);

    /* Search Console's queries still come as /seo?open=<query> from src/cc/search/index.ts: a stand-in for that searcher. */
    finder.registerSearch(() => [
      { kind: "keyword", title: "specimen agentur zürich", sub: "Google Search, specimen: 2 clicks", href: "/seo?open=specimen%20agentur%20z%C3%BCrich" },
      { kind: "keyword", title: "Specimen Untracked Query", sub: "Google Search, specimen: 1 click", href: "/seo?open=Specimen%20Untracked%20Query" },
    ]);
    const again = await finder.find("specimen", OWNER);
    check(
      "a keyword hit that led to the earlier screen now leads to the Keywords page",
      again.some((h) => h.kind === "keyword" && h.href === "/seo/keywords?q=specimen%20untracked%20query&status=all") && !again.some((h) => h.href.startsWith("/seo?open=")),
      again.filter((h) => h.kind === "keyword"),
    );
    check("  a phrase both Search Console and the keyword table know is listed once", again.filter((h) => h.kind === "keyword" && h.title.toLowerCase() === "specimen agentur zürich").length === 1, again.filter((h) => h.kind === "keyword"));
    check("keywordView opens a tracked phrase and only lists one that is not", finder.keywordView("Specimen  Agentur Zürich").endsWith(`&open=${id}`) && !finder.keywordView("nothing tracked").includes("&open="));

    const narrowed = { ...(MEMBER as object), grants: { seo: "view", "page:seo/keywords": "none" } } as unknown as Person;
    const theirs = await finder.find("agentur", narrowed);
    check("access follows where a hit leads: Keywords switched off, no phrase; Competitors still open", !theirs.some((h) => h.href.startsWith("/seo/keywords")) && (await finder.find("specimen-rival", narrowed)).some((h) => h.href.startsWith("/seo/competitors")), theirs);
    const kinds = new Set(["page", "insight", "keyword", "lead", "asset", "section"]);
    const all: SearchHit[] = [...hits, ...byDomain, ...byPage, ...task, ...gap];
    check("every hit is of a kind the palette draws (it drops any other)", all.every((h) => kinds.has(h.kind)), [...new Set(all.map((h) => h.kind))]);
    /* Two more sources of eight each, as the crawl's pages and the website's files are: the SEO section's hits still fit. */
    const filler = (k: string) => () => Array.from({ length: 8 }, (_, i): SearchHit => ({ kind: "asset", title: `specimen ${k} ${i}`, href: `/assets?open=%2Fspecimen-${k}-${i}` }));
    finder.registerSearch(filler("a"), filler("b"));
    const spread = await finder.find("specimen", OWNER);
    check("the box lists up to forty, so two full sources cannot push the SEO section's things out", spread.length > 20 && spread.length <= 40 && spread.some((h) => h.href.startsWith("/seo/list/tasks")), spread.length);
    check("the searchers are exported for the integrator", typeof seoFind.phrases === "function" && typeof seoFind.findingHits === "function");
  }

  /* ============ 2. the full audit =============================================== */
  section("2. the full SEO audit");
  {
    const ran: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const job = (name: string, o: { ready?: boolean; fail?: string; wait?: Promise<void> } = {}) => ({
      name,
      title: `Specimen ${name}`,
      every: 86_400,
      ready: () => o.ready !== false,
      run: async () => {
        ran.push(name);
        if (o.wait) await o.wait;
        if (o.fail) throw new Error(o.fail);
        return `specimen ${name} done`;
      },
    });
    scheduler.register(
      job("sitemap", { wait: gate }),
      job("crawl"),
      job("gsc-daily"),
      job("gsc-inspect"),
      job("seo-snapshot"),
      job("speed", { fail: "specimen: PageSpeed answered 429" }),
      job("seo-readiness"),
      job("seo-referrals"),
      job("seo-presence", { ready: false }),
      job("seo-research"),
      job("seo-competitors"),
      job("seo-engine"),
    );
    check("every step names a job the desk has", audit.STEPS.every((s) => scheduler.status().some((j) => j.name === s.job)), audit.STEPS.map((s) => s.job));
    check(
      "the steps are the stated ones, in order, the opportunity engine last",
      audit.STEPS.map((s) => s.job).join(",") === "sitemap,crawl,gsc-daily,gsc-inspect,seo-snapshot,speed,seo-readiness,seo-referrals,seo-presence,seo-research,seo-competitors,seo-engine" &&
        audit.STEPS.filter((s) => s.deep).map((s) => s.job).join(",") === "seo-research,seo-competitors",
    );

    /* The crawl and the index check finished well a minute ago; the index check's newest day was cut short. */
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    db.prepare("UPDATE cc_jobs SET last_start = ?, last_end = ?, last_ok = 1 WHERE name IN ('crawl', 'gsc-inspect')").run(minuteAgo, minuteAgo);
    db.prepare("INSERT INTO cc_inspect (day, url, is_indexed, checked_at) VALUES (?, 'https://www.balkaris.ch/specimen-a', 1, ?), (?, 'https://www.balkaris.ch/specimen-b', 0, ?)").run(DAY, NOW, DAY, NOW);
    store.record("gsc.sitemap_addresses", 5);
    store.record("gsc.inspected", 2);
    check("the index check's newest day reads as cut short (2 of 5)", figures.indexCheckWhole() === false && figures.indexFigures()?.complete === false, figures.indexFigures());

    /* The sitemap read is already running when the audit is asked for. */
    scheduler.runNow("sitemap");
    await sleep(150);
    check("  (the sitemap read is running)", scheduler.status().find((j) => j.name === "sitemap")?.running === true);
    const first = audit.startAudit(OWNER);
    check("the audit starts, step by step", first.state === "running" && first.steps.length === 10 && !first.steps.some((s) => s.job === "seo-research"), first.steps.map((s) => `${s.job}:${s.state}`));
    const second = audit.startAudit(MEMBER);
    check("a second press while it runs answers the audit running, not a second one", second.id === first.id);
    release();

    const until = async (id: string): Promise<ReturnType<typeof audit.auditRun>> => {
      const end = Date.now() + 60_000;
      let r = audit.auditRun();
      while (Date.now() < end && (!r || r.id !== id || r.state === "running")) {
        await sleep(100);
        r = audit.auditRun();
      }
      return r;
    };
    const done = await until(first.id);
    const by = (j: string) => done?.steps.find((s) => s.job === j);
    check("it ends", !!done && done.state !== "running" && !!done.finishedAt, done);
    check("  a job already running when its turn came was followed, not asked twice", ran.filter((n) => n === "sitemap").length === 1 && by("sitemap")?.state === "done" && /already running/.test(by("sitemap")?.note ?? ""), { ran, step: by("sitemap") });
    check("  a run that finished well a minute ago is used instead of a new one", by("crawl")?.state === "skipped" && /finished 1 minute ago; that run is used/.test(by("crawl")?.note ?? "") && !ran.includes("crawl"), by("crawl"));
    check("  the index check runs again although fresh, because its last day was cut short", by("gsc-inspect")?.state === "done" && ran.includes("gsc-inspect"), by("gsc-inspect"));
    check("  a job that cannot run is skipped with the reason", by("seo-presence")?.state === "skipped" && /not connected/.test(by("seo-presence")?.note ?? ""), by("seo-presence"));
    check("  a failed step says what it said, and the rest still ran", by("speed")?.state === "failed" && /429/.test(by("speed")?.note ?? "") && by("seo-engine")?.state === "done" && done?.state === "failed", by("speed"));
    check("  the steps ran in the stated order, the engine last, nothing deep", ran.join(",") === "sitemap,gsc-daily,gsc-inspect,seo-snapshot,speed,seo-readiness,seo-referrals,seo-engine", ran);
    const row = db.prepare("SELECT * FROM cc_seo_audits WHERE id = ?").get(first.id) as { state: string; before: string; after: string | null; finished_at: string | null } | undefined;
    check("  the audit is kept with the counts as it started and as it ended", row?.state === "failed" && !!row.after && !!row.finished_at && JSON.parse(row.before).opportunities === 3, row);
    check("  its end is written to the activity, with the link to its page", count("SELECT COUNT(*) AS n FROM cc_activity WHERE kind = 'seo-action' AND text LIKE 'The full SEO audit ended with 1 step failed%' AND href = ?", audit.auditHref(first.id)) === 1);

    ran.length = 0;
    db.prepare("UPDATE cc_jobs SET last_end = ?, last_start = ? WHERE name = 'crawl'").run(minuteAgo, minuteAgo);
    const deep = audit.startAudit(OWNER, { deep: true });
    const deepDone = await until(deep.id);
    check("a deep audit adds the phrase research and the competitors' pages, before the engine", deep.deep === true && ran.indexOf("seo-research") > -1 && ran.indexOf("seo-competitors") > ran.indexOf("seo-research") && ran.at(-1) === "seo-engine" && deepDone?.state !== "running", ran);

    const list = await ask<{ audits: { id: string; deep: boolean; after: unknown; changes: unknown }[]; steps: { job: string; deep: boolean }[]; open: { id: string } | null }>(`/audits?open=${encodeURIComponent(first.id)}`, { who: "member" });
    check("GET /audits lists both, newest first, each with its counts and changes", list.status === 200 && list.json.audits.length === 2 && list.json.audits[0]!.id === deep.id && list.json.audits[0]!.deep && !!list.json.audits[1]!.after && !!list.json.audits[1]!.changes, list.json);
    check("  the plan of steps, deep ones marked", list.json.steps.length === 12 && list.json.steps.filter((s) => s.deep).length === 2);
    check("  ?open=<id> adds that audit with what it found", list.json.open?.id === first.id);
    const one = await ask<{ found: { opportunities: unknown[] } }>(`/audits/${encodeURIComponent(first.id)}`, { who: "member" });
    check("GET /audits/:id answers one audit with what it found", one.status === 200 && Array.isArray(one.json.found?.opportunities), one.json);
    const none = await ask("/audits/1999-01-01T00:00:00.000Z", { who: "member" });
    check("  an id nothing is kept under is 404 { error }", none.status === 404 && typeof none.json.error === "string", none.json);
    const exp = await ask(`/audits/${encodeURIComponent(first.id)}/export.csv`, { who: "member" });
    check("its export is a CSV with the byte-order mark and CRLF rows", exp.status === 200 && exp.type.startsWith("text/csv") && marked(exp.bytes) && exp.text.includes("\r\nstep,") && /^attachment; filename="balkaris-seo-audit-/.test(exp.disposition), exp.text.slice(0, 200));
    const head = shared.head("30d");
    check("every page's head carries the audit for an hour after it ended", head.audit?.id === deep.id);
  }

  /* ============ 3. the engine's addresses ======================================== */
  section("3. the tab strip's counts, the shared figures, every SEO task");
  {
    const nav = await ask<{ state: string; value: { opportunities: number; needsYou: number; indexRequests: number; tabs: { key: string; count: number | null; countSays?: string; todo?: boolean }[]; figures: { opportunities: number; keywords: { tracked: number; unjudged: number } } } }>("/nav", { who: "member" });
    const v = nav.json.value;
    const tab = (k: string) => v.tabs.find((t) => t.key === k);
    const open = count("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE active = 1 AND state IN ('open', 'queued', 'in-progress')");
    check("/nav: Opportunities carries the open count", nav.json.state === "ok" && v.opportunities === open && tab("opportunities")?.count === open && tab("opportunities")?.countSays === "open", v);
    check("  the Overview the owner's steps still open, as work waiting", tab("overview")?.count === 1 && tab("overview")?.todo === true && tab("overview")?.countSays === "step needs you", tab("overview"));
    check("  Keywords the phrases nobody judged", tab("keywords")?.count === 1 && tab("keywords")?.todo === true, tab("keywords"));
    check("  Technical the pages waiting for Request indexing", tab("technical")?.count === 1 && /Request indexing/.test(tab("technical")?.countSays ?? ""), tab("technical"));
    check("  a tab with nothing waiting draws no count, never a 0", tab("backlinks")?.count === null && tab("pages")?.count === null);
    const fig = await ask<{ state: string; value: { opportunities: number; keywords: { tracked: number; all: number }; index: { indexed: number; complete: boolean } | null } }>("/figures", { who: "member" });
    check("/figures counts once what several pages show: the same open count as /nav", fig.json.state === "ok" && fig.json.value.opportunities === v.opportunities);
    check("  tracked phrases are every phrase nobody judged irrelevant (3 of 4)", fig.json.value.keywords.tracked === 3 && fig.json.value.keywords.all === 4, fig.json.value.keywords);
    check("  what Google has indexed, with the cut-short day said so", fig.json.value.index?.indexed === 1 && fig.json.value.index.complete === false, fig.json.value.index);

    type Tasks = { asked: { who: string; done: string }; tasks: { id: string; mayMark: boolean; href: string; doer: string }[]; counts: { all: number; open: number }; open: { id: string } | null };
    const all = await ask<Tasks>("/owner-tasks", { who: "member" });
    check("GET /owner-tasks: every task, whoever does it, open ones by default", all.status === 200 && all.json.tasks.length === 3 && all.json.counts.all === 3 && all.json.asked.done === "open", all.json);
    check("  a task with an opportunity waiting on it leads there", all.json.tasks.find((t) => t.id === "specimen-bing")?.href === `/seo/opportunities?open=${encodeURIComponent("entity:specimen-bing")}`);
    check("  the owner's own step is not the member's to mark", all.json.tasks.find((t) => t.id === "specimen-bing")?.mayMark === false && all.json.tasks.find((t) => t.id === "specimen-code")?.mayMark === true);
    const code = await ask<Tasks>("/owner-tasks?who=code&open=specimen-bing", { who: "member" });
    check("  ?who= filters, and ?open= adds one task whatever the filters", code.json.tasks.length === 1 && code.json.tasks[0]!.doer === "code" && code.json.open?.id === "specimen-bing", code.json);
    const words = await ask<Tasks>("/owner-tasks?q=answer%20field", { who: "member" });
    check("  ?q= finds by the task's words", words.json.tasks.map((t) => t.id).join() === "specimen-code", words.json.tasks);

    let a = await ask<{ ok: boolean; added: boolean; task: { id: string; from: string; who: string } }>("/owner-tasks", { who: "member", method: "POST", body: { step: "Submit the specimen sitemap again in Search Console.", why: "Specimen.", impact: "low", who: "lead-chrome" } });
    check("POST /owner-tasks writes a task by hand, by name", a.status === 200 && a.json.added === true && /^By hand, Specimen Member/.test(a.json.task.from), a.json);
    const handId = a.json.task.id;
    a = await ask("/owner-tasks", { who: "member", method: "POST", body: { step: "Submit the  specimen sitemap again in Search Console." } });
    check("  the same words twice are one task", a.status === 200 && a.json.added === false && a.json.task.id === handId, a.json);
    a = await ask("/owner-tasks", { who: "member", method: "POST", body: { step: "short" } });
    check("  a step that says nothing is refused 400 { error }", a.status === 400 && typeof (a.json as unknown as { error: string }).error === "string");
    a = await ask("/owner-tasks", { who: "member", method: "POST", body: { step: "A specimen step for nobody.", who: "nobody" } });
    check("  so is a doer the desk does not know", a.status === 400);

    let n = await ask<{ task: { note: string | null; done: boolean } }>("/owner-tasks/specimen-code", { who: "member", method: "POST", body: { note: "Specimen note: waiting for the release." } });
    check("a note alone is written without touching the done mark", n.status === 200 && n.json.task.note === "Specimen note: waiting for the release." && n.json.task.done === false, n.json);
    n = await ask("/owner-tasks/specimen-code", { who: "member", method: "POST", body: { done: true } });
    check("  then marked done, the note kept", n.status === 200 && n.json.task.done === true && n.json.task.note === "Specimen note: waiting for the release.", n.json);
    n = await ask("/owner-tasks/specimen-code", { who: "member", method: "POST", body: { note: "" } });
    check("  an empty note clears it", n.status === 200 && n.json.task.note === null, n.json);
    n = await ask("/owner-tasks/specimen-bing", { who: "member", method: "POST", body: { note: "Specimen." } });
    check("the owner's own step: a member may not even note it (403 { error })", n.status === 403 && /Only the owner/.test((n.json as unknown as { error: string }).error), n.json);
    n = await ask("/owner-tasks/specimen-bing", { who: "owner", method: "POST", body: { done: true } });
    check("  the owner marks it, by name", n.status === 200 && (n.json.task as unknown as { doneBy: string }).doneBy === "Specimen Owner");
    check("  and its activity line leads to the Overview, another task's to the list", count("SELECT COUNT(*) AS n FROM cc_activity WHERE text LIKE 'Marked done: Create the specimen%' AND href = '/seo#needs-you'") === 1 && count("SELECT COUNT(*) AS n FROM cc_activity WHERE text LIKE 'Marked done: Add the specimen%' AND href = '/seo/list/tasks?open=specimen-code'") === 1);
    const csv = await ask("/owner-tasks/export.csv?done=all", { who: "member" });
    check("the task list exports as CSV with the mark, CRLF rows, every matching task", csv.status === 200 && marked(csv.bytes) && csv.text.split("\r\n").filter(Boolean).length === 1 + 4 && /^attachment; filename="balkaris-seo-tasks-\d{4}-\d\d-\d\d\.csv"$/.test(csv.disposition), [csv.disposition, csv.text.slice(0, 160)]);

    /* The task list's "Import the audit's files" (the owner's alone): one line per table, never the machine's folders. */
    const imp = await ask<{ ok: boolean; lines: string[] }>("/imports/audit", { who: "member", method: "POST", body: {} });
    check("the audit's files are the owner's to import: a member is refused 403 { error }", imp.status === 403, imp.json);
    const own = await ask<{ ok: boolean; lines: string[] }>("/imports/audit", { who: "owner", method: "POST", body: {} });
    check(
      "  the owner's import answers one line per table, a missing file by its own name",
      own.status === 200 && own.json.ok === true && own.json.lines.length >= 6 && !own.json.lines.some((l) => /[A-Za-z]:[\\/]|[\\/]work[\\/]/.test(l)),
      own.json,
    );
  }

  /* ============ 4. every CSV carries the mark ===================================== */
  section("4. every CSV of the section starts with the byte-order mark");
  {
    check("  (a page that writes its CSV by hand is loaded)", bareLoad?.state === "ok", bareLoad);
    const r = await ask("/competitors/export.csv", { who: "member" });
    check("a page's own CSV without the mark is given it on the way out", r.status === 200 && marked(r.bytes) && r.text.endsWith("ä\r\n") && r.text.includes("für"), [...r.bytes.slice(0, 6)]);
    const twice = shared.csvText(["a"], [["b"]]);
    check("the shared writer's text has it once, with CRLF and a formula guarded", twice.startsWith("﻿") && !twice.slice(1).includes("﻿") && shared.csvCell("=SUM(A1)") === "'=SUM(A1)" && shared.csvCell('a "b", c') === '"a ""b"", c"');
    const json = await ask("/nav", { who: "member" });
    check("  and a JSON answer is left alone", json.status === 200 && !marked(json.bytes));
  }

  /* ============ 5. access ======================================================= */
  section("5. access");
  {
    const overviewOnly = { ...(MEMBER as object), grants: { seo: "edit", "page:seo/content-gaps": "none", "page:seo/backlinks": "none", "page:seo/automations": "none" } } as unknown as Person;
    check("the task list opens to somebody given the Overview alone (its 'Needs you' is part of it)", grants.judge(overviewOnly, "/api/v1/seo/owner-tasks", "GET").ok && grants.judge(overviewOnly, "/api/v1/seo/owner-tasks/specimen-code", "POST").ok);
    const noOverview = { ...(MEMBER as object), grants: { seo: "edit", "page:seo": "none", "page:seo/content-gaps": "none", "page:seo/backlinks": "none", "page:seo/automations": "none" } } as unknown as Person;
    check("  and not to somebody with none of the pages that draw it", !grants.judge(noOverview, "/api/v1/seo/owner-tasks", "GET").ok);
    check("the list's address in the interface is the Overview's, as the search box filters it", grants.pageOfHref("/seo/list/tasks?open=x")?.key === "seo" && grants.pageOfHref("/seo/list/audits")?.key === "seo");
    check("the audits and the shared figures are the section's: open with any SEO page", grants.judge(overviewOnly, "/api/v1/seo/audits", "GET").ok && grants.judge(overviewOnly, "/api/v1/seo/figures", "GET").ok);
  }

  check("nothing tried to leave the machine", refused.length === 0, refused);
} catch (e) {
  failed++;
  console.log(`FAIL the check itself threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
} finally {
  rmSync(pages, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
try {
  db.close();
} catch {
  /* already closed */
}
rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
