"use server";

import type { JobAnswer, JobListed } from "@/contract/common";
import type { AuditAnswer, AuditRun } from "@/contract/seo/common";
import { ask, askPost } from "@/lib/api";

/** One job the button follows: its name, title, and its last start before the press (null: it never ran). */
export interface AuditStep {
  name: string;
  title: string;
  before: string | null;
}

export type AuditAsked =
  /* The full audit: the desk's own record of the run, and its jobs to follow if that record cannot be read again. */
  | { ok: true; via: "audit"; run: AuditRun | null; steps: AuditStep[] }
  /* No full audit on this desk yet: the crawl alone. */
  | { ok: true; via: "crawl"; run: null; steps: AuditStep[] }
  | { ok: false; message: string };

/**
 * "Run full SEO audit", from the head of every SEO page.
 *
 * It asks the desk for a full audit (POST /api/v1/seo/audit: the crawl,
 * Search Console, the snapshot, the readiness check and the opportunity
 * engine, in that order, through the scheduler). Where the desk does not have
 * that yet (404), it asks for the part that exists, the crawl (POST
 * /api/v1/jobs/crawl/run), and the button says so. Either only READS the
 * website and Google: nothing on the site changes. The desk server refuses as
 * it always does (a job running, or asked for a moment ago, or switched off)
 * and its sentence comes back to the button.
 *
 * Each step's `before` is the job's last start as the desk listed it just
 * before the press: the run that was asked for is the first with a different
 * start, on the desk server's clock, never the browser's.
 */
export async function runFullAudit(): Promise<AuditAsked> {
  const listed = await ask<JobListed[]>("/api/v1/jobs");
  const was = new Map<string, JobListed>(listed.ok && Array.isArray(listed.value) ? listed.value.map((j) => [j.name, j]) : []);
  const step = (name: string, title?: string): AuditStep => ({ name, title: title ?? was.get(name)?.title ?? name, before: was.get(name)?.lastStart ?? null });

  const full = await askPost<AuditAnswer>("/api/v1/seo/audit");
  if (full.ok) {
    const run = auditRun(full.value);
    /* Steps the desk already counts as over (skipped: "the crawl of 4 minutes ago is fresh") are not waited for. */
    const open = run ? run.steps.filter((s) => s.state === "queued" || s.state === "running") : [];
    return { ok: true, via: "audit", run, steps: open.map((s) => step(s.job, s.title)) };
  }
  if (full.kind !== "missing") return { ok: false, message: full.message };

  const crawl = await askPost<JobAnswer>("/api/v1/jobs/crawl/run");
  if (!crawl.ok) return { ok: false, message: crawl.message };
  return { ok: true, via: "crawl", run: null, steps: [step(crawl.value.job.name, crawl.value.job.title)] };
}

/** The run in an audit answer, when it has the agreed shape (contract/seo/common.ts, AuditAnswer); else null. */
function auditRun(v: unknown): AuditRun | null {
  const run = (typeof v === "object" && v !== null ? (v as { audit?: unknown }).audit : null) as AuditRun | null | undefined;
  if (!run || typeof run.id !== "string" || !Array.isArray(run.steps)) return null;
  return { ...run, steps: run.steps.filter((s) => s && typeof s.job === "string" && typeof s.title === "string") };
}
