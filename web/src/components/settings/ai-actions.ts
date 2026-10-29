"use server";

import { revalidatePath } from "next/cache";
import { askPost } from "@/lib/api";

export type AiSaid = { ok: boolean; message: string } | null;

/** Local or Anthropic, which Claude, and the month's budget. The owner only; the server says so to anybody else. */
export async function saveAi(_b: AiSaid, form: FormData): Promise<AiSaid> {
  const a = await askPost<{ line?: string }>("/api/v1/ai", {
    provider: String(form.get("provider") ?? ""),
    model: String(form.get("model") ?? ""),
    budgetUsd: Number(form.get("budgetUsd")),
  });
  revalidatePath("/settings");
  return a.ok ? { ok: true, message: a.value?.line ?? "Saved." } : { ok: false, message: a.kind === "signed-out" ? "You are signed out. Sign in again and try once more." : a.message };
}
