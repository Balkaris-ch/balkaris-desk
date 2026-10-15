"use server";

import { revalidatePath } from "next/cache";
import { askPost } from "@/lib/api";

export type ScoutSaid = { ok: boolean; message: string } | null;

const said = (a: { ok: true; value: unknown } | { ok: false; kind: string; message: string }, done: string): ScoutSaid =>
  a.ok ? { ok: true, message: (a.value as { line?: string } | null)?.line ?? done } : { ok: false, message: a.kind === "signed-out" ? "You are signed out. Sign in again and try once more." : a.message };

/** Mode, posts a day, how many by itself in Mix, and the score it needs to publish alone. */
export async function saveScout(_b: ScoutSaid, form: FormData): Promise<ScoutSaid> {
  const a = await askPost("/api/v1/insights/scout/settings", {
    mode: String(form.get("mode") ?? ""),
    perDay: Number(form.get("perDay")),
    autoNews: Number(form.get("autoNews")),
    autoMin: Number(form.get("autoMin")),
  });
  revalidatePath("/insights");
  return said(a, "Saved.");
}

export async function runScout(_b: ScoutSaid): Promise<ScoutSaid> {
  const a = await askPost("/api/v1/insights/scout/run");
  revalidatePath("/insights");
  return said(a, "The Scout is reading its sources now.");
}

/** News, Article or Skip for one find. */
export async function decideFind(_b: ScoutSaid, form: FormData): Promise<ScoutSaid> {
  const id = String(form.get("id") ?? "");
  if (!/^\d+$/.test(id)) return { ok: false, message: "No such find." };
  const a = await askPost(`/api/v1/insights/scout/finds/${id}`, { action: String(form.get("action") ?? "") });
  revalidatePath("/insights");
  return said(a, "Done.");
}

export async function addScoutSource(_b: ScoutSaid, form: FormData): Promise<ScoutSaid> {
  const a = await askPost("/api/v1/insights/scout/sources", { url: String(form.get("url") ?? "") });
  revalidatePath("/insights");
  return said(a, "Added.");
}

export async function setScoutSource(_b: ScoutSaid, form: FormData): Promise<ScoutSaid> {
  const id = String(form.get("id") ?? "");
  if (!/^\d+$/.test(id)) return { ok: false, message: "No such source." };
  const a = await askPost(`/api/v1/insights/scout/sources/${id}`, { status: String(form.get("status") ?? "") });
  revalidatePath("/insights");
  return said(a, "Saved.");
}
