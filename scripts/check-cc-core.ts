/**
 * The command center's server core, end to end, against the real server code
 * and a throwaway database in work/ — with every request that would leave
 * this machine refused and counted, and the scheduler's clock switched off so
 * no collector runs by itself.
 *
 *   npm run check:cc
 *
 * What is proved, one line each:
 *    1. nobody signed in: /api answers 401 in JSON, the console still shows
 *       the sign-in page, /health needs nobody;
 *    2. a signed-in person is told who they are, and only the owner or
 *       somebody the owner chose may read enquiries;
 *    3. the development user exists only when NODE_ENV is not production AND
 *       DESK_DEV_USER is set AND DESK_URL is not an https address, and only
 *       for a request addressed to a loopback name (a DNS-rebound page gets
 *       401), and even it cannot be made to change something by another site;
 *    4. a revoked person gets 403 everywhere except the way out;
 *    5. a request that changes something must come from the desk's own pages,
 *       the console's forms as much as the API;
 *    6. /system has the shape the interface expects, says how much it has
 *       checked, and a sleeping workstation never turns the light red;
 *    7. a job can be registered, run, fail without taking the desk down, and
 *       reports all of it; a failed job turns the light red by name; a key in
 *       what it threw is blanked before a browser sees it; a job the owner
 *       switched off cannot be run by a refresh, a run cannot be asked for
 *       again straight away, and a ready() that throws is "not ready"; the
 *       inbox's "why" is the line of an error that says why (not a harmless
 *       first line), with the whole text kept and both scrubbed;
 *    8. the activity feed and the search box answer, and an enquiry is never
 *       sent to somebody who may not read enquiries;
 *    9. every error under /api is `{ error }`: never a page, never a stack;
 *   10. a collector that throws while loading is survived and named;
 *   11. the old console still works, at /console;
 *   12. cookies move to the desk's own secret without signing anybody out,
 *       and the runner's secret stops opening the desk after the handover.
 *
 * And before any of it, in a process of its own (this same file, started with
 * --broken-foundation): the command center's shared code is made to throw
 * while loading, and the desk underneath it still starts and still does its
 * work. Two servers cannot share the port, so that one runs first and exits.
 *
 * Everybody in here is made up: the addresses end in desk.test and the one
 * article is called a specimen.
 */
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "work", `check-cc-${process.pid}`);
mkdirSync(dir, { recursive: true });

const BROKEN = process.argv.includes("--broken-foundation");
const PORT = 3411;
const BASE = `http://127.0.0.1:${PORT}`;
const RUNNER = "runner-secret-of-the-check";
const SESSION = "session-secret-of-the-check";

for (const name of ["DESK_SESSION_SECRET", "DESK_DEV_USER", "TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_ID", "SITE_REPO"]) delete process.env[name];
process.env.NODE_ENV = "development";
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.DESK_PORT = String(PORT);
process.env.DESK_URL = BASE;
process.env.DESK_OWNER = "owner@desk.test";
process.env.DESK_RUNNER_SECRET = RUNNER;
process.env.TELEGRAM_WEBHOOK_SECRET = "hook";
process.env.DESK_AUTOPUBLISH = "0";
/* No key file here, so every Google source reports itself as not connected. */
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "no-such-key.json");
/* The scheduler's clock stays off: only a job this check asks for ever runs. */
process.env.CC_SCHEDULER = "off";

/* ---- nothing leaves this machine ------------------------------------------- */
const real = globalThis.fetch;
const left: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(BASE)) return real(input as never, init);
  left.push(url.split("?")[0]);
  throw new Error("check:cc lets nothing leave this machine");
}) as typeof fetch;

/* ---- what the server says while it is being tested ------------------------- */
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

/* Nothing from src/cc/ yet: the broken-foundation run has to spoil the
   database before any of it loads. */
const { db, beat } = await import("../src/db.ts");
const people = await import("../src/people.ts");
const { seal } = await import("../src/session.ts");

type Person = ReturnType<typeof people.rememberGoogle>;
interface Answer {
  status: number;
  type: string;
  text: string;
  json: any;
  headers: Headers;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (done: () => Promise<boolean>, ms = 6000): Promise<boolean> => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(80)) if (await done()) return true;
  return false;
};

async function finish(): Promise<never> {
  console.error = quiet.error;
  console.warn = quiet.warn;
  console.log(`\n${failed ? `${failed} FAILED, ${passed} passed` : `all ${passed} passed`}${BROKEN ? " with the command center broken" : ""}.`);
  if (failed && said.length) console.log(`\nwhat the server said meanwhile:\n${said.map((s) => `  ${s.split("\n")[0].slice(0, 200)}`).join("\n")}`);
  /* On Windows, leaving in the same breath as the last answer trips an
     assertion inside Node itself (a handle that is still closing) and turns a
     clean run into a crash. A moment's pause lets it finish. */
  await wait(1500);
  db.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* Windows keeps the file a moment longer. */
  }
  process.exit(failed ? 1 : 0);
}

/** One request to the server under test. `who` arrives by cookie; `from` is the Origin a browser would send. */
async function ask(
  pathname: string,
  o: { who?: Person | null; cookie?: string; method?: string; from?: string | null; headers?: Record<string, string>; body?: unknown } = {},
): Promise<Answer> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = `desk=${o.cookie}`;
  else if (o.who) headers.cookie = `desk=${seal(o.who.telegram)}`;
  if (o.from) headers.origin = o.from;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const res = await real(BASE + pathname, {
    method: o.method ?? "GET",
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    redirect: "manual",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON, and some answers are not meant to be */
  }
  return { status: res.status, type: res.headers.get("content-type") ?? "", text, json, headers: res.headers };
}

/**
 * One request with a Host of our choosing, which fetch will not send (it
 * writes the Host from the address). This is how a page whose own DNS name
 * was re-pointed at 127.0.0.1 arrives: its name in the Host, the port ours.
 */
function asHost(pathname: string, headers: Record<string, string>, method = "GET"): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: PORT, path: pathname, method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => (text += d));
      res.on("end", () => {
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* not JSON */
        }
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : v);
        resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), text, json, headers: h });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const isJson = (a: Answer) => a.type.startsWith("application/json") && a.json !== null;
const isError = (a: Answer, status: number) => a.status === status && isJson(a) && typeof a.json.error === "string" && Object.keys(a.json).length === 1;
const show = (a: Answer) => `${a.status} ${a.type.split(";")[0]} ${a.text.slice(0, 90).replace(/\s+/g, " ")}`;

if (BROKEN) {
  /* SQLite refuses to create a table where an index already has the name,
     IF NOT EXISTS or not. So this makes src/cc/store.ts throw the moment it
     is loaded, which takes every module of the command center with it. */
  db.exec("CREATE INDEX cc_cache ON events (id)");
  await import("../src/server.ts");
  const member = people.rememberGoogle("member@desk.test", "Specimen Member");
  db.prepare("INSERT INTO links (url, title, site, state) VALUES (?, ?, ?, 'queued')").run("https://example.test/waiting", "Specimen link still waiting", "example.test");

  check("the desk came up anyway", await until(async () => (await ask("/health").catch(() => null))?.status === 200));
  check(
    "and said in its log that the command center did not start",
    said.some((s) => s.includes("The command center did not start") && s.includes("cc_cache")),
    said.find((s) => s.includes("did not start"))?.split("\n")[0].slice(0, 140) ?? "nothing logged",
  );
  let b = await ask("/console", { who: member });
  check("the console renders the list", b.status === 200 && b.text.includes("Specimen link still waiting"), String(b.status));
  b = await ask("/runner/next", { method: "POST", headers: { authorization: `Bearer ${RUNNER}` }, body: { name: "check", kinds: ["cover"] } });
  check("the runner's door answers", b.status === 200 && b.json?.job === null, show(b));
  b = await ask("/tg/hook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "hook" }, body: { update_id: 1 } });
  check("Telegram's door answers", b.status === 200 && b.json?.ok === true, show(b));
  b = await ask("/api/v1/me", { who: member });
  check("/api says what is wrong, in JSON: 503", isError(b, 503), show(b));
  b = await ask("/api/v1/me");
  check("and still asks who is there first: 401", isError(b, 401), show(b));
  check("nothing tried to leave this machine", left.length === 0, left.slice(0, 4).join(", "));
  await finish();
}

console.log("\n0. the command center's own code broken (a process of its own, first)");
const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--broken-foundation"], { stdio: "inherit", timeout: 90_000 });
check("with src/cc/ unable to load, the desk still starts and works", child.status === 0, child.status === 0 ? "" : `exit ${child.status ?? child.signal}`);

/* A screen's router is picked up by the server exactly as its module exports
   it, so two routes added here, before the server loads, are mounted with the
   rest: one that throws and one that refuses on purpose. */
const { HTTPException } = await import("hono/http-exception");
let planted = false;
try {
  const { routes } = await import("../src/cc/routes/experiments.ts");
  routes.get("/check-throws", () => {
    throw new Error("specimen failure in a handler\n    at a line that must never reach a browser");
  });
  routes.get("/check-refuses", () => {
    throw new HTTPException(409, { message: "refused on purpose" });
  });
  planted = true;
} catch (e) {
  said.push(`could not plant the test routes: ${e instanceof Error ? e.message : String(e)}`);
}

await import("../src/server.ts");
const scheduler = await import("../src/cc/scheduler.ts");
const store = await import("../src/cc/store.ts");
const { registerSearch, SECTIONS } = await import("../src/cc/find.ts");
const { loadPart, guarded } = await import("../src/cc/index.ts");

console.log("");
check("the server came up on its private port", await until(async () => (await ask("/health").catch(() => null))?.status === 200));
check("with the command center mounted", !said.some((s) => s.includes("The command center did not start")), said.find((s) => s.includes("did not start"))?.split("\n")[0] ?? "");

/* ---- the people, the article, the jobs ------------------------------------- */
const owner = people.rememberGoogle("owner@desk.test", "Specimen Owner");
const member = people.rememberGoogle("member@desk.test", "Specimen Member");
const gone = people.rememberGoogle("gone@desk.test", "Specimen Revoked");
people.setRevoked(gone.telegram, true);

const post = (title: string) =>
  JSON.stringify({
    title,
    standfirst: "A specimen.",
    excerpt: "A specimen.",
    readingTime: 1,
    body: ["A specimen paragraph."],
    takeaways: [],
    services: [],
    source: { url: "https://example.test/specimen", site: "example.test", title: "Specimen source", author: null },
  });
db.prepare("INSERT INTO links (url, title, site, state) VALUES (?, ?, ?, 'drafted')").run("https://example.test/specimen", "Specimen source page", "example.test");
db.prepare("INSERT INTO drafts (link_id, slug, post, template) VALUES (1, 'specimen-article', ?, 'standard')").run(post("Specimen article of the check"));
db.prepare("INSERT INTO links (url, title, site, state) VALUES (?, ?, ?, 'queued')").run("https://example.test/waiting", "Specimen link still waiting", "example.test");
db.prepare("INSERT INTO links (url, title, site, state) VALUES (?, ?, ?, 'drafted')").run("https://example.test/discard", "Specimen to discard", "example.test");
db.prepare("INSERT INTO drafts (link_id, slug, post, template) VALUES (3, 'specimen-discard', ?, 'standard')").run(post("Specimen draft to discard"));

/* Whatever the collectors registered is switched off first, through the API,
   so nothing but the three specimen jobs below can run during this check. */
const theirs = ((await ask("/api/v1/jobs", { who: owner })).json ?? []) as { name: string }[];
for (const j of theirs) await ask(`/api/v1/jobs/${j.name}/enabled`, { who: owner, method: "POST", from: BASE, body: { enabled: false } });

let ran = 0;
scheduler.register(
  { name: "check-ok", title: "Specimen job that works", every: 3600, delay: 3600, run: async () => `specimen run ${++ran}, nothing read` },
  {
    name: "check-fail",
    title: "Specimen job that fails",
    every: 3600,
    delay: 3600,
    run: async () => {
      throw new Error("specimen failure, thrown on purpose");
    },
  },
  { name: "check-asleep", title: "Specimen job with no credential", every: 3600, delay: 3600, ready: () => false, run: async () => "must never run" },
);
const job = async (name: string) => (((await ask("/api/v1/jobs", { who: member })).json ?? []) as any[]).find((j) => j.name === name);

/* ---------------------------------------------------------------------------- */
console.log("\n1. nobody signed in");
let a = await ask("/api/v1/me");
check("/api/v1/me is 401, in JSON", isError(a, 401), show(a));
a = await ask("/api/v1/jobs/check-ok/run", { method: "POST", from: BASE });
check("so is a request that would change something", isError(a, 401), show(a));
a = await ask("/console");
check("the console still answers with the sign-in page", a.status === 401 && a.type.startsWith("text/html") && a.text.includes("Sign in with Google"), `${a.status} ${a.type}`);
a = await ask("/health");
check("/health needs nobody", a.status === 200 && a.json?.ok === true && a.json?.service === "balkaris-desk", show(a));

console.log("\n2. signed in");
a = await ask("/api/v1/me", { who: member });
check(
  "a member is told who they are, and nothing more",
  a.status === 200 &&
    JSON.stringify(Object.keys(a.json).sort()) === JSON.stringify(["access", "canPublish", "email", "name", "owner", "seesLeads"]) &&
    JSON.stringify(Object.keys(a.json.access).sort()) === JSON.stringify(["home", "pages", "restricted"]) &&
    a.json.email === "member@desk.test",
  show(a),
);
check("a member is not the owner and does not read enquiries", a.json?.owner === false && a.json?.seesLeads === false);
check("an answer is never kept by a browser", a.headers.get("cache-control") === "no-store", String(a.headers.get("cache-control")));
a = await ask("/api/v1/me", { who: owner });
check("the owner is the owner, and always reads enquiries", a.json?.owner === true && a.json?.seesLeads === true, show(a));
people.setSeesLeads(member.telegram, true);
check("the owner can let a member read enquiries", (await ask("/api/v1/me", { who: member })).json?.seesLeads === true);
people.setSeesLeads(member.telegram, false);
check("and take it away again", (await ask("/api/v1/me", { who: member })).json?.seesLeads === false);
const stolen = seal(member.telegram).replace(/^-?\d+/, String(owner.telegram));
a = await ask("/api/v1/me", { cookie: stolen });
check("a cookie edited into somebody else's is nobody", isError(a, 401), show(a));

console.log("\n3. the development user");
const env = (set: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};
env({ NODE_ENV: "development", DESK_DEV_USER: "dev@desk.test", DESK_URL: BASE });
a = await ask("/api/v1/me");
check("in development, with DESK_DEV_USER, no cookie is needed", a.status === 200 && a.json?.email === "dev@desk.test", show(a));
check("and that person was made the way a sign-in makes one", people.byEmail("dev@desk.test") !== null);
a = await ask("/api/v1/me", { who: member });
check("a cookie still wins over the development user", a.json?.email === "member@desk.test", show(a));
a = await asHost("/api/v1/me", { host: `rebound.example:${PORT}` });
check("a page whose own name was pointed at this machine (DNS rebinding) is nobody: 401", isError(a, 401), show(a));
a = await asHost("/api/v1/me", { host: `127.0.0.1:${PORT}`, "x-forwarded-host": "rebound.example:3401" });
check("nor through the interface's dev server, which names the browser's host: 401", isError(a, 401), show(a));
a = await asHost("/console", { host: `rebound.example:${PORT}` });
check("the console asks it to sign in too", a.status === 401 && a.text.includes("Sign in with Google"), String(a.status));
a = await asHost("/api/v1/me", { host: `localhost:${PORT}` });
check("localhost is this machine: the development user", a.status === 200 && a.json?.email === "dev@desk.test", show(a));
a = await asHost("/api/v1/me", { host: `127.0.0.1:${PORT}`, "x-forwarded-host": "localhost:3401" });
check("and so is the interface's dev server on it", a.status === 200 && a.json?.email === "dev@desk.test", show(a));
const queueNow = () => JSON.stringify(db.prepare("SELECT (SELECT COUNT(*) FROM jobs) AS jobs, (SELECT state FROM links WHERE id = 2) AS state").get());
const queueBefore = queueNow();
a = await ask("/link/2/retry", { method: "POST", from: "https://elsewhere.example" });
check(
  "another site cannot make the development user change anything in the console: 403, nothing changed",
  a.status === 403 && a.type.startsWith("text/html") && a.text.includes("did not come from the desk") && queueNow() === queueBefore,
  `${a.status} ${queueNow()}`,
);
a = await ask("/api/v1/jobs/check-ok/run", { method: "POST", from: "https://elsewhere.example" });
check("nor through the API: 403", isError(a, 403) && (await job("check-ok"))?.runs === 0, show(a));
env({ NODE_ENV: "production" });
a = await ask("/api/v1/me");
check("NODE_ENV=production shuts it: 401", isError(a, 401), show(a));
a = await ask("/console");
check("for the console too", a.status === 401 && a.text.includes("Sign in with Google"), String(a.status));
env({ NODE_ENV: "development", DESK_URL: "https://desk.balkaris.ch" });
a = await ask("/api/v1/me");
check("the real desk's address shuts it even without NODE_ENV=production: 401", isError(a, 401), show(a));
env({ DESK_URL: undefined });
a = await ask("/api/v1/me");
check("and so does no DESK_URL at all, which means the real desk", isError(a, 401), show(a));
env({ DESK_URL: BASE, DESK_DEV_USER: undefined });
a = await ask("/api/v1/me");
check("without DESK_DEV_USER there is no such person: 401", isError(a, 401), show(a));

console.log("\n4. a revoked person");
a = await ask("/api/v1/me", { who: gone });
check("is refused by the API: 403, in JSON", isError(a, 403), show(a));
a = await ask("/console", { who: gone });
check("is refused by the console: 403, a short page", a.status === 403 && a.type.startsWith("text/html") && a.text.includes("switched off") && !a.text.includes("Specimen source"), `${a.status} ${a.type}`);
a = await ask("/draft/1", { who: gone });
check("cannot read an article", a.status === 403 && !a.text.includes("Specimen article"), String(a.status));
a = await ask("/people", { who: gone });
check("cannot read the team", a.status === 403, String(a.status));
a = await ask("/draft/1/publish", { who: gone, method: "POST", from: BASE });
check("cannot publish, even from the desk's own page", a.status === 403 && a.text.includes("switched off"), String(a.status));
a = await ask("/logout", { who: gone, method: "POST" });
check("can still sign out", a.status !== 403 && /desk=;.*Max-Age=0/.test(a.headers.get("set-cookie") ?? ""), `${a.status} ${a.headers.get("set-cookie")?.slice(0, 40)}`);

console.log("\n5. a change must come from the desk's own pages");
const change = (o: Parameters<typeof ask>[1]) => ask("/api/v1/jobs/check-asleep/run", { who: member, method: "POST", ...o });
/* check-asleep can never run, so "let through" is its 409 and nothing happens. */
a = await change({});
check("no Origin and no Referer: 403", isError(a, 403), show(a));
a = await change({ from: "https://elsewhere.example" });
check("another site's Origin: 403", isError(a, 403), show(a));
a = await change({ from: "null" });
check("a sandboxed page's Origin: 403", isError(a, 403), show(a));
a = await change({ headers: { referer: "https://elsewhere.example/page" } });
check("another site's Referer: 403", isError(a, 403), show(a));
a = await change({ from: "https://elsewhere.example", headers: { referer: `${BASE}/automations` } });
check("a Referer cannot overrule the Origin: 403", isError(a, 403), show(a));
a = await change({ from: BASE });
check("the desk's own Origin is let through", a.status === 409, show(a));
a = await change({ headers: { referer: `${BASE}/automations` } });
check("so is its Referer when there is no Origin", a.status === 409, show(a));
a = await change({ from: "http://desk.specimen:8443", headers: { "x-forwarded-host": "desk.specimen:8443" } });
check("so is the host a proxy says the request was sent to", a.status === 409, show(a));
a = await ask("/api/v1/me", { who: member, from: "https://elsewhere.example" });
check("reading is not a change: allowed from anywhere a cookie reaches", a.status === 200, show(a));
/* The console's forms: same rule. A page on another *.balkaris.ch name is the
   same "site" to SameSite=Lax, so its form would carry the cookie. */
const before5 = queueNow();
a = await ask("/link/2/retry", { who: member, method: "POST", from: "https://other.balkaris.ch" });
check("a console form posted from another site, cookie and all: 403, nothing changed", a.status === 403 && a.type.startsWith("text/html") && queueNow() === before5, `${a.status} ${queueNow()}`);
a = await ask("/link/2/retry", { who: member, method: "POST" });
check("a console form that names no origin at all: 403", a.status === 403 && queueNow() === before5, String(a.status));
a = await ask("/draft/1/takedown", { who: member, method: "POST", from: "https://elsewhere.example" });
check("taking an article down from another site: 403", a.status === 403, String(a.status));
a = await ask("/link/2/retry", { who: member, method: "POST", from: BASE });
check("the console's own form is let through", a.status === 303 && a.headers.get("location") === "/link/2", `${a.status} ${a.headers.get("location")}`);

console.log("\n6. /system");
a = await ask("/api/v1/system", { who: member });
const sys = a.json ?? {};
const shaped =
  typeof sys.ok === "boolean" &&
  Number.isInteger(sys.checked) &&
  typeof sys.line === "string" &&
  Array.isArray(sys.checks) &&
  sys.checks.every((c: any) => typeof c.name === "string" && typeof c.ok === "boolean" && typeof c.detail === "string") &&
  Array.isArray(sys.sources) &&
  sys.sources.every((s: any) => typeof s.id === "string" && typeof s.name === "string" && ["connected", "waiting", "off", "failing"].includes(s.state)) &&
  Array.isArray(sys.notices);
check("has the shape the interface expects", a.status === 200 && shaped, `${sys.checks?.length} checks, ${sys.sources?.length} sources, ${sys.notices?.length} notices`);
const red = (s: any) => s.checks.some((c: any) => !c.ok) || s.sources.some((x: any) => x.state === "failing");
check("the light is red exactly when something is failing", sys.ok === !red(sys), `ok ${sys.ok}, "${sys.line}"`);
check("it does not claim what it has not checked", sys.line !== "All systems operational" || sys.checks.length > 1 || sys.sources.some((s: any) => s.state === "connected"), `"${sys.line}"`);
/* The workstation's line is information, not a check, so it is not counted. */
const counted = (s: any) => s.checks.filter((c: any) => c.name !== "Workstation").length + s.sources.filter((x: any) => x.state === "connected" || x.state === "failing").length;
check(
  "it says how much it checked, and 0 is the words \"Nothing has been checked yet\"",
  sys.checked === counted(sys) && (sys.checked === 0) === (sys.line === "Nothing has been checked yet"),
  `checked ${sys.checked}, "${sys.line}"`,
);
const station = () => ask("/api/v1/system", { who: member }).then((r) => ({ ok: r.json?.ok, c: (r.json?.checks ?? []).find((c: any) => c.name === "Workstation") }));
check("no runner yet is said, not hidden", (await station()).c?.detail.startsWith("No runner"), (await station()).c?.detail);
beat("check");
check("a runner that just asked for work is awake", (await station()).c?.detail.startsWith("Awake"), (await station()).c?.detail);
db.prepare("UPDATE runners SET last_seen = datetime('now', '-3 hours')").run();
const asleep = await station();
check("a sleeping workstation is said, and never turns the light red", asleep.c?.detail.startsWith("Asleep") && asleep.c.ok === true && asleep.ok === sys.ok, asleep.c?.detail);

console.log("\n7. jobs");
let j = await job("check-ok");
check(
  "a registered job is listed, with when it runs",
  !!j && j.title === "Specimen job that works" && j.every === 3600 && j.enabled === true && j.running === false && j.lastOk === null && j.runs === 0 && j.ready === true && typeof j.nextRun === "string",
  JSON.stringify(j ?? null).slice(0, 110),
);
check("one that has no credential is listed as not ready, with no next run", (await job("check-asleep"))?.ready === false && (await job("check-asleep"))?.nextRun === null);
a = await ask("/api/v1/jobs/check-ok/run", { who: member, method: "POST", from: BASE });
check("anybody signed in can ask for a run: 202", a.status === 202 && a.json?.ok === true && a.json?.job?.name === "check-ok", show(a));
check("it runs", await until(async () => (await job("check-ok"))?.lastOk === true));
j = await job("check-ok");
check("and reports it: one run, no failure, what it said, when", j?.runs === 1 && j?.fails === 0 && j?.lastNote === "specimen run 1, nothing read" && !!j?.lastStart && !!j?.lastEnd, `${j?.runs} run, "${j?.lastNote}"`);
a = await ask("/api/v1/jobs/check-fail/run", { who: member, method: "POST", from: BASE });
check("a job that throws is a failed run", a.status === 202 && (await until(async () => (await job("check-fail"))?.lastOk === false)));
j = await job("check-fail");
check("with its reason kept", j?.runs === 1 && j?.fails === 1 && j?.lastNote === "specimen failure, thrown on purpose", `"${j?.lastNote}"`);
check("and the desk is still up", (await ask("/health")).status === 200);
a = await ask("/api/v1/system", { who: member });
const failingCheck = (a.json?.checks ?? []).find((c: any) => c.name === "Specimen job that fails");
/* A collector that is broken today would be failing too; then the line names the first and counts the rest. */
const alsoFailing = (s: any) => s.checks.filter((c: any) => !c.ok && !c.name.startsWith("Specimen")).length + s.sources.filter((x: any) => x.state === "failing").length;
check(
  "the light is red, and names it",
  a.json?.ok === false && failingCheck?.ok === false && failingCheck.detail.includes("thrown on purpose") && (alsoFailing(a.json) ? a.json.line.startsWith("Failing: ") : a.json.line === "Failing: Specimen job that fails"),
  `"${a.json?.line}"`,
);
check("the job that worked is a passing check", (a.json?.checks ?? []).some((c: any) => c.name === "Specimen job that works" && c.ok === true));
check("and both are counted as checked", a.json?.checked >= 2 && a.json.checked === counted(a.json), `checked ${a.json?.checked}`);
check("the job that is not ready is not a check at all", !(a.json?.checks ?? []).some((c: any) => c.name === "Specimen job with no credential"));
a = await ask("/api/v1/jobs/check-asleep/run", { who: member, method: "POST", from: BASE });
check("a job that is not ready cannot be run: 409", isError(a, 409), show(a));
a = await ask("/api/v1/jobs/no-such-job/run", { who: member, method: "POST", from: BASE });
check("a job that does not exist: 404", isError(a, 404), show(a));
a = await ask("/api/v1/jobs/check-fail/enabled", { who: member, method: "POST", from: BASE, body: { enabled: false } });
check("only the owner switches a job off: 403 for a member", isError(a, 403) && (await job("check-fail"))?.enabled === true, show(a));
a = await ask("/api/v1/jobs/check-fail/enabled", { who: owner, method: "POST", from: BASE, body: { enabled: "no" } });
check("a body that is not { enabled: boolean }: 400", isError(a, 400), show(a));
a = await ask("/api/v1/jobs/check-fail/enabled", { who: owner, method: "POST", from: BASE, body: { enabled: false } });
check("the owner switches it off", a.status === 200 && a.json?.job?.enabled === false && a.json.job.nextRun === null, show(a));
a = await ask("/api/v1/system", { who: member });
check("a job that is switched off is no longer a failing check", a.json?.ok === !alsoFailing(a.json) && !(a.json?.checks ?? []).some((c: any) => c.name === "Specimen job that fails"), `"${a.json?.line}"`);
check("and the bell says who switched it off", (a.json?.notices ?? []).some((n: any) => n.kind === "automation" && n.text.includes("switched off") && n.actor === "Specimen Owner"), JSON.stringify(a.json?.notices?.[0] ?? null).slice(0, 110));
a = await ask("/api/v1/jobs/check-fail/run", { who: owner, method: "POST", from: BASE });
await wait(300);
check(
  "a job the owner switched off is not run by a refresh, not even the owner's: 409, no run",
  isError(a, 409) && a.json.error.includes("switched off") && (await job("check-fail"))?.runs === 1,
  show(a),
);
a = await ask("/api/v1/jobs/check-ok/run", { who: member, method: "POST", from: BASE });
await wait(300);
const retryAfter = Number(a.headers.get("retry-after"));
check(
  "asking for a run again straight away: 429 with Retry-After, and no second run",
  isError(a, 429) && retryAfter > 0 && retryAfter <= 600 && (await job("check-ok"))?.runs === 1,
  `${show(a)}, Retry-After ${a.headers.get("retry-after")}`,
);
scheduler.register(
  guarded({
    name: "check-ready-throws",
    title: "Specimen job whose ready() throws",
    every: 3600,
    delay: 3600,
    ready: () => {
      throw new Error("specimen ready() failure");
    },
    run: async () => "must never run",
  }),
);
a = await ask("/api/v1/jobs", { who: member });
const sysWithIt = await ask("/api/v1/system", { who: member });
check(
  "a job whose ready() throws is listed as not ready, and the desk answers around it",
  a.status === 200 && (await job("check-ready-throws"))?.ready === false && sysWithIt.status === 200 && !(sysWithIt.json?.checks ?? []).some((c: any) => c.name.startsWith("Specimen job whose ready")),
  show(a),
);
a = await ask("/api/v1/jobs/check-ready-throws/run", { who: member, method: "POST", from: BASE });
check("it cannot be run: 409", isError(a, 409), show(a));
check("and the log says why, once", said.filter((s) => s.includes("check-ready-throws's ready() threw") && s.includes("specimen ready() failure")).length === 1, `${said.filter((s) => s.includes("ready() threw")).length} times`);
check("their collectors' jobs stayed off throughout", (((await ask("/api/v1/jobs", { who: owner })).json ?? []) as any[]).filter((x) => !x.name.startsWith("check-")).every((x) => x.enabled === false && x.running === false), `${theirs.length} of theirs`);
scheduler.register({
  name: "check-leaky",
  title: "Specimen job whose failure names a key",
  every: 3600,
  delay: 3600,
  run: async () => {
    throw new Error("GET https://api.example.test/v1?site=x&key=specimen-key-value answered 403, sent with Bearer specimen.token.value");
  },
});
await ask("/api/v1/jobs/check-leaky/run", { who: member, method: "POST", from: BASE });
const leakFailed = await until(async () => (await job("check-leaky"))?.lastOk === false);
const leaks = [(await ask("/api/v1/jobs", { who: member })).text, (await ask("/api/v1/system", { who: member })).text];
check(
  "a key or a token in what a job threw is blanked before a browser sees it",
  leakFailed && leaks.every((t) => t.includes("key=[hidden]") && t.includes("Bearer [hidden]") && !t.includes("specimen-key-value") && !t.includes("specimen.token.value")),
  leakFailed ? "" : "the job did not fail",
);
scheduler.setEnabled("check-leaky", false);

/* The inbox's "why": the line that says why, not the first one. Specimen texts in the shapes the local model and the runner produce. */
const { whyLine } = await import("../src/cc/system.ts");
const loadWarning = "specimen-server stopped: exit status 1: specimen_init: failed to set up: SpecimenModel requires ctx_other to be set (this warning is normal during memory fitting)";
let why = whyLine(`Specimen 500: ${JSON.stringify({ error: `${loadWarning}\nspecimen cause: the model file is missing` })}`);
check("why: the last line of a source's JSON body, labelled with the source, not its harmless first line", why.line === "Specimen 500: specimen cause: the model file is missing", why.line);
check("why: the whole text is kept beside it", why.full.includes("ctx_other") && why.full.includes("the model file is missing"));
why = whyLine(`Specimen 500: {"error":"${loadWarning}\\nspecimen cause: cut short here`);
check("why: a body cut short is still opened on its escaped line breaks", why.line === "Specimen 500: specimen cause: cut short here", why.line);
why = whyLine("Error: specimen write failed\n    at write (file:///specimen/run.js:10:5)\n    at async main (file:///specimen/run.js:40:3)\n(Use `node --trace-warnings ...` to show where the warning was created)");
check("why: stack frames and Node's hint are noise; the message is the line", why.line === "Error: specimen write failed", why.line);
why = whyLine("ERROR: [Specimen] abc123: this specimen content is not available");
check("why: a one-line error stays as it is", why.line === "ERROR: [Specimen] abc123: this specimen content is not available" && why.full === why.line, why.line);
why = whyLine(`${loadWarning}\n`);
check("why: all noise still says something (the last line), never an empty cell", why.line === loadWarning, why.line);
why = whyLine("specimen fetch failed\nGET https://api.example.test/v1?key=specimen-key-value answered 403");
check("why: the line and the whole text both go through scrub", why.line.includes("key=[hidden]") && why.full.includes("key=[hidden]") && !why.full.includes("specimen-key-value"), why.line);

console.log("\n8. activity and search");
store.note("check-kind", "A specimen thing happened", { actor: "check" });
store.note("other-kind", "Another specimen thing happened");
a = await ask("/api/v1/activity?limit=1", { who: member });
check("activity is a list, newest first, as long as asked", a.status === 200 && Array.isArray(a.json) && a.json.length === 1 && typeof a.json[0].at === "string" && typeof a.json[0].text === "string", show(a));
a = await ask("/api/v1/activity?kinds=check-kind,nonsense%20kind", { who: member });
check("and can be asked for by kind", Array.isArray(a.json) && a.json.length === 1 && a.json[0].kind === "check-kind" && a.json[0].actor === "check", show(a));
/* Shaped like a Google API key only at run time, so this public file never holds a string a secret scanner would flag. */
const keyShaped = ["AI", "za", "Specimen".repeat(5)].join("");
store.note("check-leak", "Specimen sync failed at https://api.example.test/v1?apikey=specimen-key-value", { detail: `sent as ${keyShaped}` });
a = await ask("/api/v1/activity?kinds=check-leak", { who: member });
check(
  "a key in an activity row is blanked too",
  a.json?.[0]?.text.includes("apikey=[hidden]") && a.json[0].detail === "sent as [hidden]" && !a.text.includes("specimen-key-value") && !a.text.includes(keyShaped),
  show(a),
);

registerSearch(
  () => [
    { kind: "lead", title: "Specimen enquirer", sub: "an enquiry", href: "/leads/specimen" },
    { kind: "page", title: "Specimen page", href: "/pages/specimen" },
  ],
  () => {
    throw new Error("a specimen search source that is broken");
  },
);
const search = async (q: string, who: Person) => ((await ask(`/api/v1/search?q=${encodeURIComponent(q)}`, { who })).json ?? []) as any[];
let hits = await search("site health", member);
check("a section is found by its name", hits[0]?.kind === "section" && hits[0].title === "Site Health" && typeof hits[0].href === "string", JSON.stringify(hits[0] ?? null));
check("all sixteen sections can be found", (await Promise.all(SECTIONS.map(async (s) => (await search(s.title, member)).some((h) => h.kind === "section" && h.href === s.href)))).every(Boolean) && SECTIONS.length === 16);
hits = await search("specimen", member);
check("an article is found by its title, and leads to the article", hits.some((h) => h.kind === "insight" && h.title === "Specimen article of the check" && h.href === "/insights/1"));
check("a link with no article yet is found too, and leads to the link", hits.some((h) => h.kind === "insight" && h.title === "Specimen link still waiting" && h.href === "/insights/link/2"));
check("what a collector registered is found", hits.some((h) => h.kind === "page" && h.title === "Specimen page"));
check("a broken search source costs nothing but itself", hits.length >= 3);
check("an enquiry is NOT sent to somebody who may not read enquiries", !hits.some((h) => h.kind === "lead"), `${hits.length} hits, ${hits.filter((h) => h.kind === "lead").length} leads`);
hits = await search("specimen", owner);
check("and is sent to somebody who may", hits.some((h) => h.kind === "lead" && h.title === "Specimen enquirer"));
check("one letter finds nothing", (await search("s", member)).length === 0);
check("a percent sign is a percent sign, not a wildcard", !(await search("%%", member)).some((h) => h.kind === "insight"));

console.log("\n9. errors under /api");
a = await ask("/api/v1/no-such-thing", { who: member });
check("a path that does not exist: 404, in JSON", isError(a, 404), show(a));
a = await ask("/api/no-such-version", { who: member });
check("outside /v1 as well", isError(a, 404), show(a));
a = await ask("/api", { who: member });
check("and at /api itself", isError(a, 404), show(a));
const mounted = await Promise.all(SECTIONS.map(async (s) => ({ name: s.name, a: await ask(`/api/v1/${s.name}/check-no-such-path`, { who: owner }) })));
const notJson = mounted.filter((m) => !isJson(m.a) || m.a.type.startsWith("text/html"));
check("each of the sixteen screens answers under its name, in JSON", notJson.length === 0, notJson.length ? notJson.map((m) => `${m.name}: ${show(m.a)}`).join("; ") : mounted.map((m) => m.a.status).join(" "));
if (!planted) check("the test routes could be planted on a screen's router", false, said.find((s) => s.startsWith("could not plant")) ?? "");
else {
  a = await ask("/api/v1/experiments/check-throws", { who: member });
  check("a handler that throws: 500, in JSON, its first line only", isError(a, 500) && a.json.error === "specimen failure in a handler" && !a.text.includes("at a line"), show(a));
  env({ NODE_ENV: "production" });
  a = await ask("/api/v1/experiments/check-throws", { who: member });
  env({ NODE_ENV: "development" });
  check("on the box, not even that: one fixed sentence", isError(a, 500) && !a.text.includes("specimen") && !a.text.includes("at a line"), show(a));
  check("and what was thrown is in the server's log", said.some((s) => s.includes("/api/v1/experiments/check-throws") && s.includes("specimen failure in a handler")));
  a = await ask("/api/v1/experiments/check-refuses", { who: member });
  check("a handler that refuses on purpose chooses its status and its sentence", isError(a, 409) && a.json.error === "refused on purpose", show(a));
}

console.log("\n10. a collector that throws while loading");
const broken = path.join(dir, "broken-collector.ts");
writeFileSync(broken, 'throw new Error("specimen collector, broken on purpose");\nexport const jobs = [];\n');
const before = said.length;
const loaded = await loadPart("The specimen collector", () => import(pathToFileURL(broken).href) as Promise<{ jobs: unknown[] }>, (m) => m.jobs);
check("is survived: the loader answers null instead of throwing", loaded === null);
check("is in the log, loudly", said.slice(before).some((s) => s.includes("The specimen collector did not load")));
a = await ask("/api/v1/system", { who: member });
const named = (a.json?.checks ?? []).find((c: any) => c.name === "The specimen collector loads");
check("turns the light red by name, with the reason", a.json?.ok === false && named?.ok === false && named.detail === "specimen collector, broken on purpose", `"${a.json?.line}"`);
check("and everything else carries on", (await ask("/health")).status === 200 && (await ask("/api/v1/me", { who: member })).status === 200);

console.log("\n11. the old console");
a = await ask("/console", { who: member });
check("/console renders the list", a.status === 200 && a.type.startsWith("text/html") && a.text.includes("<h1>Balkaris desk</h1>") && a.text.includes("Specimen source page") && a.text.includes("Specimen link still waiting"), `${a.status} ${a.type}`);
check("its links lead to /console, none to /", a.text.includes('href="/console"') && !a.text.includes('href="/"'));
a = await ask("/", { who: member });
check("/ on this server leads there", a.status === 302 && a.headers.get("location") === "/console", `${a.status} ${a.headers.get("location")}`);
a = await ask("/draft/1", { who: member });
check("an article opens, and its way back is /console", a.status === 200 && a.text.includes("Specimen article of the check") && a.text.includes('<a class="back" href="/console">') && !a.text.includes('href="/"'), String(a.status));
a = await ask("/link/2", { who: member });
check("a link opens, and its way back is /console", a.status === 200 && a.text.includes('<a class="back" href="/console">') && !a.text.includes('href="/"'), String(a.status));
a = await ask("/people", { who: member });
check("the people page opens", a.status === 200 && a.text.includes("Specimen Owner"), String(a.status));
a = await ask("/draft/2/remove", { who: member, method: "POST", from: BASE });
check("deleting a draft returns to /console", a.status === 303 && a.headers.get("location") === "/console" && !db.prepare("SELECT 1 FROM drafts WHERE id = 2").get(), `${a.status} ${a.headers.get("location")}`);
a = await ask("/no-such-page", { who: member });
check("outside /api a missing page is what it always was", a.status === 404 && a.text === "404 Not Found", show(a));

console.log("\n12. the desk's own cookie secret");
const oldCookie = seal(member.telegram, RUNNER);
check("before it is minted, the runner's secret signs and opens", (await ask("/api/v1/me", { cookie: oldCookie })).status === 200);
env({ DESK_SESSION_SECRET: SESSION });
const newMac = seal(member.telegram).split(".");
check("once it is minted, new cookies are signed with it", newMac[2] === createHmac("sha256", SESSION).update(`${newMac[0]}.${newMac[1]}`).digest("base64url") && (await ask("/api/v1/me", { who: member })).status === 200);
a = await ask("/api/v1/me", { cookie: oldCookie });
check("a cookie signed the old way still opens: nobody is signed out", a.status === 200 && a.json?.email === "member@desk.test", show(a));
const handed = /desk=([^;]+);/.exec(a.headers.get("set-cookie") ?? "")?.[1] ?? "";
const [hid, huntil, hmac] = handed.split(".");
check(
  "and is replaced on the spot by one signed the new way",
  !!hmac && Number(hid) === member.telegram && hmac === createHmac("sha256", SESSION).update(`${hid}.${huntil}`).digest("base64url"),
  handed ? "set-cookie carries a new one" : "no set-cookie",
);
check("which opens the desk", !!handed && (await ask("/api/v1/me", { cookie: handed })).status === 200);
a = await ask("/api/v1/me", { cookie: seal(member.telegram, "somebody-else's-secret") });
check("a cookie signed with neither secret is nobody", isError(a, 401), show(a));
const far = `${member.telegram}.${Date.now() + 400 * 86_400_000}`;
a = await ask("/api/v1/me", { cookie: `${far}.${createHmac("sha256", SESSION).update(far).digest("base64url")}` });
check("a cookie stamped further ahead than the desk stamps one is nobody", isError(a, 401), show(a));
const marked = db.prepare("UPDATE events SET at = datetime('now', '-8 days') WHERE what = 'session.secret'").run();
a = await ask("/api/v1/me", { cookie: oldCookie });
check("after the handover week the runner's secret opens nothing", Number(marked.changes) === 1 && isError(a, 401), show(a));
check("and the desk's own still does", (await ask("/api/v1/me", { cookie: seal(member.telegram, SESSION) })).status === 200);
env({ DESK_SESSION_SECRET: undefined });

console.log("\nand at the end");
a = await ask("/health");
check("/health still answers", a.status === 200 && a.json?.ok === true, show(a));
check("nothing tried to leave this machine", left.length === 0, left.slice(0, 4).join(", "));

await finish();
