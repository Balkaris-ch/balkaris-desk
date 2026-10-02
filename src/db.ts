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
    /* 'article' | 'video' | 'carousel'. Decided by what the extractor found,
       never by the URL: an instagram.com/p/ link is a Reel about as often as
       it is a carousel. */
    kind        TEXT NOT NULL DEFAULT 'article',
    platform    TEXT,
    /* The source's own public numbers AT THE MOMENT WE LOOKED. captured_at
       is a real timestamp and NOT inferred from created_at: a re-resolve or a
       backfill makes those two different, and knowing how old a reading is
       was the entire point of keeping it.
       Instagram exposes views, likes and comments but NOT saves or shares.
       Those stay NULL. A null rendered as a zero is a claim we never made. */
    posted_at   TEXT,
    captured_at TEXT,
    views       INTEGER,
    likes       INTEGER,
    comments    INTEGER,
    shares      INTEGER,
    saves       INTEGER,
    duration_s  REAL,
    slides      INTEGER,
    spoke       TEXT,
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

  /* One row per runner, overwritten. A heartbeat is not an event: see the
     note on beat() below. No backticks in here -- this is inside a template
     literal and one would end it. */
  CREATE TABLE IF NOT EXISTS runners (
    name      TEXT PRIMARY KEY,
    last_seen TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS jobs_open ON jobs(state, kind, id);
  /* what is read by every "has anything happened" query and was a scan. */
  CREATE INDEX IF NOT EXISTS events_what ON events(what, id);
  CREATE INDEX IF NOT EXISTS links_state ON links(state, id);
`);

/**
 * Columns added after the first rows existed.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that is already there,
 * so a new column has to be added by hand. Each one is tried and its
 * "duplicate column" refusal swallowed — which is the whole migration story a
 * single-file database with a dozen rows a day deserves.
 */
for (const column of [
  "kind TEXT NOT NULL DEFAULT 'article'",
  "platform TEXT",
  "posted_at TEXT",
  "captured_at TEXT",
  "views INTEGER",
  "likes INTEGER",
  "comments INTEGER",
  "shares INTEGER",
  "saves INTEGER",
  "duration_s REAL",
  "slides INTEGER",
  "spoke TEXT",
  /* "Attach the video, or just the text" (Fini, 24 September 2026). On by
     default, because a video shared to the bot is usually worth showing; a
     link whose message says "text only" turns it off at intake, and the
     draft page can change its mind afterwards without re-reading anything. */
  "attach INTEGER NOT NULL DEFAULT 1",
  /* How it was asked to be written: 'standard' | 'deep' | 'technical' |
     'simple' (templates.ts `Format`). NULL until somebody has said, by a word
     beside the link or by a button under the bot's reply; a link that is
     written while it is still NULL is written the standard way. */
  "format TEXT",
  /* The bot's one reply to the share, so it can be rewritten later by
     something that is not the request that sent it: the button that chose a
     format, and the runner taking the job. `tg_text` is the part of that
     reply that never changes (what the link turned out to be), kept because
     Telegram does not hand a bot its own messages back. */
  "tg_msg INTEGER",
  "tg_text TEXT",
]) {
  try {
    db.exec(`ALTER TABLE links ADD COLUMN ${column}`);
  } catch {
    /* already there */
  }
}

/* A flag, never a rejection: see src/echo.ts. It sits on the draft so the
   person approving it sees it at the moment they decide. */
/* `payload` carries what a job needs beyond its link — which draft to
   re-close, and as which of the five jobs. */
try {
  db.exec("ALTER TABLE jobs ADD COLUMN payload TEXT");
} catch {
  /* already there */
}

/* `not_before` holds a job back while the bot's question is still open: a
   link shared without saying how to write it waits a minute and a half for a
   button before it is written the standard way (intake.ts `HOLD_SECONDS`).
   NULL, which is every job that existed before this and every job that asks
   nothing, means now. */
try {
  db.exec("ALTER TABLE jobs ADD COLUMN not_before TEXT");
} catch {
  /* already there */
}

for (const column of ["echo TEXT", "closing TEXT", "cover_alt TEXT", "cover_caption TEXT"]) {
  try {
    db.exec(`ALTER TABLE drafts ADD COLUMN ${column}`);
  } catch {
    /* already there */
  }
}

/**
 * A HEARTBEAT IS NOT AN EVENT.
 *
 * The runner polls every twenty seconds and each poll used to append a row to
 * `events`. One day of running left 3 392 poll rows out of 3 647 — 93% of the
 * history was the runner saying "anything for me?" — and at that rate it is a
 * million and a half rows a year, in a table with no index on `what`, which
 * `lastPoll()` scans on every shared link.
 *
 * Three things were wrong with that at once: a write to SQLite every twenty
 * seconds forever, a read that gets slower every day, and a record of what the
 * desk did that you cannot read for the noise.
 *
 * So the heartbeat is ONE ROW that gets overwritten. `events` goes back to
 * being what it is for: things that happened once and are worth reading later.
 */
export function beat(name: string): void {
  db.prepare(
    `INSERT INTO runners (name, last_seen) VALUES (?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET last_seen = datetime('now')`,
  ).run(name);
}

/** When did any runner last ask for work? Null if none ever has. */
export function lastBeat(): string | null {
  return (db.prepare("SELECT MAX(last_seen) a FROM runners").get() as { a: string | null }).a ?? null;
}

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
    lastSeen: lastBeat(),
  };
}
