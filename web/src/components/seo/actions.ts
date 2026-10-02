"use server";

import type { JobAnswer } from "@/contract/common";
import { askPost } from "@/lib/api";

/**
 * Run SEO audit: ask the desk to read every page of the website again now.
 *
 * It is the desk's own "run now" for the crawl job (POST /api/v1/jobs/crawl/run),
 * which anyone signed in may ask for and which the desk server refuses when
 * the crawl is running or ran less than ten minutes ago. The visitor's cookie
 * and Origin travel with it (lib/api.ts), so the server decides who is asking.
 * Nothing is sent anywhere but the desk server; the crawl only reads the site.
 *
 * `before` is the job's last start as the desk server recorded it when it
 * accepted the request (the run asked for has not started yet): the row knows
 * the new run by a different start, on the server's own clock, never the
 * browser's.
 */
export async function runAudit(): Promise<{ ok: true; before: string | null } | { ok: false; message: string }> {
  const a = await askPost<JobAnswer>("/api/v1/jobs/crawl/run");
  return a.ok ? { ok: true, before: a.value.job.lastStart } : { ok: false, message: a.message };
}
