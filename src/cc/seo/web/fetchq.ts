import { HTTPException } from "hono/http-exception";
import { db, lastBeat } from "../../../db.ts";
import { setState, state } from "../../store.ts";
import { checkTarget, cleanHeaders, MAX_BYTES, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from "./allow.ts";
import type { FetchReturn, FetchTask } from "./work.ts";
import { allowance, clock, envInt, pause, paused, spend, stamp, unpause, whenText, type Allowance, type Pause } from "./shared.ts";

/**
 * The box's half of the fetch door: pages the studio workstation is asked to
 * fetch from its own connection, one at a time, and what came back.
 *
 *   queueFetch     a module asks for a page (serp.ts: Google's basic result
 *                  page). Refused here already when the host is off the list
 *                  in allow.ts: the workstation would refuse it anyway.
 *   handOutFetch   POST /runner/fetch/next: the oldest task whose lane may go
 *                  now, or none and why.
 *   takeFetchResult POST /runner/fetch/result/:id: the page, or why there is
 *                  none. The module that asked reads it at once (onFetched);
 *                  the page itself is never kept.
 *
 * THE WORKSTATION'S HOME ADDRESS IS PROTECTED HERE, not on the workstation:
 * Google sees the studio's line, and a block on it would put captchas in
 * front of the owner's own searches. So the Google lane hands out at most one
 * fetch every four seconds and sixty a day (SEO_GOOGLE_DAILY), counted when
 * handed out, and after the first captcha, 429 or script shell it hands out
 * nothing for 24 hours (serp.ts calls pauseLane). The DuckDuckGo lane, used
 * only when a module asks the workstation for it, hands out one every two
 * minutes.
 *
 * A TASK LEFT RUNNING IS HANDED OUT AGAIN. A fetch takes seconds; one not
 * answered in two minutes was cut off (a restart, a sleeping laptop) and goes
 * back to the queue, three hand-outs at most. A task still queued after 36
 * hours is given up: a ranking for a question asked the day before yesterday
 * is not what was asked.
 */

export type Lane = "google" | "duckduckgo";
const LANES: readonly Lane[] = ["google", "duckduckgo"];

/** The least time between two hand-outs in a lane. */
export const LANE_GAP_MS: Record<Lane, number> = { google: 4000, duckduckgo: 120_000 };
/** How many Google fetches the workstation is handed a day, at most. */
export const googleDaily = (): number => envInt("SEO_GOOGLE_DAILY", 60, 1, 200);
/** How long a refusal stops a lane. */
export const LANE_PAUSE_MS: Record<Lane, number> = { google: 24 * 3600_000, duckduckgo: 3600_000 };

const STALE_MS = 2 * 60_000;
const MOST_ATTEMPTS = 3;
const EXPIRE_MS = 36 * 3600_000;
/** The workstation counts as on when it asked for a fetch this recently (it asks every 20 seconds when idle). */
const AWAKE_MS = 2 * 60_000;

const COUNT_KEY: Record<Lane, string> = { google: "seo:web:fetch:google:day", duckduckgo: "seo:web:fetch:duckduckgo:day" };
const PAUSE_KEY: Record<Lane, string> = { google: "seo:web:fetch:google:pause", duckduckgo: "seo:web:fetch:duckduckgo:pause" };
const LAST_KEY: Record<Lane, string> = { google: "seo:web:fetch:google:last", duckduckgo: "seo:web:fetch:duckduckgo:last" };
const DAILY: Record<Lane, () => number> = { google: googleDaily, duckduckgo: () => envInt("SEO_DDG_DAILY", 200, 1, 1000) };
/** cc_state: the last ask at the fetch door, { name, at }. */
const SEEN_KEY = "seo:web:fetch:seen";

export interface FetchRow {
  id: number;
  purpose: string;
  ref: number | null;
  lane: Lane;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
  state: "queued" | "running" | "done" | "failed";
  attempts: number;
  runner: string | null;
  createdAt: string;
  takenAt: string | null;
  doneAt: string | null;
  status: number | null;
  finalUrl: string | null;
  bytes: number | null;
  error: string | null;
}

interface FetchDb {
  id: number;
  purpose: string;
  ref: number | null;
  lane: string;
  url: string;
  headers: string;
  timeout_ms: number;
  max_bytes: number;
  state: string;
  attempts: number;
  runner: string | null;
  created_at: string;
  taken_at: string | null;
  done_at: string | null;
  status: number | null;
  final_url: string | null;
  bytes: number | null;
  error: string | null;
}

const toRow = (r: FetchDb): FetchRow => ({
  id: r.id,
  purpose: r.purpose,
  ref: r.ref,
  lane: r.lane === "duckduckgo" ? "duckduckgo" : "google",
  url: r.url,
  headers: (() => {
    try {
      return JSON.parse(r.headers) as Record<string, string>;
    } catch {
      return {};
    }
  })(),
  timeoutMs: r.timeout_ms,
  maxBytes: r.max_bytes,
  state: r.state as FetchRow["state"],
  attempts: r.attempts,
  runner: r.runner,
  createdAt: r.created_at,
  takenAt: r.taken_at,
  doneAt: r.done_at,
  status: r.status,
  finalUrl: r.final_url,
  bytes: r.bytes,
  error: r.error,
});

export function fetchRow(id: number): FetchRow | null {
  const r = db.prepare("SELECT * FROM cc_seo_fetch_tasks WHERE id = ?").get(id) as FetchDb | undefined;
  return r ? toRow(r) : null;
}

/* ---------- what a page means: the module that asked reads it ------------------------------ */

/** What arrived for a task: the page, or, for good, why there is none. */
export type Delivered = { ok: true; status: number; finalUrl: string; body: string; client: string | null } | { ok: false; error: string };

type Reader = (task: FetchRow, got: Delivered) => void | Promise<void>;
const readers = new Map<string, Reader>();

/** Say what a page of this purpose means. serp.ts registers "serp" when it loads; the door loads serp.ts. */
export function onFetched(purpose: string, read: Reader): void {
  readers.set(purpose, read);
}

async function deliver(task: FetchRow, got: Delivered): Promise<void> {
  const read = readers.get(task.purpose);
  if (!read) {
    console.warn(`fetch door: nothing reads a "${task.purpose}" page (task ${task.id}); it is dropped`);
    return;
  }
  try {
    await read(task, got);
  } catch (e) {
    /* One page that could not be read costs that page, never the door. */
    console.error(`fetch door: reading task ${task.id} (${task.purpose}) failed:`, e);
  }
}

/** A task given up for good: the module that asked hears why. */
async function giveUp(task: FetchRow, error: string): Promise<void> {
  db.prepare("UPDATE cc_seo_fetch_tasks SET state = 'failed', done_at = ?, error = ? WHERE id = ? AND state IN ('queued','running')").run(stamp(), error.slice(0, 300), task.id);
  await deliver({ ...task, state: "failed", error }, { ok: false, error });
}

/* ---------- asking for a page ---------------------------------------------------------------- */

export interface FetchWanted {
  /** What the page is for; the reader registered under it reads the answer. */
  purpose: string;
  /** The row it belongs to (cc_seo_serp_checks.id). */
  ref: number | null;
  lane: Lane;
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Queue a page for the workstation. Returns the task's id. Throws 400 for an address the workstation would refuse. */
export function queueFetch(w: FetchWanted): number {
  const target = checkTarget(w.url);
  if (!target.ok) throw new HTTPException(400, { message: `The workstation does not fetch that address: ${target.why}.` });
  const timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, w.timeoutMs ?? 20_000));
  const maxBytes = Math.max(1000, Math.min(MAX_BYTES, w.maxBytes ?? MAX_BYTES));
  const r = db
    .prepare("INSERT INTO cc_seo_fetch_tasks (purpose, ref, lane, url, headers, timeout_ms, max_bytes, state, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)")
    .run(w.purpose, w.ref, w.lane, target.url.toString(), JSON.stringify(cleanHeaders(w.headers ?? {})), timeoutMs, maxBytes, stamp());
  return Number(r.lastInsertRowid);
}

/** Take a task out of the queue (its check was withdrawn). True when it was still waiting. */
export function dropFetch(id: number, why: string): boolean {
  return db.prepare("UPDATE cc_seo_fetch_tasks SET state = 'failed', done_at = ?, error = ? WHERE id = ? AND state = 'queued'").run(stamp(), why.slice(0, 300), id).changes > 0;
}

/* ---------- the lanes ---------------------------------------------------------------------- */

export interface LaneState {
  lane: Lane;
  paused: Pause | null;
  allowance: Allowance;
  /** When the next hand-out may go (ISO), or null when it may go now. */
  nextAt: string | null;
  queued: number;
  running: number;
}

export function laneState(lane: Lane): LaneState {
  const last = Date.parse(state(LAST_KEY[lane]) ?? "");
  const next = Number.isFinite(last) ? last + LANE_GAP_MS[lane] : 0;
  const counts = db.prepare("SELECT state, COUNT(*) AS n FROM cc_seo_fetch_tasks WHERE lane = ? AND state IN ('queued','running') GROUP BY state").all(lane) as { state: string; n: number }[];
  return {
    lane,
    paused: paused(PAUSE_KEY[lane]),
    allowance: allowance(COUNT_KEY[lane], DAILY[lane]()),
    nextAt: next > clock.now() ? new Date(next).toISOString() : null,
    queued: counts.find((c) => c.state === "queued")?.n ?? 0,
    running: counts.find((c) => c.state === "running")?.n ?? 0,
  };
}

/** Stop handing out this lane's fetches for its pause (24 hours for Google). The sentence names who refused. */
export function pauseLane(lane: Lane, why: string): Pause {
  return pause(PAUSE_KEY[lane], LANE_PAUSE_MS[lane], why);
}

/** Lift a lane's pause by hand (a person who knows the block is gone). */
export function unpauseLane(lane: Lane): void {
  unpause(PAUSE_KEY[lane]);
}

/** Why this lane may not hand out now, or null when it may. */
function laneClosed(lane: Lane): string | null {
  const s = laneState(lane);
  if (s.paused) return `${s.paused.why}; paused until ${whenText(s.paused.until)}`;
  if (s.allowance.left <= 0) return `today's ${s.allowance.cap} ${lane === "google" ? "Google" : "DuckDuckGo"} fetches are used`;
  if (s.nextAt) return `the next ${lane === "google" ? "Google" : "DuckDuckGo"} fetch may go at ${s.nextAt.slice(11, 19)} UTC`;
  return null;
}

/* ---------- the workstation's side of the door ----------------------------------------------- */

/** Running tasks not answered in two minutes go back to the queue; after three hand-outs, and after 36 hours queued, they are given up. */
async function tidy(): Promise<void> {
  const stale = new Date(clock.now() - STALE_MS).toISOString();
  for (const r of db.prepare("SELECT * FROM cc_seo_fetch_tasks WHERE state = 'running' AND taken_at < ?").all(stale) as unknown as FetchDb[]) {
    if (r.attempts >= MOST_ATTEMPTS) await giveUp(toRow(r), `The workstation took it ${r.attempts} times and never answered.`);
    else db.prepare("UPDATE cc_seo_fetch_tasks SET state = 'queued', runner = NULL, taken_at = NULL WHERE id = ? AND state = 'running'").run(r.id);
  }
  const old = new Date(clock.now() - EXPIRE_MS).toISOString();
  for (const r of db.prepare("SELECT * FROM cc_seo_fetch_tasks WHERE state = 'queued' AND created_at < ?").all(old) as unknown as FetchDb[]) {
    const lane = laneState(toRow(r).lane);
    const why = lane.paused ? `${lane.paused.why}, and it waited 36 hours` : workstation().on ? "It waited 36 hours behind the day's allowance." : "It waited 36 hours and the workstation never asked for it.";
    await giveUp(toRow(r), why);
  }
}

/** POST /runner/fetch/next: the next page to fetch, or none and why. Spends the lane's allowance when it hands one out. */
export async function handOutFetch(runner: string): Promise<{ task: FetchTask | null; wait?: string }> {
  setState(SEEN_KEY, JSON.stringify({ name: runner, at: new Date(clock.now()).toISOString() }));
  await tidy();
  const waits: string[] = [];
  for (const lane of LANES) {
    /* Nothing awaited between choosing and marking: two runners asking at once are not handed the same task. */
    const r = db.prepare("SELECT * FROM cc_seo_fetch_tasks WHERE lane = ? AND state = 'queued' ORDER BY id LIMIT 1").get(lane) as FetchDb | undefined;
    if (!r) continue;
    const closed = laneClosed(lane);
    if (closed) {
      waits.push(closed);
      continue;
    }
    if (!spend(COUNT_KEY[lane], DAILY[lane]())) {
      waits.push(`today's ${lane} fetches are used`);
      continue;
    }
    setState(LAST_KEY[lane], new Date(clock.now()).toISOString());
    db.prepare("UPDATE cc_seo_fetch_tasks SET state = 'running', runner = ?, taken_at = ?, attempts = attempts + 1 WHERE id = ?").run(runner, new Date(clock.now()).toISOString(), r.id);
    const t = toRow(r);
    return { task: { id: t.id, url: t.url, headers: t.headers, timeoutMs: t.timeoutMs, maxBytes: t.maxBytes } };
  }
  return waits.length ? { task: null, wait: waits.join("; ") } : { task: null };
}

/** What the workstation may send back: work.ts `FetchReturn`, checked field by field. */
function asReturn(body: unknown): FetchReturn | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.ok === true && typeof b.status === "number" && typeof b.body === "string") {
    return { ok: true, status: b.status, finalUrl: typeof b.finalUrl === "string" ? b.finalUrl : "", body: b.body, ms: Number(b.ms) || 0, client: typeof b.client === "string" ? b.client : "unknown" };
  }
  if (b.ok === false && typeof b.error === "string") {
    return { ok: false, error: b.error, kind: b.kind === "blocked" ? "blocked" : "failed", ...(typeof b.status === "number" ? { status: b.status } : {}), ...(typeof b.finalUrl === "string" ? { finalUrl: b.finalUrl } : {}) };
  }
  return null;
}

/**
 * POST /runner/fetch/result/:id. A page goes to the module that asked; a
 * fetch that failed on the workstation's side (no answer, a dropped line) is
 * handed out again, three times at most; a refusal by the workstation (an
 * address off its list, a page too large) is final.
 */
export async function takeFetchResult(id: number, body: unknown): Promise<{ ok: true; state: "done" | "failed" | "queued" | "ignored" }> {
  const r = db.prepare("SELECT * FROM cc_seo_fetch_tasks WHERE id = ?").get(id) as FetchDb | undefined;
  if (!r) throw new HTTPException(404, { message: "no such fetch task" });
  const got = asReturn(body);
  if (!got) throw new HTTPException(400, { message: "Send { ok: true, status, finalUrl, body } or { ok: false, error }." });
  /* Answered after it was handed out again, or after it was given up: the first answer counts. */
  if (r.state !== "running") return { ok: true, state: "ignored" };
  const task = toRow(r);
  if (!got.ok) {
    if (got.kind === "failed" && r.attempts < MOST_ATTEMPTS) {
      db.prepare("UPDATE cc_seo_fetch_tasks SET state = 'queued', runner = NULL, taken_at = NULL, error = ? WHERE id = ?").run(got.error.slice(0, 300), id);
      return { ok: true, state: "queued" };
    }
    db.prepare("UPDATE cc_seo_fetch_tasks SET state = 'failed', done_at = ?, status = ?, final_url = ?, error = ? WHERE id = ?").run(stamp(), got.status ?? null, got.finalUrl?.slice(0, 500) ?? null, got.error.slice(0, 300), id);
    await deliver({ ...task, state: "failed" }, { ok: false, error: got.error });
    return { ok: true, state: "failed" };
  }
  /* The address it ended on must still be one the workstation may return: the box checks what the workstation checked. */
  const final = got.finalUrl ? checkTarget(got.finalUrl) : { ok: true as const };
  if (!final.ok) {
    const error = `The page came back from an address off the list: ${final.why}.`;
    db.prepare("UPDATE cc_seo_fetch_tasks SET state = 'failed', done_at = ?, status = ?, error = ? WHERE id = ?").run(stamp(), got.status, error, id);
    await deliver({ ...task, state: "failed" }, { ok: false, error });
    return { ok: true, state: "failed" };
  }
  const bytes = Buffer.byteLength(got.body);
  db.prepare("UPDATE cc_seo_fetch_tasks SET state = 'done', done_at = ?, status = ?, final_url = ?, bytes = ?, error = NULL WHERE id = ?").run(stamp(), got.status, got.finalUrl.slice(0, 500), bytes, id);
  await deliver({ ...task, state: "done", status: got.status, finalUrl: got.finalUrl, bytes }, { ok: true, status: got.status, finalUrl: got.finalUrl, body: got.body.slice(0, MAX_BYTES * 2), client: got.client });
  return { ok: true, state: "done" };
}

/* ---------- the workstation, as the door sees it --------------------------------------------- */

export interface Workstation {
  on: boolean;
  lastSeen: string | null;
  line: string;
}

/** Whether the workstation takes fetch tasks now, from its last ask at this door (and the article runner's heartbeat). */
export function workstation(): Workstation {
  let seen: { at: string } | null = null;
  try {
    const v = JSON.parse(state(SEEN_KEY) ?? "null") as { at?: unknown } | null;
    seen = v && typeof v.at === "string" ? { at: v.at } : null;
  } catch {
    seen = null;
  }
  const at = seen ? Date.parse(seen.at) : NaN;
  if (Number.isFinite(at) && clock.now() - at < AWAKE_MS) {
    const mins = Math.round((clock.now() - at) / 60_000);
    return { on: true, lastSeen: seen!.at, line: `The studio workstation is on: it asked for work ${mins < 1 ? "less than a minute" : `${mins} minute${mins === 1 ? "" : "s"}`} ago.` };
  }
  const beat = lastBeat();
  /* SQLite's datetime('now') is UTC without saying so. */
  const beatAt = beat ? Date.parse(`${beat.replace(" ", "T")}Z`) : NaN;
  if (Number.isFinite(beatAt) && clock.now() - beatAt < 5 * 60_000) {
    return { on: false, lastSeen: seen?.at ?? null, line: "The studio workstation is on, but its runner does not take fetch tasks yet: it runs a build from before the fetch door (restart the runner after the next pull)." };
  }
  if (seen) return { on: false, lastSeen: seen.at, line: `The studio workstation is off: it last asked for work at ${whenText(seen.at)}. Google checks wait until it is on.` };
  return { on: false, lastSeen: null, line: "No workstation has asked for fetch tasks yet: Google checks wait until one does." };
}

/** Lanes, for the check script and the screens. */
export const _test = { tidy, COUNT_KEY, PAUSE_KEY, LAST_KEY, SEEN_KEY };
