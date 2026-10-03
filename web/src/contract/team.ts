import type { AccessLevel, DayPoint, Reading, Stat } from "./common";

/**
 * The Team section: who works the desk, what each may see, who has been
 * invited, and what they do on it.
 *
 *   GET  /api/v1/team/members                     TeamMembers       everybody with Team › Members
 *   GET  /api/v1/team/activity?range&member&type  TeamActivity      the owner
 *   GET  /api/v1/team/access                      TeamAccess        the owner
 *   POST /api/v1/team/access/:id                  AccessGrantChange → AccessGrantAnswer   the owner
 *   POST /api/v1/team/settings                    TeamSettingsChange → TeamSettingsAnswer the owner
 *   GET  /api/v1/team/invitations                 TeamInvitations   the owner
 *   POST /api/v1/team/invitations                 InviteChange      → InviteAnswer       the owner
 *   POST /api/v1/team/invitations/:id/withdraw    —                 → InviteAnswer       the owner
 *   POST /api/v1/team/beat                        TeamBeat          → { ok: true }       everybody signed in
 *
 * The model is src/grants.ts (areas, levels, templates), the record is
 * src/presence.ts (what people do). Types only.
 */

/** A template's key, "owner", "custom", or "waiting" (grants that open nothing). */
export interface TeamRole {
  key: string;
  label: string;
}

/**
 *   online   a request in the last three minutes
 *   away     has used the desk, not in the last three minutes
 *   invited  added by the owner, has not signed in yet
 *   waiting  signed in, and the owner has given them nothing yet
 *   off      switched off by the owner
 *   bot      known only from writing to the Telegram bot: cannot sign in to the desk
 *
 * Whether somebody is online, away or waiting is the owner's to know: anybody
 * else is told only invited, off and bot, and "away" for the rest.
 */
export type MemberStatus = "online" | "away" | "invited" | "waiting" | "off" | "bot";

export interface TeamMember {
  id: number;
  name: string;
  email: string | null;
  owner: boolean;
  you: boolean;
  role: TeamRole;
  status: MemberStatus;
  /** The owner's to know: null for everybody else, and for somebody never seen. */
  lastActive: string | null;
  /** Where they are or last were, as a page's name ("SEO › Keywords"), with its address. The owner's to know. */
  place: { label: string; href: string } | null;
  /** Pages they may open, of the pages anybody but the owner can be given. */
  pages: { open: number; of: number };
  canPublish: boolean;
  seesLeads: boolean;
  invitedAt: string | null;
}

export interface TeamMembers {
  members: TeamMember[];
  counts: { total: number; online: number; invited: number; waiting: number; off: number };
  /** How many people carry each role, in the templates' order, the owner first. */
  roles: (TeamRole & { count: number })[];
  /** The owner sees statuses, last activity and the Manage buttons. */
  canEdit: boolean;
}

/* ---------- access ------------------------------------------------------------ */

export interface AccessArea {
  key: string;
  label: string;
  about: string;
  /** The levels that mean something here: none and view only where nobody but the owner changes anything. */
  levels: AccessLevel[];
  sensitive: boolean;
  /** Its pages, when it has several (SEO, Team): each can be set on its own. */
  pages: { key: string; label: string; ownerOnly: boolean }[];
}

export interface AccessPreset {
  key: string;
  label: string;
  about: string;
  /** null: no restriction (every area). */
  grants: Record<string, AccessLevel> | null;
  /** People whose access is exactly this template now. */
  count: number;
}

export interface AccessPerson {
  id: number;
  name: string;
  email: string | null;
  role: TeamRole;
  /** False: no row, every area as before. */
  restricted: boolean;
  /** What each area IS for them now, row or no row, so every cell can be drawn as a choice. */
  areas: Record<string, AccessLevel>;
  /** And each page, overrides applied. */
  pages: Record<string, AccessLevel>;
  /** Pages whose level is set on its own rather than following its area. */
  overridden: string[];
  /** The enquiry right as stored; `seesLeads` is what it amounts to with their access. */
  leadsGranted: boolean;
  seesLeads: boolean;
  canPublish: boolean;
  revoked: boolean;
  invited: boolean;
  /** Has never signed in: an invitation, or a row from the Telegram bot. */
  never: boolean;
}

export interface TeamAccess {
  areas: AccessArea[];
  presets: AccessPreset[];
  /** Everybody but the owner: grants never apply to the owner. */
  people: AccessPerson[];
  /** What somebody who signs in uninvited starts with: "full", "nothing", or a template's key. */
  newcomers: string;
  owner: { name: string | null; email: string };
  domain: string;
}

/**
 * One change to one person's access. Exactly one of:
 *   preset   apply a template ("administrator" removes the row: every area)
 *   set      change cells: an area key or "page:<key>" to a level; "" removes a page's own level
 *   grants   replace the row; null removes it (every area)
 * and, with any of them or alone, `seesLeads` for the enquiry right.
 */
export interface AccessGrantChange {
  preset?: string;
  set?: Record<string, AccessLevel | "">;
  grants?: Record<string, AccessLevel> | null;
  seesLeads?: boolean;
}

export interface AccessGrantAnswer {
  ok: true;
  person: AccessPerson;
  said: string;
}

export interface TeamSettingsChange {
  newcomers: string;
}

export interface TeamSettingsAnswer {
  ok: true;
  newcomers: string;
  said: string;
}

/* ---------- invitations --------------------------------------------------------- */

export interface Invitation {
  id: number;
  name: string;
  email: string;
  role: TeamRole;
  invitedAt: string;
  invitedBy: string | null;
  /** When they first signed in, or null while the invitation is unused. */
  joinedAt: string | null;
}

export interface TeamInvitations {
  invitations: Invitation[];
  presets: { key: string; label: string; about: string }[];
  /** Only addresses of this domain can sign in. */
  domain: string;
  /** Where an invited person signs in: the address to send them. */
  link: string;
}

export interface InviteChange {
  name: string;
  email: string;
  /** A template's key. */
  preset: string;
}

export interface InviteAnswer {
  ok: true;
  said: string;
  invitation: Invitation | null;
}

/* ---------- activity ------------------------------------------------------------ */

export type TeamRange = "24h" | "7d" | "30d" | "90d";

/**
 *   action   a change the desk accepted from them
 *   signin   a Google sign-in
 *   shared   a link sent to the Telegram bot
 *   deploy   a commit to the website, by git author name
 */
export type TeamEventKind = "action" | "signin" | "shared" | "deploy";

export interface TeamEvent {
  id: string;
  at: string;
  who: { id: number; name: string };
  kind: TeamEventKind;
  /** The type it is counted under: an area's key, or "signin", "shared", "deploy". */
  type: string;
  typeLabel: string;
  text: string;
  detail?: string;
  href?: string;
}

export interface TeamNow {
  id: number;
  name: string;
  /** The page they are on, as far as the desk knows. */
  place: { label: string; href: string } | null;
  /** Their last request, ISO. */
  last: string;
}

export interface TeamDeploy {
  sha: string;
  subject: string;
  at: string;
  author: string;
  /** The team member the git author's name is, or null. */
  member: string | null;
  url: string | null;
}

/** One person, when the activity is filtered to them. */
export interface TeamPersonActivity {
  id: number;
  name: string;
  role: TeamRole;
  online: boolean;
  lastActive: string | null;
  place: { label: string; href: string } | null;
  /** Minutes of attention per day, oldest first. */
  minutes: DayPoint[];
  totalMinutes: number;
  opens: number;
  daysActive: number;
  actions: number;
  /** The pages they spent time on, most first. */
  pages: { key: string; label: string; href: string; opens: number; minutes: number }[];
}

export interface TeamActivity {
  range: TeamRange;
  at: string;
  /** Since when the desk has kept activity: nothing before it was recorded. */
  since: string | null;
  tiles: {
    activeNow: { value: number; of: number; people: { id: number; name: string }[] };
    actions: Reading<Stat>;
    content: Reading<Stat>;
    deployments: Reading<Stat>;
  };
  /** Newest first, filtered by member and type, at most 200. */
  timeline: TeamEvent[];
  now: TeamNow[];
  byMember: { id: number; name: string; actions: number; minutes: number }[];
  byType: { key: string; label: string; value: number }[];
  deployments: Reading<TeamDeploy[]>;
  members: { id: number; name: string }[];
  types: { key: string; label: string }[];
  person: TeamPersonActivity | null;
}

/** The page's beat (web/src/components/shell/Beat.tsx). */
export interface TeamBeat {
  /** The address in the browser: which page. */
  href: string;
  kind: "open" | "beat";
}
