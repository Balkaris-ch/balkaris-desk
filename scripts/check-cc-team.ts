/**
 * Team: who may see what on the desk, and what they did. End to end against
 * the real server, a throwaway database in work/, nothing leaving this
 * machine and the scheduler's clock off.
 *
 *   npm run check:team
 *
 * What is proved, one line each:
 *    1. somebody with no grants keeps every area, as before access existed:
 *       each of the sixteen at the most it offers, every screen answered and
 *       every kind of change a member always had taken by the gate; the
 *       owner's Team pages are the owner's alone;
 *    2. a template narrows a person at the server's gate, the API's and the
 *       old console's alike: no area is 403 with its name, a view-only area
 *       refuses a change, publishing goes with Insights' edit, the enquiry
 *       right needs Leads as well, and the search box stops offering what
 *       they cannot open; "cannot publish" gives the true reason and an
 *       article offers only what the gate will take; the SEO Analyst template
 *       can use SEO's AI buttons;
 *    3. one page can be set apart from its area (SEO › Keywords), and SEO's
 *       addresses that are no single page's follow the page switches too;
 *       running a job follows the areas the job feeds, and what its last run
 *       said is read by the people who see one of them;
 *    4. only the owner reads or changes access, and the owner cannot be restricted;
 *    5. a newcomer the owner chose to hold back gets /me and nothing else;
 *    6. an invitation is the row their first sign-in finds, with the access
 *       chosen; only an unused one can be withdrawn, never one that was
 *       linked to a Telegram account or switched off; only the domain's
 *       addresses can be invited, and an address whose place somebody still
 *       sits in is refused in words that say how it would arrive;
 *    7. what people do is recorded: online, the page they are on, the
 *       screens they open, their minutes (at most one a minute), and every
 *       change the desk accepted, in the route's own words when it wrote any;
 *       a refused change is not an action, nor is one that changed nothing,
 *       and one act is one event; saving access records what really changed,
 *       and the enquiry right is announced when it starts to apply; a
 *       person's totals are the days their chart draws, and a tile compares
 *       only with a period the desk recorded; the record is pruned, and one
 *       bad row does not hold the rest back; the owner reads it all,
 *       filtered to one person;
 *    8. linking two rows carries the access and the activity across;
 *    9. changing a restricted or switched-off person's address is refused at
 *       both doors; where it was changed before, neither address is a way
 *       round what the owner decided: the row stays with the address the
 *       owner gave it, and the former one arrives beside it with nothing (or
 *       switched off); a row whose address was removed gets it back as
 *       decided; an unrestricted row the owner re-addressed keeps its byline
 *       and rights, and the old address is a newcomer; nothing planted
 *       restricts the owner;
 *   10. the activity feed is the Command Center's, and the bell shows a
 *       person only the rows that lead somewhere they may go;
 *   11. the bot holds a link shared by somebody who may not publish: the
 *       piece stays a draft, and the chat is told once;
 *   12. a switched-off person's access is shown, and saved back, as stored;
 *   13. Members calls a row Telegram-only only while it has no address;
 *   14. a draft's cover and the matcher are Insights', and a look-only area
 *       says who changes it.
 *
 * Everybody in here is made up: the addresses end in desk.test.
 */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "work", `check-team-${process.pid}`);
mkdirSync(dir, { recursive: true });

const PORT = 3473;
const BASE = `http://127.0.0.1:${PORT}`;

for (const name of ["DESK_SESSION_SECRET", "DESK_DEV_USER", "TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_ID", "SITE_REPO"]) delete process.env[name];
process.env.NODE_ENV = "development";
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.DESK_PORT = String(PORT);
process.env.DESK_URL = BASE;
process.env.DESK_OWNER = "owner@desk.test";
process.env.DESK_GOOGLE_DOMAIN = "desk.test";
process.env.DESK_RUNNER_SECRET = "runner-secret-of-the-team-check";
process.env.TELEGRAM_WEBHOOK_SECRET = "hook";
process.env.DESK_AUTOPUBLISH = "0";
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "no-such-key.json");
process.env.CC_SCHEDULER = "off";
/* The website's repository, as the publisher and the collectors know it, is a folder of this run that
   does not exist (src/publish.ts reads these when it loads). So a publish that should have been held
   fails here, on this machine, and never reaches for the real repository. Covers and clips likewise. */
process.env.SITE_REPO = path.join(dir, "site");
process.env.SITE_READ_REPO = path.join(dir, "site-read.git");
process.env.SITE_REMOTE = `file:///${path.join(dir, "no-such-remote.git").split(path.sep).join("/")}`;
process.env.DESK_COVERS = path.join(dir, "covers");
process.env.DESK_CLIPS = path.join(dir, "clips");
/* Not a token: with one set the bot speaks, and what it says is kept by the recorder below instead of sent. */
process.env.TELEGRAM_BOT_TOKEN = "test-token";

/* ---- nothing leaves this machine ------------------------------------------- */
const real = globalThis.fetch;
const left: string[] = [];
/** What the bot said, and to which chat. */
const told: { chat: unknown; text: string }[] = [];
/* A page somebody asks the desk to read: a specimen article, as scripts/check-telegram.ts answers one. */
const ARTICLE = (n: string) => `<!doctype html><html><head><title>Article ${n} about search</title></head><body><article>
<h1>Article ${n} about search</h1>
${Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i} of article ${n}. Search engines rank pages, and a company that wants to be found needs pages that answer questions people actually ask, with structured data and a sitemap behind them, which is the kind of work a studio does for its clients every week of the year.</p>`).join("\n")}
</article></body></html>`;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(BASE)) return real(input as never, init);
  if (url.startsWith("https://api.telegram.org/")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    told.push({ chat: body.chat_id, text: String(body.text ?? "") });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 100 + told.length } }), { headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("https://example.test/")) {
    const page = new Response(ARTICLE(url.split("/").pop()!), { headers: { "content-type": "text/html; charset=utf-8" } });
    /* A made Response has no address, and the reader hands its address to the parser. */
    Object.defineProperty(page, "url", { value: url });
    return page;
  }
  left.push(url.split("?")[0]);
  throw new Error("check:team lets nothing leave this machine");
}) as typeof fetch;

const said: string[] = [];
const quiet = { error: console.error, warn: console.warn };
console.error = (...a: unknown[]) => void said.push(a.map(String).join(" "));
console.warn = (...a: unknown[]) => void said.push(a.map(String).join(" "));

let failed = 0;
let passed = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}${detail ? `  — ${detail}` : ""}`);
};

const { db } = await import("../src/db.ts");
const people = await import("../src/people.ts");
const { seal } = await import("../src/session.ts");
await import("../src/server.ts");
const scheduler = await import("../src/cc/scheduler.ts");
const store = await import("../src/cc/store.ts");
const grants = await import("../src/grants.ts");
const presence = await import("../src/presence.ts");

type Person = ReturnType<typeof people.rememberGoogle>;
interface Answer {
  status: number;
  type: string;
  text: string;
  json: any;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ask(pathname: string, o: { who?: Person | null; method?: string; body?: unknown; form?: Record<string, string> } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (o.who) headers.cookie = `desk=${seal(o.who.telegram)}`;
  if (o.method && o.method !== "GET") headers.origin = BASE;
  if (o.form !== undefined) headers["content-type"] = "application/x-www-form-urlencoded";
  else if (o.body !== undefined) headers["content-type"] = "application/json";
  const body = o.form !== undefined ? new URLSearchParams(o.form).toString() : o.body === undefined ? undefined : JSON.stringify(o.body);
  const res = await real(BASE + pathname, { method: o.method ?? "GET", headers, body, redirect: "manual" });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, type: res.headers.get("content-type") ?? "", text, json };
}
const post = (pathname: string, who: Person, body: unknown = {}) => ask(pathname, { who, method: "POST", body });
/** The old console's forms post themselves form-encoded. */
const send = (pathname: string, who: Person, form: Record<string, string> = {}) => ask(pathname, { who, method: "POST", form });
const show = (a: Answer) => `${a.status} ${a.text.slice(0, 120).replace(/\s+/g, " ")}`;
/** A person's row as it is stored, which is what a sign-in must leave alone. */
const stored = (id: number) =>
  db.prepare("SELECT email, author, revoked, sees_leads, grants FROM people WHERE telegram = ?").get(id) as
    | { email: string | null; author: string; revoked: number; sees_leads: number; grants: string | null }
    | undefined;
const actionCount = (): number => (db.prepare("SELECT COUNT(*) AS n FROM team_actions").get() as { n: number }).n;
/* What the access editor posts for a person: every area's level and every page's override or "", as web/src/components/team/actions.ts builds it. */
const editorForm = (access: any, id: number): { set: Record<string, string>; seesLeads: boolean } => {
  const person = access.people.find((p: any) => p.id === id);
  const set: Record<string, string> = {};
  for (const area of access.areas) {
    set[area.key] = person.areas[area.key];
    for (const pg of area.pages) if (!pg.ownerOnly) set[`page:${pg.key}`] = person.overridden.includes(pg.key) ? person.pages[pg.key] : "";
  }
  return { set, seesLeads: person.leadsGranted };
};
const refused = (a: Answer, words: RegExp) => a.status === 403 && typeof a.json?.error === "string" && words.test(a.json.error);

async function finish(): Promise<never> {
  console.error = quiet.error;
  console.warn = quiet.warn;
  console.log(`\n${failed ? `${failed} FAILED, ${passed} passed` : `all ${passed} passed`}.`);
  if (failed && said.length) console.log(`\nwhat the server said meanwhile:\n${said.map((s) => `  ${s.split("\n")[0].slice(0, 200)}`).join("\n")}`);
  await wait(1200);
  db.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* Windows keeps the file a moment longer. */
  }
  process.exit(failed ? 1 : 0);
}

for (let i = 0; i < 100 && (await ask("/health").catch(() => null))?.status !== 200; i++) await wait(80);

const owner = people.rememberGoogle("owner@desk.test", "Specimen Owner");
let member = people.rememberGoogle("member@desk.test", "Specimen Member");
/* Somebody the owner never restricts, from the first line to the last: what "no grants" keeps is asked of them. */
const plain = people.rememberGoogle("plain@desk.test", "Specimen Plain");
db.prepare("INSERT INTO links (url, title, site, state) VALUES (?, ?, ?, 'drafted')").run("https://example.test/specimen", "Specimen source page", "example.test");
db.prepare("INSERT INTO drafts (link_id, slug, post, template, cover_alt) VALUES (1, 'specimen-article', ?, 'standard', 'A specimen cover')").run(
  JSON.stringify({ title: "Specimen article of the team check", body: ["A specimen."], source: { url: "https://example.test/specimen", site: "example.test", title: "Specimen", author: null } }),
);
/* And a link nothing was written from, which is where "Try it again" is offered. */
db.prepare("INSERT INTO links (url, title, site, state, error) VALUES (?, ?, ?, 'failed', 'A specimen failure.')").run("https://example.test/unwritten", "Specimen unwritten page", "example.test");

/* Every collector's job off, and one specimen job that runs harmlessly. */
const theirs = ((await ask("/api/v1/jobs", { who: owner })).json ?? []) as { name: string }[];
for (const j of theirs) await post(`/api/v1/jobs/${j.name}/enabled`, owner, { enabled: false });
scheduler.register({ name: "check-team", title: "Specimen job of the team check", every: 3600, delay: 3600, run: async () => "specimen run, nothing read" });
/* A second one for the person with no grants: a job may be asked for once in ten minutes, and the first is asked for further down. */
scheduler.register({ name: "check-team-plain", title: "Second specimen job of the team check", every: 3600, delay: 3600, run: async () => "second specimen run, nothing read" });

const meOf = async (who: Person) => (await ask("/api/v1/me", { who })).json;

/**
 * REFUSED BY THE GATE, as opposed to answered by a route: a 403 in the gate's own words (src/grants.ts
 * `judge`), in the API's JSON or on the old console's page. A route's own 400, 404, 409 or 429 is past it.
 */
const GATE_WORDS = /Ask the owner|Only the owner changes anything in|not change anything on it|not given you access to anything|reads for a part of the desk|not part of your access/;
const byGate = (x: Answer): boolean => x.status === 403 && GATE_WORDS.test(typeof x.json?.error === "string" ? x.json.error : x.text);

/* One screen per area, SEO's eleven, the team list and the old console's pages. */
const EVERY_SCREEN = [
  "/api/v1/overview",
  "/api/v1/activity",
  "/api/v1/insights",
  "/api/v1/traffic",
  "/api/v1/seo/overview",
  "/api/v1/seo/opportunities",
  "/api/v1/seo/pages",
  "/api/v1/seo/keywords",
  "/api/v1/seo/content-gaps",
  "/api/v1/seo/backlinks",
  "/api/v1/seo/technical",
  "/api/v1/seo/search-console",
  "/api/v1/seo/competitors",
  "/api/v1/seo/ai-search",
  "/api/v1/seo/automations",
  "/api/v1/pages",
  "/api/v1/content",
  "/api/v1/conversions",
  "/api/v1/leads",
  "/api/v1/experiments",
  "/api/v1/health",
  "/api/v1/hosting",
  "/api/v1/automations",
  "/api/v1/assets",
  "/api/v1/operator",
  "/api/v1/settings",
  "/api/v1/team/members",
  "/console",
  "/people",
  "/draft/1",
  "/link/1",
];
/* One change of every kind a member has always had. The bodies are the least a route reads, so most answer 400 or 404, past the gate.
   Not POST /api/v1/seo/audit: for a member it is accepted, and starts a real audit. */
const EVERY_CHANGE: [string, unknown][] = [
  ["/api/v1/jobs/check-team-plain/run", {}],
  ["/api/v1/automations/run-due", {}],
  ["/api/v1/experiments/saved", {}],
  ["/api/v1/experiments/saved/999/delete", {}],
  ["/api/v1/insights/retry/999", {}],
  ["/api/v1/operator/tasks", {}],
  ["/api/v1/operator/todos", {}],
  ["/api/v1/seo/keywords", {}],
  ["/api/v1/seo/opportunities/act", {}],
  ["/api/v1/spider/audit", {}],
  ["/link/999/retry", null],
  ["/draft/999/reclose", null],
];

/* ---------------------------------------------------------------------------- */
console.log("\n1. no grants: everything, as before");
let me = await meOf(member);
check("a member with no grants is not restricted and starts at the Command Center", me?.access?.restricted === false && me.access.home === "/", JSON.stringify(me?.access ?? null).slice(0, 120));
/* All sixteen areas, each at the most it offers: edit on the five where a member changes something, view on the rest. */
const EVERY_AREA: Record<string, string> = {
  overview: "view",
  insights: "edit",
  traffic: "view",
  seo: "edit",
  pages: "view",
  content: "view",
  conversions: "view",
  leads: "view",
  experiments: "edit",
  "site-health": "view",
  hosting: "view",
  automations: "edit",
  assets: "view",
  operator: "edit",
  settings: "view",
  "team/members": "view",
};
check(
  "every area's page is open to them, with edit on Insights, SEO, Experiments, Automations and the AI Operator",
  Object.keys(EVERY_AREA).length === grants.AREAS.length && Object.entries(EVERY_AREA).every(([k, level]) => me.access.pages[k] === level) && grants.AREAS.find((x) => x.key === "seo")!.pages.every((p) => me.access.pages[p.key] === "edit"),
  JSON.stringify(Object.entries(EVERY_AREA).filter(([k, level]) => me.access.pages[k] !== level).map(([k]) => `${k}: ${me.access.pages[k]}`)),
);
check("the owner's Team pages are not", ["team", "team/access", "team/invitations"].every((k) => me.access.pages[k] === "none"));
check("they can still publish, with an address", me.canPublish === true);
let a = await ask("/api/v1/traffic", { who: member });
let b: Answer;
let listed: any;
check("a screen opens for them", a.status !== 403, show(a));
const ownerMe = await meOf(owner);
check("the owner sees the owner's Team pages", ["team", "team/access", "team/invitations"].every((k) => ownerMe.access.pages[k] === "view"));

/* What that means at the gate, asked of somebody who stays without grants (asked of the member, these would count as theirs further down). */
let stopped: string[] = [];
for (const p of EVERY_SCREEN) if (byGate(await ask(p, { who: plain }))) stopped.push(p);
check(`not one of the ${EVERY_SCREEN.length} screens is refused to a person with no grants`, stopped.length === 0, stopped.join(", "));
stopped = [];
const answered: string[] = [];
for (const [p, body] of EVERY_CHANGE) {
  const x = body === null ? await send(p, plain) : await post(p, plain, body);
  answered.push(`${p} ${x.status}`);
  if (byGate(x)) stopped.push(p);
}
check(`nor one of the ${EVERY_CHANGE.length} kinds of change a member has always had`, stopped.length === 0, stopped.join(", "));
check("the refresh and the jobs that are due among them, accepted", answered.includes("/api/v1/jobs/check-team-plain/run 202") && answered.includes("/api/v1/automations/run-due 200"), answered.join(" | "));

/* ---------------------------------------------------------------------------- */
console.log("\n2. a template narrows them, at the gate");
/* The enquiry right first, in a request of its own, so that what the template then takes away is the area and not the right. */
a = await post(`/api/v1/team/access/${member.telegram}`, owner, { seesLeads: true });
check("the owner lets the member read enquiries, and with every area they do", a.status === 200 && stored(member.telegram)?.sees_leads === 1 && (await meOf(member)).seesLeads === true, show(a));
a = await post(`/api/v1/team/access/${member.telegram}`, owner, { preset: "analyst" });
check("the owner gives the member the Analyst template", a.status === 200 && a.json?.person?.role?.key === "analyst", show(a));
me = await meOf(member);
check("now they are restricted", me.access.restricted === true && me.access.pages.leads === "none" && me.access.pages.traffic === "view");
a = await ask("/api/v1/leads", { who: member });
check("an area they were not given is 403, naming it", refused(a, /access to Leads/), show(a));
a = await ask("/api/v1/traffic", { who: member });
check("an area they were given still opens", a.status !== 403, show(a));
a = await post("/api/v1/insights/create", member, { url: "https://example.test/new" });
check("a change in a view-only area is refused, saying they can view it", refused(a, /view Insights but not change it/), show(a));
check("and they cannot publish any more", me.canPublish === false && people.getPerson(member.telegram)?.canPublish === false);
check(
  "nor read enquiries, though their enquiry right is still stored: it needs Leads as well",
  me.seesLeads === false && people.getPerson(member.telegram)?.seesLeads === false && stored(member.telegram)?.sees_leads === 1,
  `seesLeads ${me.seesLeads}, stored ${stored(member.telegram)?.sees_leads}`,
);
await post(`/api/v1/team/access/${member.telegram}`, owner, { set: { leads: "view" } });
check("with Leads given, the right applies again", (await meOf(member)).seesLeads === true && people.getPerson(member.telegram)?.seesLeads === true);
await post(`/api/v1/team/access/${member.telegram}`, owner, { preset: "analyst" });
check("and stops with the template, the stored right untouched", (await meOf(member)).seesLeads === false && stored(member.telegram)?.sees_leads === 1 && people.getPerson(member.telegram)?.grants?.leads === undefined);
a = await ask("/draft/1/publish", { who: member, method: "POST" });
check("the old console refuses the same change, in HTML", a.status === 403 && a.type.startsWith("text/html") && a.text.includes("view Insights but not change it"), show(a));

/* "Cannot publish" gives the true reason, and an article offers only what the gate will take. */
const forms = (html: string): string[] => [...html.matchAll(/<form method="post" action="(\/(?:draft|link)\/[^"]+)"/g)].map((m) => m[1]);
a = await ask("/draft/1", { who: member });
check(
  "the old article page tells an Analyst that Insights is read-only, not to add an email, and draws them no form",
  a.status === 200 && /Insights is read-only for you/.test(a.text) && !a.text.includes("no email yet") && !a.text.includes("Vercel email") && forms(a.text).length === 0,
  `${a.status} forms: ${forms(a.text).join(", ")}`,
);
a = await ask("/api/v1/article/1", { who: member });
check(
  "the article offers them nothing to change, and says why",
  a.status === 200 && a.json?.offers?.edit === false && a.json.offers.why === "access" && a.json.offers.canPublish === false && a.json.offers.remove === false && a.json.offers.redraw === false && a.json.offers.site.length === 0,
  JSON.stringify(a.json?.offers ?? show(a)),
);
a = await ask("/api/v1/article/link/2", { who: member });
b = await ask("/link/2", { who: member });
check("nor to try a link again, on either page", a.json?.offers?.retry === false && b.status === 200 && forms(b.text).length === 0, `${JSON.stringify(a.json?.offers ?? show(a))} forms: ${forms(b.text).join(", ")}`);
const opReader = people.rememberGoogle("op-reader@desk.test", "Specimen Operator Reader");
await post(`/api/v1/team/access/${opReader.telegram}`, owner, { grants: { insights: "view", operator: "edit" } });
a = await ask("/api/v1/operator", { who: opReader });
b = await post("/api/v1/operator/proposals/999/approve", opReader);
check(
  "the AI Operator tells somebody without edit on Insights that this is why they cannot approve",
  a.json?.me?.canApprove === false && /Insights/.test(a.json.me.why ?? "") && !/email/.test(a.json.me.why ?? "") && b.status === 403 && /Insights/.test(b.json?.error ?? "") && !/Add the email/.test(b.json?.error ?? ""),
  `${JSON.stringify(a.json?.me ?? show(a))} | ${show(b)}`,
);
/* Controls: somebody an email WOULD help is still told so, and an unrestricted person is offered what they were. */
const botOnly = people.remember(636363, "Specimen Bot Only");
a = await ask("/draft/1", { who: botOnly });
b = await ask("/api/v1/operator", { who: botOnly });
const botOffers = (await ask("/api/v1/article/1", { who: botOnly })).json?.offers;
check(
  "somebody with edit and no address still reads the email sentences, and keeps the forms",
  a.text.includes("no email yet") && a.text.includes("Vercel email") && forms(a.text).includes("/draft/1/remove") && /email/.test(b.json?.me?.why ?? "") && botOffers?.why === "address" && botOffers.edit === true && botOffers.remove === true,
  `${forms(a.text).join(", ")} | ${JSON.stringify(b.json?.me)} | ${JSON.stringify(botOffers)}`,
);
a = await ask("/api/v1/article/1", { who: plain });
b = await ask("/api/v1/article/link/2", { who: plain });
check(
  "an unrestricted person with an address is offered everything, as before",
  a.json?.offers?.edit === true && a.json.offers.why === null && a.json.offers.canPublish === true && a.json.offers.remove === true && a.json.offers.redraw === true && a.json.offers.site.join() === "publish" && b.json?.offers?.retry === true && forms((await ask("/draft/1", { who: plain })).text).join() === "/draft/1/redraw,/draft/1/publish,/draft/1/remove" && forms((await ask("/link/2", { who: plain })).text).join() === "/link/2/retry",
  `${JSON.stringify(a.json?.offers ?? show(a))} ${JSON.stringify(b.json?.offers)}`,
);
a = await ask("/console", { who: member });
check("and an old console page outside their access", a.status === 403 && a.text.includes("access to Content"), show(a));

/* A template gives what its work needs: SEO's AI buttons post to the AI Operator, and their answers open there. */
const seoAnalyst = people.rememberGoogle("seo-analyst@desk.test", "Specimen SEO Analyst");
a = await post(`/api/v1/team/access/${seoAnalyst.telegram}`, owner, { preset: "seo-analyst" });
const todo = await post("/api/v1/operator/todos", seoAnalyst, { title: "A specimen to-do of the team check" });
const task = await post("/api/v1/operator/tasks", seoAnalyst, {});
check(
  "the SEO Analyst template can use SEO's AI buttons",
  a.json?.person?.role?.key === "seo-analyst" && todo.status === 201 && task.status !== 403,
  `${show(a)} | ${show(todo)} | ${show(task)}`,
);
a = await ask("/api/v1/operator", { who: seoAnalyst });
b = await post("/api/v1/operator/proposals/1/approve", seoAnalyst);
check(
  "and still approves nothing onto the live site, and reads no enquiry",
  a.status === 200 && a.json?.me?.canApprove === false && b.status === 403 && (await ask("/api/v1/leads", { who: seoAnalyst })).status === 403,
  `${JSON.stringify(a.json?.me ?? show(a))} | ${show(b)}`,
);
check(
  "every template that works SEO has the AI Operator with it",
  grants.PRESETS.filter((p) => p.grants?.seo === "edit").length > 0 && grants.PRESETS.filter((p) => p.grants?.seo === "edit").every((p) => p.grants?.operator === "edit"),
  grants.PRESETS.filter((p) => p.grants?.seo === "edit").map((p) => `${p.key}: operator ${p.grants?.operator ?? "none"}`).join(", "),
);

a = await ask("/api/v1/search?q=lead", { who: member });
check("the search box no longer offers Leads", Array.isArray(a.json) && !a.json.some((h: any) => h.href === "/leads"), show(a));
a = await ask("/api/v1/search?q=traffic", { who: member });
check("but still offers what they may open", Array.isArray(a.json) && a.json.some((h: any) => h.href === "/traffic"), show(a));
a = await post("/api/v1/jobs/check-team/run", member);
check("an analyst, who changes nothing, cannot ask for a refresh", refused(a, /not change anything/), show(a));

/* ---------------------------------------------------------------------------- */
console.log("\n3. one page apart from its area");
a = await post(`/api/v1/team/access/${member.telegram}`, owner, { set: { seo: "edit", "page:seo/keywords": "none" } });
check("SEO on edit with Keywords switched off", a.status === 200 && a.json?.person?.pages?.["seo/keywords"] === "none" && a.json.person.pages["seo/technical"] === "edit", show(a));
a = await ask("/api/v1/seo/keywords", { who: member });
check("Keywords' own API is refused", refused(a, /SEO › Keywords/), show(a));
a = await ask("/api/v1/seo/overview", { who: member });
check("the rest of SEO opens", a.status !== 403, show(a));
check("the role reads Custom", a.status !== 403 && (await ask("/api/v1/team/members", { who: owner })).json?.members?.find((m: any) => m.id === member.telegram)?.role?.key === "custom");

/* SEO's addresses that are no single page's follow the page switches too. */
const each = async (paths: string[], who: Person): Promise<Answer[]> => {
  const out: Answer[] = [];
  for (const p of paths) out.push(await ask(p, { who }));
  return out;
};
const EARLIER = ["/api/v1/seo", "/api/v1/seo?range=7d", "/api/v1/seo/list/opportunities", "/api/v1/seo/report"];
let got = await each(EARLIER, member);
check(
  "the earlier SEO screen, which draws several pages in one answer, is refused while one of them is off, naming it",
  got.every((x) => refused(x, /access to SEO › Keywords/)),
  got.map(show).join(" | ").slice(0, 300),
);
got = await each(["/api/v1/seo/nav", "/api/v1/seo/audit", "/api/v1/seo/technical"], member);
check("SEO's own counts and the pages left on still open", got.every((x) => x.status !== 403), got.map((x) => x.status).join(" "));
a = await post("/api/v1/seo/clusters/x/page", member, { path: null });
check("a button's address goes with the page that draws it: Keywords' map is refused", refused(a, /access to SEO › Keywords/), show(a));
const seoOnly = people.rememberGoogle("seo-pages@desk.test", "Specimen SEO Pages");
const seoAs = (g: Record<string, string>) => post(`/api/v1/team/access/${seoOnly.telegram}`, owner, { grants: g });
await seoAs({ seo: "view", "page:seo/keywords": "edit" });
a = await post("/api/v1/seo/clusters/x/page", seoOnly, { path: null });
check("and passes the gate where Keywords is on edit in an SEO on view", a.status !== 403, show(a));
await seoAs({ seo: "view", "page:seo/search-console": "edit", "page:seo/technical": "view" });
a = await post("/api/v1/seo/indexing/requested", seoOnly, {});
check("a button two pages draw follows the higher of them", a.status !== 403, show(a));
await seoAs({ seo: "edit", "page:seo/search-console": "none", "page:seo/technical": "none" });
a = await post("/api/v1/seo/indexing/requested", seoOnly, {});
check("and is refused when both are off, whatever the area says", refused(a, /access to SEO › Technical or Search Console/), show(a));
await seoAs({ seo: "view", ...Object.fromEntries(grants.AREAS.find((x) => x.key === "seo")!.pages.map((p) => [`page:${p.key}`, "none"])) });
a = await ask("/api/v1/seo/nav", { who: seoOnly });
check("SEO left on with every page off opens nothing, its counts included", refused(a, /access to SEO\./) && (await meOf(seoOnly)).access.home === null, show(a));
for (const who of [owner, plain]) {
  got = await each([...EARLIER, "/api/v1/seo/nav", "/api/v1/seo/audit"], who);
  check(`${who.owner ? "the owner" : "a person with no grants"} is answered by all of them`, got.every((x) => x.status === 200), got.map((x) => x.status).join(" "));
}

/* Running a job follows the areas the job feeds. The specimen job is in nobody's list, so it is Automations' alone. */
const expOnly = people.rememberGoogle("exp-only@desk.test", "Specimen Experimenter");
await post(`/api/v1/team/access/${expOnly.telegram}`, owner, { grants: { experiments: "edit" } });
a = await post("/api/v1/jobs/crawl/run", expOnly);
check("edit on one area does not run a job that reads for other areas", refused(a, /reads for a part of the desk/), show(a));
await post(`/api/v1/team/access/${expOnly.telegram}`, owner, { grants: { automations: "view", experiments: "edit" } });
a = await post("/api/v1/jobs/crawl/run", expOnly);
b = await post("/api/v1/automations/run-due", expOnly);
check("nor does Automations on view: not one job, and not what is due", refused(a, /reads for a part of the desk/) && refused(b, /view Automations but not change it/), `${show(a)} | ${show(b)}`);
a = await post("/api/v1/jobs/crawl/run", member);
b = await post("/api/v1/jobs/vercel/run", member);
const unlisted = await post("/api/v1/jobs/check-team/run", member);
check(
  "with SEO on edit the crawl is theirs to ask for (the route's own answer), a job behind other areas is not",
  a.status === 409 && refused(b, /reads for a part of the desk/) && refused(unlisted, /reads for a part of the desk/),
  `${show(a)} | ${show(b)} | ${show(unlisted)}`,
);
await post(`/api/v1/team/access/${member.telegram}`, owner, { set: { automations: "edit" } });
a = await post("/api/v1/jobs/check-team/run", member);
b = await post("/api/v1/automations/run-due", member);
check("with Automations on edit, any job is theirs to run, and what is due", a.status === 202 && b.status === 200, `${show(a)} | ${show(b)}`);
a = await post("/api/v1/jobs/check-team/run", owner);
check("the owner is never asked what a job feeds", a.status === 429, show(a));

/* What the run said is for the people who see an area it feeds; that it ran is for everybody. */
const jobOf = async (who: Person) => ((await ask("/api/v1/jobs", { who })).json as any[] | null)?.find((j) => j.name === "check-team");
for (let i = 0; i < 80 && (await jobOf(owner))?.lastOk == null; i++) await wait(50);
const insightsOnly = people.rememberGoogle("insights-only@desk.test", "Specimen Insights Only");
await post(`/api/v1/team/access/${insightsOnly.telegram}`, owner, { grants: { insights: "view" } });
const [theirJob, ownerJob, plainJob] = [await jobOf(insightsOnly), await jobOf(owner), await jobOf(plain)];
check(
  "somebody who sees none of a job's areas is told that it ran and when, not what it said",
  ownerJob?.lastNote === "specimen run, nothing read" && plainJob?.lastNote === ownerJob.lastNote && theirJob?.lastNote === null && theirJob.lastOk === true && theirJob.lastEnd === ownerJob.lastEnd,
  JSON.stringify({ theirs: theirJob?.lastNote, owner: ownerJob?.lastNote, plain: plainJob?.lastNote, ok: theirJob?.lastOk }),
);
const [theirLight, ownerLight] = [(await ask("/api/v1/system", { who: insightsOnly })).json, (await ask("/api/v1/system", { who: owner })).json];
const lightOf = (s: any) => s?.checks?.find((c: any) => c.name === "Specimen job of the team check");
check(
  "the light's check for it says the same, and the light itself is everybody's",
  /specimen run/.test(lightOf(ownerLight)?.detail ?? "") && lightOf(theirLight)?.ok === true && /^The last run finished/.test(lightOf(theirLight)?.detail ?? "") && !JSON.stringify(theirLight?.checks).includes("specimen run") && theirLight?.ok === ownerLight?.ok && theirLight?.line === ownerLight?.line,
  `${JSON.stringify(lightOf(theirLight))} vs ${JSON.stringify(lightOf(ownerLight))}`,
);

/* ---------------------------------------------------------------------------- */
console.log("\n4. only the owner");
a = await ask("/api/v1/team/access", { who: member });
check("a member cannot read the access matrix", a.status === 403, show(a));
a = await post(`/api/v1/team/access/${member.telegram}`, member, { grants: null });
check("nor change anybody's access, their own included", a.status === 403, show(a));
a = await ask("/api/v1/team/activity", { who: member });
check("nor read the team's activity", a.status === 403, show(a));
a = await post(`/api/v1/team/access/${member.telegram}`, owner, { set: { team: "view" } });
a = await ask("/api/v1/team/members", { who: member });
check("given Team, they read the team list", a.status === 200 && Array.isArray(a.json?.members) && a.json.canEdit === false, show(a));
check("without anybody's last activity or whereabouts", a.json.members.every((m: any) => m.lastActive === null && m.place === null));
a = await post(`/api/v1/team/access/${owner.telegram}`, owner, { preset: "viewer" });
check("the owner cannot be restricted", a.status === 409, show(a));
a = await post(`/api/v1/team/access/${member.telegram}`, owner, { set: { leads: "edit" } });
check("a level an area does not offer is refused", a.status === 400 && /Leads offers none or view/.test(a.json?.error ?? ""), show(a));

/* ---------------------------------------------------------------------------- */
console.log("\n5. newcomers held back");
a = await post("/api/v1/team/settings", owner, { newcomers: "nothing" });
check("the owner says newcomers wait for the owner", a.status === 200 && a.json?.newcomers === "nothing", show(a));
const newcomer = people.rememberGoogle("newcomer@desk.test", "Specimen Newcomer");
me = await meOf(newcomer);
check("a newcomer is told who they are, with nowhere to go", me?.access?.home === null && Object.values(me.access.pages).every((l) => l === "none"), JSON.stringify(me?.access?.home));
a = await ask("/api/v1/system", { who: newcomer });
check("and nothing else answers them", refused(a, /not given you access to anything/), show(a));
a = await ask("/api/v1/team/members", { who: owner });
check("the owner sees them as waiting", a.json?.members?.find((m: any) => m.id === newcomer.telegram)?.status === "waiting", show(a));
a = await post(`/api/v1/team/access/${newcomer.telegram}`, owner, { preset: "administrator" });
check("one template later they have every area, as no row", a.status === 200 && a.json?.person?.restricted === false && (await meOf(newcomer)).access.home === "/", show(a));
await post("/api/v1/team/settings", owner, { newcomers: "full" });

/* ---------------------------------------------------------------------------- */
console.log("\n6. invitations");
a = await post("/api/v1/team/invitations", owner, { name: "Specimen Outsider", email: "someone@elsewhere.test", preset: "viewer" });
check("an address outside the domain is refused: it could never sign in", a.status === 400 && /Only @desk\.test/.test(a.json?.error ?? ""), show(a));
a = await post("/api/v1/team/invitations", owner, { name: "Specimen Member", email: "member@desk.test", preset: "viewer" });
check("somebody already on the team is not invited twice", a.status === 409, show(a));
a = await post("/api/v1/team/invitations", owner, { name: "Specimen Invitee", email: "invitee@desk.test", preset: "content-editor" });
check("the owner invites somebody as Content Editor", a.status === 200 && a.json?.invitation?.role?.key === "content-editor" && a.json.invitation.joinedAt === null, show(a));
const invitedId = a.json?.invitation?.id as number;
a = await ask("/api/v1/team/members", { who: owner });
check("they are on the team as invited", a.json?.members?.find((m: any) => m.id === invitedId)?.status === "invited", show(a));
const invitee = people.rememberGoogle("invitee@desk.test", "Specimen Invitee (Google)");
check("their first sign-in finds the invitation's row", invitee.telegram === invitedId && people.getPerson(invitedId)?.name === "Specimen Invitee (Google)");
me = await meOf(invitee);
check("with the access the owner chose", me.access.pages.insights === "edit" && me.access.pages.leads === "none" && me.canPublish === true);
db.prepare("INSERT INTO events (what, detail) VALUES ('auth.in', ?)").run(JSON.stringify({ email: "invitee@desk.test" }));
a = await post(`/api/v1/team/invitations/${invitedId}/withdraw`, owner);
check("a used invitation cannot be withdrawn", a.status === 409, show(a));
a = await post("/api/v1/team/invitations", owner, { name: "Specimen Never", email: "never@desk.test", preset: "viewer" });
const neverId = a.json?.invitation?.id as number;
a = await post(`/api/v1/team/invitations/${neverId}/withdraw`, owner);
check("an unused one can, and the row goes", a.status === 200 && people.getPerson(neverId) === null, show(a));
a = await post("/api/v1/team/invitations", member, { name: "Specimen Sneaky", email: "sneaky@desk.test", preset: "administrator" });
check("a member cannot invite anybody", a.status === 403, show(a));

/* An invitation that became a person, or that carries a switch-off, is not something to withdraw. */
a = await post("/api/v1/team/invitations", owner, { name: "Specimen Linked", email: "linked@desk.test", preset: "content-editor" });
const linkedInvite = a.json?.invitation?.id as number;
people.remember(535353, "Specimen Linked on Telegram");
a = await post(`/api/v1/settings/people/${linkedInvite}/link`, owner, { telegram: 535353 });
const linkedGrants = stored(535353)?.grants;
const withdrawn = () => (db.prepare("SELECT COUNT(*) AS n FROM events WHERE what = 'person.withdrawn'").get() as { n: number }).n;
const [eventsBefore, actionsThen] = [withdrawn(), actionCount()];
b = await post("/api/v1/team/invitations/535353/withdraw", owner);
check(
  "an invitation linked to a Telegram account is a person: withdrawing it is refused, and nothing says it went",
  a.status === 200 && b.status === 409 && /Access & Roles/.test(b.json?.error ?? "") && linkedGrants !== null && stored(535353)?.grants === linkedGrants && withdrawn() === eventsBefore && actionCount() === actionsThen,
  `${show(a)} | ${show(b)}`,
);
a = await ask("/api/v1/team/invitations", { who: owner });
check("the list says it is linked", a.json?.invitations?.find((i: any) => i.id === 535353)?.linked === true && a.json.invitations.find((i: any) => i.id === invitedId)?.linked === false, show(a));
a = await post("/api/v1/team/invitations", owner, { name: "Specimen Parked", email: "parked@desk.test", preset: "viewer" });
const invitedOff = a.json?.invitation?.id as number;
await post(`/api/v1/settings/people/${invitedOff}/access`, owner, { on: false });
a = await post(`/api/v1/team/invitations/${invitedOff}/withdraw`, owner);
b = await ask("/api/v1/team/invitations", { who: owner });
check(
  "an invitation the owner switched off stays: withdrawing it would let the address in as a newcomer",
  a.status === 409 && /switched off/.test(a.json?.error ?? "") && stored(invitedOff)?.revoked === 1 && b.json?.invitations?.find((i: any) => i.id === invitedOff)?.revoked === true,
  show(a),
);
const taken = people.rememberGoogle("taken@desk.test", "Specimen Taken");
await post(`/api/v1/settings/people/${taken.telegram}`, owner, { email: "taken-other@desk.test", detach: true });
a = await post("/api/v1/team/invitations", owner, { name: "Specimen Second", email: "taken@desk.test", preset: "viewer" });
check(
  "inviting an address whose place another person still sits in is refused in words, naming them and saying how the address arrives",
  a.status === 409 &&
    /taken@desk\.test was Specimen Taken's address until it was changed/.test(a.json?.error ?? "") &&
    /arrives as a new person, with what a newcomer gets/.test(a.json?.error ?? "") &&
    !/UNIQUE/i.test(a.text) &&
    stored(taken.telegram)?.email === "taken-other@desk.test",
  show(a),
);
const emptied = people.rememberGoogle("emptied@desk.test", "Specimen Emptied");
await post(`/api/v1/settings/people/${emptied.telegram}`, owner, { email: null, detach: true });
a = await post("/api/v1/team/invitations", owner, { name: "Specimen Second", email: "emptied@desk.test", preset: "viewer" });
check(
  "and one whose address was removed, whose row the address would sign in to",
  a.status === 409 && /Specimen Emptied already holds the row emptied@desk\.test signs in to/.test(a.json?.error ?? "") && !/UNIQUE/i.test(a.text) && stored(emptied.telegram)?.email === null,
  show(a),
);

/* ---------------------------------------------------------------------------- */
console.log("\n7. activity");
a = await ask("/api/v1/seo/technical", { who: member });
await post("/api/v1/team/beat", member, { href: "/seo/technical", kind: "open" });
await post("/api/v1/team/beat", member, { href: "/seo/technical", kind: "beat" });
await post("/api/v1/team/beat", member, { href: "/seo/technical", kind: "beat" });
const before = (db.prepare("SELECT COUNT(*) AS n FROM team_actions").get() as { n: number }).n;
await post("/api/v1/insights/create", member, { url: "https://example.test/refused" });
check("a refused change is not an action", (db.prepare("SELECT COUNT(*) AS n FROM team_actions").get() as { n: number }).n === before);
a = await ask(`/api/v1/team/activity?member=${member.telegram}`, { who: owner });
const act = a.json;
check("the owner reads the team's activity", a.status === 200 && act?.range === "7d" && Array.isArray(act.timeline), show(a));
check("the member is online, on SEO › Technical", act?.now?.some((n: any) => n.id === member.telegram && n.place?.label === "SEO › Technical" && n.place.href === "/seo/technical"), JSON.stringify(act?.now));
check("their refresh is in the timeline, said from its address", act?.timeline?.some((e: any) => e.who.id === member.telegram && e.kind === "action" && e.type === "refresh" && e.text === "Ran “Specimen job of the team check” ahead of its schedule"), JSON.stringify(act?.timeline?.slice(0, 3)));
check(
  "two beats inside one minute are one minute, and the screen they opened is counted",
  act?.person?.totalMinutes === 1 && act.person.pages.some((p: any) => p.key === "seo/technical" && p.minutes === 1 && p.opens >= 1),
  JSON.stringify(act?.person?.pages),
);
check("filtered to them, nobody else's events", act?.timeline?.every((e: any) => e.who.id === member.telegram));
/* A minute later by the desk's clock, which stays moved forward for the rest of the run. */
const clock = Date.now;
Date.now = () => clock() + 61_000;
await post("/api/v1/team/beat", member, { href: "/seo/technical", kind: "beat" });
a = await ask(`/api/v1/team/activity?member=${member.telegram}`, { who: owner });
check(
  "a minute later the next beat is the second minute",
  a.json?.person?.totalMinutes === 2 && a.json.person.pages.some((p: any) => p.key === "seo/technical" && p.minutes === 2),
  JSON.stringify(a.json?.person?.pages),
);
/* Another minute on, so that only the refusal stands between this beat and a third minute. */
Date.now = () => clock() + 122_000;
await post("/api/v1/team/beat", member, { href: "/leads", kind: "beat" });
a = await ask(`/api/v1/team/activity?member=${member.telegram}`, { who: owner });
check("a beat from a page that refused them moves them nowhere and counts no minute", a.json?.now?.find((n: any) => n.id === member.telegram)?.place?.href === "/seo/technical" && a.json?.person?.totalMinutes === 2, JSON.stringify(a.json?.now?.find((n: any) => n.id === member.telegram)));
check("a page the gate refused them is not a page they opened", !act?.person?.pages?.some((p: any) => p.key === "leads" || p.key === "team/access"), JSON.stringify(act?.person?.pages?.map((p: any) => p.key)));
a = await ask("/api/v1/team/activity", { who: owner });
check(
  "the owner's own change is said in the route's own words",
  a.json?.timeline?.some((e: any) => e.who.id === owner.telegram && e.text.startsWith("Gave Specimen Member the Analyst template")),
  JSON.stringify(a.json?.timeline?.filter((e: any) => e.who.id === owner.telegram).slice(0, 2)),
);
check("actions are counted, with active now", a.json?.tiles?.actions?.state === "ok" && a.json.tiles.actions.value.value > 0 && a.json.tiles.activeNow.value >= 1, JSON.stringify(a.json?.tiles?.activeNow));
check("by member and by type", a.json?.byMember?.some((m: any) => m.id === member.telegram) && a.json?.byType?.length > 0);
a = await ask("/api/v1/activity?limit=100", { who: member });
check(
  "access changes and invitations stay out of the desk's feed, which the whole team reads",
  Array.isArray(a.json) && !a.json.some((n: any) => /template|invited|invitation|newcomer/i.test(n.text)),
  JSON.stringify(a.json?.filter((n: any) => /template|invited|invitation|newcomer/i.test(n.text)).slice(0, 2)),
);
a = await ask("/api/v1/team/activity?type=team", { who: owner });
check("a type filter keeps only that type", a.json?.timeline?.length > 0 && a.json.timeline.every((e: any) => e.type === "team"), show(a));

/* The record holds what happened: one act is one event, and a request that changed nothing is none. */
const lastAction = (): number => (db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM team_actions").get() as { n: number }).n;
const writtenAfter = (id: number) => db.prepare("SELECT person, path, text, href FROM team_actions WHERE id > ? ORDER BY id").all(id) as { person: number; path: string; text: string; href: string | null }[];
const activityOf = async (who: Person, range = "7d") => (await ask(`/api/v1/team/activity?range=${range}&member=${who.telegram}`, { who: owner })).json;
let was = await activityOf(invitee);
let mark = lastAction();
a = await post("/api/v1/insights/create", invitee, { url: "https://example.test/created", format: "standard" });
let wrote = writtenAfter(mark);
check(
  "an insight made on the desk is one action, which names the page and opens it",
  a.status === 201 && wrote.length === 1 && /Article created about search/.test(wrote[0]!.text) && wrote[0]!.href === a.json?.href,
  `${show(a)} ${JSON.stringify(wrote)}`,
);
let is = await activityOf(invitee);
check(
  "and one event for the owner, not a second one as a link shared with the bot",
  is?.timeline?.filter((e: any) => e.href === a.json?.href || /Article created about search/.test(e.text)).length === 1 && !is.timeline.some((e: any) => e.kind === "shared") && is.tiles.actions.value.value === was.tiles.actions.value.value + 1 && is.person.actions === was.person.actions + 1,
  JSON.stringify({ timeline: is?.timeline?.map((e: any) => `${e.kind}: ${e.text}`), tile: [was?.tiles?.actions?.value?.value, is?.tiles?.actions?.value?.value], person: [was?.person?.actions, is?.person?.actions] }),
);
mark = lastAction();
b = await post("/api/v1/insights/create", invitee, { url: "https://example.test/created", format: "standard" });
check("the same link again is accepted, and is no action", b.status === 200 && b.json?.already === true && writtenAfter(mark).length === 0, `${show(b)} ${JSON.stringify(writtenAfter(mark))}`);
db.prepare("INSERT INTO links (url, title, site, state, from_user, from_chat) VALUES (?, ?, ?, 'queued', ?, ?)").run("https://example.test/shared", "Specimen shared page", "example.test", invitee.telegram, 727272);
is = await activityOf(invitee);
check(
  "a link that came through a chat is their one shared link",
  is?.timeline?.filter((e: any) => e.kind === "shared").length === 1 && is.timeline.some((e: any) => e.kind === "shared" && e.text === "Shared “Specimen shared page” with the bot"),
  JSON.stringify(is?.timeline?.filter((e: any) => e.kind === "shared")),
);
const seenAt = new Date().toISOString();
db.prepare(
  `INSERT INTO cc_seo_opps (id, type, page, title, evidence, priority, priority_why, action, state, first_seen, last_seen)
   VALUES (?, 'not-indexed', ?, 'Specimen page is not indexed', '[]', 'medium', 'specimen', ?, 'open', ?, ?)`,
).run("not-indexed:/specimen-not-indexed", "/specimen-not-indexed", JSON.stringify({ kind: "manual", label: "Request indexing", step: "specimen" }), seenAt, seenAt);
mark = lastAction();
got = [
  await post("/api/v1/seo/opportunities/act", member, { ids: ["specimen-none-1", "specimen-none-2"] }),
  await send("/draft/999/publish", invitee),
  await post("/api/v1/seo/indexing/requested", member, { path: "/specimen-not-indexed", submitted: false }),
];
check(
  "accepted with nothing done is not written down: a bulk action that did no row, a publish of no draft (404), a mark taken back that was never set",
  got.map((x) => x.status).join() === "200,404,200" && writtenAfter(mark).length === 0,
  `${got.map((x) => x.status).join()} ${JSON.stringify(writtenAfter(mark))}`,
);
await post("/api/v1/seo/indexing/requested", member, { path: "/specimen-not-indexed", submitted: true });
mark = lastAction();
a = await post("/api/v1/seo/indexing/requested", member, { path: "/specimen-not-indexed", submitted: false });
wrote = writtenAfter(mark);
check(
  "taking a real mark back is one action, said as what it was",
  a.status === 200 && wrote.length === 1 && wrote[0]!.text === "Took back the Request-indexing mark: /specimen-not-indexed",
  `${show(a)} ${JSON.stringify(wrote)}`,
);
was = await activityOf(invitee);
db.prepare("INSERT INTO cc_commits (sha, at, author, subject, files, seen) VALUES (?, ?, ?, ?, 1, ?)").run("5bec1men00000000000000000000000000000000", new Date().toISOString(), "Specimen Invitee (Google)", "Publish a specimen article", new Date().toISOString());
is = await activityOf(invitee);
check(
  "a deployment under their name is in the timeline, and is not counted again as an action",
  is?.timeline?.some((e: any) => e.kind === "deploy") && is.tiles.actions.value.value === was.tiles.actions.value.value && is.person.actions === was.person.actions && !is.byType.some((t: any) => t.key === "deploy"),
  JSON.stringify({ deploys: is?.timeline?.filter((e: any) => e.kind === "deploy").length, tile: [was?.tiles?.actions?.value?.value, is?.tiles?.actions?.value?.value] }),
);

/* Saving access records what really changed, and the enquiry right is announced when it starts to apply. */
const accessNow = (await ask("/api/v1/team/access", { who: owner })).json;
const memberForm = editorForm(accessNow, member.telegram);
mark = lastAction();
got = [
  await post(`/api/v1/team/access/${seoAnalyst.telegram}`, owner, { preset: "seo-analyst" }),
  await post(`/api/v1/team/access/${member.telegram}`, owner, memberForm),
  await post(`/api/v1/team/access/${member.telegram}`, owner, { seesLeads: stored(member.telegram)?.sees_leads === 1 }),
  await post("/api/v1/team/settings", owner, { newcomers: accessNow?.newcomers }),
];
check(
  "a save that changes nothing says so and is no action: the template they have, the whole form unaltered, the same enquiry right, the same rule for newcomers",
  got.every((x) => x.status === 200 && x.json?.said === "Nothing had changed.") && writtenAfter(mark).length === 0,
  `${got.map((x) => `${x.status} ${x.json?.said}`).join(" | ")} ${JSON.stringify(writtenAfter(mark))}`,
);
const memberGrants = stored(member.telegram)?.grants;
a = await post(`/api/v1/team/access/${member.telegram}`, owner, { ...memberForm, seesLeads: !memberForm.seesLeads });
wrote = writtenAfter(mark);
check(
  "the whole form with only the enquiry box changed is one action, and it names the enquiry right",
  a.status === 200 && wrote.length === 1 && /enquir/.test(wrote[0]!.text) && stored(member.telegram)?.grants === memberGrants && stored(member.telegram)?.sees_leads === (memberForm.seesLeads ? 0 : 1),
  `${show(a)} ${JSON.stringify(wrote)}`,
);
await post(`/api/v1/team/access/${member.telegram}`, owner, memberForm);
const inFeed = async (text: string): Promise<boolean> => (((await ask("/api/v1/activity?limit=100", { who: owner })).json ?? []) as any[]).some((n) => n.text === text);
const enquirer = people.rememberGoogle("enquiries@desk.test", "Specimen Enquirer");
await post(`/api/v1/team/access/${enquirer.telegram}`, owner, { preset: "analyst" });
a = await post(`/api/v1/settings/people/${enquirer.telegram}`, owner, { seesLeads: true });
check(
  "the enquiry right given in Settings to somebody without Leads is said to wait, and is not announced",
  a.status === 200 && /once they also have Leads/.test(a.json?.said ?? "") && a.json.person.seesLeads === false && a.json.person.leadsGranted === true && !(await inFeed("Specimen Enquirer may now see enquiries")),
  show(a),
);
await post(`/api/v1/team/access/${enquirer.telegram}`, owner, { set: { leads: "view" } });
check("it is announced when Leads is given and it starts to apply", (await inFeed("Specimen Enquirer may now see enquiries")) && (await meOf(enquirer)).seesLeads === true);
await post(`/api/v1/team/access/${enquirer.telegram}`, owner, { set: { leads: "none" } });
check("and again when Leads is taken away and it stops", (await inFeed("Specimen Enquirer no longer sees enquiries")) && (await meOf(enquirer)).seesLeads === false);
const withLeads = people.rememberGoogle("with-leads@desk.test", "Specimen With Leads");
await post(`/api/v1/team/access/${withLeads.telegram}`, owner, { grants: { leads: "view" } });
a = await post(`/api/v1/settings/people/${withLeads.telegram}`, owner, { seesLeads: true });
check("with Leads given first, Settings says what it always said", a.json?.said === "They may now see enquiries." && a.json.person.seesLeads === true && (await inFeed("Specimen With Leads may now see enquiries")), show(a));
a = await post(`/api/v1/settings/people/${withLeads.telegram}/access`, owner, { on: false });
check("and a switch-off, which stops it, says that too", a.status === 200 && a.json?.person?.seesLeads === false && (await inFeed("Specimen With Leads no longer sees enquiries")), show(a));
await post(`/api/v1/settings/people/${withLeads.telegram}/access`, owner, { on: true });

/* A person's totals are the days their chart draws; a tile compares only with a period the desk recorded. */
const daysPerson = people.rememberGoogle("days@desk.test", "Specimen Days");
const nine = presence.zurichDays(Date.now(), 9);
const dayRow = db.prepare("INSERT INTO team_days (person, day, first, last, requests, minutes, pages) VALUES (?, ?, ?, ?, 1, ?, '{}')");
for (const [back, minutes] of [[0, 10], [1, 20], [7, 40], [8, 80]] as const) dayRow.run(daysPerson.telegram, nine[8 - back] ?? "", `${nine[8 - back]}T00:10:00.000Z`, `${nine[8 - back]}T00:20:00.000Z`, minutes);
for (const [range, sum] of [["24h", 10], ["7d", 30]] as const) {
  const read = await activityOf(daysPerson, range);
  const bars = (read?.person?.minutes ?? []).reduce((s: number, d: any) => s + d.value, 0);
  check(
    `${range}: the minutes above a person's chart are the sum of its bars, and so is their line by member`,
    bars === sum && read.person.totalMinutes === bars && read.person.daysActive <= read.person.minutes.length && read.byMember.find((m: any) => m.id === daysPerson.telegram)?.minutes === bars,
    JSON.stringify({ bars, total: read?.person?.totalMinutes, days: read?.person?.daysActive, of: read?.person?.minutes?.length, byMember: read?.byMember?.find((m: any) => m.id === daysPerson.telegram)?.minutes }),
  );
}
const calendar = ["2026-10-25T22:30:00Z", "2026-03-29T22:30:00Z"].map((at) => presence.zurichDays(Date.parse(at), 7));
check(
  "the days of a chart are seven calendar days in a row across both clock changes",
  calendar.every((days) => days.length === 7 && days.every((d, i) => i === 0 || Date.parse(d) - Date.parse(days[i - 1]!) === 86_400_000)) && calendar[0]!.at(-1) === "2026-10-25" && calendar[1]!.at(-1) === "2026-03-30",
  JSON.stringify(calendar),
);
a = await ask("/api/v1/team/activity?range=7d", { who: owner });
check(
  "a tile has nothing to compare with while the desk did not record the whole period before, and says since when",
  a.json?.tiles?.actions?.value?.previous === null && a.json.tiles.content.value.previous === null && /Kept since/.test(a.json.tiles.actions.note ?? "") && /Kept since/.test(a.json.tiles.content.note ?? ""),
  JSON.stringify([a.json?.tiles?.actions?.value?.previous, a.json?.tiles?.content?.value?.previous, a.json?.tiles?.actions?.note]),
);
dayRow.run(daysPerson.telegram, presence.zurichDays(Date.now(), 16)[0] ?? "", new Date(Date.now() - 15 * 86_400_000).toISOString(), new Date(Date.now() - 15 * 86_400_000).toISOString(), 0);
a = await ask("/api/v1/team/activity?range=7d", { who: owner });
check(
  "once the record reaches back past it, the period before is a figure, a true zero included",
  typeof a.json?.tiles?.actions?.value?.previous === "number" && a.json.tiles.content.value.previous === 0 && a.json.tiles.actions.note === undefined,
  JSON.stringify([a.json?.tiles?.actions?.value?.previous, a.json?.tiles?.content?.value?.previous, a.json?.tiles?.actions?.note]),
);
a = await ask("/api/v1/team/activity?range=constructor", { who: owner });
check("a range that is no range is the default, not an error", a.status === 200 && a.json?.range === "7d", show(a));

/* The record is pruned, and one bad row does not hold the rest back. */
const longAgo = new Date(Date.now() - 500 * 86_400_000);
const oldDay = presence.zurichDay(longAgo.getTime());
dayRow.run(daysPerson.telegram, oldDay, longAgo.toISOString(), longAgo.toISOString(), 5);
db.prepare("INSERT INTO team_actions (at, person, area, page, method, path, status, text, href) VALUES (?, ?, 'insights', NULL, 'POST', '/api/v1/insights/create', 201, 'A specimen action from long ago', NULL)").run(longAgo.toISOString(), daysPerson.telegram);
people.remember(656565, "Specimen Long Ago");
dayRow.run(656565, oldDay, longAgo.toISOString(), longAgo.toISOString(), 5);
const daysOf = (id: number): string[] => (db.prepare("SELECT day FROM team_days WHERE person = ? ORDER BY day").all(id) as { day: string }[]).map((r) => r.day);
const oldActions = (): number => (db.prepare("SELECT COUNT(*) AS n FROM team_actions WHERE text = 'A specimen action from long ago'").get() as { n: number }).n;
const keptBefore = daysOf(daysPerson.telegram).length;
presence.prune();
a = await ask("/api/v1/team/members", { who: owner });
listed = a.json?.members?.find((m: any) => m.id === 656565);
check(
  "what is older than 400 days goes, except a person's newest day: somebody last here long ago is still known to have been",
  oldActions() === 0 && !daysOf(daysPerson.telegram).includes(oldDay) && daysOf(daysPerson.telegram).length === keptBefore - 1 && daysOf(656565).join() === oldDay && listed?.status === "away" && typeof listed.lastActive === "string",
  JSON.stringify({ oldActions: oldActions(), days: daysOf(daysPerson.telegram), longAgo: daysOf(656565), listed: listed && { status: listed.status, lastActive: listed.lastActive } }),
);
/* A day row somebody edited by hand, for a person with something pending; then somebody the desk meets after them. */
db.prepare("UPDATE team_days SET pages = 'null' WHERE person = ? AND day IN (?, ?)").run(daysPerson.telegram, nine[8] ?? "", nine[7] ?? "");
await ask("/api/v1/traffic", { who: daysPerson });
const late = people.rememberGoogle("late@desk.test", "Specimen Late");
await ask("/api/v1/traffic", { who: late });
a = await ask(`/api/v1/team/activity?member=${daysPerson.telegram}`, { who: owner });
check(
  "a day row that is not a list of pages costs its own figures only: the owner still reads that person, and the next person's requests are still written",
  a.status === 200 && a.json?.person?.id === daysPerson.telegram && daysOf(late.telegram).length === 1,
  `${show(a)} late: ${daysOf(late.telegram).join()}`,
);

/* ---------------------------------------------------------------------------- */
console.log("\n8. linking carries access and activity");
const tg = people.remember(424242, "Specimen Member on Telegram");
const grantsBefore = JSON.stringify(people.getPerson(member.telegram)?.grants);
const actionsBefore = (db.prepare("SELECT COUNT(*) AS n FROM team_actions WHERE person = ?").get(member.telegram) as { n: number }).n;
check("the link is made", people.link(tg.telegram, "member@desk.test"));
member = people.getPerson(tg.telegram)!;
check("the Telegram row now carries the member's access", JSON.stringify(member.grants) === grantsBefore, `${JSON.stringify(member.grants)} vs ${grantsBefore}`);
const actionsAfter = (db.prepare("SELECT COUNT(*) AS n FROM team_actions WHERE person = ?").get(tg.telegram) as { n: number }).n;
check("and their actions", actionsBefore > 0 && actionsAfter === actionsBefore, `${actionsBefore} → ${actionsAfter}`);

/* ---------------------------------------------------------------------------- */
console.log("\n9. an address change is no way round a restriction");
const held = people.rememberGoogle("held@desk.test", "Specimen Held");
await post(`/api/v1/team/access/${held.telegram}`, owner, { preset: "viewer" });
await post(`/api/v1/settings/people/${held.telegram}`, owner, { seesLeads: true });
let heldRow = JSON.stringify(stored(held.telegram));
a = await post(`/api/v1/settings/people/${held.telegram}`, owner, { email: "held-other@desk.test", detach: true });
b = await post(`/api/v1/settings/people/${held.telegram}`, owner, { email: null, detach: true });
check(
  "Settings refuses to change or remove a restricted person's address, and writes nothing",
  a.status === 409 && /access is limited/.test(a.json?.error ?? "") && b.status === 409 && JSON.stringify(stored(held.telegram)) === heldRow,
  `${show(a)} | ${show(b)}`,
);
check("Settings says the address is held", (await ask("/api/v1/settings", { who: owner })).json?.people?.value?.people?.find((p: any) => p.id === held.telegram)?.restricted === true);
a = await send(`/people/${held.telegram}`, owner, { email: "held-other@desk.test", author: "balkaris" });
check("the old people form refuses it too, in words", a.status === 409 && /access is limited/.test(a.text) && JSON.stringify(stored(held.telegram)) === heldRow, show(a));
const offPerson = people.rememberGoogle("off@desk.test", "Specimen Off");
await post(`/api/v1/settings/people/${offPerson.telegram}/access`, owner, { on: false });
a = await send(`/people/${offPerson.telegram}`, owner, { email: "off-other@desk.test", author: "balkaris" });
check("and for a switched-off person", a.status === 409 && /switched off/.test(a.text) && stored(offPerson.telegram)?.email === "off@desk.test", show(a));
a = await send(`/people/${held.telegram}`, owner, { email: "held@desk.test", author: "specimen" });
check(
  "the same address with a new byline is still saved by the old form",
  a.status === 303 && stored(held.telegram)?.author === "specimen" && stored(held.telegram)?.email === "held@desk.test",
  `${show(a)} ${JSON.stringify(stored(held.telegram))}`,
);

/* The state the two refusals keep out, forced: the address already changed, the restriction given afterwards.
   The row belongs to the address the owner gave it, and NEITHER address is a way round what the owner decided:
   first the former one signs in, then the present one, which is the order that used to free it. */
const rowsNamed = (name: string): number => (db.prepare("SELECT COUNT(*) AS n FROM people WHERE name = ?").get(name) as { n: number }).n;
people.setEmail(held.telegram, "held-other@desk.test");
heldRow = JSON.stringify(stored(held.telegram));
a = await post("/api/v1/team/invitations", owner, { name: "Specimen Held Again", email: "held@desk.test", preset: "administrator" });
check(
  "an invitation is no way to hand the former address a template: refused, saying it would arrive with nothing",
  a.status === 409 && /held@desk\.test was Specimen Held's address until it was changed/.test(a.json?.error ?? "") && /with nothing, because a row that had this address is restricted/.test(a.json?.error ?? "") && rowsNamed("Specimen Held Again") === 0,
  show(a),
);
const former = people.rememberGoogle("held@desk.test", "Specimen Held");
check(
  "signing in with the former address leaves the restricted row exactly as stored, address and byline included, and arrives beside it with nothing",
  former.telegram !== held.telegram &&
    JSON.stringify(stored(held.telegram)) === heldRow &&
    stored(held.telegram)?.email === "held-other@desk.test" &&
    stored(held.telegram)?.author === "specimen" &&
    stored(former.telegram)?.grants === "{}" &&
    stored(former.telegram)?.revoked === 0 &&
    stored(former.telegram)?.sees_leads === 0,
  `${JSON.stringify(stored(held.telegram))} | ${JSON.stringify(stored(former.telegram))}`,
);
me = await meOf(former);
a = await ask("/api/v1/system", { who: former });
b = await ask("/api/v1/team/members", { who: owner });
check(
  "they wait for the owner, who sees them as waiting: nowhere to go, and nothing answers",
  me?.access?.home === null && me.canPublish === false && refused(a, /not given you access to anything/) && b.json?.members?.find((m: any) => m.id === former.telegram)?.status === "waiting",
  `${JSON.stringify(me?.access?.home)} ${show(a)}`,
);
let again = people.rememberGoogle("held-other@desk.test", "Specimen Held");
me = await meOf(again);
a = await ask("/api/v1/settings", { who: again });
check(
  "the address the owner gave them finds the same row afterwards, still restricted: no publishing, no Settings",
  again.telegram === held.telegram && JSON.stringify(stored(held.telegram)) === heldRow && me?.access?.restricted === true && me.canPublish === false && a.status === 403,
  `row ${again.telegram}, the restricted one is ${held.telegram}: restricted ${JSON.stringify(me?.access?.restricted)} ${show(a)}`,
);
check("and the former address comes back to its own row, never a third", people.rememberGoogle("held@desk.test", "Specimen Held").telegram === former.telegram && rowsNamed("Specimen Held") === 2, `${rowsNamed("Specimen Held")} rows`);

/* The row made beside the place is read like the place itself: re-addressed in its turn and restricted since, it is passed too. */
const twice = people.rememberGoogle("twice@desk.test", "Specimen Twice");
await post(`/api/v1/settings/people/${twice.telegram}`, owner, { email: "twice-b@desk.test", detach: true });
const beside = people.rememberGoogle("twice@desk.test", "Specimen Twice");
await post(`/api/v1/settings/people/${beside.telegram}`, owner, { email: "twice-c@desk.test", detach: true });
await post(`/api/v1/team/access/${beside.telegram}`, owner, { preset: "viewer" });
const besideRow = JSON.stringify(stored(beside.telegram));
const third = people.rememberGoogle("twice@desk.test", "Specimen Twice");
check(
  "the row made beside a place counts like the place: re-addressed in its turn and restricted since, it is left alone and the address arrives with nothing",
  new Set([twice.telegram, beside.telegram, third.telegram]).size === 3 &&
    stored(third.telegram)?.grants === "{}" &&
    JSON.stringify(stored(beside.telegram)) === besideRow &&
    stored(beside.telegram)?.email === "twice-c@desk.test" &&
    stored(twice.telegram)?.email === "twice-b@desk.test" &&
    stored(twice.telegram)?.grants === null,
  `${JSON.stringify(stored(twice.telegram))} | ${JSON.stringify(stored(beside.telegram))} | ${JSON.stringify(stored(third.telegram))}`,
);
await post(`/api/v1/team/access/${third.telegram}`, owner, { preset: "administrator" });
a = await post(`/api/v1/settings/people/${third.telegram}`, owner, { email: null, detach: true });
b = await post(`/api/v1/settings/people/${third.telegram}/access`, owner, { on: false });
again = people.rememberGoogle("twice@desk.test", "Specimen Twice");
check(
  "and one beside it whose address was removed, switched off since, takes the address back still switched off",
  a.status === 200 && b.status === 200 && again.telegram === third.telegram && stored(third.telegram)?.email === "twice@desk.test" && stored(third.telegram)?.revoked === 1 && (await ask("/api/v1/me", { who: again })).status === 403 && rowsNamed("Specimen Twice") === 3,
  `${show(a)} | ${show(b)} | row ${again.telegram} of ${third.telegram} ${JSON.stringify(stored(third.telegram))}`,
);

/* The same order with a switch-off, through the routes: re-addressed while nothing held it, switched off afterwards. */
const moved = people.rememberGoogle("moved@desk.test", "Specimen Moved");
a = await post(`/api/v1/settings/people/${moved.telegram}`, owner, { email: "moved-other@desk.test", detach: true });
b = await post(`/api/v1/settings/people/${moved.telegram}/access`, owner, { on: false });
const movedRow = JSON.stringify(stored(moved.telegram));
const movedFormer = people.rememberGoogle("moved@desk.test", "Specimen Moved");
const formerMe = await ask("/api/v1/me", { who: movedFormer });
again = people.rememberGoogle("moved-other@desk.test", "Specimen Moved");
const [presentMe, presentTraffic] = [await ask("/api/v1/me", { who: again }), await ask("/api/v1/traffic", { who: again })];
check(
  "switched off stays switched off by both addresses: the former one arrives switched off with nothing, the present one finds the same row",
  a.status === 200 &&
    b.status === 200 &&
    movedFormer.telegram !== moved.telegram &&
    stored(movedFormer.telegram)?.revoked === 1 &&
    stored(movedFormer.telegram)?.grants === "{}" &&
    formerMe.status === 403 &&
    again.telegram === moved.telegram &&
    JSON.stringify(stored(moved.telegram)) === movedRow &&
    stored(moved.telegram)?.revoked === 1 &&
    presentMe.status === 403 &&
    presentTraffic.status === 403,
  `${show(a)} | ${show(b)} | former ${formerMe.status} ${JSON.stringify(stored(movedFormer.telegram))} | present ${presentMe.status} ${presentTraffic.status} ${JSON.stringify(stored(again.telegram))}`,
);
b = await ask("/api/v1/team/members", { who: owner });
const movedListed = (b.json?.members ?? []).filter((m: any) => m.name === "Specimen Moved");
check("the owner's team list shows both as switched off, neither as a member who is in", movedListed.length === 2 && movedListed.every((m: any) => m.status === "off"), JSON.stringify(movedListed.map((m: any) => `${m.email}: ${m.status}`)));

/* A row whose address the owner REMOVED is found by nobody else: the address comes back to it, with what the owner decided. */
const bare = people.rememberGoogle("bare@desk.test", "Specimen Bare");
a = await post(`/api/v1/settings/people/${bare.telegram}`, owner, { email: null, detach: true, seesLeads: true });
await post(`/api/v1/team/access/${bare.telegram}`, owner, { preset: "viewer" });
const bareGrants = stored(bare.telegram)?.grants;
again = people.rememberGoogle("bare@desk.test", "Specimen Bare");
me = await meOf(again);
check(
  "a row whose address was removed gets it back at sign-in, its grants as stored and no enquiry right",
  a.status === 200 &&
    again.telegram === bare.telegram &&
    typeof bareGrants === "string" &&
    stored(bare.telegram)?.grants === bareGrants &&
    stored(bare.telegram)?.email === "bare@desk.test" &&
    stored(bare.telegram)?.sees_leads === 0 &&
    me?.access?.restricted === true &&
    rowsNamed("Specimen Bare") === 1,
  `${show(a)} ${JSON.stringify(stored(bare.telegram))}`,
);
people.setRevoked(bare.telegram, true);
people.setEmail(bare.telegram, null);
again = people.rememberGoogle("bare@desk.test", "Specimen Bare");
a = await ask("/api/v1/me", { who: again });
b = await ask("/api/v1/traffic", { who: again });
check("and switched off stays switched off through the same sign-in", again.telegram === bare.telegram && stored(bare.telegram)?.revoked === 1 && a.status === 403 && b.status === 403, `${show(a)} | ${show(b)}`);

const tgHeld = people.rememberGoogle("tg-held@desk.test", "Specimen Held on Telegram");
await post(`/api/v1/team/access/${tgHeld.telegram}`, owner, { preset: "viewer" });
people.remember(515151, "Specimen Held on Telegram");
check("a restricted person is linked to their Telegram row", people.link(515151, "tg-held@desk.test") && stored(515151)?.grants !== null);
a = await post("/api/v1/settings/people/515151", owner, { email: "tg-held-other@desk.test", detach: true });
again = people.rememberGoogle("tg-held@desk.test", "Specimen Held on Telegram");
check(
  "their address is held as well, so no second, unrestricted row appears when they sign in",
  a.status === 409 && again.telegram === 515151 && (db.prepare("SELECT COUNT(*) AS n FROM people WHERE name = 'Specimen Held on Telegram'").get() as { n: number }).n === 1 && again.grants !== null,
  `${show(a)} id ${again.telegram}`,
);

/* The owner, the other way round: nothing planted at the owner's id restricts or switches off the owner. */
db.prepare("UPDATE people SET email = 'planted@desk.test', grants = '{}', revoked = 1 WHERE telegram = ?").run(owner.telegram);
again = people.rememberGoogle("owner@desk.test", "Specimen Owner");
check(
  "a row planted at the owner's id cannot restrict the owner or switch the owner off",
  again.telegram === owner.telegram && again.owner && !again.revoked && stored(owner.telegram)?.grants === null && stored(owner.telegram)?.revoked === 0,
  JSON.stringify(stored(owner.telegram)),
);

/* Nothing held: Settings' two sentences, both true. The row keeps its byline and rights under the new address,
   and the old address is a new person with what a newcomer gets, which the owner has set to nothing here. */
const free = people.rememberGoogle("free@desk.test", "Specimen Free");
a = await post(`/api/v1/settings/people/${free.telegram}`, owner, { email: "free-other@desk.test", detach: true, byline: "specimen", seesLeads: true });
const freeRow = JSON.stringify(stored(free.telegram));
await post("/api/v1/team/settings", owner, { newcomers: "nothing" });
const arrived = people.rememberGoogle("free@desk.test", "Specimen Free");
check(
  "an unrestricted person whose address the owner changed keeps their row, byline and enquiry right; the old address arrives as a new person, with what a newcomer gets",
  a.status === 200 &&
    /what a newcomer gets/.test(a.json?.said ?? "") &&
    arrived.telegram !== free.telegram &&
    stored(arrived.telegram)?.grants === "{}" &&
    stored(arrived.telegram)?.author === "balkaris" &&
    stored(arrived.telegram)?.sees_leads === 0 &&
    JSON.stringify(stored(free.telegram)) === freeRow &&
    stored(free.telegram)?.email === "free-other@desk.test" &&
    stored(free.telegram)?.author === "specimen" &&
    stored(free.telegram)?.sees_leads === 1 &&
    stored(free.telegram)?.grants === null,
  `${show(a)} ${JSON.stringify(stored(free.telegram))} | ${JSON.stringify(stored(arrived.telegram))}`,
);
/* Re-addressed while unrestricted, given Content Editor since: the former address gets what a newcomer gets, never the row's own access. */
const edited = people.rememberGoogle("edited@desk.test", "Specimen Edited");
await post(`/api/v1/team/access/${edited.telegram}`, owner, { preset: "administrator" });
await post(`/api/v1/settings/people/${edited.telegram}`, owner, { email: "edited-other@desk.test", detach: true });
await post(`/api/v1/team/access/${edited.telegram}`, owner, { preset: "content-editor" });
const editedFormer = people.rememberGoogle("edited@desk.test", "Somebody With The Former Address");
again = people.rememberGoogle("edited-other@desk.test", "Specimen Edited");
me = await meOf(again);
const formerHome = (await meOf(editedFormer))?.access?.home;
check(
  "with newcomers held back, the former address does not come out with the access the row was given since; the present address keeps it",
  editedFormer.telegram !== edited.telegram && stored(editedFormer.telegram)?.grants === "{}" && formerHome === null && again.telegram === edited.telegram && me?.access?.pages?.insights === "edit" && me.name === "Specimen Edited",
  `former ${JSON.stringify(stored(editedFormer.telegram))} home ${JSON.stringify(formerHome)} | present row ${again.telegram} of ${edited.telegram}, Insights ${me?.access?.pages?.insights}`,
);
await post("/api/v1/team/settings", owner, { newcomers: "full" });
const takenFormer = people.rememberGoogle("taken@desk.test", "Specimen Taken");
check(
  "and with nothing held back and nobody restricted, the old address arrives with everything, as a newcomer always did",
  takenFormer.telegram !== taken.telegram && stored(takenFormer.telegram)?.grants === null && stored(takenFormer.telegram)?.revoked === 0 && stored(taken.telegram)?.email === "taken-other@desk.test",
  `${JSON.stringify(stored(takenFormer.telegram))} | ${JSON.stringify(stored(taken.telegram))}`,
);

/* ---------------------------------------------------------------------------- */
console.log("\n10. the feed is the Command Center's, and the bell shows only what a person may open");
/* One row that leads to Traffic, older than everything the routes wrote: the bell must find it behind ten newer rows. */
store.note("traffic", "Specimen note that leads to Traffic", { href: "/traffic", at: new Date(Date.now() - 3_600_000).toISOString() });
/* And real rows from the routes: the enquiry right for somebody, a person switched off. */
await post(`/api/v1/team/access/${newcomer.telegram}`, owner, { seesLeads: true });
const switchedOff = people.rememberGoogle("switched-off@desk.test", "Specimen Switched Off");
await post(`/api/v1/settings/people/${switchedOff.telegram}/access`, owner, { on: false });
const trafficOnly = people.rememberGoogle("traffic-only@desk.test", "Specimen Traffic Only");
await post(`/api/v1/team/access/${trafficOnly.telegram}`, owner, { grants: { traffic: "view" } });
a = await ask("/api/v1/activity", { who: owner });
check(
  "the feed holds the routes' own rows, more than the bell shows",
  Array.isArray(a.json) && a.json.length > 10 && a.json.some((n: any) => n.text === "Specimen Newcomer may now see enquiries") && a.json.some((n: any) => n.text === "Specimen Switched Off was switched off"),
  show(a),
);
a = await ask("/api/v1/activity", { who: trafficOnly });
b = await ask("/api/v1/activity?kinds=people", { who: trafficOnly });
check("somebody given Traffic alone does not read the desk's feed", refused(a, /access to Command Center/) && refused(b, /access to Command Center/), `${show(a)} | ${show(b)}`);
a = await ask("/api/v1/system", { who: trafficOnly });
const leadsNowhere = (n: any): boolean => {
  const page = n.href ? grants.pageOfHref(n.href) : null;
  return !page || grants.pageLevel(people.getPerson(trafficOnly.telegram)!, page.key) === "none";
};
check(
  "their bell holds only rows that lead to a page they may open, found behind the newer ones",
  a.status === 200 && Array.isArray(a.json?.notices) && !a.json.notices.some(leadsNowhere) && a.json.notices.length === 1 && a.json.notices[0].text === "Specimen note that leads to Traffic",
  JSON.stringify(a.json?.notices?.map((n: any) => `${n.text} -> ${n.href ?? "no link"}`)).slice(0, 300),
);
const ownerSystem = (await ask("/api/v1/system", { who: owner })).json;
check("and the light itself is the one everybody sees", a.json?.ok === ownerSystem?.ok && a.json?.line === ownerSystem?.line && a.json?.checked === ownerSystem?.checked, `"${a.json?.line}" vs "${ownerSystem?.line}"`);
a = await ask(`/api/v1/team/activity?member=${trafficOnly.telegram}`, { who: owner });
check(
  "the owner's record does not say they opened the Command Center",
  a.status === 200 && a.json?.person && !a.json.person.pages.some((p: any) => p.key === "overview") && a.json.person.place?.href !== "/",
  JSON.stringify({ pages: a.json?.person?.pages?.map((p: any) => p.key), place: a.json?.person?.place }),
);
const withOverview = people.rememberGoogle("with-overview@desk.test", "Specimen With Overview");
await post(`/api/v1/team/access/${withOverview.telegram}`, owner, { grants: { overview: "view", traffic: "view" } });
const bellOf = async (who: Person) => JSON.stringify((await ask("/api/v1/system", { who })).json?.notices ?? null);
const ownerBell = await bellOf(owner);
check(
  "somebody with the Command Center, and a member with no grants, get the bell the owner gets",
  JSON.parse(ownerBell)?.length === 10 && (await bellOf(withOverview)) === ownerBell && (await bellOf(newcomer)) === ownerBell && people.getPerson(newcomer.telegram)?.grants === null,
  ownerBell.slice(0, 160),
);
a = await ask("/api/v1/system", { who: arrived });
check("a newcomer with nothing is still told nothing", JSON.stringify(people.getPerson(arrived.telegram)?.grants) === "{}" && refused(a, /not given you access to anything/), show(a));

/* ---------------------------------------------------------------------------- */
console.log("\n11. the bot holds a link shared by somebody who may not publish");
const analyst = people.rememberGoogle("analyst@desk.test", "Specimen Analyst");
await post(`/api/v1/team/access/${analyst.telegram}`, owner, { preset: "analyst" });
const developer = people.rememberGoogle("developer@desk.test", "Specimen Developer");
await post(`/api/v1/team/access/${developer.telegram}`, owner, { preset: "developer" });
people.remember(616161, "Specimen Reader on Telegram");
people.setGrants(616161, { insights: "view" });
people.remember(626262, "Specimen Sharer on Telegram");
const publisher = (id: number | null) => people.publisherFor(id === null ? null : people.getPerson(id), people.everyone()) as { by?: Person; held?: Person; nobody?: true };
check(
  "held: Insights to read only, not at all, a restricted row with no address, and somebody switched off",
  [analyst.telegram, developer.telegram, 616161, switchedOff.telegram].every((id) => publisher(id).held?.telegram === id),
  JSON.stringify([analyst.telegram, developer.telegram, 616161, switchedOff.telegram].map((id) => Object.keys(publisher(id))[0])),
);
check(
  "an unrestricted person publishes as themselves; a sharer with no address, or nobody the desk knows, as the owner",
  publisher(plain.telegram).by?.telegram === plain.telegram && publisher(626262).by?.telegram === owner.telegram && publisher(null).by?.telegram === owner.telegram,
  JSON.stringify([plain.telegram, 626262, null].map((id) => publisher(id).by?.name ?? Object.keys(publisher(id))[0])),
);

/* End to end, with automatic publishing on as the live desk runs it: the Analyst's link, written, its cover handed in by the workstation. */
process.env.DESK_AUTOPUBLISH = "1";
const CHAT = 717171;
const heldLink = Number(
  db.prepare("INSERT INTO links (url, title, site, state, from_user, from_chat) VALUES (?, ?, ?, 'drafted', ?, ?)").run("https://example.test/held", "Specimen held page", "example.test", analyst.telegram, CHAT).lastInsertRowid,
);
const heldDraft = Number(
  db
    .prepare("INSERT INTO drafts (link_id, slug, post, template) VALUES (?, 'specimen-held', ?, 'standard')")
    .run(heldLink, JSON.stringify({ title: "Specimen held article", body: ["A specimen."], source: { url: "https://example.test/held", site: "example.test", title: "Specimen", author: null } })).lastInsertRowid,
);
const coverIn = async (): Promise<number> => {
  const job = Number(db.prepare("INSERT INTO jobs (link_id, kind, payload, state) VALUES (?, 'cover', ?, 'running')").run(heldLink, JSON.stringify({ draft: heldDraft })).lastInsertRowid);
  const res = await real(`${BASE}/runner/result/${job}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.DESK_RUNNER_SECRET}` },
    body: JSON.stringify({ ok: true, cover: { draft: heldDraft, slug: "specimen-held", webp: Buffer.from("not a picture").toString("base64"), alt: "A specimen picture.", caption: "A specimen caption." } }),
  });
  return res.status;
};
const autoEvents = (): string[] =>
  (db.prepare("SELECT what FROM events WHERE link_id = ? AND (what LIKE 'auto.%' OR what LIKE 'publish.%' OR what LIKE 'draft.%') ORDER BY id").all(heldLink) as { what: string }[]).map((e) => e.what);
const draftState = () => (db.prepare("SELECT state FROM drafts WHERE id = ?").get(heldDraft) as { state: string }).state;
const handed = await coverIn();
for (let i = 0; i < 200 && !autoEvents().some((w) => w.startsWith("auto.")); i++) await wait(50);
check(
  "the cover of an Analyst's link lands: the piece stays a draft, held, and nothing is published or pushed",
  handed === 200 && draftState() === "draft" && autoEvents().join() === "auto.held",
  `${handed} ${draftState()} [${autoEvents().join(", ")}]`,
);
const toldHeld = () => told.filter((t) => t.chat === CHAT && /waits on the desk as a draft/.test(t.text)).length;
check("and the chat it came from is told so", toldHeld() === 1, JSON.stringify(told.filter((t) => t.chat === CHAT)).slice(0, 200));
await coverIn();
await wait(400);
check("a second cover result holds it again without saying so twice", draftState() === "draft" && autoEvents().join() === "auto.held" && toldHeld() === 1, `[${autoEvents().join(", ")}] told ${toldHeld()}`);
a = await ask(`/api/v1/article/${heldDraft}`, { who: owner });
check(
  "the article's timeline says it in words",
  a.status === 200 && a.json?.history?.some((h: any) => h.kind === "auto.held" && /waits for somebody who may publish/.test(h.text) && /Specimen Analyst/.test(h.detail ?? "")),
  JSON.stringify(a.json?.history?.find((h: any) => h.kind === "auto.held") ?? show(a)),
);
process.env.DESK_AUTOPUBLISH = "0";

/* ---------------------------------------------------------------------------- */
console.log("\n12. a switched-off person's access is shown and kept as stored");
const switchOnOff = (id: number, on: boolean) => post(`/api/v1/settings/people/${id}/access`, owner, { on });
const custom = people.rememberGoogle("custom@desk.test", "Specimen Custom");
await post(`/api/v1/team/access/${custom.telegram}`, owner, { grants: { overview: "view", seo: "edit", "page:seo/keywords": "none", insights: "edit", team: "view" } });
const customStored = stored(custom.telegram)?.grants;
const customPages = JSON.stringify((await meOf(custom)).access.pages);
await switchOnOff(custom.telegram, false);
let matrix = (await ask("/api/v1/team/access", { who: owner })).json;
listed = matrix?.people?.find((p: any) => p.id === custom.telegram);
check(
  "switched off, the access editor is still given what is stored, and says they are off",
  listed?.areas?.insights === "edit" && listed.areas.traffic === "none" && listed.pages["seo/keywords"] === "none" && listed.pages["seo/technical"] === "edit" && listed.role.key === "custom" && listed.revoked === true && listed.canPublish === false,
  JSON.stringify({ role: listed?.role, insights: listed?.areas?.insights, keywords: listed?.pages?.["seo/keywords"], revoked: listed?.revoked }),
);
a = await post(`/api/v1/team/access/${custom.telegram}`, owner, editorForm(matrix, custom.telegram));
check("saving the editor's own form back leaves the stored access exactly as it was", a.status === 200 && customStored !== null && stored(custom.telegram)?.grants === customStored, `${show(a)} ${stored(custom.telegram)?.grants}`);
a = await ask("/api/v1/traffic", { who: custom });
await switchOnOff(custom.telegram, true);
check("they stay off meanwhile, and come back with what they had", a.status === 403 && JSON.stringify((await meOf(custom)).access.pages) === customPages, show(a));
const noRow = people.rememberGoogle("no-row@desk.test", "Specimen No Row");
await switchOnOff(noRow.telegram, false);
matrix = (await ask("/api/v1/team/access", { who: owner })).json;
a = await post(`/api/v1/team/access/${noRow.telegram}`, owner, editorForm(matrix, noRow.telegram));
await switchOnOff(noRow.telegram, true);
check(
  "the same for somebody with no row: every area stays theirs",
  a.status === 200 && a.json?.person?.restricted === false && stored(noRow.telegram)?.grants === null && (await meOf(noRow)).access.restricted === false,
  `${show(a)} ${stored(noRow.telegram)?.grants}`,
);
a = await post("/api/v1/team/invitations", owner, { name: "Specimen Off Analyst", email: "off-analyst@desk.test", preset: "analyst" });
const offAnalyst = a.json?.invitation?.id as number;
await switchOnOff(offAnalyst, false);
a = await ask("/api/v1/team/members", { who: owner });
b = await ask("/api/v1/team/invitations", { who: owner });
listed = a.json?.members?.find((m: any) => m.id === offAnalyst);
check(
  "a switched-off Analyst is still called an Analyst, on the team list and among the invitations",
  listed?.role?.key === "analyst" && listed.status === "off" && b.json?.invitations?.find((i: any) => i.id === offAnalyst)?.role?.key === "analyst",
  `${JSON.stringify(listed?.role)} ${listed?.status} ${JSON.stringify(b.json?.invitations?.find((i: any) => i.id === offAnalyst)?.role)}`,
);

/* ---------------------------------------------------------------------------- */
console.log("\n13. Members calls a row Telegram-only only while it has no address");
people.remember(646464, "Specimen Telegram Only");
const teamAs = async (who: Person) => (await ask("/api/v1/team/members", { who })).json;
const inRole = (team: any, key: string): number => team?.roles?.find((r: any) => r.key === key)?.count ?? 0;
let team = await teamAs(owner);
const [totalThen, adminsThen, viewersThen] = [team?.counts?.total as number, inRole(team, "administrator"), inRole(team, "viewer")];
check(
  "a row the bot made, with no address, is Telegram-only and is left out of the totals",
  team?.members?.find((m: any) => m.id === 646464)?.status === "bot" && team.members.filter((m: any) => m.status !== "bot").length === totalThen,
  JSON.stringify(team?.members?.find((m: any) => m.id === 646464)),
);
a = await post("/api/v1/settings/people/646464", owner, { email: "telegram-only@desk.test" });
team = await teamAs(owner);
listed = team?.members?.find((m: any) => m.id === 646464);
check(
  "given an address it can sign in, so it is a member who has not come in yet: counted, under its role, for the owner and for the team",
  a.status === 200 && listed?.status === "away" && listed.lastActive === null && team.counts.total === totalThen + 1 && inRole(team, "administrator") === adminsThen + 1 && (await teamAs(plain))?.members?.find((m: any) => m.id === 646464)?.status === "away",
  `${show(a)} ${JSON.stringify({ status: listed?.status, total: team?.counts?.total, was: totalThen, admins: inRole(team, "administrator"), were: adminsThen })}`,
);
a = await post("/api/v1/team/access/646464", owner, { preset: "viewer" });
team = await teamAs(owner);
check(
  "and under the template the owner then gives it",
  a.status === 200 && inRole(team, "viewer") === viewersThen + 1 && inRole(team, "administrator") === adminsThen && team.members.find((m: any) => m.id === 646464)?.role?.key === "viewer",
  `${show(a)} viewers ${viewersThen} → ${inRole(team, "viewer")}`,
);

/* ---------------------------------------------------------------------------- */
console.log("\n14. loose ends at the gate");
const outside: [string, Person][] = [
  ["a newcomer with nothing", arrived],
  ["somebody given Traffic alone", trafficOnly],
];
for (const [label, who] of outside) {
  a = await ask("/cover/specimen-article.webp", { who });
  b = await ask("/match?q=specimen", { who });
  check(`${label} is not served a draft's cover, or the matcher: they are Insights'`, a.status === 403 && /access to Insights|not given you access to anything/.test(a.text) && b.status === 403, `${show(a)} | ${b.status}`);
}
a = await ask("/cover/specimen-article.webp", { who: analyst });
b = await ask("/match?q=specimen", { who: analyst });
check("somebody with Insights to read is: 404 for a cover never drawn, and the matcher's answer", a.status === 404 && b.status === 200, `${a.status} | ${show(b)}`);
a = await post("/api/v1/settings/people/1", plain, { byline: "specimen" });
b = await post("/api/v1/insights/create", analyst, { url: "https://example.test/analyst", format: "standard" });
check(
  "a look-only area says who changes it, and an area that has edit still says to ask for it",
  refused(a, /Only the owner changes anything in Settings/) && refused(b, /view Insights but not change it\. Ask the owner for edit access/),
  `${show(a)} | ${show(b)}`,
);

check("nothing tried to leave this machine", left.length === 0, left.slice(0, 4).join(", "));
await finish();
