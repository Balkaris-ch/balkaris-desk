"use server";

import { refresh } from "next/cache";
import type { Said } from "@/components/automations/actions";
import type { JobAnswer } from "@/contract/common";
import type { OwnerTaskAnswer } from "@/contract/seo/common";
import { askPost } from "@/lib/api";

/**
 * SEO › Automations' changes. Each asks the desk server, which decides who
 * may; nothing is decided here beyond refusing an id that cannot be one.
 *
 *   askJob    Run now: the core API's POST /api/v1/jobs/:name/run (with its
 *             floor between two asks), as the desk-wide Automations screen
 *             asks it, answered in this tab's words: the scheduler starts an
 *             asked job at once only when nothing runs, else at its first
 *             wake after the running job ends (it wakes every thirty seconds).
 *   markStep  a person marks a step in the owner's browser done, or open
 *             again, with an optional note: the engine's
 *             POST /api/v1/seo/owner-tasks/:id { done, note? }
 *             (src/cc/seo/api.ts). The desk records who; it never marks a
 *             step done by itself.
 *
 * The owner's on/off switch is the desk-wide screen's action
 * (components/automations/actions.ts), used as it is.
 */

const NAME = /^[\w.-]{1,40}$/;
const ID = /^[\w.-]{1,80}$/;

export async function askJob(_: Said | null, form: FormData): Promise<Said> {
  const name = String(form.get("name") ?? "");
  if (!NAME.test(name)) return { ok: false, message: "That is not the name of a job.", at: Date.now() };
  const a = await askPost<JobAnswer>(`/api/v1/jobs/${encodeURIComponent(name)}/run`);
  refresh();
  if (!a.ok) return { ok: false, message: a.message, at: Date.now() };
  return {
    ok: true,
    message: a.value.job.running
      ? "Running now."
      : "Asked for, ahead of every job that is merely due. It starts at once when nothing else runs; otherwise at the scheduler's first wake after the running job ends (it wakes every thirty seconds).",
    at: Date.now(),
  };
}

export async function markStep(_: Said | null, form: FormData): Promise<Said> {
  const id = String(form.get("id") ?? "");
  if (!ID.test(id)) return { ok: false, message: "That is not one of the steps.", at: Date.now() };
  const done = form.get("done") === "1";
  const raw = form.get("note");
  const note = typeof raw === "string" ? raw.trim().slice(0, 500) : "";
  const a = await askPost<OwnerTaskAnswer>(`/api/v1/seo/owner-tasks/${encodeURIComponent(id)}`, note ? { done, note } : { done });
  refresh();
  if (!a.ok) return { ok: false, message: a.message, at: Date.now() };
  return { ok: true, message: a.value.task.done ? `Marked done by ${a.value.task.doneBy ?? "you"}${note ? ", with your note" : ""}.` : "Open again.", at: Date.now() };
}

/** The owner says whether the week's summary is sent to him on Telegram: POST /api/v1/seo/automations/digest. */
export async function digestTelegram(_: Said | null, form: FormData): Promise<Said> {
  const on = form.get("telegram") === "1";
  const a = await askPost<{ ok: true; line: string }>("/api/v1/seo/automations/digest", { telegram: on });
  refresh();
  return a.ok ? { ok: true, message: a.value.line, at: Date.now() } : { ok: false, message: a.message, at: Date.now() };
}

/** Write, change or clear (an empty text) a step's note, leaving its done mark as it is. */
export async function noteStep(_: Said | null, form: FormData): Promise<Said> {
  const id = String(form.get("id") ?? "");
  if (!ID.test(id)) return { ok: false, message: "That is not one of the steps.", at: Date.now() };
  const raw = form.get("note");
  const note = typeof raw === "string" ? raw.trim().slice(0, 500) : "";
  const a = await askPost<OwnerTaskAnswer>(`/api/v1/seo/owner-tasks/${encodeURIComponent(id)}`, { note });
  refresh();
  if (!a.ok) return { ok: false, message: a.message, at: Date.now() };
  return { ok: true, message: note ? "Note kept." : "Note cleared.", at: Date.now() };
}
