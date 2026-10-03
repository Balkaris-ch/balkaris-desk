"use server";

import { refresh } from "next/cache";
import type { JobAnswer } from "@/contract/common";
import type { RunDueAnswer } from "@/contract/automations";
import { askPost } from "@/lib/api";

/**
 * The Automations screen's three changes. Each asks the desk server, which
 * decides who may: running a job now (the core API's /jobs/:name/run, with
 * its floor between two asks) takes edit on Automations, or, from somebody
 * who may change something on the desk, a job that feeds an area they see
 * (src/grants.ts `mayRunJob`); only the owner may switch one off or on
 * (/jobs/:name/enabled). Nothing is decided here beyond refusing a name that
 * cannot be a job's.
 *
 * Each returns what the server said, for the button that asked, and redraws
 * the screen so the job's new state shows.
 */

export interface Said {
  ok: boolean;
  message: string;
  /** When it was said (ms), so the browser can let the line fade after a while. */
  at: number;
}

const NAME = /^[\w.-]{1,40}$/;

const nameOf = (form: FormData): string | null => {
  const n = String(form.get("name") ?? "");
  return NAME.test(n) ? n : null;
};

/** Run one job now: POST /api/v1/jobs/:name/run. */
export async function runJob(_: Said | null, form: FormData): Promise<Said> {
  const name = nameOf(form);
  if (!name) return { ok: false, message: "That is not the name of a job.", at: Date.now() };
  const a = await askPost<JobAnswer>(`/api/v1/jobs/${encodeURIComponent(name)}/run`);
  refresh();
  if (!a.ok) return { ok: false, message: a.message, at: Date.now() };
  return {
    ok: true,
    message: a.value.job.running ? "Running now." : "Asked for. It starts within seconds, or as soon as the job running now has finished.",
    at: Date.now(),
  };
}

/** Switch one job on or off: POST /api/v1/jobs/:name/enabled. The desk refuses anybody but the owner. */
export async function switchJob(_: Said | null, form: FormData): Promise<Said> {
  const name = nameOf(form);
  if (!name) return { ok: false, message: "That is not the name of a job.", at: Date.now() };
  const enabled = form.get("enabled") === "1";
  const a = await askPost<JobAnswer>(`/api/v1/jobs/${encodeURIComponent(name)}/enabled`, { enabled });
  refresh();
  if (!a.ok) return { ok: false, message: a.message, at: Date.now() };
  return { ok: true, message: a.value.job.enabled ? "Switched on." : "Switched off. It will not run until it is switched on again.", at: Date.now() };
}

/** Put every job whose time has come at the front of the queue: POST /api/v1/automations/run-due. */
export async function runDue(_: Said | null): Promise<Said> {
  const a = await askPost<RunDueAnswer>("/api/v1/automations/run-due");
  refresh();
  return a.ok ? { ok: true, message: a.value.said, at: Date.now() } : { ok: false, message: a.message, at: Date.now() };
}
