import { db } from "../db.ts";
import type { ActivityItem, Reading, SourceId, Tone } from "../../web/src/contract/common.ts";

/**
 * What the command center remembers.
 *
 * The sources it reads are slow, metered or both: GA4 charges tokens per
 * report, Clarity answers ten times a day, PageSpeed takes twenty seconds a
 * page. So a screen never asks a source. A screen asks this file, and the
 * scheduler keeps this file fresh.
 *
 * Four small things, in the desk's one database:
 *
 *   cc_cache     the latest answer to a question, with when it was asked.
 *                Overwritten. "What did GA4 say about the last 30 days."
 *   cc_series    one number per metric per day, kept. The history only the
 *                desk can have: uptime, lab speed, index counts, scores.
 *                None of these can be asked for in arrears.
 *   cc_activity  things that happened, for the feeds and the bell.
 *   cc_state     a few values a job needs between runs.
 *
 * Collectors own their own tables beside these (cc_pages, cc_probes, …) and
 * create them in their own module. Everything is prefixed `cc_` so the desk's
 * original tables stay recognisable.
 *
 * NO PERSONAL DATA IS STORED HERE. Enquiries are read from the engine when a
 * screen asks and are never copied: a copy would be a second place the
 * twelve-month deletion promise has to be kept.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_cache (
    key   TEXT PRIMARY KEY,
    json  TEXT NOT NULL,
    at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cc_series (
    metric TEXT NOT NULL,
    day    TEXT NOT NULL,
    value  REAL NOT NULL,
    PRIMARY KEY (metric, day)
  );

  CREATE TABLE IF NOT EXISTS cc_activity (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     TEXT NOT NULL,
    kind   TEXT NOT NULL,
    tone   TEXT NOT NULL DEFAULT 'info',
    text   TEXT NOT NULL,
    detail TEXT,
    href   TEXT,
    actor  TEXT,
    /* Two reports of the same thing are one row: a job that runs every five
       minutes must not write "sitemap changed" two hundred times. */
    dedupe TEXT UNIQUE
  );
  CREATE INDEX IF NOT EXISTS cc_activity_at ON cc_activity (at DESC);

  CREATE TABLE IF NOT EXISTS cc_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

/* ---------- the latest answer ------------------------------------------- */

export interface Kept<T> {
  value: T;
  /** Milliseconds since the epoch. */
  at: number;
}

export function kept<T>(key: string): Kept<T> | null {
  const row = db.prepare("SELECT json, at FROM cc_cache WHERE key = ?").get(key) as { json: string; at: number } | undefined;
  if (!row) return null;
  try {
    return { value: JSON.parse(row.json) as T, at: row.at };
  } catch {
    return null;
  }
}

export function keep<T>(key: string, value: T): Kept<T> {
  const at = Date.now();
  db.prepare("INSERT INTO cc_cache (key, json, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, at = excluded.at").run(
    key,
    JSON.stringify(value),
    at,
  );
  return { value, at };
}

/** Questions already being asked, so two screens opening at once ask once. */
const asking = new Map<string, Promise<unknown>>();

/**
 * The answer to `key`, no older than `ttl` milliseconds.
 *
 * Fresh enough: returned as it is. Too old or never asked: `ask` runs and its
 * answer is kept. If `ask` throws and an older answer exists, the older answer
 * is returned with `stale: true`: a figure from an hour ago with its time
 * shown beats an empty panel that reads as "nothing happened".
 */
export async function cached<T>(key: string, ttl: number, ask: () => Promise<T>): Promise<Kept<T> & { stale?: boolean; error?: string }> {
  const had = kept<T>(key);
  if (had && Date.now() - had.at < ttl) return had;

  const running = asking.get(key) as Promise<T> | undefined;
  try {
    const p = running ?? ask();
    if (!running) asking.set(key, p);
    const value = await p;
    return keep(key, value);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (had) return { ...had, stale: true, error };
    throw e;
  } finally {
    asking.delete(key);
  }
}

export function forget(prefix: string): void {
  db.prepare("DELETE FROM cc_cache WHERE key LIKE ?").run(`${prefix}%`);
}

/* ---------- one number a day -------------------------------------------- */

/** Today in Zurich, as YYYY-MM-DD. The studio's day, not the server's. */
export function today(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(d);
}

export function record(metric: string, value: number, day = today()): void {
  if (!Number.isFinite(value)) return;
  db.prepare("INSERT INTO cc_series (metric, day, value) VALUES (?, ?, ?) ON CONFLICT(metric, day) DO UPDATE SET value = excluded.value").run(
    metric,
    day,
    value,
  );
}

export function series(metric: string, days: number): { day: string; value: number }[] {
  return db
    .prepare("SELECT day, value FROM cc_series WHERE metric = ? AND day >= ? ORDER BY day")
    .all(metric, today(-days)) as { day: string; value: number }[];
}

/** The first day a metric was recorded: where its history honestly begins. */
export function since(metric: string): string | null {
  const row = db.prepare("SELECT MIN(day) AS d FROM cc_series WHERE metric = ?").get(metric) as { d: string | null };
  return row.d;
}

/* ---------- things that happened ---------------------------------------- */

export function note(
  kind: string,
  text: string,
  o: { tone?: Tone; detail?: string; href?: string; actor?: string; dedupe?: string; at?: string } = {},
): void {
  db.prepare(
    "INSERT OR IGNORE INTO cc_activity (at, kind, tone, text, detail, href, actor, dedupe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(o.at ?? new Date().toISOString(), kind, o.tone ?? "info", text, o.detail ?? null, o.href ?? null, o.actor ?? "desk", o.dedupe ?? null);
}

export function activity(limit = 20, kinds?: string[]): ActivityItem[] {
  const where = kinds?.length ? `WHERE kind IN (${kinds.map(() => "?").join(",")})` : "";
  const rows = db
    .prepare(`SELECT id, at, kind, tone, text, detail, href, actor FROM cc_activity ${where} ORDER BY at DESC, id DESC LIMIT ?`)
    .all(...(kinds ?? []), limit) as {
    id: number;
    at: string;
    kind: string;
    tone: Tone;
    text: string;
    detail: string | null;
    href: string | null;
    actor: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    kind: r.kind,
    tone: r.tone,
    text: r.text,
    ...(r.detail ? { detail: r.detail } : {}),
    ...(r.href ? { href: r.href } : {}),
    ...(r.actor ? { actor: r.actor } : {}),
  }));
}

/* ---------- a value between runs ---------------------------------------- */

export function state(key: string): string | null {
  const row = db.prepare("SELECT value FROM cc_state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setState(key: string, value: string): void {
  db.prepare("INSERT INTO cc_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/* ---------- saying it ---------------------------------------------------- */

/** A figure that was read. */
export const ok = <T>(value: T, source: SourceId, at: number | string, noteText?: string): Reading<T> => ({
  state: "ok",
  value,
  source,
  asOf: typeof at === "number" ? new Date(at).toISOString() : at,
  ...(noteText ? { note: noteText } : {}),
});

/** Connected, nothing to show yet. */
export const waiting = <T>(source: SourceId, reason: string): Reading<T> => ({ state: "waiting", source, reason });

/** Not connected, or not obtainable. `step` is what a person would do. */
export const off = <T>(source: SourceId, reason: string, step?: string): Reading<T> => ({
  state: "off",
  source,
  reason,
  ...(step ? { step } : {}),
});

/**
 * Read something into a `Reading`, turning a throw into words instead of a
 * broken page. One failing source must cost one panel, never the screen.
 */
export async function reading<T>(source: SourceId, read: () => Promise<Reading<T>> | Reading<T>): Promise<Reading<T>> {
  try {
    return await read();
  } catch (e) {
    return waiting(source, `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }
}
