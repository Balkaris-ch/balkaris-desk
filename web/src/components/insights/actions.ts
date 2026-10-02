"use server";

import { revalidatePath } from "next/cache";
import { askPost } from "@/lib/api";
import type { CreateAnswer } from "@/contract/insights";

/**
 * The Insights screen's two changes. Each asks the desk server, which checks
 * who is asking (only people who can publish may create) and where the
 * request came from; nothing is decided here.
 */

export type CreateResult = { ok: true; answer: CreateAnswer } | { ok: false; message: string } | null;

/** Create insight: the link and its job, through the same function Telegram uses. */
export async function createInsight(_before: CreateResult, form: FormData): Promise<CreateResult> {
  const url = String(form.get("url") ?? "").trim();
  const format = String(form.get("format") ?? "");
  const a = await askPost<CreateAnswer>("/api/v1/insights/create", { url, format });
  if (!a.ok) return { ok: false, message: a.kind === "signed-out" ? "You are signed out. Sign in again and try once more." : a.message };
  revalidatePath("/insights");
  return { ok: true, answer: a.value };
}

export type RetryResult = { ok: boolean; message: string } | null;

/** Try it again: a stuck job, or a link that could not be read, goes back in the queue. */
export async function retryLink(_before: RetryResult, form: FormData): Promise<RetryResult> {
  const id = String(form.get("link") ?? "");
  if (!/^\d+$/.test(id)) return { ok: false, message: "No such link." };
  const a = await askPost(`/api/v1/insights/retry/${id}`);
  if (!a.ok) return { ok: false, message: a.message };
  revalidatePath("/insights");
  return { ok: true, message: "Queued again." };
}
