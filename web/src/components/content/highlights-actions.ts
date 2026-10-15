"use server";

import { revalidatePath } from "next/cache";
import { askPost } from "@/lib/api";
import type { HighlightSettings } from "@/contract/highlights";

export type SaveResult = { ok: boolean; message: string } | null;

/**
 * Save the highlights and commit them to the website. The desk server checks
 * that the person may publish; nothing is decided here.
 */
export async function saveHighlights(_before: SaveResult, form: FormData): Promise<SaveResult> {
  let settings: HighlightSettings;
  try {
    settings = JSON.parse(String(form.get("settings") ?? "")) as HighlightSettings;
  } catch {
    return { ok: false, message: "The choices could not be read. Reload the page and try again." };
  }
  const a = await askPost<{ ok: true; line: string }>("/api/v1/content/highlights", settings);
  if (!a.ok) return { ok: false, message: a.kind === "signed-out" ? "You are signed out. Sign in again and try once more." : a.message };
  revalidatePath("/content");
  return { ok: true, message: a.value.line };
}
