import { lookup, Resolver } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import type { DayPoint, Range, Reading, Share } from "../../../web/src/contract/common.ts";
import { db } from "../../db.ts";
import type { Job } from "../scheduler.ts";
import { keep, kept, note, off, ok, record, series, setState, state, today, waiting } from "../store.ts";
import { abs, median, percentile, siteHost, twinHost, UA } from "./http.ts";

/**
 * Is the website answering, and how fast.
 *
 * Every two minutes the desk asks the site for a handful of addresses and
 * writes down what came back: the status, the time to the first byte and to
 * the last, what Vercel's cache said, which edge region answered. Once an
 * hour it also reads the TLS certificate's expiry and the DNS answers.
 *
 * ONE VANTAGE POINT. All of this is measured from the desk's own server in
 * a Hetzner data centre. It says the site answers THERE, in so many
 * milliseconds FROM THERE. A visitor in Zürich on a phone sees other numbers,
 * so response times are a trend to watch, not a fact about visitors. And
 * when the desk itself is down nothing is measured: the history then has a
 * gap, and a gap is not downtime. Uptime is "checks that passed out of
 * checks that ran", never "out of the minutes in the day".
 *
 * A FRESH CONNECTION EVERY TIME (`agent: false`), so each sample includes
 * the DNS lookup and the TLS handshake a first-time visitor would pay, and
 * no sample is flattered by a connection the one before left open.
 *
 * THE HISTORY EXISTS NOWHERE ELSE. Samples are kept 35 days; one line per
 * day (uptime, checks, the median response time) goes into cc_series and is
 * kept for good. None of it can be asked for in arrears.
 *
 * WHAT IS PROBED. The home page, the insights index and the sitemap (all
 * prerendered pages served from Vercel's cache), one immutable file, and one
 * address that wakes a function: a GET of /api/ask. That route answers only
 * POST (it is the search box's AI answer), so Next turns a GET away with 405
 * before a line of the route's own code runs: no rate-limit bucket is taken
 * and no model is called, yet the request travels the whole way to a function
 * and back (x-vercel-cache MISS, and x-vercel-id names the function's region
 * after the edge's: "fra1::iad1::…"). So the 405 IS the healthy answer for
 * that target. Should the route ever answer a GET with a success, it has
 * grown a GET handler that might cost money, and the probe stops calling it
 * by itself and says why. Never probed, whatever the environment says: the
 * enquiry form, the booking calendar and the guide (`NEVER`). The engine
 * (operation.balkaris.ch) is not probed here at all: it is not the website.
 *
 * AN INCIDENT is two failed checks of the home page in a row: one failure
 * is a lost packet, two is an outage. It opens with a line in the feed and
 * closes with another that says how long it lasted. Nothing is sent
 * anywhere else in this stage.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_probes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,
    /* The studio's day (Zurich), so "today's uptime" is a GROUP BY. */
    day        TEXT NOT NULL,
    target     TEXT NOT NULL,
    /* 0 when nothing answered. */
    status     INTEGER NOT NULL,
    ok         INTEGER NOT NULL,
    /* Milliseconds until the TLS handshake finished: DNS + TCP + TLS. */
    connect_ms INTEGER,
    ttfb_ms    INTEGER,
    total_ms   INTEGER,
    /* Bytes as they crossed the wire (compressed). */
    bytes      INTEGER,
    /* Vercel's x-vercel-cache: HIT, MISS, STALE, PRERENDER, REVALIDATED, BYPASS. */
    cache      TEXT,
    /* The edge region that answered, from x-vercel-id: "fra1". */
    region     TEXT,
    failure    TEXT
  );
  CREATE INDEX IF NOT EXISTS cc_probes_target_at ON cc_probes (target, at);

  CREATE TABLE IF NOT EXISTS cc_incidents (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    started TEXT NOT NULL,
    ended   TEXT,
    cause   TEXT NOT NULL
  );
`);

/* The region a function ran in, added after the table was first made: a
   column a table made earlier does not have yet is added, once. */
if (!(db.prepare("PRAGMA table_info(cc_probes)").all() as { name: string }[]).some((c) => c.name === "fn_region")) {
  db.exec("ALTER TABLE cc_probes ADD COLUMN fn_region TEXT");
}

export interface ProbeTarget {
  /** Stable: "home", "insights", "sitemap", "asset", "function". */
  id: string;
  /** What a person reads. */
  label: string;
  path: string;
  /** The status that counts as a healthy answer: 200, except for the function probe (405, see the note above). */
  expect: number;
}

/**
 * Routes a robot must never call, whatever the environment says: the
 * enquiry form, the enquiry records, the booking calendar (a GET that asks
 * the engine and both founders' calendars) and the guide.
 */
const NEVER = /^\/api\/(apply|enquiry|slots|guide)\b/;

/**
 * Why the function probe stopped itself today, or null. It stops for the
 * rest of the day and asks once more the next: one request a day is the
 * most a route that changed under it can cost, and a route that is turned
 * away from GET again is timed again without anybody having to step in.
 */
function stoppedToday(): string | null {
  try {
    const s = JSON.parse(state("probe:function:stopped") ?? "null") as { day?: string; why?: string } | null;
    return s?.day === today() ? (s.why ?? "stopped") : null;
  } catch {
    return null;
  }
}

/** The function probe's address and healthy answer: GET /api/ask and 405 unless the environment names another. */
function functionTarget(): ProbeTarget | null {
  const path = process.env.SITE_FUNCTION_PROBE ?? "/api/ask";
  if (path === "off" || !path.startsWith("/") || NEVER.test(path)) return null;
  if (stoppedToday()) return null;
  const expect = Number(process.env.SITE_FUNCTION_PROBE_STATUS ?? (path === "/api/ask" ? 405 : 200));
  return { id: "function", label: "A function", path, expect: Number.isInteger(expect) ? expect : 200 };
}

/** The addresses asked every two minutes. */
export function targets(): ProbeTarget[] {
  const fn = functionTarget();
  return [
    { id: "home", label: "Home page", path: "/", expect: 200 },
    { id: "insights", label: "Insights index", path: "/insights", expect: 200 },
    { id: "sitemap", label: "Sitemap", path: "/sitemap.xml", expect: 200 },
    /* The site's own fallback share picture and the logo in its structured
       data: nine kilobytes, served immutable from the cache, and not a file
       anyone renames lightly. */
    { id: "asset", label: "A cached file", path: process.env.SITE_ASSET_PROBE ?? "/ph/og-default.webp", expect: 200 },
    ...(fn ? [fn] : []),
  ];
}

export interface Sample {
  /** ISO time the request was sent. */
  at: string;
  target: string;
  /** 0 when nothing answered. */
  status: number;
  ok: boolean;
  /** Milliseconds for DNS + TCP + TLS, or null when the connection never completed. */
  connectMs: number | null;
  /** Milliseconds to the first byte of the answer, connection included. */
  ttfbMs: number | null;
  /** Milliseconds to the last byte. */
  totalMs: number | null;
  /** Bytes received, compressed as sent. */
  bytes: number | null;
  /** Vercel's cache answer. */
  cache: string | null;
  /** The edge region that answered ("fra1"). */
  region: string | null;
  /** The region a function ran in ("iad1"), when one did; null for an answer from the cache. */
  functionRegion: string | null;
  /** Why it failed, when it did. */
  failure: string | null;
}

/**
 * The regions in Vercel's x-vercel-id. "fra1::iad1::kcdbm-…" is the edge in
 * Frankfurt handing the request to a function in Washington; "fra1::kcdbm-…"
 * is the edge answering by itself. The last part is the request's own id.
 */
export function regionsOf(id: string): { edge: string | null; fn: string | null } {
  const parts = id.split("::").filter(Boolean);
  if (parts.length < 2) return { edge: null, fn: null };
  return { edge: parts[0] ?? null, fn: parts.length >= 3 ? (parts[1] ?? null) : null };
}

/** One request on a connection of its own, timed. Never throws. */
function ask(t: ProbeTarget, url: string, timeout = 10_000): Promise<Sample> {
  const target = t.id;
  return new Promise((resolve) => {
    const at = new Date().toISOString();
    const t0 = performance.now();
    const since = () => Math.round(performance.now() - t0);
    let connectMs: number | null = null;
    let settled = false;
    const done = (s: Partial<Sample>) => {
      if (settled) return;
      settled = true;
      resolve({ at, target, status: 0, ok: false, connectMs, ttfbMs: null, totalMs: since(), bytes: null, cache: null, region: null, functionRegion: null, failure: null, ...s });
    };

    const u = new URL(url);
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      u,
      { method: "GET", agent: false, timeout, headers: { "user-agent": UA, accept: "*/*", "accept-encoding": "br, gzip" } },
      (res) => {
        const ttfbMs = since();
        let bytes = 0;
        res.on("data", (c: Buffer) => {
          bytes += c.length;
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const regions = regionsOf(String(res.headers["x-vercel-id"] ?? ""));
          done({
            status,
            ok: status === t.expect,
            ttfbMs,
            totalMs: since(),
            bytes,
            cache: res.headers["x-vercel-cache"] ? String(res.headers["x-vercel-cache"]) : null,
            region: regions.edge,
            functionRegion: regions.fn,
            failure: status === t.expect ? null : `answered ${status}${t.expect === 200 ? "" : `, ${t.expect} expected`}`,
          });
        });
        res.on("error", (e) => done({ status: res.statusCode ?? 0, ttfbMs, failure: `the answer broke off: ${e.message}`.slice(0, 160) }));
      },
    );
    req.on("socket", (s) => {
      s.once(u.protocol === "http:" ? "connect" : "secureConnect", () => {
        connectMs = since();
      });
    });
    req.on("timeout", () => req.destroy(new Error(`no answer in ${Math.round(timeout / 1000)} s`)));
    req.on("error", (e) => done({ failure: (e.message || (e as NodeJS.ErrnoException).code || "connection failed").slice(0, 160) }));
    req.end();
  });
}

/* ---------- certificate and DNS, hourly -------------------------------------- */

export interface Certificate {
  host: string;
  /** The name on the certificate. */
  subject: string | null;
  /** Who signed it. */
  issuer: string | null;
  validFrom: string | null;
  /** ISO. The day it stops working unless renewed. */
  validTo: string | null;
  /** Whole days until then; negative when it has passed. */
  daysLeft: number | null;
  /** Whether Node's trust store accepts the chain for this host. */
  trusted: boolean;
  /** What was wrong, when not trusted or not readable. */
  problem: string | null;
}

/** Exported for the engine's hourly check (src/cc/vercel/engine.ts), which reads operation.balkaris.ch's the same way. */
export function certificateOf(host: string): Promise<Certificate> {
  return new Promise((resolve) => {
    const blank: Certificate = { host, subject: null, issuer: null, validFrom: null, validTo: null, daysLeft: null, trusted: false, problem: null };
    /* rejectUnauthorized is off ON PURPOSE: an expired certificate is exactly
       the one whose dates the desk must still be able to read. Nothing is
       sent over this connection; `trusted` carries the verdict. */
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const c = socket.getPeerCertificate();
      const to = c?.valid_to ? new Date(c.valid_to) : null;
      resolve({
        host,
        subject: (c?.subject?.CN as string | undefined) ?? null,
        issuer: ((c?.issuer?.O ?? c?.issuer?.CN) as string | undefined) ?? null,
        validFrom: c?.valid_from ? new Date(c.valid_from).toISOString() : null,
        validTo: to ? to.toISOString() : null,
        daysLeft: to ? Math.floor((to.getTime() - Date.now()) / 86_400_000) : null,
        trusted: socket.authorized,
        problem: socket.authorized ? null : String(socket.authorizationError ?? "not trusted"),
      });
      socket.end();
    });
    socket.on("timeout", () => socket.destroy(new Error("no answer in 10 s")));
    socket.on("error", (e) => resolve({ ...blank, problem: e.message.slice(0, 160) }));
  });
}

export interface DnsAnswer {
  host: string;
  /** IPv4 addresses. */
  a: string[];
  /** IPv6 addresses. */
  aaaa: string[];
  /** The name it is an alias of, when it is one. Empty when the system's lookup answered, which does not say. */
  cname: string[];
  /** Why nothing came back, when nothing did. */
  problem: string | null;
  /**
   * Who answered. "resolver": the DNS servers the system names, asked record
   * by record. "system": the operating system's own lookup, used when those
   * servers would not talk to a program directly (a local resolver that only
   * the system may use); it gives the addresses, not the alias.
   */
  via: "resolver" | "system";
}

async function dnsOf(host: string): Promise<DnsAnswer> {
  const r = new Resolver({ timeout: 5_000, tries: 2 });
  /* "No such record" is an answer (an empty one), not a failure. */
  const quiet = async (work: () => Promise<string[]>): Promise<{ list: string[]; error: string | null }> => {
    try {
      return { list: (await work()).sort(), error: null };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      return { list: [], error: code === "ENODATA" || code === "ENOTFOUND" ? null : code || (e instanceof Error ? e.message : String(e)) };
    }
  };
  const [a, aaaa, cname] = await Promise.all([quiet(() => r.resolve4(host)), quiet(() => r.resolve6(host)), quiet(() => r.resolveCname(host))]);
  const none = !a.list.length && !aaaa.list.length && !cname.list.length;
  if (!none) return { host, a: a.list, aaaa: aaaa.list, cname: cname.list, problem: null, via: "resolver" };

  const unreachable = a.error ?? aaaa.error;
  if (!unreachable) return { host, a: [], aaaa: [], cname: [], problem: "no address records", via: "resolver" };
  /* The servers did not answer at all: ask the way every other program on
     the machine asks, before calling the name unresolvable. */
  try {
    const found = await lookup(host, { all: true });
    return {
      host,
      a: found.filter((f) => f.family === 4).map((f) => f.address).sort(),
      aaaa: found.filter((f) => f.family === 6).map((f) => f.address).sort(),
      cname: [],
      problem: found.length ? null : "no address records",
      via: "system",
    };
  } catch (e) {
    return { host, a: [], aaaa: [], cname: [], problem: `${unreachable}; the system's own lookup: ${(e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : String(e))}`, via: "system" };
  }
}

async function hourly(): Promise<void> {
  const hosts = [siteHost(), twinHost()];
  const certs: Certificate[] = [];
  for (const h of hosts) certs.push(await certificateOf(h));
  keep("site:tls", certs);
  const answers: DnsAnswer[] = [];
  for (const h of hosts) answers.push(await dnsOf(h));
  keep("site:dns", answers);
  /* Thirty-five days of samples: enough for the 30-day view with room to
     compare, small enough to stay a few megabytes. */
  db.prepare("DELETE FROM cc_probes WHERE at < ?").run(new Date(Date.now() - 35 * 86_400_000).toISOString());
  setState("probe:hourly", String(Date.now()));
}

/* ---------- one round ----------------------------------------------------------- */

const minutes = (ms: number): string => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 120 ? `${m} minute${m === 1 ? "" : "s"}` : `${Math.round(m / 60)} hours`;
};

/** Two failures in a row open an incident; the first success after closes it. */
function watch(home: Sample): void {
  const open = db.prepare("SELECT id, started FROM cc_incidents WHERE ended IS NULL ORDER BY id DESC LIMIT 1").get() as { id: number; started: string } | undefined;
  if (home.ok) {
    setState("probe:fails", "0");
    if (open) {
      db.prepare("UPDATE cc_incidents SET ended = ? WHERE id = ?").run(home.at, open.id);
      note("incident", `The website answers again after ${minutes(Date.parse(home.at) - Date.parse(open.started))}`, {
        tone: "good",
        detail: `It stopped at ${open.started} and answered ${home.status} at ${home.at}.`,
        href: abs("/"),
        dedupe: `incident:${open.id}:end`,
      });
    }
    return;
  }
  const fails = Number(state("probe:fails") ?? "0") + 1;
  setState("probe:fails", String(fails));
  if (fails === 1) setState("probe:firstfail", home.at);
  if (fails >= 2 && !open) {
    const started = state("probe:firstfail") ?? home.at;
    const cause = home.failure ?? "no answer";
    const id = db.prepare("INSERT INTO cc_incidents (started, cause) VALUES (?, ?)").run(started, cause).lastInsertRowid;
    note("incident", "The website stopped answering", {
      tone: "bad",
      at: started,
      detail: `The home page failed two checks in a row (${cause}). Checked from the desk's own server.`,
      href: abs("/"),
      dedupe: `incident:${id}:start`,
    });
  }
}

let probing: Promise<Sample[]> | null = null;

/** Ask every target once, one after the other, and store the answers. Two calls at once share one round. */
export function probe(): Promise<Sample[]> {
  probing ??= round().finally(() => {
    probing = null;
  });
  return probing;
}

async function round(): Promise<Sample[]> {
  const day = today();
  const samples: Sample[] = [];
  const insert = db.prepare(
    "INSERT INTO cc_probes (at, day, target, status, ok, connect_ms, ttfb_ms, total_ms, bytes, cache, region, fn_region, failure) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const t of targets()) {
    const s = await ask(t, abs(t.path));
    samples.push(s);
    insert.run(s.at, day, s.target, s.status, s.ok ? 1 : 0, s.connectMs, s.ttfbMs, s.totalMs, s.bytes, s.cache, s.region, s.functionRegion, s.failure);
    /* The function probe relies on the route turning a GET away. A success
       means it now has a GET handler, which may do real work: stop asking. */
    if (t.id === "function" && t.expect !== 200 && s.status >= 200 && s.status < 300) {
      const why = `GET ${t.path} answered ${s.status} instead of ${t.expect}: the route now handles GET, and a robot calling it every two minutes could cost money. The function probe stopped for today and asks once more tomorrow.`;
      setState("probe:function:stopped", JSON.stringify({ day, why }));
      note("probe", "The function probe stopped itself", { tone: "warn", detail: why, dedupe: `probe:function:stopped:${today()}` });
    }
  }
  setState("probe:last", String(Date.now()));

  const home = samples.find((s) => s.target === "home");
  if (home) watch(home);

  /* Today's line of history, rewritten each round until the day is over. */
  const t = db.prepare("SELECT COUNT(*) AS n, SUM(ok) AS good FROM cc_probes WHERE target = 'home' AND day = ?").get(day) as { n: number; good: number | null };
  if (t.n) {
    record("uptime.percent", ((t.good ?? 0) / t.n) * 100, day);
    record("uptime.checks", t.n, day);
    record("uptime.failed", t.n - (t.good ?? 0), day);
    const times = (db.prepare("SELECT ttfb_ms AS v FROM cc_probes WHERE target = 'home' AND day = ? AND ok = 1 AND ttfb_ms IS NOT NULL").all(day) as { v: number }[]).map((r) => r.v);
    if (times.length) record("response.home.ttfb", median(times), day);
  }

  if (Date.now() - Number(state("probe:hourly") ?? "0") > 3_600_000) {
    try {
      await hourly();
    } catch (e) {
      console.warn(`cc probe: the hourly certificate and DNS check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return samples;
}

/**
 * Run a round if the last one is more than two minutes old. The crawl and
 * the speed test call this between their own requests: the scheduler runs
 * one job at a time, and a five-minute job would otherwise leave a
 * five-minute hole in the uptime record.
 */
export async function probeIfDue(): Promise<void> {
  if (probing || Date.now() - Number(state("probe:last") ?? "0") < 118_000) return;
  try {
    await probe();
  } catch (e) {
    console.warn(`cc probe failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const probeJob: Job = {
  name: "probe",
  title: "Check that the website answers",
  every: 2 * 60,
  delay: 15,
  run: async () => {
    const samples = await probe();
    const failed = samples.filter((s) => !s.ok);
    const home = samples.find((s) => s.target === "home");
    if (failed.length) return `${failed.map((s) => `${s.target}: ${s.failure}`).join("; ")}`;
    return `${samples.length} addresses answer; home in ${home?.ttfbMs ?? "?"} ms`;
  },
};

/* ---------- reading it back ---------------------------------------------------- */

const SPAN: Record<Range, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, "90d": 90 * 86_400_000, "1y": 365 * 86_400_000 };
const DAYS: Record<Range, number> = { "1h": 1, "24h": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
const from = (range: Range): string => new Date(Date.now() - SPAN[range]).toISOString();
/** Ranges the 35 days of samples cannot cover: they are answered from the one-line-a-day history. */
const long = (range: Range): boolean => range === "90d" || range === "1y";

const VANTAGE = "Measured from the desk's own server, one vantage point. When the desk is down there is a gap, not downtime.";
const NO_CHECK = "No check has run yet. The first runs within a minute of the desk starting, then every two minutes.";

const lastAt = (): string | null => {
  const ms = Number(state("probe:last") ?? "0");
  return ms ? new Date(ms).toISOString() : null;
};

export interface Uptime {
  /** Checks of the home page that passed, out of those that ran, as a percentage. */
  percent: number;
  checks: number;
  failed: number;
  /** When the oldest check in the range ran: where this figure honestly begins. */
  since: string;
  /** One point per day, oldest first. */
  days: DayPoint[];
}

/** Uptime of the home page over a range. */
export function uptime(range: Range = "30d"): Reading<Uptime> {
  const at = lastAt();
  if (!at) return waiting("probe", NO_CHECK);
  const days: DayPoint[] = series("uptime.percent", DAYS[range]).map((p) => ({ date: p.day, value: p.value }));
  if (long(range)) {
    const checks = series("uptime.checks", DAYS[range]);
    const failed = series("uptime.failed", DAYS[range]);
    const n = checks.reduce((a, p) => a + p.value, 0);
    const f = failed.reduce((a, p) => a + p.value, 0);
    if (!n || !checks[0]) return waiting("probe", NO_CHECK);
    return ok({ percent: ((n - f) / n) * 100, checks: n, failed: f, since: checks[0].day, days }, "probe", at, VANTAGE);
  }
  const t = db.prepare("SELECT COUNT(*) AS n, SUM(ok) AS good, MIN(at) AS first FROM cc_probes WHERE target = 'home' AND at >= ?").get(from(range)) as { n: number; good: number | null; first: string | null };
  if (!t.n || !t.first) return waiting("probe", "No check has run inside this range yet.");
  return ok({ percent: ((t.good ?? 0) / t.n) * 100, checks: t.n, failed: t.n - (t.good ?? 0), since: t.first, days }, "probe", at, VANTAGE);
}

export interface ResponseTimes {
  target: string;
  /** Minutes each point covers. */
  bucketMinutes: number;
  /**
   * Oldest first. Each is the median of the checks in its bucket that were
   * answered; `checks` is how many those were, or null on a day of the long
   * ranges whose count was not recorded.
   */
  points: { at: string; ttfbMs: number; totalMs: number | null; checks: number | null }[];
  /** Over the whole range: the median of the checks, or for 90d and 1y the median of the daily medians. */
  medianTtfbMs: number;
  /** Nineteen in twenty checks were faster than this. Null for 90d and 1y: only the daily medians are kept that long, and a percentile of medians is not one of checks. */
  p95TtfbMs: number | null;
  /** Median time to first byte when Vercel's cache answered (HIT): the edge alone. Null when no such check. */
  edgeMs: number | null;
  /** Median when it did not (MISS, STALE, REVALIDATED…): the origin had to work. Null when no such check in the range. */
  originMs: number | null;
}

/**
 * Response times of one target over a range, in buckets. `bucketMinutes`
 * defaults to something a chart can draw: 2 for an hour, 15 for a day, 60
 * for a week, 360 for a month. The two long ranges are one point per day,
 * home page only, from the kept history.
 */
export function responseTimes(range: Range = "24h", bucketMinutes?: number, target = "home"): Reading<ResponseTimes> {
  const at = lastAt();
  if (!at) return waiting("probe", NO_CHECK);

  if (long(range)) {
    const line = series("response.home.ttfb", DAYS[range]);
    if (!line.length) return waiting("probe", NO_CHECK);
    const values = line.map((p) => p.value);
    /* The day's median is over the checks that passed (they are the ones
       with a time), so its count is the day's checks less its failures. */
    const ran = new Map(series("uptime.checks", DAYS[range]).map((p) => [p.day, p.value]));
    const lost = new Map(series("uptime.failed", DAYS[range]).map((p) => [p.day, p.value]));
    const passed = (day: string): number | null => {
      const n = ran.get(day);
      return n === undefined ? null : n - (lost.get(day) ?? 0);
    };
    return ok(
      { target: "home", bucketMinutes: 1440, points: line.map((p) => ({ at: p.day, ttfbMs: Math.round(p.value), totalMs: null, checks: passed(p.day) })), medianTtfbMs: Math.round(median(values)), p95TtfbMs: null, edgeMs: null, originMs: null },
      "probe",
      at,
      `One point per day (the day's median), home page; the figure over the range is the median of those daily medians, and there is no 95th percentile (only daily medians are kept this long). ${VANTAGE}`,
    );
  }

  const rows = db.prepare("SELECT at, ttfb_ms AS ttfb, total_ms AS total, cache FROM cc_probes WHERE target = ? AND ok = 1 AND ttfb_ms IS NOT NULL AND at >= ? ORDER BY at").all(target, from(range)) as { at: string; ttfb: number; total: number | null; cache: string | null }[];
  if (!rows.length) return waiting("probe", "No answered check inside this range yet.");
  const width = (bucketMinutes ?? { "1h": 2, "24h": 15, "7d": 60, "30d": 360, "90d": 1440, "1y": 1440 }[range]) * 60_000;
  const buckets = new Map<number, { ttfb: number[]; total: number[] }>();
  for (const r of rows) {
    const k = Math.floor(Date.parse(r.at) / width) * width;
    const b = buckets.get(k) ?? { ttfb: [], total: [] };
    b.ttfb.push(r.ttfb);
    if (r.total != null) b.total.push(r.total);
    buckets.set(k, b);
  }
  const all = rows.map((r) => r.ttfb);
  const hit = rows.filter((r) => r.cache === "HIT").map((r) => r.ttfb);
  const miss = rows.filter((r) => r.cache && r.cache !== "HIT").map((r) => r.ttfb);
  return ok(
    {
      target,
      bucketMinutes: width / 60_000,
      points: [...buckets].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({ at: new Date(k).toISOString(), ttfbMs: Math.round(median(b.ttfb)), totalMs: b.total.length ? Math.round(median(b.total)) : null, checks: b.ttfb.length })),
      medianTtfbMs: Math.round(median(all)),
      p95TtfbMs: Math.round(percentile(all, 95)),
      edgeMs: hit.length ? Math.round(median(hit)) : null,
      originMs: miss.length ? Math.round(median(miss)) : null,
    },
    "probe",
    at,
    `Each check opens a new connection, so the time includes DNS and TLS. ${VANTAGE}`,
  );
}

export interface CacheHits {
  /** Checks Vercel's cache answered (HIT), out of those that carried a cache header, as a percentage. */
  percent: number;
  hits: number;
  answered: number;
  /** How often each cache answer came back. */
  byAnswer: Share[];
  byTarget: { target: string; percent: number; answered: number }[];
}

/**
 * How often Vercel's edge cache answered the desk's checks. The desk's checks
 * only: it is not the site's cache hit rate for visitors, which only Vercel
 * knows. The function probe is left out: it is there to reach a function,
 * and can never be a hit.
 */
export function cacheHitRate(range: Range = "24h"): Reading<CacheHits> {
  const at = lastAt();
  if (!at) return waiting("probe", NO_CHECK);
  const rows = db.prepare("SELECT target, cache, COUNT(*) AS n FROM cc_probes WHERE cache IS NOT NULL AND target <> 'function' AND at >= ? GROUP BY target, cache").all(from(long(range) ? "30d" : range)) as { target: string; cache: string; n: number }[];
  const answered = rows.reduce((a, r) => a + r.n, 0);
  if (!answered) return waiting("probe", "No check inside this range carried a cache header yet.");
  const hits = rows.filter((r) => r.cache === "HIT").reduce((a, r) => a + r.n, 0);
  const answers = new Map<string, number>();
  const perTarget = new Map<string, { hit: number; n: number }>();
  for (const r of rows) {
    answers.set(r.cache, (answers.get(r.cache) ?? 0) + r.n);
    const t = perTarget.get(r.target) ?? { hit: 0, n: 0 };
    t.n += r.n;
    if (r.cache === "HIT") t.hit += r.n;
    perTarget.set(r.target, t);
  }
  return ok(
    {
      percent: (hits / answered) * 100,
      hits,
      answered,
      byAnswer: [...answers].map(([key, value]) => ({ key, label: key, value })).sort((a, b) => b.value - a.value),
      byTarget: [...perTarget].map(([target, t]) => ({ target, percent: (t.hit / t.n) * 100, answered: t.n })),
    },
    "probe",
    at,
    `Of the desk's own checks${long(range) ? " in the last 30 days (samples are kept 35 days)" : ""}; not the hit rate visitors get, which only Vercel knows.`,
  );
}

const sampleOf = (r: {
  at: string;
  target: string;
  status: number;
  ok: number;
  connect_ms: number | null;
  ttfb_ms: number | null;
  total_ms: number | null;
  bytes: number | null;
  cache: string | null;
  region: string | null;
  fn_region: string | null;
  failure: string | null;
}): Sample => ({
  at: r.at,
  target: r.target,
  status: r.status,
  ok: Boolean(r.ok),
  connectMs: r.connect_ms,
  ttfbMs: r.ttfb_ms,
  totalMs: r.total_ms,
  bytes: r.bytes,
  cache: r.cache,
  region: r.region,
  functionRegion: r.fn_region,
  failure: r.failure,
});

/** The newest sample of each target, with its label. */
export function latest(): Reading<(Sample & { label: string; path: string })[]> {
  const at = lastAt();
  if (!at) return waiting("probe", NO_CHECK);
  const out: (Sample & { label: string; path: string })[] = [];
  for (const t of targets()) {
    const r = db.prepare("SELECT * FROM cc_probes WHERE target = ? ORDER BY id DESC LIMIT 1").get(t.id) as Parameters<typeof sampleOf>[0] | undefined;
    if (r) out.push({ ...sampleOf(r), label: t.label, path: t.path });
  }
  return ok(out, "probe", at, VANTAGE);
}

/** The newest sample of the home page, or null before the first check. For the top bar's light. */
export function lastHome(): Sample | null {
  const r = db.prepare("SELECT * FROM cc_probes WHERE target = 'home' ORDER BY id DESC LIMIT 1").get() as Parameters<typeof sampleOf>[0] | undefined;
  return r ? sampleOf(r) : null;
}

/**
 * The newest answer of the route that wakes a function (GET /api/ask, whose
 * healthy answer is 405: see the note at the top). `off` when the probe was
 * switched off or stopped itself, with the reason.
 */
export function functionProbe(): Reading<Sample & { path: string; expect: number }> {
  const stopped = stoppedToday();
  if (stopped) return off("probe", stopped, "Point SITE_FUNCTION_PROBE at a route that does no work on GET (and SITE_FUNCTION_PROBE_STATUS at what it answers), or set SITE_FUNCTION_PROBE=off.");
  const t = targets().find((x) => x.id === "function");
  if (!t) return off("probe", "The function probe is switched off in the desk's environment (SITE_FUNCTION_PROBE).", "Remove SITE_FUNCTION_PROBE=off to time GET /api/ask again.");
  const r = db.prepare("SELECT * FROM cc_probes WHERE target = 'function' ORDER BY id DESC LIMIT 1").get() as Parameters<typeof sampleOf>[0] | undefined;
  return r
    ? ok({ ...sampleOf(r), path: t.path, expect: t.expect }, "probe", r.at, `A GET the route turns away with ${t.expect}: the time of a function waking, no work done. ${VANTAGE}`)
    : waiting("probe", NO_CHECK);
}

export interface Incident {
  id: number;
  started: string;
  /** Null while it is still going on. */
  ended: string | null;
  /** Whole minutes it lasted (so far, when it has not ended). */
  minutes: number;
  /** What the failing checks said. */
  cause: string;
}

/** Outages of the home page inside a range, newest first. An empty list is a real answer: there were none. */
export function incidents(range: Range = "30d"): Reading<Incident[]> {
  const at = lastAt();
  if (!at) return waiting("probe", NO_CHECK);
  const rows = db.prepare("SELECT id, started, ended, cause FROM cc_incidents WHERE started >= ? OR ended IS NULL ORDER BY id DESC").all(from(range)) as { id: number; started: string; ended: string | null; cause: string }[];
  return ok(
    rows.map((r) => ({ ...r, minutes: Math.max(1, Math.round(((r.ended ? Date.parse(r.ended) : Date.now()) - Date.parse(r.started)) / 60_000)) })),
    "probe",
    at,
    `An incident is two failed checks of the home page in a row. ${VANTAGE}`,
  );
}

/** The TLS certificates of the site's two host names, read within the last hour. */
export function certificate(): Reading<Certificate[]> {
  const had = kept<Certificate[]>("site:tls");
  return had ? ok(had.value, "probe", had.at) : waiting("probe", "The certificate has not been read yet; it is read once an hour, first within a minute of the desk starting.");
}

/** The DNS answers for the site's two host names, read within the last hour. */
export function dns(): Reading<DnsAnswer[]> {
  const had = kept<DnsAnswer[]>("site:dns");
  return had ? ok(had.value, "probe", had.at, "As the desk's server's resolver answered. Vercel's addresses rotate; a different list an hour later is normal.") : waiting("probe", "DNS has not been read yet; it is read once an hour.");
}
