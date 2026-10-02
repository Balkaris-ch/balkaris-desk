"use server";

import { refresh } from "next/cache";
import type { Said } from "@/components/automations/actions";
import type { OwnerTaskAnswer } from "@/contract/seo/common";
import { askPost } from "@/lib/api";

/**
 * SEO › Automations' one change of its own: a person marks a step in the
 * owner's browser done, or open again, through the engine's
 * POST /api/v1/seo/owner-tasks/:id { done } (src/cc/seo/api.ts). The desk
 * records who; it never marks a step done by itself. Running a job and the
 * owner's switch are the desk-wide Automations screen's actions
 * (components/automations/actions.ts), used as they are.
 */

const ID = /^[\w.-]{1,80}$/;

export async function markStep(_: Said | null, form: FormData): Promise<Said> {
  const id = String(form.get("id") ?? "");
  if (!ID.test(id)) return { ok: false, message: "That is not one of the steps.", at: Date.now() };
  const done = form.get("done") === "1";
  const a = await askPost<OwnerTaskAnswer>(`/api/v1/seo/owner-tasks/${encodeURIComponent(id)}`, { done });
  refresh();
  if (!a.ok) return { ok: false, message: a.message, at: Date.now() };
  return { ok: true, message: a.value.task.done ? `Marked done by ${a.value.task.doneBy ?? "you"}.` : "Open again.", at: Date.now() };
}
