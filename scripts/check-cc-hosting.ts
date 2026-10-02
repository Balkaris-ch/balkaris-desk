/**
 * The Hosting screen and the Vercel drain's door, end to end, against the real
 * server code on a private port with a throwaway database in work/. Nothing
 * leaves this machine: every request to anywhere but the server under test
 * (and, read-only, the workstation's own interface) is refused and counted,
 * and the scheduler's clock is off, so no collector runs by itself.
 *
 *   timeout 300 npm run check:hosting
 *
 * What is proved:
 *    1. with no Vercel token and no drain secret, every panel of the screen
 *       is off or waiting and says why, and the off ones name the step;
 *       the door answers 503 and counts nothing;
 *    2. the door is a machine door: GET and a signed POST work with no one
 *       signed in and no Origin (the gate lets exactly /drain/vercel past,
 *       like /tg/; any other address under /drain needs sign-in);
 *    3. a wrong signature, or records with none, are refused with 403 and
 *       count nothing; the refusal itself is counted; an unsigned empty body
 *       (a reachability check) is answered 200 and counts nothing; a request
 *       without a signature of the right shape is answered from its headers
 *       before a byte of its body is sent (chunked included); a forged gzip
 *       body is never unpacked; Vercel's test batch (marked by the
 *       connector) is answered 200 and counts nothing, signed or not, and
 *       leaves the drain undelivered;
 *    4. a signed synthetic batch (a page view, an RSC navigation, a prefetch,
 *       a file, a bot, a 404, another host, a duplicate id, a line that is not
 *       JSON) lands exactly where the rules say, in NDJSON and in a JSON
 *       array, plain and gzip; another record of the same request counts
 *       once; the same delivery twice counts nothing new; the day's page
 *       views are kept in cc_series (vercel.views);
 *    5. nothing stored anywhere in the database holds the IP address, the
 *       user agent or the full referrer of a record;
 *    6. a body over the cap is refused with 413;
 *    7. the rules, one by one, on single records;
 *    8. the screen then shows the counts, GA4 and the API still off with
 *       their steps; ?specimen=1 fills only what has no value and says so;
 *       a day without a delivery leaves today's tile waiting (off when the
 *       secret is gone), never zero, and the chart a gap; a day of page views
 *       without one router record is named on the screen and turns the
 *       router-markers check red;
 *    9. the build log is off with the token's step, and refuses a bad id;
 *   10. if the workstation's interface is running (DESK_WEB, default
 *       http://localhost:3401), /hosting renders with every panel off and its
 *       step, and ?specimen=1 renders the specimen;
 *   11. Vercel's API, answered here from fixtures shaped as openapi.json
 *       documents them: builds with their commit, time, creator and error
 *       step; the project, domains and anomalies; a failed build noted once;
 *       its log, with a bearer token in it blanked; a 429 waits for resetMs
 *       without calling again; a 403 turns one panel off; a 401 turns the
 *       source failing and every panel off with the token's step;
 *   12. Vercel's status page from a fixture, filtered by component id (a
 *       second "Builds" in an outage is not ours), its incident noted when it
 *       opens and when it is gone; the engine's check against the server under
 *       test standing in for it: up, a 404, nothing listening, an outage opened
 *       and closed.
 *
 * Every record is artificial: addresses under /specimen-, the documentation
 * range 192.0.2.0/24 for an IP, a browser called SpecimenBrowser, a referrer
 * under .example.
 */
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/* Every unpacking the door does is counted: the door's own `import { gunzipSync }` sees this wrapper. */
const zlibShared = createRequire(import.meta.url)("node:zlib") as typeof import("node:zlib");
const gunzipReal = zlibShared.gunzipSync;
let unpacked = 0;
zlibShared.gunzipSync = ((...a: Parameters<typeof gunzipReal>) => {
  unpacked++;
  return gunzipReal(...a);
}) as typeof gunzipReal;
syncBuiltinESMExports();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "work", `check-hosting-${process.pid}`);
mkdirSync(dir, { recursive: true });

const PORT = 3451;
const BASE = `http://127.0.0.1:${PORT}`;
const WEB = (process.env.DESK_WEB ?? "http://localhost:3401").replace(/\/$/, "");
const SECRET = "test-drain-secret-of-the-check";
const IP = "192.0.2.123";
const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SpecimenBrowser/1.0";
const UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) SpecimenBrowser/1.0 Mobile";
const UA_BOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) SpecimenCrawl";
const REFERRER = "https://referrer.example/specimen/path?q=specimen-private";

for (const name of ["DESK_SESSION_SECRET", "DESK_DEV_USER", "TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_ID", "SITE_REPO", "DESK_VERCEL_TOKEN", "VERCEL_DRAIN_SECRET", "VERCEL_DRAIN_VERIFY"]) delete process.env[name];
process.env.NODE_ENV = "development";
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.DESK_PORT = String(PORT);
process.env.DESK_URL = BASE;
process.env.DESK_OWNER = "owner@desk.test";
process.env.DESK_RUNNER_SECRET = "runner-secret-of-the-check";
process.env.TELEGRAM_WEBHOOK_SECRET = "hook";
process.env.DESK_AUTOPUBLISH = "0";
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "no-such-key.json");
process.env.CC_SCHEDULER = "off";

/* ---- nothing leaves this machine ---------------------------------------------- */
const real = globalThis.fetch;
const left: string[] = [];
/* Sections 11 and 12 answer Vercel's API and its status page from fixtures, here, by setting this. */
let stub: ((url: URL, init?: RequestInit) => Response | null) | null = null;
const asked: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(BASE)) return real(input as never, init);
  if (stub) {
    const u = new URL(url);
    asked.push(`${init?.method ?? "GET"} ${u.host}${u.pathname}`);
    const r = stub(u, init);
    if (r) return r;
  }
  left.push(url.split("?")[0]!);
  throw new Error("check:hosting lets nothing leave this machine");
}) as typeof fetch;

const said: string[] = [];
const quiet = { error: console.error, warn: console.warn };
console.error = (...a: unknown[]) => void said.push(a.map(String).join(" "));
console.warn = (...a: unknown[]) => void said.push(a.map(String).join(" "));

let failed = 0;
let passed = 0;
const check = (what: string, ok: boolean, detail: unknown = "") => {
  if (ok) passed++;
  else failed++;
  const d = typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 300);
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}${d ? `  — ${d}` : ""}`);
};

const { db } = await import("../src/db.ts");
const people = await import("../src/people.ts");
const { seal } = await import("../src/session.ts");
await import("../src/server.ts");
const store = await import("../src/cc/store.ts");
const drain = await import("../src/cc/vercel/drain.ts");

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function finish(): Promise<never> {
  console.error = quiet.error;
  console.warn = quiet.warn;
  console.log(`\n${failed ? `${failed} FAILED, ${passed} passed` : `all ${passed} passed`}.`);
  if (failed && said.length) console.log(`\nwhat the server said meanwhile:\n${said.map((s) => `  ${s.split("\n")[0]!.slice(0, 200)}`).join("\n")}`);
  await wait(1500);
  db.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* Windows keeps the file a moment longer */
  }
  process.exit(failed ? 1 : 0);
}

interface Answer {
  status: number;
  text: string;
  json: any;
  headers: Headers;
}
async function ask(pathname: string, o: { cookie?: string; method?: string; headers?: Record<string, string>; body?: string | Buffer } = {}): Promise<Answer> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = `desk=${o.cookie}`;
  const res = await real(BASE + pathname, { method: o.method ?? "GET", headers, body: o.body as BodyInit | undefined, redirect: "manual" });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

for (let i = 0; i < 60 && (await ask("/health").catch(() => null))?.status !== 200; i++) await wait(100);
check("the server came up on its private port", (await ask("/health")).status === 200);

const owner = people.rememberGoogle("owner@desk.test", "Specimen Owner");
const cookie = seal(owner.telegram);
const sign = (body: Buffer | string) => createHmac("sha1", SECRET).update(body).digest("hex");
const post = (body: Buffer | string, sig?: string | null, headers: Record<string, string> = {}) =>
  ask("/drain/vercel", { method: "POST", headers: { "content-type": "application/x-ndjson", ...(sig ? { "x-vercel-signature": sig } : {}), ...headers }, body });
const screen = async (q = "") => (await ask(`/api/v1/hosting${q}`, { cookie })).json;
/**
 * A POST to the door whose body is never sent, on a connection of its own:
 * the status of an answer given from the headers alone, or -2 when the server
 * waited for a body (it would have read it).
 */
const headersOnly = (headers: Record<string, string>): Promise<number> =>
  new Promise((resolve) => {
    const req = httpRequest({ host: "127.0.0.1", port: PORT, path: "/drain/vercel", method: "POST", headers: { "content-type": "application/x-ndjson", connection: "close", ...headers } }, (res) => {
      clearTimeout(timer);
      resolve(res.statusCode ?? 0);
      res.resume();
      req.destroy();
    });
    const timer = setTimeout(() => {
      resolve(-2);
      req.destroy();
    }, 4000);
    req.on("error", () => resolve(-1));
    req.flushHeaders();
  });
const kindsToday = () => drain.kindsBetween(store.today(-1), store.today());
const totalRecords = () => Object.values(kindsToday()).reduce((a, n) => a + n, 0);

/* ---- 1. nothing connected ------------------------------------------------------- */
console.log("\n1. no token, no secret");
let s = await screen();
const panels: [string, any][] = [
  ["tiles.viewsToday", s.tiles.viewsToday],
  ["tiles.ga4Views", s.tiles.ga4Views],
  ["tiles.gap", s.tiles.gap],
  ["tiles.build", s.tiles.build],
  ["tiles.platform", s.tiles.platform],
  ["tiles.engine", s.tiles.engine],
  ["chart", s.chart],
  ["counting", s.counting],
  ["pages", s.pages],
  ["referrers", s.referrers],
  ["devices", s.devices],
  ["regions", s.regions],
  ["countries", s.countries],
  ["bots", s.bots],
  ["notFound", s.notFound],
  ["builds", s.builds],
  ["production", s.production],
  ["domains", s.domains],
  ["attacks", s.attacks],
  ["platform", s.platform],
  ["engine.local", s.engine.local],
  ["engine.public", s.engine.public],
];
const notOk = panels.filter(([, r]) => r.state === "ok");
check("every panel is off or waiting: no figure without a source", notOk.length === 0, notOk.map(([k]) => k).join(", "));
const silent = panels.filter(([, r]) => r.state !== "ok" && !(typeof r.reason === "string" && r.reason.length > 20));
check("each says why, in a sentence", silent.length === 0, silent.map(([k]) => k).join(", "));
const drainPanels = ["tiles.viewsToday", "chart", "counting", "pages", "referrers", "devices", "regions", "bots", "notFound"];
const drainSteps = panels.filter(([k]) => drainPanels.includes(k)).every(([, r]) => r.state === "off" && r.source === "vercel-drain" && /vercel-connect\.sh/.test(r.step ?? ""));
check("the drain's panels are off, with the connector as their step", drainSteps, panels.filter(([k]) => drainPanels.includes(k)).map(([k, r]) => `${k}:${r.state}`).join(" "));
const apiPanels = ["tiles.build", "builds", "production", "domains", "attacks"];
check(
  "the API's panels are off, with the desk-only token as their step",
  panels.filter(([k]) => apiPanels.includes(k)).every(([, r]) => r.state === "off" && r.source === "vercel-api" && /desk-hosting/.test(r.step ?? "") && /DESK_VERCEL_TOKEN/.test(r.step ?? "")),
);
check("countries are off, saying the records carry none", s.countries.state === "off" && /carry no country/.test(s.countries.reason));
check("the status page and the engine are waiting for their first read (the scheduler is off)", s.platform.state === "waiting" && s.engine.local.state === "waiting" && s.engine.public.state === "waiting");
check("the rules are listed even so, every count null", s.rules.length === 15 && s.rules.every((r: any) => r.count === null && r.rule && r.why), s.rules.length);
check("no specimen without ?specimen=1", s.specimen === false);
let a = await post("[]", null);
check("the door answers 503 while the desk has no secret", a.status === 503 && /VERCEL_DRAIN_SECRET/.test(a.json?.error ?? ""), `${a.status} ${a.text.slice(0, 80)}`);
let sys = (await ask("/api/v1/system", { cookie })).json;
const src = (id: string) => sys.sources.find((x: any) => x.id === id);
check("Settings lists the drain off with its step, the API off with its step", src("vercel-drain")?.state === "off" && /vercel-connect/.test(src("vercel-drain")?.step ?? "") && src("vercel-api")?.state === "off" && /DESK_VERCEL_TOKEN/.test(src("vercel-api")?.step ?? ""));

/* ---- 2 and 3. the door -------------------------------------------------------------- */
console.log("\n2. the door, with a secret");
process.env.VERCEL_DRAIN_SECRET = SECRET;
a = await ask("/drain/vercel");
check("GET /drain/vercel answers with nobody signed in", a.status === 200 && a.json?.ready === true, `${a.status} ${a.text.slice(0, 80)}`);
const elsewhere = [await ask("/drain/other"), await ask("/drain/vercel/more", { method: "POST", body: "[]" }), await ask("/drain/", { method: "POST", body: "[]" })];
check("only /drain/vercel is let past sign-in: any other address under /drain is not", elsewhere.every((x) => x.status === 401), elsewhere.map((x) => x.status));
a = await post("", null);
check("an unsigned empty body (a reachability check) is answered 200 and counts nothing", a.status === 200 && a.json?.counted === 0 && totalRecords() === 0, `${a.status} ${a.text}`);
process.env.VERCEL_DRAIN_VERIFY = "specimen-verify-code";
a = await post("", null);
check("with VERCEL_DRAIN_VERIFY set, the answer echoes it in x-vercel-verify", a.headers.get("x-vercel-verify") === "specimen-verify-code");
delete process.env.VERCEL_DRAIN_VERIFY;

const now = Date.now() - 60_000;
const rec = (o: Record<string, unknown>) => ({ deploymentId: "dpl_specimen", projectId: "prj_specimen", level: "info", environment: "production", timestamp: now, ...o });
const px = (o: Record<string, unknown>) => ({ timestamp: now, method: "GET", host: "www.balkaris.ch", region: "fra1", clientIp: IP, scheme: "https", ...o });
const batch1 = [
  rec({ id: "specimen-rec-1", requestId: "specimen-req-1", source: "static", host: "www.balkaris.ch", proxy: px({ path: "/specimen-page?utm_source=specimen", statusCode: 200, userAgent: [UA_DESKTOP], referer: REFERRER, vercelCache: "HIT", pathType: "prerender" }) }),
  rec({ id: "specimen-rec-2", requestId: "specimen-req-2", source: "static", path: "/specimen-next.rsc", proxy: px({ path: "/specimen-next?_rsc=abc123", statusCode: 200, userAgent: [UA_PHONE], referer: "https://www.balkaris.ch/specimen-page" }) }),
  rec({ id: "specimen-rec-3", requestId: "specimen-req-3", source: "static", path: "/specimen-next.segments/_tree.segment.rsc", proxy: px({ path: "/specimen-next?_rsc=def456", statusCode: 200, userAgent: [UA_PHONE] }) }),
  rec({ id: "specimen-rec-4", requestId: "specimen-req-4", source: "static", proxy: px({ path: "/_next/static/chunks/specimen.js", statusCode: 200, userAgent: [UA_DESKTOP] }) }),
  rec({ id: "specimen-rec-5", requestId: "specimen-req-5", source: "static", proxy: px({ path: "/specimen-page", statusCode: 200, userAgent: [UA_BOT] }) }),
  rec({ id: "specimen-rec-6", requestId: "specimen-req-6", source: "lambda", proxy: px({ path: "/specimen-missing", statusCode: 404, userAgent: [UA_DESKTOP], referer: REFERRER }) }),
  rec({ id: "specimen-rec-7", requestId: "specimen-req-7", source: "static", host: "preview.balkaris.ch", proxy: px({ host: "preview.balkaris.ch", path: "/specimen-page", statusCode: 200, userAgent: [UA_DESKTOP] }) }),
  rec({ id: "specimen-rec-1", requestId: "specimen-req-1", source: "static", proxy: px({ path: "/specimen-page", statusCode: 200, userAgent: [UA_DESKTOP] }) }),
];
const ndjson = `${batch1.map((r) => JSON.stringify(r)).join("\n")}\nthis line is not JSON\n`;

console.log("\n3. refused deliveries");
a = await post(ndjson, sign(`${ndjson}tampered`));
check("a wrong signature is refused with 403", a.status === 403 && a.json?.code === "invalid_signature", `${a.status} ${a.text.slice(0, 80)}`);
a = await post(ndjson, null);
check("records with no signature are refused with 403", a.status === 403, `${a.status}`);
a = await post(ndjson, "0".repeat(40));
check("a signature of the right shape and the wrong value is refused", a.status === 403);
let code = await headersOnly({ "x-vercel-signature": "not-a-signature", "transfer-encoding": "chunked" });
check("a signature of the wrong shape is refused from the headers, its body never read", code === 403, `${code}`);
code = await headersOnly({ "transfer-encoding": "chunked" });
check("an unsigned body sent without a length (chunked) is refused before a byte of it is read", code === 403, `${code}`);
code = await headersOnly({ "content-length": "1000000" });
check("an unsigned body announced over 64 bytes is refused before a byte of it is read", code === 403, `${code}`);
const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 0x61));
a = await post(bomb, "0".repeat(40), { "content-encoding": "gzip" });
check("a gzip body with a forged signature is refused and never unpacked", a.status === 403 && unpacked === 0, `${a.status}, unpacked ${unpacked} times`);
check("nothing in them was counted", totalRecords() === 0, kindsToday());
check("the refusals are counted, so a wrong secret shows on the screen", drain.deliveriesOn(store.today()).refused === 7, drain.deliveriesOn(store.today()));

console.log("\n   Vercel's test batch (POST /v1/drains/test), marked by the connector");
a = await post(ndjson, sign(ndjson), { [drain.TEST_HEADER]: "1" });
check("signed and marked: answered 200 as a test, nothing counted", a.status === 200 && a.json?.test === true && a.json?.signed === true && totalRecords() === 0, `${a.status} ${a.text}`);
check("…and the drain is not marked delivered: no first or last delivery, none today", drain.drainState().first === null && drain.drainState().last === null && drain.deliveriesOn(store.today()).deliveries === 0, drain.drainState());
code = await headersOnly({ [drain.TEST_HEADER]: "1", "transfer-encoding": "chunked" });
check("unsigned and marked: answered 200 from the headers, its body never read", code === 200, `${code}`);
a = await post(ndjson, sign(`${ndjson}x`), { [drain.TEST_HEADER]: "1" });
check("marked, with a wrong signature: refused like any other, so a wrong secret fails the connector's test", a.status === 403 && totalRecords() === 0 && drain.deliveriesOn(store.today()).refused === 8, `${a.status}`);
sys = (await ask("/api/v1/system", { cookie })).json;
check("after the test batch Settings still says no delivery has arrived", src("vercel-drain")?.state === "waiting", src("vercel-drain"));

/* ---- 4. a signed batch --------------------------------------------------------------- */
console.log("\n4. a signed synthetic batch");
a = await post(ndjson, sign(ndjson));
check("a signed NDJSON delivery is taken, with nobody signed in and no Origin", a.status === 200 && a.json?.ok === true && a.json?.received === 8 && a.json?.unreadable === 1, `${a.status} ${a.text}`);
let k = kindsToday();
const want1 = { view: 1, navigation: 1, prefetch: 1, file: 1, bot: 1, notFound: 1, otherHost: 1, duplicate: 1 };
const exactly = (got: Record<string, number>, want: Record<string, number>) => Object.entries(got).every(([kind, n]) => n === (want[kind] ?? 0));
check("each record lands in exactly its kind: view, navigation, prefetch, file, bot, 404, other host, duplicate", exactly(k, want1), k);

const batch2 = [
  rec({ id: "specimen-rec-9", requestId: "specimen-req-9", source: "lambda", message: "a function's own log line" }),
  rec({ id: "specimen-rec-10", requestId: "specimen-req-10", source: "static", proxy: px({ path: "/specimen-page/", statusCode: 304, userAgent: [UA_DESKTOP] }) }),
  rec({ id: "specimen-rec-11", requestId: "specimen-req-10", source: "lambda", message: "the same request, logged", proxy: px({ path: "/specimen-page/", statusCode: 304, userAgent: [UA_DESKTOP] }) }),
  rec({ id: "specimen-rec-12", requestId: "specimen-req-12", source: "redirect", host: "balkaris.ch", proxy: px({ host: "balkaris.ch", path: "/", statusCode: 308, userAgent: [UA_DESKTOP] }) }),
];
const array = JSON.stringify(batch2);
a = await post(array, sign(array), { "content-type": "application/json" });
check("a signed JSON array is taken", a.status === 200 && a.json?.received === 4, `${a.status} ${a.text}`);
const one = JSON.stringify(rec({ id: "specimen-rec-13", requestId: "specimen-req-13", source: "static", proxy: px({ path: "/specimen-gzip", statusCode: 200, userAgent: [UA_DESKTOP] }) }));
const packed = gzipSync(Buffer.from(one));
a = await post(packed, sign(packed), { "content-encoding": "gzip" });
check("a signed gzip delivery is unpacked and taken (the only unpacking so far: the counter sees the door's)", a.status === 200 && a.json?.received === 1 && unpacked === 1, `${a.status} ${a.text}, unpacked ${unpacked} times`);
k = kindsToday();
const want2 = { ...want1, view: 3, noRequest: 1, duplicate: 2, redirect: 1 };
check("then: a 304 is a view, another record of the same request counts once, a log line is not a request, a 308 is a redirect", exactly(k, want2), k);
a = await post(ndjson, sign(ndjson));
k = kindsToday();
check("the same delivery again counts nothing new: all its records are duplicates", a.status === 200 && exactly(k, { ...want2, duplicate: 10 }), k);

const views = store.series("vercel.views", 2);
const todayViews = views.find((p) => p.day === store.today())?.value;
check("page views = page loads + navigations = 4, and kept in cc_series as vercel.views", k.view + k.navigation === 4 && todayViews === 4, views);
const top = (dim: "path" | "ref" | "device" | "region" | "bot" | "404") => Object.fromEntries(drain.topBetween(dim, store.today(-1), store.today(), 20).map((r) => [r.key, r.n]));
check("per address: /specimen-page 2 (a trailing slash is the same page), /specimen-next 1, /specimen-gzip 1", JSON.stringify(top("path")) === JSON.stringify({ "/specimen-page": 2, "/specimen-gzip": 1, "/specimen-next": 1 }), top("path"));
check("per referrer, host only: referrer.example 1, inside the site 1, none 2", JSON.stringify(top("ref")) === JSON.stringify({ "(none)": 2, "(this site)": 1, "referrer.example": 1 }), top("ref"));
check("per device: desktop 3, mobile 1", JSON.stringify(top("device")) === JSON.stringify({ desktop: 3, mobile: 1 }), top("device"));
check("per edge region: fra1 4", JSON.stringify(top("region")) === JSON.stringify({ fra1: 4 }), top("region"));
check("bots by family: Google 1", JSON.stringify(top("bot")) === JSON.stringify({ Google: 1 }), top("bot"));
check("404s by address: /specimen-missing 1", JSON.stringify(top("404")) === JSON.stringify({ "/specimen-missing": 1 }), top("404"));
const d = drain.deliveriesOn(store.today());
check("today's deliveries: 4 signed, 21 records in them, 8 refused (the test batch is none of them)", d.deliveries === 4 && d.records === 21 && d.refused === 8, d);
sys = (await ask("/api/v1/system", { cookie })).json;
check("the drain is connected in Settings, and its check vouches", src("vercel-drain")?.state === "connected" && sys.checks.some((c: any) => c.name === "Vercel's request records arrive" && c.ok));

/* ---- 5. nothing personal is kept -------------------------------------------------------- */
console.log("\n5. nothing personal is kept");
const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
const everything = tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all())).join("\n");
/* Pieces of the user agents themselves ("Googlebot/2.1", not the crawler's name, which the AI-search count keeps by design). */
const needles = [IP, "SpecimenBrowser", "Googlebot/2.1", "compatible;", "iPhone", "SpecimenCrawl", "specimen-private", "referrer.example/specimen", "Windows NT"];
const found = needles.filter((x) => everything.includes(x));
check(`no table holds an IP address, a user agent or a full referrer (${tables.length} tables read)`, found.length === 0, found.join(", "));
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
const files = readdirSync(dir).filter((f) => f.startsWith("desk.db"));
const bytes = files.map((f) => readFileSync(path.join(dir, f)).toString("latin1")).join("");
const inFiles = needles.filter((x) => bytes.includes(x));
check("nor do the database's files on disk, write-ahead log included", inFiles.length === 0, `${files.join(", ")}: ${inFiles.join(", ")}`);

/* ---- 6. the cap ------------------------------------------------------------------------- */
/* Announced over the cap: the door answers 413 from the length alone, before reading a byte of it.
   Sent by hand, on a connection of its own, because the answer comes while the body would still be
   on its way and fetch reports that as a reset. */
const capped = await new Promise<number>((resolve) => {
  const req = httpRequest({ host: "127.0.0.1", port: PORT, path: "/drain/vercel", method: "POST", headers: { "content-type": "application/x-ndjson", "content-length": String(drain.MAX_BODY + 1024), "x-vercel-signature": "0".repeat(40), connection: "close" } }, (res) => {
    resolve(res.statusCode ?? 0);
    res.resume();
    req.destroy();
  });
  req.on("error", () => resolve(-1));
  req.flushHeaders();
});
check("a body announced over the cap is refused with 413, unread", capped === 413, `${capped}`);

/* ---- 7. the rules on single records ------------------------------------------------------ */
console.log("\n7. the rules, one record at a time");
const c1 = (o: Record<string, unknown>, top: Record<string, unknown> = {}) => drain.classify(rec({ ...top, proxy: px({ statusCode: 200, userAgent: [UA_DESKTOP], path: "/specimen", ...o }) }));
const cases: [string, ReturnType<typeof drain.classify>, string][] = [
  ["HEAD is not GET", c1({ method: "HEAD" }), "method"],
  ["/api/ask is an API call", c1({ path: "/api/ask" }), "api"],
  ["/favicon.ico is a file", c1({ path: "/favicon.ico" }), "file"],
  ["/opengraph-image is a file", c1({ path: "/opengraph-image" }), "file"],
  ["/sitemap.xml is a file", c1({ path: "/sitemap.xml" }), "file"],
  ["/insights/x/card.jpg is a file", c1({ path: "/insights/specimen/card.jpg" }), "file"],
  ["the desk's own checks are a bot", c1({ userAgent: ["BalkarisDesk/1.0 (+https://desk.balkaris.ch)"] }), "bot"],
  ["no user agent is a bot", c1({ userAgent: [] }), "bot"],
  ["curl is a bot", c1({ userAgent: ["curl/8.0"] }), "bot"],
  ["ClaudeBot is a bot", c1({ userAgent: ["Mozilla/5.0 (compatible; ClaudeBot/1.0)"] }), "bot"],
  ["a Cubot phone's browser is not a robot", c1({ userAgent: ["Mozilla/5.0 (Linux; Android 10; CUBOT X30) SpecimenBrowser/1.0 Mobile"] }), "view"],
  ["a 500 is a server error", c1({ statusCode: 500 }), "serverError"],
  ["a 401 is another answer", c1({ statusCode: 401 }), "otherStatus"],
  ["a -1 (revalidated in the background) is another answer", c1({ statusCode: -1 }), "otherStatus"],
  ["an unproved ?_rsc= request is set aside", c1({ path: "/specimen?_rsc=1" }), "rsc"],
  ["a .prefetch.rsc is a prefetch", c1({ path: "/specimen?_rsc=1" }, { path: "/specimen.prefetch.rsc" }), "prefetch"],
  ["a vercel.app address is another host", c1({ host: "specimen.vercel.app" }), "otherHost"],
  ["balkaris.ch with a port and a dot is still the site", c1({ host: "balkaris.ch.:443" }), "view"],
  ["a record with no proxy is not a request", drain.classify(rec({ message: "build output" })), "noRequest"],
];
for (const [what, got, kind] of cases) check(what, got.kind === kind, `${got.kind}${got.bot ? ` (${got.bot})` : ""}`);
check("an iPad that says so is a tablet; one that says Macintosh is desktop", drain.deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0) SpecimenBrowser") === "tablet" && drain.deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) SpecimenBrowser") === "desktop");
check("an Android phone is mobile, an Android tablet is a tablet", drain.deviceOf("Mozilla/5.0 (Linux; Android 14; Pixel) Mobile Safari") === "mobile" && drain.deviceOf("Mozilla/5.0 (Linux; Android 14; Tab) Safari") === "tablet");
check("a referrer becomes its host only; www. is dropped; the site itself is named", drain.refHost("https://www.referrer.example/a?b=c") === "referrer.example" && drain.refHost("https://preview.balkaris.ch/x") === "(this site)" && drain.refHost("") === "(none)");

/* ---- 8. the screen with the counts ------------------------------------------------------ */
console.log("\n8. the screen, with records counted");
s = await screen();
check("today's page views: 4, from the drain", s.tiles.viewsToday.state === "ok" && s.tiles.viewsToday.value.value === 4 && s.tiles.viewsToday.source === "vercel-drain", s.tiles.viewsToday);
check("the chart starts on the first delivery's day, and has no GA4 line, saying why", s.chart.state === "ok" && s.chart.value.days[0] === s.chart.value.firstDay && s.chart.value.ga4 === null && typeof s.chart.value.ga4Why === "string", s.chart.state === "ok" ? { days: s.chart.value.days, ga4Why: s.chart.value.ga4Why } : s.chart);
check("GA4's tile is off with GA4's own step (no key here)", s.tiles.ga4Views.state === "off" && s.tiles.ga4Views.source === "ga4", s.tiles.ga4Views);
check("the gap is off too: it needs both", s.tiles.gap.state !== "ok", s.tiles.gap);
check("the rules carry their counts now", s.rules.find((r: any) => r.kind === "view")?.count === 3 && s.rules.find((r: any) => r.kind === "duplicate")?.count === 10);
check("the counting panel: deliveries, refusals, records", s.counting.state === "ok" && s.counting.value.today.deliveries === 4 && s.counting.value.today.refused === 8 && s.counting.value.records === 21 && s.counting.value.quietHours === null && s.counting.value.markers.gaps.length === 0, s.counting.value);
check("top pages and referrers come from the drain", s.pages.state === "ok" && s.pages.value[0]?.key === "/specimen-page" && s.referrers.state === "ok" && s.referrers.value.some((r: any) => r.key === "(none)" && /Direct/.test(r.label)));
check("bots and 404s carry their totals", s.bots.state === "ok" && s.bots.value.total === 1 && s.notFound.state === "ok" && s.notFound.value.total === 1);
check("the API's panels are still off with their step", ["builds", "production", "domains", "attacks"].every((p) => s[p].state === "off" && /DESK_VERCEL_TOKEN/.test(s[p].step ?? "")));
check("five dashboard-only links, each with its reason", s.dashboard.length === 5 && s.dashboard.every((l: any) => /^https:\/\/vercel\.com\//.test(l.href) && l.why.length > 30));

process.env.DESK_DEV_USER = "owner@desk.test";
const spec = await screen("?specimen=1");
check("?specimen=1 on a development desk fills what has no value, and names it", spec.specimen === true && spec.specimenPanels.includes("Production builds") && spec.builds.state === "ok" && spec.builds.value[0].creator === "specimen", spec.specimenPanels);
check("…and never covers a real figure: today's page views stay the drain's 4", spec.tiles.viewsToday.source === "vercel-drain" && spec.tiles.viewsToday.value.value === 4 && !spec.specimenPanels.includes("True page views"));
delete process.env.DESK_DEV_USER;
const noSpec = await screen("?specimen=1");
check("without the development locks, ?specimen=1 is ignored", noSpec.specimen === false && noSpec.builds.state === "off");

/* ---- 8b. a day without a delivery, and the router's markers ------------------------------- */
console.log("\n8b. a day without a delivery, and the router's markers");
const kept = { first: store.state("drain:first")!, last: store.state("drain:last")! };
const yesterday = store.today(-1);
const yesterdayAt = new Date(Date.now() - 86_400_000).toISOString();
/* As if everything so far had arrived yesterday, and nothing today. */
db.prepare("UPDATE cc_drain_days SET day = ? WHERE day = ?").run(yesterday, store.today());
store.setState("drain:first", yesterdayAt);
store.setState("drain:last", yesterdayAt);
s = await screen();
check(
  "nothing delivered today: today's tile waits and says a day without a delivery is unknown, never a zero",
  s.tiles.viewsToday.state === "waiting" && s.tiles.viewsToday.source === "vercel-drain" && /unknown, not zero/.test(s.tiles.viewsToday.reason),
  s.tiles.viewsToday,
);
const cv = s.chart.state === "ok" ? s.chart.value : null;
check("…and the chart leaves today a gap, with yesterday's 4", cv !== null && cv.days.at(-1) === store.today() && cv.views.at(-1) === null && cv.views[cv.days.indexOf(yesterday)] === 4, cv && { days: cv.days, views: cv.views });
delete process.env.VERCEL_DRAIN_SECRET;
s = await screen();
check("with the secret gone as well, the tile is off with the connector as its step", s.tiles.viewsToday.state === "off" && /VERCEL_DRAIN_SECRET/.test(s.tiles.viewsToday.reason) && /vercel-connect\.sh/.test(s.tiles.viewsToday.step ?? ""), s.tiles.viewsToday);
process.env.VERCEL_DRAIN_SECRET = SECRET;
db.prepare("UPDATE cc_drain_days SET day = ? WHERE day = ?").run(store.today(), yesterday);
store.setState("drain:first", kept.first);
store.setState("drain:last", kept.last);
s = await screen();
check("delivered again today: the tile is the drain's 4 again, its bars of delivered days only", s.tiles.viewsToday.state === "ok" && s.tiles.viewsToday.value.value === 4 && s.tiles.viewsToday.value.series.length === 1, s.tiles.viewsToday);

/* 25 page views three days ago, and not one prefetch, router request or navigation beside them. */
const d3 = Date.now() - 3 * 86_400_000;
const bare = Array.from({ length: 25 }, (_, i) =>
  rec({ id: `specimen-marker-${i}`, requestId: `specimen-marker-req-${i}`, timestamp: d3, source: "static", proxy: px({ timestamp: d3, path: `/specimen-marker-${i % 5}`, statusCode: 200, userAgent: [UA_DESKTOP] }) }),
);
const day3 = drain.classify(bare[0]).day;
store.setState("drain:first", new Date(d3 - 3_600_000).toISOString());
drain.ingest(bare);
s = await screen();
check(
  "a day of 25 page views without one router record is named on the screen: router markers absent",
  s.counting.state === "ok" && JSON.stringify(s.counting.value.markers.gaps) === JSON.stringify([{ day: day3, views: 25 }]) && /Router markers absent/.test(s.tiles.viewsToday.note ?? ""),
  s.counting.state === "ok" ? s.counting.value.markers : s.counting,
);
sys = (await ask("/api/v1/system", { cookie })).json;
const markerCheck = () => sys.checks.find((c: any) => c.name === "Vercel's records carry the router's markers");
check("…and the router-markers check turns red, naming the day", markerCheck()?.ok === false && markerCheck()?.detail.includes(day3), markerCheck());
check("today, with its prefetch and navigation, is not named", s.counting.state === "ok" && !s.counting.value.markers.gaps.some((g: any) => g.day === store.today()));
db.prepare("DELETE FROM cc_drain_days WHERE day = ?").run(day3);
db.prepare("DELETE FROM cc_series WHERE metric = 'vercel.views' AND day = ?").run(day3);
store.setState("drain:first", kept.first);
sys = (await ask("/api/v1/system", { cookie })).json;
check("with that day gone the check vouches again", markerCheck()?.ok === true, markerCheck());

/* ---- 9. the build log ---------------------------------------------------------------------- */
console.log("\n9. the build log");
let log = (await ask("/api/v1/hosting/builds/dpl_specimen123", { cookie })).json;
check("a build's log is off with the token's step", log.log.state === "off" && /DESK_VERCEL_TOKEN/.test(log.log.step ?? ""), log.log);
log = (await ask("/api/v1/hosting/builds/not-a-deployment", { cookie })).json;
check("a bad id is refused in words", log.log.state === "off" && /not a Vercel deployment id/.test(log.log.reason), log.log);
a = await ask("/api/v1/hosting");
check("the screen itself still needs somebody signed in", a.status === 401);

/* ---- 10. the page, through the workstation's interface ------------------------------------- */
console.log("\n10. the page, rendered by the workstation's interface (read-only, if it is running)");
const page = async (p: string): Promise<string | null> => {
  try {
    const r = await real(WEB + p, { signal: AbortSignal.timeout(60_000) });
    return r.ok ? await r.text() : `status ${r.status}`;
  } catch {
    return null;
  }
};
const html = await page("/hosting");
if (html === null) console.log(`  skip  ${WEB} is not running: the page was not rendered here (photograph it with work/shot.mjs)`);
else {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
  check("/hosting renders with no token and no secret: the drain's step", /vercel-connect\.sh/.test(text) && /Not available/.test(text), html.slice(0, 120));
  check("…the token's step", /DESK_VERCEL_TOKEN/.test(text));
  check("…the countries' reason, the counting rules and the dashboard-only links", /carry no country/.test(text) && /How page views are counted/.test(text) && /Only in Vercel/.test(text));
  const spec2 = await page("/hosting?specimen=1");
  const t2 = (spec2 ?? "").replace(/<[^>]+>/g, " ");
  check("/hosting?specimen=1 renders the specimen with its ribbon", /Specimen data/.test(t2) && /\/specimen\/1/.test(t2));
}

/* ---- 11. Vercel's API, from fixtures shaped as openapi.json documents them ------------------- */
console.log("\n11. the Vercel API, answered here from fixtures");
const api = await import("../src/cc/vercel/api.ts");
const T0 = Date.now();
const SHA = "1111111111111111111111111111111111111111";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const v7 = {
  deployments: [
    { uid: "dpl_specimenB1", url: "specimen-b1.vercel.invalid", created: T0 - 3 * 3_600_000, state: "READY", readyState: "READY", buildingAt: T0 - 3 * 3_600_000 + 5_000, ready: T0 - 3 * 3_600_000 + 65_000, target: "production", creator: { uid: "u1", username: "specimen-user", githubLogin: "specimen-login" }, inspectorUrl: "https://vercel.com/specimen/b1" },
    { uid: "dpl_specimenB2", url: "specimen-b2.vercel.invalid", created: T0 - 26 * 3_600_000, state: "ERROR", readyState: "ERROR", buildingAt: T0 - 26 * 3_600_000 + 5_000, ready: T0 - 26 * 3_600_000 + 35_000, target: "production", creator: { uid: "u1", username: "specimen-user" }, errorCode: "SPECIMEN_FAIL", errorMessage: "Specimen build failed" },
  ],
  pagination: { count: 2, next: null, prev: null },
};
const v13 = (uid: string) => {
  const d = v7.deployments.find((x) => x.uid === uid)!;
  return { ...d, id: uid, createdAt: d.created, gitSource: { type: "github", sha: SHA, ref: "main", repoId: 1 }, ...(uid === "dpl_specimenB2" ? { errorStep: "build" } : {}) };
};
const v9 = { targets: { production: { id: "dpl_specimenB1", url: "specimen-b1.vercel.invalid", readyState: "READY", alias: ["www.specimen.example"] } }, alias: [{ domain: "specimen.example", environment: "production" }], paused: false, security: { attackModeEnabled: false, firewallEnabled: true, botIdEnabled: false } };
const domains = { domains: [{ name: "www.specimen.example", verified: true }, { name: "specimen.example", verified: true, redirect: "www.specimen.example", redirectStatusCode: 308 }] };
const attacks = { anomalies: [{ startTime: T0 - 2 * 3_600_000, endTime: T0 - 3_600_000, atMinute: T0 - 2 * 3_600_000, ownerId: "o", projectId: "p", affectedHostMap: {} }] };
const events = [
  { type: "command", created: T0 - 26 * 3_600_000 + 6_000, payload: { text: "Specimen: npm run build", id: "e1", date: 0, deploymentId: "d", serial: "1" } },
  { type: "stdout", created: T0 - 26 * 3_600_000 + 9_000, payload: { text: "Specimen: compiling", id: "e2", date: 0, deploymentId: "d", serial: "2" } },
  { type: "stderr", created: T0 - 26 * 3_600_000 + 20_000, payload: { text: "Specimen: failed with Authorization: Bearer specimenleakvalue123", id: "e3", date: 0, deploymentId: "d", serial: "3" } },
  { type: "deployment-state", created: T0 - 26 * 3_600_000 + 21_000, payload: { text: "", id: "e4", date: 0, deploymentId: "d", serial: "4" } },
];
let mode: "ok" | "limit-domains" | "forbid-domains" | "refuse" = "ok";
const authSeen = new Set<string>();
stub = (u, init) => {
  if (u.host === "api.vercel.com") {
    authSeen.add(String(new Headers(init?.headers).get("authorization")));
    if (u.searchParams.get("teamId") !== "team_5UuOgxnAJbCKU9YpCk22o5aV") return json({ error: { code: "bad_team", message: "specimen: wrong team" } }, 400);
    if (mode === "refuse") return json({ error: { code: "forbidden", message: "Not authorized" } }, 401);
    const p = u.pathname;
    if (p === "/v7/deployments") return u.searchParams.get("target") === "production" && u.searchParams.get("projectId") === "prj_WTjPcDZitjDlW32Cp5920AVLkAj4" ? json(v7) : json({ deployments: [] });
    if (p.startsWith("/v13/deployments/")) return u.searchParams.get("withGitRepoInfo") === "true" ? json(v13(decodeURIComponent(p.split("/").pop()!))) : json({}, 400);
    if (p === "/v9/projects/prj_WTjPcDZitjDlW32Cp5920AVLkAj4") return json(v9);
    if (p === "/v9/projects/prj_WTjPcDZitjDlW32Cp5920AVLkAj4/domains") {
      if (mode === "limit-domains") return json({ error: { code: "rate_limited", message: "Rate limit exceeded", limit: { remaining: 0, reset: Math.round((T0 + 120_000) / 1000), resetMs: T0 + 120_000, total: 500 } } }, 429);
      if (mode === "forbid-domains") return json({ error: { code: "forbidden", message: "Not authorized for this scope" } }, 403);
      return json(domains);
    }
    if (p === "/v1/security/firewall/attack-status") return json(attacks);
    if (p.startsWith("/v3/deployments/") && p.endsWith("/events")) return json(events);
    return json({ error: { code: "not_found", message: "specimen: no fixture" } }, 404);
  }
  return null;
};

process.env.DESK_VERCEL_TOKEN = "specimen-token-not-real";
let said11 = await api.refresh();
check("the job's read: builds, project, domains and anomalies", /2 production builds, newest READY/.test(said11) && /2 domains/.test(said11) && /1 anomalies/.test(said11), said11);
check("every call carried the token in its Authorization header, and only there", authSeen.size === 1 && authSeen.has("Bearer specimen-token-not-real") && !asked.some((a) => a.includes("specimen-token")), [...authSeen].map((x) => x.slice(0, 12)));
s = await screen();
const b = s.builds.state === "ok" ? s.builds.value : [];
check("builds: state, build time from buildingAt to ready, the commit from withGitRepoInfo, the creator, the one production serves", b.length === 2 && b[0].state === "READY" && b[0].durationMs === 60_000 && b[0].sha === SHA && b[0].creator === "specimen-login" && b[0].current === true && b[1].current === false, b[0]);
check("a failed build carries Vercel's code, message and step", b[1]?.state === "ERROR" && b[1].error?.code === "SPECIMEN_FAIL" && b[1].error?.message === "Specimen build failed" && b[1].error?.step === "build", b[1]?.error);
check("the last build tile is the newest", s.tiles.build.state === "ok" && s.tiles.build.value.uid === "dpl_specimenB1");
check("production: its deployment, both addresses, the firewall's flags", s.production.state === "ok" && s.production.value.aliases.join(",") === "www.specimen.example,specimen.example" && s.production.value.firewall.enabled === true && s.production.value.firewall.attackMode === false && !("deploymentId" in s.production.value), s.production.value);
check("domains and the day's anomalies", s.domains.state === "ok" && s.domains.value.length === 2 && s.domains.value[1].redirectStatus === 308 && s.attacks.state === "ok" && s.attacks.value.total === 1 && s.attacks.value.active === 0);
const failNote = store.activity(50, ["deploy"]).filter((x) => /production build failed/.test(x.text));
await api.refresh();
check("the failed build is one line in the activity log, however often it is read", failNote.length === 1 && store.activity(50, ["deploy"]).filter((x) => /production build failed/.test(x.text)).length === 1 && failNote[0]!.href === "/hosting/builds/dpl_specimenB2");
log = (await ask("/api/v1/hosting/builds/dpl_specimenB2", { cookie })).json;
const lines = log.log.state === "ok" ? log.log.value.lines : [];
check("a failed build's log: its text lines in order, the error line marked", lines.length === 3 && lines[0].text === "Specimen: npm run build" && lines[2].error === true, lines);
check("…and a bearer token in a log line is blanked before a browser sees it", lines.length === 3 && !JSON.stringify(log).includes("specimenleakvalue123") && /\[hidden\]/.test(lines[2].text), lines[2]?.text);

console.log("\n    a 429 on one endpoint");
mode = "limit-domains";
store.forget("vercel:domains");
const before429 = asked.length;
said11 = await api.refresh();
s = await screen();
check("domains wait for Vercel's resetMs, and say so; the rest still read", s.domains.state === "waiting" && /rate limit/.test(s.domains.reason) && s.builds.state === "ok", s.domains);
const domainCalls = () => asked.slice(before429).filter((x) => x.endsWith("/domains")).length;
const once = domainCalls();
store.forget("vercel:domains");
await api.refresh();
check("asked again inside that window, the desk does not call the endpoint at all", once === 1 && domainCalls() === 1, `${once} then ${domainCalls()}`);
db.prepare("DELETE FROM cc_state WHERE key = 'vercel:wait:domains'").run();

console.log("\n    a 403 on one endpoint");
mode = "forbid-domains";
store.forget("vercel:domains");
await api.refresh();
s = await screen();
check("only that panel is off, saying the token may not read it; the others stand", s.domains.state === "off" && /403/.test(s.domains.reason) && s.builds.state === "ok" && s.production.state === "ok", s.domains);
sys = (await ask("/api/v1/system", { cookie })).json;
check("a 403 is not a failing source", src("vercel-api")?.state === "connected", src("vercel-api"));

console.log("\n    the token refused");
mode = "refuse";
for (const k of ["builds", "project", "domains", "attacks"]) store.forget(`vercel:${k}`);
db.prepare("DELETE FROM cc_state WHERE key = 'vercel:attack:asked'").run();
let threw = "";
try {
  await api.refresh();
} catch (e) {
  threw = e instanceof Error ? e.message : String(e);
}
check("the job fails, in words", /refused the desk's token \(401\)/.test(threw), threw);
s = await screen();
check("the panels are off with the token's step", ["builds", "production", "domains"].every((p) => s[p].state === "off" && /DESK_VERCEL_TOKEN/.test(s[p].step ?? "")));
sys = (await ask("/api/v1/system", { cookie })).json;
check("and the source is failing, which turns the light red", src("vercel-api")?.state === "failing" && sys.ok === false, src("vercel-api"));
delete process.env.DESK_VERCEL_TOKEN;

/* ---- 12. Vercel's status page and the engine -------------------------------------------------- */
console.log("\n12. the status page (a fixture) and the engine (the server under test stands in for it)");
const status = await import("../src/cc/vercel/status.ts");
const summary = {
  page: { id: "p", name: "Vercel", url: "https://www.vercel-status.com", updated_at: new Date().toISOString() },
  status: { indicator: "minor", description: "Partially Degraded Service" },
  components: [
    { id: "j7g76bfzc8hw", name: "CDN", status: "operational", group_id: null, group: true },
    { id: "zwrthypbz06f", name: "FRA1 - Frankfurt, Germany, Europe", status: "operational", group_id: "j7g76bfzc8hw" },
    { id: "47ltvgp4g9fb", name: "Build & Deploy", status: "degraded_performance", group_id: null, group: true },
    { id: "7ckq6xr6nsbv", name: "Builds", status: "degraded_performance", group_id: "47ltvgp4g9fb" },
    { id: "specimen-other-builds", name: "Builds", status: "major_outage", group_id: "97734y7cq19g" },
    { id: "kgcsn9c73xzf", name: "Functions", status: "operational", group_id: null },
    { id: "rxynwj392p81", name: "API", status: "operational", group_id: null },
  ],
  incidents: [
    { id: "specimen-inc-1", name: "Specimen: builds are slow", status: "investigating", impact: "minor", created_at: new Date().toISOString(), shortlink: "https://stspg.io/specimen", components: [{ id: "7ckq6xr6nsbv", name: "Builds" }] },
    { id: "specimen-inc-2", name: "Specimen: something elsewhere", status: "identified", impact: "minor", created_at: new Date().toISOString(), components: [{ id: "specimen-other-builds", name: "Builds" }] },
  ],
};
stub = (u) => (u.host === "www.vercel-status.com" && u.pathname === "/api/v2/summary.json" ? json(summary) : null);
await status.readStatus();
s = await screen();
const parts = s.platform.state === "ok" ? s.platform.value.components : [];
check("the watched parts by id, never by name: the other 'Builds' (in an outage) is not ours", parts.map((p: any) => p.id).join(",") === "zwrthypbz06f,7ckq6xr6nsbv,kgcsn9c73xzf,rxynwj392p81" && parts.find((p: any) => p.id === "7ckq6xr6nsbv")?.status === "degraded_performance", parts.map((p: any) => `${p.name}:${p.status}`));
check("the incident touching Builds comes first and says so; the other touches nothing of ours", s.platform.value.incidents[0]?.id === "specimen-inc-1" && s.platform.value.incidents[0].touches.join() === "Builds" && s.platform.value.incidents[1]?.touches.length === 0);
let vnotes = store.activity(20, ["vercel"]);
check("an incident touching a watched part is one line in the activity log; the other is not", vnotes.length === 1 && /builds are slow/.test(vnotes[0]!.text), vnotes.map((x) => x.text));
summary.incidents = [];
await status.readStatus();
vnotes = store.activity(20, ["vercel"]);
check("when it is no longer unresolved, a second line says so", vnotes.length === 2 && vnotes.some((x) => /no longer listed/.test(x.text)), vnotes.map((x) => x.text));
stub = null;

const engine = await import("../src/cc/vercel/engine.ts");
process.env.ENGINE_URL = BASE; /* its /health answers { ok: true, … }, as the engine's does */
process.env.ENGINE_PUBLIC_URL = `${BASE}/auth`; /* /auth/health: past the gate, and a 404, as a broken route would be */
const e1 = await engine.checkEngine();
check("the engine answering 200 with ok: true is up, with its time", e1.ok === true && e1.status === 200 && typeof e1.ms === "number", e1);
const pub = engine.enginePublic();
check("the public address answering 404 is down, in its own words", pub !== null && pub.ok === false && pub.status === 404 && /answered 404/.test(pub.failure ?? ""), pub);
process.env.ENGINE_URL = "http://127.0.0.1:9";
await engine.checkEngine();
await engine.checkEngine();
const down = engine.engineLocal();
check("nothing listening is down too, and two in a row open an outage in the log", down !== null && down.ok === false && down.status === 0 && store.activity(10, ["engine"]).some((x) => /stopped answering/.test(x.text)), down?.failure);
process.env.ENGINE_URL = BASE;
await engine.checkEngine();
check("the next good check closes it", store.activity(10, ["engine"]).some((x) => /answers again/.test(x.text)));
s = await screen();
check("the engine panel: the newest check, with its 24 hours (2 of 4 passed)", s.engine.local.state === "ok" && s.engine.local.value.ok === true && s.engine.local.value.checks === 4 && s.engine.local.value.passed === 2, s.engine.local.value && { checks: s.engine.local.value.checks, passed: s.engine.local.value.passed });

check("nothing tried to leave this machine", left.length === 0, left.slice(0, 5).join(", "));
await finish();
