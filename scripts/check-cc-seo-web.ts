/**
 * The SEO web layer (src/cc/seo/web/), proved without the network.
 *
 *   npm run check:seo-web
 *
 * A throwaway database, no key, and `fetch` refused unless a part of the
 * check routes it on purpose. Every outside answer comes from a stand-in
 * wire: the trimmed real pages and documented samples in
 * scripts/fixtures/seo-web/, or small answers written here and named so.
 *
 * What is proved:
 *   1. the readers: Google's basic result page (organic ten, map pack, ads,
 *      related), its captcha, script shell, 403 and consent answers;
 *      DuckDuckGo lite and its challenge; Google's and Bing's suggestions
 *      (Google's in ISO-8859-1); DataForSEO's documented samples;
 *   2. the research modes' request lists;
 *   3. researchPhrase: merged suggestions with their sources, Google's
 *      strength, the keyword table's row and the cluster rule; the seven-day
 *      cache (a second look sends nothing); the person-asked allowance (cut
 *      at a whole mode, then 429); a 429 pauses the source until tomorrow;
 *   4. the fetch door end to end: a check queued, handed out at most every
 *      four seconds, fetched by the workstation's half (consent bounce
 *      followed, a host off the list refused, a redirect off the list
 *      refused, headers cut down), posted back through the door's HTTP
 *      routes, read into a done check and sightings with title and address;
 *      the DuckDuckGo second opinion from the server; a task left running is
 *      handed out again; the daily Google allowance; the first captcha pauses
 *      Google for 24 hours and says until when;
 *   5. the domain guard: IP literals, localhost, local names, credentials,
 *      ports, private ranges after DNS and at connect time; a whole lookup
 *      with stand-in answers, kept seven days;
 *   6. the Keyword Planner import (UTF-16 tab-separated with its preamble,
 *      ranges; UTF-8 comma-separated);
 *   7. DataForSEO: off with the owner's step; with a login, the result page,
 *      volumes, difficulty, the refusal of English to Labs, an auth refusal,
 *      the month's spend;
 *   8. the weekly rank check.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-web-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "GOOGLE_API_KEY", "SEO_RESEARCH_DAILY", "SEO_GOOGLE_DAILY", "SEO_DOMAIN_DAILY", "DESK_FETCH_CLIENT"]) delete process.env[k];

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "seo-web");
const fixture = (name: string): string => readFileSync(path.join(FIX, name), "utf8");
const bytes = (name: string): Buffer => readFileSync(path.join(FIX, name));

/* ---- nothing leaves this machine, unless routed to the door on purpose ---- */
let route: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (route && url.startsWith("http://desk.test/")) return route(url, init);
  throw new Error(`the check tried to leave the machine: ${url}`);
}) as typeof fetch;

let passed = 0;
let failed = 0;
function check(name: string, good: boolean, detail?: unknown): void {
  if (good) passed++;
  else failed++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${!good && detail !== undefined ? `\n     ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
}
async function refusal(p: () => unknown): Promise<{ status: number; message: string } | null> {
  try {
    await p();
    return null;
  } catch (e) {
    return { status: Number((e as { status?: number }).status ?? 0), message: (e as Error).message };
  }
}

const { db } = await import("../src/db.ts");
await import("../src/cc/seo/tables.ts");
const shared = await import("../src/cc/seo/web/shared.ts");
const parse = await import("../src/cc/seo/web/parse.ts");
const suggest = await import("../src/cc/seo/web/suggest.ts");
const fetchq = await import("../src/cc/seo/web/fetchq.ts");
const work = await import("../src/cc/seo/web/work.ts");
const serp = await import("../src/cc/seo/web/serp.ts");
const door = await import("../src/cc/seo/web/door.ts");
const guard = await import("../src/cc/seo/web/guard.ts");
const domain = await import("../src/cc/seo/web/domain.ts");
const volumes = await import("../src/cc/seo/web/volumes.ts");
const dfs = await import("../src/cc/seo/web/dataforseo.ts");
const keywords = await import("../src/cc/seo/keywords.ts");
const store = await import("../src/cc/store.ts");
const { Hono } = await import("hono");

/* The clock: pacing and pauses take no time here. */
let t0 = Date.now();
shared.clock.now = () => t0;
shared.clock.sleep = async (ms: number) => {
  t0 += ms;
};
const advance = (ms: number): void => {
  t0 += ms;
};

/* A cluster and a phrase the table already tracks. */
keywords.upsertCluster({ key: "webdesign-de", name: "Webdesign, German", lang: "de", intent: "commercial", priority: "high", rank: 1, page: null, pageSaid: null, why: null, action: null, examples: ["webdesign agentur zürich", "webdesign agentur kosten"], source: "audit" });
keywords.upsertKeyword({ phrase: "webdesign zürich preise", lang: "de", cluster: "webdesign-de", source: "audit", status: "relevant", by: "audit" });
const trackedId = (db.prepare("SELECT id FROM cc_seo_keywords WHERE phrase = ?").get("webdesign zürich preise") as { id: number }).id;

try {
  /* ---- 1. the readers ---------------------------------------------------------- */
  const g = parse.readGoogle({ status: 200, finalUrl: "https://www.google.com/search?q=webdesign+z%C3%BCrich&gl=ch&hl=de&ucbcb=1", body: fixture("google-webdesign-zuerich-de.html") });
  check("Google's basic page is read as a result page", g.ok);
  if (g.ok) {
    const r = g.result;
    check("ten organic results, numbered 1 to 10", r.organic.length === 10 && r.organic.every((o, i) => o.position === i + 1), r.organic.map((o) => o.position));
    check("the first is violetta.ch with its title and address", r.organic[0]!.host === "www.violetta.ch" && r.organic[0]!.url.startsWith("https://www.violetta.ch/") && /Webdesign Agentur Zürich/.test(r.organic[0]!.title), r.organic[0]);
    check("no snippet carries HTML", r.organic.every((o) => !/[<>]/.test(o.snippet)), r.organic.map((o) => o.snippet.slice(-40)));
    check("the map pack: three businesses with rating, reviews, category and street", r.localPack.length === 3 && r.localPack[1]!.rating === 5 && r.localPack[1]!.reviews === 67 && r.localPack[1]!.category === "Webdesigner" && r.localPack[1]!.address === "Rennweg 57", r.localPack);
    check("seven ads and their hosts, never counted as results", r.ads === 7 && r.adHosts.length === 7 && !r.organic.some((o) => o.host === "envyo.de"), r.adHosts);
    check("the related searches", r.related.length === 14 && r.related.includes("Webdesign Bern"), r.related);
    check("no people-also-ask on the basic page", r.questions.length === 0);
  }
  const sorry = parse.readGoogle({ status: 429, finalUrl: "https://www.google.com/sorry/index?continue=x", body: fixture("google-sorry.html") });
  check("Google's captcha page is a refusal (429, /sorry/)", !sorry.ok && sorry.refused && sorry.kind === "captcha", sorry);
  const sorry200 = parse.readGoogle({ status: 200, finalUrl: "https://www.google.com/search?q=x", body: fixture("google-sorry.html") });
  check("the captcha page is recognised by its words even when it answers 200", !sorry200.ok && sorry200.kind === "captcha");
  const shell = parse.readGoogle({ status: 200, finalUrl: "https://www.google.com/search?q=x", body: fixture("google-shell.html") });
  check("the script shell is a refusal, not 'nobody ranks'", !shell.ok && shell.refused && shell.kind === "shell", shell);
  const forbidden = parse.readGoogle({ status: 403, finalUrl: "https://www.google.com/search?q=x", body: fixture("google-403.html") });
  check("a 403 is a refusal", !forbidden.ok && forbidden.refused && forbidden.kind === "forbidden");
  const consent = parse.readGoogle({ status: 200, finalUrl: "https://consent.google.com/ml?continue=x", body: "<html><form action=save></form></html>" });
  check("a consent form is a refusal", !consent.ok && consent.kind === "consent");

  const d = parse.readDdgLite({ status: 200, body: fixture("ddg-lite-webdesign-zuerich.html") });
  check("DuckDuckGo lite: ten results with their real addresses", d.ok && d.result.organic.length === 10 && d.result.organic[0]!.host === "d4design.ch" && d.result.organic.every((o) => !o.url.includes("duckduckgo.com/l/")), d.ok ? d.result.organic.map((o) => o.url) : d);
  const ch = parse.readDdgLite({ status: 202, body: fixture("ddg-challenge.html") });
  check("DuckDuckGo's challenge is a refusal", !ch.ok && ch.refused && ch.kind === "captcha", ch);
  const ch200 = parse.readDdgLite({ status: 200, body: fixture("ddg-challenge.html") });
  check("…even when it answers 200", !ch200.ok && ch200.kind === "captcha");

  const gs = suggest.parseGoogleSuggest(suggest.decodeAnswer(bytes("google-suggest-chrome.json"), "text/javascript; charset=ISO-8859-1"));
  check("Google's suggestions in ISO-8859-1 are decoded, with strength and type", !!gs && gs.length === 5 && gs[0]!.phrase === "webdesign zürich preise" && gs[0]!.strength === 601 && gs[0]!.type === "QUERY", gs);
  const gf = suggest.parseGoogleSuggest(suggest.decodeAnswer(bytes("google-suggest-front.json"), "text/javascript; charset=ISO-8859-1"));
  check("Google's front completions: 15 phrases ending in the phrase", !!gf && gf.length === 15 && gf.every((x) => x.phrase.endsWith("agentur zürich")), gf?.map((x) => x.phrase));
  const bs = suggest.parseBingSuggest(suggest.decodeAnswer(bytes("bing-suggest.json"), "application/json; charset=utf-8"));
  check("Bing's suggestions, without a strength", !!bs && bs.length === 2 && bs.every((x) => x.strength === null), bs);
  check("an answer that is not a suggestion list is null, not an empty list", suggest.parseGoogleSuggest("<html>") === null);

  const dj = (name: string) => JSON.parse(fixture(name)) as { tasks: { result: unknown[] }[] };
  const ds = dfs.parseSerp(dj("dataforseo-serp.json").tasks[0]!.result[0] as never);
  check("DataForSEO's documented result page: organic, map pack, an ad, questions, related", ds.organic.length >= 1 && ds.organic[0]!.url.startsWith("https://") && ds.localPack.length >= 1 && ds.ads === 1 && ds.questions.length === 2 && ds.related.length === 8, ds);
  const dv = dfs.parseVolumes(dj("dataforseo-volume.json").tasks[0]!.result);
  check("DataForSEO's documented volumes: volume, CPC, competition in lower case, months", dv.length === 3 && dv[0]!.keyword === "buy laptop" && dv[0]!.volume === 2900 && dv[0]!.cpc === 7.95 && dv[0]!.competition === "high" && dv[0]!.monthly.length === 3, dv[0]);
  const dd = dfs.parseDifficulty(dj("dataforseo-difficulty.json").tasks[0]!.result);
  check("DataForSEO's documented difficulty", dd.length === 3 && dd.some((x) => x.keyword === "pizza brooklyn" && x.difficulty === 44), dd);
  const dr = dfs.parseRanked(dj("dataforseo-ranked.json").tasks[0]!.result);
  check("DataForSEO's documented ranked keywords", dr.total === 3696 && dr.rows.length === 2 && dr.rows.every((r) => r.position > 0 && r.keyword), dr);
  const dc = dfs.parseCompetitors(dj("dataforseo-competitors.json").tasks[0]!.result);
  check("DataForSEO's documented competitors: domain, shared phrases", dc.length === 2 && dc[0]!.domain === "health.com" && dc[0]!.shared === 182, dc);
  const dov = dfs.parseOverview(dj("dataforseo-overview.json").tasks[0]!.result);
  check("DataForSEO's documented overview: count, top 3, top 10", !!dov && dov.count === 1788 && dov.top3 === 39 && dov.top10 === 139, dov);
  const db_ = dfs.parseBacklinks(dj("dataforseo-backlinks.json").tasks[0]!.result);
  check("DataForSEO's documented backlink summary", !!db_ && db_.referringDomains === 12372 && db_.firstSeen === "2020-01-18" && db_.rank === 371, db_);

  /* ---- 2. the modes' request lists --------------------------------------------- */
  const q = suggest.requestsFor("Webdesign  Zürich", "de", "questions");
  check("questions in German: 7 words in front, for Google and Bing", q.length === 14 && q[0]!.q === "was webdesign zürich" && q.some((r) => r.q === "was kostet webdesign zürich") && q.filter((r) => r.source === "bing").length === 7, q.map((r) => `${r.source}:${r.q}`));
  const m = suggest.requestsFor("webdesign zürich", "de", "modifiers");
  check("modifiers leave out a word the phrase has ('zürich')", m.length === 14 && !m.some((r) => r.q === "webdesign zürich zürich") && m.some((r) => r.q === "webdesign zürich kosten"), m.map((r) => r.q));
  const a = suggest.requestsFor("webdesign zürich", "de", "alphabet");
  check("a to z: 26 Google requests only", a.length === 26 && a.every((r) => r.source === "google") && a[25]!.q === "webdesign zürich z");
  const f = suggest.requestsFor("agentur zürich", "de", "front");
  check("front: one Google request with a leading space and the cursor at 0", f.length === 1 && f[0]!.q === " agentur zürich" && f[0]!.front);
  check("French and Italian question words", suggest.requestsFor("agence web", "fr", "questions").length === 8 && suggest.requestsFor("agenzia web", "it", "questions")[0]!.q === "come agenzia web");

  /* ---- 3. researchPhrase --------------------------------------------------------- */
  const calls = { google: 0, bing: 0 };
  let googleStatus = 200;
  const ans = (status: number, body: unknown, latin = false) => ({ status, contentType: latin ? "text/javascript; charset=ISO-8859-1" : "application/json; charset=utf-8", body: latin ? Buffer.from(JSON.stringify(body), "latin1") : Buffer.from(JSON.stringify(body)) });
  suggest.wire.google = async (text: string) => {
    calls.google++;
    const typed = text.trim();
    const rows = text.startsWith(" ") ? [`seo ${typed}`, `branding ${typed}`] : [`${typed} preise`, `${typed} agentur`, `${typed}?`];
    return ans(googleStatus, [text, rows, rows.map(() => ""), [], { "google:suggestrelevance": rows.map((_, i) => 601 - i), "google:suggesttype": rows.map(() => "QUERY") }], true);
  };
  suggest.wire.bing = async (text: string) => {
    calls.bing++;
    return ans(200, [text, [text, `${text} agentur`, `${text} schweiz`]]);
  };
  const r1 = await suggest.researchPhrase({ seed: "Webdesign Zürich", lang: "de", modes: ["plain", "questions"], by: "Check" });
  check("research sends one request per Google and Bing query of each mode", r1.sent === 16 && calls.google === 8 && calls.bing === 8, { sent: r1.sent, calls });
  const pre = r1.suggestions.find((s) => s.phrase === "webdesign zürich preise");
  check("a suggestion keeps Google's strength (an order, not a volume) and its mode", !!pre && pre.strength === 601 && pre.modes[0] === "plain" && pre.sources.includes("google"), pre);
  check("the phrase the table tracks carries its row", pre?.tracked?.id === trackedId && pre.tracked.status === "relevant" && pre.tracked.cluster === "webdesign-de", pre?.tracked);
  const both = r1.suggestions.find((s) => s.phrase === "webdesign zürich agentur");
  check("a phrase both engines offered lists both", !!both && both.sources.includes("google") && both.sources.includes("bing"), both);
  check("Bing's echo of what was typed is not a suggestion", !r1.suggestions.some((s) => s.phrase === "webdesign zürich" && s.sources.length === 1 && s.sources[0] === "bing"));
  check("a question is flagged", r1.suggestions.some((s) => s.question && s.phrase.startsWith("was ")), r1.suggestions.filter((s) => s.question).map((s) => s.phrase).slice(0, 3));
  check("the desk's rule files an untracked phrase by its words", both?.cluster?.key === "webdesign-de" && both.cluster.filed === "words", both?.cluster);
  check("the list is ordered by Google's strength", r1.suggestions[0]!.strength === 601);
  check("the answer counts against today's research allowance", r1.allowance.used === 16 && r1.allowance.cap === 400);
  const r2 = await suggest.researchPhrase({ seed: "webdesign zürich", lang: "de", modes: ["plain", "questions"], by: "Check" });
  check("a second look within seven days sends nothing", r2.sent === 0 && r2.kept === 16 && calls.google === 8 && r2.suggestions.length === r1.suggestions.length, { sent: r2.sent, kept: r2.kept });
  check("…and says so per source", r2.sources.every((s) => s.state === "kept"), r2.sources);
  advance(8 * 86_400_000);
  const r3 = await suggest.researchPhrase({ seed: "webdesign zürich", lang: "de", modes: ["plain"], by: "Check" });
  check("after seven days it is asked again", r3.sent === 2, r3.sent);
  /* The allowance: fill it nearly up, a research is cut at a whole mode. */
  store.setState("seo:web:research:day", JSON.stringify({ day: store.today(), used: 395 }));
  const r4 = await suggest.researchPhrase({ seed: "grafik agentur", lang: "de", modes: ["plain", "questions"], by: "Check" });
  check("a research that does not fit today's allowance is cut at whole parts and says so", r4.sent <= 5 && !!r4.stopped && /allowance/.test(r4.stopped), { sent: r4.sent, stopped: r4.stopped });
  store.setState("seo:web:research:day", JSON.stringify({ day: store.today(), used: 400 }));
  const used = await refusal(() => suggest.researchPhrase({ seed: "videoproduktion zürich", lang: "de", by: "Check" }));
  check("with today's allowance used and nothing kept: 429 and a sentence", used?.status === 429 && /research requests are used/.test(used.message), used);
  const kept = await suggest.researchPhrase({ seed: "webdesign zürich", lang: "de", modes: ["plain"], by: "Check" });
  check("…but what was kept can still be looked at", kept.sent === 0 && kept.suggestions.length > 0);
  store.setState("seo:web:research:day", JSON.stringify({ day: store.today(), used: 0 }));
  googleStatus = 429;
  const r5 = await suggest.researchPhrase({ seed: "imagefilm kosten", lang: "de", modes: ["plain", "questions"], by: "Check" });
  const gl = r5.sources.find((s) => s.source === "google");
  check("Google's 429 pauses Google until tomorrow and says so", gl?.state === "refused" && /Google refused \(429\); paused until tomorrow/.test(gl.line) && !!suggest.sourcePaused("google"), gl);
  const before = calls.google;
  await suggest.researchPhrase({ seed: "imagefilm preise", lang: "de", modes: ["plain"], by: "Check" });
  check("a paused source is not asked again", calls.google === before);
  store.setState("seo:web:suggest:pause:google", "null");
  googleStatus = 200;
  check("a phrase that is no phrase is refused (400)", (await refusal(() => suggest.researchPhrase({ seed: "x", by: "Check" })))?.status === 400);
  const tr = suggest.trackSuggestions([{ phrase: "webdesign zürich agentur", cluster: "webdesign-de" }], { seed: "webdesign zürich", lang: "de", by: "Check" });
  check("chosen suggestions join the keyword table as autocomplete phrases", tr.added === 1 && (db.prepare("SELECT sources FROM cc_seo_keywords WHERE phrase = ?").get("webdesign zürich agentur") as { sources: string }).sources === "autocomplete");

  /* ---- 4. the fetch door ---------------------------------------------------------- */
  serp.wire.ddg = async (url: string, headers: Record<string, string>) => {
    check("DuckDuckGo is asked with the desk's own name and kl=ch-de", headers["user-agent"]?.startsWith("BalkarisDesk/") && url.includes("kl=ch-de"), { url, headers });
    return { status: 200, body: fixture("ddg-lite-webdesign-zuerich.html") };
  };
  const asked = await serp.requestSerp({ phrase: "webdesign zürich", lang: "de", by: "Check", clusterKey: "webdesign-de" });
  check("without DataForSEO, Google's check is queued for the workstation", asked.google?.state === "queued" && asked.google.source === "workstation" && asked.google.label === "Google, fetched by the studio workstation", asked.google);
  check("its line says whether the workstation is on", /No workstation has asked for fetch tasks yet/.test(asked.google?.line ?? ""), asked.google?.line);
  check("DuckDuckGo's second opinion is read by the server now, labelled not Google", asked.duckduckgo?.state === "done" && asked.duckduckgo.engine === "duckduckgo" && asked.duckduckgo.label.includes("not Google") && asked.duckduckgo.page?.organic.length === 10, asked.duckduckgo);
  const ddgSight = db.prepare("SELECT domain, engine, kind, position, by, title, url FROM cc_seo_sightings WHERE engine = 'duckduckgo' ORDER BY position").all() as { domain: string; position: number; by: string; title: string | null; url: string | null }[];
  check("DuckDuckGo's results became sightings by the server, with title and address", ddgSight.length >= 9 && ddgSight[0]!.domain === "d4design.ch" && ddgSight[0]!.by === "server" && !!ddgSight[0]!.title && !!ddgSight[0]!.url, ddgSight.slice(0, 2));
  const again = await serp.requestSerp({ phrase: "webdesign zürich", lang: "de", by: "Check" });
  check("asking again does not queue a second Google check", again.google?.id === asked.google?.id && /already on its way/.test(again.line), again.line);
  check("…and DuckDuckGo's look of the last six hours stands, with no new request", again.duckduckgo?.id === asked.duckduckgo?.id && /that answer stands/.test(again.line), again.line);
  const other = await serp.requestSerp({ phrase: "webagentur bern", lang: "de", by: "Check", second: true });
  check("…and another phrase waits DuckDuckGo's two minutes", other.duckduckgo === null && /at most every two minutes/.test(other.line), other.line);
  serp.withdrawSerp(other.google!.id, "Check");

  /* The workstation's half: what it refuses whatever the box says. */
  const hopNever: import("../src/cc/seo/web/work.ts").Hop = async () => {
    throw new Error("must not be asked");
  };
  const off1 = await work.fetchTask({ id: 1, url: "https://intranet.example.com/admin", headers: {}, timeoutMs: 10_000, maxBytes: 10_000 }, hopNever);
  check("the workstation refuses a host off its list", !off1.ok && off1.kind === "blocked" && /not on the list/.test(off1.error), off1);
  const off2 = await work.fetchTask({ id: 1, url: "http://www.google.com/search?q=x", headers: {}, timeoutMs: 10_000, maxBytes: 10_000 }, hopNever);
  check("…plain http", !off2.ok && /only https/.test(off2.error));
  const off3 = await work.fetchTask({ id: 1, url: "https://www.google.com:8443/search?q=x", headers: {}, timeoutMs: 10_000, maxBytes: 10_000 }, hopNever);
  check("…another port", !off3.ok && /port 8443/.test(off3.error));
  const off4 = await work.fetchTask({ id: 1, url: "https://user:pw@www.google.com/search?q=x", headers: {}, timeoutMs: 10_000, maxBytes: 10_000 }, hopNever);
  check("…an address with a password", !off4.ok && /password/.test(off4.error));
  const redirectOff = await work.fetchTask({ id: 1, url: "https://www.google.com/search?q=x", headers: {}, timeoutMs: 10_000, maxBytes: 10_000 }, async () => ({ status: 302, location: "https://192.168.1.1/", contentType: null, body: Buffer.alloc(0) }));
  check("…and a redirect off the list", !redirectOff.ok && /refused to follow a redirect/.test(redirectOff.error), redirectOff);
  const big = await work.fetchTask({ id: 1, url: "https://www.google.com/search?q=x", headers: {}, timeoutMs: 10_000, maxBytes: 1000 }, async () => ({ status: 200, location: null, contentType: "text/html", body: Buffer.alloc(5000, 97) }));
  check("…and a page larger than the cap", !big.ok && /larger than/.test(big.error));
  check("only three harmless headers are ever sent", JSON.stringify((await import("../src/cc/seo/web/allow.ts")).cleanHeaders({ "User-Agent": "x", Cookie: "secret", Authorization: "Bearer y", "Accept-Language": "de\r\nX-Evil: 1" })) === JSON.stringify({ "user-agent": "x", "accept-language": "de X-Evil: 1" }));

  /* The door's routes, as the runner reaches them. */
  const app = new Hono();
  app.all("/runner/fetch/*", (c) => door.fetchDoor(c));
  route = (url, init) => Promise.resolve(app.request(url.replace("http://desk.test", ""), init));
  const seen: string[] = [];
  const hop: import("../src/cc/seo/web/work.ts").Hop = async (req) => {
    seen.push(req.url);
    const u = new URL(req.url);
    if (u.hostname === "www.google.com" && !u.searchParams.has("ucbcb")) return { status: 302, location: `https://consent.google.com/ml?continue=${encodeURIComponent(req.url)}`, contentType: null, body: Buffer.alloc(0) };
    if (u.hostname === "consent.google.com") return { status: 303, location: `${decodeURIComponent(u.searchParams.get("continue")!)}&ucbcb=1`, contentType: null, body: Buffer.alloc(0) };
    check("the workstation sends the Opera Mini agent the box chose", req.headers["user-agent"]?.includes("Opera Mini") === true && !("cookie" in req.headers), req.headers);
    return { status: 200, location: null, contentType: "text/html; charset=UTF-8", body: bytes("google-webdesign-zuerich-de.html") };
  };
  const logs: string[] = [];
  const did = await work.fetchOnce({ desk: "http://desk.test", name: "studio", secret: "s", hop, log: (l) => logs.push(l) });
  check("fetchOnce takes the task through the door, follows the consent bounce and posts the page back", did && seen.length === 3 && seen[1]!.startsWith("https://consent.google.com/"), { did, seen, logs });
  const done = serp.serpCheck(asked.google!.id)!;
  check("the check is done from the workstation's page", done.state === "done" && done.page?.organic.length === 10 && done.page.localPack.length === 3, done.line);
  check("Balkaris's own place: not in the first ten", done.ownPosition === null && /not among the first 10/.test(done.line), done.line);
  const gSight = db.prepare("SELECT domain, position, by, title, url, cluster FROM cc_seo_sightings WHERE engine = 'google' AND kind = 'organic' ORDER BY position").all() as { domain: string; position: number; by: string; title: string; url: string; cluster: string | null }[];
  check("every organic row became a Google sighting by the workstation, with title, address and cluster", gSight.length === 10 && gSight[0]!.domain === "violetta.ch" && gSight[0]!.by === "workstation" && gSight[0]!.url.startsWith("https://www.violetta.ch/") && gSight[0]!.cluster === "webdesign-de", gSight[0]);
  const local = db.prepare("SELECT domain, name, position FROM cc_seo_sightings WHERE engine = 'google-local'").all() as { domain: string; name: string }[];
  check("the map pack became google-local sightings by name", local.length === 3 && local[0]!.domain.startsWith("name:"), local);
  check("the activity feed heard of it", (db.prepare("SELECT COUNT(*) AS n FROM cc_activity WHERE kind = 'seo-serp'").get() as { n: number }).n >= 2);
  check("the page itself is not kept, only how it ended", (db.prepare("SELECT state, bytes FROM cc_seo_fetch_tasks WHERE id = ?").get(done.id && asked.google!.id ? (db.prepare("SELECT fetch_id FROM cc_seo_serp_checks WHERE id = ?").get(asked.google!.id) as { fetch_id: number }).fetch_id : 0) as { state: string; bytes: number }).state === "done");
  check("latestSerp gives the newest done check of each engine", serp.latestSerp("webdesign zürich", "de").google?.id === done.id && serp.latestSerp("webdesign zürich").duckduckgo?.engine === "duckduckgo");
  check("the workstation now counts as on", fetchq.workstation().on);
  const reuse = await serp.requestSerp({ phrase: "webdesign zürich", lang: "de", by: "Check", second: false });
  check("a check younger than six hours answers the same question without a fetch", reuse.google?.id === done.id && /that answer stands/.test(reuse.line), reuse.line);

  /* The pace, the allowance and a task left running. */
  const c2 = await serp.requestSerp({ phrase: "seo agentur zürich", lang: "de", by: "Check", second: false });
  const c3 = await serp.requestSerp({ phrase: "webagentur bern", lang: "de", by: "Check", second: false });
  const h1 = await fetchq.handOutFetch("studio");
  check("the next Google fetch waits four seconds after the last", h1.task === null && /next Google fetch may go/.test(h1.wait ?? ""), h1);
  advance(4100);
  const h2 = await fetchq.handOutFetch("studio");
  check("then it is handed out, oldest first", !!h2.task && h2.task.url.includes("seo%20agentur"), h2.task?.url);
  advance(3 * 60_000);
  const h3 = await fetchq.handOutFetch("studio");
  check("a task not answered in two minutes is handed out again", h3.task?.id === h2.task?.id && (fetchq.fetchRow(h2.task!.id)?.attempts ?? 0) === 2, h3.task);
  check("the result of an unknown task is a 404", (await refusal(() => fetchq.takeFetchResult(999999, { ok: true, status: 200, finalUrl: "https://www.google.com/", body: "" })))?.status === 404);
  const bad = await app.request("/runner/fetch/result/1", { method: "POST", body: "not json", headers: { "content-type": "application/json" } });
  check("a malformed result is a 400 at the door", bad.status === 400);

  /* The first captcha pauses Google for 24 hours. */
  const capt = await fetchq.takeFetchResult(h3.task!.id, { ok: true, status: 429, finalUrl: "https://www.google.com/sorry/index?continue=x", body: fixture("google-sorry.html"), ms: 900, client: "curl" });
  check("a captcha answer is taken", capt.state === "done");
  const failedCheck = serp.serpCheck(c2.google!.id)!;
  check("its check fails with the sentence and the time the pause ends", failedCheck.state === "failed" && /paused until \d\d:\d\d on \d+ \w+/.test(failedCheck.error ?? ""), failedCheck.error);
  const lane = serp.googleLane();
  check("the Google lane is paused for 24 hours", !!lane.paused && Math.abs(Date.parse(lane.paused.until) - t0 - 24 * 3600_000) < 5000 && /Google refused the workstation/.test(lane.line), lane);
  advance(10_000);
  const h4 = await fetchq.handOutFetch("studio");
  check("nothing is handed out to Google while paused, and the door says why", h4.task === null && /paused until/.test(h4.wait ?? ""), h4);
  const p2 = await serp.requestSerp({ phrase: "grafik agentur zürich", lang: "de", by: "Check", second: false });
  check("asking now queues no Google check and says until when", p2.google === null && /Google refused the workstation; paused until/.test(p2.line), p2.line);
  check("the waiting check's line says it waits for the pause", /Waiting: Google refused the workstation/.test(serp.serpCheck(c3.google!.id)!.line), serp.serpCheck(c3.google!.id)!.line);
  check("the feed warned about the pause", (db.prepare("SELECT COUNT(*) AS n FROM cc_activity WHERE kind = 'seo-serp' AND tone = 'warn'").get() as { n: number }).n === 1);
  advance(24 * 3600_000 + 1000);
  check("after 24 hours the pause is over", serp.googleLane().paused === null);
  /* The daily allowance of sixty. */
  store.setState("seo:web:fetch:google:day", JSON.stringify({ day: store.today(), used: 60 }));
  const h5 = await fetchq.handOutFetch("studio");
  check("past sixty Google fetches today nothing is handed out", h5.task === null && /today's 60 Google fetches are used/.test(h5.wait ?? ""), h5);
  const p3 = await serp.requestSerp({ phrase: "logo design zürich", lang: "de", by: "Check", second: false });
  check("…and no new Google check is queued", p3.google === null && /Today's 60 Google checks/.test(p3.line), p3.line);
  store.setState("seo:web:fetch:google:day", JSON.stringify({ day: store.today(), used: 0 }));
  check("a waiting check can be withdrawn", serp.withdrawSerp(c3.google!.id, "Check") && serp.serpCheck(c3.google!.id)!.state === "failed");

  /* ---- 5. the domain guard and a lookup ---------------------------------------- */
  const refused = ["localhost", "127.0.0.1", "http://[::1]/", "10.0.0.5", "intranet", "printer.local", "db.internal", "https://user:pw@example.ch", "https://example.ch:8080/", "ftp://example.ch", "file:///etc/passwd", "site.test"];
  for (const r of refused) check(`the guard refuses ${r}`, !guard.checkAddress(r).ok, guard.checkAddress(r));
  for (const r of ["webkinder.ch", "https://www.webkinder.ch/de/", "http://agence-exemple.ch:80/"]) check(`the guard takes ${r}`, guard.checkAddress(r).ok, guard.checkAddress(r));
  for (const ip of ["10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "127.0.0.53", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:a00:1", "224.0.0.1"]) check(`${ip} is private`, guard.privateAddress(ip));
  for (const ip of ["8.8.8.8", "185.199.108.153", "2a00:1450:4001:80b::2003"]) check(`${ip} is public`, !guard.privateAddress(ip));
  const dnsTable: Record<string, string[]> = { "rebind.specimen-site.ch": ["10.0.0.5"], "www.rebind.specimen-site.ch": ["10.0.0.5"], "studio-specimen.ch": ["45.11.22.33"], "www.studio-specimen.ch": ["45.11.22.33"], "closed-specimen.ch": ["45.11.22.34"] };
  guard.dnsWire.lookup = async (host: string) => {
    const list = dnsTable[host];
    if (!list) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  const rebind = await refusal(() => domain.lookupDomain("rebind.specimen-site.ch", "Check"));
  check("a name that resolves into a private range is refused (400)", rebind?.status === 400 && /private or reserved/.test(rebind.message), rebind);
  const connect = await guard.siteWire.get("https://rebind.specimen-site.ch/");
  check("…and refused again at connect time, with no connection made", connect.status === 0 && /private or reserved/.test(connect.error ?? ""), connect.error);
  check("an address the person typed with a port is refused before any request", (await refusal(() => domain.lookupDomain("https://studio-specimen.ch:3000/", "Check")))?.status === 400);

  const realSite = guard.siteWire.get;
  const siteCalls: string[] = [];
  const page = (status: number, body: string, type = "text/html; charset=utf-8", url = ""): import("../src/cc/seo/web/guard.ts").Got => ({ status, url, headers: { "content-type": type }, body: Buffer.from(body), error: null, cut: false });
  guard.siteWire.get = async (address: string) => {
    siteCalls.push(address);
    const u = new URL(address);
    if (u.hostname === "closed-specimen.ch" && u.pathname === "/robots.txt") return page(200, "User-agent: *\nDisallow: /\n", "text/plain", address);
    if (u.pathname === "/robots.txt") return page(200, "User-agent: *\nDisallow: /intern/\nSitemap: https://studio-specimen.ch/sitemap_index.xml\n", "text/plain", address);
    if (u.pathname === "/sitemap_index.xml") return page(200, `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://studio-specimen.ch/page-sitemap.xml</loc></sitemap></sitemapindex>`, "application/xml", address);
    if (u.pathname === "/page-sitemap.xml")
      return page(
        200,
        `<urlset xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>https://studio-specimen.ch/de/</loc><lastmod>2026-09-30</lastmod><xhtml:link rel="alternate" hreflang="fr" href="https://studio-specimen.ch/fr/"/></url><url><loc>https://studio-specimen.ch/de/projekte/a</loc><lastmod>2026-10-02T10:00:00+00:00</lastmod></url><url><loc>https://studio-specimen.ch/de/projekte/b</loc></url><url><loc>https://studio-specimen.ch/fr/projets/a</loc></url></urlset>`,
        "application/xml",
        address,
      );
    if (u.pathname === "/")
      return page(
        200,
        `<!doctype html><html lang="de-CH"><head><title>Studio Specimen – Webdesign Zürich</title><meta name="description" content="Ein erfundenes Studio für die Prüfung."><meta name="generator" content="WordPress 6.6"><link rel="alternate" hreflang="de" href="/de/"><link rel="alternate" hreflang="fr" href="/fr/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Studio Specimen"}</script></head><body><main><h1>Webdesign aus Zürich</h1><p>Websites ab CHF 4'900 für kleine Firmen.</p><img src="/wp-content/uploads/x.jpg"></main></body></html>`,
        "text/html; charset=utf-8",
        address,
      );
    return page(404, "not found", "text/html", address);
  };
  const apiCalls: string[] = [];
  domain.apiWire.get = async (url: string) => {
    apiCalls.push(url);
    if (url.startsWith("https://rdap.nic.ch/domain/")) return { status: 200, text: JSON.stringify({ ldhName: "studio-specimen.ch", status: ["active"], events: [{ eventAction: "registration", eventDate: "2015-06-17T00:00:00Z" }], entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Specimen Registrar AG"]]] }], nameservers: [{ ldhName: "NS1.SPECIMEN.CH" }] }) };
    if (url.startsWith("https://tranco-list.eu/")) return { status: 200, text: JSON.stringify({ ranks: [], domain: "studio-specimen.ch" }) };
    if (url.startsWith("https://web.archive.org/")) return { status: 200, text: JSON.stringify([["timestamp", "original", "statuscode"], ["20151121161504", "http://www.studio-specimen.ch:80/", "200"]]) };
    if (url === "https://index.commoncrawl.org/collinfo.json") return { status: 200, text: JSON.stringify([{ id: "CC-MAIN-2026-39", "cdx-api": "https://index.commoncrawl.org/CC-MAIN-2026-39-index" }]) };
    if (url.startsWith("https://index.commoncrawl.org/CC-MAIN-2026-39-index")) return { status: 200, text: ['{"url":"https://www.studio-specimen.ch/","languages":"deu"}', '{"url":"https://www.studio-specimen.ch/fr/","languages":"fra,deu"}', '{"url":"https://www.studio-specimen.ch/de/a","languages":"deu"}'].join("\n") };
    if (url.includes("wikipedia.org")) return { status: 200, text: JSON.stringify(url.startsWith("https://de.") ? { query: { exturlusage: [{ title: "Specimen (Begriffsklärung)", url: "https://www.studio-specimen.ch/" }] } } : { query: { exturlusage: [] } }) };
    return { status: 404, text: "" };
  };
  const look = await domain.lookupDomain("https://www.studio-specimen.ch/de/", "Check");
  const fx = look.facts;
  check("the domain is kept without www.", look.domain === "studio-specimen.ch");
  check("registration from SWITCH's RDAP: day and registrar", fx.registration.state === "ok" && fx.registration.value.registered === "2015-06-17" && fx.registration.value.registrar === "Specimen Registrar AG" && fx.registration.from.includes("SWITCH"), fx.registration);
  check("robots.txt: its sitemap and that the desk may read the home page", fx.robots.state === "ok" && fx.robots.value.sitemaps.length === 1 && fx.robots.value.deskAllowed && !fx.robots.value.closed, fx.robots);
  check("the sitemap index was followed: pages, sections, newest lastmod, languages", fx.sitemap.state === "ok" && fx.sitemap.value.pages === 4 && fx.sitemap.value.newest === "2026-10-02" && fx.sitemap.value.languages.join(",") === "de,fr" && fx.sitemap.value.sections.some((s) => s.section === "/projekte" && s.pages === 2), fx.sitemap);
  check("the home page: title, description, language, hreflang, structured data, built with, price", fx.home.state === "ok" && fx.home.value.title === "Studio Specimen – Webdesign Zürich" && fx.home.value.lang === "de-ch" && fx.home.value.hreflang.join(",") === "de,fr" && fx.home.value.schemaTypes.includes("Organization") && fx.home.value.builtWith.includes("WordPress") && fx.home.value.price.stated, fx.home);
  check("SWITCH's registrar is read from its org field", domain.rdapFacts({ entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["org", {}, "text", "METANET AG"]]] }] }).registrar === "METANET AG");
  check("not in Tranco is said as a fact, not a zero", fx.tranco.state === "off" && /not in the Tranco list: too small or too new/.test(fx.tranco.reason), fx.tranco);
  check("first seen by the Internet Archive", fx.wayback.state === "ok" && fx.wayback.value.firstSeen === "2015-11-21", fx.wayback);
  check("Common Crawl: pages and languages", fx.commoncrawl.state === "ok" && fx.commoncrawl.value.pages === 3 && fx.commoncrawl.value.languages[0]?.code === "deu", fx.commoncrawl);
  check("Wikipedia articles that link to it", fx.wikipedia.state === "ok" && fx.wikipedia.value.links.length === 1 && fx.wikipedia.value.links[0]!.wiki === "de", fx.wikipedia);
  check("without a Google key, CrUX and PageSpeed are off with the step", fx.crux.state === "off" && !!fx.crux.step && fx.pagespeed.state === "off", fx.crux);
  check("every fact names who said it", Object.values(fx).every((x) => typeof x.from === "string" && x.from.length > 2));
  const callsBefore = siteCalls.length + apiCalls.length;
  const again2 = await domain.lookupDomain("studio-specimen.ch", "Check");
  check("a second lookup within seven days asks nothing", siteCalls.length + apiCalls.length === callsBefore && again2.facts.home.state === "ok");
  check("domainFacts reads what is kept without asking", domain.domainFacts("studio-specimen.ch")?.facts.registration.state === "ok");
  const closed = await domain.lookupDomain("closed-specimen.ch", "Check", { only: ["robots", "home", "sitemap"] });
  check("a site whose robots.txt shuts everyone out is not read, and says so", closed.facts.robots.state === "ok" && closed.facts.robots.value.closed && closed.facts.home.state === "off" && /robots\.txt does not let the desk/.test(closed.facts.home.reason) && !siteCalls.some((c) => c.startsWith("https://closed-specimen.ch/") && !c.endsWith("/robots.txt")), closed.facts.home);
  guard.siteWire.get = realSite;

  /* ---- 6. the Keyword Planner export --------------------------------------------- */
  const tsv = ["Keyword Stats 2026-10-05 at 09_14_03", "1. Oktober 2025 - 30. September 2026", ["Keyword", "Currency", "Avg. monthly searches", "Three month change", "YoY change", "Competition", "Competition (indexed value)", "Top of page bid (low range)", "Top of page bid (high range)"].join("\t"), ["webdesign zürich preise", "CHF", "100 – 1K", "0%", "0%", "High", "78", "2.10", "9.50"].join("\t"), ["specimen planner phrase", "CHF", "10 – 100", "", "", "Low", "12", "", ""].join("\t"), ["leer", "CHF", "", "", "", "", "", "", ""].join("\t")].join("\r\n");
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tsv, "utf16le")]);
  const imp = volumes.importPlannerCsv(utf16, "Check");
  check("Planner's UTF-16 export: preamble skipped, the period read", imp.rows === 3 && imp.period === "1. Oktober 2025 - 30. September 2026" && imp.currency === "CHF", imp);
  check("a known phrase matched, a new one added, an empty figure skipped", imp.matched === 1 && imp.added === 1 && imp.skipped.length === 1, imp);
  const v1 = volumes.volumesOf([trackedId]).get(trackedId);
  check("a range is kept as low and high, with no single volume", v1?.volume === null && v1.low === 100 && v1.high === 1000 && v1.source === "planner" && v1.competition === "high" && v1.competitionIndex === 78 && v1.cpc === 5.8, v1);
  const csv = ["Keyword,Currency,Avg. monthly searches,Competition", '"webdesign zürich preise",CHF,"1,300",Medium'].join("\n");
  const imp2 = volumes.importPlannerCsv(csv, "Check");
  const v2 = volumes.volumesOf([trackedId]).get(trackedId);
  check("a UTF-8 comma-separated export with an exact figure", imp2.matched === 1 && v2?.volume === 1300 && v2.low === 1300 && v2.competition === "medium", v2);
  check("a file that is not an export is refused (400)", (await refusal(() => volumes.importPlannerCsv("a,b,c\n1,2,3", "Check")))?.status === 400);
  check("Planner's numbers: 1K, 10K, 1'300, 1.300", volumes.plannerNumber("1K") === 1000 && volumes.plannerNumber("10K") === 10000 && volumes.plannerNumber("1'300") === 1300 && volumes.plannerNumber("1.300") === 1300 && volumes.plannerNumber("2.10") === 2.1);

  /* ---- 7. DataForSEO ------------------------------------------------------------- */
  const st = dfs.status();
  check("DataForSEO is off with the owner's step and says it is untested", st.state === "off" && /app\.dataforseo\.com/.test(st.step ?? "") && /DATAFORSEO_LOGIN/.test(st.step ?? "") && /DATAFORSEO_PASSWORD/.test(st.step ?? "") && /not yet tried against a live account/.test(st.error ?? ""), st);
  check("buying volumes without it is refused with the step (409)", (await refusal(() => volumes.refreshVolumes([trackedId], "Check")))?.status === 409);
  const paidOff = await dfs.paidDomainFacts("studio-specimen.ch", "de", "Check");
  check("a domain's paid facts are off without an account", paidOff.backlinks.state === "off" && paidOff.ranked.state === "off");
  process.env.DATAFORSEO_LOGIN = "specimen-login";
  process.env.DATAFORSEO_PASSWORD = "specimen-password";
  const dfsCalls: { url: string; body: unknown; auth: string }[] = [];
  let dfsAuthFails = false;
  dfs.wire.post = async (url: string, body: unknown, auth: string) => {
    dfsCalls.push({ url, body, auth });
    if (dfsAuthFails) return { status: 401, json: { status_code: 40100, status_message: "You are not authorized to access this resource." } };
    const name = url.includes("/serp/") ? "dataforseo-serp.json" : url.includes("search_volume") ? "dataforseo-volume.json" : url.includes("bulk_keyword_difficulty") ? "dataforseo-difficulty.json" : url.includes("ranked_keywords") ? "dataforseo-ranked.json" : url.includes("competitors_domain") ? "dataforseo-competitors.json" : url.includes("domain_rank_overview") ? "dataforseo-overview.json" : "dataforseo-backlinks.json";
    return { status: 200, json: JSON.parse(fixture(name)) };
  };
  const paid = await serp.requestSerp({ phrase: "logo design zürich", lang: "de", by: "Check", second: false });
  check("with a login, Google's page comes from DataForSEO at once", paid.google?.state === "done" && paid.google.source === "dataforseo" && paid.google.label === "Google, through DataForSEO" && paid.google.page!.questions.length === 2, paid.google);
  const sent = dfsCalls[0]!;
  check("…asked for Switzerland (2756) in German, with Basic auth", (sent.body as { location_code: number; language_code: string }[])[0]!.location_code === 2756 && (sent.body as { language_code: string }[])[0]!.language_code === "de" && sent.auth.startsWith("Basic ") && sent.url.endsWith("/serp/google/organic/live/advanced"));
  db.prepare("UPDATE cc_seo_keywords SET phrase = 'buy laptop' WHERE id = ?").run(trackedId);
  const rv = await volumes.refreshVolumes([trackedId], "Check");
  const v3 = volumes.volumesOf([trackedId]).get(trackedId);
  check("refreshVolumes keeps DataForSEO's volume with its source and day", rv.updated === 1 && v3?.volume === 2900 && v3.source === "dataforseo" && v3.cpc === 7.95, { rv, v3 });
  check("the month's spend is kept from the costs the answers state", dfs.spent().dollars > 0 && dfs.spent().calls >= 3, dfs.spent());
  check("Labs is not asked in English for Switzerland", (await refusal(() => dfs.keywordDifficulty(["web design zurich"], "en")))?.message.includes("no English database") === true);
  const pdf = await dfs.paidDomainFacts("studio-specimen.ch", "de", "Check", { fresh: true });
  check("a domain's paid facts: overview, ranked phrases, competitors, links", pdf.overview.state === "ok" && pdf.ranked.state === "ok" && pdf.competitors.state === "ok" && pdf.backlinks.state === "ok" && pdf.backlinks.from === "DataForSEO", pdf.backlinks);
  dfsAuthFails = true;
  const authErr = await refusal(() => dfs.serpLive("x y", "de"));
  check("a refused login is said with what to check", /refused the login/.test(authErr?.message ?? "") && dfs.status().state === "failing", { authErr, status: dfs.status() });
  dfsAuthFails = false;
  delete process.env.DATAFORSEO_LOGIN;
  delete process.env.DATAFORSEO_PASSWORD;

  /* ---- 8. the weekly rank check --------------------------------------------------- */
  check("with no targets table, the rank check says so", /No phrase is marked as a target yet/.test(await serp.rankCheck()));
  db.exec("CREATE TABLE IF NOT EXISTS cc_seo_kw_targets (keyword_id INTEGER PRIMARY KEY, by TEXT NOT NULL, at TEXT NOT NULL)");
  keywords.upsertKeyword({ phrase: "webdesign agentur winterthur", lang: "de", source: "manual", by: "Check" });
  const kid = (db.prepare("SELECT id FROM cc_seo_keywords WHERE phrase = ?").get("webdesign agentur winterthur") as { id: number }).id;
  db.prepare("INSERT INTO cc_seo_kw_targets (keyword_id, by, at) VALUES (?, ?, ?)").run(kid, "Check", new Date().toISOString());
  const rc = await serp.rankCheck();
  check("the rank check queues each target for the workstation", /1 target phrase queued for the studio workstation/.test(rc) && serp.latestSerp("webdesign agentur winterthur").pending?.source === "workstation", rc);
  check("a second run finds nothing due", /checked on Google in the last six days/.test(await serp.rankCheck()));
} catch (e) {
  failed++;
  console.log("FAIL the check stopped:", e);
} finally {
  route = null;
  try {
    db.close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
