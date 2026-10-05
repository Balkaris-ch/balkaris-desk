import http from "node:http";
import https from "node:https";
import { db } from "../../db.ts";
import { esc, tellOwner } from "../../telegram.ts";
import type { Job } from "../scheduler.ts";
import { keep, kept, note, record, setState, state, today } from "../store.ts";
import type { EngineCheck, EngineLocal, EnginePublic } from "../../../web/src/contract/hosting.ts";

/**
 * Is the engine answering: the desk's own check, the way src/cc/site/probes.ts
 * checks the website.
 *
 * The engine (balkaris-engine, on the same box) is what the website's
 * enquiry form, booking calendar and slots call. Its /health answers
 * `{ ok, ai_mode, store, crm }` and does no work, so it is safe to ask often:
 *
 *   every 2 minutes   over loopback, http://127.0.0.1:3000/health (ENGINE_URL,
 *                     the same setting src/cc/leads.ts reads): the engine
 *                     itself, with nothing in between
 *   every hour        the public https://operation.balkaris.ch/health
 *                     (ENGINE_PUBLIC_URL) and that name's certificate: the
 *                     way the website reaches it, through Caddy
 *
 * WHAT COUNTS AS UP: status 200 AND a body that says `ok: true`. Anything
 * else is written down as it came: a 502 or 503 while the engine's database
 * is paused, a redirect from some other program on the port, a timeout. A
 * fresh connection every time, no redirect followed.
 *
 * Two failed loopback checks in a row are an outage (one is a lost moment):
 * a line in the feed when it starts and another when it ends. Checks are
 * kept 35 days; one line a day (the share that passed) goes into cc_series.
 */

const LOCAL = (): string => `${(process.env.ENGINE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "")}/health`;
const PUBLIC = (): string => `${(process.env.ENGINE_PUBLIC_URL ?? "https://operation.balkaris.ch").replace(/\/+$/, "")}/health`;

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_engine_checks (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      TEXT NOT NULL,
    day     TEXT NOT NULL,
    /* local | public */
    target  TEXT NOT NULL,
    status  INTEGER NOT NULL,
    ok      INTEGER NOT NULL,
    ms      INTEGER,
    failure TEXT,
    /* What /health said: a JSON of { ok, aiMode, store, crm }, or null. */
    body    TEXT
  );
  CREATE INDEX IF NOT EXISTS cc_engine_checks_target_at ON cc_engine_checks (target, at);
`);

/** One GET of /health on a connection of its own. Never throws. */
export function askHealth(url: string, timeout = 10_000): Promise<EngineCheck> {
  return new Promise((resolve) => {
    const at = new Date().toISOString();
    const t0 = performance.now();
    let settled = false;
    const done = (c: Partial<EngineCheck>) => {
      if (settled) return;
      settled = true;
      resolve({ at, url, status: 0, ok: false, ms: null, failure: null, body: null, ...c });
    };
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return done({ failure: "not an address" });
    }
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(u, { method: "GET", agent: false, timeout, headers: { accept: "application/json", "user-agent": "BalkarisDesk/1.0 (+https://desk.balkaris.ch)" } }, (res) => {
      const ms = Math.round(performance.now() - t0);
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size <= 64 * 1024) chunks.push(c);
      });
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        let body: EngineCheck["body"] = null;
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
          if (typeof j.ok === "boolean") {
            const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 40) : null);
            body = { ok: j.ok, aiMode: s(j.ai_mode), store: s(j.store), crm: s(j.crm) };
          }
        } catch {
          body = null;
        }
        const ok = status === 200 && body?.ok === true;
        const where = res.headers.location ? ` to ${String(res.headers.location).slice(0, 60)}` : "";
        const failure = ok ? null : status === 200 ? "answered 200, but not as the engine's /health does (no `ok: true`)" : `answered ${status}${where}${body ? "" : ", not the engine's health answer"}`;
        done({ status, ok, ms, body, failure });
      });
      res.on("error", (e) => done({ status: res.statusCode ?? 0, ms, failure: `the answer broke off: ${e.message}`.slice(0, 160) }));
    });
    req.on("timeout", () => req.destroy(new Error(`no answer in ${Math.round(timeout / 1000)} s`)));
    req.on("error", (e) => done({ failure: (e.message || (e as NodeJS.ErrnoException).code || "connection failed").slice(0, 160) }));
    req.end();
  });
}

const insert = db.prepare("INSERT INTO cc_engine_checks (at, day, target, status, ok, ms, failure, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

function store(target: "local" | "public", c: EngineCheck): void {
  insert.run(c.at, today(), target, c.status, c.ok ? 1 : 0, c.ms, c.failure, c.body ? JSON.stringify(c.body) : null);
}

const minutes = (ms: number): string => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 120 ? `${m} minute${m === 1 ? "" : "s"}` : `${Math.round(m / 60)} hours`;
};

/** Two failures in a row open an outage; the first success after closes it. */
function watch(c: EngineCheck): void {
  const openSince = state("engine:down") || "";
  if (c.ok) {
    setState("engine:fails", "0");
    if (openSince) {
      setState("engine:down", "");
      note("engine", `The engine answers again after ${minutes(Date.parse(c.at) - Date.parse(openSince))}`, { tone: "good", detail: `${c.url} answered 200 at ${c.at}.`, href: "/hosting", dedupe: `engine:down:${openSince}:end` });
      void tellOwner(`The engine answers again, after ${minutes(Date.parse(c.at) - Date.parse(openSince))}.`);
    }
    return;
  }
  const fails = Number(state("engine:fails") ?? "0") + 1;
  setState("engine:fails", String(fails));
  if (fails === 1) setState("engine:firstfail", c.at);
  if (fails >= 2 && !openSince) {
    const started = state("engine:firstfail") || c.at;
    setState("engine:down", started);
    note("engine", "The engine stopped answering", { tone: "bad", at: started, detail: `Two checks of ${c.url} in a row failed (${c.failure ?? "no answer"}). The website's enquiry form and booking calendar call it.`, href: "/hosting", dedupe: `engine:down:${started}:start` });
    /* Said to the owner too, like the website's (src/cc/site/probes.ts): while it is down no enquiry arrives. */
    void tellOwner(`<b>The engine stopped answering</b>: two checks in a row failed (${esc(c.failure ?? "no answer")}). The website's enquiry form and booking calendar call it.`);
  }
}

/** One round: loopback always, the public address and its certificate once an hour. */
export async function checkEngine(): Promise<EngineCheck> {
  const local = await askHealth(LOCAL());
  store("local", local);
  watch(local);
  const day = today();
  const t = db.prepare("SELECT COUNT(*) AS n, SUM(ok) AS good FROM cc_engine_checks WHERE target = 'local' AND day = ?").get(day) as { n: number; good: number | null };
  if (t.n) record("engine.up", ((t.good ?? 0) / t.n) * 100, day);

  if (Date.now() - Number(state("engine:public:last") ?? "0") > 3_600_000) {
    setState("engine:public:last", String(Date.now()));
    const pub = await askHealth(PUBLIC());
    store("public", pub);
    try {
      const { certificateOf } = await import("../site/probes.ts");
      keep("engine:cert", await certificateOf(new URL(PUBLIC()).hostname));
    } catch (e) {
      keep("engine:cert", { problem: (e instanceof Error ? e.message : String(e)).slice(0, 160) });
    }
    db.prepare("DELETE FROM cc_engine_checks WHERE at < ?").run(new Date(Date.now() - 35 * 86_400_000).toISOString());
  }
  return local;
}

export const engineJob: Job = {
  name: "engine",
  title: "Check that the engine answers",
  every: 2 * 60,
  delay: 25,
  run: async () => {
    const c = await checkEngine();
    return c.ok ? `answers in ${c.ms} ms (${c.body?.store ?? "?"}, AI ${c.body?.aiMode ?? "?"})` : `${c.url}: ${c.failure ?? "no answer"}`;
  },
};

/* ---------- reading it back ------------------------------------------------------------- */

interface Row {
  at: string;
  status: number;
  ok: number;
  ms: number | null;
  failure: string | null;
  body: string | null;
}

const asCheck = (r: Row, url: string): EngineCheck => {
  let body: EngineCheck["body"] = null;
  try {
    body = r.body ? (JSON.parse(r.body) as EngineCheck["body"]) : null;
  } catch {
    body = null;
  }
  return { at: r.at, url, status: r.status, ok: !!r.ok, ms: r.ms, failure: r.failure, body };
};

/** The newest loopback check with the last 24 hours behind it, or null before the first. */
export function engineLocal(): EngineLocal | null {
  const newest = db.prepare("SELECT at, status, ok, ms, failure, body FROM cc_engine_checks WHERE target = 'local' ORDER BY id DESC LIMIT 1").get() as Row | undefined;
  if (!newest) return null;
  const from = new Date(Date.now() - 86_400_000).toISOString();
  const t = db.prepare("SELECT COUNT(*) AS n, TOTAL(ok) AS good, MIN(at) AS first FROM cc_engine_checks WHERE target = 'local' AND at >= ?").get(from) as { n: number; good: number; first: string | null };
  const hours = db
    .prepare("SELECT CAST((julianday(at) - julianday(?)) * 24 AS INTEGER) AS h, AVG(ms) AS ms FROM cc_engine_checks WHERE target = 'local' AND at >= ? AND ok = 1 AND ms IS NOT NULL GROUP BY h ORDER BY h")
    .all(from, from) as { h: number; ms: number }[];
  const first = t.first ? Math.max(0, Math.floor((Date.parse(t.first) - Date.parse(from)) / 3_600_000)) : 0;
  const per = new Map(hours.map((x) => [x.h, Math.round(x.ms)]));
  const spark: (number | null)[] = [];
  for (let h = first; h < 24; h++) spark.push(per.get(h) ?? null);
  return { ...asCheck(newest, LOCAL()), checks: t.n, passed: t.good, since: t.first ?? newest.at, spark };
}

/** The newest public check with the certificate read beside it, or null before the first. */
export function enginePublic(): EnginePublic | null {
  const newest = db.prepare("SELECT at, status, ok, ms, failure, body FROM cc_engine_checks WHERE target = 'public' ORDER BY id DESC LIMIT 1").get() as Row | undefined;
  if (!newest) return null;
  const c = kept<{ daysLeft?: number | null; validTo?: string | null; issuer?: string | null; trusted?: boolean; problem?: string | null }>("engine:cert")?.value ?? null;
  return {
    ...asCheck(newest, PUBLIC()),
    cert: c ? { daysLeft: c.daysLeft ?? null, validTo: c.validTo ?? null, issuer: c.issuer ?? null, trusted: !!c.trusted, problem: c.problem ?? null } : null,
  };
}

export const engineUrls = (): { local: string; public: string } => ({ local: LOCAL(), public: PUBLIC() });
