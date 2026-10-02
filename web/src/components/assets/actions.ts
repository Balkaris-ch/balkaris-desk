"use server";

import { redirect } from "next/navigation";
import type { JobAnswer, JobListed } from "@/contract/common";
import { ask, askPost } from "@/lib/api";

/** The search params the screen may come back with; anything else in `back` is dropped. */
const KEEP = ["tab", "q", "folder", "format", "flag", "sort", "page", "per"];

/**
 * Rescan assets: asks the desk server to run the `assets` job now (it lists
 * public/ on the fetched branch, measures new pictures and asks each folder's
 * Cache-Control). The answer comes back to the screen as a short code, never
 * as the server's own words, so an address cannot be made to print anything.
 *
 *   asked    accepted; the screen watches the job and redraws when it ends
 *   running  refused because it is running now (429, and the job list says so)
 *   recent   it ran or was asked for less than ten minutes ago (429)
 *   off      switched off by the owner, or what it reads is not connected (409)
 *   down     the desk server did not answer
 *   failed   anything else
 */
export async function rescanAssets(form: FormData): Promise<void> {
  const back = new URLSearchParams(String(form.get("back") ?? ""));
  const keep = new URLSearchParams();
  for (const k of KEEP) {
    const v = back.get(k);
    if (v) keep.set(k, v.slice(0, 200));
  }
  const a = await askPost<JobAnswer>("/api/v1/jobs/assets/run");
  if (!a.ok && a.kind === "signed-out") redirect("/auth/google");
  let code = a.ok ? "asked" : a.status === 429 ? "recent" : a.status === 409 ? "off" : a.kind === "down" ? "down" : "failed";
  /* A 429 is either "running now" or "asked for a moment ago": the job list says which. */
  if (code === "recent") {
    const jobs = await ask<JobListed[]>("/api/v1/jobs");
    if (jobs.ok && jobs.value.find((j) => j.name === "assets")?.running) code = "running";
  }
  keep.set("scan", code);
  /* When it was asked: the screen watches the job only for a while after this. */
  keep.set("at", String(Date.now()));
  redirect(`/assets?${keep.toString()}`);
}
