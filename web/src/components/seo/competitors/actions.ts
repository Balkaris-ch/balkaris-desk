"use server";

import type { JobAnswer } from "@/contract/common";
import type { NewTask, TaskAnswer } from "@/contract/operator";
import { askPost } from "@/lib/api";

export type Said = { ok: true; id: number | null; line: string } | { ok: false; line: string };

/**
 * SEO › Competitors' two buttons. Neither changes the website.
 *
 *   queueBrief    a brief for the AI Operator (POST /api/v1/operator/tasks),
 *                 its words built by the desk server from the page's facts. It
 *                 is answered by the studio workstation's local model when it
 *                 is on; until then it waits in the queue. Only a brief, or a
 *                 comparison of a kept result page ("serp"), goes through
 *                 here, and the desk server checks it again.
 *   readPagesNow  the weekly read of their pages, now (POST
 *                 /api/v1/jobs/seo-competitors/run). Pages read in the last
 *                 six days are not asked again; the server refuses a run that
 *                 is running or ran a moment ago, in its own words.
 */
export async function queueBrief(task: NewTask): Promise<Said> {
  /* "What they have that we lack": the operator's "serp" kind compares a kept result page with our page; the server builds its facts. */
  if (task?.kind === "serp" && Number.isInteger(task.serpId) && (task.serpId ?? 0) > 0) {
    const a = await askPost<TaskAnswer>("/api/v1/operator/tasks", { kind: "serp", serpId: task.serpId, ...(typeof task.path === "string" && task.path.startsWith("/") ? { path: task.path } : {}) } satisfies NewTask);
    return a.ok ? { ok: true, id: a.value.task.id, line: `Queued as operator task #${a.value.task.id}. The workstation's model compares the results with our page when it is on.` } : { ok: false, line: a.message };
  }
  if (task?.kind !== "brief" || typeof task.prompt !== "string" || task.prompt.trim().length < 3) return { ok: false, line: "This button can only ask for a brief or a comparison." };
  const clean: NewTask = { kind: "brief", prompt: task.prompt.slice(0, 1000), depth: "deep" };
  const a = await askPost<TaskAnswer>("/api/v1/operator/tasks", clean);
  return a.ok ? { ok: true, id: a.value.task.id, line: `Queued as operator task #${a.value.task.id}. It runs on the studio workstation when it is on.` } : { ok: false, line: a.message };
}

export async function readPagesNow(): Promise<Said> {
  const a = await askPost<JobAnswer>("/api/v1/jobs/seo-competitors/run");
  return a.ok ? { ok: true, id: null, line: "Asked to run now. It reads only the pages not read in the last six days, two seconds apart per site." } : { ok: false, line: a.message };
}
