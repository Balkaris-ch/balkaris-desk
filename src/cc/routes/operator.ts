import { Hono } from "hono";
import { z } from "zod";
import { me, type Vars } from "../access.ts";
import { articleStats, channels, gaRange, pages as gaPages, type GaRange } from "../ga4.ts";
import { approve, proposalCount, proposalRow, proposals, proposeRedirect, reject, withdraw } from "../operator/apply.ts";
import { contextInsights, contextIssues, contextPages, contextTraffic, fixable, waitingDrafts } from "../operator/context.ts";
import { advanceAudits, allResults, allTasks, cancel, cards, createTask, latest, newest, openRows, result, runnerState, taskCounts, workingNow } from "../operator/queue.ts";
import { db } from "../../db.ts";
import { addTodo, markTodo, removeTodo, todos } from "../operator/todos.ts";
import { specimenAllowed } from "../specimen.ts";
import { activity, reading } from "../store.ts";
import { scrubItem } from "../system.ts";
import type { ActivityItem, ApiError } from "../../../web/src/contract/common.ts";
import type {
  OperatorHistory,
  OperatorLive,
  OperatorPayload,
  ProposalAnswer,
  ProposalRow,
  ResultCard,
  TaskAnswer,
  TaskResult,
  TaskRow,
  TodoAnswer,
} from "../../../web/src/contract/operator.ts";

/**
 * /api/v1/operator — the AI Operator screen.
 *
 *   GET  /                      the whole screen, ?range= &result=<id> &specimen=1
 *   GET  /live                  what changes while a task runs (the page polls it)
 *   GET  /history?tab=          every result, task, proposal or action
 *   GET  /tasks/:id             one finished task in full
 *   POST /tasks                 queue a task                       anyone signed in
 *   POST /tasks/:id/cancel      Stop                               anyone signed in
 *   POST /proposals             a redirect asked for by hand       anyone signed in
 *   POST /proposals/:id/approve apply it to the live site          a person who can publish
 *   POST /proposals/:id/withdraw take it off the live site again   a person who can publish
 *   POST /proposals/:id/reject  say no; nothing on the site moves  anyone signed in
 *   POST /todos                 add to the to-do list              anyone signed in
 *   POST /todos/:id             { done } or { remove: true }       anyone signed in
 *   POST /refresh               re-read GA4 for one context tab    anyone signed in
 *
 * Each panel of GET / is read on its own (store.ts `reading`), so one source
 * that fails costs one panel. Nothing here is about an enquiry: the operator
 * is never given one and never says one.
 */
export const routes = new Hono<Vars>();

const ACTION_KINDS = ["operator", "operator-proposal", "operator-change"];

const rangeOf = (raw: string | undefined): GaRange => gaRange(raw);
const idOf = (raw: string): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : -1;
};

/* ---------- specimen: obviously artificial rows, for seeing the connected state ---------------- */

const SPECIMEN_AT = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function specimenTask(id: number, kind: TaskRow["kind"], kindLabel: string, title: string, state: TaskRow["state"], extra: Partial<TaskRow> = {}): TaskRow {
  return {
    id,
    kind,
    kindLabel,
    title,
    state,
    askedBy: "Specimen person",
    createdAt: SPECIMEN_AT(9),
    takenAt: state === "running" ? SPECIMEN_AT(1) : null,
    finishedAt: null,
    runner: state === "running" ? "specimen-runner" : null,
    ahead: null,
    crawl: null,
    lost: null,
    stage: null,
    attempts: state === "running" ? 1 : 0,
    retried: false,
    error: null,
    context: null,
    depth: "deep",
    ...extra,
  };
}

function specimenProposal(id: number, kind: ProposalRow["kind"], state: ProposalRow["state"], address: string, before: ProposalRow["before"], after: ProposalRow["after"]): ProposalRow {
  return {
    id,
    kind,
    address,
    before,
    after,
    why: "Specimen: a finding that stands where the crawl's own will be.",
    source: "operator",
    taskId: 9101,
    proposedBy: null,
    shownTitle: after.title !== undefined ? `${after.title} | Balkaris` : null,
    drift: null,
    state,
    decidedBy: state === "waiting" ? null : "Specimen person",
    decidedAt: state === "waiting" ? null : SPECIMEN_AT(50),
    appliedAt: state === "applied" || state === "withdrawn" ? SPECIMEN_AT(49) : null,
    sha: state === "applied" || state === "withdrawn" ? "0000000" : null,
    shaUrl: null,
    withdrawnBy: state === "withdrawn" ? "Specimen person" : null,
    withdrawnAt: state === "withdrawn" ? SPECIMEN_AT(20) : null,
    error: null,
    note: null,
    createdAt: SPECIMEN_AT(60),
    consequence:
      kind === "redirect"
        ? `Anyone who opens ${address} on the live site is sent to ${after.to} instead, within about two minutes.`
        : `This changes the title and description Google and shared links show for ${address} on the live site within about two minutes.`,
    lengths: { title: after.title !== undefined ? `${after.title} | Balkaris`.length : null, description: after.description?.length ?? null },
  };
}

const SPECIMEN_TASKS: TaskRow[] = [
  specimenTask(9001, "metadata", "Metadata proposals", "Specimen: Create metadata for /specimen-a, /specimen-b", "running"),
  specimenTask(9002, "audit", "SEO audit", "Specimen: Run a full SEO audit", "queued", { stage: "crawl", crawl: { done: 61, of: 103 }, ahead: 1 }),
  specimenTask(9003, "ask", "Question", "Specimen: Which specimen page has the most findings?", "queued", { ahead: 1, context: "website" }),
  specimenTask(9004, "brief", "Brief", "Specimen: Write a brief for a specimen topic", "queued", { ahead: 2 }),
];

const SPECIMEN_PROPOSALS: ProposalRow[] = [
  specimenProposal(9201, "meta", "waiting", "/specimen-a", { title: "Specimen page A, a title long enough to be cut off in a result", description: null }, { title: "Specimen page A", description: "A specimen description that stands where the operator's proposal for this page will be, inside the limit." }),
  specimenProposal(9202, "redirect", "waiting", "/specimen-old", { to: null }, { to: "/specimen-b" }),
  specimenProposal(9203, "meta", "applied", "/specimen-c", { title: "Specimen C", description: "Old specimen description." }, { description: "A specimen description that was applied, to show the approved state of a proposal." }),
  specimenProposal(9204, "redirect", "withdrawn", "/specimen-gone", { to: null }, { to: "/specimen-c" }),
];

const SPECIMEN_ANSWER: TaskResult = {
  task: { ...specimenTask(9101, "traffic", "Traffic summary", "Specimen: Analyze traffic for the last 30 days", "done"), finishedAt: SPECIMEN_AT(2), takenAt: SPECIMEN_AT(3) },
  text: "Specimen answer. This text stands where the workstation's answer will be: a few plain sentences that quote only the figures in the data it was given.\n- A specimen point about a specimen channel.\n- A specimen point about /specimen-a.",
  proposals: [],
  given: [{ name: "traffic", label: "Specimen traffic", source: "none", asOf: SPECIMEN_AT(4), state: "ok", note: "Specimen data, not a reading." }],
  flags: [],
  model: "specimen-model",
  ms: 41_000,
};

const SPECIMEN_CARDS: ResultCard[] = [
  { id: 9101, kind: "traffic", label: "Traffic summary", finishedAt: SPECIMEN_AT(2), sub: "Specimen period" },
  { id: 9102, kind: "opportunities", label: "Opportunities", finishedAt: SPECIMEN_AT(30), sub: "4 specimen opportunities" },
  { id: 9103, kind: "metadata", label: "Metadata proposals", finishedAt: SPECIMEN_AT(55), sub: "2 proposals for approval" },
];

const SPECIMEN_ACTIONS: ActivityItem[] = [
  { id: -1, at: SPECIMEN_AT(2), kind: "operator", tone: "good", text: "Specimen: analyzed traffic", detail: "From specimen data", href: "/operator?specimen=1", actor: "operator" },
  { id: -2, at: SPECIMEN_AT(30), kind: "operator", tone: "good", text: "Specimen: found 4 opportunities", detail: "From specimen findings", actor: "operator" },
  { id: -3, at: SPECIMEN_AT(55), kind: "operator-proposal", tone: "warn", text: "Specimen: 2 changes wait for approval", detail: "/specimen-a, /specimen-old", actor: "operator" },
  { id: -4, at: SPECIMEN_AT(49), kind: "operator-change", tone: "good", text: "Specimen: applied a new description for /specimen-c", detail: "Approved by Specimen person", actor: "Specimen person" },
  { id: -5, at: SPECIMEN_AT(20), kind: "operator-change", tone: "warn", text: "Specimen: withdrew the redirect from /specimen-gone", detail: "By Specimen person", actor: "Specimen person" },
];

/* ---------- the screen ---------------------------------------------------------------- */

const actions = (limit: number): ActivityItem[] => activity(limit, ACTION_KINDS).map(scrubItem);
const actionCount = (): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM cc_activity WHERE kind IN (${ACTION_KINDS.map(() => "?").join(",")})`).get(...ACTION_KINDS) as { n: number }).n;

/** Rows each Actions & approvals tab is sent: the panel shows five and says how many more. */
const APPROVALS_SHOWN = 20;
const MOST = 100;

/** An audit whose crawl finished moves on when the screen is read, not only when the workstation asks. A fault here costs nothing but that. */
async function advance(): Promise<void> {
  try {
    await advanceAudits();
  } catch (e) {
    console.warn(`operator: moving audits on failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

routes.get("/", async (c) => {
  const range = rangeOf(c.req.query("range"));
  const who = me(c);
  const asked = idOf(c.req.query("result") ?? "");
  const specimen = specimenAllowed(c);
  await advance();

  const [pagesR, insightsR, trafficR, issuesR, draftsR] = await Promise.all([
    reading("ga4", () => contextPages(range)),
    reading("desk", () => contextInsights(range)),
    reading("ga4", () => contextTraffic(range)),
    reading("crawl", () => contextIssues()),
    reading("desk", () => waitingDrafts()),
  ]);

  let fix = { metadata: 0, redirect: 0 };
  try {
    fix = fixable();
  } catch {
    /* counted as nothing to propose; the tab's own reading says why */
  }

  const answer: TaskResult | null = (asked > 0 ? result(asked) : null) ?? latest();
  const payload: OperatorPayload = {
    range,
    me: {
      canApprove: who.canPublish,
      why: who.canPublish ? null : `${who.name} cannot publish yet: approving changes the live site, and needs an email Vercel knows, added on the people page.`,
    },
    runner: runnerState(),
    working: workingNow(),
    tasks: openRows(),
    todos: todos(),
    context: { pages: pagesR, insights: insightsR, traffic: trafficR, issues: issuesR, fixable: fix },
    answer,
    latest: newest(),
    cards: cards(),
    actions: actions(5),
    approvals: {
      waiting: proposals(["waiting"], APPROVALS_SHOWN),
      approved: proposals(["approved", "applied"], APPROVALS_SHOWN),
      completed: proposals(["withdrawn", "rejected"], APPROVALS_SHOWN),
      counts: { waiting: proposalCount(["waiting"]), approved: proposalCount(["approved", "applied"]), completed: proposalCount(["withdrawn", "rejected"]) },
      drafts: draftsR,
    },
  };

  if (specimen) {
    return c.json<OperatorPayload>({
      ...payload,
      specimen: true,
      runner: { state: "online", lastSeen: SPECIMEN_AT(0.3), line: "Online.", articlesFirst: 0 },
      working: { id: 9001, title: SPECIMEN_TASKS[0]!.title },
      tasks: SPECIMEN_TASKS,
      answer: asked > 0 && asked < 9000 ? payload.answer : SPECIMEN_ANSWER,
      latest: null,
      cards: SPECIMEN_CARDS,
      actions: SPECIMEN_ACTIONS,
      approvals: {
        ...payload.approvals,
        waiting: SPECIMEN_PROPOSALS.filter((p) => p.state === "waiting"),
        approved: SPECIMEN_PROPOSALS.filter((p) => p.state === "applied"),
        completed: SPECIMEN_PROPOSALS.filter((p) => p.state === "withdrawn"),
        counts: {
          waiting: SPECIMEN_PROPOSALS.filter((p) => p.state === "waiting").length,
          approved: SPECIMEN_PROPOSALS.filter((p) => p.state === "applied").length,
          completed: SPECIMEN_PROPOSALS.filter((p) => p.state === "withdrawn").length,
        },
      },
    });
  }
  return c.json<OperatorPayload>(payload);
});

routes.get("/live", async (c) => {
  if (specimenAllowed(c)) {
    return c.json<OperatorLive>({ specimen: true, runner: { state: "online", lastSeen: SPECIMEN_AT(0.3), line: "Online.", articlesFirst: 0 }, working: { id: 9001, title: SPECIMEN_TASKS[0]!.title }, tasks: SPECIMEN_TASKS, latest: null });
  }
  await advance();
  return c.json<OperatorLive>({ runner: runnerState(), working: workingNow(), tasks: openRows(), latest: newest() });
});

routes.get("/history", async (c) => {
  const tab = (["results", "tasks", "proposals", "actions"] as const).find((t) => t === c.req.query("tab")) ?? "results";
  await advance();
  const results = allResults(MOST);
  const tasks = allTasks(MOST);
  const props = proposals(["waiting", "approved", "applied", "rejected", "withdrawn"], MOST);
  const acts = actions(MOST);
  const n = taskCounts();
  return c.json<OperatorHistory>({
    tab,
    counts: { results: n.results, tasks: n.tasks, proposals: proposalCount(["waiting", "approved", "applied", "rejected", "withdrawn"]), actions: actionCount() },
    most: MOST,
    results,
    tasks,
    proposals: props,
    actions: acts,
  });
});

routes.get("/tasks/:id", (c) => {
  const r = result(idOf(c.req.param("id")));
  if (!r) return c.json<ApiError>({ error: "There is no finished task with that number." }, 404);
  return c.json<TaskResult>(r);
});

/* ---------- changes ------------------------------------------------------------------------ */

const NewTaskBody = z.object({
  kind: z.enum(["ask", "traffic", "opportunities", "metadata", "redirect", "brief", "audit"]),
  prompt: z.string().max(2000).optional(),
  context: z.enum(["website", "pages", "traffic", "issues", "insights", "none"]).optional(),
  depth: z.enum(["quick", "deep"]).optional(),
  paths: z.array(z.string().max(200)).max(10).optional(),
  path: z.string().max(200).optional(),
  range: z.string().max(8).optional(),
});

routes.post("/tasks", async (c) => {
  const body = NewTaskBody.parse(await c.req.json().catch(() => ({})));
  const task = await createTask({ ...body, range: rangeOf(body.range) }, me(c));
  return c.json<TaskAnswer>({ ok: true, task }, 202);
});

routes.post("/tasks/:id/cancel", (c) => c.json<TaskAnswer>({ ok: true, task: cancel(idOf(c.req.param("id")), me(c)) }));

const RedirectBody = z.object({ from: z.string().min(1).max(200), to: z.string().min(1).max(200) });

routes.post("/proposals", async (c) => {
  const body = RedirectBody.parse(await c.req.json().catch(() => ({})));
  return c.json<ProposalAnswer>({ ok: true, proposal: await proposeRedirect(body.from, body.to, me(c)) }, 201);
});

routes.post("/proposals/:id/approve", async (c) => c.json<ProposalAnswer>({ ok: true, proposal: await approve(idOf(c.req.param("id")), me(c)) }));
routes.post("/proposals/:id/withdraw", async (c) => c.json<ProposalAnswer>({ ok: true, proposal: await withdraw(idOf(c.req.param("id")), me(c)) }));
routes.post("/proposals/:id/reject", async (c) => c.json<ProposalAnswer>({ ok: true, proposal: await reject(idOf(c.req.param("id")), me(c)) }));

routes.get("/proposals/:id", (c) => {
  const p = proposalRow(idOf(c.req.param("id")));
  return p ? c.json<ProposalRow>(p) : c.json<ApiError>({ error: "There is no such proposal." }, 404);
});

const TodoBody = z.object({ title: z.string().max(400), note: z.string().max(2000).optional().nullable() });
const TodoChange = z.object({ done: z.boolean().optional(), remove: z.literal(true).optional() });

routes.post("/todos", async (c) => {
  const body = TodoBody.parse(await c.req.json().catch(() => ({})));
  return c.json<TodoAnswer>({ ok: true, todo: addTodo(body.title, body.note ?? null, me(c)) }, 201);
});

routes.post("/todos/:id", async (c) => {
  const id = idOf(c.req.param("id"));
  const body = TodoChange.parse(await c.req.json().catch(() => ({})));
  if (body.remove) {
    removeTodo(id);
    return c.json<TodoAnswer>({ ok: true, todo: null });
  }
  if (typeof body.done !== "boolean") return c.json<ApiError>({ error: 'Send { "done": true }, { "done": false } or { "remove": true }.' }, 400);
  return c.json<TodoAnswer>({ ok: true, todo: markTodo(id, body.done, me(c)) });
});

/* Re-read GA4 for the traffic or insights tab, asking Google again when the
   kept answer is over a minute old. The pages and findings tabs are the
   crawl's: their refresh is POST /api/v1/jobs/crawl/run, with its own floor. */
const RefreshBody = z.object({ tab: z.enum(["traffic", "insights", "pages"]), range: z.string().max(8).optional() });

routes.post("/refresh", async (c) => {
  const body = RefreshBody.parse(await c.req.json().catch(() => ({})));
  const range = rangeOf(body.range);
  const fresh = { ttl: 60_000, wait: true, screen: true };
  const read = body.tab === "traffic" ? await channels(range, fresh) : body.tab === "insights" ? await articleStats(range, fresh) : await gaPages(range, fresh);
  if (!read.data) return c.json<ApiError>({ error: read.error ?? "GA4 did not answer." }, read.off ? 409 : 502);
  return c.json({ ok: true, at: read.at });
});
