import type { Me, Reading, SourceId, SourceStatus, Tone } from "./common";

/**
 * What GET /api/v1/settings answers: the whole Settings screen in one payload.
 *
 * Settings has no board. It is the desk's own facts: who works it, what each
 * source says about itself and what only the owner can do to connect it, how
 * signing in works, whether articles publish themselves, and the server the
 * desk runs on. Each part is its own Reading, so one part that cannot be read
 * costs that part and not the screen.
 *
 * NO SECRET TRAVELS HERE. A credential is described by whether it exists and
 * the step that places it on the server, never by its value, and nothing on
 * this screen accepts one: credentials are put on the box by the owner.
 *
 * Changes go to the POST routes beside it (owner only, checked on the server):
 *
 *   POST /api/v1/settings/people/:id          PersonChange   → PersonAnswer
 *   POST /api/v1/settings/people/:id/access   AccessChange   → PersonAnswer
 *   POST /api/v1/settings/people/:id/link     LinkChange     → PersonAnswer
 *
 * Types only: the server imports this file with `import type`.
 */

/** The sections of the screen, as `?tab=` names them. */
export type SettingsTab = "people" | "sources" | "access" | "writing" | "about";

/* ---------- people --------------------------------------------------------- */

/** One person the desk knows, as Settings lists them. */
export interface SettingsPerson {
  /**
   * The row's id, which the change routes take. A Telegram user id, or a
   * negative number for somebody who has only signed in with Google and has
   * not been linked to a Telegram account yet.
   */
  id: number;
  name: string;
  /** The address their commits carry. It must be the one on their Vercel account, or Vercel refuses the deployment. */
  email: string | null;
  /** The byline on an article they share: a key of `authors` in the website's content/journal.ts. */
  byline: string;
  /** Their Telegram user id, or null when the bot has not met them (or they are not linked yet). */
  telegram: number | null;
  owner: boolean;
  /** The person looking at the screen. */
  you: boolean;
  canPublish: boolean;
  /** What they may do today: always true for the owner, always false when switched off. */
  seesLeads: boolean;
  /** What the owner decided for them, which the two rules above override. */
  leadsGranted: boolean;
  /** Switched off: they can sign in, and every page and API answer refuses them. */
  revoked: boolean;
  /**
   * The owner limited what they may open (Team › Access & Roles). While that
   * holds, or while they are switched off, an address they have cannot be
   * changed or removed: sign-in finds them by it, and a changed one would let
   * them in as a new person. The server refuses it with 409 and says why.
   */
  restricted: boolean;
  /** How the desk knows them: signing in with Google, the Telegram bot, or both. */
  knownBy: "google" | "telegram" | "both";
  /**
   * When they last signed in, from the desk's own log (Google sign-in, or the
   * retired one-time Telegram link). Given to the owner only; null for
   * everybody else, and when the log has no sign-in for them.
   */
  lastSignIn: string | null;
}

export interface SettingsPeople {
  people: SettingsPerson[];
  /** May the person looking change anything here. Decided on the server, and checked again by every POST. */
  canEdit: boolean;
  /** The owner: the address in the server's configuration, and the name of the row carrying it, if one does yet. */
  owner: { email: string; name: string | null };
  /** People who could be linked to a Google-only row: the bot has met them and they carry no address yet. */
  linkable: { id: number; name: string }[];
}

/**
 * POST /people/:id. Only the fields sent are changed; every one is checked
 * before any is written.
 *
 * Google sign-in finds a person by their address (src/people.ts
 * rememberGoogle), so the address is also their identity. The server refuses
 * to change or remove the address of a switched-off person or of one whose
 * access is limited (`revoked`, `restricted`: their next sign-in would arrive
 * as a new person, with what a newcomer gets), and changes the address of
 * somebody who signs in with Google only when `detach` says the owner knows
 * that their next sign-in makes a new person.
 */
export interface PersonChange {
  /** An address, or null (or "") to remove it. */
  email?: string | null;
  byline?: string;
  /** "May see enquiries". */
  seesLeads?: boolean;
  /** Change the address of somebody who signs in with Google, knowing it detaches their sign-in from this row. */
  detach?: boolean;
}

/** POST /people/:id/access. */
export interface AccessChange {
  /** false switches the person off; true lets them in again. */
  on: boolean;
}

/** POST /people/:id/link, on a Google-only row: join it to the Telegram account of `telegram`. */
export interface LinkChange {
  telegram: number;
}

/**
 * What every change answers: the person as they now are, and what was done,
 * in a sentence. After a link that is the Telegram row the Google row was
 * merged into; null only if that row could not be read back.
 */
export interface PersonAnswer {
  ok: true;
  person: SettingsPerson | null;
  said: string;
}

/* ---------- sources -------------------------------------------------------- */

/** One thing only the owner can do, so a source answers. */
export interface OwnerStep {
  id: string;
  /** "Connect Google Search Console". */
  title: string;
  /** What it unlocks, in a few words. */
  unlocks: string;
  /** Why it is needed now: the source's own reason, when it gave one. */
  why: string | null;
  /** The step, in the source's own words, written for a person. */
  step: string;
  /** Lines to run, lifted out of the step so each can be copied alone. */
  commands: string[];
  /** Addresses named in the step, to open. */
  links: string[];
  sources: SourceId[];
  tone: Tone;
  /**
   * Set when the desk cannot tell whether the step is done yet: why, in a
   * sentence. The step stays listed, marked as not confirmed, until the
   * source can say.
   */
  unconfirmed?: string;
}

export interface SettingsSources {
  /** Every source, as GET /api/v1/system lists them. */
  list: SourceStatus[];
  /** What only the owner can do, most valuable first. Empty when everything answers. */
  steps: OwnerStep[];
  /** What the top bar's light stands on. */
  checks: { name: string; ok: boolean; detail: string }[];
}

/** One metered allowance a source gives the desk. */
export interface Allowance {
  label: string;
  /** What is left and the whole, when the source said. */
  left: number | null;
  of: number | null;
  /** "today", "this hour". */
  per: string;
  /** "ok", "slow" (reads are spaced out) or "hold" (nothing is asked; kept answers are served). */
  pace: "ok" | "slow" | "hold" | null;
  /** The source's words about it, when there are any. */
  note: string | null;
  /** When the source last said. */
  at: string | null;
}

export interface SettingsQuota {
  ga4: Reading<{ history: Allowance[]; realtime: Allowance[] }>;
  clarity: Reading<Allowance>;
  pagespeed: Reading<{ keyed: boolean; refused: { day: string; said: string } | null }>;
}

/** The desk's Google service account: the address the owner adds in Search Console. Not a secret. */
export interface SettingsAccount {
  email: string;
  /** The Cloud project it belongs to, read from the address. */
  project: string | null;
}

/** One of the website's two enquiry events, as GA4 knows it. */
export interface KeyEvent {
  name: string;
  what: string;
  /**
   * Marked as a key event in GA4 Admin, read from the setting itself (the
   * Admin API). null when the desk cannot read GA4's settings.
   */
  marked: boolean | null;
  /** How many GA4 recorded in the last 30 days (consenting visitors only). null when the events report could not be read. */
  recorded: number | null;
  /**
   * Whether GA4 counted at least one of those as a key event. The flag is set
   * on each event as it is recorded, so it changes only for events recorded
   * after the marking, never for earlier ones. null when the report could
   * not be read.
   */
  counted: boolean | null;
}

/** Whether the website's two enquiry events are marked as key events in GA4. */
export interface KeyEvents {
  events: KeyEvent[];
  /**
   * Where "marked" comes from: GA4's own setting, read at `at`; or not read,
   * with why, and the owner's step that lets the desk read it (null when
   * there is no such step, only Google's refusal).
   */
  setting: { read: true; at: string } | { read: false; why: string; step: string | null };
}

/* ---------- session and access --------------------------------------------- */

export interface SettingsAccess {
  /** The one Google domain let in. */
  domain: string;
  /** Google sign-in has its OAuth client on this server. */
  googleClient: boolean;
  /** Sessions are signed with the desk's own secret, or still with the runner's until the owner mints one. */
  sessionSecret: "own" | "runner";
  sessionDays: number;
  /** This copy signs a visitor in by itself (development only: never true on the real desk). */
  devDoor: boolean;
  /** How many people may do each thing, for the rights table. */
  counts: { people: number; active: number; publish: number; leads: number; off: number };
}

/* ---------- writing -------------------------------------------------------- */

export interface SettingsWriting {
  /** DESK_AUTOPUBLISH is not "0": a written article is published and listed by the desk itself. */
  autopublish: boolean;
  /**
   * Who publishes when the person who shared the link has no address: the
   * owner, if they can publish. Not for a sharer the owner did not give edit
   * on Insights: their piece is written and waits on the desk as a draft.
   */
  fallback: string | null;
  /** People who can publish: an address, edit on Insights, and not switched off. */
  publishers: number;
}

export interface SettingsRunner {
  /** Asked for work within the last five minutes. */
  awake: boolean;
  lastSeen: string | null;
  queued: number;
  running: number;
  stuck: number;
  /** Written and waiting for a person. */
  drafts: number;
  listed: number;
}

/* ---------- about ---------------------------------------------------------- */

export interface SettingsVersions {
  /**
   * The desk's commit: from the release the box runs (`at` is when it was
   * installed), or the checkout on a workstation (`at` is the commit's time,
   * and `dirty` says whether files differ from it).
   */
  desk: { commit: string; from: "release" | "checkout"; at: string | null; dirty: boolean } | null;
  node: string;
  next: { version: string; installed: boolean } | null;
  react: { version: string; installed: boolean } | null;
  hono: string | null;
  sqlite: string | null;
}

/** The desk's own server, now (src/cc/site/box.ts). Never the website's hosting. */
export interface SettingsServer {
  hostname: string;
  platform: string;
  cpus: number;
  load: { one: number; five: number; fifteen: number } | null;
  memory: { total: number; available: number; usedPercent: number };
  disk: { total: number; free: number; usedPercent: number } | null;
  process: { rss: number; heapUsed: number; limit: number | null; uptime: number; pid: number };
  uptime: number;
}

/* ---------- the payload ---------------------------------------------------- */

export interface SettingsPayload {
  me: Me;
  people: Reading<SettingsPeople>;
  sources: Reading<SettingsSources>;
  account: Reading<SettingsAccount>;
  keyEvents: Reading<KeyEvents>;
  quota: SettingsQuota;
  access: Reading<SettingsAccess>;
  writing: Reading<SettingsWriting>;
  runner: Reading<SettingsRunner>;
  versions: Reading<SettingsVersions>;
  server: Reading<SettingsServer>;
}
