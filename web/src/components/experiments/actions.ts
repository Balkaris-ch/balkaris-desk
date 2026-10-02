"use server";

import { redirect } from "next/navigation";
import type { SaveComparison, SavedAnswer } from "@/contract/experiments";
import { askPost } from "@/lib/api";

/**
 * The two changes the Experiments screen makes: save what is being compared,
 * and remove a saved comparison. Both are asked of the desk server, which
 * decides who may (anyone signed in saves; only the person who saved one, or
 * the owner, removes it).
 *
 * On success the screen goes to its new address (the saved comparison
 * opened, or the removed one closed). On a refusal the server's own words go
 * back to the form that was sent, as its state, and are printed under its
 * buttons. Never in the address, where anybody could write their own.
 */

/** A refusal, as the form prints it. */
export interface Said {
  text: string;
  /** Changes on every answer, so the same sentence twice is still announced. */
  at: number;
}

/** Only this screen's own addresses are gone back to. */
function back(form: FormData): string {
  const raw = String(form.get("back") ?? "");
  return raw.startsWith("/experiments") && !raw.startsWith("//") ? raw : "/experiments";
}

export async function saveComparison(_was: Said | null, form: FormData): Promise<Said | null> {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const body: SaveComparison = {
    name: text("name"),
    note: text("note") || undefined,
    window: Number(text("window")) as SaveComparison["window"],
    page: text("page") || null,
    ...(text("day") ? { day: text("day") } : { sha: text("sha") }),
  };
  const a = await askPost<SavedAnswer>("/api/v1/experiments/saved", body);
  if (!a.ok) return { text: a.message, at: Date.now() };
  const range = text("range");
  const metric = text("metric");
  redirect(`/experiments?${new URLSearchParams({ ...(range ? { range } : {}), saved: String(a.value.id), ...(metric ? { metric } : {}) }).toString()}#compare`);
}

export async function removeComparison(_was: Said | null, form: FormData): Promise<Said | null> {
  const id = Number(form.get("id"));
  if (!Number.isSafeInteger(id) || id < 1) return { text: "That form names no comparison.", at: Date.now() };
  const a = await askPost(`/api/v1/experiments/saved/${encodeURIComponent(String(id))}/delete`);
  if (!a.ok) return { text: a.message, at: Date.now() };
  /* The comparison that was open is gone: open nothing in its place. */
  redirect(
    back(form)
      .replace(new RegExp(`([?&])saved=${id}(?=&|#|$)`), "$1")
      .replace(/[?&](#|$)/, "$1")
      .replace(/([?&])&/, "$1"),
  );
}
