import { db } from "../../db.ts";
import type { NapField, NapMatrix, NapTruth, ProfileRow, ProfileState } from "../../../web/src/contract/seo/backlinks.ts";
import { fetchGuarded, Refused } from "../site/audit.ts";
import { siteHost, twinHost } from "../site/http.ts";
import { note, setState, state, today } from "../store.ts";
import { decode, fetchPage, readHtml, type Fetched } from "./html.ts";
import { json, now } from "./tables.ts";

/**
 * PRESENCE: the studio's profiles and listings, and the name, address and
 * phone each states.
 *
 * The registry is seeded from the off-site audit (scripts/seo-import.ts): each
 * profile with its address when the audit found one, what the audit saw on it,
 * and the owner task that creates or fixes it. A person on the desk adds a
 * profile, gives one its address or corrects what it states (the Backlinks
 * page), and what a person entered is never overwritten by an import. Once a
 * week every profile with an address is asked for, politely and under the
 * desk's name:
 *
 *   answered 200 and names the profile   exists
 *   answered 404 or 410, or the
 *   network's own "no such page" screen  not found
 *   refused (999, 403, 429), a sign-in
 *   wall, or no answer                    unknown, with the reason
 *
 * "Names the profile" is read from the page's title or its own stated address
 * (og:url, the canonical): a page that only echoes the path it was asked for
 * (Instagram answers 200 for a handle that does not exist) is not a profile.
 *
 * A profile without an address keeps the audit's finding ("not found on 2 Oct
 * 2026") until a person gives it one. For a few of them the weekly check looks
 * for an address by itself (Wikidata's search, the public profile address a
 * directory would give the studio); what it finds is offered to a person and
 * used only when they say it is the studio's.
 *
 * Name, address and phone are read only where the page itself states them:
 * the website's structured data and its imprint page, an Instagram profile's
 * name. A check that cannot read the page keeps what the last one read, with
 * its day. Everything else shows what a person saw there (the audit, or
 * somebody on the desk), with the day and who, and never as a reading of today.
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

export const KINDS: ProfileRow["kind"][] = ["listing", "social", "directory", "register", "website"];

/** True when what a profile is recorded as stating was entered by a person on the desk, not seen by the audit. */
const byPerson = (seen: ProfileRow["napSeen"]): boolean => !!seen?.by && seen.by !== "audit";

/** Add or refresh a profile from an import. What the weekly check found, and what a person entered, is not overwritten. */
export function upsertProfile(p: ProfileInput, at = now()): "added" | "changed" | "unchanged" {
  const had = db.prepare("SELECT * FROM cc_seo_profiles WHERE key = ?").get(p.key) as ProfileDb | undefined;
  const seen = p.seen ? JSON.stringify(p.seen) : null;
  if (!had) {
    db.prepare(
      "INSERT INTO cc_seo_profiles (key, name, kind, url, state, state_why, nap_seen, owner_task, source, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(p.key, p.name, p.kind, p.url, p.state, p.stateWhy, seen, p.ownerTask, p.source, p.sort, at);
    return "added";
  }
  /* A row whose address a person gave waits for its first check: the audit's "not found" is no longer about it. */
  const checked = !!had.checked_at || (!!had.url && had.url !== p.url);
  const nextSeen = byPerson(json<ProfileRow["napSeen"]>(had.nap_seen, null)) ? had.nap_seen : seen;
  const next = {
    name: p.name,
    kind: p.kind,
    url: had.url ?? p.url,
    state: checked ? had.state : p.state,
    why: checked ? had.state_why : p.stateWhy,
  };
  if (had.name === next.name && had.kind === next.kind && had.url === next.url && had.state === next.state && had.state_why === next.why && had.nap_seen === nextSeen && had.owner_task === p.ownerTask && had.sort === p.sort) return "unchanged";
  db.prepare("UPDATE cc_seo_profiles SET name = ?, kind = ?, url = ?, state = ?, state_why = ?, nap_seen = ?, owner_task = ?, sort = ?, updated_at = ? WHERE key = ?").run(
    next.name,
    next.kind,
    next.url,
    next.state,
    next.why,
    nextSeen,
    p.ownerTask,
    p.sort,
    at,
    p.key,
  );
  return "changed";
}

/* What the weekly check found for a row without an address, and what a person said was not the studio's. Kept beside the rows, in cc_state. */
const FOUND = "seo:presence:found:";
const DISMISSED = "seo:presence:dismissed:";
type Found = NonNullable<ProfileRow["found"]>;
const foundOf = (key: string): Found | null => json<Found | null>(state(`${FOUND}${key}`), null);
const forget = (key: string): void => {
  db.prepare("DELETE FROM cc_state WHERE key = ?").run(key);
};

const toRow = (r: ProfileDb): ProfileRow => ({
  key: r.key,
  name: r.name,
  kind: r.kind,
  url: r.url,
  state: r.state,
  stateWhy: r.state_why ?? "",
  checkedAt: r.checked_at,
  http: r.http,
  nap: json<ProfileRow["nap"]>(r.nap, null),
  napSeen: json<ProfileRow["napSeen"]>(r.nap_seen, null),
  ownerTaskId: r.owner_task,
  source: r.source,
  found: r.url ? null : foundOf(r.key),
});

export function profiles(): ProfileRow[] {
  return (db.prepare("SELECT * FROM cc_seo_profiles ORDER BY sort, key").all() as unknown as ProfileDb[]).map(toRow);
}

export function profile(key: string): ProfileRow | null {
  const r = db.prepare("SELECT * FROM cc_seo_profiles WHERE key = ?").get(key) as ProfileDb | undefined;
  return r ? toRow(r) : null;
}

/* ---------- a person's changes ------------------------------------------------------------ */

/** A sentence a person can act on: thrown by the changes below, shown beside the button. */
export class Said extends Error {}

/** A profile's address as a person typed it: https, a public host, no credentials. Throws `Said`. */
export function profileUrl(raw: string): string {
  const text = raw.trim();
  if (text.length > 500) throw new Said("The address is longer than 500 characters.");
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Said(`“${text.slice(0, 80)}” is not a web address.`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Said("A profile's address starts with https://.");
  if (u.username || u.password) throw new Said("An address with a user name or password in it is not kept.");
  if (!u.hostname.includes(".") || /(^|\.)(localhost|local|internal|lan)$/i.test(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(":")) throw new Said(`“${u.hostname}” is not a public website.`);
  u.hash = "";
  return u.toString();
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const tidy = (v: unknown, most: number, what: string): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new Said(`${what} must be text.`);
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length > most) throw new Said(`${what} is at most ${most} characters.`);
  return s || null;
};

/** A person adds a profile or listing the audit did not know of. */
export function addProfile(p: { name: unknown; kind: unknown; url?: unknown }, by: string): ProfileRow {
  const name = tidy(p.name, 80, "The name");
  if (!name || name.length < 2) throw new Said("Give the profile a name: “Clutch”, “Bing Places”.");
  if (!KINDS.includes(p.kind as ProfileRow["kind"]) || p.kind === "website") throw new Said("Choose what it is: a map listing, a social profile, a directory or a register.");
  const url = p.url === undefined || p.url === null || p.url === "" ? null : profileUrl(String(p.url));
  let key = slug(name) || "profile";
  if (db.prepare("SELECT 1 FROM cc_seo_profiles WHERE lower(name) = lower(?)").get(name)) throw new Said(`A profile called “${name}” is already in the list: change that row.`);
  for (let n = 2; db.prepare("SELECT 1 FROM cc_seo_profiles WHERE key = ?").get(key); n++) key = `${slug(name)}-${n}`;
  const sort = ((db.prepare("SELECT MAX(sort) AS s FROM cc_seo_profiles").get() as { s: number | null }).s ?? 0) + 1;
  const day = today();
  db.prepare("INSERT INTO cc_seo_profiles (key, name, kind, url, state, state_why, source, sort, updated_at) VALUES (?, ?, ?, ?, 'not-checked', ?, 'person', ?, ?)").run(
    key,
    name,
    p.kind as string,
    url,
    url ? `Added by ${by} on ${day}; its address has not been asked yet.` : `Added by ${by} on ${day} without an address: there is nothing to ask until it has one.`,
    sort,
    now(),
  );
  note("seo-presence", `Added the profile ${name}`, { tone: "info", actor: by, detail: url ?? "No address yet.", href: "/seo/backlinks", dedupe: `seo:presence:add:${key}:${now()}` });
  return profile(key)!;
}

export interface ProfileChange {
  name?: unknown;
  kind?: unknown;
  /** A new address, or null/"" to take the address away. */
  url?: unknown;
  /** What the profile states today, as the person sees it there: each field text, or null when it states none. */
  stated?: unknown;
}

/**
 * A person changes a row: its name, what it is, its address, or what it
 * states. A new address makes the row "not checked" until it is asked; what
 * the person says it states is kept with their name and the day, and shown
 * as theirs, never as a reading.
 */
export function editProfile(key: string, c: ProfileChange, by: string): { row: ProfileRow; changed: string[] } {
  const had = db.prepare("SELECT * FROM cc_seo_profiles WHERE key = ?").get(key) as ProfileDb | undefined;
  if (!had) throw new Said(`There is no profile ${key}.`);
  const changed: string[] = [];
  const day = today();
  let { name, kind, url, state: st, state_why: why, checked_at: checkedAt, http, nap, nap_seen: seen } = had;

  if (c.name !== undefined) {
    const n = tidy(c.name, 80, "The name");
    if (!n || n.length < 2) throw new Said("A profile needs a name.");
    if (n !== name) {
      if (db.prepare("SELECT 1 FROM cc_seo_profiles WHERE lower(name) = lower(?) AND key <> ?").get(n, key)) throw new Said(`Another profile is already called “${n}”.`);
      name = n;
      changed.push("name");
    }
  }
  if (c.kind !== undefined && c.kind !== kind) {
    if (!KINDS.includes(c.kind as ProfileRow["kind"])) throw new Said("Choose what it is: a map listing, a social profile, a directory, a register or the website.");
    if (had.kind === "website" || c.kind === "website") throw new Said("The website's own row stays the website's, and no other row becomes it.");
    kind = c.kind as ProfileRow["kind"];
    changed.push("kind");
  }
  if (c.url !== undefined) {
    const next = c.url === null || c.url === "" ? null : profileUrl(String(c.url));
    if (next !== url) {
      if (had.kind === "website") throw new Said("The website's address is the desk's own setting (SITE_BASE), not a row to change here.");
      url = next;
      st = "not-checked";
      why = next ? `Address given by ${by} on ${day}; it has not been asked yet.` : `Address taken away by ${by} on ${day}: there is nothing to ask until it has one.`;
      checkedAt = null;
      http = null;
      /* What was read came from the address before. */
      nap = null;
      changed.push("address");
      forget(`${FOUND}${key}`);
    }
  }
  if (c.stated !== undefined) {
    if (c.stated !== null && (typeof c.stated !== "object" || Array.isArray(c.stated))) throw new Said("stated must be { name, address, phone }.");
    const s = (c.stated ?? {}) as Record<string, unknown>;
    const before = json<ProfileRow["napSeen"]>(seen, null);
    const next = {
      name: s.name === undefined ? (before?.name ?? null) : tidy(s.name, 120, "The name it states"),
      address: s.address === undefined ? (before?.address ?? null) : tidy(s.address, 200, "The address it states"),
      phone: s.phone === undefined ? (before?.phone ?? null) : tidy(s.phone, 40, "The phone it states"),
    };
    if (next.name !== (before?.name ?? null) || next.address !== (before?.address ?? null) || next.phone !== (before?.phone ?? null)) {
      seen = next.name || next.address || next.phone ? JSON.stringify({ ...next, day, by }) : null;
      changed.push("what it states");
    }
  }
  if (!changed.length) return { row: toRow(had), changed };
  db.prepare("UPDATE cc_seo_profiles SET name = ?, kind = ?, url = ?, state = ?, state_why = ?, checked_at = ?, http = ?, nap = ?, nap_seen = ?, updated_at = ? WHERE key = ?").run(name, kind, url, st, why, checkedAt, http, nap, seen, now(), key);
  note("seo-presence", `Changed the profile ${name}: ${changed.join(", ")}`, { tone: "info", actor: by, href: "/seo/backlinks", dedupe: `seo:presence:edit:${key}:${now()}` });
  return { row: profile(key)!, changed };
}

/** Take a row away. Only one a person added: the audit's rows come back with the next import, so they are corrected, not removed. */
export function removeProfile(key: string, by: string): ProfileRow {
  const had = profile(key);
  if (!had) throw new Said(`There is no profile ${key}.`);
  if (had.source !== "person") throw new Said("This row comes from the SEO audit and would return with its next import. Change it instead.");
  db.prepare("DELETE FROM cc_seo_profiles WHERE key = ?").run(key);
  forget(`${FOUND}${key}`);
  forget(`${DISMISSED}${key}`);
  note("seo-presence", `Removed the profile ${had.name}`, { tone: "info", actor: by, href: "/seo/backlinks", dedupe: `seo:presence:remove:${key}:${now()}` });
  return had;
}

/** A person says the address the weekly check found is the studio's (it becomes the row's address), or is not (it is not offered again). */
export function settleFound(key: string, use: boolean, by: string): ProfileRow {
  const f = foundOf(key);
  if (!f) throw new Said("Nothing was found for this row.");
  if (use) return editProfile(key, { url: f.url }, by).row;
  setState(`${DISMISSED}${key}`, f.url);
  forget(`${FOUND}${key}`);
  return profile(key)!;
}

/* ---------- reading a profile ----------------------------------------------------------------- */

/**
 * A profile's address as a person gave it, read behind the spider's guard
 * (src/cc/site/audit.ts): the name must resolve to public addresses only and
 * every redirect is checked again, so an address typed on the desk cannot
 * make the desk fetch its own insides. Never throws.
 */
async function guardedPage(url: string): Promise<Fetched> {
  try {
    const g = await fetchGuarded(url);
    return { status: g.status, url: g.url, html: g.body, contentType: g.headers["content-type"] ?? null, error: g.error ?? null };
  } catch (e) {
    const said = (e instanceof Error ? e.message : String(e)).replace(/\baudits?\b/g, "reads").replace(/\baudited\b/g, "read");
    return { status: 0, url, html: null, contentType: null, error: e instanceof Refused ? `the desk does not read this address (${said})` : said };
  }
}

/**
 * Where the checks go. The check script replaces them. `fetchPage` for the
 * website itself and the finders' fixed hosts; `guarded` for every address a
 * profile row holds, which a person may have typed.
 */
export const wire = { fetchPage, guarded: guardedPage, sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)) };

/** Name, address and phone from a page's own structured data (Organization, LocalBusiness and the like). */
function napFrom(schema: Record<string, unknown>[]): { name: string | null; address: string | null; phone: string | null } | null {
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
  return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? u.hostname).toLowerCase();
};

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? "") : null;
};

/** The page's title, and the address it states as its own (og:url, the canonical). */
function ownWords(html: string): { title: string; addresses: string[] } {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const addresses: string[] = [];
  for (const m of html.matchAll(/<(?:meta|link)\b[^>]*>/gi)) {
    const tag = m[0];
    if (/^<meta/i.test(tag) && /og:url/i.test(attr(tag, "property") ?? attr(tag, "name") ?? "")) addresses.push(attr(tag, "content") ?? "");
    if (/^<link/i.test(tag) && /\bcanonical\b/i.test(attr(tag, "rel") ?? "")) addresses.push(attr(tag, "href") ?? "");
  }
  return { title, addresses: addresses.filter(Boolean) };
}

/**
 * Does the page name the profile that was asked for? Its title carries the
 * handle, or the address the page states as its own ends in it. The handle
 * merely appearing somewhere in the HTML proves nothing: a "no such page"
 * shell echoes the path it was asked for.
 */
function names(html: string, url: string): boolean {
  const handle = marker(url);
  const loose = handle.replace(/[^a-z0-9]/g, "");
  const own = ownWords(html);
  const title = own.title.toLowerCase();
  if (title.includes(handle) || (loose.length >= 4 && title.replace(/[^a-z0-9]/g, "").includes(loose))) return true;
  return own.addresses.some((a) => {
    try {
      return marker(new URL(a, url).toString()) === handle;
    } catch {
      return false;
    }
  });
}

/** The network's own screen for a profile that does not exist, served with 200. Instagram: read 5 October 2026. */
const NO_SUCH_PAGE = /"pageID"\s*:\s*"httpErrorPage"/;
const SIGN_IN = /\/(accounts\/login|login|signin|sign-in|authwall|checkpoint)\b/i;

/**
 * A Swiss address in running text: "Musterweg 8, 8000 Zürich", "Musterweg 8 ·
 * CH-8000 Zürich", the two on following lines, or with nothing between them
 * ("Musterweg 8 8000 Zürich Switzerland", as the studio's own imprint has it,
 * read 5 October 2026).
 */
const ADDRESS = /(\p{Lu}[\p{L}.'’-]+(?:[ -][\p{L}.'’-]+){0,3}\s\d{1,4}\s?[a-zA-Z]?)(?:\s*[,·|\n]\s*|\s+)(?:CH[- ])?(\d{4})\s+(\p{Lu}[\p{L}.'’-]+(?:[ -]\p{L}[\p{L}.'’-]+){0,2})/u;
const PHONE = /(?:\+41|0041)[\s\d]{9,14}\d|\b0\d{2}\s?\d{3}\s?\d{2}\s?\d{2}\b/;
/** A country after the town is not part of it. */
const COUNTRY = /\s+(?:Switzerland|Schweiz|Suisse|Svizzera|Svizra)$/i;

/** The address and phone an imprint page states in its text, when it states them the way Swiss imprints do. */
export function napInText(text: string): { address: string | null; phone: string | null } {
  const a = ADDRESS.exec(text);
  const p = PHONE.exec(text);
  return {
    address: a ? `${a[1]!.replace(/\s+/g, " ").trim()}, ${a[2]} ${a[3]!.trim().replace(COUNTRY, "")}` : null,
    phone: p ? p[0].replace(/\s+/g, " ").trim() : null,
  };
}

/** The imprint page a home page links to, on the same site. */
function imprintOf(html: string, base: string): string | null {
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], "href");
    if (!href || !/impressum|imprint|legal-notice/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname === new URL(base).hostname) return u.toString();
    } catch {
      /* not an address */
    }
  }
  return null;
}

type Nap = NonNullable<ProfileRow["nap"]>;

interface Asked {
  state: ProfileState;
  why: string;
  http: number | null;
  /** What was read; undefined when the page could not be read, so what the last check read is kept. */
  nap?: Nap | null;
}

const isOwn = (host: string): boolean => host === siteHost() || host === twinHost();

/** Ask one address, and say what it showed. */
async function ask(r: ProfileDb): Promise<Asked> {
  const host = new URL(r.url!).hostname;
  if (/(^|\.)google\.[a-z.]+$/.test(host)) {
    return { state: "unknown", http: null, why: "Google Maps shows a consent page and runs in the browser, so a profile cannot be read by a plain request; the audit saw it in Chrome." };
  }
  const own = isOwn(host);
  const got = own ? await wire.fetchPage(r.url!, { timeout: 20_000 }) : await wire.guarded(r.url!);
  if (got.status === 404 || got.status === 410) return { state: "not-found", http: got.status, why: own ? `The website answered ${got.status}.` : `The address answered ${got.status}.` };
  if (got.status === 0) return { state: "unknown", http: null, why: `No answer: ${got.error ?? "the request failed"}.` };
  if (got.status !== 200 || !got.html) {
    return {
      state: "unknown",
      http: got.status,
      why: own ? `The website answered ${got.status}, not its page, so nothing could be read from it.` : `${host} refuses automated checks (it answered ${got.status}).`,
    };
  }
  const day = today();
  if (own) {
    /* The website: its structured data, then its imprint page for what the home page does not state. */
    const read = napFrom(readHtml(got.html).schema) ?? { name: null, address: null, phone: null };
    let from = "its structured data";
    const imprint = imprintOf(got.html, got.url);
    if (imprint && (!read.address || !read.phone || !read.name)) {
      await wire.sleep(1000);
      const page = await wire.fetchPage(imprint, { timeout: 20_000 });
      if (page.status === 200 && page.html) {
        const h = readHtml(page.html);
        const s = napFrom(h.schema);
        const t = napInText(h.text);
        read.name ??= s?.name ?? null;
        read.address ??= s?.address ?? t.address;
        read.phone ??= s?.phone ?? t.phone;
        from = `its structured data and its imprint page (${new URL(imprint).pathname})`;
      }
    }
    const any = read.name || read.address || read.phone;
    return { state: "exists", http: 200, why: any ? `The website answered 200; name, address and phone are read from ${from}.` : "The website answered 200, and states no name, address or phone in its structured data or imprint.", nap: any ? { ...read, day } : null };
  }
  if (NO_SUCH_PAGE.test(got.html)) return { state: "not-found", http: 200, why: `${host} answered 200 with its own “this page is not available” screen: there is no profile at this address.` };
  if (SIGN_IN.test(new URL(got.url).pathname)) return { state: "unknown", http: 200, why: `${host} sent the request to its sign-in page, so the profile cannot be read without an account.` };
  if (!names(got.html, r.url!)) return { state: "unknown", http: 200, why: "The address answered 200, but the page does not name the profile in its title or its own address: a sign-in wall or another page." };
  /* An Instagram profile's title is "Name (@handle) • Instagram …": the name is the profile's own. */
  const title = ownWords(got.html).title;
  const handle = /^(.*?)\s*\(@[^)]+\)/.exec(title);
  const read = napFrom(readHtml(got.html).schema) ?? (handle?.[1] ? { name: handle[1].trim(), address: null, phone: null } : null);
  return { state: "exists", http: 200, why: "The address answered 200 and the page names the profile.", nap: read ? { ...read, day } : null };
}

/* ---------- looking for an address the desk does not have ------------------------------------ */

/** The studio's name, for the finders: the agreed one, else what the website states. */
function studioName(): string | null {
  const t = napTruth();
  if (t?.name) return t.name;
  const site = profiles().find((p) => p.kind === "website");
  return site?.nap?.name ?? site?.napSeen?.name ?? null;
}

/** Where a directory would give the studio its public profile, by the registry's key. A guess that is asked, never assumed. */
const PROBE: Record<string, (handle: string) => string> = {
  behance: (h) => `https://www.behance.net/${h}`,
  sortlist: (h) => `https://www.sortlist.com/agency/${h}`,
  goodfirms: (h) => `https://www.goodfirms.co/company/${h}`,
};

/**
 * Look for a row that has no address. Wikidata is asked through its search
 * (free, no key); a directory is asked for the address it would give the
 * studio's name. A hit is kept as "found" for a person to confirm.
 */
async function find(r: ProfileDb, name: string): Promise<Found | null> {
  const dismissed = state(`${DISMISSED}${r.key}`);
  const day = today();
  if (r.key === "wikidata") {
    const got = await wire.fetchPage(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&uselang=en&type=item&limit=5&format=json`, { timeout: 15_000, accept: "application/json" });
    if (got.status !== 200 || !got.html) return null;
    const list = json<{ search?: { id?: string; label?: string; description?: string; concepturi?: string }[] }>(got.html, {}).search ?? [];
    const hit = list.find((x) => x.id && x.label && sameKey.name(x.label) === sameKey.name(name));
    if (!hit) return null;
    const url = `https://www.wikidata.org/wiki/${hit.id}`;
    if (url === dismissed) return null;
    return { url, day, what: `Wikidata has an item called “${hit.label}” (${hit.id}${hit.description ? `: ${hit.description.slice(0, 80)}` : ""}).` };
  }
  const probe = PROBE[r.key];
  if (!probe) return null;
  const url = probe(slug(name));
  if (url === dismissed) return null;
  const got = await wire.fetchPage(url, { timeout: 15_000 });
  if (got.status !== 200 || !got.html || SIGN_IN.test(new URL(got.url).pathname)) return null;
  const title = ownWords(got.html).title;
  if (!sameKey.name(title).includes(sameKey.name(name))) return null;
  return { url: got.url, day, what: `${new URL(url).hostname.replace(/^www\./, "")} has a page at this address titled “${title.slice(0, 80)}”.` };
}

/* ---------- the weekly check, and one row now -------------------------------------------------- */

const put = () => db.prepare("UPDATE cc_seo_profiles SET state = ?, state_why = ?, checked_at = ?, http = ?, nap = ? WHERE key = ?");

/** Write what one ask found. A page that could not be read keeps the name, address and phone the last reading gave. */
function keep(r: ProfileDb, a: Asked): void {
  /*
   * A wall, a refusal or no answer says nothing about the profile itself: a
   * profile last read as existing (or as gone) keeps that state, with the
   * reason this read failed beside it, instead of turning "unknown".
   */
  const known = a.state === "unknown" && (r.state === "exists" || r.state === "not-found");
  const state = known ? r.state : a.state;
  const why = known ? `Kept from the last good read: this time it could not be read. ${a.why}` : a.why;
  put().run(state, why, now(), a.http, a.nap === undefined ? r.nap : a.nap ? JSON.stringify(a.nap) : null, r.key);
}

/** Ask one profile's address now. Throws `Said` when there is nothing to ask. */
export async function checkOne(key: string): Promise<{ row: ProfileRow; line: string }> {
  const r = db.prepare("SELECT * FROM cc_seo_profiles WHERE key = ?").get(key) as ProfileDb | undefined;
  if (!r) throw new Said(`There is no profile ${key}.`);
  if (!r.url) throw new Said(`${r.name} has no address to ask: give it one first.`);
  const a = await ask(r);
  keep(r, a);
  /* A read that failed leaves a known state in place (keep), so it is no change to report. */
  if (a.state !== r.state && a.state !== "unknown") note("seo-presence", `${r.name}: ${r.state} → ${a.state}`, { tone: "info", detail: a.why, href: "/seo/backlinks", dedupe: `seo:presence:one:${key}:${now()}` });
  const word: Record<ProfileState, string> = { exists: "exists", "not-found": "was not found", unknown: "could not be read", "not-checked": "was not checked" };
  return { row: profile(key)!, line: `${r.name} ${word[a.state]}. ${a.why}` };
}

/**
 * Ask every profile with an address, one at a time, three seconds apart (no
 * two of them share a host often enough to need more); then look for the few
 * rows without an address that have somewhere to look.
 */
export async function checkProfiles(progress: (done: number, of: number, what?: string) => void = () => {}): Promise<string> {
  const all = db.prepare("SELECT * FROM cc_seo_profiles ORDER BY sort").all() as unknown as ProfileDb[];
  const rows = all.filter((r) => r.url);
  const name = studioName();
  const seek = name ? all.filter((r) => !r.url && (r.key === "wikidata" || PROBE[r.key])) : [];
  if (!rows.length && !seek.length) return "No profile has an address to check yet.";
  const of = rows.length + seek.length;
  const tally: Record<ProfileState, number> = { exists: 0, "not-found": 0, unknown: 0, "not-checked": 0 };
  const changed: string[] = [];
  let asked = 0;
  for (const r of rows) {
    if (asked) await wire.sleep(3000);
    progress(asked++, of, r.name);
    const a = await ask(r);
    if (a.state !== r.state) changed.push(`${r.name}: ${r.state} → ${a.state}`);
    tally[a.state]++;
    keep(r, a);
  }
  let found = 0;
  for (const r of seek) {
    if (asked) await wire.sleep(3000);
    progress(asked++, of, `Looking for ${r.name}`);
    const had = foundOf(r.key);
    const f = await find(r, name!).catch(() => null);
    if (f) {
      setState(`${FOUND}${r.key}`, JSON.stringify(f));
      if (had?.url !== f.url) {
        found++;
        note("seo-presence", `Found what may be the studio's ${r.name} entry`, { tone: "info", detail: `${f.what} Say on Backlinks whether it is the studio's.`, href: "/seo/backlinks", dedupe: `seo:presence:found:${r.key}:${f.url}` });
      }
    }
  }
  progress(of, of);
  if (changed.length) {
    note("seo-presence", `${changed.length} profile${changed.length === 1 ? "" : "s"} changed state`, { tone: "info", detail: changed.slice(0, 4).join("; "), href: "/seo/backlinks", dedupe: `seo:presence:${now()}` });
  }
  return `${rows.length} profiles checked: ${tally.exists} exist, ${tally["not-found"]} not found, ${tally.unknown} could not be read${seek.length ? `; looked for ${seek.length} without an address${found ? `, found ${found} to confirm` : ""}` : ""}`;
}

/* ---------- name, address, phone side by side ------------------------------------------- */

export const NAP_FIELDS: NapField[] = ["name", "address", "phone"];

/**
 * THE ONE RULE for "the same value", used by every screen that counts
 * versions of the name, address or phone. Two values are one when they differ
 * only in capitals, spaces, punctuation or word order ("Musterweg 1, Zürich
 * 8000" and "Musterweg 1, 8000 Zürich"); "strasse" and "str." are one; a
 * phone is its digits, +41 and 0041 read as 0.
 */
export const sameKey: Record<NapField, (s: string) => string> = {
  name: (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""),
  address: (s) =>
    s
      .toLowerCase()
      .replace(/strasse\b/g, "str")
      .replace(/str\./g, "str")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .sort()
      .join(" "),
  phone: (s) => {
    const d = s.replace(/[^\d+]/g, "");
    return d.startsWith("+41") ? `0${d.slice(3)}` : d.startsWith("0041") ? `0${d.slice(4)}` : d;
  },
};

export const NAP_RULE =
  "Two values are the same when they differ only in capitals, spaces, punctuation or word order, or in “strasse” written “str.”; a phone is compared by its digits, with +41 read as 0. A different spelling is a different value: that is what a search engine sees.";

export interface Stated {
  value: string;
  /** Read from the profile itself by the check; else seen there by a person. */
  read: boolean;
  day: string;
  /** Who saw it, when it was not read: "audit" or a person's name. */
  by: string | null;
}

/**
 * A field as a profile states it: what the check read from the profile when
 * it could, else what a person saw there. What somebody on the desk entered
 * after the last reading is newer than that reading and is shown instead.
 */
export function statedOf(p: ProfileRow, field: NapField): Stated | null {
  const read = p.nap?.[field];
  const readDay = p.nap?.day ?? p.checkedAt?.slice(0, 10) ?? null;
  const seen = p.napSeen?.[field];
  const newer = !!seen && byPerson(p.napSeen) && !!readDay && p.napSeen!.day > readDay;
  if (read && readDay && !newer) return { value: read, read: true, day: readDay, by: null };
  if (seen && p.napSeen) return { value: seen, read: false, day: p.napSeen.day, by: p.napSeen.by ?? "audit" };
  return null;
}

/** Who a value that was not read is from, in words. */
export const seenBy = (by: string | null): string => (by && by !== "audit" ? `as ${by} entered it` : "as the audit saw it");

/** Each field as each profile states it: read by the check when it could, else as a person saw it, with its day. */
export function napMatrix(): NapMatrix {
  const all = profiles();
  const fields: NapMatrix["fields"] = NAP_FIELDS.map((field) => {
    const values: { source: string; value: string; day: string }[] = [];
    for (const p of all) {
      const s = statedOf(p, field);
      if (s) values.push({ source: s.read ? p.name : `${p.name} (${seenBy(s.by)})`, value: s.value, day: s.day });
    }
    const distinct = new Set(values.map((v) => sameKey[field](v.value))).size;
    return { field, values, consistent: distinct <= 1, distinct };
  });
  return { fields, consistent: fields.every((f) => f.consistent) };
}

/* ---------- the one true name, address and phone ------------------------------------------------ */

const TRUTH = "seo:nap:truth";

/** The name, address and phone the owner agreed on, or null until he has recorded them. */
export function napTruth(): NapTruth | null {
  const t = json<NapTruth | null>(state(TRUTH), null);
  return t && (t.name || t.address || t.phone) ? t : null;
}

/** The owner records the decision. A field left empty stays open; all three empty takes the decision back. */
export function setNapTruth(v: { name?: unknown; address?: unknown; phone?: unknown }, by: string): NapTruth | null {
  const next = { name: tidy(v.name, 120, "The name"), address: tidy(v.address, 200, "The address"), phone: tidy(v.phone, 40, "The phone") };
  if (!next.name && !next.address && !next.phone) {
    forget(TRUTH);
    note("seo-presence", "Took back the agreed name, address and phone", { tone: "info", actor: by, href: "/seo/backlinks", dedupe: `seo:nap:${now()}` });
    return null;
  }
  const truth: NapTruth = { ...next, by, at: now() };
  setState(TRUTH, JSON.stringify(truth));
  note("seo-presence", "Recorded the one true name, address and phone", { tone: "good", actor: by, detail: [next.name, next.address, next.phone].filter(Boolean).join(" · "), href: "/seo/backlinks", dedupe: `seo:nap:${truth.at}` });
  return truth;
}

/** Whether a stated value is the agreed one: true, false, or null when nothing is agreed for the field. */
export function matches(field: NapField, value: string, truth: NapTruth | null = napTruth()): boolean | null {
  const t = truth?.[field];
  return t ? sameKey[field](value) === sameKey[field](t) : null;
}
