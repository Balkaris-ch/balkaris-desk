/**
 * The SEO engine, proved without Google, GA4, Vercel or any website.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-engine.ts
 *   npm run check:seo-engine
 *
 * Nothing leaves this machine: a throwaway database, a stand-in for Search
 * Console on 127.0.0.1:3462 that answers in the shapes Google documents, and a
 * guard on `fetch` that refuses every other host. Every figure, phrase, page,
 * domain and name in here is a SPECIMEN, made up and named so ("specimen query
 * alpha", /specimen-a, specimen-rival-a.example); none of it describes the
 * real website, and none of the audit's real findings are in this file.
 *
 * What is proved:
 *   1. nothing connected: the snapshot cannot run and says why, and no
 *      request is made;
 *   2. the rank history: the first run back-fills from the property's first
 *      day, a day with no rows is kept as a real zero, Switzerland is kept
 *      apart from all countries, the figures read back equal the stand-in's,
 *      a second run asks for nothing, and a newly finished day is added alone;
 *   3. the audit's files import, and importing them again changes nothing;
 *      a person's keyword status survives the re-import;
 *   4. the opportunity engine: early signals on a young window (floor one
 *      impression, marked, at most medium), "our estimate" only where there
 *      are impressions, low CTR, a ranking drop, a German gap, not indexed,
 *      owner tasks; a person's decision survives every run; one the rules no
 *      longer find is cleared with its decision kept and comes back with it;
 *      a rule family that could not look clears nothing;
 *   5. Google Autocomplete's weekly budget: the 121st request of a week is
 *      never sent, and the research stops at the cap;
 *   6. the AI and search crawlers are named from their user agents, counted
 *      per day and page, and no user agent string is kept;
 *   7. the engine's addresses: owner-only routes refuse a signed-in person
 *      who is not the owner, a manual import of the same CSV twice changes
 *      nothing, a done mark is a person's and names them, /nav counts;
 *   8. a page of the SEO section whose file is missing or broken costs that
 *      page only, and a broken one is a failing check by name;
 *   9. competitor pages are read politely: robots.txt first and obeyed, two
 *      seconds between requests to a site;
 *  10. the AI-readiness reading of a page finds an answer, questions and a price.
 */
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3462;
const HERE = `http://127.0.0.1:${PORT}`;

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-engine-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "SITE_READ_REPO", "SITE_REPO", "DESK_DEV_USER"]) delete process.env[k];
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "absent.json");
process.env.SITE_READ_CLONE = "off";

/* ---- nothing leaves this machine ------------------------------------------ */
const realFetch = globalThis.fetch;
let requests = 0;
const refused: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(`${HERE}/`)) {
    refused.push(url.split("?")[0]!);
    throw new Error(`the check tried to leave the machine: ${url.split("?")[0]}`);
  }
  requests++;
  return realFetch(input as never, init);
}) as typeof fetch;

let passed = 0;
let failed = 0;
function check(name: string, good: boolean, detail?: unknown): void {
  if (good) passed++;
  else failed++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${!good && detail !== undefined ? `\n     ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
}
const section = (title: string) => console.log(`\n${title}`);

/* ---- the stand-in for Search Console --------------------------------------- */

type Fixture = { day: string; query: string; page: string; device: string; country: string; clicks: number; impressions: number; position: number };
const fixture: Fixture[] = [];
const pacificToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const dayAt = (offset: number): string => new Date(Date.parse(`${pacificToday}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const FIRST = dayAt(-40);
const NEWEST = dayAt(-4);
const GAP = dayAt(-20);
const SITE = "https://www.balkaris.ch";
/* The engine compares the last 14 days of the history with the 14 before; the history ends on dayAt(-3) once section 2 adds that day. */
const DROP_FROM = dayAt(-3 - 13);
for (let o = -40; o <= -4; o++) {
  const day = dayAt(o);
  if (day === GAP) continue;
  if (o % 2 === 0) fixture.push({ day, query: "specimen query alpha", page: `${SITE}/specimen-a`, device: "DESKTOP", country: "che", clicks: 0, impressions: 1, position: 8 });
  fixture.push({ day, query: "specimen query gamma", page: `${SITE}/specimen-c`, device: "MOBILE", country: "che", clicks: 0, impressions: 8, position: 2 });
  fixture.push({ day, query: "specimen query delta", page: `${SITE}/specimen-b`, device: "DESKTOP", country: "deu", clicks: 0, impressions: 3, position: day >= DROP_FROM ? 12 : 5 });
  fixture.push({ day, query: "specimen query beta", page: `${SITE}/specimen-b`, device: "MOBILE", country: "deu", clicks: 1, impressions: 1, position: 40 });
}

const gscAsked: { dims: string[]; start: string; end: string }[] = [];

function answer(body: { startDate: string; endDate: string; dimensions: string[]; rowLimit?: number; startRow?: number; dimensionFilterGroups?: { filters: { dimension: string; expression: string }[] }[] }) {
  const country = body.dimensionFilterGroups?.[0]?.filters.find((f) => f.dimension === "country")?.expression ?? null;
  const by = new Map<string, { keys: string[]; clicks: number; impressions: number; w: number }>();
  for (const r of fixture) {
    if (r.day < body.startDate || r.day > body.endDate) continue;
    if (country && r.country !== country) continue;
    const keys = body.dimensions.map((d) => String((r as unknown as Record<string, unknown>)[d === "date" ? "day" : d]));
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

const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const send = (status: number, value: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const url = new URL(req.url ?? "/", HERE);
  if (url.pathname === "/gsc/sites") return send(200, { siteEntry: [{ siteUrl: "sc-domain:balkaris.ch", permissionLevel: "siteFullUser" }] });
  if (url.pathname.endsWith("/searchAnalytics/query") && req.method === "POST") {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    gscAsked.push({ dims: body.dimensions, start: body.startDate, end: body.endDate });
    return send(200, answer(body));
  }
  send(404, { error: { code: 404, message: "Not found (stand-in)" } });
});
await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));

/* ---- the modules ------------------------------------------------------------ */

const { db } = await import("../src/db.ts");
const store = await import("../src/cc/store.ts");
const gsc = await import("../src/cc/search/gsc.ts");
const shared = await import("../src/cc/search/shared.ts");
const rank = await import("../src/cc/seo/rank.ts");
const engine = await import("../src/cc/seo/engine.ts");
const keywords = await import("../src/cc/seo/keywords.ts");
const imports = await import("../src/cc/seo/import.ts");
const owner = await import("../src/cc/seo/owner.ts");
const aisearch = await import("../src/cc/seo/aisearch.ts");
const competitors = await import("../src/cc/seo/competitors.ts");
const readinessMod = await import("../src/cc/seo/readiness.ts");
const drain = await import("../src/cc/vercel/drain.ts");
const seoJobs = await import("../src/cc/seo/jobs.ts");
const collector = await import("../src/cc/seo/index.ts");
const seo = await import("../src/cc/routes/seo.ts");
const sources = await import("../src/cc/sources.ts");
const { apiError } = await import("../src/cc/api.ts");
const { Hono } = await import("hono");
import type { Person } from "../src/people.ts";
import type { Vars } from "../src/cc/access.ts";

const OWNER = { telegram: 1, name: "Specimen Owner", email: "owner@specimen.invalid", owner: true, canPublish: true, seesLeads: true } as unknown as Person;
const MEMBER = { telegram: 2, name: "Specimen Member", email: "member@specimen.invalid", owner: false, canPublish: false, seesLeads: false } as unknown as Person;

const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  const who = c.req.header("x-specimen-who");
  if (who) c.set("who", who === "owner" ? OWNER : MEMBER);
  await next();
});
app.route("/", seo.routes);
app.onError(apiError);
async function ask<T = Record<string, unknown>>(p: string, o: { who?: "owner" | "member"; method?: string; body?: unknown } = {}): Promise<{ status: number; json: T }> {
  const res = await app.request(p, {
    method: o.method ?? "GET",
    headers: { ...(o.who ? { "x-specimen-who": o.who } : {}), ...(o.body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as T };
}

const count = (sql: string, ...a: (string | number)[]): number => (db.prepare(sql).get(...a) as { n: number }).n;

try {
  /* ============ 1. nothing connected ========================================= */
  section("1. nothing connected");
  {
    const snap = collector.jobs.find((j) => j.name === "seo-snapshot")!;
    check("the collector hands over the engine's jobs", ["seo-snapshot", "seo-engine", "seo-readiness", "seo-referrals", "seo-research", "seo-competitors", "seo-presence"].every((n) => collector.jobs.some((j) => j.name === n)), collector.jobs.map((j) => j.name));
    check("the snapshot is not ready without Search Console", snap.ready!() === false);
    let said = "";
    try {
      await rank.runSnapshot();
    } catch (e) {
      said = e instanceof Error ? e.message : String(e);
    }
    check("asked anyway, it fails with Search Console's own reason", /key|Search Console|service-account/i.test(said), said);
    check("and no request was made", requests === 0, requests);
    check("the history is empty, and says so", rank.historyFrom() === null && rank.spanOf("30d") === null);
  }

  /* ============ 2. the rank history ========================================== */
  section("2. the rank history");
  writeFileSync(path.join(dir, "key.json"), JSON.stringify({ client_email: "desk-check@specimen-project.iam.gserviceaccount.com", private_key: "not a key: the check never signs with it" }));
  process.env.GA4_CREDENTIALS_FILE = path.join(dir, "key.json");
  gsc.wire.bearer = async () => "check-token";
  process.env.GSC_API_BASE = `${HERE}/gsc`;
  {
    const a = await gsc.checkAccess();
    check("the stand-in property is readable", a.state === "ok" && a.site === "sc-domain:balkaris.ch", a);
    const line = await rank.runSnapshot();
    const days = shared.eachDay(FIRST, NEWEST).length;
    check("the first run back-fills from the property's first day to the newest finished day", line.startsWith(`Back-filled ${days} days`) && line.includes(`${FIRST} to ${NEWEST}`), line);
    check("every day is snapshotted, the day without rows included", count("SELECT COUNT(*) AS n FROM cc_seo_snaps") === days && count("SELECT COUNT(*) AS n FROM cc_seo_snaps WHERE day = ? AND query_rows = 0 AND day_rows = 0", GAP) === 1);
    check("that day reads as a real zero, not a gap", rank.daySeries(GAP, GAP).length === 1 && rank.daySeries(GAP, GAP)[0]!.impressions === 0);
    const sum = (pick: (r: Fixture) => boolean) => fixture.filter(pick).reduce((n, r) => n + r.impressions, 0);
    const t = rank.totals(FIRST, NEWEST);
    check("all countries: the impressions read back equal the stand-in's", t.impressions === sum(() => true), { kept: t.impressions, given: sum(() => true) });
    const che = rank.totals(FIRST, NEWEST, { country: "che" });
    check("Switzerland is kept apart", che.impressions === sum((r) => r.country === "che"), { kept: che.impressions, given: sum((r) => r.country === "che") });
    const q = rank.queryFigures(FIRST, NEWEST).find((x) => x.query === "specimen query gamma");
    check("a query's figures and position read back", q?.impressions === sum((r) => r.query === "specimen query gamma") && q?.position === 2, q);
    const p = rank.pageFigures(FIRST, NEWEST).find((x) => x.path === "/specimen-b");
    check("a page's figures read back by path", p?.impressions === sum((r) => r.page.endsWith("/specimen-b")), p);
    const asked = gscAsked.length;
    const again = await rank.runSnapshot();
    check("a second run asks Google for nothing and says it is up to date", again.startsWith("Up to date") && gscAsked.length === asked, { again, asked: gscAsked.length - asked });
    const next = dayAt(-3);
    fixture.push({ day: next, query: "specimen query gamma", page: `${SITE}/specimen-c`, device: "MOBILE", country: "che", clicks: 1, impressions: 9, position: 2 });
    store.forget("gsc:anchor");
    const added = await rank.runSnapshot();
    check("a newly finished day is kept alone", added.startsWith("Kept 1 day") && added.includes(`${next} to ${next}`) && rank.lastSnapDay() === next, added);
    const span = rank.spanOf("30d")!;
    check("a 30-day window before the history began is not compared", span.compared === false && span.historyFrom === FIRST, span);
    check("a 7-day window inside the history is", rank.spanOf("7d")!.compared === true);
    const b = rank.bucketsByDay(dayAt(-30), dayAt(-30))[0];
    check("top 3, 10, 20 and 50 are counted per day", b?.top3 === 1 && b.top10 === 3 && b.top20 === 3 && b.top50 === 4 && b.queries === 4, b);
    const g = rank.bucketsByDay(GAP, GAP)[0];
    check("  a day Google showed nothing is a row of zeros", g?.queries === 0 && g.top50 === 0, g);
    check("new and lost queries only against a window the history covers", rank.newAndLost(rank.spanOf("30d")!) === null && rank.newAndLost(rank.spanOf("7d")!)?.added.length === 0);
    const tiles = rank.tiles(rank.spanOf("7d")!);
    check("tiles: a rate under 30 impressions carries its raw counts", tiles.ctr.now.den < 30 ? tiles.ctr.now.small === true : tiles.ctr.now.small === false, tiles.ctr.now);
  }

  /* ============ 3. the audit's files ======================================== */
  section("3. the audit's files, imported twice");
  const audit = path.join(dir, "audit");
  {
    mkdirSync(path.join(audit, "keywords"), { recursive: true });
    mkdirSync(path.join(audit, "chrome"), { recursive: true });
    mkdirSync(path.join(audit, "offsite"), { recursive: true });
    writeFileSync(
      path.join(audit, "keywords", "keywords.csv"),
      [
        "keyword,lang,sources,relevant,relevance_note,cluster,intent,local,question,price,target_page",
        "specimen query alpha,en,search-console,yes,,specimen-cluster:en,commercial,no,no,no,https://www.balkaris.ch/specimen-a",
        "specimen query delta,en,search-console,yes,,specimen-cluster:en,commercial,no,no,no,https://www.balkaris.ch/specimen-b",
        "was kostet specimen,de,autocomplete,yes,,specimen-gap:de,commercial,no,yes,yes,no page",
        "specimen ohne bezug,de,autocomplete,no,unrelated,specimen-gap:de,informational,no,no,no,no page",
        "specimen noise only,en,autocomplete,no,unrelated,specimen-noise:en,informational,no,no,no,no page",
      ].join("\n"),
    );
    writeFileSync(
      path.join(audit, "keywords", "clusters.csv"),
      [
        "attack_rank,cluster,name,lang,intent,target_page,page_status,winnability,winnability_reason,attack_reason,action,examples",
        "1,specimen-gap:de,What a specimen costs (DE),de,commercial,no page,gap,high,specimen reason,specimen attack,A German specimen page,was kostet specimen | specimen preis",
        "2,specimen-cluster:en,Specimen services,en,commercial,https://www.balkaris.ch/specimen-a,exists,medium,,,,specimen query alpha",
        "3,specimen-noise:en,Specimen noise,en,informational,no page,gap,low,,,,specimen noise only",
      ].join("\n"),
    );
    writeFileSync(
      path.join(audit, "audit.json"),
      JSON.stringify({
        "measure:off-site": {
          actions: [{ action: "Create the specimen profile on specimen-directory.example and verify it.", who: "owner login", impact: "high", effort: "hours", why: "Specimen reason." }],
        },
        "verify:off-site": {
          actions: [{ action: "Create the specimen profile on specimen-directory.example and verify it, then add the specimen address.", who: "owner login", impact: "high", effort: "hours", why: "Specimen reason, verified." }],
        },
        "measure:search-console": {
          actions: [
            { action: "In Search Console: request indexing for the specimen pages.", who: "owner login", impact: "medium", effort: "minutes", why: "Specimen reason." },
            { action: "A desk tool for the specimen.", who: "desk tool", impact: "low", effort: "days", why: "Not a person's step." },
          ],
        },
        directions: "Specimen prose, not a section with actions.",
      }),
    );
    writeFileSync(
      path.join(audit, "chrome", "ai-checks.json"),
      JSON.stringify({
        day: "2026-01-15",
        by: "audit",
        checks: [
          { engine: "chatgpt", question: "Who makes specimen websites in Specimenville?", lang: "en", kind: "category", mentioned: false, competitors: ["Specimen Rival A"], sources: ["specimen-rival-a.example"], excerpt: "Named a specimen rival.", note: null },
          { engine: "perplexity", question: "What is specimen.invalid?", lang: "en", kind: "domain", mentioned: true, competitors: [], sources: [], excerpt: null, note: null },
          { engine: "no-such-engine", question: "Refused?", lang: "en", kind: "brand", mentioned: false },
        ],
      }),
    );
    writeFileSync(
      path.join(audit, "chrome", "serp.json"),
      JSON.stringify({
        day: "2026-01-15",
        by: "audit",
        searches: [
          {
            query: "was kostet specimen",
            lang: "de",
            organic: [
              { position: 1, domain: "specimen-rival-a.example" },
              { position: 2, domain: "reddit.com" },
            ],
            localPack: [{ position: 1, name: "Specimen Rival B", domain: null, note: "sponsored" }],
            aioNamed: [],
            aioCited: [],
          },
        ],
      }),
    );
    writeFileSync(
      path.join(audit, "offsite", "profiles.json"),
      JSON.stringify({ day: "2026-01-15", profiles: [{ key: "specimen-directory", name: "Specimen Directory", kind: "directory", url: null, state: "not-found", seen: null, ownerTask: "audit-specimen", note: null }] }),
    );

    const first = imports.importAll(audit);
    check("the first import adds every table", first.lines.some((l) => l.startsWith("keywords: 5 read, 5 added")) && first.lines.some((l) => l.startsWith("clusters: 3 read, 3 added")) && first.lines.some((l) => /^AI checks: 2 read, 2 added.*refused 1/.test(l)), first.lines);
    check(
      "a verified pass replaces the measured one, and a desk tool is no person's task",
      count("SELECT COUNT(*) AS n FROM cc_seo_owner_tasks") === 2 && owner.ownerTasks(["owner"]).some((t) => t.step.includes("then add the specimen address")),
      owner.ownerTasks(["owner", "lead-chrome", "code", "content"]).map((t) => t.id),
    );
    check("a step's title is its first sentence, not a lone 'In Search Console'", owner.titleOf("In Search Console: Indexing › Pages › Validate fix. Then wait.") === "In Search Console: Indexing › Pages › Validate fix");
    check("a Search Console step is the lead's in the owner's browser", owner.ownerTasks(["lead-chrome"]).some((t) => t.id === "gsc-request-indexing"));
    check("a sponsored map-pack entry keeps the word", (db.prepare("SELECT note FROM cc_seo_sightings WHERE kind = 'local-pack'").get() as { note: string | null }).note === "sponsored");
    check("a platform's sighting is kept, its page is not read as a competitor's", count("SELECT COUNT(*) AS n FROM cc_seo_sightings WHERE domain = 'reddit.com'") === 1 && count("SELECT COUNT(*) AS n FROM cc_seo_comp_pages WHERE domain = 'reddit.com'") === 0);
    const kw = keywords.keywords().find((k) => k.phrase === "specimen query alpha")!;
    keywords.setKeywordStatus(keywords.keywords().find((k) => k.phrase === "specimen query delta")!.id, "weak", "Specimen Owner");
    const second = imports.importAll(audit);
    const changedAny = second.lines.some((l) => /[1-9][\d,]* (added|changed)/.test(l));
    check("importing the same files again changes nothing", !changedAny, second.lines);
    check("a person's status survives the re-import", keywords.keywords().find((k) => k.phrase === "specimen query delta")!.status === "weak");
    check("the audit's mapping is kept", kw.page === "/specimen-a" && kw.mappedBy === "audit", kw);
  }

  /* ============ 4. the opportunity engine ===================================== */
  section("4. the opportunity engine");
  {
    const day = store.today();
    const put = db.prepare(
      "INSERT INTO cc_inspect (day, url, verdict, coverage, last_crawl, google_canonical, user_canonical, robots_state, fetch_state, indexing_state, is_indexed, canonical_ok, link, checked_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?)",
    );
    put.run(day, `${SITE}/specimen-d`, "NEUTRAL", "Crawled - currently not indexed", 0, new Date().toISOString());
    put.run(day, `${SITE}/specimen-a`, "PASS", "Submitted and indexed", 1, new Date().toISOString());

    const line = await engine.runEngine();
    check("the engine runs and says what it found", /open opportunities/.test(line), line);
    const opps = engine.allOpportunities();
    const by = (id: string) => opps.find((o) => o.id === id);
    const alpha = engine.opportunity("near-page-one:specimen query alpha");
    check("early signals: a query shown under the floor is listed and marked", !!alpha && alpha.early === true, alpha && { early: alpha.early, ev: alpha.evidence.map((e) => e.label) });
    check("  an early row is at most medium, though relevant and commercial", alpha?.priority === "medium", alpha?.priority);
    check("  'our estimate' is made from its impressions and says so", !!alpha?.potential && /our estimate/.test(alpha.potential.basis), alpha?.potential);
    check("  the phrase's mapping reaches the brief (a page that answers it)", alpha?.action.kind === "brief" || alpha?.action.kind === "proposal", alpha?.action);
    check("low CTR: a page at position 2 with no clicks", !!by("low-ctr:/specimen-c"), opps.map((o) => o.id));
    const drop = engine.opportunity("ranking-drop:specimen query delta");
    check("a ranking drop between the last two fortnights", !!drop && /fell from 5 to 12/.test(drop.title), drop?.title);
    check("a German cluster with a relevant phrase is a gap", !!by("german-missing:specimen-gap:de"));
    check("  a cluster with no relevant phrase is not", !by("keyword-gap:specimen-noise:en"));
    check("  a gap has no estimate without impressions", engine.opportunity("german-missing:specimen-gap:de")?.potential === null);
    check("not indexed: from the newest URL Inspection", !!by("not-indexed:/specimen-d") && !by("not-indexed:/specimen-a"));
    check("  its action is the lead's by hand, never a button that pretends", engine.opportunity("not-indexed:/specimen-d")?.action.kind === "chrome");
    const ent = opps.find((o) => o.type === "entity");
    check("an owner task is an off-site opportunity that only the owner can act on", !!ent && engine.opportunity(ent.id)?.action.available === false, ent?.id);

    /* A person's decision survives every run. */
    engine.setState("low-ctr:/specimen-c", "dismissed", OWNER, "Specimen: not now.");
    await engine.runEngine();
    let o = engine.opportunity("low-ctr:/specimen-c")!;
    check("a person's decision survives a run", o.state.state === "dismissed" && o.state.by === "Specimen Owner" && o.state.note === "Specimen: not now." && o.active, o.state);

    /* The rules stop finding it: cleared, decision kept. */
    engine.setState("not-indexed:/specimen-d", "in-progress", MEMBER);
    db.prepare("UPDATE cc_inspect SET is_indexed = 1, verdict = 'PASS', coverage = 'Submitted and indexed' WHERE url = ?").run(`${SITE}/specimen-d`);
    await engine.runEngine();
    o = engine.opportunity("not-indexed:/specimen-d")!;
    check("one the rules no longer find is cleared, its decision kept", o.active === false && !!o.clearedWhy && o.state.state === "in-progress" && o.state.by === "Specimen Member", { active: o.active, why: o.clearedWhy, state: o.state.state });
    db.prepare("UPDATE cc_inspect SET is_indexed = 0, verdict = 'NEUTRAL', coverage = 'Crawled - currently not indexed' WHERE url = ?").run(`${SITE}/specimen-d`);
    const back = await engine.runEngine();
    o = engine.opportunity("not-indexed:/specimen-d")!;
    check("found again, it comes back with that same decision", o.active === true && o.state.state === "in-progress" && /, 1 found again\)/.test(back), { active: o.active, state: o.state.state, back });

    /* A family that could not look clears nothing. */
    db.prepare("DELETE FROM cc_inspect").run();
    await engine.runEngine();
    check("a rule family that could not look clears nothing", engine.opportunity("not-indexed:/specimen-d")?.active === true);

    /* The request-indexing queue's done mark is a person's. */
    const submitted = engine.markSubmitted("/specimen-d", true, MEMBER);
    check("'requested indexing' is marked by a person, by name", submitted.state.state === "in-progress" && submitted.state.by === "Specimen Member");

    /* The engine's job only runs whole on news. */
    store.setState("seo:engine:last", JSON.stringify({ at: new Date(Date.now() + 60_000).toISOString(), line: "specimen" }));
    check("with nothing new since its last whole run, the engine job only follows its tasks", seoJobs.engineDue() === null);
    store.setState("seo:engine:last", JSON.stringify({ at: new Date(Date.now() - 7 * 3600_000).toISOString(), line: "specimen" }));
    check("six hours on, it runs whole again", seoJobs.engineDue() !== null);
  }

  /* ============ 5. Autocomplete's budget ====================================== */
  section("5. Google Autocomplete's weekly budget");
  {
    let sent = 0;
    const sleeps: number[] = [];
    keywords.wire.suggest = async (seed) => {
      sent++;
      return { status: 200, suggestions: [`${seed} specimen suggestion ${sent}`] };
    };
    keywords.wire.sleep = async (ms) => void sleeps.push(ms);
    const week = keywords.isoWeek();
    shared.setCount("seo:autocomplete", week, keywords.AUTOCOMPLETE_CAP - 2);
    const line = await keywords.research({ most: 20 });
    check("with two requests left, the research sends two and stops", sent === 2 && keywords.budget().used === keywords.AUTOCOMPLETE_CAP, { sent, used: keywords.budget().used, line });
    check("  one second or more between requests", sleeps.length >= 1 && sleeps.every((ms) => ms >= 1000), sleeps);
    check("  what it found is kept unjudged, with its source", keywords.keywords().filter((k) => k.sources.includes("autocomplete") && k.status === "unjudged" && k.seed).length === 2);
    const again = await keywords.research({ most: 20 });
    check("the 121st request of the week is never sent", sent === 2 && /budget/.test(again), again);
    check("spend() refuses at the cap", keywords.spend() === false);
  }

  /* ============ 6. AI and search crawlers ===================================== */
  section("6. AI and search crawlers, from the request records");
  {
    const UA: Record<string, string> = {
      GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
      "OAI-SearchBot": "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
      "ChatGPT-User": "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
      PerplexityBot: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
      "Perplexity-User": "Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
      ClaudeBot: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      "Claude-SearchBot": "Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)",
      "Claude-User": "Mozilla/5.0 (compatible; Claude-User/1.0; +https://www.anthropic.com)",
      Googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      Bingbot: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      Applebot: "Mozilla/5.0 (Macintosh) AppleWebKit (KHTML, like Gecko) Version/17 Safari (Applebot/0.1)",
      Amazonbot: "Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)",
      CCBot: "CCBot/2.0 (https://commoncrawl.org/faq/)",
      "meta-externalagent": "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    };
    const wrong = Object.entries(UA).filter(([name, ua]) => drain.agentOf(ua) !== name);
    check("each crawler is named from its user agent", !wrong.length, wrong.map(([n, ua]) => `${n} → ${drain.agentOf(ua)}`));
    check("a browser is no crawler", drain.agentOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36") === null);
    check("Google-Extended is a robots.txt token, never counted as a visitor", drain.agentOf("Google-Extended") === null);
    const t = Date.now();
    const rec = (ua: string, p: string, i: number) => ({ id: `specimen-${i}`, requestId: `specimen-req-${i}`, proxy: { timestamp: t, host: "www.balkaris.ch", method: "GET", path: p, userAgent: [ua], statusCode: 200 } });
    drain.ingest([rec(UA.GPTBot!, "/specimen-a", 1), rec(UA["OAI-SearchBot"]!, "/specimen-a", 2), rec(UA["OAI-SearchBot"]!, "/specimen-b", 3), rec(UA.ClaudeBot!, "/specimen-a", 4)], { now: t });
    const today = store.today();
    const c = await aisearch.aiCrawlers(today, today);
    check("crawler visits are counted per crawler and per page", c.hits === 4 && c.byAgent.find((a) => a.agent === "OAI-SearchBot")?.hits === 2 && c.byPage.find((p) => p.path === "/specimen-a")?.hits === 3, c);
    check("  with each crawler's company and purpose", c.byAgent.find((a) => a.agent === "OAI-SearchBot")?.purpose === "search" && c.byAgent.find((a) => a.agent === "GPTBot")?.company === "OpenAI");
    const keys = (db.prepare("SELECT key FROM cc_drain_days").all() as { key: string }[]).map((r) => r.key);
    check("no user agent string is kept anywhere", !keys.some((k) => /Mozilla|compatible|http/i.test(k)), keys.filter((k) => /Mozilla|compatible|http/i.test(k)));
  }

  /* ============ 7. the engine's addresses ===================================== */
  section("7. the engine's addresses: rights and answers");
  {
    const newCheck = { engine: "gemini", question: "Who is the specimen studio?", lang: "en", day: "2026-01-16", kind: "brand", mentioned: true, competitors: [], sources: [], by: "lead-chrome" };
    let a = await ask("/ai-checks", { who: "member", method: "POST", body: { checks: [newCheck] } });
    check("recording AI checks: a signed-in person who is not the owner is refused", a.status === 403, a);
    a = await ask("/ai-checks", { who: "owner", method: "POST", body: { checks: [newCheck] } });
    check("  the owner records them", a.status === 200 && a.json.added === 1, a);
    a = await ask("/ai-checks", { who: "owner", method: "POST", body: { checks: [newCheck] } });
    check("  the same check twice is one row", a.status === 200 && a.json.added === 0, a);
    a = await ask("/ai-checks", { who: "owner", method: "POST", body: { checks: [{ ...newCheck, engine: "no-such-engine" }] } });
    check("  a check that is not right is refused with what is wrong", a.status === 400 && /engine must be/.test(String(a.json.error)), a);

    const csv = "Query,Impressions\nspecimen question one,3\nspecimen question two,1\n";
    a = await ask("/imports/gsc-generative-ai", { who: "member", method: "POST", body: { month: "2026-01", csv } });
    check("a manual import: refused to a person who is not the owner", a.status === 403, a);
    a = await ask("/imports/gsc-generative-ai", { who: "owner", method: "POST", body: { month: "2026-01", csv } });
    check("  the owner imports it", a.status === 200 && /2 rows, added/.test(JSON.stringify(a.json)), a);
    a = await ask("/imports/gsc-generative-ai", { who: "owner", method: "POST", body: { month: "2026-01", csv } });
    check("  the same file twice changes nothing", a.status === 200 && /unchanged/.test(JSON.stringify(a.json)), a);
    a = await ask("/imports/audit", { who: "member", method: "POST" });
    check("  the audit import is the owner's too", a.status === 403, a);
    check("  the import is kept as exported, with who did it", aisearch.lastImport("gsc-generative-ai")?.rows.length === 2 && aisearch.lastImport("gsc-generative-ai")?.importedBy === "Specimen Owner");

    const task = owner.ownerTasks(["owner"])[0]!;
    a = await ask(`/owner-tasks/${task.id}`, { who: "member", method: "POST", body: { done: true, note: "Specimen note." } });
    check("a done mark is a person's, by name", a.status === 200 && (a.json.task as { doneBy: string }).doneBy === "Specimen Member", a);
    a = await ask("/owner-tasks/no-such-task", { who: "member", method: "POST", body: { done: true } });
    check("  an unknown task is 404 { error }", a.status === 404 && typeof a.json.error === "string", a);
    a = await ask(`/owner-tasks/${task.id}`, { who: "member", method: "POST", body: { done: "yes" } });
    check("  a done that is not true or false is 400 { error }", a.status === 400, a);

    a = await ask("/clusters/specimen-gap:de/page", { who: "member", method: "POST", body: { path: "/nowhere-the-crawl-knows" } });
    check("mapping a cluster to a page the crawl does not know is refused", a.status === 400, a);
    a = await ask("/indexing/requested", { who: "member", method: "POST", body: { path: "/specimen-d", submitted: false } });
    check("the indexing queue's mark can be taken back", a.status === 200 && (a.json.opportunity as { state: { state: string } }).state.state === "open", a);

    const nav = await ask<{ opportunities: number; needsYou: number; tabs: { key: string; count: number | null }[] }>("/nav", { who: "member" });
    const open = count("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE active = 1 AND state IN ('open', 'queued', 'in-progress')");
    check("/nav counts the open opportunities, and the tab carries it", nav.status === 200 && nav.json.opportunities === open && nav.json.tabs.find((t) => t.key === "opportunities")?.count === open && nav.json.tabs.length === 11, nav.json);
    const au = await ask<{ audit: unknown }>("/audit", { who: "member" });
    check("/audit answers { audit } before any audit", au.status === 200 && au.json.audit === null, au.json);
  }

  /* ============ 8. a page's failure is that page's ============================ */
  section("8. one page's failure costs that page only");
  {
    const pages = mkdtempSync(path.join(ROOT, "work", "check-seo-engine-"));
    try {
      const good = path.join(pages, "good.ts");
      const broken = path.join(pages, "broken.ts");
      writeFileSync(good, 'import { Hono } from "hono";\nexport const routes = new Hono();\nroutes.get("/", (c) => c.json({ specimen: true, who: (c.get("who" as never) as { name?: string } | undefined)?.name ?? null }));\n');
      writeFileSync(broken, 'throw new Error("specimen page, broken on purpose");\nexport const routes = null;\n');
      const quiet = console.error;
      console.error = () => {};
      const g = await seo.loadPage("specimen-good", good);
      const b = await seo.loadPage("specimen-broken", broken);
      console.error = quiet;
      check("a page that loads is handed its requests", g?.state === "ok");
      if (g?.state === "ok") {
        const res = await g.app.fetch(new Request("http://specimen.invalid/"));
        check("  and answers them", res.status === 200 && ((await res.json()) as { specimen: boolean }).specimen === true);
      }
      check("a page that throws while loading is 'broken' with what it threw", b?.state === "broken" && /broken on purpose/.test(b.detail), b);
      check("  and is a failing check by name", sources.checks().some((x) => x.name === "The SEO specimen-broken page loads" && !x.ok));
      check("a page whose file is not there is not loaded (asked again next time)", seo.loadPage("specimen-missing", path.join(pages, "missing.ts")) === null);
      const TABS = ["overview", "opportunities", "pages", "keywords", "content-gaps", "backlinks", "technical", "search-console", "competitors", "ai-search", "automations"];
      check("every page of the tab strip has its address", TABS.every((t) => (seo.SEO_PAGES as readonly string[]).includes(t)));
      const nothing = await ask("/no-such-specimen-page", { who: "member" });
      check("a name with no page file is a 404 { error }", nothing.status === 404 && typeof nothing.json.error === "string", nothing);
      const report = await seo.routes.request("/report");
      check("the first screen's own addresses still answer before any page", report.status === 200);
      const absent = seo.SEO_PAGES.find((n) => !existsSync(seo.pageFile(n)));
      if (absent) {
        const r = await ask(`/${absent}`, { who: "member" });
        check(`a page not written yet (${absent}) answers 503 { error }, and the others still answer`, r.status === 503 && typeof r.json.error === "string" && (await ask("/nav", { who: "member" })).status === 200, r);
      } else console.log("     (every page's file exists on this desk: the 503 of a missing one is proved through loadPage above)");
    } finally {
      rmSync(pages, { recursive: true, force: true });
    }
  }

  /* ============ 9. competitors, politely ====================================== */
  section("9. competitor pages, read politely");
  {
    const calls: { url: string }[] = [];
    const sleeps: number[] = [];
    competitors.wire.sleep = async (ms) => void sleeps.push(ms);
    competitors.wire.fetchPage = async (url) => {
      calls.push({ url });
      if (url.endsWith("/robots.txt")) return { status: 200, url, html: "User-agent: *\nDisallow: /private\n", contentType: "text/plain", error: null };
      return { status: 200, url, html: '<html lang="de"><title>Specimen Rival</title><main><h1>Specimen</h1><p>Ab CHF 1\'500 für eine specimen Seite.</p></main></html>', contentType: "text/html", error: null };
    };
    competitors.addCompetitorPage({ url: "https://specimen-rival-c.example/private/page", domain: "specimen-rival-c.example", address: "ranking", cluster: null, query: null });
    const line = await competitors.refreshPages();
    const pagesRead = calls.filter((c) => !c.url.endsWith("/robots.txt"));
    check("robots.txt is asked first on every site", calls[0]?.url.endsWith("/robots.txt") === true, calls.map((c) => c.url));
    check("a page robots.txt disallows is never fetched", !pagesRead.some((c) => c.url.includes("/private/")) && competitors.competitorPages({ domain: "specimen-rival-c.example" })[0]?.error?.includes("robots.txt") === true, line);
    check("two seconds between requests to a site", sleeps.includes(2000), sleeps);
    const read = competitors.competitorPages({ domain: "specimen-rival-a.example" })[0];
    check("what a page says is kept: title, language, a stated price", read?.title === "Specimen Rival" && read.lang === "de" && read.priceStated === true, read);
  }

  /* ============ 10. AI readiness of a page ==================================== */
  section("10. AI readiness of a page");
  {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `specimen${i}`).join(" ");
    const html = `<html lang="en"><head><script type="application/ld+json">${JSON.stringify({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "What does a specimen cost here?" }, { "@type": "Question", name: "How long does a specimen take?" }] })}</script></head><body><main><h1>Specimen service</h1><p>${words(60)} Balkaris Zürich</p><h2>What does a specimen cost here?</h2><p>From CHF 900.</p><h2>How long does a specimen take?</h2><p>About 3 weeks.</p></main></body></html>`;
    const c = readinessMod.judgePage(html, "service", null);
    const state = (k: string) => c.find((x) => x.key === k)?.state;
    check("a direct answer under the heading is found", state("answer") === "pass", c.find((x) => x.key === "answer"));
    check("questions on the page, and all of them in FAQPage", state("faq") === "pass" && state("faq-schema") === "pass");
    check("a stated price and a duration", state("price") === "pass" && state("timeline") === "pass");
    check("no German version and no date are fails with their fix", state("german") === "fail" && state("updated") === "fail" && !!c.find((x) => x.key === "german")?.fix);
    check("a check that does not apply to a kind of page says so", readinessMod.judgePage(html, "legal", null).every((x) => x.state === "n/a"));
  }

  section("nothing left the machine");
  check("every request went to the stand-in", refused.length === 0, refused);
} catch (e) {
  failed++;
  console.log("FAIL the check itself threw:", e);
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
