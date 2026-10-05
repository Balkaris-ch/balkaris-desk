/**
 * SEO › Competitors, proved without the network.
 *
 *   npm run check:seo-competitors
 *
 * A throwaway database and `fetch` refused: every outside answer comes from a
 * stand-in wire (the web layer's guarded site reader, its public-API reader,
 * DuckDuckGo's reader, the competitor page reader). Every domain, name and
 * phrase here is a SPECIMEN, made up and named so; none of it describes the
 * real website or a real competitor.
 *
 * What is proved:
 *   1. the search finds what is typed: a pasted address, www., a path, case,
 *      umlauts folded alike, a captured search, a cluster's name; the internal
 *      "name:" key is never matched; nothing found offers the lookup or the check;
 *   2. the filters ask one observation together (an AI answer IN the cluster),
 *      the counts follow, the asked cluster stays among the options, an offset
 *      past the end shows the last page, ?open= normalises and never opens
 *      another row;
 *   3. looking up any site: a private or typed-port address is refused, the
 *      card sets each fact beside Balkaris's with who said it, what could not be
 *      had is said in words, DataForSEO is off with the owner's step;
 *   4. a person's word: watch (on the list without a sighting, its home page
 *      read at once through the guard), ignore (hidden, observations kept),
 *      platform or studio over the list, merge two rows;
 *   5. who ranks: a check is queued for the workstation (and taken back),
 *      DuckDuckGo's second opinion becomes observations labelled as such, the
 *      result rows link to the list or a lookup, change between two captures;
 *   6. a Google result recorded by hand (owner only), Balkaris's place, the
 *      captured search filed by hand and the cluster written into the record;
 *   7. the weekly read: a failed page is due again after a day, a platform's
 *      never, the card counts only pages that were read, its topic pages from
 *      a sitemap; the export.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-comp-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "SITE_READ_REPO", "SITE_REPO", "DESK_DEV_USER", "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "SEO_DOMAIN_DAILY", "SEO_GOOGLE_DAILY"]) delete process.env[k];
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "absent.json");
process.env.SITE_READ_CLONE = "off";

/* ---- nothing leaves this machine ------------------------------------------ */
globalThis.fetch = (async (input: RequestInfo | URL) => {
  throw new Error(`the check tried to leave the machine: ${String(input instanceof Request ? input.url : input).split("?")[0]}`);
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
const { Hono } = await import("hono");
import type { Person } from "../src/people.ts";
import type { Vars } from "../src/cc/access.ts";
import type { SeoCompetitorsPayload } from "../web/src/contract/seo/competitors.ts";
const { db } = await import("../src/db.ts");
await import("../src/cc/seo/tables.ts");
const keywords = await import("../src/cc/seo/keywords.ts");
const competitors = await import("../src/cc/seo/competitors.ts");
const compWeb = await import("../src/cc/seo/competitors-web.ts");
const guard = await import("../src/cc/seo/web/guard.ts");
const domain = await import("../src/cc/seo/web/domain.ts");
const serp = await import("../src/cc/seo/web/serp.ts");
const route = await import("../src/cc/routes/seo/competitors.ts");
const { apiError } = await import("../src/cc/api.ts");

const OWNER = { telegram: 1, name: "Specimen Owner", email: "owner@specimen.invalid", owner: true, canPublish: true, seesLeads: true } as unknown as Person;
const MEMBER = { telegram: 2, name: "Specimen Member", email: "member@specimen.invalid", owner: false, canPublish: false, seesLeads: false } as unknown as Person;
const API = "/api/v1/seo/competitors";
const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  c.set("who", c.req.header("x-specimen-who") === "member" ? MEMBER : OWNER);
  await next();
});
app.route(API, route.routes);
app.onError(apiError);

async function get(q = ""): Promise<SeoCompetitorsPayload> {
  const res = await app.request(`${API}${q ? `?${q}` : ""}`);
  if (res.status !== 200) throw new Error(`GET ${q} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as SeoCompetitorsPayload;
}
async function post<T = { ok: boolean; line: string; href?: string; error?: string }>(p: string, body: unknown, who: "owner" | "member" = "owner"): Promise<{ status: number; json: T & { error?: string; line?: string } }> {
  const res = await app.request(`${API}${p}`, { method: "POST", headers: { "content-type": "application/json", "x-specimen-who": who }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as T & { error?: string; line?: string } };
}
const listOf = (d: SeoCompetitorsPayload) => (d.list.state === "ok" ? d.list.value : null);
const total = async (q: string) => listOf(await get(q))?.total ?? -1;

/* ---- the specimen world ------------------------------------------------------ */
const DAY1 = "2026-09-20";
const DAY2 = "2026-10-02";
keywords.upsertCluster({ key: "web:de", name: "Specimen web design (DE)", lang: "de", intent: "commercial", priority: "high", rank: 1, page: null, pageSaid: "gap", why: "Specimen.", action: null, examples: ["webdesign zürich", "webagentur zürich"], source: "audit" });
keywords.upsertCluster({ key: "video:de", name: "Specimen video production (DE)", lang: "de", intent: "commercial", priority: "medium", rank: 2, page: null, pageSaid: "gap", why: "Specimen.", action: null, examples: ["videoproduktion zürich"], source: "audit" });
const see = (domainKey: string, name: string | null, engine: string, kind: "organic" | "local-pack" | "named" | "cited", query: string, position: number | null, cluster: string | null, day = DAY2, by = "audit") =>
  competitors.addSighting({ domain: domainKey, name, engine, kind, query, lang: "de", cluster, position, day, by });
see("studio-alpha.ch", "Studio Alpha", "google", "organic", "webagentur zürich", 1, "web:de");
see("studio-beta.ch", "Studio Beta", "google", "organic", "webagentur zürich", 2, "web:de");
see("studio-beta.ch", null, "chatgpt", "named", "beste videoagentur schweiz", null, "video:de");
see("name:Studio Gamma GmbH", "Studio Gamma GmbH", "google-local", "local-pack", "webagentur zürich", 1, "web:de");
see("specimen-directory.ch", null, "google", "organic", "webagentur zürich", 3, "web:de");
see("studio-delta.ch", "Agentur Zürich Delta", "google", "organic", "videoproduktion zürich", 1, "video:de");
see("studio-alpha.ch", null, "google", "organic", "webagentur zürich", 2, "web:de", DAY1);
see("studio-old.ch", null, "google", "organic", "webagentur zürich", 1, "web:de", DAY1);
for (let i = 0; i < 17; i++) see(`specimen-filler-${i}.ch`, null, "google", "organic", "specimen filler search", i + 1, null);
competitors.addCompetitorPage({ url: "https://studio-alpha.ch/", domain: "studio-alpha.ch", address: "home", cluster: null, query: null });
competitors.addCompetitorPage({ url: "https://studio-beta.ch/web", domain: "studio-beta.ch", address: "ranking", cluster: "web:de", query: "webagentur zürich" });
competitors.addCompetitorPage({ url: "https://studio-beta.ch/", domain: "studio-beta.ch", address: "home", cluster: null, query: null });
competitors.addCompetitorPage({ url: "https://www.reddit.com/r/specimen", domain: "reddit.com", address: "home", cluster: null, query: null });
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const put = db.prepare("UPDATE cc_seo_comp_pages SET status = ?, title = ?, words = ?, lang = ?, fetched_at = ?, error = ? WHERE url = ?");
put.run(200, "Studio Alpha – Webdesign", 900, "de-ch", ago(2), null, "https://studio-alpha.ch/");
put.run(404, null, null, null, ago(2), "answered 404", "https://studio-beta.ch/web");
put.run(200, "Studio Beta", 400, "de", ago(2), null, "https://studio-beta.ch/");
put.run(200, "Specimen thread", 50, "en", ago(30), null, "https://www.reddit.com/r/specimen");

try {
  section("1. the search finds what is typed");
  check("a domain finds its row", (await total("q=studio-alpha.ch")) === 1);
  check("a pasted address finds it (scheme, www., path, case)", (await total("q=HTTPS://WWW.Studio-Alpha.ch/de/web?x=1")) === 1);
  check("umlauts fold alike: zürich, zuerich and zurich find the same rows", (await total("q=z%C3%BCrich")) === (await total("q=zuerich")) && (await total("q=zuerich")) === (await total("q=zurich")) && (await total("q=zurich")) > 0);
  check("a captured search finds the sites seen for it", (await total("q=videoproduktion")) === 1);
  check("a cluster's name finds its sites", (await total("q=specimen%20video%20production")) >= 1);
  check("the internal name: key is never matched", (await total("q=name")) === 0);
  const none = listOf(await get("q=agence-specimen.ch"))!;
  check("an address that matches nothing offers exactly that to look up", none.total === 0 && none.lookFor === "agence-specimen.ch" && !none.checkFor, none);
  const phrase = listOf(await get("q=specimen%20preise%20bern"))!;
  check("a phrase that matches nothing offers the check of who ranks for it", phrase.total === 0 && phrase.checkFor === "specimen preise bern" && !phrase.lookFor, phrase);

  section("2. filters, counts, paging, the row opened");
  check("AI answers in a cluster are an AI answer FOR that cluster", (await total("engine=ai&cluster=web:de")) === 0 && (await total("engine=ai&cluster=video:de")) === 1);
  const chips = listOf(await get("cluster=web:de"))!;
  check("the engine chips count with the same one-observation test", chips.engines.find((e) => e.key === "ai")?.count === 0, chips.engines);
  const kept = listOf(await get("type=platforms&cluster=video:de"))!;
  check("the asked cluster stays among the options, with 0", kept.clusters.some((c) => c.key === "video:de" && c.count === 0), kept.clusters);
  const past = await get("offset=900&limit=5");
  check("an offset past the end shows the last page", listOf(past)!.offset === 20 && listOf(past)!.rows.length > 0 && past.asked.offset === 20, { offset: listOf(past)!.offset, total: listOf(past)!.total });
  check("?search= narrows the list to one captured search", (await total(`search=${encodeURIComponent("videoproduktion zürich")}`)) === 1);
  const opened = await get("open=WWW.Studio-Beta.CH");
  check("?open= is normalised (www., case)", opened.selected?.state === "ok" && opened.selected.value.competitor.domain === "studio-beta.ch");
  const missing = await get("open=nosuch-specimen.ch");
  check("?open= naming nothing says so, and opens no other row", missing.selected?.state === "off" && /nosuch-specimen\.ch/.test(missing.selected.reason), missing.selected);
  const beta = opened.selected?.state === "ok" ? opened.selected.value : null;
  check("the detail counts pages read apart from pages that failed", (beta?.pages.filter((p) => !p.error).length ?? 0) === 1 && (beta?.pages.length ?? 0) === 2);
  const cl = (await get()).clusters;
  const rival = cl.state === "ok" ? cl.value.find((c) => c.cluster.key === "web:de")?.organic.find((o) => o.domain === "studio-beta.ch") : null;
  check("a cluster shows the page that was READ (home) over a ranking address that answered 404", rival?.page?.url === "https://studio-beta.ch/" && !rival.page.error, rival);

  section("3. looking up any site");
  const dnsTable: Record<string, string[]> = { "agence-specimen.ch": ["45.11.22.40"], "www.agence-specimen.ch": ["45.11.22.40"], "balkaris.ch": ["45.11.22.41"], "www.balkaris.ch": ["45.11.22.41"], "inner-specimen.ch": ["10.0.0.9"] };
  guard.dnsWire.lookup = async (host: string) => {
    const list = dnsTable[host];
    if (!list) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return list.map((address) => ({ address, family: 4 }));
  };
  const page = (status: number, body: string, type = "text/html; charset=utf-8", url = ""): import("../src/cc/seo/web/guard.ts").Got => ({ status, url, headers: { "content-type": type }, body: Buffer.from(body), error: null, cut: false });
  const siteCalls: string[] = [];
  guard.siteWire.get = async (address: string) => {
    siteCalls.push(address);
    const u = new URL(address);
    if (u.pathname === "/robots.txt") return page(200, `User-agent: *\nDisallow: /intern/\nSitemap: https://${u.hostname}/sitemap.xml\n`, "text/plain", address);
    if (u.pathname === "/sitemap.xml")
      return page(200, `<urlset><url><loc>https://${u.hostname}/de/</loc><lastmod>2026-09-30</lastmod></url><url><loc>https://${u.hostname}/de/webdesign-zuerich</loc></url><url><loc>https://${u.hostname}/de/videoproduktion</loc></url><url><loc>https://${u.hostname}/de/team</loc></url></urlset>`, "application/xml", address);
    if (u.pathname === "/" || u.pathname === "/de/" || u.pathname.startsWith("/de/"))
      return page(200, `<!doctype html><html lang="de-CH"><head><title>Agence Specimen – Webdesign Zürich</title><meta name="generator" content="WordPress 6.6"><script type="application/ld+json">{"@type":"Organization","name":"Agence Specimen"}</script></head><body><main><h1>Webdesign Zürich</h1><p>Ab CHF 3'900.</p></main></body></html>`, "text/html", address);
    return page(404, "no", "text/html", address);
  };
  domain.apiWire.get = async (url: string) => {
    if (url.startsWith("https://rdap.nic.ch/domain/")) return { status: 200, text: JSON.stringify({ status: ["active"], events: [{ eventAction: "registration", eventDate: "2012-03-01T00:00:00Z" }] }) };
    if (url.startsWith("https://tranco-list.eu/")) return { status: 200, text: JSON.stringify({ ranks: [] }) };
    if (url.startsWith("https://web.archive.org/")) return { status: 200, text: JSON.stringify([["timestamp", "original", "statuscode"], ["20130101000000", "http://agence-specimen.ch/", "200"]]) };
    return { status: 404, text: "" };
  };
  const refused = await post("/lookup", { input: "http://127.0.0.1:3000/" });
  check("a private or local address is refused before any request", refused.status === 400 && /does not read that/.test(refused.json.error ?? "") && siteCalls.length === 0, refused.json);
  const inner = await post("/lookup", { input: "inner-specimen.ch" });
  check("a name that resolves into a private range is refused", inner.status === 400, inner.json);
  const looked = await post<{ ok: boolean; domain: string; href: string; line: string }>("/lookup", { input: "https://www.Agence-Specimen.ch/de/kontakt" });
  check("a pasted address is looked up as its domain, and the answer says where the card is", looked.status === 200 && looked.json.domain === "agence-specimen.ch" && looked.json.href === "/seo/competitors?look=agence-specimen.ch", looked.json);
  await new Promise((r) => setTimeout(r, 50));
  const card = (await get("look=agence-specimen.ch")).lookup;
  const v = card?.state === "ok" ? card.value : null;
  const row = (k: string) => v?.rows.find((r) => r.key === k);
  check("the card sets the registration beside Balkaris's, with who said it", row("registered")?.them.state === "ok" && /2012/.test(row("registered")!.them.text) && !!row("registered")!.them.from, row("registered"));
  check("pages in its sitemap, and what it is built with", /4 pages/.test(row("sitemap")?.them.text ?? "") && /WordPress/.test(row("built")?.them.text ?? ""), [row("sitemap"), row("built")]);
  check("what could not be had is said, never a zero (no Google key: field data off with the step)", row("crux")?.them.state === "off" && !!row("crux")?.them.step && !/^0/.test(row("crux")!.them.text), row("crux"));
  check("Balkaris's own side is there (its own lookup ran beside it)", !!row("registered")?.us, row("registered"));
  check("DataForSEO is off with the owner's step, nothing bought", v?.paid.configured === false && v.paid.overview.state === "off" && !!v.paid.step);
  check("the card carries a local-AI brief under the operator's 1,000 characters", v?.brief.task.kind === "brief" && (v.brief.task.prompt ?? "").length <= 1000 && /agence-specimen\.ch/.test(v.brief.task.prompt ?? ""));
  check("not on the list yet", v?.known === null);

  section("4. a person's word on who is a competitor");
  competitors.wire.sleep = async () => {};
  const read: string[] = [];
  competitors.wire.fetchPage = async (url: string) => {
    read.push(url);
    if (url.endsWith("/robots.txt")) return { status: 200, url, html: "User-agent: *\nDisallow: /intern/\n", contentType: "text/plain", error: null };
    return { status: 200, url, html: `<html lang="de"><head><title>Agence Specimen – Videoproduktion</title></head><body><main><h1>Video</h1><p>Wir drehen Filme in Zürich.</p></main></body></html>`, contentType: "text/html", error: null };
  };
  const watched = await post("/watch", { input: "agence-specimen.ch" });
  check("watching puts the site on the list as a person's choice", watched.status === 200 && /watched as a competitor/.test(watched.json.line ?? ""), watched.json);
  await new Promise((r) => setTimeout(r, 50));
  const w = await get("open=agence-specimen.ch");
  check("it is on the list without a sighting, the decision names who", w.selected?.state === "ok" && w.selected.value.competitor.sightings === 0 && w.selected.value.competitor.decision?.by === "Specimen Owner" && w.selected.value.competitor.decision.watch);
  check("its home page was read at once, through the reader", read.some((u) => u.startsWith("https://www.agence-specimen.ch/") || u.startsWith("https://agence-specimen.ch/")) && read[0]!.endsWith("/robots.txt"), read);
  check("Balkaris is never watched as a competitor", (await post("/watch", { input: "balkaris.ch" })).status === 400);
  const ign = await post("/decide", { domain: "studio-delta.ch", ignore: true });
  check("ignore hides a row from the list and its counts", ign.status === 200 && (await total("q=delta")) === 0 && listOf(await get())!.shown?.find((s) => s.key === "ignored")?.count === 1);
  check("…and ?shown=ignored lists it; its observations are kept", (await total("shown=ignored")) === 1 && competitors.sightings({ domain: "studio-delta.ch" }).length === 1);
  await post("/decide", { domain: "studio-delta.ch", ignore: false });
  await post("/decide", { domain: "specimen-directory.ch", kind: "platform" });
  check("a person can count a site as a platform over the list", (await total("type=platforms")) === 1);
  await post("/decide", { domain: "specimen-directory.ch", kind: "auto" });
  const merged = await post("/decide", { domain: "name:Studio Gamma GmbH", mergeInto: "studio-alpha.ch" });
  const alpha = await get("open=studio-alpha.ch");
  check("two rows merged by hand are one company", merged.status === 200 && alpha.selected?.state === "ok" && alpha.selected.value.competitor.mapPack === 1 && (await total("q=gamma")) === 1, merged.json);
  check("merging into itself, or into nothing known, is refused in words", (await post("/decide", { domain: "studio-alpha.ch", mergeInto: "studio-alpha.ch" })).status === 400 && (await post("/decide", { domain: "studio-beta.ch", mergeInto: "nothing-specimen.ch" })).status === 404);
  check("a decision with nothing in it is refused", (await post("/decide", { domain: "studio-beta.ch" })).status === 400);

  section("5. who ranks for a phrase");
  serp.wire.ddg = async () => ({
    status: 200,
    body: `<html><body><table><tr><td>1.&nbsp;</td><td><a rel="nofollow" href="https://studio-alpha.ch/" class='result-link'>Studio Alpha</a></td></tr><tr><td></td><td class='result-snippet'>Webdesign</td></tr><tr><td><span class='link-text'>studio-alpha.ch</span></td></tr><tr><td>2.&nbsp;</td><td><a rel="nofollow" href="https://newcomer-specimen.ch/" class='result-link'>Newcomer</a></td></tr><tr><td></td><td class='result-snippet'>Neu</td></tr><tr><td><span class='link-text'>newcomer-specimen.ch</span></td></tr></table></body></html>`,
  });
  const asked = await post<{ ok: boolean; line: string; href: string; google: number | null; duckduckgo: number | null }>("/serp", { phrase: "Webagentur Zürich", lang: "de" });
  check("a check is queued for the workstation, honestly", asked.status === 200 && asked.json.google !== null && /workstation/i.test(asked.json.line), asked.json);
  const sp = (await get(`serp=${encodeURIComponent("webagentur zürich")}&serpLang=de`)).serp;
  const panel = sp?.state === "ok" ? sp.value : null;
  check("the panel shows the Google check's state and the lane", panel?.google?.check.state === "queued" && !!panel.lane.line, panel?.google?.check);
  const ddg = panel?.duckduckgo;
  check("DuckDuckGo's second opinion is labelled as not Google", !!ddg && /not Google/i.test(ddg.check.label), ddg?.check);
  if (ddg?.rows.length) {
    check("its results carry their list key, and every one is on the list now", ddg.rows.every((r) => r.known) && ddg.rows.some((r) => r.key === "newcomer-specimen.ch"), ddg.rows);
    check("a DuckDuckGo place is never counted as a Google position", (await get("open=newcomer-specimen.ch")).selected?.state === "ok" && (await get("open=newcomer-specimen.ch")).selected!.state === "ok" && ((await get("open=newcomer-specimen.ch")).selected as { value: { competitor: { bestPosition: number | null } } }).value.competitor.bestPosition === null && (await total("engine=google&q=newcomer")) === 0);
    check("every result of a finished check is kept as an observation", competitors.sightings({ domain: "newcomer-specimen.ch" }).some((s) => s.engine === "duckduckgo"));
  } else check("DuckDuckGo's page was read", false, ddg);
  const back = await post(`/serp/${asked.json.google}/withdraw`, {});
  check("a queued check can be taken back", back.status === 200, back.json);
  check("…once: a second time is refused in words", (await post(`/serp/${asked.json.google}/withdraw`, {})).status === 409);
  check("a phrase that is no phrase is refused", (await post("/serp", { phrase: "x" })).status === 400);

  section("6. a Google result recorded by hand, a search filed by hand");
  const member = await post("/record", { phrase: "specimen webdesign bern", day: DAY2, results: "studio-alpha.ch" }, "member");
  check("only the owner records a result by hand", member.status === 403, member.json);
  check("a day in the future is refused", (await post("/record", { phrase: "specimen webdesign bern", day: "2099-01-01", results: "studio-alpha.ch" })).status === 400);
  const rec = await post("/record", { phrase: "Specimen Webdesign Bern", lang: "de", day: DAY2, results: "1 https://studio-alpha.ch/bern\n2. studio-beta.ch\n3 https://www.balkaris.ch/de", mapPack: "Studio Gamma GmbH" });
  check("the record keeps the results and Balkaris's place", rec.status === 200 && /Kept 3 results/.test(rec.json.line ?? "") && /Balkaris at 3/.test(rec.json.line ?? ""), rec.json);
  const again = await post("/record", { phrase: "specimen webdesign bern", lang: "de", day: DAY2, results: "studio-beta.ch\nstudio-alpha.ch" });
  check("recording the same search and day again corrects it (not ignored as a duplicate)", again.status === 200 && competitors.sightings({ domain: "studio-beta.ch" }).find((s) => s.query === "specimen webdesign bern")?.position === 1);
  const se = (await get(`search=${encodeURIComponent("specimen webdesign bern")}`)).searches;
  const chosen = se?.state === "ok" ? se.value.chosen : null;
  check("the captured search shows its page and the result's address", chosen?.organic?.[0]?.key === "studio-beta.ch" && chosen.days[0] === DAY2 && chosen.by === "Specimen Owner", chosen);
  const old = se?.state === "ok" ? se.value.rows.find((r) => r.query === "specimen filler search") : null;
  check("a search under no cluster is counted as unfiled", !!old && old.cluster === null && (se?.state === "ok" ? se.value.unfiled : 0) >= 1, old);
  const filed = await post("/file", { query: "specimen filler search", cluster: "video:de" });
  check("filing by hand answers in a sentence", filed.status === 200 && /by hand/.test(filed.json.line ?? ""), filed.json);
  check("…writes the cluster into the record, so Content Gaps sees it too", competitors.sightings({ cluster: "video:de" }).some((s) => s.query === "specimen filler search"));
  const after = (await get(`search=${encodeURIComponent("specimen filler search")}`)).searches;
  check("…and the search says it was filed by hand", after?.state === "ok" && after.value.chosen?.filed === "hand");
  check("a cluster that is not ours is refused", (await post("/file", { query: "specimen filler search", cluster: "nope" })).status === 400);
  const moved = (await get(`search=${encodeURIComponent("webagentur zürich")}`)).searches;
  const ch = moved?.state === "ok" ? moved.value.chosen?.changes : null;
  check("change between two captures: who is new, gone and moved", !!ch && ch.since === DAY1 && ch.gone.includes("studio-old.ch") && ch.moved.some((m) => m.host === "studio-alpha.ch" && m.from === 2 && m.to === 1), ch);

  section("7. the weekly read, their pages for our topics, the export");
  db.prepare("UPDATE cc_seo_comp_pages SET fetched_at = ? WHERE url = 'https://studio-beta.ch/web'").run(ago(1.5));
  const due = competitors.duePages().map((p) => p.url);
  check("a page that failed is due again after a day; one read well two days ago is not", due.includes("https://studio-beta.ch/web") && !due.includes("https://studio-alpha.ch/"), due);
  check("a platform's page is never due", !due.includes("https://www.reddit.com/r/specimen"));
  const d = await get();
  check("the read's card counts read pages apart from failed ones, and what is due", d.refresh.fetched + (d.refresh.failed ?? 0) <= d.refresh.pages && d.refresh.fetched === db.prepare("SELECT COUNT(*) AS n FROM cc_seo_comp_pages WHERE status = 200 AND error IS NULL AND fetched_at IS NOT NULL").get()!.n && (d.refresh.failed ?? 0) >= 1 && (d.refresh.due ?? 0) >= 1, d.refresh);
  compWeb.topicWire.get = guard.siteWire.get;
  const topics = await compWeb.topicPages("agence-specimen.ch", "https://agence-specimen.ch/", ["https://agence-specimen.ch/sitemap.xml"]);
  check("the sitemap's pages that fit our clusters are added under the cluster", topics.added.some((a) => a.url.endsWith("/de/webdesign-zuerich") && a.cluster === "web:de") && topics.added.some((a) => a.url.endsWith("/de/videoproduktion") && a.cluster === "video:de") && !topics.added.some((a) => a.url.endsWith("/de/team")), topics);
  const res = await app.request(`${API}/export.csv?type=studios`);
  const csv = await res.text();
  check("the export is the filtered list as CSV", res.status === 200 && /text\/csv/.test(res.headers.get("content-type") ?? "") && /studio-alpha\.ch/.test(csv) && !/specimen-directory\.ch,yes/.test(csv));
} catch (e) {
  check("the check ran to the end", false, e instanceof Error ? e.stack : String(e));
} finally {
  db.close?.();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the file a moment longer */
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
