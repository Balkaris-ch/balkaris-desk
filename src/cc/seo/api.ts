import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../../db.ts";
import { me, requireOwner, type Vars } from "../access.ts";
import { body, csvFile, figures, nav } from "../routes/seo/shared.ts";
import { ok, since, waiting } from "../store.ts";
import type { Reading } from "../../../web/src/contract/common.ts";
import type { NewAiCheck } from "../../../web/src/contract/seo/ai-search.ts";
import type {
  AuditAnswer,
  AuditDetail,
  AuditRun,
  AuditsAnswer,
  ImportAnswer,
  OpportunityAnswer,
  OwnerTaskAnswer,
  SeoFigures,
  SeoNav,
  SeoTask,
  SeoTasksAnswer,
  TaskDoer,
} from "../../../web/src/contract/seo/common.ts";
import { addCheck, checkRefusal, IMPORT_KINDS, importManual, type ImportKind } from "./aisearch.ts";
import { auditDetail, auditRun, audits, startAudit, STEPS } from "./audit.ts";
import { markSubmitted, opportunityDb } from "./engine.ts";
import "./find.ts";
import { importAll } from "./import.ts";
import { clusters, setClusterPage } from "./keywords.ts";
import { addOwnerTask, allOwnerTasks, byHand, isWho, markOwnerTask, mayMark, NOT_YOURS, noteOwnerTask, ownerTask, taskHref, WHO_SAYS, type OwnerTask } from "./owner.ts";
import { siteView } from "./site.ts";

/**
 * The SEO engine's own addresses: what no single page of the section owns.
 * Mounted by src/cc/routes/seo.ts under /api/v1/seo, beside the pages.
 *
 *   GET  /nav                          the tab strip's counts and the figures several pages show → Reading<SeoNav>
 *   GET  /figures                      those figures alone: open opportunities, the keyword table,
 *                                      what Google has indexed, each counted once          → Reading<SeoFigures>
 *   GET  /audit                        the last full audit, while it runs and an hour after → { audit }
 *   POST /audit                        { deep? }  run the full audit, step after step through the
 *                                      scheduler (src/cc/seo/audit.ts lists the steps)      → AuditAnswer
 *   GET  /audits[?open=<id>]           the audits kept, newest first, each with the counts before and
 *                                      after; `open` adds what that one found               → AuditsAnswer
 *   GET  /audits/:id                   one audit with what it found                         → AuditDetail
 *   GET  /audits/:id/export.csv        the same as a file
 *   GET  /owner-tasks[?who=&done=&q=]  every SEO task in one list                           → SeoTasksAnswer
 *   GET  /owner-tasks/export.csv       the same list as a file (the same filters)
 *   POST /owner-tasks                  { step, why?, impact?, who? }  a task written by hand → OwnerTaskAnswer
 *   POST /owner-tasks/:id              { done?, note? }  a person marks a task done or open, or writes
 *                                      its note; the owner's own steps only the owner        → OwnerTaskAnswer
 *   POST /indexing/requested           { path, submitted }  the lead requested indexing by hand → OpportunityAnswer
 *   POST /clusters/:key/page           { path | null }  map a cluster to a page by hand → { ok, cluster }
 *   POST /ai-checks          OWNER     { checks: NewAiCheck[] }  record AI checks      → { ok, added, rows }
 *   POST /imports/:kind      OWNER     gsc-generative-ai | bing-ai-performance: { month, csv }
 *                                      audit: the audit's files on this machine (scripts/seo-import.ts)
 *                                                                                      → ImportAnswer
 *
 * RIGHTS. The server's gate (src/server.ts) has already made sure somebody is
 * signed in and that a change comes from the desk's own pages (the Origin
 * rule). Reading and changing a state is any signed-in person's, except
 * closing one of the owner's own steps; recording AI checks and importing are
 * the owner's (requireOwner). Nothing here changes
 * the live website: the one route that leads there, an opportunity's action,
 * queues an operator task whose proposals wait for a person's approval.
 *
 * Loading this file also adds the SEO section's own things to the top bar's
 * search (./find.ts).
 */
export const engineApi = new Hono<Vars>();

const bad = (message: string): never => {
  throw new HTTPException(400, { message });
};

/* Before the opportunity engine's first run there is no count to give: a 0
   would tell the owner there is nothing to fix. The layout draws the chips
   only from an ok reading. */
const NOT_RUN = "The opportunity engine has not run yet.";

engineApi.get("/nav", (c) => c.json<Reading<SeoNav>>(since("seo.opps.open") ? ok(nav(), "desk", Date.now()) : waiting("desk", NOT_RUN)));

engineApi.get("/figures", (c) =>
  c.json<Reading<SeoFigures>>(
    since("seo.opps.open")
      ? ok(figures(), "desk", Date.now(), "Counted once for every SEO page: open opportunities the rules still find; tracked phrases are those nobody judged irrelevant; indexed pages are each sitemap address's newest URL Inspection result.")
      : waiting("desk", NOT_RUN),
  ),
);

/* ---------- the full audit ------------------------------------------------------------------- */

engineApi.get("/audit", (c) => {
  let audit: AuditRun | null = null;
  try {
    audit = auditRun();
  } catch {
    audit = null;
  }
  return c.json<{ audit: AuditRun | null }>({ audit });
});

engineApi.post("/audit", async (c) => {
  const b = await body(c);
  if (b.deep !== undefined && typeof b.deep !== "boolean") bad("deep must be true or false.");
  const audit = startAudit(me(c), { deep: b.deep === true });
  return c.json<AuditAnswer>({ ok: true, audit });
});

const PLAN = STEPS.map((s) => ({ job: s.job, title: s.title, deep: !!s.deep }));

engineApi.get("/audits", (c) => {
  const open = (c.req.query("open") ?? "").trim();
  return c.json<AuditsAnswer>({ audits: audits(), steps: PLAN, open: open ? auditDetail(open) : null });
});

const oneAudit = (id: string): AuditDetail => {
  const a = auditDetail(id);
  if (!a) throw new HTTPException(404, { message: `No audit is kept under ${id}. The desk keeps the newest sixty.` });
  return a;
};

engineApi.get("/audits/:id/export.csv", (c) => {
  const a = oneAudit(c.req.param("id"));
  const rows: unknown[][] = [];
  for (const s of a.steps) rows.push(["step", s.title, s.state, s.note ?? "", s.startedAt ?? "", s.endedAt ?? ""]);
  const count = (label: string, key: keyof AuditDetail["before"]) => rows.push(["count", label, a.before[key] ?? "", a.after ? (a.after[key] ?? "") : "", "", ""]);
  count("Site score", "score");
  count("Pages read", "pages");
  count("Critical findings", "critical");
  count("Warnings", "warning");
  count("Open opportunities", "opportunities");
  count("Indexed in Google", "indexed");
  count("Not indexed", "notIndexed");
  count("Tracked phrases", "keywords");
  for (const o of a.found.opportunities) rows.push(["new opportunity", o.title, o.subject ?? "", "", "", ""]);
  for (const o of a.found.cleared) rows.push(["cleared opportunity", o.title, o.subject ?? "", o.why ?? "", "", ""]);
  for (const f of a.found.findings) rows.push(["new finding", f.text, f.path ?? "", f.severity, f.rule, ""]);
  for (const e of a.found.index) rows.push([e.indexed ? "newly indexed" : "dropped from the index", e.text, "", "", e.at, ""]);
  return csvFile(c, `audit-${a.startedAt.slice(0, 16).replace(/[:T]/g, "")}`, ["What", "Title", "State / before / subject", "Note / after / why", "Started / rule", "Ended"], rows);
});

engineApi.get("/audits/:id", (c) => c.json<AuditDetail>(oneAudit(c.req.param("id"))));

/* ---------- every SEO task ------------------------------------------------------------------- */

const DOERS: readonly TaskDoer[] = ["owner", "lead-chrome", "code", "content"];

/** A task as the list prints it: who does it, whether this person may mark it, and where its work is. */
function listed(t: OwnerTask, who: { owner?: boolean }, waiting: Map<string, string>): SeoTask {
  const { whoAll, ...row } = t;
  const opp = waiting.get(t.id);
  return { ...row, doer: whoAll, byHand: byHand(t.from), mayMark: mayMark(t, who), href: opp ? `/seo/opportunities?open=${encodeURIComponent(opp)}` : whoAll === "owner" ? "/seo#needs-you" : whoAll === "lead-chrome" ? "/seo/automations" : taskHref(t.id) };
}

/** The most pressing active opportunity waiting on each task, by task id: where a task's work is shown. */
function waitingOn(): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const rows = db
      .prepare(
        `SELECT json_extract(action, '$.ownerTaskId') AS task, id FROM cc_seo_opps
          WHERE active = 1 AND json_extract(action, '$.ownerTaskId') IS NOT NULL
          ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id`,
      )
      .all() as { task: string; id: string }[];
    for (const r of rows) if (!out.has(r.task)) out.set(r.task, r.id);
  } catch {
    /* before the engine's first run: no task has an opportunity yet */
  }
  return out;
}

function tasksFor(c: { req: { query: (k: string) => string | undefined } }, who: { owner?: boolean }): SeoTasksAnswer {
  const askedWho = c.req.query("who");
  const askedDone = c.req.query("done");
  const asked: SeoTasksAnswer["asked"] = {
    who: isWho(askedWho) ? askedWho : "all",
    done: askedDone === "done" || askedDone === "all" ? askedDone : "open",
    q: (c.req.query("q") ?? "").trim().slice(0, 80),
  };
  const all = allOwnerTasks();
  const by = Object.fromEntries(DOERS.map((d) => [d, { open: 0, done: 0 }])) as SeoTasksAnswer["counts"]["by"];
  for (const t of all) by[t.whoAll][t.done ? "done" : "open"]++;
  const words = asked.q.toLowerCase().split(/\s+/).filter(Boolean);
  const waiting = waitingOn();
  const tasks = all
    .filter((t) => asked.who === "all" || t.whoAll === asked.who)
    .filter((t) => asked.done === "all" || t.done === (asked.done === "done"))
    .filter((t) => !words.length || words.every((w) => `${t.title} ${t.step} ${t.why} ${t.note ?? ""}`.toLowerCase().includes(w)))
    .map((t) => listed(t, who, waiting));
  return { asked, tasks, counts: { all: all.length, open: all.filter((t) => !t.done).length, done: all.filter((t) => t.done).length, by }, can: { ownerSteps: !!who.owner } };
}

engineApi.get("/owner-tasks", (c) => c.json<SeoTasksAnswer>(tasksFor(c, me(c))));

engineApi.get("/owner-tasks/export.csv", (c) => {
  const a = tasksFor(c, me(c));
  return csvFile(
    c,
    "tasks",
    ["Task", "Who does it", "Impact", "Effort", "Done", "Done by", "Done on", "Note", "Why", "The exact step", "From", "Opportunities waiting on it"],
    a.tasks.map((t) => [t.title, WHO_SAYS[t.doer], t.impact, t.effort, t.done ? "yes" : "no", t.doneBy ?? "", t.doneAt ? t.doneAt.slice(0, 10) : "", t.note ?? "", t.why, t.step, t.from, t.opportunities]),
  );
});

engineApi.post("/owner-tasks", async (c) => {
  const b = await body(c);
  if (typeof b.step !== "string" || b.step.trim().length < 8 || b.step.length > 1000) bad("step must say what to do, in 8 to 1,000 characters.");
  if (b.why !== undefined && b.why !== null && (typeof b.why !== "string" || b.why.length > 1000)) bad("why is at most 1,000 characters.");
  if (b.impact !== undefined && b.impact !== "high" && b.impact !== "medium" && b.impact !== "low") bad("impact must be high, medium or low.");
  if (b.who !== undefined && !isWho(b.who)) bad("who must be owner, lead-chrome, code or content.");
  const { task, added } = addOwnerTask({ step: b.step as string, why: (b.why as string | null | undefined) ?? null, impact: b.impact as "high" | "medium" | "low" | undefined, who: b.who as TaskDoer | undefined }, me(c).name);
  if (!added) c.set("did", null);
  return c.json<OwnerTaskAnswer & { added: boolean }>({ ok: true, task, added });
});

engineApi.post("/owner-tasks/:id", async (c) => {
  const b = await body(c);
  const noted = typeof b.note === "string";
  if (b.done === undefined && !noted) bad("Send done (true or false), a note, or both.");
  if (b.done !== undefined && typeof b.done !== "boolean") bad("done must be true or false.");
  if (b.note !== undefined && b.note !== null && (typeof b.note !== "string" || b.note.length > 500)) bad("note is at most 500 characters.");
  const id = c.req.param("id");
  const had = ownerTask(id);
  if (!had) throw new HTTPException(404, { message: `There is no owner task ${id}.` });
  /* The owner's own steps (his accounts, his keys, his decisions) are his to close; the lead's browser steps are anyone's. */
  if (!mayMark(had, me(c))) throw new HTTPException(403, { message: NOT_YOURS });
  let task: OwnerTask | null = had;
  if (typeof b.done === "boolean") task = markOwnerTask(id, b.done, me(c).name, noted && (b.note as string).trim() ? (b.note as string).trim() : null);
  /* A note alone, or a note cleared: written without touching the done mark. */
  if (noted && (typeof b.done !== "boolean" || !(b.note as string).trim())) task = noteOwnerTask(id, b.note as string, me(c).name);
  return c.json<OwnerTaskAnswer>({ ok: true, task: task ?? had });
});

/* ---------- the indexing queue, clusters, AI checks ------------------------------------------- */

engineApi.post("/indexing/requested", async (c) => {
  const b = await body(c);
  if (typeof b.path !== "string" || !b.path.startsWith("/") || b.path.length > 300) bad("path must be one of the site's addresses, starting with /.");
  if (typeof b.submitted !== "boolean") bad("submitted must be true or false.");
  /* The mark as it stood, read before the change: taking back a mark that was never set changes nothing,
     and taking one back is not "sent to Google" (the owner's record of the team, src/presence.ts). */
  const marked = opportunityDb(`not-indexed:${b.path}`)?.state === "in-progress";
  const opportunity = markSubmitted(b.path as string, b.submitted as boolean, me(c));
  if (!b.submitted) c.set("did", marked ? { text: `Took back the Request-indexing mark: ${b.path}`, href: "/seo/technical#indexing" } : null);
  return c.json<OpportunityAnswer>({ ok: true, opportunity });
});

engineApi.post("/clusters/:key/page", async (c) => {
  const key = c.req.param("key");
  if (!clusters().some((x) => x.key === key)) throw new HTTPException(404, { message: `There is no cluster ${key}.` });
  const b = await body(c);
  const p = b.path;
  if (p !== null && (typeof p !== "string" || !p.startsWith("/") || p.length > 300)) bad("path must be one of the site's addresses (starting with /), or null to take the mapping away.");
  if (typeof p === "string" && !siteView().byPath.has(p)) bad(`The crawl knows no page at ${p}.`);
  const cluster = setClusterPage(key, (p as string | null) ?? null, me(c).name);
  return c.json({ ok: true as const, cluster });
});

engineApi.post("/ai-checks", requireOwner, async (c) => {
  const b = await body(c);
  const list = b.checks;
  if (!Array.isArray(list) || !list.length || list.length > 100) bad("checks must be a list of 1 to 100 checks.");
  const refused: string[] = [];
  for (const [i, raw] of (list as unknown[]).entries()) {
    const why = checkRefusal((raw ?? {}) as Partial<NewAiCheck>);
    if (why) refused.push(`check ${i + 1}: ${why}`);
  }
  if (refused.length) bad(refused.slice(0, 3).join(" "));
  let added = 0;
  for (const raw of list as NewAiCheck[]) if (addCheck(raw, me(c).name) === "added") added++;
  return c.json({ ok: true as const, added, rows: (list as unknown[]).length });
});

/* ---------- imports --------------------------------------------------------------------------- */

/** Where the audit's files are on this machine: work/seo-audit beside the repository. */
const AUDIT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../work/seo-audit");

engineApi.post("/imports/:kind", requireOwner, async (c) => {
  const kind = c.req.param("kind");
  if (kind === "audit") {
    const done = importAll(AUDIT_DIR);
    return c.json<ImportAnswer>({ ok: true, kind, lines: done.lines });
  }
  if (!IMPORT_KINDS.includes(kind as ImportKind)) throw new HTTPException(404, { message: `There is no import called ${kind}. The imports are ${[...IMPORT_KINDS, "audit"].join(", ")}.` });
  const b = await body(c);
  if (typeof b.month !== "string" || !/^\d{4}-\d\d$/.test(b.month)) bad('month must be "YYYY-MM": the month the export covers.');
  if (typeof b.csv !== "string" || !b.csv.trim()) bad("csv must be the exported file's text.");
  if ((b.csv as string).length > 5_000_000) bad("The CSV is larger than 5 MB.");
  let got: { result: string; rows: number };
  try {
    got = importManual(kind as ImportKind, b.month as string, b.csv as string, me(c).name);
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e));
  }
  return c.json<ImportAnswer>({ ok: true, kind, lines: [`${b.month}: ${got.rows.toLocaleString("en-GB")} row${got.rows === 1 ? "" : "s"}, ${got.result}`] });
});
