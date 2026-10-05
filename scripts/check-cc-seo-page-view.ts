/**
 * SEO › Page Optimization (src/cc/routes/seo/optimize.ts): one page of the
 * website and everything the desk can do to it, proved without Google, GA4,
 * the website or a model.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-seo-page-view.ts
 *   npm run check:seo-page-view
 *
 * Nothing leaves this machine: a throwaway database, a specimen website read
 * by the desk's real crawl through a stubbed `fetch` (also what the
 * operator's rules ask of the "live site"), and every other host refused.
 * Every page, phrase and figure here is a SPECIMEN, made up and named so.
 *
 * What is proved, each against the routes as the screen asks them:
 *   1. the address: a missing leading slash is meant as one; another site's
 *      address is refused in a sentence, not read as this site's page;
 *   2. the page's settings: search, sharing, index and structured data, each
 *      field as the live page says it; nothing approved or waiting yet; the
 *      local model's draft offered for each, an index question said to be
 *      advice; a block type the page prints already is not offered again;
 *   3. the quick actions are the operator's own kinds for what their labels
 *      say (a review, a title, a share card, a block, links, alt texts, a
 *      brief with the page), alt texts off where no picture lacks one;
 *   4. a person's share card goes through the operator's door and shows as
 *      waiting with its proposal; an exact repeat is refused; a title shows
 *      as the website would show it (the brand only where it fits);
 *   5. an asked draft waits for its task: the settings and the quick action
 *      both say so, by page, whatever the task's title;
 *   6. approving needs the right to publish, and the refusal is a sentence;
 *      rejecting clears the waiting value; an applied one shows as approved;
 *   7. the suggestions: share, schema, links and pictures go to the
 *      operator's kinds; a failing readiness check does not read as passing;
 *      the German version is briefed with the page; an unscored page has no
 *      area scores; "1 impressions" is never written;
 *   8. the phrases mapped to the page, with where the page carries each;
 *   9. nothing tried to leave this machine.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-seo-page-view-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
process.env.SITE_READ_CLONE = "off";
process.env.SITE_READ_REPO = path.join(dir, "no-such-copy.git");
for (const k of ["BING_API_KEY", "BING_SITE", "GOOGLE_API_KEY", "GA4_PROPERTY_ID", "SITE_REPO", "DESK_DEV_USER", "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "CC_PSI_PAGES", "GA4_CREDENTIALS_FILE", "GSC_SITE"]) delete process.env[k];

let passed = 0;
let failed = 0;
function check(name: string, good: boolean, detail?: unknown): void {
  if (good) passed++;
  else failed++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}${!good && detail !== undefined ? `\n     ${JSON.stringify(detail).slice(0, 700)}` : ""}`);
}
const section = (title: string) => console.log(`\n${title}`);

/* ---- the specimen website: the crawl's, and the "live site" the operator's rules ask ---- */

const SITE = "https://www.balkaris.ch";
const left: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const r = serve(url);
  if (!r) {
    left.push(url.split("?")[0]!);
    throw new TypeError(`fetch failed: the check does not let ${url.split("?")[0]} leave the machine`);
  }
  return r;
}) as typeof fetch;

const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i % 17}`).join(" ");
const FAQ = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Specimen question?", acceptedAnswer: { "@type": "Answer", text: "Specimen answer." } }] });
function page(o: { path: string; title: string; description: string; h1: string; og?: boolean; schema?: string; img?: string }): string {
  return `<!doctype html><html lang="en"><head><title>${o.title}</title><meta name="description" content="${o.description}">
    <link rel="canonical" href="${SITE}${o.path === "/" ? "" : o.path}">
    ${o.og ? `<meta property="og:title" content="${o.h1} specimen card"><meta property="og:image" content="${SITE}/og/specimen.jpg">` : ""}
    ${o.schema ? `<script type="application/ld+json">${o.schema}</script>` : ""}</head>
    <body><nav><a href="/">Home</a><a href="/specimen-wombat-design">Wombats</a><a href="/specimen-plain">Plain</a></nav><main><h1>${o.h1}</h1><h2>Specimen section</h2><p>${words(320, "specimen")}</p>${o.img ?? ""}</main><footer>Specimen footer</footer></body></html>`;
}
const SPECIMEN: Record<string, string> = {
  "/": page({ path: "/", title: "Specimen home | Balkaris", description: "The specimen home page of a made-up site.", h1: "Specimen home", og: true }),
  "/specimen-wombat-design": page({
    path: "/specimen-wombat-design",
    title: "Wombat design for specimen businesses | Balkaris",
    description: "Specimen wombat design, made up for a check, and nothing more.",
    h1: "Wombat design in Specimenville",
    og: true,
    schema: FAQ,
  }),
  "/specimen-plain": page({ path: "/specimen-plain", title: "Specimen plain | Balkaris", description: "A plain specimen page without a share card.", h1: "Specimen plain", img: `<img src="/specimen-a.jpg"><img src="/specimen-b.jpg" alt="">` }),
};
const urlset = (paths: string[]) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`;
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
function serve(url: string): Response | null {
  const u = new URL(url);
  if (u.host === "balkaris.ch") return new Response(null, { status: 308, headers: { location: `${SITE}${u.pathname}` } });
  if (u.host !== "www.balkaris.ch") return null;
  if (u.pathname === "/sitemap.xml") return new Response(urlset(Object.keys(SPECIMEN)), { status: 200, headers: { "content-type": "application/xml" } });
  if (u.pathname === "/robots.txt") return new Response(`User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`, { status: 200, headers: { "content-type": "text/plain" } });
  if (/\.(jpe?g|png|webp)$/.test(u.pathname)) return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
  const p = SPECIMEN[u.pathname === "" ? "/" : u.pathname];
  return p ? new Response(p, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
}

/* ---- the code under test, loaded after the environment is set -------------- */

const { db } = await import("../src/db.ts");
const store = await import("../src/cc/store.ts");
await import("../src/cc/site/index.ts");
const crawlMod = await import("../src/cc/site/crawl.ts");
await import("../src/cc/seo/tables.ts");
await import("../src/cc/operator/tables.ts");
const optimize = await import("../src/cc/routes/seo/optimize.ts");
const operator = await import("../src/cc/routes/operator.ts");
const { apiError } = await import("../src/cc/api.ts");
const { Hono } = await import("hono");
type Vars = import("../src/cc/access.ts").Vars;
type Person = import("../src/people.ts").Person;
type Payload = import("../web/src/contract/seo/page-view.ts").SeoPageViewPayload;
type Settings = import("../web/src/contract/seo/page-view.ts").PageSettings;
const P = optimize.parts;

const OWNER = { telegram: 1, name: "Specimen Owner", email: "owner@specimen.invalid", owner: true, canPublish: true, seesLeads: true, grants: {} } as unknown as Person;
const MEMBER = { telegram: 2, name: "Specimen Member", email: null, owner: false, canPublish: false, seesLeads: false, grants: {} } as unknown as Person;
const app = new Hono<Vars>();
app.use("*", async (c, next) => {
  c.set("who", c.req.header("x-specimen-who") === "member" ? MEMBER : OWNER);
  await next();
});
app.route("/api/v1/seo/optimize", optimize.routes);
app.route("/api/v1/operator", operator.routes);
app.onError(apiError);

async function screen(path: string): Promise<Payload> {
  const r = await app.request(`/api/v1/seo/optimize?path=${encodeURIComponent(path)}`);
  if (r.status !== 200) throw new Error(`GET ${path} answered ${r.status}: ${await r.text()}`);
  return (await r.json()) as Payload;
}
async function post<T = Record<string, unknown>>(url: string, body: unknown, who: "owner" | "member" = "owner"): Promise<{ status: number; json: T & { error?: string } }> {
  const r = await app.request(url, { method: "POST", headers: { "content-type": "application/json", "x-specimen-who": who }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as T & { error?: string } };
}
const settingsOf = (d: Payload): Settings => {
  if (d.settings.state !== "ok") throw new Error(`settings: ${d.settings.reason}`);
  return d.settings.value;
};
const fieldOf = (s: Settings, key: string) => [...s.search.fields, ...s.sharing.fields, ...s.index.fields].find((f) => f.key === key)!;

/* ---- the specimen crawl ------------------------------------------------------ */

section("The specimen site, read by the desk's own crawl");
store.setState("probe:last", String(Date.now()));
let crawled = "";
try {
  await crawlMod.crawl();
} catch (e) {
  crawled = e instanceof Error ? e.message : String(e);
}
check("the specimen crawl ran", crawled === "", crawled);

/* ---- 1. the address ---------------------------------------------------------- */

section("1. The address");
check("a missing leading slash is meant as one", P.addressOf("specimen-plain") === "/specimen-plain");
check("this site's whole address is its page", P.addressOf(`${SITE}/specimen-plain/?x=1`) === "/specimen-plain");
let foreign = "";
try {
  P.addressOf("https://specimen-rival.invalid/specimen-plain");
} catch (e) {
  foreign = e instanceof Error ? e.message : String(e);
}
check("another site's address is refused in a sentence, not read as ours", /another site/.test(foreign), foreign);
{
  const r = await app.request(`/api/v1/seo/optimize?path=${encodeURIComponent("https://specimen-rival.invalid/x")}`);
  check("the route answers 400 for it", r.status === 400, r.status);
}

/* ---- 2. the settings ----------------------------------------------------------- */

section("2. The page's settings");
const W = "/specimen-wombat-design";
let d = await screen(W);
let s = settingsOf(d);
check("the four groups are drawn", ["search", "sharing", "index", "schema"].every((k) => (s as unknown as Record<string, { key: string }>)[k]?.key === k));
check("the title is what the live page says", fieldOf(s, "title").live === "Wombat design for specimen businesses | Balkaris", fieldOf(s, "title"));
check("the share title is the page's og:title", fieldOf(s, "ogTitle").live === "Wombat design in Specimenville specimen card", fieldOf(s, "ogTitle"));
check("the share picture is drawn from the live site", fieldOf(s, "ogImage").livePicture === `${SITE}/og/specimen.jpg`, fieldOf(s, "ogImage"));
check("in search, by the crawl", fieldOf(s, "noindex").live === "In search");
check("the canonical is the page's own", fieldOf(s, "canonical").live === `${SITE}${W}`);
check("nothing approved, nothing waiting", [...s.search.fields, ...s.sharing.fields, ...s.index.fields].every((f) => f.approved === null && f.waiting === null));
check("the printed structured data is listed", s.schemaTypes.includes("FAQPage"), s.schemaTypes);
check("an FAQPage is not offered again where the page prints one", s.schema.ai.find((a) => a.task.schemaType === "FAQPage")?.available === false && /already/.test(s.schema.ai.find((a) => a.task.schemaType === "FAQPage")?.unavailable ?? ""));
check("a Service block is offered", s.schema.ai.find((a) => a.task.schemaType === "Service")?.available === true);
check("the search group's draft is a metadata task that becomes a proposal", s.search.ai[0]?.task.kind === "metadata" && s.search.ai[0]?.gives === "proposal");
check("the sharing group's draft is an og task", s.sharing.ai[0]?.task.kind === "og" && s.sharing.ai[0]?.task.path === W);
check("the index question is said to be advice, not a change", s.index.ai[0]?.gives === "advice" && s.index.ai[0]?.task.kind === "ask");
check("the home page may not be taken out of search", settingsOf(await screen("/")).noindexRefused !== null);
check("another page may", s.noindexRefused === null);

/* ---- 3. the quick actions ------------------------------------------------------ */

section("3. The quick actions do what their labels say");
const kinds = Object.fromEntries(d.quick.map((q) => [q.key, q.task.kind]));
check("review, title, share card, block, links, alt texts, brief", JSON.stringify(kinds) === JSON.stringify({ optimize: "ask", meta: "metadata", og: "og", schema: "schema", links: "links", alt: "alt", expand: "brief" }), kinds);
check("a review is not called optimizing", d.quick.find((q) => q.key === "optimize")?.label === "Review with AI");
check("the brief is given the page", d.quick.find((q) => q.key === "expand")?.task.path === W);
check("the block drafted is the type the page lacks", d.quick.find((q) => q.key === "schema")?.task.schemaType === "Service");
check("alt texts are off where every picture has one", d.quick.find((q) => q.key === "alt")?.available === false);
const plain = await screen("/specimen-plain");
check("alt texts are offered where a picture has none", plain.quick.find((q) => q.key === "alt")?.available === true);

/* ---- 4. a person's changes through the operator's door ---------------------- */

section("4. A person's share card and title");
const og = await post<{ proposal: { id: number } }>("/api/v1/operator/proposals", { kind: "og", address: W, ogTitle: "Specimen wombats, designed to be shared", ogDescription: "A made-up share text for the specimen wombat page, long enough to read." });
check("the share card is proposed (201)", og.status === 201, og.json);
const twin = await post("/api/v1/operator/proposals", { kind: "og", address: W, ogTitle: "Specimen wombats, designed to be shared", ogDescription: "A made-up share text for the specimen wombat page, long enough to read." });
check("an exact repeat is refused as already waiting", twin.status === 409 && /already waits/.test(twin.json.error ?? ""), twin.json);
d = await screen(W);
s = settingsOf(d);
check("the share title shows as waiting, with its proposal", fieldOf(s, "ogTitle").waiting?.value === "Specimen wombats, designed to be shared" && fieldOf(s, "ogTitle").waiting?.id === og.json.proposal.id, fieldOf(s, "ogTitle"));
check("the live value is unchanged beside it", fieldOf(s, "ogTitle").live === "Wombat design in Specimenville specimen card");
check("the proposal is listed in its group", s.sharing.proposals.some((p) => p.id === og.json.proposal.id));
const meta = await post<{ proposal: { id: number } }>("/api/v1/seo/optimize/propose", { path: W, title: "Specimen wombat design, a made-up title for a check run" });
check("a title is proposed", meta.status === 201, meta.json);
const metaAgain = await post("/api/v1/seo/optimize/propose", { path: W, title: "Specimen wombat design, a made-up title for a check run" });
check("the same title again is refused", metaAgain.status === 409, metaAgain.json);
d = await screen(W);
s = settingsOf(d);
check("a long title waits as the website would show it, without the brand", fieldOf(s, "title").waiting?.value === "Specimen wombat design, a made-up title for a check run", fieldOf(s, "title").waiting);
check("a waiting title holds the title draft back", s.search.ai[0]?.available === false && /approval/.test(s.search.ai[0]?.unavailable ?? ""));
check("the side value of a short title carries the brand", P.sideValue("title", { after: { title: "Short" } } as never) === "Short | Balkaris");

/* ---- 5. an asked draft waits for its task ------------------------------------- */

section("5. A draft asked of the local model");
const task = await post<{ task: { id: number; title: string } }>("/api/v1/operator/tasks", { kind: "og", path: W });
check("the share-card draft is queued (202)", task.status === 202, task.json);
d = await screen(W);
s = settingsOf(d);
check("the sharing group waits for that task", s.sharing.ai[0]?.pending?.id === task.json.task.id, s.sharing.ai[0]);
check("so does the quick action, matched by page", d.quick.find((q) => q.key === "og")?.pending?.id === task.json.task.id);
check("another page's share card is not held back", (await screen("/specimen-plain")).quick.find((q) => q.key === "og")?.available === true);
const sameKind = P.sameTask({ kind: "schema", path: W, schemaType: "FAQPage" }, W, { tasks: [{ id: 9, kind: "schema", prompt: "Draft Service for x", state: "queued", asked_by: null, created_at: "", options: JSON.stringify({ path: W, schemaType: "Service" }) }], todos: new Map(), waitingMeta: 0 } as never);
check("a block of another type is another task", sameKind === null);

/* ---- 6. approve, reject, applied ------------------------------------------------ */

section("6. Approve, reject, and what is live");
const refusedApproval = await post(`/api/v1/operator/proposals/${og.json.proposal.id}/approve`, {}, "member");
check("approving needs the right to publish, said in a sentence", refusedApproval.status === 403 && (refusedApproval.json.error ?? "").length > 20, refusedApproval.json);
const rejected = await post(`/api/v1/operator/proposals/${meta.json.proposal.id}/reject`, {});
check("anyone may reject", rejected.status === 200, rejected.json);
d = await screen(W);
s = settingsOf(d);
check("a rejected title no longer waits", fieldOf(s, "title").waiting === null);
db.prepare("UPDATE cc_proposals SET state = 'applied', applied_at = ?, decided_by = 'Specimen Owner' WHERE id = ?").run(new Date().toISOString(), og.json.proposal.id);
d = await screen(W);
s = settingsOf(d);
check("an applied share card shows as approved", fieldOf(s, "ogTitle").approved?.value === "Specimen wombats, designed to be shared" && fieldOf(s, "ogTitle").waiting === null, fieldOf(s, "ogTitle"));

/* ---- 7. the suggestions ------------------------------------------------------------- */

section("7. The suggestions");
const sug = (await screen("/specimen-plain")).suggestions;
const share = sug.find((x) => x.key === "finding:share.missing" || x.key.startsWith("finding:share"));
check("a missing share card is drafted by the og kind", !!share && (share.act.kind === "task" && share.act.task.kind === "og"), share);
const pics = sug.find((x) => x.key === "finding:images.alt-missing" || x.key.startsWith("finding:images"));
check("pictures without alt go to the alt kind", !!pics && pics.act.kind === "task" && pics.act.task.kind === "alt", sug.map((x) => x.key));
const finding = (rule: string, area: string) => ({ rule, area, path: W, severity: "warning", cost: 3, title: rule, text: `Specimen finding ${rule}.`, measured: null }) as never;
const schemaSug = P.fromFinding(finding("schema.missing", "schema"), W, null);
check("missing structured data is drafted by the schema kind", schemaSug?.act.kind === "task" && schemaSug.act.task.kind === "schema", schemaSug);
const unreadable = P.fromFinding(finding("schema.unreadable", "schema"), W, null);
check("an unreadable block in the site's code is a to-do, not a draft", unreadable?.act.kind === "todo", unreadable);
const orphan = P.fromFinding(finding("links.orphan", "links"), W, null);
check("an orphan page gets the links kind", orphan?.act.kind === "task" && orphan.act.task.kind === "links");
const price = P.fromReadiness({ key: "price", label: "States a price", state: "fail", detail: "No CHF amount on the page.", fix: "State a price.", who: "owner" }, W, null, true);
check("a failing check does not read as passing", price?.label === "Not yet: states a price", price?.label);
const german = P.fromReadiness({ key: "german", label: "German version", state: "fail", detail: "No German version.", fix: "Add one.", who: "code" }, W, null, true);
check("the German version is briefed, with the page", german?.act.kind === "task" && german.act.task.kind === "brief" && german.act.task.path === W, german);
const unscored = P.statusOf([], null, false, null, new Date().toISOString());
check("an unscored page has no area scores", unscored.state === "ok" && unscored.value.areas.length === 0);
check("no line says “1 impressions”", !/\b1 impressions\b/.test(JSON.stringify(d)));

/* ---- 8. the phrases --------------------------------------------------------------------- */

section("8. Phrases mapped to the page");
const now = new Date().toISOString();
db.prepare("INSERT INTO cc_seo_keywords (phrase, lang, sources, status, page, mapped_by, first_seen, last_seen) VALUES (?, 'en', 'audit', 'relevant', ?, 'audit', ?, ?)").run("specimen wombat design", W, now, now);
db.prepare("INSERT INTO cc_seo_keywords (phrase, lang, sources, status, page, mapped_by, first_seen, last_seen) VALUES (?, 'en', 'audit', 'weak', ?, 'audit', ?, ?)").run("quokka gardening", W, now, now);
d = await screen(W);
const phrases = d.phrases.state === "ok" ? d.phrases.value : [];
const carried = phrases.find((p) => p.phrase === "specimen wombat design");
check("the page's phrases are listed, relevant first", phrases[0]?.phrase === "specimen wombat design" && phrases.length === 2, phrases);
check("a phrase the page carries is ticked in title and address", !!carried && carried.inTitle && carried.inAddress && carried.inH1, carried);
check("one it does not carry is not", phrases.find((p) => p.phrase === "quokka gardening")?.inTitle === false);
check("without Search Console figures, no number is invented", phrases.every((p) => p.impressions === null && p.position === null));

/* ---- 9. nothing left ----------------------------------------------------------------------- */

section("9. Nothing left the machine");
check("no request went anywhere but the specimen site", left.length === 0, left);

console.log(`\n${passed} ok, ${failed} failed`);
writeFileSync(path.join(dir, "done"), String(passed));
process.exit(failed ? 1 : 0);
