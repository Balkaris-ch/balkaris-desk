"use server";

import { refresh } from "next/cache";
import { askPost } from "@/lib/api";
import type { AccessLevel } from "@/contract/common";
import type { AccessGrantAnswer, AccessGrantChange, InviteAnswer, InviteChange, TeamSettingsAnswer } from "@/contract/team";

/**
 * The owner's changes to the team, sent to the desk server from this app's
 * server (lib/api.ts `askPost` carries the visitor's cookie and Origin).
 *
 * These decide nothing. The desk server checks, on every POST, that the owner
 * is asking and that the change is allowed (src/cc/routes/team.ts); anybody
 * else gets its refusal back here, in its own words. After a change the
 * screen is drawn again from the server, so what it shows is what the desk
 * now holds.
 */

/** What a form shows beside its button after it was sent. */
export interface Said {
  ok: boolean;
  text: string;
  /** Changes on every answer, so the same sentence twice is still announced. */
  at: number;
}

const no = (text: string): Said => ({ ok: false, text, at: Date.now() });

const idOf = (form: FormData): number | null => {
  const id = Number(form.get("id"));
  return Number.isSafeInteger(id) && id !== 0 ? id : null;
};

const isLevel = (v: unknown): v is AccessLevel => v === "none" || v === "view" || v === "edit";

/**
 * One person's access, from the editor: every area's level (`area:<key>`),
 * every page's own level or "" to follow its area (`page:<key>`), and the
 * enquiry right when the form carries it.
 */
export async function saveAccess(_was: Said | null, form: FormData): Promise<Said> {
  const id = idOf(form);
  if (id === null) return no("That form names nobody.");
  const set: Record<string, AccessLevel | ""> = {};
  for (const [k, v] of form.entries()) {
    if (k.startsWith("area:") && isLevel(v)) set[k.slice(5)] = v;
    if (k.startsWith("page:") && (v === "" || isLevel(v))) set[k] = v as AccessLevel | "";
  }
  const change: AccessGrantChange = { set };
  /* A checkbox sends nothing when it is clear, so the form says it carries one. */
  if (form.has("leads-shown")) change.seesLeads = form.get("leads") === "on";
  return grant(id, change);
}

/** A template for one person: the access it lists, nothing else changed. */
export async function applyPreset(_was: Said | null, form: FormData): Promise<Said> {
  const id = idOf(form);
  const preset = String(form.get("preset") ?? "");
  if (id === null) return no("That form names nobody.");
  if (!preset) return no("Choose a template.");
  return grant(id, { preset });
}

async function grant(id: number, change: AccessGrantChange): Promise<Said> {
  const a = await askPost<AccessGrantAnswer>(`/api/v1/team/access/${id}`, change);
  if (!a.ok) return no(a.message);
  refresh();
  return { ok: true, text: a.value.said, at: Date.now() };
}

/** What somebody signing in uninvited starts with. */
export async function saveNewcomers(_was: Said | null, form: FormData): Promise<Said> {
  const a = await askPost<TeamSettingsAnswer>("/api/v1/team/settings", { newcomers: String(form.get("newcomers") ?? "") });
  if (!a.ok) return no(a.message);
  refresh();
  return { ok: true, text: a.value.said, at: Date.now() };
}

/** Give somebody access before they sign in. */
export async function inviteMember(_was: Said | null, form: FormData): Promise<Said> {
  const body: InviteChange = {
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    preset: String(form.get("preset") ?? ""),
  };
  const a = await askPost<InviteAnswer>("/api/v1/team/invitations", body);
  if (!a.ok) return no(a.message);
  refresh();
  return { ok: true, text: a.value.said, at: Date.now() };
}

/** Take back an invitation nobody has used. */
export async function withdrawInvite(_was: Said | null, form: FormData): Promise<Said> {
  const id = idOf(form);
  if (id === null) return no("That form names nobody.");
  const a = await askPost<InviteAnswer>(`/api/v1/team/invitations/${id}/withdraw`);
  if (!a.ok) return no(a.message);
  refresh();
  return { ok: true, text: a.value.said, at: Date.now() };
}
