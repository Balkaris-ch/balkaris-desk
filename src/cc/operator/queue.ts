import { HTTPException } from "hono/http-exception";
import { db, lastBeat } from "../../db.ts";
import type { Person } from "../../people.ts";
import type { ContextChoice, Depth, Given, KeywordJudgement, NewTask, Opportunity, Brief, ResultCard, RunnerState, SerpBrief, SuggestedTodo, TaskKind, TaskResult, TaskRow, TaskState } from "../../../web/src/contract/operator.ts";
import { gaRange, type GaRange } from "../ga4.ts";
import { runNow, status as jobStatus } from "../scheduler.ts";
import { crawledAt, inventory } from "../site/index.ts";
import { note, setState, state as stateOf } from "../store.ts";
import { proposalRow, propose } from "./apply.ts";
import { buildPrompt, check, type Prompted } from "./kinds.ts";
import {
  BUDGET,
  contextBlocks,
  insightsBlock,
  issuesBlock,
  knownPaths,
  META_MOST,
  metaBlock,
  metaTargets,
  pageBlock,
  pagesBlock,
  redirectBlock,
  redirectTargets,
  searchBlock,
  trafficBlock,
  type Pack,
} from "./packs.ts";
import { altPack, keywordsPack, KEYWORDS_MOST, linksPack, ogPack, schemaPack, serpPack } from "./sitepacks.ts";
import { isKind, json, KIND_LABEL, now, taskById, toTaskRow, type TaskDb, type TaskOptions } from "./tables.ts";

/**
 * The operator's queue: a person asks, the box assembles, the workstation
 * answers, the box checks.
 *
 *   createTask   a request from the screen becomes a row, with its context
 *                pack assembled here and now from the desk's own data.
 *   handOut      the runner asks for work (POST /runner/op/next): the oldest
 *                queued task, with its finished prompt, unless an article is
 *                waiting. Articles always come first.
 *   takeResult   the runner returns the model's answer (POST
 *                /runner/op/result/:id). It is checked (kinds.ts); refused
 *                once, it goes back to the front of the queue with the reason
 *                quoted; refused twice, what can be kept is kept and named.
 *   cancel       Stop: a queued task is cancelled; a running one is marked
 *                cancelled and its answer, when it comes, is discarded.
 *
 * A TASK LEFT RUNNING IS RECLAIMED. The runner does one thing at a time, so a
 * runner that asks for work holds nothing: a task still marked running under
 * its name was cut off by a restart, and goes back to the queue at once. A
 * runner that never comes back loses its task after fifteen minutes, and
 * that is checked whenever the screen is read too, not only when a runner
 * asks: a workstation switched off mid-answer must not read as "working"
 * all night. Past the longest an answer takes, a running task is shown as
 * lost contact, and it no longer makes the workstation "online". After three
 * hand-outs a task is failed rather than tried forever.
 *
 * THE WORKSTATION IS JUDGED BY ITS OPERATOR ASKS. The article runner's
 * heartbeat (db.ts `beat`) says the machine is on, not that its runner takes
 * operator tasks: until runner.ts calls `operatorOnce`, and while the box is
 * ahead of the workstation's build, it never does. So the time of the last
 * ask for an operator task is kept on its own (cc_state OP_SEEN).
 */

/** Open tasks one desk will hold: a queue longer than this is a mistake, not a plan. */
const OPEN_MOST = 20;
/** A running task whose runner has said nothing for this long goes back to the queue. */
const STALE_MINUTES = 15;
/**
 * No answer takes longer than this: the model's own limit (kinds.ts, five
 * minutes) and the time to start the model, with room. A task running
 * longer has lost its workstation, until STALE_MINUTES hands it back.
 */
const ANSWER_MS = 8 * 60_000;
/** Hand-outs before a task is given up on. */
const MOST_ATTEMPTS = 3;
/** A crawl younger than this is fresh enough for an audit: the site is not crawled again. It is also the least time between two crawls an audit asks for. */
const FRESH_CRAWL_MS = 10 * 60_000;
/** The workstation counts as on when it asked for work this recently. */
const AWAKE_MS = 5 * 60_000;
/** cc_state: the last ask for an operator task, { name, at }. */
const OP_SEEN = "op:runner:seen";

/**
 * The job kinds the workstation's runner takes: src/runner.ts asks
 * /runner/next for exactly these. A queued job of another kind is nobody's
 * work, so it never holds up a question. Keep this in step with runner.ts.
 */
export const RUNNER_KINDS = ["ingest", "write", "cover", "clip"] as const;

const fail = (status: 400 | 404 | 409 | 429, message: string): never => {
  throw new HTTPException(status, { message });
};

const CONTEXTS: ContextChoice[] = ["website", "pages", "traffic", "issues", "insights", "none"];
const CONTEXT_LABEL: Record<ContextChoice, string> = {
  website: "the website context (pages, traffic and findings)",
  pages: "the pages",
  traffic: "the traffic",
  issues: "the crawl's findings",
  insights: "the articles",
  none: "no data",
};

/* ---------- making a task -------------------------------------------------------------- */

const RANGE_WORDS: Record<GaRange, string> = { "24h": "the last day", "7d": "the last 7 days", "30d": "the last 30 days", "90d": "the last 90 days", "1y": "the last 12 months" };

/** The blocks a kind is given, inside its depth's budget. */
async function packFor(kind: TaskKind, o: TaskOptions, range: GaRange, depth: Depth): Promise<Pack> {
  const room = BUDGET[depth];
  const pack: Pack = { builtAt: now(), range, depth, blocks: [], known: knownPaths() };
  switch (kind) {
    case "ask":
      pack.blocks = await contextBlocks(o.context ?? "website", range, room, o.path);
      break;
    case "traffic":
      pack.blocks = [await trafficBlock(range, room)];
      break;
    case "opportunities":
      pack.blocks = [issuesBlock(Math.floor(room * 0.45)), await searchBlock(range, Math.floor(room * 0.25)), await trafficBlock(range, Math.floor(room * 0.3))];
      break;
    case "brief":
      /* A brief about one page (Expand content, a page's own brief) is given the page in depth, as a question about it is. */
      pack.blocks = o.path
        ? [await pageBlock(o.path, range, Math.floor(room * 0.45)), pagesBlock(Math.floor(room * 0.3)), await insightsBlock(range, Math.floor(room * 0.25))]
        : [pagesBlock(Math.floor(room * 0.55)), await insightsBlock(range, Math.floor(room * 0.45))];
      break;
    case "og":
      Object.assign(pack, await ogPack(o.path!));
      break;
    case "schema":
      Object.assign(pack, await schemaPack(o.path!, o.schemaType));
      break;
    case "links":
      Object.assign(pack, await linksPack(o.path!));
      break;
    case "alt":
      Object.assign(pack, await altPack(o.path!));
      break;
    case "keywords":
      Object.assign(pack, keywordsPack(o.ids));
      break;
    case "serp":
      Object.assign(pack, await serpPack(o.serpId, o.path));
      break;
    case "audit":
      pack.blocks = [issuesBlock(room)];
      break;
    case "metadata": {
      const m = await metaTargets(o.paths, depth);
      if (!m.targets.length) {
        fail(409, m.skipped.length ? `No page to write metadata for: ${m.skipped.join(" ")}` : "No page needs new metadata: no title or description in the sitemap breaks a rule at the last crawl.");
      }
      pack.meta = m.targets;
      pack.blocks = [metaBlock(m.targets, crawledAt())];
      pack.skipped = [...m.skipped, ...(m.more ? [`${m.more} more ${m.more === 1 ? "page needs" : "pages need"} new metadata; run it again when these are decided.`] : [])];
      break;
    }
    case "redirect": {
      const r = redirectTargets();
      if (!r.targets.length) {
        fail(409, r.skipped.length ? `Nothing the operator can redirect: ${r.skipped.join(" ")}` : "Nothing to redirect: no internal link is broken and no page has left the site in the last three months.");
      }
      pack.redirects = r.targets;
      pack.blocks = [redirectBlock(r.targets, r.asOf)];
      pack.skipped = r.skipped;
      break;
    }
  }
  return pack;
}

/**
 * What a task is called on the screen and in its result. A question and a
 * brief's topic are the person's own words. Every other kind is named by
 * what it really does, with its real period: a suggestion's words ("this
 * month") would otherwise label a result that covers another span.
 */
function titleFor(kind: TaskKind, input: NewTask, o: TaskOptions, range: GaRange): string {
  const said = (input.prompt ?? "").replace(/\s+/g, " ").trim();
  if (kind === "ask") return said;
  if (kind === "brief") return said.slice(0, 300);
  switch (kind) {
    case "traffic":
      return `Analyze traffic for ${RANGE_WORDS[range]}`;
    case "opportunities":
      return "Find new content and SEO opportunities";
    case "metadata":
      return o.paths?.length ? `Create metadata for ${o.paths.join(", ")}` : "Create metadata for the pages that need it";
    case "redirect":
      return "Propose redirects for addresses that no longer answer";
    case "audit":
      return "Run a full SEO audit";
    case "og":
      return `Write a share card for ${o.path}`;
    case "schema":
      return `Draft ${o.schemaType ?? "structured data"} for ${o.path}`;
    case "links":
      return `Find pages that should link to ${o.path}`;
    case "alt":
      return `Write alt texts for the pictures on ${o.path}`;
    case "keywords":
      return o.ids?.length ? `Sort ${o.ids.length} search ${o.ids.length === 1 ? "phrase" : "phrases"}` : "Sort the searches that wait for a judgement";
    case "serp":
      return said ? said.slice(0, 300) : `Compare our page with the first results${o.serpId ? ` (result page #${o.serpId})` : ""}`;
    default:
      return KIND_LABEL[kind];
  }
}

/** Queue a request. The context is read now, so what the model is given is what the person saw. */
export async function createTask(input: NewTask, by: Person): Promise<TaskRow> {
  if (!isKind(input.kind)) fail(400, "That is not a kind of task the operator knows.");
  const kind = input.kind;
  const prompt = (input.prompt ?? "").replace(/\s+/g, " ").trim();
  if (prompt.length > 1000) fail(400, "Keep the question under 1,000 characters: the workstation's model reads a few thousand in all, data included.");
  if (kind === "ask" && prompt.length < 3) fail(400, "Write a question first.");
  if (kind === "brief" && prompt.length < 3) fail(400, "Say what the brief is about: a topic or a search query.");
  const open = (db.prepare("SELECT COUNT(*) AS n FROM cc_ai_tasks WHERE state IN ('queued','running')").get() as { n: number }).n;
  if (open >= OPEN_MOST) fail(429, `${open} tasks are already waiting for the workstation. Stop some, or wait for them to finish.`);

  const range = gaRange(input.range);
  const depth: Depth = input.depth === "quick" ? "quick" : "deep";
  const context: ContextChoice = CONTEXTS.includes(input.context as ContextChoice) ? (input.context as ContextChoice) : "website";
  const known = new Set(knownPaths());
  const paths = (input.paths ?? []).map((p) => String(p).trim()).filter(Boolean).slice(0, META_MOST);
  const path = input.path ? String(input.path).trim() : undefined;
  if (path && !known.has(path)) fail(400, `The crawl knows no page at ${path}.`);
  if (!path && (kind === "og" || kind === "schema" || kind === "links" || kind === "alt")) fail(400, "Say which page: this task works on one page.");
  const ids = [...new Set((input.ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length > KEYWORDS_MOST) fail(400, `At most ${KEYWORDS_MOST} phrases at once: the workstation's model judges that many well.`);
  const serpId = Number.isInteger(input.serpId) && (input.serpId ?? 0) > 0 ? input.serpId : undefined;
  const schemaType = input.schemaType === "Service" || input.schemaType === "FAQPage" ? input.schemaType : undefined;
  const o: TaskOptions = {
    depth,
    range,
    ...(kind === "ask" ? { context } : {}),
    ...(paths.length ? { paths } : {}),
    ...(path ? { path } : {}),
    ...(kind === "keywords" && ids.length ? { ids } : {}),
    ...(kind === "serp" && serpId ? { serpId } : {}),
    ...(kind === "schema" && schemaType ? { schemaType } : {}),
  };

  let pack: Pack | null = null;
  let stage: string | null = null;
  if (kind === "audit") {
    /* The audit's crawl runs first, unless the last one is minutes old. It
       keeps the same rules as the "run now" door (api.ts POST /jobs/:name/run):
       never a crawl the owner switched off or one that cannot run, and never
       two inside the floor. scheduler.runNow itself checks none of that. */
    const at = crawledAt();
    if (at && Date.now() - Date.parse(at) < FRESH_CRAWL_MS) pack = await packFor(kind, o, range, depth);
    else {
      const crawl = jobStatus().find((j) => j.name === "crawl") ?? fail(409, "This desk has no crawl, and an audit summarises a fresh crawl.");
      if (!crawl.ready) fail(409, "The crawl cannot run on this desk (what it reads is not connected), and an audit summarises a fresh crawl.");
      if (!crawl.enabled) fail(409, "The owner has switched the crawl off in Automations, and an audit needs a fresh crawl. It can be switched back on there.");
      stage = "crawl";
      o.crawlAsked = now();
      if (!crawl.running) {
        const last = crawl.lastStart ? Date.parse(crawl.lastStart) : 0;
        if (Date.now() - last < FRESH_CRAWL_MS) {
          /* It started minutes ago, is not running, and left no fresh crawl: it failed. */
          const mins = Math.max(1, Math.ceil((last + FRESH_CRAWL_MS - Date.now()) / 60_000));
          fail(429, `The crawl that started ${Math.max(1, Math.round((Date.now() - last) / 60_000))} minutes ago failed (${crawl.lastNote ?? "no reason given"}). It can be asked for again in ${mins} minute${mins === 1 ? "" : "s"}.`);
        }
        if (!runNow("crawl")) fail(409, "The crawl cannot run on this desk: what it reads is not connected.");
      }
      /* A crawl running now is joined: what it finds is newer than the question. */
    }
  } else {
    pack = await packFor(kind, o, range, depth);
  }

  const r = db
    .prepare("INSERT INTO cc_ai_tasks (kind, prompt, options, pack, state, stage, asked_by, asked_by_id, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)")
    .run(kind, titleFor(kind, input, o, range), JSON.stringify(o), pack ? JSON.stringify(pack) : null, stage, by.name, by.telegram, o.crawlAsked ?? now());
  return openRows().find((t) => t.id === Number(r.lastInsertRowid)) ?? toTaskRow(taskById(Number(r.lastInsertRowid))!);
}

/* ---------- an audit waits for its crawl ------------------------------------------------- */

/**
 * Move audits whose crawl has finished on to the queue proper, with the
 * findings of that crawl. Run when the runner asks AND when the screen is
 * read (the route calls it), so an audit whose crawl finished while the
 * workstation was off says it waits for the workstation, not for the crawl.
 */
export async function advanceAudits(): Promise<void> {
  const waiting = db.prepare("SELECT * FROM cc_ai_tasks WHERE kind = 'audit' AND state = 'queued' AND stage = 'crawl'").all() as unknown as TaskDb[];
  if (!waiting.length) return;
  const crawl = jobStatus().find((j) => j.name === "crawl");
  if (crawl?.running) return;
  const at = crawledAt();
  for (const t of waiting) {
    const o = json<TaskOptions>(t.options, {});
    const asked = o.crawlAsked ?? t.created_at;
    const ranSince = crawl?.lastStart && crawl.lastStart >= asked;
    if (at && at >= asked) {
      const pack = await packFor("audit", o, gaRange(o.range), o.depth === "quick" ? "quick" : "deep");
      db.prepare("UPDATE cc_ai_tasks SET pack = ?, stage = NULL WHERE id = ? AND stage = 'crawl'").run(JSON.stringify(pack), t.id);
    } else if (ranSince) {
      /* The crawl ran and did not finish. The last good crawl is summarised, and says so. */
      if (!at) {
        finish(t.id, "failed", { error: `The crawl failed (${crawl?.lastNote ?? "no reason given"}) and there is no earlier crawl to summarise.` });
        continue;
      }
      const pack = await packFor("audit", o, gaRange(o.range), o.depth === "quick" ? "quick" : "deep");
      pack.skipped = [`The new crawl did not finish (${crawl?.lastNote ?? "no reason given"}); this summarises the crawl that finished ${at}.`];
      db.prepare("UPDATE cc_ai_tasks SET pack = ?, stage = NULL WHERE id = ? AND stage = 'crawl'").run(JSON.stringify(pack), t.id);
    } else if (Date.now() - Date.parse(asked) > 30 * 60_000) {
      /* Asked half an hour ago and never started (the desk restarted, and
         the scheduler forgot what it was asked): ask again, by the same rules. */
      if (!crawl?.ready || !crawl.enabled) {
        finish(t.id, "failed", { error: crawl && !crawl.enabled ? "The owner switched the crawl off in Automations before it ran, so there is no new crawl to summarise." : "The crawl cannot run on this desk: what it reads is not connected." });
        continue;
      }
      if (!runNow("crawl")) {
        finish(t.id, "failed", { error: "The crawl cannot run on this desk: what it reads is not connected." });
        continue;
      }
      o.crawlAsked = now();
      db.prepare("UPDATE cc_ai_tasks SET options = ? WHERE id = ?").run(JSON.stringify(o), t.id);
    }
  }
}

/* ---------- the runner's side --------------------------------------------------------------- */

/** Article jobs the runner has waiting, of the kinds it takes: they go before any question. */
export function articlesWaiting(): number {
  try {
    const marks = RUNNER_KINDS.map(() => "?").join(",");
    return (
      db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE state = 'queued' AND kind IN (${marks}) AND (not_before IS NULL OR not_before <= datetime('now'))`).get(...RUNNER_KINDS) as {
        n: number;
      }
    ).n;
  } catch {
    return 0;
  }
}

function reclaim(runner: string | null): void {
  const stale = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  const rows = db
    .prepare("SELECT id, attempts FROM cc_ai_tasks WHERE state = 'running' AND (runner = ? OR taken_at < ?)")
    .all(runner ?? "\u0000", stale) as { id: number; attempts: number }[];
  for (const r of rows) {
    if (r.attempts >= MOST_ATTEMPTS) {
      finish(r.id, "failed", { error: `The workstation stopped ${r.attempts} times while working on it, so it was given up.` });
    } else {
      db.prepare("UPDATE cc_ai_tasks SET state = 'queued', runner = NULL, taken_at = NULL, stage = NULL WHERE id = ?").run(r.id);
    }
  }
}

/** What the runner is handed. */
export interface Handed extends Prompted {
  id: number;
  kind: TaskKind;
  attempt: number;
}

/** When a runner last asked for an operator task, and which. */
function opSeen(): { name: string; at: string } | null {
  const raw = stateOf(OP_SEEN);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { name?: unknown; at?: unknown };
    return typeof v.at === "string" ? { name: typeof v.name === "string" ? v.name : "runner", at: v.at } : null;
  } catch {
    return null;
  }
}

/** POST /runner/op/next: the next task, or why there is none. */
export async function handOut(runner: string): Promise<{ task: Handed | null; wait?: string }> {
  setState(OP_SEEN, JSON.stringify({ name: runner, at: now() }));
  reclaim(runner);
  await advanceAudits();
  const articles = articlesWaiting();
  if (articles) return { task: null, wait: `${articles} article job${articles === 1 ? "" : "s"} first` };
  /* Nothing awaited between choosing and marking: a second runner asking in
     the same moment cannot be handed the same task. */
  const t = db.prepare("SELECT * FROM cc_ai_tasks WHERE state = 'queued' AND stage IS NULL ORDER BY id LIMIT 1").get() as unknown as TaskDb | undefined;
  if (!t) return { task: null };
  const pack = json<Pack | null>(t.pack, null);
  if (!pack) {
    finish(t.id, "failed", { error: "Its data could not be read back." });
    return { task: null };
  }
  db.prepare("UPDATE cc_ai_tasks SET state = 'running', runner = ?, taken_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?").run(runner, now(), t.id);
  return { task: { id: t.id, kind: t.kind, attempt: t.attempts + 1, ...buildPrompt(t.kind, t.prompt, pack, t.retry_note) } };
}

/** What the runner sends back. */
export interface Returned {
  ok: boolean;
  text?: string;
  error?: string;
  model?: string;
  ms?: number;
}

/** What the answer held, kept beside its text. */
interface ResultData {
  opportunities?: Opportunity[];
  brief?: Brief;
  keywords?: KeywordJudgement[];
  serp?: SerpBrief;
  todos?: SuggestedTodo[];
  /** When its to-dos were put on the to-do list, and by whom. */
  todosAdded?: { at: string; by: string };
  proposals: number[];
  flags: string[];
  sub: string;
}

function finish(id: number, state: "done" | "failed" | "cancelled", o: { text?: string; data?: ResultData; error?: string; model?: string | null; ms?: number | null } = {}): void {
  db.prepare("UPDATE cc_ai_tasks SET state = ?, stage = NULL, finished_at = ?, result_text = ?, result_data = ?, error = ?, model = COALESCE(?, model), ms = COALESCE(?, ms) WHERE id = ?").run(
    state,
    now(),
    o.text ?? null,
    o.data ? JSON.stringify(o.data) : null,
    o.error ? o.error.slice(0, 600) : null,
    o.model ?? null,
    o.ms ?? null,
    id,
  );
  const t = taskById(id)!;
  if (state === "failed") {
    note("operator", `Could not finish: ${short(t.prompt, 70)}`, { tone: "bad", detail: o.error?.slice(0, 200), href: `/operator/results/${id}`, actor: "operator", dedupe: `op:task:${id}:failed` });
  }
}

const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** One line, as the activity feed and the result cards say what a task produced. */
function said(t: TaskDb, kept: { text: string; opportunities?: Opportunity[]; brief?: Brief; keywords?: KeywordJudgement[]; serp?: SerpBrief; todos?: SuggestedTodo[] }, proposals: number, pack: Pack): { text: string; detail: string; sub: string } {
  const from = pack.blocks.filter((b) => b.state === "ok").map((b) => b.label);
  const fromLine = from.length ? `From ${from.join(", ")}` : "No data was attached";
  switch (t.kind) {
    case "traffic":
      return { text: `Analyzed traffic for ${RANGE_WORDS[pack.range]}`, detail: fromLine, sub: `${RANGE_WORDS[pack.range][0]!.toUpperCase()}${RANGE_WORDS[pack.range].slice(1)}` };
    case "opportunities": {
      const n = kept.opportunities?.length ?? 0;
      return { text: `Found ${n} ${n === 1 ? "opportunity" : "opportunities"}`, detail: fromLine, sub: `${n} ${n === 1 ? "opportunity" : "opportunities"}` };
    }
    case "metadata":
      return { text: `Proposed metadata for ${proposals} ${proposals === 1 ? "page" : "pages"}`, detail: short(kept.text.split(": ")[1]?.split(". ")[0] ?? "", 90), sub: `${proposals} ${proposals === 1 ? "proposal" : "proposals"} for approval` };
    case "redirect":
      return { text: `Proposed ${proposals} ${proposals === 1 ? "redirect" : "redirects"}`, detail: "For addresses that no longer answer", sub: `${proposals} ${proposals === 1 ? "proposal" : "proposals"} for approval` };
    case "brief":
      return { text: `Wrote a brief: ${short(kept.brief?.title ?? t.prompt, 60)}`, detail: short(t.prompt, 80), sub: short(kept.brief?.title ?? t.prompt, 48) };
    case "audit":
      return { text: "Summarised the SEO audit", detail: fromLine, sub: `The crawl of ${pack.blocks[0]?.asOf?.slice(0, 10) ?? "today"}` };
    case "og":
    case "schema":
      return { text: `Proposed ${t.kind === "og" ? "a share card" : "structured data"} for ${pack.page?.path ?? "a page"}`, detail: "From the page's own text", sub: `${proposals} ${proposals === 1 ? "proposal" : "proposals"} for approval` };
    case "links":
    case "alt": {
      const n = kept.todos?.length ?? 0;
      return { text: `${t.kind === "links" ? "Suggested links to" : "Wrote alt texts for"} ${pack.page?.path ?? "a page"}`, detail: `${n} to-do${n === 1 ? "" : "s"} for the website's code`, sub: `${n} to-do${n === 1 ? "" : "s"}` };
    }
    case "keywords": {
      const n = kept.keywords?.length ?? 0;
      return { text: `Judged ${n} search ${n === 1 ? "phrase" : "phrases"}`, detail: "Waiting to be applied on Keywords", sub: `${n} judgements` };
    }
    case "serp":
      return { text: `Compared the first results for “${short(kept.serp?.phrase ?? "", 40)}”`, detail: fromLine, sub: short(kept.serp?.phrase ?? t.prompt, 48) };
    default:
      return { text: `Answered: ${short(t.prompt, 60)}`, detail: fromLine, sub: short(t.prompt, 48) };
  }
}

/** POST /runner/op/result/:id. */
export async function takeResult(id: number, body: Returned): Promise<{ ok: true; state: TaskState | "discarded" | "ignored" }> {
  const t = taskById(id);
  if (!t) fail(404, "no such task");
  const task = t as TaskDb;
  if (task.state === "cancelled") return { ok: true, state: "discarded" };
  if (task.state !== "running") return { ok: true, state: "ignored" };

  if (!body.ok) {
    finish(id, "failed", { error: body.error ?? "The workstation gave no reason.", model: body.model ?? null, ms: body.ms ?? null });
    return { ok: true, state: "failed" };
  }

  const pack = json<Pack | null>(task.pack, null);
  if (!pack) {
    finish(id, "failed", { error: "Its data could not be read back." });
    return { ok: true, state: "failed" };
  }
  const inv = inventory();
  const titles = new Map<string, string | null>(inv.state === "ok" ? inv.value.map((r) => [r.path, r.title]) : []);
  /* A runaway answer is cut, not kept whole: no task asks for more than a few hundred words. */
  const verdict = check(task.kind, task.prompt, pack, String(body.text ?? "").slice(0, 20_000), !!task.retried, titles);

  if (!verdict.ok) {
    if (!task.retried) {
      /* Back to the front: its id keeps its place in the queue. */
      db.prepare("UPDATE cc_ai_tasks SET state = 'queued', retried = 1, retry_note = ?, runner = NULL, taken_at = NULL WHERE id = ?").run(verdict.why.slice(0, 600), id);
      return { ok: true, state: "queued" };
    }
    finish(id, "failed", { error: `The answer was refused twice. The second time: ${verdict.why}`, model: body.model ?? null, ms: body.ms ?? null });
    return { ok: true, state: "failed" };
  }

  const kept = verdict.kept;
  /* Proposals are checked against the live site, which takes a moment:
     claim the task first, so a Stop or a second answer meanwhile is noticed. */
  const claimed = db.prepare("UPDATE cc_ai_tasks SET stage = 'checking' WHERE id = ? AND state = 'running' AND stage IS NULL").run(id);
  if (!claimed.changes) return { ok: true, state: "ignored" };
  const ids: number[] = [];
  const flags = [...kept.flags];
  for (const p of kept.proposals) {
    const made = await propose(p, { source: "operator", taskId: id });
    if ("refused" in made) flags.push(`Not proposed for ${p.address}: ${made.refused}`);
    else ids.push(made.id);
  }
  /* Stopped while its proposals were being checked: nothing it made is kept. */
  if (taskById(id)?.state !== "running") {
    for (const pid of ids) db.prepare("UPDATE cc_proposals SET state = 'rejected', decided_by = 'the operator', decided_at = ?, note = ? WHERE id = ? AND state = 'waiting'").run(now(), "Its task was stopped before it finished.", pid);
    return { ok: true, state: "discarded" };
  }
  flags.push(...(pack.skipped ?? []));
  const line = said(task, kept, ids.length, pack);
  finish(id, "done", {
    text: kept.text,
    data: { opportunities: kept.opportunities, brief: kept.brief, keywords: kept.keywords, serp: kept.serp, todos: kept.todos, proposals: ids, flags, sub: line.sub },
    model: body.model ?? null,
    ms: body.ms ?? null,
  });
  note("operator", line.text, { tone: "good", detail: line.detail, href: `/operator?result=${id}#response`, actor: "operator", dedupe: `op:task:${id}:done` });
  if (ids.length) {
    note("operator-proposal", `${ids.length} ${ids.length === 1 ? "change waits" : "changes wait"} for approval`, {
      tone: "warn",
      detail: kept.proposals.map((p) => p.address).slice(0, 4).join(", "),
      href: "/operator?ap=waiting#approvals",
      actor: "operator",
      dedupe: `op:task:${id}:proposed`,
    });
  }
  return { ok: true, state: "done" };
}

/** Stop. A queued task is cancelled; a running one too, and its answer is discarded when it arrives. */
export function cancel(id: number, by: Person): TaskRow {
  const t = taskById(id) ?? fail(404, `There is no task #${id}.`);
  if (t.state !== "queued" && t.state !== "running") fail(409, `That task is already ${t.state}.`);
  db.prepare("UPDATE cc_ai_tasks SET state = 'cancelled', finished_at = ?, error = ? WHERE id = ?").run(
    now(),
    t.state === "running" ? `Stopped by ${by.name} while the workstation was working on it; its answer is discarded.` : `Stopped by ${by.name} before the workstation took it.`,
    id,
  );
  return toTaskRow(taskById(id)!);
}

/* ---------- reading the queue ------------------------------------------------------------------ */

/** A running task past the longest an answer takes: its workstation has gone quiet. */
function lostOf(t: Pick<TaskDb, "state" | "taken_at">): TaskRow["lost"] {
  if (t.state !== "running" || !t.taken_at) return null;
  const at = Date.parse(t.taken_at);
  if (!Number.isFinite(at) || Date.now() - at < ANSWER_MS) return null;
  return { since: t.taken_at, backAt: new Date(at + STALE_MINUTES * 60_000).toISOString() };
}

/** Running tasks still within their time: the workstation is answering them. */
const answering = (): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM cc_ai_tasks WHERE state = 'running' AND taken_at >= ?").get(new Date(Date.now() - ANSWER_MS).toISOString()) as { n: number }).n;

/** Queued and running tasks, oldest first, each knowing what is ahead of it. */
export function openRows(): TaskRow[] {
  reclaim(null);
  const rows = db.prepare("SELECT * FROM cc_ai_tasks WHERE state IN ('queued','running') ORDER BY id").all() as unknown as TaskDb[];
  const crawl = jobStatus().find((j) => j.name === "crawl");
  const progress = crawl?.running && crawl.progress ? { done: crawl.progress.done, of: crawl.progress.of } : null;
  return rows.map((t, i) =>
    toTaskRow(t, {
      ahead: t.state === "queued" ? rows.slice(0, i).filter((r) => r.stage !== "crawl").length : null,
      crawl: t.stage === "crawl" ? progress : null,
      lost: lostOf(t),
    }),
  );
}

/** The workstation, as far as the desk can tell: by its asks for operator tasks, not by the article runner's. */
export function runnerState(): RunnerState {
  reclaim(null);
  const articles = articlesWaiting();
  const op = opSeen();
  const opAt = op ? Date.parse(op.at) : null;
  const beat = lastBeat();
  /* SQLite's datetime('now') is UTC without saying so. */
  const beatAt = beat ? Date.parse(`${beat.replace(" ", "T")}Z`) : null;
  const recent = (at: number | null) => at !== null && Number.isFinite(at) && Date.now() - at < AWAKE_MS;
  const iso = (at: number | null) => (at === null || !Number.isFinite(at) ? null : new Date(at).toISOString());
  let writing = 0;
  try {
    writing = (db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state = 'running' AND taken_at >= datetime('now', '-30 minutes')").get() as { n: number }).n;
  } catch {
    writing = 0;
  }

  if (recent(opAt) || answering()) {
    return { state: "online", lastSeen: iso(opAt), line: "Online.", articlesFirst: articles };
  }
  /* Busy with articles: a runner that takes operator tasks asks for one only when it has no article to do. */
  if (writing || (recent(beatAt) && articles)) {
    return opAt
      ? { state: "online", lastSeen: iso(opAt), line: "Online: writing an article now; questions wait until it is done.", articlesFirst: articles }
      : {
          state: "articles",
          lastSeen: iso(beatAt),
          line: "The workstation is writing an article; its runner does not take operator tasks yet.",
          articlesFirst: articles,
        };
  }
  if (recent(beatAt)) {
    return { state: "articles", lastSeen: iso(beatAt), line: "The workstation is on, but its runner does not take operator tasks yet.", articlesFirst: articles };
  }
  if (opAt) return { state: "off", lastSeen: iso(opAt), line: "The workstation is off: tasks wait until it is on.", articlesFirst: articles };
  return { state: "never", lastSeen: null, line: "No workstation has asked for operator tasks yet: they wait until one does.", articlesFirst: articles };
}

/** The task the model is working on now: running and within its time. */
export function workingNow(): { id: number; title: string } | null {
  reclaim(null);
  const t = db.prepare("SELECT id, prompt FROM cc_ai_tasks WHERE state = 'running' AND taken_at >= ? ORDER BY taken_at DESC LIMIT 1").get(new Date(Date.now() - ANSWER_MS).toISOString()) as
    | { id: number; prompt: string }
    | undefined;
  return t ? { id: t.id, title: t.prompt } : null;
}

const given = (pack: Pack | null): Given[] =>
  (pack?.blocks ?? []).map((b) => ({ name: b.name, label: b.label, source: b.source, asOf: b.asOf, state: b.state, ...(b.note ? { note: b.note } : {}) }));

/** A finished task in full. Null when there is no such task or it has not finished. */
export function result(id: number): TaskResult | null {
  const t = taskById(id);
  if (!t || (t.state !== "done" && t.state !== "failed")) return null;
  const data = json<ResultData | null>(t.result_data, null);
  return {
    task: toTaskRow(t),
    text: t.result_text ?? "",
    ...(data?.opportunities ? { opportunities: data.opportunities } : {}),
    ...(data?.brief ? { brief: data.brief } : {}),
    ...(data?.keywords ? { keywords: data.keywords } : {}),
    ...(data?.serp ? { serp: data.serp } : {}),
    ...(data?.todos ? { todos: data.todos, todosAdded: !!data.todosAdded } : {}),
    proposals: (data?.proposals ?? []).map(proposalRow).filter((p) => p !== null),
    given: given(json<Pack | null>(t.pack, null)),
    flags: data?.flags ?? [],
    model: t.model,
    ms: t.ms,
  };
}

/**
 * Put a finished task's suggested to-dos (links, alt texts) on the to-do
 * list, once: the desk cannot edit a page's body, so these are the website
 * code's work, and the list is where the studio keeps it.
 */
export function addTodos(id: number, by: Person): { added: number; line: string } {
  const t = taskById(id) ?? fail(404, `There is no task #${id}.`);
  const data = json<ResultData | null>(t.result_data, null);
  if (t.state !== "done" || !data?.todos?.length) return fail(409, "That task suggested nothing for the to-do list.");
  if (data.todosAdded) return fail(409, `Its to-dos were put on the list already, by ${data.todosAdded.by}.`);
  const have = new Set((db.prepare("SELECT title FROM cc_todos WHERE done = 0").all() as { title: string }[]).map((r) => r.title));
  let added = 0;
  for (const todo of data.todos) {
    if (have.has(todo.title)) continue;
    db.prepare("INSERT INTO cc_todos (title, note, who, created_at) VALUES (?, ?, ?, ?)").run(todo.title.slice(0, 400), todo.note.slice(0, 2000), by.name, now());
    added++;
  }
  db.prepare("UPDATE cc_ai_tasks SET result_data = ? WHERE id = ?").run(JSON.stringify({ ...data, todosAdded: { at: now(), by: by.name } }), id);
  return { added, line: added ? `Put ${added} ${added === 1 ? "to-do" : "to-dos"} on the list, under Current tasks.` : "They are on the list already." };
}

/** The newest finished answer. */
export function latest(): TaskResult | null {
  const t = db.prepare("SELECT id FROM cc_ai_tasks WHERE state = 'done' ORDER BY finished_at DESC, id DESC LIMIT 1").get() as { id: number } | undefined;
  return t ? result(t.id) : null;
}

/** The newest finished task of each kind, newest first: the cards under the answer. */
export function cards(limit = 6): ResultCard[] {
  const rows = db
    .prepare(
      "SELECT t.id, t.kind, t.prompt, t.finished_at, t.result_data FROM cc_ai_tasks t WHERE t.state = 'done' AND t.id = (SELECT id FROM cc_ai_tasks u WHERE u.kind = t.kind AND u.state = 'done' ORDER BY u.finished_at DESC, u.id DESC LIMIT 1) ORDER BY t.finished_at DESC LIMIT ?",
    )
    .all(limit) as { id: number; kind: TaskKind; prompt: string; finished_at: string; result_data: string | null }[];
  return rows.map((r) => ({ id: r.id, kind: r.kind, label: KIND_LABEL[r.kind], finishedAt: r.finished_at, sub: json<ResultData | null>(r.result_data, null)?.sub ?? short(r.prompt, 48) }));
}

/** Every finished task, newest first, as cards. */
export function allResults(limit = 100): ResultCard[] {
  const rows = db.prepare("SELECT id, kind, prompt, finished_at, result_data FROM cc_ai_tasks WHERE state = 'done' ORDER BY finished_at DESC, id DESC LIMIT ?").all(limit) as {
    id: number;
    kind: TaskKind;
    prompt: string;
    finished_at: string;
    result_data: string | null;
  }[];
  return rows.map((r) => ({ id: r.id, kind: r.kind, label: `${KIND_LABEL[r.kind]}: ${short(r.prompt, 60)}`, finishedAt: r.finished_at, sub: json<ResultData | null>(r.result_data, null)?.sub ?? "" }));
}

/** How many finished results and how many tasks there are in all. */
export function taskCounts(): { results: number; tasks: number } {
  const r = db.prepare("SELECT COUNT(*) AS tasks, SUM(state = 'done') AS results FROM cc_ai_tasks").get() as { tasks: number; results: number | null };
  return { results: r.results ?? 0, tasks: r.tasks };
}

/** Every task, newest first. */
export function allTasks(limit = 100): TaskRow[] {
  const open = new Map(openRows().map((t) => [t.id, t]));
  return (db.prepare("SELECT * FROM cc_ai_tasks ORDER BY id DESC LIMIT ?").all(limit) as unknown as TaskDb[]).map((t) => open.get(t.id) ?? toTaskRow(t));
}

/** The newest finished task, for a poller to notice a change. */
export function newest(): { id: number; state: TaskState; finishedAt: string | null } | null {
  const t = db.prepare("SELECT id, state, finished_at FROM cc_ai_tasks WHERE state IN ('done','failed','cancelled') ORDER BY finished_at DESC, id DESC LIMIT 1").get() as
    | { id: number; state: TaskState; finished_at: string | null }
    | undefined;
  return t ? { id: t.id, state: t.state, finishedAt: t.finished_at } : null;
}

export { CONTEXT_LABEL };
