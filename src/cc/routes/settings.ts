import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Hono, type Context } from "hono";
import { db, queueState } from "../../db.ts";
import { client as googleClient, DOMAIN } from "../../google.ts";
import { byEmail, everyone, getPerson, link, OWNER_EMAIL, setAuthor, setEmail, setRevoked, setSeesLeads, type Person } from "../../people.ts";
import { SESSION_DAYS, SESSION_HANDOVER_DAYS } from "../../session.ts";
import { me, requireOwner, toMe, type Vars } from "../access.ts";
import { cached, kept, note, off, ok, reading, waiting } from "../store.ts";
import { scrub, systemStatus } from "../system.ts";
import type { ApiError, Reading, SourceId, SourceStatus, Tone } from "../../../web/src/contract/common.ts";
import type {
  AccessChange,
  Allowance,
  KeyEvent,
  KeyEvents,
  LinkChange,
  OwnerStep,
  PersonAnswer,
  PersonChange,
  SettingsAccess,
  SettingsAccount,
  SettingsPayload,
  SettingsPeople,
  SettingsPerson,
  SettingsQuota,
  SettingsRunner,
  SettingsServer,
  SettingsSources,
  SettingsVersions,
  SettingsWriting,
} from "../../../web/src/contract/settings.ts";

/**
 * /api/v1/settings: the desk's own facts, and the owner's changes to people.
 *
 *   GET  /                          the whole screen, one payload (SettingsPayload)
 *   POST /people/:id                address, byline, "may see enquiries"   owner only
 *   POST /people/:id/access         switch a person off, or on again       owner only
 *   POST /people/:id/link           join a Google-only row to its Telegram row   owner only
 *
 * It replaces the old people page as the main view and loses nothing of it:
 * the same four changes (src/server.ts, /people/:telegram…), made through the
 * same functions in src/people.ts, refused on the server for anybody but the
 * owner (requireOwner; hiding a form is courtesy, the check is the rule). It
 * adds "may see enquiries" (setSeesLeads), which had no door yet, and a few
 * refusals the old page did not make because each one loses something quietly:
 * changing the owner's own address (it would take ownership away), giving
 * somebody the owner's address (it would hand ownership over), giving two rows
 * one address, linking onto a Telegram row that already carries another
 * address, changing or removing the address of a switched-off person (Google
 * sign-in finds people by address, so their next sign-in would arrive as a new
 * person, switched on), and changing the address of somebody who signs in
 * with Google unless the owner confirms that it detaches their sign-in.
 *
 * NO SECRET IS READ OUT OR ACCEPTED HERE. A credential is described by whether
 * it exists and by the step that places it on the server; its value never
 * leaves the process, and no route takes one.
 *
 * Collectors are loaded with import(), so one that fails to load costs the
 * parts it feeds and not the screen, and every part is its own reading().
 */

export const routes = new Hono<Vars>();

const ga4 = () => import("../ga4.ts");
const gauth = () => import("../gauth.ts");
const site = () => import("../site/index.ts");
const search = () => import("../search/index.ts");

/** SQLite's datetime('now') is UTC without saying so. */
const isoOf = (sqlite: string): string => (sqlite.includes("T") ? sqlite : `${sqlite.replace(" ", "T")}Z`);

const nowIso = (): string => new Date().toISOString();

/* ---------- people --------------------------------------------------------- */

/** When each address last signed in with Google, and each Telegram id with the retired one-time link. From the desk's own log. */
function signIns(): { byEmail: Map<string, string>; byTelegram: Map<number, string> } {
  const out = { byEmail: new Map<string, string>(), byTelegram: new Map<number, string>() };
  try {
    const google = db
      .prepare("SELECT lower(json_extract(detail, '$.email')) AS email, MAX(at) AS at FROM events WHERE what = 'auth.in' AND json_valid(detail) GROUP BY 1")
      .all() as { email: string | null; at: string }[];
    for (const r of google) if (r.email) out.byEmail.set(r.email, isoOf(r.at));
    const link = db
      .prepare("SELECT json_extract(detail, '$.telegram') AS tg, MAX(at) AS at FROM events WHERE what = 'person.login' AND json_valid(detail) GROUP BY 1")
      .all() as { tg: number | null; at: string }[];
    for (const r of link) if (r.tg != null) out.byTelegram.set(Number(r.tg), isoOf(r.at));
  } catch {
    /* A log the database cannot read is no sign-ins known, never a guessed one. */
  }
  return out;
}

/** The column as stored, which `Person.seesLeads` overrides for the owner and for a switched-off person. */
function granted(id: number): boolean {
  const r = db.prepare("SELECT sees_leads FROM people WHERE telegram = ?").get(id) as { sees_leads: number } | undefined;
  return !!r?.sees_leads;
}

/**
 * Google sign-in finds this row by its address: the row was made by signing
 * in (a negative id), or somebody has signed in with Google as its address.
 * For such a row the address is the identity, not only what commits carry.
 */
function findsByGoogle(p: Person, seen = signIns()): boolean {
  return p.telegram < 0 || (!!p.email && seen.byEmail.has(p.email.toLowerCase()));
}

function view(p: Person, looking: Person, seen = signIns()): SettingsPerson {
  const email = p.email?.toLowerCase() ?? null;
  const google = findsByGoogle(p, seen);
  const telegram = p.telegram > 0;
  const last = [email ? seen.byEmail.get(email) : undefined, seen.byTelegram.get(p.telegram)]
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  return {
    id: p.telegram,
    name: p.name,
    email: p.email,
    byline: p.author,
    telegram: telegram ? p.telegram : null,
    owner: p.owner,
    you: p.telegram === looking.telegram,
    canPublish: p.canPublish,
    seesLeads: p.seesLeads,
    leadsGranted: granted(p.telegram),
    revoked: p.revoked,
    knownBy: google && telegram ? "both" : telegram ? "telegram" : "google",
    /* When somebody last came in is the owner's to know, not the team's. */
    lastSignIn: looking.owner ? (last ?? null) : null,
  };
}

function people(looking: Person): SettingsPeople {
  const all = everyone();
  const seen = signIns();
  const owner = all.find((p) => p.owner);
  return {
    people: all.map((p) => view(p, looking, seen)),
    canEdit: looking.owner,
    owner: { email: OWNER_EMAIL, name: owner?.name ?? null },
    linkable: all.filter((p) => p.telegram > 0 && !p.email).map((p) => ({ id: p.telegram, name: p.name })),
  };
}

/* ---------- the owner's steps ---------------------------------------------- */

/** What each source's step is called in the owner's list, and how much it is worth: lower comes first. */
const STEP_TITLE: Partial<Record<SourceId, { title: string; rank: number }>> = {
  ga4: { title: "Put the Google Analytics key on the server", rank: 0 },
  "ga4-live": { title: "Put the Google Analytics key on the server", rank: 0 },
  gsc: { title: "Connect Google Search Console", rank: 1 },
  crux: { title: "Give the desk a Google API key", rank: 2 },
  /* After CrUX, so the folded step keeps CrUX's words, which name both APIs and the menu path. */
  psi: { title: "Give the desk a Google API key", rank: 2.5 },
  engine: { title: "Give the desk a key to the engine's enquiries", rank: 4 },
  clarity: { title: "Connect Microsoft Clarity", rank: 5 },
  bing: { title: "Connect Bing Webmaster Tools", rank: 6 },
  "vercel-drain": { title: "Count true page views: connect Vercel's log drain", rank: 7 },
  "vercel-api": { title: "Give the desk a Vercel token for the website's project", rank: 7.5 },
};

/** Two sources that want the same credential are one step (CrUX and PageSpeed share the Google API key). */
const CREDENTIAL = /\b(GOOGLE_API_KEY|BING_API_KEY|CLARITY_TOKEN|ENGINE_READ_KEY|GA4_CREDENTIALS_FILE|DESK_SESSION_SECRET)\b/;

/** Lines a person runs, lifted out of a step: the env-put helper, and the engine's one ssh line. */
function commandsIn(step: string): string[] {
  const found = [
    ...(step.match(/bash deploy\/env-put\.sh --(?:ask|mint) [A-Z][A-Z0-9_]*/g) ?? []),
    /* The Hosting screen's connector: one line that sets up the drain and places its secret. */
    ...(step.match(/bash deploy\/vercel-connect\.sh/g) ?? []),
    ...(step.match(/ssh -i \S+ \S+@\S+ "[^"]+"/g) ?? []),
  ];
  return [...new Set(found)];
}

/**
 * Consoles named in a step, to open, without the sentence's own punctuation.
 * The website's own addresses are left in the words: in a step they name a
 * property to choose, not a page to visit.
 */
function linksIn(step: string): string[] {
  const urls = (step.match(/https?:\/\/[^\s)"']+/g) ?? []).map((u) => u.replace(/[.,;:]+$/, ""));
  return [
    ...new Set(
      urls.filter((u) => {
        try {
          return !/(^|\.)balkaris\.ch$/i.test(new URL(u).hostname);
        } catch {
          return false;
        }
      }),
    ),
  ];
}

interface Ranked extends OwnerStep {
  rank: number;
  key: string;
}

function fromSource(s: SourceStatus): Ranked | null {
  if (!s.step) return null;
  /* A step only the desk itself takes (the repository job makes its own read copy) is not the owner's. */
  if (/^nothing to set up/i.test(s.step)) return null;
  if (s.state !== "off" && s.state !== "failing") return null;
  const named = STEP_TITLE[s.id] ?? { title: `Connect ${s.name}`, rank: 8 };
  const step = scrub(s.step);
  return {
    id: s.id,
    key: step.match(CREDENTIAL)?.[1] ?? step,
    rank: named.rank,
    title: named.title,
    unlocks: s.feeds,
    why: s.error ? scrub(s.error) : null,
    step,
    commands: commandsIn(step),
    links: linksIn(step),
    sources: [s.id],
    tone: s.state === "failing" ? "bad" : "warn",
  };
}

/** The website's two enquiry events, which the conversion rates are built on. */
const KEY_EVENTS: { name: string; what: string }[] = [
  { name: "generate_lead", what: "An enquiry was sent" },
  { name: "book_meeting", what: "A meeting was booked" },
];

/** What the recorded events say about one event whose setting cannot be read. */
function recordedSays(e: KeyEvent): string {
  if (e.recorded === null) return `The events report could not be read, so nothing says whether ${e.name} is marked.`;
  if (e.recorded === 0) return `${e.name} was not recorded in the last 30 days, so nothing says whether it is marked.`;
  if (e.recorded === 1) return `The one ${e.name} recorded in the last 30 days was not counted as a key event.`;
  return `None of the ${e.recorded} ${e.name} recorded in the last 30 days was counted as a key event.`;
}

const MARK_HOW =
  'In Google Analytics open Admin, then Data display, Events, and switch on "Mark as key event" for NAMES; an event that is not in that list yet is added under Data display, Key events, New key event, by its exact name. The desk\'s Google account only reads, so it cannot do this itself. GA4 counts key events from the moment of the change, never back.';

function keyEventStep(k: Reading<KeyEvents>): Ranked | null {
  if (k.state !== "ok") return null;
  const read = k.value.setting.read;
  /* With the setting read, "open" is what GA4's settings say. Without it, only the flag on recorded events can be read, which is no proof either way. */
  const open = k.value.events.filter((e) => (read ? e.marked === false : e.counted !== true));
  if (!open.length) return null;
  const names = open.map((e) => e.name).join(" and ");
  const how = MARK_HOW.replace("NAMES", names);
  return {
    id: "ga4-key-events",
    key: "ga4-key-events",
    rank: 3,
    title: "Mark the enquiry events as key events in GA4",
    unlocks: "Conversion rates GA4 counts itself (session key event rate), beside the raw event counts",
    why: read ? `GA4's settings do not mark ${names} as ${open.length === 1 ? "a key event" : "key events"}.` : open.map(recordedSays).join(" "),
    step: read ? `${how} The desk reads the setting itself, so this step clears within ten minutes of the change.` : how,
    commands: [],
    links: [],
    sources: ["ga4"],
    tone: "warn",
    ...(k.value.setting.read
      ? {}
      : {
          unconfirmed: `The desk cannot read GA4's settings${k.value.setting.step ? " yet (the next step lets it)" : ""}, only the flag on each recorded event, which GA4 sets from the moment of marking. If you have marked them already, the desk sees it once an enquiry is recorded after the change, the day after; until then this stays listed.`,
        }),
  };
}

/** The owner's step that lets the desk read GA4's settings, when Google said the Admin API is off. */
function adminStep(k: Reading<KeyEvents>): Ranked | null {
  if (k.state !== "ok" || k.value.setting.read || !k.value.setting.step) return null;
  const step = k.value.setting.step;
  return {
    id: "ga4-admin",
    key: "ga4-admin",
    rank: 3.5,
    title: "Let the desk read GA4's settings",
    unlocks: "The key-event check read from GA4's own settings, so it is confirmed within minutes of marking instead of after the next enquiry",
    why: k.value.setting.why,
    step,
    commands: [],
    links: linksIn(step),
    sources: ["ga4"],
    tone: "warn",
  };
}

function sessionStep(): Ranked | null {
  if ((process.env.DESK_SESSION_SECRET ?? "").trim()) return null;
  return {
    id: "session-secret",
    key: "DESK_SESSION_SECRET",
    rank: 7,
    title: "Give the desk a session secret of its own",
    unlocks: "Sign-ins nobody can forge with the runner's secret, which also lives on the workstation",
    why: "Sessions are still signed with the runner's secret.",
    step: `In the desk repository on the workstation run "bash deploy/env-put.sh --mint DESK_SESSION_SECRET": the value is made on the box and never exists anywhere else, it is added to /opt/balkaris-desk/.env and the desk restarts. Whoever opens the desk in the next ${SESSION_HANDOVER_DAYS} days is moved across without signing in again; somebody who stays away longer signs in once more.`,
    commands: ["bash deploy/env-put.sh --mint DESK_SESSION_SECRET"],
    links: [],
    sources: ["desk"],
    tone: "warn",
  };
}

/** One list, most valuable first, with two sources that want the same credential folded into one step. */
function ownerSteps(list: SourceStatus[], keyEvents: Reading<KeyEvents>): OwnerStep[] {
  const all = [...list.map(fromSource), keyEventStep(keyEvents), adminStep(keyEvents), sessionStep()].filter((s): s is Ranked => !!s);
  const merged = new Map<string, Ranked>();
  for (const s of all.sort((a, b) => a.rank - b.rank)) {
    const had = merged.get(s.key);
    if (!had) {
      merged.set(s.key, s);
      continue;
    }
    /* The first one's words are kept (the fuller step); what it unlocks is both. */
    had.sources = [...new Set([...had.sources, ...s.sources])];
    if (!had.unlocks.includes(s.unlocks)) had.unlocks = `${had.unlocks}; ${s.unlocks}`;
    if (s.tone === "bad") had.tone = "bad";
  }
  return [...merged.values()].map(({ rank: _rank, key: _key, ...step }) => step);
}

/* ---------- GA4: key events and allowances --------------------------------- */

/** A GA4 read that has not come back by then is "still answering", never a hang. */
const PATIENCE_MS = 9_000;

function inTime<T>(work: Promise<Reading<T>>, source: SourceId, ms = PATIENCE_MS): Promise<Reading<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Reading<T>>((resolve) => {
    timer = setTimeout(() => resolve(waiting(source, "GA4 is still answering this. It is kept as soon as it arrives: reload in a moment.")), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/*
 * WHETHER AN EVENT IS MARKED is a setting in GA4 Admin, and only the Admin
 * API reads it (properties.keyEvents.list, which the read-only analytics
 * scope may call). The Data API's `isKeyEvent` is something else: a flag on
 * each recorded event, set from the moment of marking and never back, so it
 * stays "no" after the marking until the next enquiry is recorded. The desk
 * reads the setting when Google lets it, and otherwise says plainly that it
 * only has the flag.
 */

const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";

/** What GA4 Admin answered: the event names marked as key events, or why not. Kept, refusals included, so a closed door is not knocked on at every load. */
type AdminAnswer = { ok: true; names: string[] } | { ok: false; status: number; said: string; disabled: boolean };

/** A mark made in GA4 shows here within this long. */
const SETTING_FRESH_MS = 10 * 60_000;
/** An Admin API that refused is asked again after this long (Google says to wait a few minutes after enabling it). */
const SETTING_RETRY_MS = 15 * 60_000;

/** Google's own sentence out of an error body, without the console address it appends. */
function googleSaid(text: string): string {
  let said = text;
  try {
    said = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
  } catch {
    /* not JSON: the body as it is */
  }
  return scrub(said.replace(/\s*Enable it by visiting[\s\S]*$/i, "").replace(/\s+/g, " ").trim()).slice(0, 220);
}

async function askAdmin(property: string): Promise<AdminAnswer> {
  const a = await gauth();
  const t = await a.token(a.SCOPES.analytics);
  if (!t) throw new Error("The Google Analytics key file is not on this server.");
  const names: string[] = [];
  let page = "";
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ pageSize: "200", ...(page ? { pageToken: page } : {}) });
    const res = await fetch(`${ADMIN_API}/properties/${property}/keyEvents?${q}`, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, said: googleSaid(text), disabled: res.status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(text) };
    }
    const j = (await res.json()) as { keyEvents?: { eventName?: string }[]; nextPageToken?: string };
    for (const k of j.keyEvents ?? []) if (k.eventName) names.push(k.eventName);
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  return { ok: true, names };
}

type Setting = { read: true; names: Set<string>; at: number } | { read: false; why: string; step: string | null };

async function keySetting(property: string): Promise<Setting> {
  const a = await gauth();
  if (!a.hasKey()) return { read: false, why: "The Google Analytics key file is not on this server.", step: null };
  const key = `settings:ga4-key-events:${property}`;
  try {
    const had = kept<AdminAnswer>(key);
    const fresh = had && Date.now() - had.at < (had.value.ok ? SETTING_FRESH_MS : SETTING_RETRY_MS);
    const got = fresh ? had : await cached<AdminAnswer>(key, 0, () => askAdmin(property));
    const v = got.value;
    if (v.ok) return { read: true, names: new Set(v.names), at: got.at };
    if (v.disabled) {
      const project = a.accountEmail()?.match(/@([^.]+)\.iam\.gserviceaccount\.com$/)?.[1] ?? null;
      const where = project
        ? `https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com?project=${project}`
        : "https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com";
      return {
        read: false,
        why: "The Google Analytics Admin API is switched off in the desk's Google Cloud project, so GA4's own settings cannot be read.",
        step: `In Google Cloud, open ${where}${project ? ` (the project the desk's Google account belongs to, ${project})` : ", in the project the desk's Google account belongs to,"} and press Enable. Nothing else changes: the account stays a Viewer in GA4 and only reads. The desk asks again within a quarter of an hour.`,
      };
    }
    return { read: false, why: `GA4's settings could not be read: Google answered ${v.status}${v.said ? `, "${v.said}"` : ""}.`, step: null };
  } catch (e) {
    return { read: false, why: `GA4's settings could not be read: ${scrub(e instanceof Error ? e.message : String(e)).slice(0, 160)}`, step: null };
  }
}

async function keyEvents(): Promise<Reading<KeyEvents>> {
  const g = await ga4();
  /* The 30-day events read is one the warm-up keeps, so this asks Google nothing new on most loads. */
  const [r, setting] = await Promise.all([g.events("30d", { screen: true }), keySetting(g.propertyId())]);
  const rec = g.asReading(r, (data) => data.rows);
  if (rec.state !== "ok" && !setting.read) return rec.state === "off" ? off("ga4", rec.reason, rec.step) : waiting("ga4", rec.reason);

  const value: KeyEvents = {
    events: KEY_EVENTS.map((e) => {
      const row = rec.state === "ok" ? rec.value.find((x) => x.name === e.name) : undefined;
      return {
        name: e.name,
        what: e.what,
        marked: setting.read ? setting.names.has(e.name) : null,
        recorded: rec.state === "ok" ? (row?.count ?? 0) : null,
        counted: rec.state === "ok" ? (row?.key ?? false) : null,
      };
    }),
    setting: setting.read ? { read: true, at: new Date(setting.at).toISOString() } : { read: false, why: setting.why, step: setting.step },
  };
  if (rec.state === "ok") return ok(value, "ga4", rec.asOf, rec.note);
  return ok(value, "ga4", setting.read ? setting.at : Date.now(), "Read from GA4's settings; the events report could not be read, so no counts.");
}

/** Midnight in California, when GA4's daily allowance starts again. */
function pacificMidnight(now: number): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return now - (((n("hour") % 24) * 60 + n("minute")) * 60 + n("second")) * 1000;
}

async function quota(list: SourceStatus[]): Promise<SettingsQuota> {
  const step = (id: SourceId) => list.find((s) => s.id === id)?.step;

  const ga4Part = reading<{ history: Allowance[]; realtime: Allowance[] }>("ga4", async () => {
    const [g, a] = await Promise.all([ga4(), gauth()]);
    if (!a.hasKey()) return off("ga4", "The Google Analytics key file is not on this server, so GA4 has no allowance to show.", step("ga4"));
    const q = g.quota();
    const at = Math.max(q.core.at ?? 0, q.realtime.at ?? 0);
    if (!at) return waiting("ga4", "GA4 has not been asked anything since its allowance was last recorded.");
    const now = Date.now();
    const of = (bucket: typeof q.core, name: string): Allowance[] => {
      const said = bucket.at ? new Date(bucket.at).toISOString() : null;
      /* A count from an earlier hour, or from before the daily reset, says nothing about now. */
      const thisHour = bucket.at !== null && now - bucket.at < 3_600_000;
      const today = bucket.at !== null && bucket.at >= pacificMidnight(now);
      const pace = bucket.at === null ? null : bucket.pace;
      return [
        { label: `GA4 ${name.toLowerCase()}, today`, left: today ? bucket.dayLeft : null, of: bucket.dayLimit, per: "today", pace, note: today ? (bucket.reason ?? null) : "Not asked since the daily allowance started again (midnight in California).", at: said },
        { label: `GA4 ${name.toLowerCase()}, this hour`, left: thisHour ? bucket.hourLeft : null, of: bucket.hourLimit, per: "this hour", pace, note: thisHour ? null : "Not asked this hour.", at: said },
      ];
    };
    return ok({ history: of(q.core, "History reports"), realtime: of(q.realtime, "Realtime reports") }, "ga4", at, "Tokens as Google reported them with its last answer. The desk spaces reads out below 30% and stops below 10%.");
  });

  const clarityPart = reading<Allowance>("clarity", async () => {
    const { clarity } = await search();
    if (!clarity.configured()) return off("clarity", "Microsoft Clarity is not connected, so it has no allowance to show.", clarity.step());
    return ok(
      { label: "Clarity data export", left: clarity.callsLeft(), of: clarity.DAILY_LIMIT, per: "today (UTC)", pace: null, note: "Counted by the desk before each request. The daily snapshot never spends the last two.", at: nowIso() },
      "desk",
      Date.now(),
    );
  });

  const psiPart = reading<{ keyed: boolean; refused: { day: string; said: string } | null }>("psi", async () => {
    const s = await site();
    const q = s.speedQuota();
    return ok({ keyed: !!(process.env.GOOGLE_API_KEY ?? "").trim(), refused: q ? { day: q.day, said: scrub(q.said) } : null }, "psi", Date.now());
  });

  const [ga4Read, clarityRead, psiRead] = await Promise.all([ga4Part, clarityPart, psiPart]);
  return { ga4: ga4Read, clarity: clarityRead, pagespeed: psiRead };
}

async function account(list: SourceStatus[]): Promise<Reading<SettingsAccount>> {
  const a = await gauth();
  const email = a.accountEmail();
  if (!email) {
    return off("desk", "The desk's Google service-account key is not on this server, so there is no address to add anywhere.", list.find((s) => s.id === "ga4")?.step);
  }
  return ok({ email, project: email.match(/@([^.]+)\.iam\.gserviceaccount\.com$/)?.[1] ?? null }, "desk", Date.now(), "Read from the key file's own address. The address is not a secret; the key is, and it never leaves the server.");
}

/* ---------- access, writing, the runner ------------------------------------ */

/** The development sign-in's three locks (src/session.ts devUser), read without creating anybody. */
const devDoor = (): boolean =>
  process.env.NODE_ENV !== "production" && !!(process.env.DESK_DEV_USER ?? "").trim() && !/^https:/i.test(process.env.DESK_URL ?? "https://desk.balkaris.ch");

function access(): SettingsAccess {
  const all = everyone();
  return {
    domain: DOMAIN,
    googleClient: !!googleClient(),
    sessionSecret: (process.env.DESK_SESSION_SECRET ?? "").trim() ? "own" : "runner",
    sessionDays: SESSION_DAYS,
    devDoor: devDoor(),
    counts: {
      people: all.length,
      active: all.filter((p) => !p.revoked).length,
      publish: all.filter((p) => p.canPublish).length,
      leads: all.filter((p) => p.seesLeads).length,
      off: all.filter((p) => p.revoked).length,
    },
  };
}

function writing(): SettingsWriting {
  const all = everyone();
  return {
    /* The same test src/server.ts autoPublish() makes. */
    autopublish: (process.env.DESK_AUTOPUBLISH ?? "1") !== "0",
    fallback: all.find((p) => p.owner && p.canPublish)?.name ?? null,
    publishers: all.filter((p) => p.canPublish).length,
  };
}

const AWAKE_MS = 5 * 60_000;

function runner(): SettingsRunner {
  const q = queueState();
  const listed = (db.prepare("SELECT COUNT(*) AS c FROM drafts WHERE state = 'listed'").get() as { c: number }).c;
  const seen = q.lastSeen ? isoOf(q.lastSeen) : null;
  return {
    awake: !!seen && Date.now() - Date.parse(seen) < AWAKE_MS,
    lastSeen: seen,
    queued: q.queued,
    running: q.running,
    stuck: q.stuck,
    drafts: q.drafts,
    listed,
  };
}

/* ---------- versions ------------------------------------------------------- */

const run = promisify(execFile);

function json(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A package as installed (its own package.json under node_modules), else as the interface declares it. */
function pkg(name: string): { version: string; installed: boolean } | null {
  const root = process.cwd();
  for (const dir of ["web-live", "web"]) {
    const v = json(path.join(root, dir, "node_modules", name, "package.json"))?.version;
    if (typeof v === "string") return { version: v, installed: true };
  }
  const deps = json(path.join(root, "web", "package.json"))?.dependencies as Record<string, string> | undefined;
  return deps?.[name] ? { version: deps[name], installed: false } : null;
}

let deskKept: { at: number; value: SettingsVersions["desk"] } | null = null;

/**
 * Which commit of the desk is running.
 *
 * On the box the interface lives in web-releases/<commit>-<seconds>, and
 * web-live points at the one in use (deploy/push.sh); the server is unpacked
 * from the same commit in the same deploy. On a workstation the desk is a git
 * checkout, read with two read-only git calls. Kept for five minutes.
 */
async function deskCommit(): Promise<SettingsVersions["desk"]> {
  if (deskKept && Date.now() - deskKept.at < 300_000) return deskKept.value;
  const root = process.cwd();
  let value: SettingsVersions["desk"] = null;
  try {
    const release = path.basename(realpathSync(path.join(root, "web-live")));
    const m = /^([0-9a-f]{7,40})-(\d{9,11})$/.exec(release);
    if (m) value = { commit: m[1]!, from: "release", at: new Date(Number(m[2]) * 1000).toISOString(), dirty: false };
  } catch {
    /* no release folder: not the box */
  }
  if (!value && existsSync(path.join(root, ".git"))) {
    try {
      const opts = { cwd: root, timeout: 4000, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } };
      const head = (await run("git", ["log", "-1", "--format=%h %cI"], opts)).stdout.trim();
      const [commit, at] = head.split(" ");
      const changed = (await run("git", ["status", "--porcelain", "--untracked-files=no"], opts)).stdout.trim();
      if (commit) value = { commit, from: "checkout", at: at ?? null, dirty: changed.length > 0 };
    } catch {
      value = null;
    }
  }
  deskKept = { at: Date.now(), value };
  return value;
}

async function versions(): Promise<SettingsVersions> {
  let sqlite: string | null = null;
  try {
    sqlite = (db.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v;
  } catch {
    sqlite = null;
  }
  const hono = json(path.join(process.cwd(), "node_modules", "hono", "package.json"))?.version;
  return {
    desk: await deskCommit(),
    node: process.version,
    next: pkg("next"),
    react: pkg("react"),
    hono: typeof hono === "string" ? hono : null,
    sqlite,
  };
}

async function server(): Promise<Reading<SettingsServer>> {
  const r = (await site()).box();
  if (r.state !== "ok") return r;
  const b = r.value;
  return {
    ...r,
    value: {
      hostname: b.hostname,
      platform: b.platform,
      cpus: b.cpus,
      load: b.load,
      memory: b.memory,
      disk: b.disk ? { total: b.disk.total, free: b.disk.free, usedPercent: b.disk.usedPercent } : null,
      process: { rss: b.process.rss, heapUsed: b.process.heapUsed, limit: b.process.limit, uptime: b.process.uptime, pid: b.process.pid },
      uptime: b.uptime,
    },
  };
}

/* ---------- the screen ------------------------------------------------------ */

routes.get("/", async (c) => {
  const who = me(c);
  const status = systemStatus();
  const list = status.sources;

  const keyEventsRead = reading<KeyEvents>("ga4", () => inTime(keyEvents(), "ga4"));

  const [peopleRead, accountRead, quotaRead, accessRead, writingRead, runnerRead, versionsRead, serverRead, k] = await Promise.all([
    reading<SettingsPeople>("desk", () => ok(people(who), "desk", Date.now())),
    reading<SettingsAccount>("desk", () => account(list)),
    quota(list),
    reading<SettingsAccess>("desk", () => ok(access(), "desk", Date.now())),
    reading<SettingsWriting>("desk", () => ok(writing(), "desk", Date.now())),
    reading<SettingsRunner>("desk", () => ok(runner(), "desk", Date.now())),
    reading<SettingsVersions>("desk", async () => ok(await versions(), "desk", Date.now())),
    reading<SettingsServer>("desk", server),
    keyEventsRead,
  ]);

  const sourcesRead = await reading<SettingsSources>("desk", () =>
    ok({ list, steps: ownerSteps(list, k), checks: status.checks }, "desk", Date.now(), "Each source reports on itself; the desk asks nothing outside to draw this."),
  );

  return c.json<SettingsPayload>({
    me: toMe(who),
    people: peopleRead,
    sources: sourcesRead,
    account: accountRead,
    keyEvents: k,
    quota: quotaRead,
    access: accessRead,
    writing: writingRead,
    runner: runnerRead,
    versions: versionsRead,
    server: serverRead,
  });
});

/* ---------- the owner's changes --------------------------------------------- */

const refuse = (c: Context<Vars>, status: 400 | 404 | 409, error: string) => c.json<ApiError>({ error }, status);

/** The person a change is about, by the id in the address, or null. */
function target(raw: string): Person | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id !== 0 ? getPerson(id) : null;
}

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const BYLINE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const answer = (p: Person, looking: Person, said: string): PersonAnswer => ({ ok: true, person: view(p, looking), said });

/**
 * Address, byline and "may see enquiries", in one form. Every field sent is
 * checked before any is written, so a refusal changes nothing.
 */
routes.post("/people/:id", requireOwner, async (c) => {
  const who = me(c);
  const p = target(c.req.param("id"));
  if (!p) return refuse(c, 404, "The desk does not know that person.");
  const body = (await c.req.json().catch(() => null)) as PersonChange | null;
  if (!body || typeof body !== "object") return refuse(c, 400, "Send the fields to change as JSON.");

  /* ---- check everything first ---- */
  if (body.detach !== undefined && typeof body.detach !== "boolean") return refuse(c, 400, 'Send "detach" as true or false.');
  let email: string | null | undefined;
  /* Set when the change detaches somebody's Google sign-in from this row, which the owner confirmed. */
  let detached = false;
  if (body.email !== undefined) {
    if (body.email !== null && typeof body.email !== "string") return refuse(c, 400, "The address must be text, or empty to remove it.");
    email = (body.email ?? "").trim() || null;
    if (email !== null && (email.length > 254 || !EMAIL.test(email))) return refuse(c, 400, `"${email.slice(0, 80)}" is not an email address.`);
    const same = (email ?? "").toLowerCase() === (p.email ?? "").toLowerCase();
    if (!same && p.owner) {
      return refuse(c, 409, "The owner's address is DESK_OWNER in the server's configuration. Changing it here would take ownership away, so it changes there and nowhere else.");
    }
    if (!same && email && email.toLowerCase() === OWNER_EMAIL) {
      return refuse(c, 409, "That is the owner's address. Ownership moves only by changing the server's configuration, never by giving somebody the address.");
    }
    const holder = email ? byEmail(email) : null;
    if (!same && holder && holder.telegram !== p.telegram) {
      return refuse(c, 409, `${holder.name} already has that address. If they are the same person, link the two rows instead.`);
    }
    /*
     * Google sign-in finds a person by address and nothing else (src/people.ts
     * rememberGoogle): an address nobody carries any more makes a NEW row,
     * switched on, with the studio byline and no enquiry right. So for a
     * switched-off person, changing or removing the address would let them
     * back in, and it is refused outright; adding one where there was none
     * only closes a door. For somebody who signs in with Google it splits
     * them in two, which is done only when the owner says they know.
     */
    if (!same && p.revoked && p.email) {
      return refuse(
        c,
        409,
        "They are switched off, and Google sign-in finds a person by this address. Changing or removing it would let them back in as a new person the next time they sign in with it, so it stays as it is while they are switched off.",
      );
    }
    if (!same && p.email && findsByGoogle(p)) {
      if (body.detach !== true) {
        return refuse(
          c,
          409,
          `They sign in with Google as ${p.email}, and that address is how the desk finds them. Changing or removing it makes their next sign-in a new person, with the studio byline and no enquiry right. Tick "Detach their Google sign-in" to do it anyway.`,
        );
      }
      detached = true;
    }
    if (same) email = undefined;
  }

  let byline: string | undefined;
  if (body.byline !== undefined) {
    if (typeof body.byline !== "string") return refuse(c, 400, "The byline must be text.");
    byline = body.byline.trim().toLowerCase() || "balkaris";
    if (!BYLINE.test(byline)) return refuse(c, 400, 'A byline is a key of the website\'s authors: small letters, digits and hyphens, such as "fini" or "balkaris".');
    if (byline === p.author) byline = undefined;
  }

  let sees: boolean | undefined;
  if (body.seesLeads !== undefined) {
    if (typeof body.seesLeads !== "boolean") return refuse(c, 400, 'Send "seesLeads" as true or false.');
    if (p.owner && !body.seesLeads) return refuse(c, 409, "The owner always sees enquiries; that cannot be taken away here.");
    sees = p.owner || body.seesLeads === granted(p.telegram) ? undefined : body.seesLeads;
  }

  /* ---- then write ---- */
  const said: string[] = [];
  if (email !== undefined) {
    setEmail(p.telegram, email);
    said.push(email ? "The address for publishing was saved." : "The address was removed: they cannot publish until one is added.");
    if (detached) said.push("Their Google sign-in is detached: the next time they sign in with the old address, they arrive as a new person.");
    note("people", `${p.name}'s address for publishing was ${email ? (p.email ? "changed" : "added") : "removed"}${detached ? ", detaching their Google sign-in" : ""}`, {
      actor: who.name,
      href: "/settings",
      tone: email && !detached ? "info" : "warn",
    });
  }
  if (byline !== undefined) {
    setAuthor(p.telegram, byline);
    said.push(`The byline is now "${byline}".`);
    note("people", `${p.name}'s byline is now "${byline}"`, { actor: who.name, href: "/settings" });
  }
  if (sees !== undefined) {
    setSeesLeads(p.telegram, sees);
    said.push(sees ? (p.revoked ? "May see enquiries, once they are switched on again." : "They may now see enquiries.") : "They no longer see enquiries.");
    note("people", sees ? `${p.name} may now see enquiries` : `${p.name} no longer sees enquiries`, { actor: who.name, href: "/settings", tone: sees ? "warn" : "info" });
  }

  const now = getPerson(p.telegram) ?? p;
  return c.json<PersonAnswer>(answer(now, who, said.join(" ") || "Nothing had changed."));
});

/* Switched off: they can still sign in, and the gate answers 403 to everything else. */
routes.post("/people/:id/access", requireOwner, async (c) => {
  const who = me(c);
  const p = target(c.req.param("id"));
  if (!p) return refuse(c, 404, "The desk does not know that person.");
  const body = (await c.req.json().catch(() => null)) as AccessChange | null;
  if (typeof body?.on !== "boolean") return refuse(c, 400, 'Send { "on": true } or { "on": false }.');
  if (p.owner || p.telegram === who.telegram) return refuse(c, 409, "The owner cannot be switched off.");

  if (p.revoked === !body.on) return c.json<PersonAnswer>(answer(p, who, body.on ? "They were already let in." : "They were already switched off."));
  setRevoked(p.telegram, !body.on);
  note("people", body.on ? `${p.name} was let in again` : `${p.name} was switched off`, { actor: who.name, href: "/settings", tone: body.on ? "info" : "warn" });
  return c.json<PersonAnswer>(answer(getPerson(p.telegram) ?? p, who, body.on ? "They are let in again." : "They are switched off: every page and the API now refuse them."));
});

/**
 * Join a Google-only row to the Telegram row that is the same person. The
 * Telegram id is kept; the address, byline, access and enquiry right come
 * across from the Google row, which then goes (src/people.ts `link`).
 */
routes.post("/people/:id/link", requireOwner, async (c) => {
  const who = me(c);
  const acct = target(c.req.param("id"));
  if (!acct) return refuse(c, 404, "The desk does not know that person.");
  if (acct.telegram > 0 || !acct.email) return refuse(c, 409, "Only a row made by signing in with Google, not linked yet, can be linked to a Telegram account.");
  const body = (await c.req.json().catch(() => null)) as LinkChange | null;
  const tg = Number(body?.telegram);
  if (!Number.isSafeInteger(tg) || tg <= 0) return refuse(c, 400, "Choose the Telegram account to link.");
  const bot = getPerson(tg);
  if (!bot) return refuse(c, 404, "Nobody with that Telegram id has written to the bot yet.");
  if (bot.email && bot.email.toLowerCase() !== acct.email.toLowerCase()) {
    return refuse(c, 409, `${bot.name}'s Telegram row already carries another address. Remove it there first, so nothing is overwritten unseen.`);
  }
  if (!link(tg, acct.email)) return refuse(c, 409, "Those two rows could not be linked.");
  note("people", `${acct.name}'s Google account was linked to the Telegram account of ${bot.name}`, { actor: who.name, href: "/settings" });
  const now = getPerson(tg);
  return c.json<PersonAnswer>({ ok: true, person: now ? view(now, who) : null, said: "Linked: one person now, with the Telegram id kept." });
});
