import type { Person } from "../../people.ts";
import { runNow, status as jobStatus } from "../scheduler.ts";
import { note, setState, state } from "../store.ts";
import { scrub } from "../system.ts";
import type { AuditRun, AuditStep } from "../../../web/src/contract/seo/common.ts";
import { json, now } from "./tables.ts";

/**
 * "RUN FULL SEO AUDIT": the crawl, Search Console's figures, the snapshot,
 * the readiness check and the opportunity engine, in that order, on the
 * desk's one scheduler. Each step is asked for with runNow, which queues it
 * ahead of whatever is merely due; the scheduler runs one job at a time, so
 * they run in the order asked.
 *
 * A step whose job ran moments ago is not run again (the API's own rule for a
 * refresh button: the crawl, for one, has no budget and must not read the
 * site twice in ten minutes); one that cannot run (not connected, switched
 * off by the owner) is skipped with the reason. The audit is kept in cc_state,
 * so a page that polls sees its progress; a desk restart forgets the queue,
 * and the steps not started then say so.
 */

const STEPS: { job: string; title: string; freshMs: number }[] = [
  { job: "crawl", title: "Read every page of the website", freshMs: 10 * 60_000 },
  { job: "gsc-daily", title: "Refresh Search Console's figures", freshMs: 60 * 60_000 },
  { job: "seo-snapshot", title: "Keep the newest days of rankings", freshMs: 0 },
  { job: "seo-readiness", title: "Check AI search readiness", freshMs: 30 * 60_000 },
  { job: "seo-engine", title: "Find opportunities", freshMs: 0 },
];

const KEY = "seo:audit";
/** An audit is shown this long after it finished. */
const SHOWN_MS = 60 * 60_000;
/** A step not started this long after it was asked was lost (the desk restarted). */
const LOST_MS = 45 * 60_000;
/** When this desk process started: a step asked before it and not started since was in the queue the restart forgot. */
const BOOT = new Date(Date.now() - process.uptime() * 1000).toISOString();

interface Kept {
  id: string;
  startedAt: string;
  by: string;
  steps: { job: string; title: string; asked: string | null; state: AuditStep["state"]; note: string | null }[];
}

const minutes = (ms: number): string => `${Math.max(1, Math.round(ms / 60_000))} minute${Math.round(ms / 60_000) === 1 ? "" : "s"}`;

/** Ask for the audit. One already running is answered instead of a second. */
export function startAudit(by: Person): AuditRun {
  const running = auditRun();
  if (running && running.state === "running") return running;
  const jobs = jobStatus();
  const at = now();
  const steps: Kept["steps"] = [];
  for (const s of STEPS) {
    const j = jobs.find((x) => x.name === s.job);
    if (!j) steps.push({ job: s.job, title: s.title, asked: null, state: "skipped", note: "This desk has no such job." });
    else if (!j.ready) steps.push({ job: s.job, title: s.title, asked: null, state: "skipped", note: "What it reads is not connected." });
    else if (!j.enabled) steps.push({ job: s.job, title: s.title, asked: null, state: "skipped", note: "The owner switched it off in Automations." });
    else if (s.freshMs && j.lastOk && j.lastEnd && !j.running && Date.now() - Date.parse(j.lastEnd) < s.freshMs) {
      steps.push({ job: s.job, title: s.title, asked: null, state: "skipped", note: `It finished ${minutes(Date.now() - Date.parse(j.lastEnd))} ago; that run is used.` });
    } else if (runNow(s.job)) steps.push({ job: s.job, title: s.title, asked: at, state: "queued", note: null });
    else steps.push({ job: s.job, title: s.title, asked: null, state: "skipped", note: "The scheduler would not take it." });
  }
  const kept: Kept = { id: at, startedAt: at, by: by.name, steps };
  setState(KEY, JSON.stringify(kept));
  note("seo-action", "Started a full SEO audit", { tone: "info", actor: by.name, detail: steps.map((s) => `${s.title}: ${s.state}`).join("; "), href: "/seo", dedupe: `seo:audit:${at}` });
  return auditRun()!;
}

/** The last audit with each step's state as the scheduler reports it now; null an hour after it finished, or before the first. */
export function auditRun(): AuditRun | null {
  const kept = json<Kept | null>(state(KEY), null);
  if (!kept) return null;
  const jobs = jobStatus();
  const steps: AuditStep[] = kept.steps.map((s) => {
    const j = jobs.find((x) => x.name === s.job);
    if (s.state === "skipped" || !s.asked || !j) return { job: s.job, title: s.title, state: s.state, note: s.note, progress: null, startedAt: null, endedAt: null };
    const started = j.lastStart && j.lastStart >= s.asked;
    if (j.running && started) return { job: s.job, title: s.title, state: "running", note: null, progress: j.progress?.what ? { ...j.progress, what: scrub(j.progress.what) } : j.progress, startedAt: j.lastStart, endedAt: null };
    if (started && j.lastEnd && j.lastEnd >= j.lastStart!) {
      return { job: s.job, title: s.title, state: j.lastOk ? "done" : "failed", note: j.lastNote ? scrub(j.lastNote) : null, progress: null, startedAt: j.lastStart, endedAt: j.lastEnd };
    }
    if (s.asked < BOOT || Date.now() - Date.parse(s.asked) > LOST_MS) return { job: s.job, title: s.title, state: "failed", note: "It never started: the desk restarted and forgot the queue. Run the audit again.", progress: null, startedAt: null, endedAt: null };
    return { job: s.job, title: s.title, state: "queued", note: null, progress: null, startedAt: null, endedAt: null };
  });
  const open = steps.some((s) => s.state === "queued" || s.state === "running");
  const finishedAt = open ? null : (steps.map((s) => s.endedAt).filter((x): x is string => !!x).sort().at(-1) ?? kept.startedAt);
  if (finishedAt && Date.now() - Date.parse(finishedAt) > SHOWN_MS) return null;
  return {
    id: kept.id,
    startedAt: kept.startedAt,
    by: kept.by,
    state: open ? "running" : steps.some((s) => s.state === "failed") ? "failed" : "done",
    finishedAt,
    steps,
  };
}
