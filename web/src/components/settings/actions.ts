"use server";

import { refresh } from "next/cache";
import { askPost } from "@/lib/api";
import type { AccessChange, LinkChange, PersonAnswer, PersonChange } from "@/contract/settings";

/**
 * The owner's changes to people, sent to the desk server from this app's
 * server (lib/api.ts `askPost` carries the visitor's cookie and Origin).
 *
 * These decide nothing. The desk server checks, on every POST, that the owner
 * is asking and that the change is allowed (src/cc/routes/settings.ts); a
 * person who is not the owner gets its refusal back here, in its own words.
 * After a change the screen is drawn again from the server, so what it shows
 * is what the desk now holds.
 */

/** What a form shows beside its button after it was sent. */
export interface Said {
  ok: boolean;
  text: string;
  /** Changes on every answer, so the same sentence twice is still announced. */
  at: number;
}

const idOf = (form: FormData): number | null => {
  const id = Number(form.get("id"));
  return Number.isSafeInteger(id) && id !== 0 ? id : null;
};

async function send(path: string, body: PersonChange | AccessChange | LinkChange): Promise<Said> {
  const a = await askPost<PersonAnswer>(path, body);
  if (!a.ok) return { ok: false, text: a.message, at: Date.now() };
  refresh();
  return { ok: true, text: a.value.said, at: Date.now() };
}

/** Address, byline and "may see enquiries", from the person's form. */
export async function savePerson(_was: Said | null, form: FormData): Promise<Said> {
  const id = idOf(form);
  if (id === null) return { ok: false, text: "That form names nobody.", at: Date.now() };
  const change: PersonChange = {};
  if (form.has("email")) change.email = String(form.get("email") ?? "");
  if (form.has("byline")) change.byline = String(form.get("byline") ?? "");
  /* A checkbox sends nothing when it is clear, so the form says it carries one. */
  if (form.has("leads-shown")) change.seesLeads = form.get("leads") === "on";
  if (form.get("detach") === "on") change.detach = true;
  return send(`/api/v1/settings/people/${id}`, change);
}

/** Switch a person off, or let them in again. */
export async function switchPerson(_was: Said | null, form: FormData): Promise<Said> {
  const id = idOf(form);
  if (id === null) return { ok: false, text: "That form names nobody.", at: Date.now() };
  return send(`/api/v1/settings/people/${id}/access`, { on: form.get("on") === "1" });
}

/** Join a Google-only row to the Telegram account that is the same person. */
export async function linkPerson(_was: Said | null, form: FormData): Promise<Said> {
  const id = idOf(form);
  const telegram = Number(form.get("telegram"));
  if (id === null) return { ok: false, text: "That form names nobody.", at: Date.now() };
  if (!Number.isSafeInteger(telegram) || telegram <= 0) return { ok: false, text: "Choose the Telegram account to link.", at: Date.now() };
  return send(`/api/v1/settings/people/${id}/link`, { telegram });
}
