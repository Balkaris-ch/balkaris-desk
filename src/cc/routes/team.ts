import { Hono, type Context } from "hono";
import { db } from "../../db.ts";
import { DOMAIN } from "../../google.ts";
import {
  AREAS,
  PRESETS,
  accessOf,
  areaOf,
  clean,
  fullGrants,
  levelsOf,
  newcomers,
  pageLabel,
  pageLevel,
  pageOfHref,
  roleOf,
  seesAnything,
  setNewcomers,
  type Grants,
  type Level,
} from "../../grants.ts";
import { byEmail, everyone, getPerson, invite, OWNER_EMAIL, setGrants, setSeesLeads, withdraw, type Person } from "../../people.ts";
import { beat, flushAll, now as presenceOf, zurichDay } from "../../presence.ts";
import { me, requireOwner, type Vars } from "../access.ts";
import { status } from "../scheduler.ts";
import { note, ok, reading, waiting } from "../store.ts";
import type { ApiError, DayPoint, Reading, Stat } from "../../../web/src/contract/common.ts";
import type {
  AccessGrantAnswer,
  AccessGrantChange,
  AccessPerson,
  InviteAnswer,
  InviteChange,
  Invitation,
  MemberStatus,
  TeamAccess,
  TeamActivity,
  TeamBeat,
  TeamDeploy,
  TeamEvent,
  TeamInvitations,
  TeamMember,
  TeamMembers,
  TeamPersonActivity,
  TeamRange,
  TeamSettingsAnswer,
  TeamSettingsChange,
} from "../../../web/src/contract/team.ts";

/**
 * /api/v1/team: who works the desk, what each may see, who is invited, and
 * what they do on it. The contract is web/src/contract/team.ts; the model is
 * src/grants.ts; the record is src/presence.ts.
 *
 * Members is for everybody the owner gave Team to. Everything else here is
 * the owner's alone (Fini, of the engine's: "I should be the only
 * one that can control this part, the rest of the team do not see it"), by
 * requireOwner on the route AND by the gate, whose Team pages are owner-only
 * whatever anybody's grants say. Hiding a page is courtesy; this is the rule.
 *
 * Every change is checked before anything is written and written through
 * src/people.ts. It is said in the owner's record of the team (Activity), not
 * in the desk's feed, which everybody reads: who may see what is the owner's
 * business. The one exception is the enquiry right, announced in the feed
 * exactly as Settings › People announces it.
 */

export const routes = new Hono<Vars>();

/** SQLite's datetime('now') is UTC without saying so. */
const isoOf = (sqlite: string): string => (sqlite.includes("T") ? sqlite : `${sqlite.replace(" ", "T")}Z`);
const refuse = (c: Context<Vars>, status: 400 | 404 | 409, error: string) => c.json<ApiError>({ error }, status);

/* ---------- what the desk knows about each person ------------------------------ */

/** First and last Google sign-in per address, from the desk's own log. */
function signIns(): Map<string, { first: string; last: string }> {
  const out = new Map<string, { first: string; last: string }>();
  try {
    const rows = db
      .prepare(
        "SELECT lower(json_extract(detail, '$.email')) AS email, MIN(at) AS first, MAX(at) AS last FROM events WHERE what = 'auth.in' AND json_valid(detail) GROUP BY 1",
      )
      .all() as { email: string | null; first: string; last: string }[];
    for (const r of rows) if (r.email) out.set(r.email, { first: isoOf(r.first), last: isoOf(r.last) });
  } catch {
    /* A log the database cannot read is no sign-ins known, never a guessed one. */
  }
  return out;
}

/** The latest day row per person: the last request the desk wrote down, and the page they were on. */
function lastDays(): Map<number, { last: string; page: string | null }> {
  const out = new Map<number, { last: string; page: string | null }>();
  const rows = db.prepare("SELECT person, last, page FROM team_days ORDER BY day").all() as { person: number; last: string; page: string | null }[];
  for (const r of rows) out.set(r.person, { last: r.last, page: r.page ?? out.get(r.person)?.page ?? null });
  return out;
}

const hrefOf = (page: string): string => (page === "overview" ? "/" : `/${page}`);
const placeOf = (page: string | null): { label: string; href: string } | null => (page ? { label: pageLabel(page), href: hrefOf(page) } : null);

/* What anybody but the owner could ever be given: the owner's own pages are nobody else's to count. */
const SHARED_PAGES = AREAS.flatMap((a) => a.pages.filter((p) => !p.ownerOnly).map((p) => p.key));

interface Known {
  signIn: Map<string, { first: string; last: string }>;
  days: Map<number, { last: string; page: string | null }>;
}

const known = (): Known => {
  flushAll();
  return { signIn: signIns(), days: lastDays() };
};

/** Has this person ever been on the desk: a Google sign-in, or a request written down. */
const everIn = (p: Person, k: Known): boolean => (!!p.email && k.signIn.has(p.email.toLowerCase())) || k.days.has(p.telegram);

function lastActive(p: Person, k: Known): string | null {
  const live = presenceOf(p.telegram);
  return (
    [live.last ? new Date(live.last).toISOString() : undefined, k.days.get(p.telegram)?.last, p.email ? k.signIn.get(p.email.toLowerCase())?.last : undefined]
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null
  );
}

/* Waiting before online: somebody signed in with nothing to open is the owner's next thing to do, wherever they are. */
function statusOf(p: Person, k: Known): MemberStatus {
  if (p.revoked) return "off";
  if (!p.owner && p.grants && !seesAnything(p)) return "waiting";
  if (presenceOf(p.telegram).online) return "online";
  const been = everIn(p, k);
  if (!been && p.invitedAt) return "invited";
  if (!been && p.telegram > 0) return "bot";
  return "away";
}

function member(p: Person, looking: Person, k: Known): TeamMember {
  const a = accessOf(p);
  const owner = looking.owner;
  const live = presenceOf(p.telegram);
  return {
    id: p.telegram,
    name: p.name,
    email: p.email,
    owner: p.owner,
    you: p.telegram === looking.telegram,
    role: roleOf(p),
    /* Whether somebody is online, and when they were last here, is the owner's to know, not the team's. */
    status: owner ? statusOf(p, k) : p.revoked ? "off" : !everIn(p, k) && p.invitedAt ? "invited" : !everIn(p, k) && p.telegram > 0 ? "bot" : "away",
    lastActive: owner ? lastActive(p, k) : null,
    place: owner ? placeOf(live.page ?? k.days.get(p.telegram)?.page ?? null) : null,
    pages: { open: SHARED_PAGES.filter((k) => a.pages[k] !== "none").length, of: SHARED_PAGES.length },
    canPublish: p.canPublish,
    seesLeads: p.seesLeads,
    invitedAt: p.invitedAt ? isoOf(p.invitedAt) : null,
  };
}

const ROLE_ORDER = ["owner", ...PRESETS.map((p) => p.key), "custom", "waiting"];

routes.get("/members", (c) => {
  const looking = me(c);
  const k = known();
  const list = everyone().map((p) => member(p, looking, k));
  const rank = (m: TeamMember) => (m.owner ? 0 : m.status === "online" ? 1 : m.status === "away" ? 2 : m.status === "waiting" ? 3 : m.status === "invited" ? 4 : m.status === "bot" ? 5 : 6);
  list.sort((a, b) => rank(a) - rank(b) || (b.lastActive ?? "").localeCompare(a.lastActive ?? "") || a.name.localeCompare(b.name));
  const counts = new Map<string, { key: string; label: string; count: number }>();
  for (const m of list) {
    if (m.status === "bot") continue;
    const had = counts.get(m.role.key) ?? { ...m.role, count: 0 };
    had.count++;
    counts.set(m.role.key, had);
  }
  return c.json<TeamMembers>({
    members: list,
    counts: {
      total: list.filter((m) => m.status !== "bot").length,
      online: looking.owner ? list.filter((m) => m.status === "online").length : 0,
      invited: list.filter((m) => m.status === "invited").length,
      waiting: looking.owner ? list.filter((m) => m.status === "waiting").length : 0,
      off: list.filter((m) => m.status === "off").length,
    },
    roles: [...counts.values()].sort((a, b) => ROLE_ORDER.indexOf(a.key) - ROLE_ORDER.indexOf(b.key)),
    canEdit: looking.owner,
  });
});

/* ---------- access ---------------------------------------------------------------- */

function accessPerson(p: Person, k: Known): AccessPerson {
  const a = accessOf(p);
  const stored = db.prepare("SELECT sees_leads FROM people WHERE telegram = ?").get(p.telegram) as { sees_leads: number } | undefined;
  return {
    id: p.telegram,
    name: p.name,
    email: p.email,
    role: roleOf(p),
    restricted: !!p.grants,
    areas: a.areas,
    pages: a.pages,
    overridden: Object.keys(p.grants ?? {})
      .filter((x) => x.startsWith("page:"))
      .map((x) => x.slice(5)),
    leadsGranted: !!stored?.sees_leads,
    seesLeads: p.seesLeads,
    canPublish: p.canPublish,
    revoked: p.revoked,
    invited: !!p.invitedAt && !everIn(p, k),
    never: !everIn(p, k),
  };
}

routes.get("/access", requireOwner, (c) => {
  const k = known();
  const people = everyone().filter((p) => !p.owner && (p.email || p.telegram < 0));
  const owner = everyone().find((p) => p.owner);
  return c.json<TeamAccess>({
    areas: AREAS.map((a) => ({
      key: a.key,
      label: a.label,
      about: a.about,
      levels: [...levelsOf(a)],
      sensitive: !!a.sensitive,
      pages: a.pages.length > 1 ? a.pages.map((p) => ({ key: p.key, label: p.label, ownerOnly: !!p.ownerOnly })) : [],
    })),
    presets: PRESETS.map((p) => ({
      key: p.key,
      label: p.label,
      about: p.about,
      grants: p.grants === null ? null : clean(p.grants),
      count: people.filter((x) => !x.revoked && roleOf(x).key === p.key).length,
    })),
    people: people.map((p) => accessPerson(p, k)),
    newcomers: newcomers(),
    owner: { name: owner?.name ?? null, email: OWNER_EMAIL },
    domain: DOMAIN,
  });
});

/** The person a change is about, by the id in the address, or null. */
function target(raw: string): Person | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id !== 0 ? getPerson(id) : null;
}

const isLevel = (v: unknown): v is Level => v === "none" || v === "view" || v === "edit";

/** What the grants say, in a sentence: "Insights (edit), SEO (view) and 3 more". */
function inWords(g: Grants | null): string {
  if (g === null) return "every area";
  const parts = AREAS.filter((a) => g[a.key]).map((a) => `${a.label} (${g[a.key]})`);
  if (!parts.length) return "nothing yet";
  return parts.length > 4 ? `${parts.slice(0, 4).join(", ")} and ${parts.length - 4} more` : parts.join(", ");
}

routes.post("/access/:id", requireOwner, async (c) => {
  const who = me(c);
  const p = target(c.req.param("id"));
  if (!p) return refuse(c, 404, "The desk does not know that person.");
  if (p.owner) return refuse(c, 409, "The owner is never restricted: grants never apply to the owner, so there is nothing to set.");
  const body = (await c.req.json().catch(() => null)) as AccessGrantChange | null;
  if (!body || typeof body !== "object") return refuse(c, 400, "Send the change as JSON.");

  /* ---- check everything first ---- */
  const ways = [body.preset !== undefined, body.set !== undefined, body.grants !== undefined].filter(Boolean).length;
  if (ways > 1) return refuse(c, 400, 'Send one of "preset", "set" or "grants", not several.');
  if (body.seesLeads !== undefined && typeof body.seesLeads !== "boolean") return refuse(c, 400, 'Send "seesLeads" as true or false.');
  if (!ways && body.seesLeads === undefined) return refuse(c, 400, "Nothing to change was sent.");

  let next: Grants | null | undefined;
  let label = "";
  if (body.preset !== undefined) {
    const preset = PRESETS.find((x) => x.key === body.preset);
    if (!preset) return refuse(c, 400, `There is no template called "${String(body.preset).slice(0, 40)}".`);
    next = preset.grants === null ? null : clean(preset.grants);
    label = preset.label;
  } else if (body.set !== undefined) {
    if (!body.set || typeof body.set !== "object" || Array.isArray(body.set)) return refuse(c, 400, '"set" is an object of area or page keys to levels.');
    /* One cell at a time: somebody with no row first gets the row they implicitly had, so nothing else moves. */
    const cur: Record<string, string> = { ...(p.grants ?? fullGrants()) };
    for (const [key, v] of Object.entries(body.set)) {
      const isPageKey = key.startsWith("page:");
      const area = isPageKey ? null : areaOf(key);
      if (!isPageKey && !area) return refuse(c, 400, `There is no area called "${key.slice(0, 40)}".`);
      if (v === "" && isPageKey) {
        delete cur[key];
        continue;
      }
      if (!isLevel(v)) return refuse(c, 400, `"${String(v).slice(0, 20)}" is not a level: none, view or edit.`);
      if (area && !levelsOf(area).includes(v)) return refuse(c, 400, `${area.label} offers ${levelsOf(area).join(" or ")}.`);
      cur[key] = v;
    }
    next = clean(cur);
    const all = fullGrants();
    /* Everything, written out, is the same as no row: store it as no row, so "Administrator" reads true. */
    if (AREAS.every((a) => next![a.key] === all[a.key]) && !Object.keys(next).some((x) => x.startsWith("page:"))) next = null;
  } else if (body.grants !== undefined) {
    if (body.grants !== null && (typeof body.grants !== "object" || Array.isArray(body.grants))) return refuse(c, 400, '"grants" is an object, or null for every area.');
    next = body.grants === null ? null : clean(body.grants);
  }

  /* ---- then write ---- */
  const said: string[] = [];
  if (next !== undefined) {
    setGrants(p.telegram, next);
    const now = getPerson(p.telegram) ?? p;
    const role = roleOf(now);
    said.push(label ? `${p.name} now has the ${label} template: ${inWords(next)}.` : `${p.name} now has ${inWords(next)}.`);
    /* For the owner's record only: who may see what is not news for the whole desk's feed. */
    c.set("did", {
      text: label ? `Gave ${p.name} the ${label} template: ${inWords(next)}` : `Changed ${p.name}'s access (${role.label}): ${inWords(next)}`,
      href: `/team/access?person=${p.telegram}`,
    });
  }
  if (body.seesLeads !== undefined) {
    const stored = db.prepare("SELECT sees_leads FROM people WHERE telegram = ?").get(p.telegram) as { sees_leads: number } | undefined;
    if (!!stored?.sees_leads !== body.seesLeads) {
      setSeesLeads(p.telegram, body.seesLeads);
      said.push(body.seesLeads ? "They may see enquiries' names, contact details and messages." : "They no longer see enquiries' contents.");
      note("people", body.seesLeads ? `${p.name} may now see enquiries` : `${p.name} no longer sees enquiries`, {
        actor: who.name,
        href: "/team/access",
        tone: body.seesLeads ? "warn" : "info",
      });
    }
  }

  const now = getPerson(p.telegram) ?? p;
  if (body.seesLeads && !now.seesLeads && !now.revoked) said.push("It takes effect once they also have Leads.");
  return c.json<AccessGrantAnswer>({ ok: true, person: accessPerson(now, known()), said: said.join(" ") || "Nothing had changed." });
});

routes.post("/settings", requireOwner, async (c) => {
  const who = me(c);
  const body = (await c.req.json().catch(() => null)) as TeamSettingsChange | null;
  const v = String(body?.newcomers ?? "");
  if (v !== "full" && v !== "nothing" && !PRESETS.some((p) => p.key === v)) return refuse(c, 400, 'Choose "full", "nothing" or a template.');
  if (v === newcomers()) return c.json<TeamSettingsAnswer>({ ok: true, newcomers: v, said: "Nothing had changed." });
  setNewcomers(v);
  const words = v === "full" ? "every area, as before" : v === "nothing" ? "nothing until you give them access" : `the ${PRESETS.find((p) => p.key === v)!.label} template`;
  c.set("did", { text: `Set what a newcomer starts with: ${words}`, href: "/team/access" });
  return c.json<TeamSettingsAnswer>({ ok: true, newcomers: v, said: `From now on, somebody who signs in uninvited starts with ${words}. People already on the desk keep what they have.` });
});

/* ---------- invitations ------------------------------------------------------------ */

const deskUrl = (): string => (process.env.DESK_URL ?? "https://desk.balkaris.ch").replace(/\/$/, "");

function invitation(p: Person, k: Known): Invitation {
  const firstIn = p.email ? k.signIn.get(p.email.toLowerCase())?.first : undefined;
  const by = (db.prepare("SELECT invited_by FROM people WHERE telegram = ?").get(p.telegram) as { invited_by: string | null } | undefined)?.invited_by ?? null;
  const at = isoOf(p.invitedAt!);
  return {
    id: p.telegram,
    name: p.name,
    email: p.email ?? "",
    role: roleOf(p),
    invitedAt: at,
    invitedBy: by,
    /* A sign-in before the invitation was somebody else's row under the same address: not this invitation used. */
    joinedAt: firstIn && firstIn >= at ? firstIn : (k.days.has(p.telegram) ? k.days.get(p.telegram)!.last : null),
  };
}

routes.get("/invitations", requireOwner, (c) => {
  const k = known();
  const list = everyone()
    .filter((p) => p.invitedAt)
    .map((p) => invitation(p, k))
    .sort((a, b) => b.invitedAt.localeCompare(a.invitedAt));
  return c.json<TeamInvitations>({
    invitations: list,
    presets: PRESETS.map((p) => ({ key: p.key, label: p.label, about: p.about })),
    domain: DOMAIN,
    link: deskUrl(),
  });
});

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

routes.post("/invitations", requireOwner, async (c) => {
  const who = me(c);
  const body = (await c.req.json().catch(() => null)) as InviteChange | null;
  const name = String(body?.name ?? "").trim().replace(/\s+/g, " ");
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!name || name.length > 80) return refuse(c, 400, "Give their name, as the team list should show it.");
  if (!EMAIL.test(email) || email.length > 254) return refuse(c, 400, `"${email.slice(0, 80)}" is not an email address.`);
  if (email.split("@")[1] !== DOMAIN) {
    return refuse(c, 400, `Only @${DOMAIN} Google accounts can sign in to the desk, so an invitation for ${email} could never be used.`);
  }
  if (email === OWNER_EMAIL) return refuse(c, 409, "That is the owner's address.");
  const holder = byEmail(email);
  if (holder) {
    return refuse(c, 409, `${holder.name} is already on the team as ${email}. Change their access under Access & Roles instead.`);
  }
  const preset = PRESETS.find((p) => p.key === body?.preset);
  if (!preset) return refuse(c, 400, "Choose what they get: one of the templates.");

  let p: Person;
  try {
    p = invite(email, name, preset.grants === null ? null : clean(preset.grants), who.email ?? who.name);
  } catch (e) {
    return refuse(c, 409, `The invitation could not be made: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
  }
  c.set("did", { text: `Invited ${name} (${email}) as ${preset.label}`, href: "/team/invitations" });
  return c.json<InviteAnswer>({
    ok: true,
    said: `${name} is on the team as ${preset.label}. Send them ${deskUrl()}: they sign in with Google as ${email}, and the desk finds them.`,
    invitation: invitation(p, known()),
  });
});

routes.post("/invitations/:id/withdraw", requireOwner, (c) => {
  const who = me(c);
  const p = target(c.req.param("id"));
  if (!p || !p.invitedAt) return refuse(c, 404, "There is no such invitation.");
  if (everIn(p, known())) {
    return refuse(c, 409, `${p.name} has already signed in, so this is a person now, not an invitation. Switch them off in Settings › People instead.`);
  }
  withdraw(p.telegram);
  c.set("did", { text: `Withdrew the invitation for ${p.name}${p.email ? ` (${p.email})` : ""}`, href: "/team/invitations" });
  return c.json<InviteAnswer>({ ok: true, said: `The invitation for ${p.name} is withdrawn: if they sign in now, they arrive as a newcomer.`, invitation: null });
});

/* ---------- the page's beat ------------------------------------------------------- */

routes.post("/beat", async (c) => {
  const body = (await c.req.json().catch(() => null)) as TeamBeat | null;
  const href = typeof body?.href === "string" && body.href.startsWith("/") ? body.href.slice(0, 300) : "";
  if (!href) return refuse(c, 400, "Send the address of the page.");
  /* A page the gate refused them is not a page they are on: they see a refusal, and its minutes are nobody's. */
  const page = pageOfHref(href);
  const theirs = !page || pageLevel(me(c), page.key) !== "none";
  beat(me(c).telegram, theirs ? href : null, theirs && body?.kind === "beat" ? "beat" : "open");
  return c.json({ ok: true as const });
});

/* ---------- activity --------------------------------------------------------------- */

const RANGES: Record<TeamRange, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, "90d": 90 * 86_400_000 };

const TYPE_LABEL: Record<string, string> = { signin: "Sign-ins", shared: "Shared links", deploy: "Deployments", refresh: "Refreshes", other: "Other" };
const typeLabel = (key: string): string => TYPE_LABEL[key] ?? areaOf(key)?.label ?? key;

/** Areas whose changes are content: what is written and published. */
const CONTENT = new Set(["insights", "content"]);

interface Window {
  from: number;
  to: number;
}

/** Everything people did in a window, oldest unsorted: the desk's actions, sign-ins, shared links and deployments by a team member. */
function eventsIn(w: Window, people: Person[]): TeamEvent[] {
  const byId = new Map(people.map((p) => [p.telegram, p]));
  const byMail = new Map(people.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]));
  const byName = new Map(people.map((p) => [p.name.toLowerCase(), p]));
  const fromIso = new Date(w.from).toISOString();
  const toIso = new Date(w.to).toISOString();
  const fromSql = fromIso.slice(0, 19).replace("T", " ");
  const toSql = toIso.slice(0, 19).replace("T", " ");
  const out: TeamEvent[] = [];

  const actions = db.prepare("SELECT id, at, person, area, text, href, path FROM team_actions WHERE at >= ? AND at < ?").all(fromIso, toIso) as {
    id: number;
    at: string;
    person: number;
    area: string | null;
    text: string;
    href: string | null;
    path: string;
  }[];
  /* A refresh is recorded by the job's name; it is read by its title, as Automations shows it. */
  const titles = new Map(status().map((j) => [j.name, j.title]));
  for (const a of actions) {
    const p = byId.get(a.person);
    if (!p) continue;
    const type = a.area ?? "other";
    const job = /^\/api\/v1\/jobs\/([^/]+)\/(run|enabled)$/.exec(a.path);
    const text = job?.[2] === "run" && titles.has(job[1]) ? `Ran “${titles.get(job[1])}” ahead of its schedule` : a.text;
    out.push({ id: `a${a.id}`, at: a.at, who: { id: p.telegram, name: p.name }, kind: "action", type, typeLabel: typeLabel(type), text, ...(a.href ? { href: a.href } : {}) });
  }

  try {
    const ins = db
      .prepare("SELECT id, at, lower(json_extract(detail, '$.email')) AS email FROM events WHERE what = 'auth.in' AND json_valid(detail) AND at >= ? AND at < ?")
      .all(fromSql, toSql) as { id: number; at: string; email: string | null }[];
    for (const e of ins) {
      const p = e.email ? byMail.get(e.email) : undefined;
      if (!p) continue;
      out.push({ id: `s${e.id}`, at: isoOf(e.at), who: { id: p.telegram, name: p.name }, kind: "signin", type: "signin", typeLabel: TYPE_LABEL.signin, text: "Signed in with Google" });
    }
  } catch {
    /* no log, no sign-ins */
  }

  const links = db
    .prepare("SELECT id, url, title, site, platform, from_user, created_at FROM links WHERE from_user IS NOT NULL AND created_at >= ? AND created_at < ?")
    .all(fromSql, toSql) as { id: number; url: string; title: string | null; site: string | null; platform: string | null; from_user: number; created_at: string }[];
  for (const l of links) {
    const p = byId.get(l.from_user);
    if (!p) continue;
    out.push({
      id: `l${l.id}`,
      at: isoOf(l.created_at),
      who: { id: p.telegram, name: p.name },
      kind: "shared",
      type: "shared",
      typeLabel: TYPE_LABEL.shared,
      text: `Shared “${(l.title ?? l.url).slice(0, 120)}” with the bot`,
      ...(l.site || l.platform ? { detail: `From ${l.site ?? l.platform}` } : {}),
      href: `/insights/link/${l.id}`,
    });
  }

  try {
    const commits = db.prepare("SELECT sha, at, author, subject FROM cc_commits WHERE at >= ? AND at < ?").all(fromIso, toIso) as { sha: string; at: string; author: string; subject: string }[];
    for (const k of commits) {
      const p = byName.get(k.author.toLowerCase());
      if (!p) continue;
      out.push({
        id: `d${k.sha}`,
        at: k.at,
        who: { id: p.telegram, name: p.name },
        kind: "deploy",
        type: "deploy",
        typeLabel: TYPE_LABEL.deploy,
        text: `Deployed ${k.sha.slice(0, 7)} to the website`,
        detail: k.subject.slice(0, 140),
      });
    }
  } catch {
    /* the website's history is not read on this desk */
  }
  return out;
}

/** Counted as an action: everything but a sign-in, which is arriving, not doing. */
const isAction = (e: TeamEvent): boolean => e.kind !== "signin";

/** Buckets for a tile's bars: hours for a day, days otherwise. */
function buckets(w: Window, range: TeamRange): number[] {
  const step = range === "24h" ? 3_600_000 : 86_400_000;
  const n = Math.round((w.to - w.from) / step);
  return Array.from({ length: n }, (_, i) => w.from + i * step);
}

function statOf(now: TeamEvent[], before: TeamEvent[], w: Window, range: TeamRange, sub: string): Stat {
  const starts = buckets(w, range);
  const step = range === "24h" ? 3_600_000 : 86_400_000;
  const series = starts.map((s) => now.filter((e) => Date.parse(e.at) >= s && Date.parse(e.at) < s + step).length);
  return { value: now.length, previous: before.length, unit: "count", series, sub };
}

/** Since when the desk has kept activity: the first day row or action. */
function keptSince(): string | null {
  const d = (db.prepare("SELECT MIN(day) AS d FROM team_days").get() as { d: string | null }).d;
  const a = (db.prepare("SELECT MIN(at) AS a FROM team_actions").get() as { a: string | null }).a;
  const list = [d ? `${d}T00:00:00.000Z` : null, a].filter((x): x is string => !!x).sort();
  return list[0] ?? null;
}

function personActivity(p: Person, w: Window, range: TeamRange, events: TeamEvent[], k: Known): TeamPersonActivity {
  const fromDay = zurichDay(w.from);
  const rows = db.prepare("SELECT day, minutes, pages, last FROM team_days WHERE person = ? AND day >= ? ORDER BY day").all(p.telegram, fromDay) as {
    day: string;
    minutes: number;
    pages: string;
    last: string;
  }[];
  const pages = new Map<string, { opens: number; minutes: number }>();
  let opens = 0;
  for (const r of rows) {
    let per: Record<string, { opens?: number; minutes?: number }> = {};
    try {
      per = JSON.parse(r.pages);
    } catch {
      per = {};
    }
    for (const [key, v] of Object.entries(per)) {
      const had = pages.get(key) ?? { opens: 0, minutes: 0 };
      had.opens += Number(v.opens) || 0;
      had.minutes += Number(v.minutes) || 0;
      opens += Number(v.opens) || 0;
      pages.set(key, had);
    }
  }
  const days: DayPoint[] = [];
  const n = range === "24h" ? 1 : Math.round((w.to - w.from) / 86_400_000);
  for (let i = n - 1; i >= 0; i--) {
    const day = zurichDay(w.to - i * 86_400_000);
    days.push({ date: day, value: rows.find((r) => r.day === day)?.minutes ?? 0 });
  }
  const live = presenceOf(p.telegram);
  return {
    id: p.telegram,
    name: p.name,
    role: roleOf(p),
    online: live.online,
    lastActive: lastActive(p, k),
    place: placeOf(live.page ?? k.days.get(p.telegram)?.page ?? null),
    minutes: days,
    totalMinutes: rows.reduce((s, r) => s + r.minutes, 0),
    opens,
    daysActive: rows.filter((r) => r.minutes > 0 || r.pages !== "{}").length,
    actions: events.filter((e) => e.who.id === p.telegram && isAction(e)).length,
    pages: [...pages.entries()]
      .map(([key, v]) => ({ key, label: pageLabel(key), href: hrefOf(key), ...v }))
      .sort((a, b) => b.minutes * 3 + b.opens - (a.minutes * 3 + a.opens))
      .slice(0, 12),
  };
}

routes.get("/activity", requireOwner, async (c) => {
  const q = c.req.query("range") as TeamRange | undefined;
  const range: TeamRange = q && q in RANGES ? q : "7d";
  const len = RANGES[range];
  const at = Date.now();
  const w: Window = { from: at - len, to: at };
  const before: Window = { from: at - 2 * len, to: at - len };
  const k = known();
  const people = everyone();
  const team = people.filter((p) => !p.revoked && (everIn(p, k) || p.invitedAt));

  const all = eventsIn(w, people).sort((a, b) => b.at.localeCompare(a.at));
  const prev = eventsIn(before, people);
  const memberQ = Number(c.req.query("member"));
  const member = Number.isSafeInteger(memberQ) && memberQ !== 0 ? (people.find((p) => p.telegram === memberQ) ?? null) : null;
  const typeQ = String(c.req.query("type") ?? "");
  const types = [...new Map(all.map((e) => [e.type, { key: e.type, label: e.typeLabel }])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const type = types.some((t) => t.key === typeQ) ? typeQ : "";

  const mine = (e: TeamEvent) => !member || e.who.id === member.telegram;
  const shown = all.filter((e) => mine(e) && (!type || e.type === type));
  const acts = all.filter((e) => isAction(e) && mine(e));
  const actsBefore = prev.filter((e) => isAction(e) && mine(e));
  const content = (e: TeamEvent) => e.kind === "shared" || (e.kind === "action" && CONTENT.has(e.type));

  /* Minutes per person in the window, from the day rows. */
  const minutes = new Map<number, number>();
  for (const r of db.prepare("SELECT person, SUM(minutes) AS m FROM team_days WHERE day >= ? GROUP BY person").all(zurichDay(w.from)) as { person: number; m: number }[]) {
    minutes.set(r.person, r.m);
  }

  const online = team.filter((p) => presenceOf(p.telegram).online);
  const byMember = team
    .map((p) => ({ id: p.telegram, name: p.name, actions: all.filter((e) => e.who.id === p.telegram && isAction(e)).length, minutes: minutes.get(p.telegram) ?? 0 }))
    .filter((m) => m.actions || m.minutes)
    .sort((a, b) => b.actions - a.actions || b.minutes - a.minutes);

  const typeCounts = new Map<string, { key: string; label: string; value: number }>();
  for (const e of acts) {
    const had = typeCounts.get(e.type) ?? { key: e.type, label: e.typeLabel, value: 0 };
    had.value++;
    typeCounts.set(e.type, had);
  }

  const since = keptSince();
  const sub = range === "24h" ? "in the last 24 hours" : `in the last ${range.replace("d", " days")}`;

  const deployments = await reading<TeamDeploy[]>("repo", async () => {
    const { commitUrl } = await import("../site/repo.ts");
    const rows = db.prepare("SELECT sha, at, author, subject FROM cc_commits ORDER BY at DESC LIMIT 8").all() as { sha: string; at: string; author: string; subject: string }[];
    if (!rows.length) return waiting<TeamDeploy[]>("repo", "The desk has not read the website's history yet.");
    const names = new Map(people.map((p) => [p.name.toLowerCase(), p.name]));
    return ok(
      rows.map((r) => ({ sha: r.sha, subject: r.subject, at: r.at, author: r.author, member: names.get(r.author.toLowerCase()) ?? null, url: commitUrl(r.sha) })),
      "repo",
      Date.now(),
    );
  });

  const deployTile = await reading<Stat>("repo", () => {
    const count = (x: Window) => (db.prepare("SELECT COUNT(*) AS n, MIN(at) AS first FROM cc_commits WHERE at >= ? AND at < ?").get(new Date(x.from).toISOString(), new Date(x.to).toISOString()) as { n: number });
    const total = (db.prepare("SELECT COUNT(*) AS n FROM cc_commits").get() as { n: number }).n;
    if (!total) return waiting<Stat>("repo", "The desk has not read the website's history yet.");
    const rows = db.prepare("SELECT at FROM cc_commits WHERE at >= ?").all(new Date(w.from).toISOString()) as { at: string }[];
    const starts = buckets(w, range);
    const step = range === "24h" ? 3_600_000 : 86_400_000;
    return ok<Stat>(
      {
        value: count(w).n,
        previous: count(before).n,
        unit: "count",
        series: starts.map((s) => rows.filter((r) => Date.parse(r.at) >= s && Date.parse(r.at) < s + step).length),
        sub: "pushes to the website's main branch",
      },
      "repo",
      Date.now(),
    );
  });

  const kept: Reading<Stat> = since
    ? ok(statOf(acts, actsBefore, w, range, sub), "desk", at, Date.parse(since) > w.from ? `Kept since ${since.slice(0, 10)}: the period before it shows less than happened.` : undefined)
    : waiting("desk", "Nothing has been recorded yet. Every change the desk accepts from a person is kept from now on.");
  const contentStat: Reading<Stat> = since
    ? ok(statOf(acts.filter(content), actsBefore.filter(content), w, range, "insights, content and shared links"), "desk", at)
    : waiting("desk", "Nothing has been recorded yet.");

  return c.json<TeamActivity>({
    range,
    at: new Date(at).toISOString(),
    since,
    tiles: {
      activeNow: { value: online.length, of: team.length, people: online.map((p) => ({ id: p.telegram, name: p.name })) },
      actions: kept,
      content: contentStat,
      deployments: deployTile,
    },
    timeline: shown.slice(0, 200),
    now: online
      .map((p) => {
        const live = presenceOf(p.telegram);
        return { id: p.telegram, name: p.name, place: placeOf(live.page), last: new Date(live.last ?? at).toISOString() };
      })
      .sort((a, b) => b.last.localeCompare(a.last)),
    byMember,
    byType: [...typeCounts.values()].sort((a, b) => b.value - a.value),
    deployments,
    members: team.map((p) => ({ id: p.telegram, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
    types,
    person: member ? personActivity(member, w, range, all, k) : null,
  });
});
