/**
 * SEO › Overview, proved without Google, GA4 or any website.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-overview.ts
 *   npm run check:seo-overview
 *
 * The real route file (src/cc/routes/seo/overview.ts) against a throwaway
 * database, with a guard on `fetch` that refuses every host: nothing leaves
 * this machine, and the page is drawn from the desk's own tables as it is on
 * the box. Every figure, phrase, page and name in here is a SPECIMEN, made up
 * and named so (/specimen-a, "specimen agency"); none describes the real
 * website.
 *
 * What is proved:
 *   1. who may: queueing operator work takes edit on the AI Operator too, the
 *      owner's own steps are his, and "Run now" is offered on exactly the jobs
 *      the job door lets the person run;
 *   2. Google's index on a day the check was cut short: the addresses it did
 *      not reach keep their last result, so part of the site is never counted
 *      as the whole, and the tile, Technical and the engine line agree;
 *   3. Top Performing Pages reads Google's own per-page answer for the period;
 *      the page history is used for a country, and says when it holds only
 *      part of the clicks; a line is drawn only for a page the history holds;
 *   4. the brand split of the named clicks;
 *   5. the doors: /owner, /task (the 1,000-character question), /act, and a
 *      brief asked for keeps its "Queued" row on Content Gap Analysis;
 *   6. every rule of the crawl is in exactly one row of Technical SEO;
 *   7. the page's answer: every panel a reading, ?country= and ?device= read
 *      and echoed, anything else ignored; the period travels on every link.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-overview-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "SITE_READ_REPO", "SITE_REPO", "DESK_DEV_USER", "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"]) delete process.env[k];
/* A key file that is no key: Search Console counts as connected from its kept state, and nothing is ever signed with it. */
writeFileSync(path.join(dir, "key.json"), JSON.stringify({ client_email: "desk-check@specimen-project.iam.gserviceaccount.com", private_key: "not a key: the check never signs with it" }));
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "key.json");
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
const store = await import("../src/cc/store.ts");
await import("../src/cc/seo/tables.ts");
await import("../src/cc/search/gsc.ts");
const shared = await import("../src/cc/search/shared.ts");
const rules = await import("../src/cc/site/rules.ts");
const scheduler = await import("../src/cc/scheduler.ts");
const collector = await import("../src/cc/seo/index.ts");
const overview = await import("../src/cc/routes/seo/overview.ts");
const href = await import("../web/src/components/seo/overview/href.ts");
const { apiError } = await import("../src/cc/api.ts");
const { Hono } = await import("hono");
import type { Person } from "../src/people.ts";
import type { Vars } from "../src/cc/access.ts";
import type { SeoOverviewPayload } from "../web/src/contract/seo/overview.ts";

const base = { email: null, author: "balkaris", canPublish: false, seesLeads: false };
const PEOPLE: Record<string, Person> = {
  owner: { ...base, telegram: 1, name: "Specimen Owner", owner: true } as unknown as Person,
  /* Edit on SEO, nothing on the AI Operator: may run the SEO jobs, may not queue operator work. */
  editor: { ...base, telegram: 2, name: "Specimen Editor", owner: false, grants: { seo: "edit" } } as unknown as Person,
  /* Edit on SEO and on the AI Operator. */
  operator: { ...base, telegram: 3, name: "Specimen Operator", owner: false, grants: { seo: "edit", operator: "edit" } } as unknown as Person,
  /* Reads SEO only: runs nothing. */
  viewer: { ...base, telegram: 4, name: "Specimen Viewer", owner: false, grants: { seo: "view" } } as unknown as Person,
};
type Who = keyof typeof PEOPLE;

const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  const who = c.req.header("x-specimen-who") as Who | undefined;
  if (who && PEOPLE[who]) c.set("who", PEOPLE[who]);
  await next();
});
app.route("/", overview.routes);
app.onError(apiError);
async function ask<T = Record<string, unknown>>(p: string, o: { who?: Who; method?: string; body?: unknown } = {}): Promise<{ status: number; json: T }> {
  const res = await app.request(p, {
    method: o.method ?? "GET",
    headers: { "x-specimen-who": o.who ?? "owner", ...(o.body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as T };
}
const page = async (q = "", who: Who = "owner") => (await ask<SeoOverviewPayload>(`/${q}`, { who })).json;

/* ---- specimen history ------------------------------------------------------- */

const SITE = "https://www.balkaris.ch";
const today = store.today();
const day = (o: number): string => shared.addDays(today, o);
const LAST = day(-4);

/* The SEO section's jobs, on the scheduler (switched off here: none runs), so "Run now" has jobs to offer. */
scheduler.register(...collector.jobs);

/* Search Console is connected, as its kept state says: no request is made to know it. */
store.setState("gsc.access", JSON.stringify({ state: "ok", site: "sc-domain:balkaris.ch", permission: "siteFullUser", readable: ["sc-domain:balkaris.ch"], checkedAt: new Date().toISOString(), detail: "" }));
store.setState("gsc.access.asked", "");

const ins = {
  snap: db.prepare("INSERT INTO cc_seo_snaps (day, at, query_rows, page_rows, day_rows) VALUES (?, ?, 1, 1, 1)"),
  day: db.prepare("INSERT INTO cc_seo_rank_days (day, country, device, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?)"),
  query: db.prepare("INSERT INTO cc_seo_rank_queries (day, country, device, query, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  page: db.prepare("INSERT INTO cc_seo_rank_pages (day, country, device, page, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?, ?)"),
};
/* Sixty days: every day 3 clicks and 10 impressions overall, 2 clicks from Switzerland; the page history
   holds only one click a day, and only in Switzerland: short, as Google's per-page rows were on the box. */
for (let o = -63; o <= -4; o++) {
  const d = day(o);
  ins.snap.run(d, new Date().toISOString());
  ins.day.run(d, "all", "DESKTOP", 3, 10, 6);
  ins.day.run(d, "che", "DESKTOP", 2, 5, 5);
  ins.query.run(d, "all", "DESKTOP", "balkaris", 1, 2, 1);
  ins.query.run(d, "all", "DESKTOP", "specimen agency", 0, 3, 9);
  if (o % 10 === 0) ins.query.run(d, "all", "DESKTOP", '"specimen agency zurich"', 1, 1, 7);
  ins.page.run(d, "che", "DESKTOP", `${SITE}/specimen-a`, 1, 3, 4);
}

/* Google's own per-page answer for 30 days, as gsc.ts `pages("30d")` keeps it: the apex and www spellings of one page. */
store.keep("gsc:pages:30d", {
  window: { start: day(-32), end: day(-3), days: 30 },
  rows: [
    { page: `${SITE}/`, path: "/", clicks: 9, impressions: 40, ctr: 22.5, position: 3, previous: null },
    { page: "https://balkaris.ch/", path: "/", clicks: 3, impressions: 20, ctr: 15, position: 6, previous: null },
    { page: `${SITE}/specimen-a`, path: "/specimen-a", clicks: 2, impressions: 30, ctr: 6.7, position: 8, previous: null },
  ],
  complete: true,
});

/* The index check: ten sitemap addresses checked whole the day before, then a check cut short after three. */
const D1 = day(-2);
const D2 = day(-1);
const addr = Array.from({ length: 10 }, (_, i) => `${SITE}/specimen-${i}`);
const inspect = db.prepare("INSERT INTO cc_inspect (day, url, verdict, coverage, is_indexed, checked_at) VALUES (?, ?, ?, ?, ?, ?)");
addr.forEach((u, i) => inspect.run(D1, u, i < 6 ? "PASS" : "NEUTRAL", i < 6 ? "Submitted and indexed" : "Discovered - currently not indexed", i < 6 ? 1 : 0, `${D1}T18:00:00.000Z`));
/* The cut-short day reached three: one of them newly indexed. */
[0, 1, 7].forEach((i) => inspect.run(D2, addr[i]!, "PASS", "Submitted and indexed", 1, `${D2}T18:00:00.000Z`));
const series = db.prepare("INSERT INTO cc_series (metric, day, value) VALUES (?, ?, ?)");
series.run("gsc.sitemap_addresses", D1, 10);
series.run("gsc.sitemap_addresses", D2, 10);
series.run("gsc.inspected", D1, 10);

/* A German topic without a page, its gap opportunity with a brief, and the owner's steps. */
const now = new Date().toISOString();
db.prepare("INSERT INTO cc_seo_clusters (key, name, lang, priority, rank, page, source, examples, first_seen, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)").run("specimen-topic:de", "Specimen topic (DE)", "de", "high", 1, null, "specimen", now, now);
db.prepare("INSERT INTO cc_seo_keywords (phrase, lang, cluster, status, sources, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)").run("specimen thema", "de", "specimen-topic:de", "relevant", "specimen", now, now);
const brief = { kind: "brief", label: "Write a brief", step: "The operator writes the brief; a person writes the page.", operator: { kind: "brief", prompt: "Specimen topic (DE)" }, ownerTaskId: null, href: null };
db.prepare(
  "INSERT INTO cc_seo_opps (id, type, cluster, title, evidence, priority, priority_why, action, state, active, first_seen, last_seen) VALUES (?, ?, ?, ?, '[]', 'high', 'Specimen.', ?, 'open', 1, ?, ?)",
).run("german-missing:specimen-topic:de", "german-missing", "specimen-topic:de", "No German page for the specimen topic", JSON.stringify(brief), now, now);
const task = db.prepare("INSERT INTO cc_seo_owner_tasks (id, title, step, impact, who, origin, created_at, updated_at) VALUES (?, ?, ?, 'high', ?, 'specimen', ?, ?)");
task.run("specimen-owner-step", "A specimen step of the owner's", "Sign in to the specimen console.", "owner", now, now);
task.run("specimen-browser-step", "A specimen step in the owner's browser", "Open the specimen page.", "lead-chrome", now, now);

try {
  /* ============ 1. who may ==================================================== */
  section("1. who may");
  {
    const o = await page();
    check("the owner may queue operator work and mark his own steps", o.can.operate === true && o.can.ownerSteps === true, o.can);
    const e = await page("", "editor");
    check("edit on SEO without the AI Operator: no operator work, not the owner's steps", e.can.operate === false && e.can.ownerSteps === false, e.can);
    check("the owner may run every SEO job", o.can.run.includes("seo-engine") && o.can.run.includes("seo-snapshot"), o.can.run);
    check("  edit on SEO may run the SEO jobs it feeds", e.can.run.includes("seo-engine") && e.can.run.includes("seo-snapshot"), e.can.run);
    const op = await page("", "operator");
    check("edit on the AI Operator as well: operator work may be queued", op.can.operate === true && op.can.ownerSteps === false, op.can);
    const v = await page("", "viewer");
    check("a person who reads SEO only runs no job", v.can.run.length === 0 && v.can.operate === false, v.can);
  }

  /* ============ 2. Google's index on a cut-short day ========================== */
  section("2. Google's index when the newest check was cut short");
  {
    const d = await page();
    const t = d.tiles.indexed;
    check("the tile counts each address's newest result: 7 of 10, not 3 of 10", t.state === "ok" && t.value.value === 7 && t.value.of === 10, t);
    check("  and says what was found not indexed (3), never the sitemap minus the indexed", t.state === "ok" && /^3 not indexed/.test(t.value.sub ?? ""), t.state === "ok" ? t.value.sub : t);
    check("  and that the newest check was cut short, how far it got, and what finishes it", t.state === "ok" && /cut short/.test(t.value.sub ?? "") && /reached 3 of 10/.test(t.note ?? "") && /Run full SEO audit/.test(t.note ?? ""), t.state === "ok" ? t.note : t);
    const row = d.technical.state === "ok" ? d.technical.value.rows.find((r) => r.key === "not-indexed") : null;
    if (d.technical.state === "ok") check("Technical's Not indexed row says the same: 3 of 10", row?.count === 3 && row?.of === 10, row);
    else check("Technical waits for the crawl (none on this desk) and says so", !!d.technical.reason, d.technical);
    const line = d.engine.find((p) => p.key === "indexation")?.line ?? "";
    check("the engine's Indexation line agrees", /^7 of 10 sitemap addresses indexed, 3 not/.test(line) && /cut short/.test(line), line);
  }

  /* ============ 3. Top Performing Pages ======================================= */
  section("3. Top Performing Pages");
  {
    const d = await page();
    const tp = d.topPages;
    check("read from Google's own per-page answer for the period", tp.state === "ok" && tp.value.basis === "google", tp);
    if (tp.state === "ok") {
      const home = tp.value.rows.find((r) => r.page.path === "/");
      check("  the apex and www spellings of a page are one row (12 clicks, 60 impressions)", home?.clicks === 12 && home?.impressions === 60, home);
      check("  most clicks first", tp.value.rows[0]?.page.path === "/", tp.value.rows.map((r) => r.page.path));
      check("  a page the day-by-day history does not hold whole draws no line", home?.trend === null, home);
      check("  its window is Google's own, named", tp.value.window.start === day(-32) && tp.value.window.end === day(-3), tp.value.window);
    }
    const che = (await page("?country=che")).topPages;
    check("for Switzerland the page history is read", che.state === "ok" && che.value.basis === "history", che);
    if (che.state === "ok") {
      check("  and says it holds part of the clicks: 30 of the 60 Google counts for Switzerland", che.value.short?.pageClicks === 30 && che.value.short.propertyClicks === 60, che.value.short);
      check("  so no row draws a line through part of its days", che.value.rows.every((r) => r.trend === null), che.value.rows.map((r) => r.trend));
      check("  and the note says so", /holds 30 of the 60 clicks/.test(che.note ?? ""), che.note);
    }
    const dev = (await page("?device=mobile")).topPages;
    check("a device Google showed nothing on: waiting, with the reason, not a row of zeros", dev.state === "waiting" && /no page/.test(dev.reason), dev);
    const all = (await page("?country=all&device=desktop")).topPages;
    check("a narrowing the page history holds no row of while Google counted clicks: it says the history is short, never 'Google showed no page'", all.state === "waiting" && /page history holds none/.test(all.reason) && !/showed no page/.test(all.reason), all);
  }

  /* ============ 4. brand and non-brand ========================================= */
  section("4. the brand split of the named clicks");
  {
    const d = await page();
    const b = d.tiles.brand;
    check("the brand word is the domain's first label", b?.word === "balkaris", b);
    /* 30 days: "balkaris" 1 click a day = 30; the quoted query 1 click on 3 days of the window. */
    /* 30 days: "balkaris" 1 click a day; the quoted query 1 click on 3 of the days. */
    check("named clicks split: 33 named, 3 of them not a search for the name", b?.named === 33 && b.nonBrand === 3, b);
    check("  the clicks tile says it", d.tiles.clicks.state === "ok" && /^Non-brand: \d+ of \d+ named$/.test(d.tiles.clicks.value.sub ?? ""), d.tiles.clicks.state === "ok" ? d.tiles.clicks.value.sub : d.tiles.clicks);
    check("isBrand reads the name however it is typed", overview.isBrand("Balkaris Zürich", "balkaris") && overview.isBrand("balkaris.ch", "balkaris") && overview.isBrand("bal karis", "balkaris") && !overview.isBrand("specimen agency", "balkaris"));
  }

  /* ============ 5. the doors ================================================== */
  section("5. the doors");
  {
    let a = await ask("/owner", { who: "operator", method: "POST", body: { id: "specimen-owner-step", done: true } });
    check("/owner: one of the owner's own steps is refused to anybody else, 403 { error }", a.status === 403 && /owner/.test(String(a.json.error)), a);
    a = await ask("/owner", { who: "owner", method: "POST", body: { id: "specimen-owner-step", done: true } });
    check("  the owner marks it, by name", a.status === 200 && (a.json.task as { doneBy: string }).doneBy === "Specimen Owner", a);
    a = await ask("/owner", { who: "editor", method: "POST", body: { id: "specimen-browser-step", done: true } });
    check("  a step in the owner's browser is anybody's who may change the page", a.status === 200 && (a.json.task as { doneBy: string }).doneBy === "Specimen Editor", a);
    a = await ask("/owner", { who: "owner", method: "POST", body: { id: "no-such-step", done: true } });
    check("  an unknown step is 404 { error }", a.status === 404 && typeof a.json.error === "string", a);

    a = await ask("/task", { who: "editor", method: "POST", body: { kind: "ask", prompt: "Which specimen page first?" } });
    check("/task: refused without edit on the AI Operator, 403 with the sentence", a.status === 403 && /AI Operator/.test(String(a.json.error)), a);
    a = await ask("/task", { who: "operator", method: "POST", body: { kind: "ask", prompt: "x".repeat(1001) } });
    check("  a question over 1,000 characters is refused at the door, as the queue would", a.status === 400 && /1,000/.test(JSON.stringify(a.json)), a);

    a = await ask("/act", { who: "editor", method: "POST", body: { ids: ["german-missing:specimen-topic:de"] } });
    check("/act: a brief is operator work, refused without the AI Operator", a.status === 403 && /AI Operator/.test(String(a.json.error)), a);
    let gaps = (await page()).contentGaps;
    const before = gaps.state === "ok" ? gaps.value.rows.find((r) => r.key === "specimen-topic:de") : null;
    check("Content Gap Analysis offers the brief while it can be asked for", before?.action?.available === true && before.action.state === "open", before);
    a = await ask("/act", { who: "operator", method: "POST", body: { ids: ["german-missing:specimen-topic:de"] } });
    if (a.status === 202) {
      gaps = (await page()).contentGaps;
      const after = gaps.state === "ok" ? gaps.value.rows.find((r) => r.key === "specimen-topic:de") : null;
      check("  once asked for, the row keeps its opportunity and says Queued (no bare link, no second button)", after?.opportunityId === "german-missing:specimen-topic:de" && after.action?.state === "queued", after);
    } else {
      check("  asked for by the operator, the brief is queued or the queue's own refusal comes back as a sentence", typeof a.json.error === "string", a);
    }
    a = await ask("/act", { who: "operator", method: "POST", body: { ids: ["no-such-opportunity"] } });
    check("  an unknown opportunity: 409 with the refusal's sentence", a.status === 409 && typeof a.json.error === "string", a);
  }

  /* ============ 6. Technical SEO covers every rule of the crawl =============== */
  section("6. every rule of the crawl is in one row of Technical SEO");
  {
    const all = Object.keys(rules.RULES);
    const filed = overview.TECH_FAMILIES.flatMap((f) => f.rules as string[]);
    const missing = all.filter((r) => !filed.includes(r));
    const twice = filed.filter((r, i) => filed.indexOf(r) !== i);
    const unknown = filed.filter((r) => !all.includes(r));
    check("each of the crawl's rules belongs to a family", !missing.length, missing);
    check("  to one only", !twice.length, twice);
    check("  and no family names a rule the crawl does not have", !unknown.length, unknown);
    check("  each family leads to a section of SEO › Technical", overview.TECH_FAMILIES.every((f) => /^[a-z-]+$/.test(f.anchor)));
  }

  /* ============ 7. the page's answer ========================================== */
  section("7. the page's answer");
  {
    const d = await page("?range=90d&country=che&device=mobile");
    check("?country= and ?device= are read and echoed", d.asked.country === "che" && d.asked.device === "mobile", d.asked);
    const bogus = await page("?country=fr&device=fridge&sort=x&q=y");
    check("  anything else is all countries and all devices", bogus.asked.country === "all" && bogus.asked.device === "all", bogus.asked);
    const panels = ["priority", "keywords", "topPages", "contentGaps", "technical", "presence", "searchConsole", "movements", "organic", "aiSearch", "needsYou"] as const;
    const bad = panels.filter((k) => !["ok", "waiting", "off"].includes((d as unknown as Record<string, { state: string }>)[k]?.state));
    check("every panel is a reading: ok, waiting or off", !bad.length, bad);
    const absentWithoutWhy = panels.filter((k) => {
      const r = (d as unknown as Record<string, { state: string; reason?: string }>)[k]!;
      return r.state !== "ok" && !r.reason;
    });
    check("  and one that is not ok says why", !absentWithoutWhy.length, absentWithoutWhy);
    check("From search says GA4 is not connected here, with no invented figure", d.organic.state !== "ok", d.organic);
    const pr = d.presence.state === "ok" ? d.presence.value : null;
    check("Backlinks: Bing is not connected and says what connects it", pr?.bing.state === "off" && !!pr.bing.reason, pr?.bing);
    check("  links known without Bing: none yet, and the step that adds them", pr?.known.state === "waiting" && /Links report/.test(pr.known.reason), pr?.known);
    const m = d.movements;
    check("What moved names its two windows, and calls nothing new or lost when it cannot compare", m.state !== "ok" || (m.value.compared ? !!m.value.added : m.value.added === null && !!m.value.reason), m);
    const r = await ask<{ jobs: unknown[]; next: unknown[] }>("/running");
    check("/running answers Running now alone", r.status === 200 && Array.isArray(r.json.jobs) && Array.isArray(r.json.next), r);

    check("a link to another SEO page carries the period", href.seoHref("/seo/opportunities", "90d") === "/seo/opportunities?range=90d");
    check("  keeping its own params and its #anchor", href.seoHref("/seo/technical#indexing", "7d") === "/seo/technical?range=7d#indexing" && href.seoHref("/seo/keywords?q=a%20b", "1y") === "/seo/keywords?q=a+b&range=1y");
    check("  the default period is left out, and a link elsewhere is untouched", href.seoHref("/seo/pages", "30d") === "/seo/pages" && href.seoHref("/operator?result=4", "90d") === "/operator?result=4" && href.seoHref("/seo-legacy", "90d") === "/seo-legacy");
    check("  a chip's View all opens Opportunities on its types and priority", href.opportunitiesHref({ types: ["near-page-one", "low-ctr"], priority: "high" }, "90d") === "/seo/opportunities?type=near-page-one%2Clow-ctr&priority=high&range=90d");
    check("  a topic opens its cluster on Content Gaps", href.gapHref("specimen-topic:de") === "/seo/content-gaps?view=clusters&open=specimen-topic%3Ade");

    check("nothing left this machine", refused.length === 0, refused);
  }
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
