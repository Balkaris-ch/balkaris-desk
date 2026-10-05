import { db } from "../../db.ts";
import type { ContextChoice, Depth, ProposalChange, ProposalKind, ProposalRow, ProposalState, TaskKind, TaskRow, TaskState, TodoRow, UploadedPicture } from "../../../web/src/contract/operator.ts";
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

  /* A share picture a person uploaded for a page, already made upright and
     sized here (pictures.ts), kept until an approval commits it to the site
     under public/desk/og/<name>. The name carries a hash of the bytes, so a
     new picture is always a new file name: networks cache share pictures by
     address for days. */
  CREATE TABLE IF NOT EXISTS cc_op_pictures (
    name        TEXT PRIMARY KEY,
    address     TEXT NOT NULL,
    format      TEXT NOT NULL,
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    bytes       INTEGER NOT NULL,
    data        BLOB NOT NULL,
    uploaded_by TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
`);

/* The live page read back after the deploy (apply.ts readBack), as JSON. Added to a table that exists on the box. */
try {
  db.exec("ALTER TABLE cc_proposals ADD COLUMN read_json TEXT");
} catch {
  /* already there */
}

export const now = (): string => new Date().toISOString();

export const KIND_LABEL: Record<TaskKind, string> = {
  ask: "Question",
  traffic: "Traffic summary",
  opportunities: "Opportunities",
  metadata: "Metadata proposals",
  redirect: "Redirect proposals",
  brief: "Brief",
  audit: "SEO audit",
  og: "Share card",
  schema: "Structured data",
  links: "Internal links",
  alt: "Alt texts",
  keywords: "Keyword judgements",
  serp: "Search results brief",
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
  /** "keywords": the phrases asked about. */
  ids?: number[];
  /** "serp": the kept result page. */
  serpId?: number;
  /** "schema": the block asked for. */
  schemaType?: "FAQPage" | "Service";
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
  kind: ProposalKind;
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
  read_json?: string | null;
}

export const proposalById = (id: number): ProposalDb | undefined => db.prepare("SELECT * FROM cc_proposals WHERE id = ?").get(id) as ProposalDb | undefined;

/** The site's address for a page, as Google and the overrides file name it. */
export const SITE = "https://www.balkaris.ch";

/** The picture an "og" proposal uploads with it: named /desk/og/<name> and kept in cc_op_pictures until it is committed. */
export function uploadedPicture(ogImage: string | undefined): UploadedPicture | null {
  const m = ogImage ? /^\/desk\/og\/([a-z0-9][a-z0-9._-]*)$/.exec(ogImage) : null;
  if (!m) return null;
  const r = db.prepare("SELECT name, format, width, height, bytes FROM cc_op_pictures WHERE name = ?").get(m[1]!) as
    | { name: string; format: UploadedPicture["format"]; width: number; height: number; bytes: number }
    | undefined;
  return r ? { ...r, url: `/api/v1/operator/pictures/${r.name}`, sitePath: `/desk/og/${r.name}` } : null;
}

/** The plain consequence of approving a proposal, in one sentence. */
export function consequence(p: Pick<ProposalDb, "kind" | "address"> & { after: ProposalRow["after"] }): string {
  const a = p.after;
  switch (p.kind) {
    case "redirect":
      return `Anyone who opens ${p.address} on the live site, from a link or a search result, is sent to ${a.to ?? "?"} instead, within about two minutes.`;
    case "og": {
      const parts = [a.ogTitle !== undefined ? "share title" : null, a.ogDescription !== undefined ? "share description" : null, a.ogImage !== undefined ? "share picture" : null].filter(Boolean);
      return `This changes the ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")} LinkedIn, WhatsApp, X and other apps show when somebody shares ${p.address}, from the next deploy (about two minutes). Apps keep an old card for a few days.`;
    }
    case "index":
      return a.noindex
        ? `${p.address} tells search engines not to list it ("noindex, follow") and leaves the sitemap, the journal feed and llms.txt on the next deploy. The page itself stays online and its links are still followed. Google drops it at its next visit.`
        : `${p.address} may be listed by search engines again and returns to the sitemap on the next deploy, unless the website keeps it out of search for its own reasons.`;
    case "canonical":
      return `${p.address} tells search engines to count ${a.canonical ?? "?"} instead, and leaves the sitemap, the journal feed and llms.txt on the next deploy. The page stays online. Only right when the two pages really say the same thing.`;
    case "schema":
      return `${p.address} prints one more structured-data block (${a.jsonLd?.["@type"] ?? "?"}) for search engines and AI assistants, from the next deploy. Nothing a reader sees changes.`;
    default: {
      const what = a.title !== undefined && a.description !== undefined ? "the title and description" : a.title !== undefined ? "the title" : "the description";
      return `This changes ${what} Google and shared links show for ${p.address} on the live site within about two minutes.`;
    }
  }
}

/** Field by field, what approving changes, before and after, as a person reads it. */
export function changesOf(kind: ProposalKind, address: string, before: ProposalRow["before"], after: ProposalRow["after"], picture: UploadedPicture | null): ProposalChange[] {
  const out: ProposalChange[] = [];
  const text = (label: string, b: string | null | undefined, a: string | undefined) => {
    if (a !== undefined) out.push({ label, look: "text", before: b ?? null, after: a });
  };
  switch (kind) {
    case "redirect":
      out.push({ label: "Redirect", look: "text", before: `${address} answers 404 or 410`, after: `${address} → ${after.to ?? "?"}` });
      break;
    case "og":
      text("Share title", before.ogTitle, after.ogTitle);
      text("Share description", before.ogDescription, after.ogDescription);
      if (after.ogImage !== undefined) out.push({ label: "Share picture", look: "picture", before: before.ogImage ?? null, after: picture ? picture.url : `${SITE}${after.ogImage}` });
      break;
    case "index":
      out.push({
        label: "In search",
        look: "text",
        before: before.noindex ? "Out of search (noindex), not in the sitemap" : "Listed: in the sitemap, open to search engines",
        after: after.noindex ? "Out of search (noindex, follow), not in the sitemap" : "Listed again: back in the sitemap",
      });
      break;
    case "canonical":
      out.push({ label: "Canonical address", look: "text", before: before.canonical ?? `${SITE}${address} (its own)`, after: `${SITE}${after.canonical ?? "?"}` });
      break;
    case "schema":
      out.push({
        label: `Structured data: ${after.jsonLd?.["@type"] ?? "?"}`,
        look: "code",
        before: before.schemaTypes?.length ? `The page prints ${before.schemaTypes.join(", ")}` : "The page prints no structured data the crawl read",
        after: after.jsonLd ? JSON.stringify(after.jsonLd, null, 2) : null,
      });
      break;
    default:
      if (after.title !== undefined) out.push({ label: "Title", look: "text", before: before.title ?? null, after: shownTitle(after.title) });
      text("Description", before.description, after.description);
  }
  return out;
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
  const before = json<ProposalRow["before"]>(p.before_json, {});
  const picture = p.kind === "og" ? uploadedPicture(after.ogImage) : null;
  return {
    id: p.id,
    kind: p.kind,
    address: p.address,
    before,
    after,
    changes: changesOf(p.kind, p.address, before, after, picture),
    picture,
    readBack: json<ProposalRow["readBack"]>(p.read_json, null),
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
    lengths: {
      title: p.kind === "meta" && after.title !== undefined ? shownTitle(after.title).length : p.kind === "og" && after.ogTitle !== undefined ? after.ogTitle.length : null,
      description: after.description?.length ?? after.ogDescription?.length ?? null,
    },
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
