"use server";

import type { JobAnswer } from "@/contract/common";
import { askPost } from "@/lib/api";

/**
 * "Open diagnostics": ask the desk server to run the three jobs that look at
 * the website now: the probes, the sitemap read and the crawl. The desk
 * server decides whether this person may (anyone signed in may ask for a run)
 * and refuses a job that ran a moment ago or is running; its refusal comes
 * back word for word. The scheduler runs one job at a time, so they queue.
 */
export async function runDiagnostics(): Promise<{ at: number; asks: { job: string; ok: boolean; message: string }[] }> {
  const at = Date.now();
  const asks: { job: string; ok: boolean; message: string }[] = [];
  for (const job of ["probe", "sitemap", "crawl"]) {
    const a = await askPost<JobAnswer>(`/api/v1/jobs/${job}/run`);
    asks.push(a.ok ? { job, ok: true, message: "Asked to run now." } : { job, ok: false, message: a.message });
  }
  return { at, asks };
}
