/**
 * Team: who may see what on the desk, and what they did. End to end against
 * the real server, a throwaway database in work/, nothing leaving this
 * machine and the scheduler's clock off.
 *
 *   npm run check:team
 *
 * What is proved, one line each:
 *    1. somebody with no grants keeps every area, as before access existed;
 *       the owner's Team pages are the owner's alone;
 *    2. a template narrows a person at the server's gate, the API's and the
 *       old console's alike: no area is 403 with its name, a view-only area
 *       refuses a change, publishing goes with Insights' edit, enquiries with
 *       Leads, and the search box stops offering what they cannot open;
 *    3. one page can be set apart from its area (SEO › Keywords);
 *    4. only the owner reads or changes access, and the owner cannot be restricted;
 *    5. a newcomer the owner chose to hold back gets /me and nothing else;
 *    6. an invitation is the row their first sign-in finds, with the access
 *       chosen; only an unused one can be withdrawn; only the domain's
 *       addresses can be invited;
 *    7. what people do is recorded: online, the page they are on, the
 *       screens they open, their minutes, and every change the desk accepted,
 *       in the route's own words when it wrote any; a refused change is not
 *       an action; the owner reads it all, filtered to one person;
 *    8. linking two rows carries the access and the activity across.
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

/* ---- nothing leaves this machine ------------------------------------------- */
const real = globalThis.fetch;
const left: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(BASE)) return real(input as never, init);
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

type Person = ReturnType<typeof people.rememberGoogle>;
interface Answer {
  status: number;
  type: string;
  text: string;
  json: any;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ask(pathname: string, o: { who?: Person | null; method?: string; body?: unknown } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (o.who) headers.cookie = `desk=${seal(o.who.telegram)}`;
  if (o.method && o.method !== "GET") headers.origin = BASE;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await real(BASE + pathname, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), redirect: "manual" });
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
const show = (a: Answer) => `${a.status} ${a.text.slice(0, 120).replace(/\s+/g, " ")}`;
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
db.prepare("INSERT INTO links (url, title, site, state) VALUES (?, ?, ?, 'drafted')").run("https://example.test/specimen", "Specimen source page", "example.test");
db.prepare("INSERT INTO drafts (link_id, slug, post, template) VALUES (1, 'specimen-article', ?, 'standard')").run(
  JSON.stringify({ title: "Specimen article of the team check", body: ["A specimen."], source: { url: "https://example.test/specimen", site: "example.test", title: "Specimen", author: null } }),
);

/* Every collector's job off, and one specimen job that runs harmlessly. */
const theirs = ((await ask("/api/v1/jobs", { who: owner })).json ?? []) as { name: string }[];
for (const j of theirs) await post(`/api/v1/jobs/${j.name}/enabled`, owner, { enabled: false });
scheduler.register({ name: "check-team", title: "Specimen job of the team check", every: 3600, delay: 3600, run: async () => "specimen run, nothing read" });

const meOf = async (who: Person) => (await ask("/api/v1/me", { who })).json;

/* ---------------------------------------------------------------------------- */
console.log("\n1. no grants: everything, as before");
let me = await meOf(member);
check("a member with no grants is not restricted and starts at the Command Center", me?.access?.restricted === false && me.access.home === "/", JSON.stringify(me?.access ?? null).slice(0, 120));
check(
  "every area's page is open to them",
  ["overview", "insights", "traffic", "seo", "seo/keywords", "leads", "settings", "team/members"].every((k) => me.access.pages[k] && me.access.pages[k] !== "none"),
);
check("the owner's Team pages are not", ["team", "team/access", "team/invitations"].every((k) => me.access.pages[k] === "none"));
check("they can still publish, with an address", me.canPublish === true);
let a = await ask("/api/v1/traffic", { who: member });
check("a screen opens for them", a.status !== 403, show(a));
const ownerMe = await meOf(owner);
check("the owner sees the owner's Team pages", ["team", "team/access", "team/invitations"].every((k) => ownerMe.access.pages[k] === "view"));

/* ---------------------------------------------------------------------------- */
console.log("\n2. a template narrows them, at the gate");
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
check("nor read enquiries, whatever their enquiry right", me.seesLeads === false);
a = await ask("/draft/1/publish", { who: member, method: "POST" });
check("the old console refuses the same change, in HTML", a.status === 403 && a.type.startsWith("text/html") && a.text.includes("view Insights but not change it"), show(a));
a = await ask("/console", { who: member });
check("and an old console page outside their access", a.status === 403 && a.text.includes("access to Content"), show(a));
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
a = await post("/api/v1/jobs/check-team/run", member);
check("with an area on edit, a refresh is theirs to ask for", a.status === 202, show(a));

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
check("their two minutes and the screen they opened are counted", act?.person?.totalMinutes === 2 && act.person.pages.some((p: any) => p.key === "seo/technical" && p.minutes === 2 && p.opens >= 1), JSON.stringify(act?.person?.pages));
check("filtered to them, nobody else's events", act?.timeline?.every((e: any) => e.who.id === member.telegram));
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

check("nothing tried to leave this machine", left.length === 0, left.slice(0, 4).join(", "));
await finish();
