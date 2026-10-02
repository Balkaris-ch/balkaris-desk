import { db } from "../../db.ts";
import type { ContextChoice, Depth, ProposalRow, ProposalState, TaskKind, TaskRow, TaskState, TodoRow } from "../../../web/src/contract/operator.ts";
import { shownTitle } from "./packs.ts";

/**
 * What the AI Operator remembers: its tasks, the changes it proposes, and a
 * small to-do list. Three tables in the desk's one database, beside the
 * command center's own (src/cc/store.ts).
 *
 *   cc_ai_tasks   a request to the workstation's model. Made by a person on
 *                 the screen, taken by the runner when the workstation is on,
 *                 answered, checked here. The context it was given is kept
 *                 with it, so "what did it know when it said that" always
 *                 has an answer.
 *   cc_proposals  a title, a description or a redirect for the website,
 *                 waiting for a person who can publish. Applied through the
 *                 one door the desk has to the website (src/publish.ts
 *                 `commitSiteFiles`), and withdrawn through it.
 *   cc_todos      a person's own list: title, note, who, done.
 *
 * Times are ISO strings in UTC, written by this process, so nothing has to
 * remember that SQLite's datetime('now') says UTC without saying so.
 *
 * Nothing about an enquiry is ever stored here: no task is given a name, a
 * contact detail or a message, and no answer can contain one.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_ai_tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    /* The question as the person wrote it, or what the task does. */
    prompt      TEXT NOT NULL,
    /* JSON: context, depth, range, paths, path. */
    options     TEXT NOT NULL DEFAULT '{}',
    /* JSON: the context pack, assembled here on the box when the task was
       made (or, for an audit, when its crawl finished). */
    pack        TEXT,
    state       TEXT NOT NULL DEFAULT 'queued',
    /* 'crawl' while an audit waits for the crawl it started. */
    stage       TEXT,
    asked_by    TEXT NOT NULL,
    asked_by_id INTEGER,
    created_at  TEXT NOT NULL,
    taken_at    TEXT,
    finished_at TEXT,
    runner      TEXT,
    /* Times it was handed to a runner. */
    attempts    INTEGER NOT NULL DEFAULT 0,
    /* 1 once its first answer was refused: the second answer is the last. */
    retried     INTEGER NOT NULL DEFAULT 0,
    /* Why the last answer was refused, quoted back to the model on the retry. */
    retry_note  TEXT,
    model       TEXT,
    ms          INTEGER,
    result_text TEXT,
    /* JSON: what the answer held in structure, and the flags the desk raised. */
    result_data TEXT,
    error       TEXT
  );
  CREATE INDEX IF NOT EXISTS cc_ai_tasks_open ON cc_ai_tasks (state, id);

  CREATE TABLE IF NOT EXISTS cc_proposals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    /* 'meta' (title and description) or 'redirect'. */
    kind         TEXT NOT NULL,
    /* The page, or the address a redirect leaves from: "/services". */
    address      TEXT NOT NULL,
    /* JSON, what the site says now and what it would say. */
    before_json  TEXT NOT NULL,
    after_json   TEXT NOT NULL,
    why          TEXT,
    /* 'operator' or 'person'. */
    source       TEXT NOT NULL,
    task_id      INTEGER,
    proposed_by  TEXT,
    state        TEXT NOT NULL DEFAULT 'waiting',
    decided_by   TEXT,
    decided_at   TEXT,
    applied_at   TEXT,
    sha          TEXT,
    withdrawn_by TEXT,
    withdrawn_at TEXT,
    withdrawn_sha TEXT,
    error        TEXT,
    note         TEXT,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cc_proposals_state ON cc_proposals (state, id);

  CREATE TABLE IF NOT EXISTS cc_todos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    note       TEXT,
    who        TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    done_at    TEXT,
    done_by    TEXT
  );
`);

export const now = (): string => new Date().toISOString();

export const KIND_LABEL: Record<TaskKind, string> = {
  ask: "Question",
  traffic: "Traffic summary",
  opportunities: "Opportunities",
  metadata: "Metadata proposals",
  redirect: "Redirect proposals",
  brief: "Brief",
  audit: "SEO audit",
};

export const isKind = (k: unknown): k is TaskKind => typeof k === "string" && k in KIND_LABEL;

/** A task's options, as stored. */
export interface TaskOptions {
  context?: ContextChoice;
  depth?: Depth;
  range?: string;
  paths?: string[];
  path?: string;
  /** An audit: whether it started the crawl itself, and when. */
  crawlAsked?: string | null;
}

export interface TaskDb {
  id: number;
  kind: TaskKind;
  prompt: string;
  options: string;
  pack: string | null;
  state: TaskState;
  stage: string | null;
  asked_by: string;
  asked_by_id: number | null;
  created_at: string;
  taken_at: string | null;
  finished_at: string | null;
  runner: string | null;
  attempts: number;
  retried: number;
  retry_note: string | null;
  model: string | null;
  ms: number | null;
  result_text: string | null;
  result_data: string | null;
  error: string | null;
}

export const json = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export const taskById = (id: number): TaskDb | undefined => db.prepare("SELECT * FROM cc_ai_tasks WHERE id = ?").get(id) as TaskDb | undefined;

/** A task as the screen is told about it. `ahead` and `crawl` are worked out by the caller that knows the queue. */
export function toTaskRow(t: TaskDb, extra: { ahead?: number | null; crawl?: { done: number; of: number } | null; lost?: TaskRow["lost"] } = {}): TaskRow {
  const o = json<TaskOptions>(t.options, {});
  return {
    id: t.id,
    kind: t.kind,
    kindLabel: KIND_LABEL[t.kind] ?? t.kind,
    title: t.prompt,
    state: t.state,
    askedBy: t.asked_by,
    createdAt: t.created_at,
    takenAt: t.taken_at,
    finishedAt: t.finished_at,
    runner: t.runner,
    ahead: extra.ahead ?? null,
    crawl: extra.crawl ?? null,
    lost: extra.lost ?? null,
    stage: t.stage === "crawl" ? "crawl" : null,
    attempts: t.attempts,
    retried: !!t.retried,
    error: t.error,
    context: o.context ?? null,
    depth: o.depth === "quick" ? "quick" : "deep",
  };
}

/* ---------- proposals ------------------------------------------------------ */

export interface ProposalDb {
  id: number;
  kind: "meta" | "redirect";
  address: string;
  before_json: string;
  after_json: string;
  why: string | null;
  source: "operator" | "person";
  task_id: number | null;
  proposed_by: string | null;
  state: ProposalState;
  decided_by: string | null;
  decided_at: string | null;
  applied_at: string | null;
  sha: string | null;
  withdrawn_by: string | null;
  withdrawn_at: string | null;
  withdrawn_sha: string | null;
  error: string | null;
  note: string | null;
  created_at: string;
}

export const proposalById = (id: number): ProposalDb | undefined => db.prepare("SELECT * FROM cc_proposals WHERE id = ?").get(id) as ProposalDb | undefined;

/** The plain consequence of approving a proposal, in one sentence. */
export function consequence(p: Pick<ProposalDb, "kind" | "address"> & { after: ProposalRow["after"] }): string {
  if (p.kind === "redirect") {
    return `Anyone who opens ${p.address} on the live site, from a link or a search result, is sent to ${p.after.to ?? "?"} instead, within about two minutes.`;
  }
  const what = p.after.title !== undefined && p.after.description !== undefined ? "the title and description" : p.after.title !== undefined ? "the title" : "the description";
  return `This changes ${what} Google and shared links show for ${p.address} on the live site within about two minutes.`;
}

/**
 * An approval that is still "approved" this long after it was decided was cut
 * off: the desk stopped (a restart, a deploy) between marking it and the push
 * finishing, and nothing will finish it. It is offered again like one that
 * failed: Apply again is safe (a file that already says it commits nothing),
 * and Reject first checks the site's file.
 */
export const STUCK_MS = 5 * 60_000;

export const stuck = (p: Pick<ProposalDb, "state" | "error" | "decided_at">): boolean =>
  p.state === "approved" && !p.error && !!p.decided_at && Date.now() - Date.parse(p.decided_at) > STUCK_MS;

export function toProposalRow(p: ProposalDb, shaUrl: (sha: string) => string | null = () => null): ProposalRow {
  const after = json<ProposalRow["after"]>(p.after_json, {});
  return {
    id: p.id,
    kind: p.kind,
    address: p.address,
    before: json<ProposalRow["before"]>(p.before_json, {}),
    after,
    shownTitle: p.kind === "meta" && after.title !== undefined ? shownTitle(after.title) : null,
    drift: null,
    why: p.why,
    source: p.source,
    taskId: p.task_id,
    proposedBy: p.proposed_by,
    state: p.state,
    decidedBy: p.decided_by,
    decidedAt: p.decided_at,
    appliedAt: p.applied_at,
    sha: p.sha,
    shaUrl: p.sha ? shaUrl(p.sha) : null,
    withdrawnBy: p.withdrawn_by,
    withdrawnAt: p.withdrawn_at,
    error: stuck(p)
      ? `The desk stopped while applying it (approved by ${p.decided_by ?? "a person"}), so it is not known whether it reached the site. Apply again: if the site's file already says it, nothing new is committed.`
      : p.error,
    note: p.note,
    createdAt: p.created_at,
    consequence: consequence({ kind: p.kind, address: p.address, after }),
    lengths: { title: p.kind === "meta" && after.title !== undefined ? shownTitle(after.title).length : null, description: after.description?.length ?? null },
  };
}

/* ---------- to-dos ---------------------------------------------------------- */

export interface TodoDb {
  id: number;
  title: string;
  note: string | null;
  who: string;
  done: number;
  created_at: string;
  done_at: string | null;
  done_by: string | null;
}

export const toTodoRow = (t: TodoDb): TodoRow => ({
  id: t.id,
  title: t.title,
  note: t.note,
  who: t.who,
  done: !!t.done,
  createdAt: t.created_at,
  doneAt: t.done_at,
  doneBy: t.done_by,
});
