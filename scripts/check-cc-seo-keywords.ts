/**
 * SEO › Keywords (src/cc/routes/seo/keywords.ts, src/cc/seo/keywords.ts),
 * proved without the network.
 *
 *   npm run check:seo-keywords
 *
 * A throwaway database, the real route behind a small Hono app that signs a
 * specimen owner or member in, and `fetch` refused: every outside answer comes
 * from a stand-in wire (Google's and Bing's suggestions, DuckDuckGo's lite
 * page from scripts/fixtures/seo-web/, the daily research's Google client).
 *
 * What is proved:
 *   1. the store: the daily research files each suggestion by its own
 *      language (an English completion of a German seed goes to the English
 *      sibling topic, without the seed's intent); a refused or unreadable
 *      answer does not spend the seed; it asks through the web layer's Google
 *      client; a person's "no page" for a topic survives the engine's remap,
 *      and "let the desk decide" gives it back; a hand refiling survives the
 *      audit's import; only a phrase a person alone added can be removed;
 *   2. the list: folded search (zürich, zuerich, zurich; "web design" for
 *      webdesign; one-letter words ignored), new and lost need a compared
 *      window, export ids that match nothing export nothing, the topics CSV;
 *   3. research on the web: a GET never asks the web and says what
 *      researching would cost; the POST asks the stand-ins and the address
 *      draws the answer again without asking; ticked phrases tracked, each by
 *      its own language, judged relevant by the person;
 *   4. who ranks: a Google check queued for the workstation, DuckDuckGo's
 *      second opinion read and labelled, both drawn by ?serp= and in a
 *      keyword's own view;
 *   5. a keyword's own view, briefs within the operator's 300 characters and
 *      never twice at once, editing, adding many, topics, removing;
 *   6. the local AI: tracked phrases go as the operator's keyword task, a
 *      research's phrases as a question under 1,000 characters;
 *   7. demand: the owner's Keyword Planner import shows on the row with its
 *      source, a member is refused, DataForSEO says it is not connected.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-keywords-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "SEO_RESEARCH_DAILY", "SEO_GOOGLE_DAILY", "DESK_DEV_USER"]) delete process.env[k];
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "absent.json");
process.env.SITE_READ_CLONE = "off";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "seo-web");

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

const { db } = await import("../src/db.ts");
await import("../src/cc/seo/tables.ts");
await import("../src/cc/operator/queue.ts");
const store = await import("../src/cc/seo/keywords.ts");
const shared = await import("../src/cc/seo/web/shared.ts");
const suggest = await import("../src/cc/seo/web/suggest.ts");
const serp = await import("../src/cc/seo/web/serp.ts");
const route = await import("../src/cc/routes/seo/keywords.ts");
const { apiError } = await import("../src/cc/api.ts");
const { Hono } = await import("hono");
import type { Person } from "../src/people.ts";
import type { Vars } from "../src/cc/access.ts";
import type { SeoKeywordsPayload } from "../web/src/contract/seo/keywords.ts";

const OWNER = { telegram: 1, name: "Specimen Owner", email: "owner@specimen.invalid", owner: true, canPublish: true, seesLeads: true } as unknown as Person;
const MEMBER = { telegram: 2, name: "Specimen Member", email: "member@specimen.invalid", owner: false, canPublish: false, seesLeads: false } as unknown as Person;

const API = "/api/v1/seo/keywords";
const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  c.set("who", c.req.header("x-specimen-who") === "member" ? MEMBER : OWNER);
  await next();
});
app.route(API, route.routes);
app.onError(apiError);

async function get(q = ""): Promise<SeoKeywordsPayload> {
  const res = await app.request(`${API}${q ? `?${q}` : ""}`);
  if (res.status !== 200) throw new Error(`GET ${q} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as SeoKeywordsPayload;
}
async function post<T = Record<string, unknown>>(p: string, body: unknown, who: "owner" | "member" = "owner"): Promise<{ status: number; json: T & { error?: string; line?: string } }> {
  const res = await app.request(`${API}${p}`, { method: "POST", headers: { "content-type": "application/json", "x-specimen-who": who }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as T & { error?: string; line?: string } };
}
const total = (p: SeoKeywordsPayload): number => (p.list.state === "ok" ? p.list.value.total : -1);
const idOf = (phrase: string): number => (db.prepare("SELECT id FROM cc_seo_keywords WHERE phrase = ?").get(phrase) as { id: number } | undefined)?.id ?? 0;
const rowOf = (phrase: string) => db.prepare("SELECT * FROM cc_seo_keywords WHERE phrase = ?").get(phrase) as Record<string, unknown> | undefined;

/* The web layer's clock: pacing takes no time here. */
let t0 = Date.now();
shared.clock.now = () => t0;
shared.clock.sleep = async (ms: number) => {
  t0 += ms;
};
store.wire.sleep = async () => {};
/* The daily research's own wire, before the stand-ins replace it: proved to read through the web layer. */
const defaultSuggest = store.wire.suggest;

/* ---- the specimen world -------------------------------------------------------- */
const topic = (key: string, name: string, lang: string) =>
  store.upsertCluster({ key, name, lang, intent: "commercial", priority: "high", rank: 1, page: null, pageSaid: null, why: null, action: null, examples: [], source: "audit" });
topic("ai-chatbot:de", "AI chatbot (DE)", "de");
topic("ai-chatbot:en", "AI chatbot (EN)", "en");
topic("webdesign:de", "Webdesign (DE)", "de");
store.upsertKeyword({ phrase: "ai chatbot für website", lang: "de", cluster: "ai-chatbot:de", intent: "commercial", source: "audit", status: "relevant", by: "audit" });
store.upsertKeyword({ phrase: "webdesign zürich preise", lang: "de", cluster: "webdesign:de", source: "audit", status: "relevant", by: "audit" });
store.upsertKeyword({ phrase: "web design agentur", lang: "de", cluster: "webdesign:de", source: "audit", status: "relevant", by: "audit" });
store.upsertKeyword({ phrase: "\"content marketing\"", lang: "en", source: "gsc", by: "gsc" });

try {
  /* ---- 1. the store ---------------------------------------------------------------------- */
  section("1. the store");
  check("French and Italian phrases are told by their words", store.langOfPhrase("prix création site web") === "fr" && store.langOfPhrase("quanto costa un sito per azienda") === "it" && store.langOfPhrase("xyz", "de") === "de");
  check("a topic's sibling of another language is found by its key", store.topicFor("ai-chatbot:de", "en") === "ai-chatbot:en" && store.topicFor("webdesign:de", "en") === null && store.topicFor("webdesign:de", "de") === "webdesign:de");

  const asked: string[] = [];
  store.wire.suggest = async (seed: string) => {
    asked.push(seed);
    return seed === "ai chatbot für website"
      ? { status: 200, suggestions: ["ai chatbot website maker", "ki chatbot für website kosten"], readable: true }
      : { status: 200, suggestions: [], readable: true };
  };
  const note1 = await store.research({ most: 1 });
  const en = rowOf("ai chatbot website maker");
  const de = rowOf("ki chatbot für website kosten");
  check("the daily research asked the topic's own phrase", asked[0] === "ai chatbot für website", { asked, note1 });
  check("an English completion of a German seed is English, under the English sibling topic, with no intent", en?.lang === "en" && en?.cluster === "ai-chatbot:en" && en?.intent === null, en);
  check("a German completion stays under the seed's topic with its intent", de?.lang === "de" && de?.cluster === "ai-chatbot:de" && de?.intent === "commercial", de);

  db.prepare("DELETE FROM cc_state WHERE key = 'seo:autocomplete:asked'").run();
  store.wire.suggest = async () => ({ status: 429, suggestions: [] });
  const note2 = await store.research({ most: 1 });
  const spent = JSON.parse((db.prepare("SELECT value FROM cc_state WHERE key = 'seo:autocomplete:asked'").get() as { value: string } | undefined)?.value ?? "{}") as Record<string, string>;
  check("a refused answer stops the run and does not spend the seed", /answered 429/.test(note2) && !Object.keys(spent).length, { note2, spent });
  store.wire.suggest = async () => ({ status: 200, suggestions: [], readable: false });
  const note3 = await store.research({ most: 1 });
  check("an unreadable answer does not spend the seed either", /could not be read/.test(note3), note3);

  let googleAsked = "";
  const realSuggest = suggest.wire.google;
  suggest.wire.google = async (q: string) => {
    googleAsked = q;
    return { status: 200, contentType: "application/json", body: Buffer.from(JSON.stringify([q, ["a b", "c d"], [], [], {}])) };
  };
  const got = await defaultSuggest("seo zürich", "de");
  check("the daily research asks through the web layer's Google client and reads its answer", googleAsked === "seo zürich" && got.status === 200 && got.suggestions.join("|") === "a b|c d" && got.readable === true, { googleAsked, got });
  suggest.wire.google = realSuggest;

  store.setClusterPage("webdesign:de", null, "Specimen Owner");
  store.remap();
  const cl = db.prepare("SELECT page, mapped_by FROM cc_seo_clusters WHERE key = 'webdesign:de'").get() as { page: string | null; mapped_by: string | null };
  check("a person's 'no page' for a topic keeps their name, and the engine's remap leaves it", cl.page === null && cl.mapped_by === "Specimen Owner", cl);
  store.releaseClusterPage("webdesign:de");
  check("'let the desk decide' gives the topic back to the desk", (db.prepare("SELECT mapped_by FROM cc_seo_clusters WHERE key = 'webdesign:de'").get() as { mapped_by: string | null }).mapped_by === null);

  const w = idOf("web design agentur");
  store.editKeyword(w, { cluster: "ai-chatbot:de" }, "Specimen Owner");
  store.upsertKeyword({ phrase: "web design agentur", cluster: "webdesign:de", source: "audit", status: "relevant", by: "audit" });
  check("a hand refiling survives the audit's next import", rowOf("web design agentur")?.cluster === "ai-chatbot:de" && rowOf("web design agentur")?.edited_by === "Specimen Owner", rowOf("web design agentur"));
  check("a phrase the audit brought cannot be removed (it would come back)", store.removeKeyword(w) === "not-mine");

  /* ---- 2. the list ------------------------------------------------------------------------- */
  section("2. the list");
  for (const q of ["zuerich", "z%C3%BCrich", "zurich"]) check(`search folds umlauts: ?q=${decodeURIComponent(q)} finds "webdesign zürich preise"`, (await get(`q=${q}&status=all`)).list.state === "ok" && total(await get(`q=${q}&status=all`)) === 1);
  check('"webdesign" finds "web design agentur" (spaces left out)', total(await get("q=webdesign&status=all")) === 2);
  check("quotation marks are not taken literally", total(await get(`q=${encodeURIComponent('"content marketing"')}&status=all`)) === 1);
  const all = total(await get("status=all"));
  check("a one-letter word is ignored, not matched inside every phrase", total(await get("q=a&status=all")) === all && all > 3, { all });
  const moved = await get("moved=new");
  check("new and lost need the window before compared: without Search Console's history the list says so", moved.list.state !== "ok" && /window before/.test(moved.list.reason), moved.list);
  const ex0 = await (await app.request(`${API}/export.csv?id=abc`)).text();
  const ex1 = await (await app.request(`${API}/export.csv?status=all&id=${idOf("webdesign zürich preise")}`)).text();
  check("export: ids that match nothing export nothing, never the whole list", ex0.trim().split("\r\n").length === 1, ex0.slice(0, 200));
  check("export: an id exports its one row, with the new demand columns", ex1.trim().split("\r\n").length === 2 && ex1.includes("Monthly searches") && ex1.includes("webdesign zürich preise"));
  const cs = await app.request(`${API}/clusters.csv?lang=de`);
  const ct = await cs.text();
  check("the topics as CSV, as filtered", cs.status === 200 && /text\/csv/.test(cs.headers.get("content-type") ?? "") && ct.trim().split("\r\n").length === 3, ct.slice(0, 300));

  /* ---- 3. research on the web ---------------------------------------------------------------- */
  section("3. research on the web");
  const calls = { google: 0, bing: 0 };
  const ans = (body: unknown) => ({ status: 200, contentType: "application/json; charset=utf-8", body: Buffer.from(JSON.stringify(body)) });
  suggest.wire.google = async (q: string) => {
    calls.google++;
    const t = q.trim();
    const rows = [`${t} preise`, `how much does ${t} cost`, `was kostet ${t}`];
    return ans([q, rows, rows.map(() => ""), [], { "google:suggestrelevance": [1250, 900, 800], "google:suggesttype": ["QUERY", "QUERY", "QUERY"] }]);
  };
  suggest.wire.bing = async (q: string) => {
    calls.bing++;
    return ans([q, [q, `${q.trim()} agentur`]]);
  };
  const before = await get("research=webdesign%20bern&rlang=de&rmodes=plain,questions");
  check("a GET for a phrase not researched asks nothing and says what researching would send", calls.google + calls.bing === 0 && before.lookup.result?.state === "off" && (before.lookup.cost?.send ?? 0) > 0 && /sends \d+ requests/.test(before.lookup.result.state === "off" ? before.lookup.result.reason : ""), before.lookup);
  const r1 = await post<{ href: string }>("/research", { seed: "Webdesign Bern", lang: "de", modes: ["plain", "questions"] });
  check("researching asks Google's and Bing's stand-ins and answers its line and address", r1.status === 200 && calls.google > 0 && calls.bing > 0 && /suggestions for "webdesign bern"/.test(r1.json.line ?? "") && r1.json.href.includes("research=webdesign%20bern"), r1.json);
  const sent = calls.google + calls.bing;
  const drawn = await get("research=webdesign%20bern&rlang=de&rmodes=plain,questions");
  const res = drawn.lookup.result?.state === "ok" ? drawn.lookup.result.value : null;
  check("the address draws the answer again without asking the web", calls.google + calls.bing === sent && !!res && res.suggestions.length > 3, { calls, state: drawn.lookup.result?.state });
  const pre = res?.suggestions.find((s) => s.phrase === "webdesign bern preise");
  check("each suggestion keeps its engines, Google's strength and its way", !!pre && pre.sources.includes("google") && pre.strength === 1250 && pre.modes[0] === "plain", pre);
  check("a question is marked as one", !!res?.suggestions.find((s) => s.phrase.startsWith("was kostet") && s.question));
  const tr = await post<{ added: number }>("/research/track", { seed: "webdesign bern", lang: "de", phrases: [{ phrase: "webdesign bern preise", cluster: "webdesign:de" }, { phrase: "how much does webdesign bern cost", cluster: "webdesign:de" }] });
  const p1 = rowOf("webdesign bern preise");
  const p2 = rowOf("how much does webdesign bern cost");
  check("ticked phrases are tracked, judged relevant by the person, from research and a person", tr.status === 200 && tr.json.added === 2 && p1?.status === "relevant" && p1?.status_by === "Specimen Owner" && p1?.sources === "autocomplete,manual" && p1?.seed === "webdesign bern", { tr: tr.json, p1 });
  check("each is filed by its own language: the English one has no German topic", p1?.cluster === "webdesign:de" && p2?.lang === "en" && p2?.cluster === null, p2);
  const again = await get("research=webdesign%20bern&rlang=de&rmodes=plain,questions");
  const marked = again.lookup.result?.state === "ok" ? again.lookup.result.value.suggestions.find((s) => s.phrase === "webdesign bern preise") : null;
  check("the research then shows them as tracked", marked?.tracked?.status === "relevant", marked);
  check("a research refusal is the web layer's sentence (400)", (await post("/research", { seed: "x" })).json.error === "Type the phrase to research: 2 to 80 characters.");

  /* ---- 4. who ranks -------------------------------------------------------------------------- */
  section("4. who ranks");
  serp.wire.ddg = async () => ({ status: 200, body: readFileSync(path.join(FIX, "ddg-lite-webdesign-zuerich.html"), "utf8") });
  const s1 = await post<{ google: { state: string; source: string } | null; duckduckgo: { state: string; label: string; page: { organic: unknown[] } | null } | null }>("/serp", { phrase: "webdesign zürich preise" });
  check("Google's check is queued for the studio workstation", s1.status === 200 && s1.json.google?.state === "queued" && s1.json.google.source === "workstation", s1.json);
  check("DuckDuckGo's page is read as a second opinion and labelled not Google", s1.json.duckduckgo?.state === "done" && /not Google/.test(s1.json.duckduckgo.label) && (s1.json.duckduckgo.page?.organic.length ?? 0) === 10, s1.json.duckduckgo);
  const sv = await get(`serp=${encodeURIComponent("webdesign zürich preise")}&slang=de`);
  check("?serp= draws the pending Google check, DuckDuckGo's page and the lane", !!sv.serp && sv.serp.pending?.engine === "google" && sv.serp.duckduckgo?.state === "done" && sv.serp.tracked === idOf("webdesign zürich preise") && /workstation/i.test(sv.serp.lane.line), sv.serp);
  check("who ranks refuses no phrase with the web layer's sentence", (await post("/serp", { phrase: "x" })).json.error === "Type the phrase to check: 2 to 120 characters.");

  /* ---- 5. a keyword's own view, briefs, editing ------------------------------------------------- */
  section("5. a keyword's own view, briefs, editing");
  const id = idOf("webdesign zürich preise");
  const open = await get(`open=${id}`);
  const v = open.open?.state === "ok" ? open.open.value : null;
  check("?open= draws the keyword's own view with its result pages and topic", !!v && v.row.id === id && v.serp.duckduckgo?.state === "done" && v.topic?.key === "webdesign:de", open.open);
  check("…and Search Console's absence is said, not zero", !!v && v.series.state !== "ok");
  check("an unknown keyword's view says so", (await get("open=999999")).open?.state === "off");
  const b1 = await post<{ task: { id: number; title: string } }>(`/${id}/brief`, {});
  const prompt = (db.prepare("SELECT prompt FROM cc_ai_tasks WHERE id = ?").get(b1.json.task.id) as { prompt: string }).prompt;
  check("a brief is queued with the essentials first, within the operator's 300 characters", b1.status === 200 && prompt.length <= 300 && prompt.startsWith("The search “webdesign zürich preise”"), { prompt, len: prompt.length });
  const b2 = await post(`/${id}/brief`, {});
  check("a second brief is refused while the first is on its way (409)", b2.status === 409 && /already on its way/.test(b2.json.error ?? ""), b2.json);
  const rowNow = (await get(`q=${encodeURIComponent("webdesign zürich preise")}&status=all`)).list;
  check("the row shows its brief after a reload", rowNow.state === "ok" && rowNow.value.rows[0]?.brief?.task === b1.json.task.id, rowNow);
  const cb = await post<{ task: { id: number } }>("/clusters/webdesign:de/brief", {});
  const cprompt = (db.prepare("SELECT prompt FROM cc_ai_tasks WHERE id = ?").get(cb.json.task.id) as { prompt: string }).prompt;
  check("a topic's brief fits the 300 characters too", cb.status === 200 && cprompt.length <= 300 && cprompt.includes("Webdesign (DE)"), cprompt);
  check("a topic's page by a person, then given back to the desk", (await post("/clusters/webdesign:de/page", { path: null })).status === 200 && (await post("/clusters/webdesign:de/page", { path: "auto" })).json.line?.includes("the desk decides") === true);
  const ed = await post(`/${id}/edit`, { lang: "fr", intent: "local" });
  check("editing a keyword says what changed", ed.status === 200 && /language, intent changed/.test(ed.json.line ?? "") && rowOf("webdesign zürich preise")?.lang === "fr", ed.json);
  check("a wrong language is refused", (await post(`/${id}/edit`, { lang: "xx" })).status === 400);
  const many = await post<{ results: { ok: boolean }[] }>("/many", { phrases: "seo agentur bern\nseo agentur basel\n\nx", lang: "de" });
  check("many phrases at once: the short line is left out", many.status === 200 && many.json.results.length === 2 && rowOf("seo agentur bern")?.sources === "manual", many.json);
  const tp = await post<{ topic: { key: string } }>("/topics", { name: "SEO Agentur", lang: "de" });
  check("a person creates a topic", tp.status === 200 && tp.json.topic.key === "seo-agentur:de");
  check("the same topic twice is refused (409)", (await post("/topics", { name: "SEO Agentur", lang: "de" })).status === 409);
  check("a topic is renamed, its key kept", (await post("/topics/seo-agentur:de", { name: "SEO agencies" })).status === 200 && (db.prepare("SELECT name FROM cc_seo_clusters WHERE key = 'seo-agentur:de'").get() as { name: string }).name === "SEO agencies");
  const rm = await post(`/${idOf("seo agentur basel")}/remove`, {});
  check("a phrase only a person added can be removed", rm.status === 200 && !rowOf("seo agentur basel"));
  check("one the research also brought cannot (409)", (await post(`/${idOf("webdesign bern preise")}/remove`, {})).status === 409);

  /* ---- 6. the local AI ---------------------------------------------------------------------------- */
  section("6. the local AI");
  const ai1 = await post<{ task: { id: number } }>("/ai-sort", { ids: [idOf("seo agentur bern"), idOf("webdesign bern preise")] });
  const k1 = ai1.status === 200 ? (db.prepare("SELECT kind FROM cc_ai_tasks WHERE id = ?").get(ai1.json.task.id) as { kind: string }).kind : null;
  check("tracked phrases go to the workstation's model as an operator task (keywords, or a question)", ai1.status === 200 && (k1 === "keywords" || k1 === "ask"), { ai1: ai1.json, k1 });
  const ai2 = await post<{ task: { id: number } }>("/ai-sort", { seed: "webdesign bern", lang: "de", phrases: ["webdesign bern preise", "how much does webdesign bern cost", "was kostet webdesign bern"] });
  const t2 = ai2.status === 200 ? (db.prepare("SELECT kind, prompt, options FROM cc_ai_tasks WHERE id = ?").get(ai2.json.task.id) as { kind: string; prompt: string; options: string }) : null;
  const new2 = rowOf("was kostet webdesign bern") as { status?: string } | undefined;
  check("a research's phrases join the table unjudged and go to the model's 'keywords' kind by id", t2?.kind === "keywords" && new2?.status === "unjudged" && (JSON.parse(t2.options || "{}") as { ids?: number[] }).ids?.length === 3, { ai2: ai2.json, t2, new2 });
  check("nothing ticked is refused", (await post("/ai-sort", { phrases: [] })).status === 400);

  /* ---- 7. demand figures --------------------------------------------------------------------------- */
  section("7. demand");
  const csvText = ["Keyword,Currency,Avg. monthly searches,Competition", "seo agentur bern,CHF,1000,High"].join("\r\n");
  check("a member may not import a Keyword Planner export (403)", (await post("/planner", { csv: csvText }, "member")).status === 403);
  const pl = await post<{ matched: number }>("/planner", { csv: csvText });
  check("the owner's import matches the table's phrase", pl.status === 200 && pl.json.matched === 1, pl.json);
  const vv = await get(`q=${encodeURIComponent("seo agentur bern")}&status=all`);
  const vr = vv.list.state === "ok" ? vv.list.value.rows[0] : null;
  check("the row carries its monthly searches with source and day", vr?.volume?.volume === 1000 && vr.volume.source === "planner" && vv.volumes.withVolume === 1, { vr: vr?.volume, volumes: vv.volumes });
  const dv = await post("/volumes", { ids: [idOf("seo agentur bern")] });
  check("Refresh volumes says DataForSEO is not connected, with the owner's step (409)", dv.status === 409 && /not connected/.test(dv.json.error ?? ""), dv.json);
  const run = await post("/research/run", {});
  check("Run research now answers in a sentence either way", (run.status === 200 && /runs within a minute/.test(run.json.line ?? "")) || (run.status === 409 && /cannot run now/.test(run.json.error ?? "")), run.json);

  section("nothing left the machine");
  check("no request reached the network", refused.length === 0, refused);
} catch (e) {
  failed++;
  console.log(`FAIL the check stopped: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
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
