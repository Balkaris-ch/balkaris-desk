import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Everything the desk remembers, in one file.
 *
 * SQLite through `node:sqlite` — no native module to compile, nothing to
 * install, and the box is a 3.7 GB VM that should not be running a second
 * database server for a queue that will see a dozen rows a day. Node 22 has
 * it behind `--experimental-sqlite`, which is why the systemd unit and the
 * npm scripts carry that flag.
 *
 * WAL, because the console reads while the webhook writes and the default
 * rollback journal makes those two block each other for no reason.
 *
 * The shape is deliberately small:
 *
 *   links    what somebody shared, once. The URL is unique, so sharing the
 *            same article twice finds the first one instead of making a
 *            second — which is the whole reason a link collector is useful.
 *   jobs     a unit of work for the workstation. One row per attempt at a
 *            stage, so a failure is a record and not a silence.
 *   drafts   what came back: an article, before a human has agreed to it.
 *   events   an append-only log, because "why did this publish" is a
 *            question somebody always asks three weeks later.
 */

const PATH = process.env.DESK_DB ?? "./desk.db";

mkdirSync(dirname(PATH), { recursive: true });

export const db = new DatabaseSync(PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS links (
    id          INTEGER PRIMARY KEY,
    url         TEXT NOT NULL UNIQUE,
    /* Who shared it, as Telegram knows them. No email, no name beyond the
       handle they already show in the chat. */
    from_chat   INTEGER,
    from_user   INTEGER,
    from_name   TEXT,
    note        TEXT,
    /* Filled on arrival, on the box, by the fetch and the table in match.ts —
       neither needs the GPU, so a link knows what it is about immediately. */
    title       TEXT,
    site        TEXT,
    author      TEXT,
    published   TEXT,
    words       INTEGER,
    topic       TEXT,
    services    TEXT,
    body        TEXT,
    state       TEXT NOT NULL DEFAULT 'new',
    error       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY,
    link_id     INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    /* 'write' needs the 4090; 'cover' needs ComfyUI. Both wait for a runner. */
    kind        TEXT NOT NULL,
    state       TEXT NOT NULL DEFAULT 'queued',
    attempts    INTEGER NOT NULL DEFAULT 0,
    runner      TEXT,
    /* Set when a runner takes it. A job still 'running' long after this was
       written belongs to a workstation that went to sleep mid-job, and is
       handed back by \`reclaim()\` rather than being lost. */
    taken_at    TEXT,
    finished_at TEXT,
    error       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS drafts (
    id          INTEGER PRIMARY KEY,
    link_id     INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    slug        TEXT NOT NULL,
    /* The whole article as JSON, in the shape content/types.ts calls a Post. */
    post        TEXT NOT NULL,
    template    TEXT NOT NULL,
    model       TEXT,
    ms          INTEGER,
    state       TEXT NOT NULL DEFAULT 'draft',
    published_sha TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY,
    link_id     INTEGER,
    what        TEXT NOT NULL,
    detail      TEXT,
    at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS jobs_open ON jobs(state, kind, id);
  CREATE INDEX IF NOT EXISTS links_state ON links(state, id);
`);

export function log(what: string, detail?: unknown, linkId?: number): void {
  db.prepare("INSERT INTO events (link_id, what, detail) VALUES (?, ?, ?)").run(
    linkId ?? null,
    what,
    detail === undefined ? null : typeof detail === "string" ? detail : JSON.stringify(detail),
  );
}

/**
 * Hand back jobs whose runner stopped answering.
 *
 * The workstation is allowed to disappear mid-job — that is the entire premise
 * of this arrangement — so a job is not lost when it does. Anything 'running'
 * for longer than `minutes` goes back in the queue, with the attempt counted,
 * and after three attempts it is parked as 'stuck' so it cannot loop forever.
 */
export function reclaim(minutes = 30): number {
  const stale = db
    .prepare(`SELECT id, attempts FROM jobs WHERE state = 'running' AND taken_at < datetime('now', ?)`)
    .all(`-${minutes} minutes`) as { id: number; attempts: number }[];

  for (const j of stale) {
    const next = j.attempts >= 3 ? "stuck" : "queued";
    db.prepare("UPDATE jobs SET state = ?, runner = NULL, taken_at = NULL WHERE id = ?").run(next, j.id);
    log(next === "stuck" ? "job.stuck" : "job.reclaimed", { job: j.id, attempts: j.attempts });
  }
  return stale.length;
}

export interface QueueState {
  queued: number;
  running: number;
  stuck: number;
  drafts: number;
  /** When a runner last asked for work — how the console knows the 4090 is awake. */
  lastSeen: string | null;
}

export function queueState(): QueueState {
  const n = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  return {
    queued: n("SELECT COUNT(*) c FROM jobs WHERE state = 'queued'"),
    running: n("SELECT COUNT(*) c FROM jobs WHERE state = 'running'"),
    stuck: n("SELECT COUNT(*) c FROM jobs WHERE state = 'stuck'"),
    drafts: n("SELECT COUNT(*) c FROM drafts WHERE state = 'draft'"),
    lastSeen:
      (db.prepare("SELECT MAX(at) a FROM events WHERE what = 'runner.poll'").get() as { a: string | null }).a ?? null,
  };
}
