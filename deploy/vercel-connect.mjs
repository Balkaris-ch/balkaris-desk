// The Vercel half of deploy/vercel-connect.sh. Run by it, not by hand.
//
//   node deploy/vercel-connect.mjs plan          the bodies it would send (the secret shown as a placeholder); no network
//   node deploy/vercel-connect.mjs find          is there a drain to the desk's door? stdout: "none" or "found <id> <status> <secret>"
//   node deploy/vercel-connect.mjs secret <id>   the drain's signing secret on stdout, for the caller's variable ONLY
//   node deploy/vercel-connect.mjs test          ask Vercel to deliver a test batch to the door (POST /v1/drains/test)
//   node deploy/vercel-connect.mjs create        create the drain (POST /v1/drains)
//
// The team token arrives in VERCEL_CONNECT_TOKEN and the drain's secret in
// DRAIN_SECRET, both from the calling script's environment. Neither is ever
// printed, put in an address or passed as an argument: the token travels in
// the Authorization header only. Everything printed is a name or a state, on
// stderr; stdout carries only what the caller captures.
//
// Every endpoint and body is the current documented one (vercel.com/openapi.json,
// read 2 Oct 2026; the body's shape is also what Vercel's own Terraform provider
// sends, client/log_drain.go):
//
//   GET  /v1/drains?projectId=     getDrains      the team's drains for the project
//   GET  /v1/drains/{id}           getDrain       one drain, its delivery.secret included
//   POST /v1/drains/test           testDrain      "Validate Drain delivery configuration using sample events"
//   POST /v1/drains                createDrain    { name, projects: "some", projectIds, filter: { version: "v2",
//                                                  filter: { type: "basic", log: { sources }, deployment: { environments } } },
//                                                  schemas: { log: { version: "v1" } }, delivery: { type: "http", endpoint,
//                                                  encoding, compression, headers, secret }, source: { kind: "self-served" } }

const API = "https://api.vercel.com";
const TOKEN = (process.env.VERCEL_CONNECT_TOKEN ?? "").trim();
const SECRET = (process.env.DRAIN_SECRET ?? "").trim();
const TEAM = (process.env.VERCEL_TEAM_ID ?? "").trim() || "team_5UuOgxnAJbCKU9YpCk22o5aV";
const PROJECT = (process.env.VERCEL_PROJECT_ID ?? "").trim() || "prj_WTjPcDZitjDlW32Cp5920AVLkAj4";
const ENDPOINT = (process.env.DRAIN_ENDPOINT ?? "").trim() || "https://desk.balkaris.ch/drain/vercel";
const NAME = "desk-visits";
/* static: pages and files, cached ones included; lambda and edge: what functions answer; build: build output (counted as "not a request"). */
const SOURCES = ["static", "lambda", "edge", "build"];

const say = (line) => process.stderr.write(`${line}\n`);
/** Anything Vercel says back, with the token and the secret blanked should it ever echo them. */
const clean = (text) => {
  let t = String(text ?? "");
  for (const v of [TOKEN, SECRET]) if (v) t = t.split(v).join("[hidden]");
  return t.slice(0, 300);
};

/*
 * The test batch carries a header the drain itself never does
 * (`delivery.headers` is free-form in testDrain's schema). The door answers it
 * 200 and counts nothing, so Vercel's sample records never land in the
 * figures, and a drain whose creation then fails cannot look delivered.
 * It must match TEST_HEADER in src/cc/vercel/drain.ts.
 */
const TEST_HEADER = "x-desk-drain-test";
const delivery = (secret, headers = {}) => ({ type: "http", endpoint: ENDPOINT, encoding: "ndjson", compression: "none", headers, secret });
const createBody = (secret) => ({
  name: NAME,
  projects: "some",
  projectIds: [PROJECT],
  filter: { version: "v2", filter: { type: "basic", log: { sources: SOURCES }, deployment: { environments: ["production"] } } },
  schemas: { log: { version: "v1" } },
  delivery: delivery(secret),
  source: { kind: "self-served" },
});
const testBody = (secret) => ({ schemas: { log: { version: "v1" } }, delivery: delivery(secret, { [TEST_HEADER]: "1" }) });

async function call(method, path, query = {}, body) {
  if (!TOKEN) {
    say("no team token was handed over (VERCEL_CONNECT_TOKEN); run this through deploy/vercel-connect.sh");
    process.exit(2);
  }
  const url = new URL(API + path);
  for (const [k, v] of Object.entries({ ...query, teamId: TEAM })) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    say(`Vercel's API did not answer ${method} ${path}: ${clean(e?.message ?? e)}`);
    process.exit(2);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const refused = (what, r) => {
  const e = r.json?.error;
  say(`${what}: Vercel answered ${r.status}${e?.code ? ` (${e.code})` : ""}${e?.message ? `: ${clean(e.message)}` : ""}`);
  process.exit(2);
};

const same = (a, b) => String(a ?? "").replace(/\/+$/, "") === String(b ?? "").replace(/\/+$/, "");

const [cmd, arg] = process.argv.slice(2);

if (cmd === "plan") {
  const shown = "<64 hex characters, generated on this workstation>";
  say(`GET  ${API}/v1/drains?projectId=${PROJECT}&teamId=${TEAM}       (is there a drain to ${ENDPOINT} already?)`);
  say(`POST ${API}/v1/drains/test?teamId=${TEAM}`);
  say(JSON.stringify(testBody(shown), null, 2).replace(/^/gm, "     "));
  say(`POST ${API}/v1/drains?teamId=${TEAM}`);
  say(JSON.stringify(createBody(shown), null, 2).replace(/^/gm, "     "));
  process.exit(0);
}

if (cmd === "find") {
  const r = await call("GET", "/v1/drains", { projectId: PROJECT });
  if (r.status !== 200) refused("listing the drains", r);
  const list = Array.isArray(r.json?.drains) ? r.json.drains : [];
  const mine = list.filter((d) => same(d?.delivery?.endpoint, ENDPOINT));
  say(`the team has ${list.length} drain${list.length === 1 ? "" : "s"} for the project; ${mine.length} deliver${mine.length === 1 ? "s" : ""} to ${ENDPOINT}`);
  if (!mine.length) {
    process.stdout.write("none\n");
    process.exit(0);
  }
  if (mine.length > 1) say(`more than one drain delivers there (${mine.map((d) => d.id).join(", ")}): the first is used; delete the others in Team Settings > Drains`);
  const d = mine[0];
  const f = d.filterV2?.filter ?? {};
  say(`  ${d.name} (${d.id}): ${d.status ?? "status not said"}${d.disabledReason ? `, ${d.disabledReason}` : ""}`);
  say(`  delivers ${d.delivery?.encoding ?? "?"}${d.delivery?.compression ? `, ${d.delivery.compression}` : ""}; sources ${(f.log?.sources ?? []).join(", ") || "all"}; environments ${(f.deployment?.environments ?? []).join(", ") || "all"}; projects ${(d.projectIds ?? []).join(", ") || "all"}`);
  const readable = typeof d.delivery?.secret === "string" && d.delivery.secret.length > 0 ? "readable" : "hidden";
  process.stdout.write(`found ${d.id} ${d.status ?? "unknown"} ${readable}\n`);
  process.exit(0);
}

if (cmd === "secret") {
  if (!/^[\w-]{4,80}$/.test(arg ?? "")) {
    say("secret: a drain id is needed");
    process.exit(2);
  }
  const r = await call("GET", `/v1/drains/${encodeURIComponent(arg)}`);
  if (r.status !== 200) refused("reading the drain", r);
  const s = r.json?.delivery?.secret;
  if (typeof s !== "string" || !s) {
    say("Vercel does not show this drain's secret");
    process.exit(3);
  }
  process.stdout.write(s);
  process.exit(0);
}

if (cmd === "test" || cmd === "create") {
  if (!/^[0-9a-f]{64}$/.test(SECRET) && cmd === "create") say("the secret handed over is not 64 hex characters; it is used as it is");
  if (!SECRET) {
    say(`${cmd}: no secret was handed over (DRAIN_SECRET)`);
    process.exit(2);
  }
  if (cmd === "test") {
    const r = await call("POST", "/v1/drains/test", {}, testBody(SECRET));
    if (r.status !== 200) refused("Vercel's test of the door", r);
    /* 200 is either {} or { endpoint, error, status }: the second is the door's failure, in Vercel's words. */
    if (r.json && typeof r.json === "object" && "error" in r.json) {
      say(`Vercel's test delivery did not go through: ${clean(r.json.status ?? "")} ${clean(r.json.error)}`);
      process.exit(4);
    }
    say("Vercel's test delivery reached the door and was accepted; nothing in it was counted");
    process.exit(0);
  }
  const r = await call("POST", "/v1/drains", {}, createBody(SECRET));
  if (r.status !== 200) refused("creating the drain", r);
  say(`created ${r.json?.name ?? NAME} (${r.json?.id ?? "no id returned"}): ${r.json?.status ?? "status not said"}`);
  process.stdout.write(`created ${r.json?.id ?? ""} ${r.json?.status ?? "unknown"}\n`);
  process.exit(0);
}

say("usage: node deploy/vercel-connect.mjs plan | find | secret <id> | test | create   (through deploy/vercel-connect.sh)");
process.exit(2);
