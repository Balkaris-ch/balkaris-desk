import { countOn, setCount } from "../../search/shared.ts";
import { setState, state, today } from "../../store.ts";

/**
 * What the web layer's modules have in common: the four languages, a clock a
 * check can replace, one-request-at-a-time pacing per host, an allowance that
 * starts again each day, and a pause that lasts until a stated time.
 *
 * Everything counted or paused lives in cc_state, not in memory: the desk
 * restarts on every deploy, and an allowance that forgets is not one.
 */

/** The languages Switzerland searches in. */
export type WebLang = "de" | "en" | "fr" | "it";
export const WEB_LANGS: readonly WebLang[] = ["de", "en", "fr", "it"];

/** A language as the web layer takes it, or the fallback when it is none of the four. */
export const asLang = (v: unknown, fallback: WebLang = "de"): WebLang => (WEB_LANGS.includes(v as WebLang) ? (v as WebLang) : fallback);

/** A two-letter country, lower case; Switzerland unless told otherwise. */
export const asCountry = (v: unknown): string => (typeof v === "string" && /^[a-z]{2}$/i.test(v.trim()) ? v.trim().toLowerCase() : "ch");

/** What a browser set to that language in Switzerland sends. */
export const acceptLanguage = (lang: WebLang, country = "ch"): string => {
  const cc = country.toUpperCase();
  return lang === "en" ? `en-${cc},en;q=0.9,de;q=0.7` : `${lang}-${cc},${lang};q=0.9,en;q=0.7`;
};

/** The time and the wait. The check script replaces both, so a minute of pacing takes no time there. */
export const clock = {
  now: (): number => Date.now(),
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
};

/* ---------- one request at a time to a host ------------------------------------------------- */

const lanes = new Map<string, Promise<void>>();
const lastAt = new Map<string, number>();

/**
 * Wait for this host's turn: resolves when at least `gapMs` have passed since
 * the last request anyone here made to it, and takes the slot. Callers queue
 * behind each other, so two researches started in the same second still send
 * one request a second between them.
 */
export function pace(host: string, gapMs: number): Promise<void> {
  const before = lanes.get(host) ?? Promise.resolve();
  const mine = before.then(async () => {
    const wait = (lastAt.get(host) ?? Number.NEGATIVE_INFINITY) + gapMs - clock.now();
    if (wait > 0) await clock.sleep(wait);
    lastAt.set(host, clock.now());
  });
  lanes.set(
    host,
    mine.catch(() => {}),
  );
  return mine;
}

/** Forget the pacing (the check script, between two parts). */
export function resetPace(): void {
  lanes.clear();
  lastAt.clear();
}

/* ---------- an allowance that starts again each day ------------------------------------------ */

export interface Allowance {
  used: number;
  cap: number;
  left: number;
  /** The Zurich day the count belongs to. */
  day: string;
}

export function allowance(key: string, cap: number): Allowance {
  const day = today();
  const used = countOn(key, day);
  return { used, cap, left: Math.max(0, cap - used), day };
}

/** Take one from today's allowance, or refuse. */
export function spend(key: string, cap: number): boolean {
  const day = today();
  const used = countOn(key, day);
  if (used >= cap) return false;
  setCount(key, day, used + 1);
  return true;
}

/** A whole number from the environment within sane bounds, else the default: so the owner can loosen or tighten a limit without a release. */
export function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/* ---------- a pause until a stated time -------------------------------------------------------- */

export interface Pause {
  /** ISO time it ends. */
  until: string;
  /** Why, in a sentence that names who refused. */
  why: string;
  /** ISO time it began. */
  at: string;
}

/** The pause in force under `key`, or null (one that has run out is gone). */
export function paused(key: string): Pause | null {
  try {
    const p = JSON.parse(state(key) ?? "null") as Pause | null;
    return p && typeof p.until === "string" && Date.parse(p.until) > clock.now() ? p : null;
  } catch {
    return null;
  }
}

export function pause(key: string, ms: number, why: string): Pause {
  const p: Pause = { until: new Date(clock.now() + ms).toISOString(), why, at: new Date(clock.now()).toISOString() };
  setState(key, JSON.stringify(p));
  return p;
}

export function unpause(key: string): void {
  setState(key, "null");
}

/** The milliseconds left of the Zurich day: a pause "until tomorrow" ends at midnight there. */
export function untilTomorrow(): number {
  const now = new Date(clock.now());
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Math.max(60_000, 86_400_000 - ((n("hour") % 24) * 3600 + n("minute") * 60 + n("second")) * 1000);
}

/** A time as a person in Zurich reads it: "17:40 on 6 October". */
export function whenText(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", day: "numeric", month: "long" }).format(d);
  return `${time} on ${day}`;
}

/* ---------- hosts ------------------------------------------------------------------------------ */

/** The host of an address in lower case, or null when it is not one. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** A host without its "www.". */
export const bare = (host: string): string => host.toLowerCase().replace(/^www\./, "");

/** What went wrong, short enough to show and without an address in it. */
export const said = (e: unknown): string => (e instanceof Error ? (e.name === "TimeoutError" ? "no answer in time" : e.message) : String(e)).split(/\r?\n/)[0]!.slice(0, 160);
