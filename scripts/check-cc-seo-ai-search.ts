/**
 * SEO › AI Search, proved without the website, Google, GA4 or a model.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-ai-search.ts
 *   npm run check:seo-ai-search
 *
 * Nothing leaves this machine: a throwaway database, a guard on `fetch` that
 * refuses every host, and the readiness check's own `wire` replaced by a
 * stand-in website. Every page, phrase, name and answer in here is a
 * SPECIMEN, made up and named so; none describes the real website.
 *
 * What is proved:
 *   1. readiness: FAQPage compared with the visible questions by their words
 *      (an accordion's "+" is not part of a question); a robots.txt that
 *      answers 402 is "could not be read", never "blocks every crawler"; a run
 *      that reads nothing erases nothing and says why; a page that fails
 *      keeps its last good read; one request a second; "Check again";
 *   2. the page: every filter, search and opened row from the address, and
 *      anything else is the default;
 *   3. the answers: tracked questions with empty cells, a search over names
 *      and sources, one assistant, an opened question with what changed;
 *      a retired question leaves every count and comes back;
 *   4. recording: one answer, a round typed or pasted (with its skipped lines),
 *      a correction (the audit's record becomes a person's), a removal and its
 *      sightings, the owner's alone; Google's AI Overview filed as google-aio;
 *   5. the levers: a cut-short URL Inspection day is not the whole sitemap; the
 *      Bing lever leads to Settings › Sources;
 *   6. where the answers look: a source "Google" is not the Business Profile,
 *      Balkaris's own site is never a directory, local.ch's task is found;
 *   7. this page's own doors: an opportunity's code step, an owner mark, an
 *      operator task (refused without the AI Operator, never longer than the
 *      queue takes), the readiness run, the CSVs; every one of them under
 *      /api/v1/seo/ai-search, so the page's switch covers them;
 *   8. questions people search: question-shaped phrases with Search Console's
 *      impressions, and whether they are tracked.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-ai-search-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "SITE_READ_REPO", "SITE_REPO", "DESK_DEV_USER"]) delete process.env[k];
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
const section = (s: string) => console.log(`\n${s}`);

/* ---- the modules ------------------------------------------------------------ */

const { db } = await import("../src/db.ts");
const store = await import("../src/cc/store.ts");
await import("../src/cc/search/gsc.ts");
await import("../src/cc/site/crawl.ts");
const aisearch = await import("../src/cc/seo/aisearch.ts");
const readiness = await import("../src/cc/seo/readiness.ts");
const collector = await import("../src/cc/seo/index.ts");
const scheduler = await import("../src/cc/scheduler.ts");
const seo = await import("../src/cc/routes/seo.ts");
const grants = await import("../src/grants.ts");
const { apiError } = await import("../src/cc/api.ts");
const { Hono } = await import("hono");
import type { Person } from "../src/people.ts";
import type { Vars } from "../src/cc/access.ts";
import type { AiDone, NewAiCheck, PageCheckAnswer, PageReadinessAnswer, RecordAnswer, RoundAnswer, SeoAiSearchPayload } from "../web/src/contract/seo/ai-search.ts";

const OWNER = { telegram: 1, name: "Specimen Owner", email: "owner@specimen.invalid", owner: true, canPublish: true, seesLeads: true } as unknown as Person;
/* A member with SEO on edit and the AI Operator off. */
const MEMBER = { telegram: 2, name: "Specimen Member", email: "member@specimen.invalid", owner: false, canPublish: false, seesLeads: false, grants: { seo: "edit", operator: "none" } } as unknown as Person;

const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  const who = c.req.header("x-specimen-who");
  if (who) c.set("who", who === "owner" ? OWNER : MEMBER);
  await next();
});
app.route("/", seo.routes);
app.onError(apiError);
async function ask<T = Record<string, unknown>>(p: string, o: { who?: "owner" | "member"; method?: string; body?: unknown } = {}): Promise<{ status: number; json: T; text: string; type: string }> {
  const res = await app.request(p, {
    method: o.method ?? "GET",
    headers: { "x-specimen-who": o.who ?? "owner", ...(o.body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  });
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  let json = {} as T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    /* a CSV */
  }
  return { status: res.status, json, text, type };
}
const page = async (q = ""): Promise<SeoAiSearchPayload> => (await ask<SeoAiSearchPayload>(`/ai-search${q ? `?${q}` : ""}`)).json;
const count = (sql: string, ...a: (string | number)[]): number => (db.prepare(sql).get(...a) as { n: number }).n;
const now = new Date().toISOString();
const day = (offset: number) => store.today(offset);

/* ---- the specimen website: a crawl, a sitemap ---------------------------- */

const PAGES = [
  { path: "/specimen-service", kind: "service", lang: "en", title: "Specimen Service | Balkaris" },
  { path: "/specimen-dienst", kind: "service", lang: "de", title: "Specimen Dienst | Balkaris" },
  { path: "/specimen-legal", kind: "legal", lang: "en", title: "Specimen Legal | Balkaris" },
];
const putPage = db.prepare("INSERT OR REPLACE INTO cc_pages (path, kind, status, in_sitemap, listed_by, title, fetched, facts, first_seen, last_seen) VALUES (?, ?, 200, 1, 'sitemap', ?, ?, ?, ?, ?)");
for (const p of PAGES) putPage.run(p.path, p.kind, p.title, JSON.stringify({ hops: [] }), JSON.stringify({ lang: p.lang, words: 300, links: { internal: 5, external: 0 }, og: { image: null }, schemaTypes: [] }), now, now);
store.setState("site:crawl:finished", now);
store.keep("site:sitemap", { at: now, status: 200, entries: PAGES.map((p) => ({ path: p.path, loc: `https://www.balkaris.ch${p.path}`, lastmod: "2026-10-01", priority: null })), issues: [] });

/* The stand-in website: what each address answers, and every request it was asked, with when. */
const site: Record<string, { status: number; html: string | null; contentType?: string }> = {};
const asked: { url: string; at: number }[] = [];
let clock = 1_000_000;
const slept: number[] = [];
readiness.wire.fetchPage = async (url: string) => {
  asked.push({ url, at: clock });
  const p = new URL(url).pathname;
  const got = site[p] ?? { status: 404, html: null };
  return { status: got.status, url, html: got.html, contentType: got.contentType ?? "text/html", error: got.status ? null : "no answer in time" };
};
readiness.wire.sleep = async (ms: number) => {
  slept.push(ms);
  clock += ms;
};
/* The polite clock reads Date.now(): the stand-in clock runs it, so a run takes no real second. */
Date.now = () => clock;

const faqPage = (marked: string[], shown: string[]) => `<!doctype html><html lang="en"><head><title>Specimen</title>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: marked.map((q) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: "Specimen answer." } })) })}</script>
</head><body><main><h1>Specimen service</h1>
<p>Specimen studio in Zürich, Switzerland, answers the question this page is about in one paragraph of fifty words or so: what the specimen service is, who it is for, how long it takes (four to six weeks), and what it costs from CHF 4,000. Balkaris does the work in Zürich for clients in Switzerland.</p>
<h2>FAQ</h2>${shown.map((q) => `<div><button aria-expanded="false">${q} <i aria-hidden="true">+</i></button><div>Specimen answer.</div></div>`).join("")}
</main></body></html>`;

const Q = ["How long does a specimen project take?", "What does a specimen service cost?", "Who does the specimen work?", "Can the specimen be in German?", "Do you work outside Zürich?"];

try {
  /* ============ 1. readiness ================================================ */
  section("1. readiness: what a page and the site say, and what a run could not read");
  {
    const three = readiness.judgePage(faqPage(Q.slice(0, 3), Q), "service", "2026-10-01");
    const schema = three.find((c) => c.key === "faq-schema")!;
    const faq = three.find((c) => c.key === "faq")!;
    check("an accordion's questions count, its '+' decoration left out", faq.state === "pass" && /5 questions/.test(faq.detail), faq);
    check("FAQPage with three of five visible questions fails and names one left out", schema.state === "fail" && /3 of the 5/.test(schema.detail) && schema.detail.includes(Q[3]!), schema);
    const all = readiness.judgePage(faqPage(Q, Q), "service", "2026-10-01").find((c) => c.key === "faq-schema")!;
    check("FAQPage with every visible question passes", all.state === "pass", all);

    /* A first run that reads the site, then a day the host answers 402 for everything. */
    for (const p of PAGES) site[p.path] = { status: 200, html: faqPage(Q.slice(0, 3), Q) };
    site["/robots.txt"] = { status: 200, html: "User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n", contentType: "text/plain" };
    site["/llms.txt"] = { status: 404, html: null };
    asked.length = 0;
    slept.length = 0;
    const said = await readiness.checkReadiness();
    check("a run that reads the site says what it read", /3 of 3 pages read/.test(said), said);
    const gaps = asked.slice(1).map((r, i) => r.at - asked[i]!.at);
    check("one request a second to the website, never closer", gaps.length >= 4 && gaps.every((g) => g >= 1000), gaps);
    const robots = readiness.siteReadiness()!.checks.find((c) => c.key === "robots")!;
    check("a robots.txt that disallows GPTBot is a fail naming it", robots.state === "fail" && /GPTBot/.test(robots.detail), robots);
    const llms = readiness.siteReadiness()!.checks.find((c) => c.key === "llms")!;
    check("a 404 for /llms.txt is an answer: there is none", llms.state === "fail" && /answers 404/.test(llms.detail), llms);

    for (const k of Object.keys(site)) site[k] = { status: 402, html: "Payment required" };
    let thrown = "";
    try {
      await readiness.checkReadiness();
    } catch (e) {
      thrown = e instanceof Error ? e.message : String(e);
    }
    check("a run that reads nothing fails with how the site answered", /None of the 3 sitemap pages could be read: the website answered 402 \(payment required\)/.test(thrown), thrown);
    const kept = readiness.pageReadiness();
    check("every page keeps its last good read, marked unread", kept.pages.length === 3 && kept.pages.every((p) => p.unread && /402/.test(p.unread.why) && p.checks.length > 0), kept.pages.map((p) => [p.path, p.unread]));
    check("the site-wide checks are not replaced by a run that read nothing", readiness.siteReadiness()!.checks.find((c) => c.key === "robots")!.state === "fail");
    const run = readiness.lastRun()!;
    check("the last run says what it could not read", run.read === 0 && run.pages === 3 && /402/.test(run.why ?? ""), run);

    /* A run where the pages answer and robots.txt does not: not read is never "blocked". */
    for (const p of PAGES) site[p.path] = { status: 200, html: faqPage(Q, Q) };
    site["/robots.txt"] = { status: 402, html: "Payment required" };
    site["/llms.txt"] = { status: 503, html: "unavailable" };
    await readiness.checkReadiness();
    const s = readiness.siteReadiness()!;
    const r402 = s.checks.find((c) => c.key === "robots")!;
    check("a robots.txt answering 402 is 'could not be read', not 'blocks every crawler'", r402.state === "unknown" && /answered 402/.test(r402.detail) && !/blocks/.test(r402.detail) && r402.fix === null, r402);
    check("no crawler is listed as blocked when robots.txt was not read", s.robots.agents.length === 0 && s.robots.read === false, s.robots);
    check("a /llms.txt answering 503 is not read either, and asks no change", s.checks.find((c) => c.key === "llms")!.state === "unknown" && s.checks.find((c) => c.key === "llms")!.fix === null);
    check("pages read again lose their 'unread' mark", readiness.pageReadiness().pages.every((p) => !p.unread));

    /* "Check again": one page now. */
    site["/specimen-dienst"] = { status: 402, html: null };
    const again = await readiness.checkPage("/specimen-dienst");
    check("Check again on a page that answers 402 keeps its last good read and says so", !again.ok && again.kept && /answered 402/.test(again.why), again);
    site["/specimen-dienst"] = { status: 200, html: faqPage(Q.slice(0, 2), Q) };
    const fresh = await readiness.checkPage("/specimen-dienst");
    check("Check again on a page that answers 200 judges it now", fresh.ok && fresh.checks.find((c) => c.key === "faq-schema")?.state === "fail");
    const none = await readiness.checkPage("/specimen-nowhere");
    check("Check again on an address the crawl does not know asks nothing of the website", !none.ok && /knows no page/.test(none.why));
  }

  /* ============ the answers, owner tasks, profiles the page reads ============ */

  const putTask = db.prepare("INSERT OR REPLACE INTO cc_seo_owner_tasks (id, title, step, why, impact, effort, who, origin, sort, created_at, updated_at) VALUES (?, ?, ?, '', 'high', '', ?, 'specimen', 0, ?, ?)");
  for (const [id, who] of [
    ["directories", "owner"],
    ["business-profile", "owner"],
    ["local-business-lists", "owner"],
    ["bing-webmaster", "owner"],
    ["gsc-request-indexing", "lead-chrome"],
  ] as const)
    putTask.run(id, `Specimen task ${id}`, `Specimen step for ${id}.`, who, now, now);
  const putProfile = db.prepare("INSERT OR REPLACE INTO cc_seo_profiles (key, name, kind, url, state, owner_task, source, updated_at) VALUES (?, ?, 'listing', ?, ?, ?, 'specimen', ?)");
  putProfile.run("website", "Specimen website (Impressum)", "https://www.balkaris.ch/", "exists", null, now);
  putProfile.run("google-business-profile", "Google Business Profile", "https://www.google.com/maps/search/Specimen", "not-found", "business-profile", now);
  putProfile.run("search-ch", "search.ch", null, "not-found", "local-listings", now);

  const audit = (engine: NewAiCheck["engine"], question: string, d: string, mentioned: boolean | null, competitors: string[] = [], sources: string[] = [], kind: NewAiCheck["kind"] = "category", lang: "de" | "en" = "en") =>
    aisearch.addCheck({ engine, question, lang, day: d, kind, mentioned, competitors, sources, by: "audit" }, "the audit");
  const D1 = day(-10);
  audit("chatgpt", "Best specimen studio in Zurich?", D1, false, ["Specimen Rival A", "Specimen Rival B"], ["specimen-rival-a.example", "Google", "website-builder-specimen.example", "search.ch"]);
  audit("perplexity", "Best specimen studio in Zurich?", D1, false, ["Specimen Rival A"], ["Google business profiles"]);
  audit("gemini", "Was kostet ein Specimen-Film?", D1, false, ["Specimen Rival C"], [], "price", "de");
  audit("chatgpt", "Who is Specimen Balkaris?", D1, true, [], [], "brand");

  /* ============ 2. the address ============================================== */
  section("2. the page reads its address");
  {
    const d = await page();
    check("the bare address is the default view", d.asked.show === "unprompted" && d.asked.engine === "all" && d.asked.psort === "fails" && d.asked.open === null && d.asked.pages === "top");
    const q = await page("q=rival&show=bogus&engine=nope&psort=zzz&named=all&who=rival%20b&fail=price&find=dienst&kind=service&pages=all&page=%2Fspecimen-dienst&asking=all&open=Best%20specimen%20studio%20in%20Zurich%3F");
    check("a search shows every kind unless a chip narrows it; nonsense is the default", q.asked.q === "rival" && q.asked.show === "all" && q.asked.engine === "all" && q.asked.psort === "fails");
    check("the opened question is its key", q.asked.open === "best specimen studio in zurich?");
    check("the page table follows find, kind and the opened page", q.readiness.state === "ok" && q.readiness.value.pages.every((p) => p.path.includes("dienst")) && q.readiness.value.opened?.page?.path === "/specimen-dienst");
    check("the opened page carries the operator's tasks, short enough for the queue", q.readiness.state === "ok" && (q.readiness.value.opened?.tasks ?? []).length > 0 && (q.readiness.value.opened?.tasks ?? []).every((t) => (t.task.prompt ?? "").length <= 1000));
    check("'Named instead' follows its search and 'every company'", q.listings.state === "ok" && q.listings.value.named.length === 1 && q.listings.value.named[0]!.name === "Specimen Rival B" && q.listings.value.namedTotal === 3);
  }

  /* ============ 3. the answers =============================================== */
  section("3. the questions and what each assistant said");
  {
    const t = await ask<AiDone>("/ai-search/questions", { method: "POST", body: { question: "Specimen  question never asked?", active: true } });
    check("the owner puts a question on the list", t.status === 200 && /Tracked/.test(t.json.line), t.json);
    const m = await ask("/ai-search/questions", { who: "member", method: "POST", body: { question: "A member's question?", active: true } });
    check("the list is the owner's", m.status === 403);
    const d = await page("show=all");
    const a = d.answers.state === "ok" ? d.answers.value : null;
    const never = a?.questions.find((x) => x.key === "specimen question never asked?");
    check("a tracked question nobody asked is a row of empty cells", !!never && never.cells.every((c) => c === null) && never.listed && never.asked === 0, never);
    check("the counts say what is still missing", !!a && a.tracked === 4 && a.pairs === 4 * 7 && a.counted === 4 && a.neverAsked === 24, a && { t: a.tracked, p: a.pairs, c: a.counted, n: a.neverAsked });
    const s = await page("q=website-builder-specimen");
    check("the search looks through the sources the answers cited", s.answers.state === "ok" && s.answers.value.questions.length === 1 && s.answers.value.questions[0]!.question === "Best specimen studio in Zurich?");
    const e = await page("engine=gemini&show=all");
    check("one assistant: its column only", e.answers.state === "ok" && e.answers.value.cols.length === 1 && e.answers.value.cols[0]!.engine === "gemini");
    const chips = d.answers.state === "ok" ? Object.fromEntries(d.answers.value.chips.map((c) => [c.key, c.count])) : {};
    check("the chips count over the search", chips.all === 4 && chips.prompted === 1 && chips.de === 1 && chips.price === 1, chips);

    /* A newer answer of Perplexity: what changed. */
    const r = await ask<RecordAnswer>("/ai-search/record", { method: "POST", body: { check: { engine: "perplexity", question: "best specimen studio in zurich?", lang: "en", day: day(0), kind: "category", mentioned: true, position: 2, competitors: ["Specimen Rival D", "Balkaris"], sources: ["Google business profiles"] } } });
    check("one answer is recorded as a person's", r.status === 200 && r.json.result === "added" && r.json.counted);
    const o = await page("open=best%20specimen%20studio%20in%20zurich%3F");
    const px = o.answers.state === "ok" ? o.answers.value.open?.answers.find((x) => x.now.engine === "perplexity") : undefined;
    check("the opened question shows the earlier answer and what changed", !!px && px.earlier.length === 1 && /Not named on .*, named at place 2 now\. Named now, not before: Specimen Rival D\. No longer named: Specimen Rival A\./.test(px.change ?? ""), px?.change);

    const ret = await ask<AiDone>("/ai-search/questions", { method: "POST", body: { question: "Who is Specimen Balkaris?", active: false } });
    const after = await page("show=all");
    check("a retired question leaves the list and every count, its answers kept", ret.status === 200 && after.answers.state === "ok" && after.answers.value.tracked === 3 && after.answers.value.retired.some((x) => x.key === "who is specimen balkaris?" && x.answers === 1) && after.checks.state === "ok" && after.checks.value.rows.every((x) => !/who is specimen/i.test(x.question)));
    const back = await ask<AiDone>("/ai-search/questions", { method: "POST", body: { question: "Who is Specimen Balkaris?", active: true } });
    check("…and comes back when tracked again", back.status === 200 && /Tracked again/.test(back.json.line) && (await page("show=all")).answers.state === "ok");
  }

  /* ============ 4. recording ================================================= */
  section("4. recording answers: one, a round, a correction, a removal");
  {
    const base: NewAiCheck = { engine: "claude", question: "Best specimen studio in Zurich?", lang: "en", day: day(0), kind: "category", mentioned: false, by: "lead-chrome" };
    check("a member cannot record", (await ask("/ai-search/record", { who: "member", method: "POST", body: { check: base } })).status === 403);
    const future = await ask<{ error: string }>("/ai-search/record", { method: "POST", body: { check: { ...base, day: "2099-01-01" } } });
    check("a day after today is refused in a sentence", future.status === 400 && /future|after today/.test(future.json.error), future.json);
    const odd = await ask<{ error: string }>("/ai-search/record", { method: "POST", body: { check: { ...base, note: { x: 1 } } } });
    check("a note that is not text is refused in a sentence, not a server error", odd.status === 400 && /note/.test(odd.json.error), odd.json);

    const csv = ["assistant,question,named,place,companies,sources", `Copilot,Best specimen studio in Zurich?,yes,3,Specimen Rival A;Balkaris,search.ch`, `Copilot,Was kostet ein Specimen-Film?,unread,,,`, `NoSuchBot,Best specimen studio in Zurich?,no,,,`, `Copilot,,no,,,`].join("\n");
    const round = await ask<RoundAnswer>("/ai-search/round", { method: "POST", body: { text: csv, day: day(0) } });
    check("a pasted round records its good lines and says the rest", round.status === 200 && round.json.added === 2 && round.json.skipped.length === 2 && /NoSuchBot/.test(round.json.skipped.join(" ")), round.json);
    const again = await ask<RoundAnswer>("/ai-search/round", { method: "POST", body: { text: csv, day: day(0) } });
    check("the same round twice changes nothing", again.json.unchanged === 2 && again.json.added === 0, again.json);
    const typed = await ask<RoundAnswer>("/ai-search/round", { method: "POST", body: { checks: [{ ...base, engine: "gemini" }, { ...base, engine: "gemini", question: "x" }] } });
    check("a typed round: one recorded, one skipped with why", typed.json.added === 1 && /question/.test(typed.json.skipped[0] ?? ""), typed.json);
    const empty = await ask<{ error: string }>("/ai-search/round", { method: "POST", body: { text: "no header here" } });
    check("a round with nothing readable is refused in a sentence", empty.status === 400 && /question/.test(empty.json.error));
    check("a member cannot record a round", (await ask("/ai-search/round", { who: "member", method: "POST", body: { text: csv } })).status === 403);

    /* Google's AI Overview: filed as google-aio among the sightings, as Competitors knows it. */
    await ask("/ai-search/record", { method: "POST", body: { check: { ...base, engine: "google-ai-overview", competitors: ["Specimen Rival E"] } } });
    check("an AI Overview's companies are sightings of google-aio", count("SELECT COUNT(*) AS n FROM cc_seo_sightings WHERE engine = 'google-aio' AND domain LIKE '%rival%e%'") === 1 && count("SELECT COUNT(*) AS n FROM cc_seo_sightings WHERE engine = 'google-ai-overview'") === 0);

    /* Correct the audit's ChatGPT record: it becomes a person's and its sightings follow it. */
    const rec = db.prepare("SELECT id FROM cc_seo_ai_checks WHERE engine = 'chatgpt' AND question = 'Best specimen studio in Zurich?' AND by = 'audit'").get() as { id: number };
    const ed = await ask<AiDone>(`/ai-search/record/${rec.id}`, { method: "POST", body: { check: { engine: "chatgpt", question: "Best specimen studio in Zurich?", lang: "en", day: D1, kind: "category", mentioned: false, competitors: ["Specimen Rival A"], sources: ["specimen-rival-a.example", "website-builder-specimen.example", "Google", "search.ch"] } } });
    check("a correction of the audit's record makes it a person's", ed.status === 200 && /yours now/.test(ed.json.line) && (db.prepare("SELECT by FROM cc_seo_ai_checks WHERE id = ?").get(rec.id) as { by: string }).by === "lead-chrome", ed.json);
    check("a name corrected out of a record takes its sighting with it", count("SELECT COUNT(*) AS n FROM cc_seo_sightings WHERE engine = 'chatgpt' AND domain LIKE '%rival%b%' AND day = ?", D1) === 0);
    check("importing the audit's answer again does not undo the correction", audit("chatgpt", "Best specimen studio in Zurich?", D1, false, ["Specimen Rival A", "Specimen Rival B"]) === "unchanged" && count("SELECT COUNT(*) AS n FROM cc_seo_ai_checks WHERE engine = 'chatgpt' AND question = 'Best specimen studio in Zurich?' AND day = ?", D1) === 1);
    const clash = await ask<{ error: string }>(`/ai-search/record/${rec.id}`, { method: "POST", body: { check: { ...base, engine: "perplexity" } } });
    check("a correction onto another record's question, assistant and day is refused", clash.status === 409 && /already a record/.test(clash.json.error), clash.json);
    check("a member cannot correct", (await ask(`/ai-search/record/${rec.id}`, { who: "member", method: "POST", body: { check: base } })).status === 403);

    const gem = db.prepare("SELECT id FROM cc_seo_ai_checks WHERE engine = 'gemini' AND question = 'Was kostet ein Specimen-Film?'").get() as { id: number };
    const rm = await ask<AiDone>(`/ai-search/record/${gem.id}/remove`, { method: "POST" });
    check("a record is removed with its sightings", rm.status === 200 && count("SELECT COUNT(*) AS n FROM cc_seo_ai_checks WHERE id = ?", gem.id) === 0 && count("SELECT COUNT(*) AS n FROM cc_seo_sightings WHERE engine = 'gemini' AND domain LIKE '%rival%c%'") === 0);
    check("…removed again says there is none", (await ask(`/ai-search/record/${gem.id}`, { method: "DELETE" })).status === 404);
    check("…and the audit's files imported again do not bring it back", audit("gemini", "Was kostet ein Specimen-Film?", D1, false, ["Specimen Rival C"], [], "price", "de") === "unchanged" && count("SELECT COUNT(*) AS n FROM cc_seo_ai_checks WHERE engine = 'gemini'") === 1);
  }

  /* ============ 5. the levers ================================================ */
  section("5. the levers");
  {
    /* A whole check of three addresses on one day, then a check cut short after one the next day. */
    const put = db.prepare("INSERT OR REPLACE INTO cc_inspect (day, url, is_indexed, coverage, checked_at) VALUES (?, ?, ?, ?, ?)");
    const d0 = day(-2);
    const d1 = day(-1);
    for (const p of PAGES) put.run(d0, `https://www.balkaris.ch${p.path}`, p.path === "/specimen-legal" ? 0 : 1, p.path === "/specimen-legal" ? "Crawled - currently not indexed" : "Submitted and indexed", now);
    put.run(d1, "https://www.balkaris.ch/specimen-service", 1, "Submitted and indexed", now);
    for (const d of [d0, d1]) db.prepare("INSERT OR REPLACE INTO cc_series (metric, day, value) VALUES ('gsc.sitemap_addresses', ?, 3)").run(d);
    db.prepare("INSERT OR REPLACE INTO cc_series (metric, day, value) VALUES ('gsc.inspected', ?, 3)").run(d0);
    const d = await page();
    const lever = d.levers.state === "ok" ? d.levers.value.find((l) => l.key === "indexed")! : null;
    check("a cut-short inspection day is not the whole sitemap: the rest carry their last result", !!lever && lever.figure === "2 of 3 sitemap addresses indexed" && /cut short after 1 address; 2 addresses keep their result/.test(lever.detail) && /1 address not in the index/.test(lever.detail), lever);
    const bing = d.levers.state === "ok" ? d.levers.value.find((l) => l.key === "bing")! : null;
    check("the Bing lever leads to Settings › Sources, where its key is connected", bing?.step.href === "/settings?tab=sources", bing?.step);
  }

  /* ============ 6. where the answers look ===================================== */
  section("6. where the answers look");
  {
    const d = await page();
    const dirs = d.listings.state === "ok" ? d.listings.value.directories : [];
    const google = dirs.find((x) => x.source === "Google");
    check("a source card 'Google' is not taken for the Business Profile", !google || google.profile?.key !== "google-business-profile", google);
    check("a cited site whose name starts like 'website' is never Balkaris's own profile", dirs.every((x) => x.profile?.key !== "website"));
    const gbp = dirs.find((x) => /business profiles/i.test(x.source));
    check("'Google business profiles' is the Business Profile", gbp?.profile?.key === "google-business-profile");
    const sch = dirs.find((x) => x.source === "search.ch");
    check("search.ch's task (filed as local-listings) is found under its own id", sch?.ownerTask?.id === "local-business-lists", sch);
    const sites = await page("named=sites&who=specimen-rival");
    check("the companies' own sites cited are a list of their own, searchable", sites.listings.state === "ok" && sites.listings.value.sites.length === 1 && sites.listings.value.sitesTotal >= 2);
  }

  /* ============ 7. this page's own doors ======================================= */
  section("7. this page's own doors");
  {
    for (const p of ["/api/v1/seo/ai-search/act", "/api/v1/seo/ai-search/owner", "/api/v1/seo/ai-search/task", "/api/v1/seo/ai-search/round", "/api/v1/seo/ai-search/page/check"]) {
      const pages = grants.pagesOfPath(p).map((x) => x.key);
      check(`${p.replace("/api/v1/seo/ai-search", "")} follows AI Search's own switch`, pages.length === 1 && pages[0] === "seo/ai-search", pages);
    }
    /* An opportunity whose step is in the website's code: anybody with edit may hand it on; a brief takes the AI Operator. */
    const putOpp = db.prepare("INSERT OR REPLACE INTO cc_seo_opps (id, type, page, title, evidence, priority, priority_why, action, state, active, first_seen, last_seen) VALUES (?, 'missing-answer', '/specimen-service', ?, '{}', 'high', 'Specimen why.', ?, 'open', 1, ?, ?)");
    let oppsOk = true;
    try {
      putOpp.run("specimen:code", "Specimen code step", JSON.stringify({ kind: "code", label: "Hand to the website's code", step: "Specimen step in the code.", operator: null, ownerTaskId: null, href: null }), now, now);
      putOpp.run("specimen:brief", "Specimen brief", JSON.stringify({ kind: "brief", label: "Write a brief", step: "Specimen brief.", operator: { kind: "brief", prompt: "Specimen brief." }, ownerTaskId: null, href: null }), now, now);
    } catch (e) {
      oppsOk = false;
      check("specimen opportunities can be written", false, e instanceof Error ? e.message : e);
    }
    if (oppsOk) {
      const code = await ask<{ results: { ok: boolean; line: string }[] }>("/ai-search/act", { who: "member", method: "POST", body: { ids: ["specimen:code"] } });
      check("a member hands a code step to the website's code from this page", code.status === 202 && code.json.results[0]?.ok === true, code.json);
      const brief = await ask<{ error: string }>("/ai-search/act", { who: "member", method: "POST", body: { ids: ["specimen:brief"] } });
      check("a brief needs the AI Operator as well", brief.status === 403 && /AI Operator/.test(brief.json.error));
    }
    const mark = await ask<{ error: string }>("/ai-search/owner", { who: "member", method: "POST", body: { id: "directories", done: true } });
    check("the owner's own step is his to mark", mark.status === 403 && /Only the owner/.test(mark.json.error));
    const lead = await ask<{ task: { done: boolean; doneBy: string } }>("/ai-search/owner", { who: "member", method: "POST", body: { id: "gsc-request-indexing", done: true } });
    check("a step taken in the owner's browser is anybody's who may change the page, and names them", lead.status === 200 && lead.json.task.done && lead.json.task.doneBy === "Specimen Member");
    const task = await ask("/ai-search/task", { who: "member", method: "POST", body: { kind: "ask", prompt: "Specimen question?" } });
    check("an operator task from a member without the AI Operator is refused", task.status === 403);
    const long = await ask<{ error: string }>("/ai-search/task", { method: "POST", body: { kind: "ask", prompt: "x".repeat(1200) } });
    check("a question longer than the queue takes is refused in a sentence", long.status === 400 && /1,000/.test(long.json.error));
    const d = await page();
    check("every suggestion fits the operator's queue", d.operator.suggestions.every((s) => (s.task.prompt ?? "").length <= 1000), d.operator.suggestions.map((s) => (s.task.prompt ?? "").length));

    /* Check again and run the check, through the page's doors. */
    site["/specimen-service"] = { status: 402, html: null };
    const ca = await ask<PageCheckAnswer>("/ai-search/page/check", { who: "member", method: "POST", body: { path: "/specimen-service" } });
    check("Check again answers how the page answered and shows its last good read", ca.status === 200 && ca.json.read === false && !!ca.json.page && /402/.test(ca.json.line), ca.json);
    const pr = await ask<PageReadinessAnswer>("/ai-search/page?path=%2Fspecimen-service");
    check("GET /page says the newest read failed", !!pr.json.page?.unread && /402/.test(pr.json.page.unread.why));
    check("Check again refuses an address that is not a path", (await ask("/ai-search/page/check", { method: "POST", body: { path: "nope" } })).status === 400);
    check("Check again on a page the crawl does not know is 404, nothing asked", (await ask("/ai-search/page/check", { method: "POST", body: { path: "/specimen-nowhere" } })).status === 404);

    const noJob = await ask<{ error: string }>("/ai-search/readiness/run", { method: "POST" });
    check("Run the check says so when the desk has no such job", noJob.status === 404 && /no readiness check job/.test(noJob.json.error), noJob.json);
    scheduler.register(...collector.jobs.filter((j) => j.name === "seo-readiness" || j.name === "seo-referrals"));
    const visits = await ask<{ error: string }>("/ai-search/visits/run", { method: "POST" });
    check("Read now refuses while GA4 is not connected, and says so", visits.status === 409 && /not connected/.test(visits.json.error), visits.json);
    for (const p of PAGES) site[p.path] = { status: 200, html: faqPage(Q, Q) };
    const runIt = await ask<AiDone>("/ai-search/readiness/run", { method: "POST" });
    check("Run the check asks the scheduler for it now", runIt.status === 202 && /starts in a moment/.test(runIt.json.line), runIt.json);
    for (let i = 0; i < 100 && (scheduler.status().find((j) => j.name === "seo-readiness")?.runs ?? 0) < 1; i++) await new Promise((r) => setTimeout(r, 20));
    const ran = scheduler.status().find((j) => j.name === "seo-readiness");
    check("…and it ran, read every page and says so", ran?.runs === 1 && ran.lastOk === true && /3 of 3 pages read/.test(ran.lastNote ?? ""), ran);
    const after = await page();
    check("the page shows the job as it stands", after.readiness.state === "ok" && after.readiness.value.job?.lastOk === true && after.readiness.value.unread === null);

    /* The CSVs. */
    for (const what of ["answers", "readiness", "named", "directories"]) {
      const res = await app.request(`/ai-search/export?what=${what}`, { headers: { "x-specimen-who": "owner" } });
      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      check(
        `the ${what} CSV opens in a spreadsheet as UTF-8`,
        res.status === 200 && (res.headers.get("content-type") ?? "").startsWith("text/csv") && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && text.split("\r\n").length > 2,
        text.slice(0, 120),
      );
    }
  }

  /* ============ 8. questions people search ===================================== */
  section("8. questions people search");
  {
    const putKw = db.prepare("INSERT OR REPLACE INTO cc_seo_keywords (phrase, lang, sources, status, page, question, price, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    putKw.run("was kostet ein specimen-film", "de", "gsc", "relevant", "/specimen-dienst", 1, 1, now, now);
    putKw.run("how to make a specimen", "en", "autocomplete", "relevant", null, 1, 0, now, now);
    putKw.run("specimen nonsense question", "en", "autocomplete", "irrelevant", null, 1, 0, now, now);
    putKw.run("specimen studio", "en", "gsc", "relevant", null, 0, 0, now, now);
    db.prepare("INSERT OR REPLACE INTO cc_seo_snaps (day, at, query_rows, page_rows, day_rows) VALUES (?, ?, 1, 0, 0)").run(day(-3), now);
    db.prepare("INSERT OR REPLACE INTO cc_seo_rank_queries (day, country, device, query, clicks, impressions, position) VALUES (?, 'all', 'all', ?, 0, 7, 12)").run(day(-3), "was kostet ein specimen-film");
    await ask("/ai-search/questions", { method: "POST", body: { question: "How to make a specimen", active: true } });
    const d = await page();
    const a = d.asking.state === "ok" ? d.asking.value : null;
    check("question-shaped phrases only, the irrelevant left out", !!a && a.total === 2 && !a.rows.some((r) => /nonsense|^specimen studio$/.test(r.phrase)), a?.rows.map((r) => r.phrase));
    const first = a?.rows[0];
    check("Search Console's impressions first, with the page and its two checks", first?.phrase === "was kostet ein specimen-film" && first.impressions === 7 && first.page?.path === "/specimen-dienst" && first.price, first);
    check("a phrase on the list is marked tracked", a?.rows.find((r) => r.phrase === "how to make a specimen")?.tracked === true);
  }

  check("nothing left the machine", refused.length === 0, refused);
} catch (e) {
  failed++;
  console.log(`FAIL the check threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
} finally {
  try {
    db.close();
  } catch {
    /* already closed */
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the file a moment */
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
