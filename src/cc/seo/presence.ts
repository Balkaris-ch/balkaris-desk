import { db } from "../../db.ts";
import type { NapMatrix, ProfileRow, ProfileState } from "../../../web/src/contract/seo/backlinks.ts";
import { note } from "../store.ts";
import { fetchPage, readHtml } from "./html.ts";
import { json, now } from "./tables.ts";

/**
 * PRESENCE: the studio's profiles and listings, and the name, address and
 * phone each states.
 *
 * The registry is seeded from the off-site audit (scripts/seo-import.ts): each
 * profile with its address when the audit found one, what the audit saw on it,
 * and the owner task that creates or fixes it. Once a week every profile with
 * an address is asked for, politely and under the desk's name:
 *
 *   answered 200 and shows the profile   exists
 *   answered 404 or 410                   not found
 *   refused (999, 403, 429), a sign-in
 *   wall, or no answer                    unknown, with the reason
 *
 * A profile without an address keeps the audit's finding ("not found on 2 Oct
 * 2026") until a person or the owner task gives it one: there is nothing to
 * ask. Name, address and phone are read only where the page itself states
 * them in structured data (the website); everything else shows what the
 * audit saw, with its day, and never as a reading of today.
 */

export interface ProfileInput {
  key: string;
  name: string;
  kind: ProfileRow["kind"];
  url: string | null;
  state: ProfileState;
  stateWhy: string | null;
  seen: { name: string | null; address: string | null; phone: string | null; day: string } | null;
  ownerTask: string | null;
  source: string;
  sort: number;
}

interface ProfileDb {
  key: string;
  name: string;
  kind: ProfileRow["kind"];
  url: string | null;
  state: ProfileState;
  state_why: string | null;
  checked_at: string | null;
  http: number | null;
  nap: string | null;
  nap_seen: string | null;
  owner_task: string | null;
  source: string;
  sort: number;
  updated_at: string;
}

/** Add or refresh a profile from an import. What the weekly check found is not overwritten. */
export function upsertProfile(p: ProfileInput, at = now()): "added" | "changed" | "unchanged" {
  const had = db.prepare("SELECT * FROM cc_seo_profiles WHERE key = ?").get(p.key) as ProfileDb | undefined;
  const seen = p.seen ? JSON.stringify(p.seen) : null;
  if (!had) {
    db.prepare(
      "INSERT INTO cc_seo_profiles (key, name, kind, url, state, state_why, nap_seen, owner_task, source, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(p.key, p.name, p.kind, p.url, p.state, p.stateWhy, seen, p.ownerTask, p.source, p.sort, at);
    return "added";
  }
  const checked = !!had.checked_at;
  const next = {
    name: p.name,
    kind: p.kind,
    url: had.url ?? p.url,
    state: checked ? had.state : p.state,
    why: checked ? had.state_why : p.stateWhy,
  };
  if (had.name === next.name && had.kind === next.kind && had.url === next.url && had.state === next.state && had.state_why === next.why && had.nap_seen === seen && had.owner_task === p.ownerTask && had.sort === p.sort) return "unchanged";
  db.prepare("UPDATE cc_seo_profiles SET name = ?, kind = ?, url = ?, state = ?, state_why = ?, nap_seen = ?, owner_task = ?, sort = ?, updated_at = ? WHERE key = ?").run(
    next.name,
    next.kind,
    next.url,
    next.state,
    next.why,
    seen,
    p.ownerTask,
    p.sort,
    at,
    p.key,
  );
  return "changed";
}

export function profiles(): ProfileRow[] {
  return (db.prepare("SELECT * FROM cc_seo_profiles ORDER BY sort, key").all() as unknown as ProfileDb[]).map((r) => ({
    key: r.key,
    name: r.name,
    kind: r.kind,
    url: r.url,
    state: r.state,
    stateWhy: r.state_why ?? "",
    checkedAt: r.checked_at,
    nap: json<ProfileRow["nap"]>(r.nap, null),
    napSeen: json<ProfileRow["napSeen"]>(r.nap_seen, null),
    ownerTaskId: r.owner_task,
  }));
}

/** Where the checks go. The check script replaces it. */
export const wire = { fetchPage, sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)) };

/** Name, address and phone from a page's own structured data (Organization, LocalBusiness and the like). */
function napFrom(schema: Record<string, unknown>[]): ProfileRow["nap"] {
  for (const n of schema) {
    const types = (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]).map(String);
    if (!types.some((t) => /Organization|LocalBusiness|ProfessionalService|Corporation/.test(t))) continue;
    const a = (n.address ?? null) as Record<string, unknown> | string | null;
    const address =
      typeof a === "string"
        ? a
        : a
          ? [a.streetAddress, [a.postalCode, a.addressLocality].filter(Boolean).join(" ")].filter((x) => typeof x === "string" && x).join(", ") || null
          : null;
    const name = typeof n.name === "string" ? n.name : null;
    const phone = typeof n.telephone === "string" ? n.telephone : null;
    if (name || address || phone) return { name, address, phone };
  }
  return null;
}

/** The handle or address part that shows a page is the profile asked for, not a sign-in page. */
const marker = (url: string): string => {
  const u = new URL(url);
  return (u.pathname.split("/").filter(Boolean).pop() ?? u.hostname).toLowerCase();
};

/**
 * Ask every profile with an address, one at a time, three seconds apart (no
 * two of them share a host often enough to need more).
 */
export async function checkProfiles(progress: (done: number, of: number, what?: string) => void = () => {}): Promise<string> {
  const rows = db.prepare("SELECT * FROM cc_seo_profiles WHERE url IS NOT NULL ORDER BY sort").all() as unknown as ProfileDb[];
  if (!rows.length) return "No profile has an address to check yet.";
  const put = db.prepare("UPDATE cc_seo_profiles SET state = ?, state_why = ?, checked_at = ?, http = ?, nap = ? WHERE key = ?");
  const tally: Record<ProfileState, number> = { exists: 0, "not-found": 0, unknown: 0, "not-checked": 0 };
  const changed: string[] = [];
  for (const [i, r] of rows.entries()) {
    if (i) await wire.sleep(3000);
    progress(i, rows.length, r.name);
    const host = new URL(r.url!).hostname;
    let state: ProfileState;
    let why: string;
    let nap: ProfileRow["nap"] = null;
    if (/(^|\.)google\.[a-z.]+$/.test(host)) {
      state = "unknown";
      why = "Google Maps shows a consent page and runs in the browser, so a profile cannot be read by a plain request; the audit saw it in Chrome.";
    } else {
      const got = await wire.fetchPage(r.url!, { timeout: 20_000 });
      if (got.status === 404 || got.status === 410) {
        state = "not-found";
        why = `The address answered ${got.status}.`;
      } else if (got.status === 200 && got.html) {
        const h = readHtml(got.html);
        nap = napFrom(h.schema);
        const shows = got.html.toLowerCase().includes(marker(r.url!));
        state = shows ? "exists" : "unknown";
        why = shows ? "The address answered 200 and shows the profile." : "The address answered 200 but shows a sign-in or another page, not the profile.";
      } else if (got.status === 0) {
        state = "unknown";
        why = `No answer: ${got.error ?? "the request failed"}.`;
      } else {
        state = "unknown";
        why = `${host} refuses automated checks (it answered ${got.status}).`;
      }
    }
    if (state !== r.state) changed.push(`${r.name}: ${r.state} → ${state}`);
    tally[state]++;
    put.run(state, why, now(), null, nap ? JSON.stringify(nap) : null, r.key);
  }
  progress(rows.length, rows.length);
  if (changed.length) {
    note("seo-presence", `${changed.length} profile${changed.length === 1 ? "" : "s"} changed state`, { tone: "info", detail: changed.slice(0, 4).join("; "), href: "/seo/backlinks", dedupe: `seo:presence:${now()}` });
  }
  return `${rows.length} profiles checked: ${tally.exists} exist, ${tally["not-found"]} not found, ${tally.unknown} could not be read`;
}

/* ---------- name, address, phone side by side ------------------------------------------- */

const normal = {
  name: (s: string) => s.toLowerCase().replace(/[^a-z0-9äöü]/g, ""),
  address: (s: string) => s.toLowerCase().replace(/strasse/g, "str").replace(/[^a-z0-9äöü]/g, ""),
  phone: (s: string) => {
    const d = s.replace(/[^\d+]/g, "");
    return d.startsWith("+41") ? `0${d.slice(3)}` : d.startsWith("0041") ? `0${d.slice(4)}` : d;
  },
};

/** Each field as each profile states it: read by the check when it could, else as the audit saw it, with its day. */
export function napMatrix(): NapMatrix {
  const fields: NapMatrix["fields"] = (["name", "address", "phone"] as const).map((field) => {
    const values: { source: string; value: string; day: string }[] = [];
    for (const p of profiles()) {
      const read = p.nap?.[field];
      if (read && p.checkedAt) values.push({ source: p.name, value: read, day: p.checkedAt.slice(0, 10) });
      else if (p.napSeen?.[field]) values.push({ source: `${p.name} (as the audit saw it)`, value: p.napSeen[field]!, day: p.napSeen.day });
    }
    const distinct = new Set(values.map((v) => normal[field](v.value)));
    return { field, values, consistent: distinct.size <= 1 };
  });
  return { fields, consistent: fields.every((f) => f.consistent) };
}
