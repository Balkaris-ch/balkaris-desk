import type { Range, Reading, SourceId, SourceStatus } from "../../../web/src/contract/common.ts";
import { type Kept, ok, setState, state } from "../store.ts";

/**
 * What the five waiting sources have in common.
 *
 * Search Console, Bing, Clarity, CrUX and the engine each sleep until a
 * person connects them, and each then has to say the same four things in the
 * same way: which days a range means, whether the source answered, what went
 * wrong in words a person can act on, and how old a kept answer is. Those
 * four things live here so that the five modules read alike.
 */

/* ---------- days --------------------------------------------------------- */

/** How many days a range covers. The two short ones are fractions of a day. */
export const SPAN: Record<Range, number> = { "1h": 1 / 24, "24h": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

/** Today in a time zone, as YYYY-MM-DD. Search Console counts its days in Pacific Time, Clarity in UTC. */
export function dayIn(zone: string, at: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(at));
}

/** A calendar day moved by `n` days. Plain date arithmetic, no time zone involved. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every day from `start` to `end`, both included, oldest first. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 800; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Two windows of whole days of the same length: the one asked for and the one before it. */
export interface DayWindow {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  days: number;
}

/**
 * The window a range means for a source that reports by the day, ending on
 * `end`. Null for the two short ranges: a source with one figure a day cannot
 * answer "the last hour", and saying so beats answering something else.
 */
export function dayWindow(range: Range, end: string): DayWindow | null {
  const days = SPAN[range];
  if (days < 7) return null;
  const start = addDays(end, -(days - 1));
  return { start, end, previousStart: addDays(start, -days), previousEnd: addDays(start, -1), days };
}

/* ---------- the website -------------------------------------------------- */

/** The website's address without a trailing slash: https://www.balkaris.ch */
export const siteBase = (): string => (process.env.SITE_BASE ?? "https://www.balkaris.ch").replace(/\/+$/, "");

/** The origin CrUX and Bing know the site by, with no path. */
export const siteOrigin = (): string => new URL(siteBase()).origin;

/**
 * An address as a path: "/logistics", "/" for the front page. The trailing
 * slash is dropped because Google, the sitemap and the pages themselves do
 * not agree on it, and "/x" and "/x/" are one page here.
 */
export function pathOf(url: string): string {
  try {
    const p = new URL(url, siteBase()).pathname.replace(/\/+$/, "");
    return p || "/";
  } catch {
    return url;
  }
}

/** An address in one spelling, so two can be compared: lower-case host, no fragment, no trailing slash. */
export function plain(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

export const sameAddress = (a: string, b: string): boolean => plain(a) === plain(b);

/* ---------- small arithmetic --------------------------------------------- */

export function median(values: number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export const round = (v: number, places = 2): number => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

/* ---------- asking ------------------------------------------------------- */

/**
 * At most four requests in the air from this whole slice, whatever asks.
 * The desk lives inside 768 MB beside the engine; a hundred URL inspections
 * started in the same tick is how that ceiling, and Google's per-minute quota,
 * are both found.
 */
const WIDE = 4;
let flying = 0;
const queue: (() => void)[] = [];

export async function gate<T>(work: () => Promise<T>): Promise<T> {
  if (flying >= WIDE) await new Promise<void>((go) => queue.push(go));
  flying++;
  try {
    return await work();
  } finally {
    flying--;
    queue.shift()?.();
  }
}

/** Run `work` over a list, a few at a time, keeping the order of the answers. */
export async function inTurns<A, B>(list: A[], wide: number, work: (item: A, index: number) => Promise<B>): Promise<B[]> {
  const out = new Array<B>(list.length);
  let next = 0;
  const lane = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await work(list[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(wide, list.length) }, lane));
  return out;
}

/**
 * What went wrong, by what a person would do about it.
 *
 *   auth       the credential itself was refused: wrong, expired, revoked
 *   forbidden  the credential is fine and is not allowed this
 *   quota      asked too often; it will answer again later by itself
 *   absent     the source has nothing at that address (a 404 that is a fact)
 *   request    the source did not understand the question: our bug
 *   down       no answer at all: network, timeout, a 5xx
 */
export type ProblemKind = "auth" | "forbidden" | "quota" | "absent" | "request" | "down";

/** A refusal from a source, already put into words. `message` is safe to show: it never carries a key or a token. */
export class SourceError extends Error {
  readonly status: number;
  readonly kind: ProblemKind;
  /** The source's own machine-readable reason, when it gave one ("SERVICE_DISABLED", "InvalidApiKey"). */
  readonly reason: string;

  constructor(status: number, kind: ProblemKind, message: string, reason = "") {
    super(message);
    this.name = "SourceError";
    this.status = status;
    this.kind = kind;
    this.reason = reason;
  }
}

/** The kind an HTTP status usually means, before a module looks at the body. */
export function kindOf(status: number): ProblemKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 429) return "quota";
  if (status === 404) return "absent";
  if (status >= 500) return "down";
  return "request";
}

/**
 * One request, answered as a status and a parsed body. Never throws for an
 * HTTP status (each source words its own refusals); throws `down` when there
 * was no answer. The address is never put in an error: Bing and CrUX carry
 * their key in it.
 */
export async function ask(
  who: string,
  url: string,
  init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown; timeout?: number } = {},
): Promise<{ status: number; json: unknown }> {
  return gate(async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? "GET",
        headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(init.timeout ?? 20_000),
      });
    } catch (e) {
      const why = e instanceof Error && e.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
      throw new SourceError(0, "down", `${who} ${why}`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* A proxy's HTML error page, or nothing: the status says enough. */
    }
    return { status: res.status, json };
  });
}

/**
 * A base address from the environment, honoured ONLY when it points at this
 * machine. It exists so the check script can put a stand-in on a local port;
 * it must never become a way to send a credential to another host, so a
 * value that names anything but loopback is ignored.
 */
export function base(variable: string, real: string): string {
  const given = process.env[variable];
  if (!given) return real;
  try {
    const host = new URL(given).hostname;
    if (host === "127.0.0.1" || host === "localhost" || host === "[::1]") return given.replace(/\/+$/, "");
  } catch {
    /* not an address */
  }
  return real;
}

/**
 * The end of every "connect it" step that hands the desk a new key: the one
 * safe way to put it on the box. deploy/env-put.sh asks for the value with the
 * typing hidden, sends it over ssh stdin, merges it into the desk's .env and
 * restarts the desk, so the key is never in a chat, a log or an argument.
 */
export const placeOnBox = (variable: string): string =>
  `then in the desk repository on the workstation run "bash deploy/env-put.sh --ask ${variable}" and paste it at the hidden prompt (it adds ${variable} to /opt/balkaris-desk/.env on the box and restarts the desk)`;

/* ---------- whether a source is answering -------------------------------- */

export interface Problem {
  kind: ProblemKind;
  text: string;
  /** ISO time. */
  at: string;
}

/** Writes are skipped when nothing changed: a hundred inspections must not be a hundred rows rewritten. */
const lastMark = new Map<string, number>();

/** The source answered. Clears whatever problem was on record. */
export function answered(id: string): void {
  const now = Date.now();
  if (now - (lastMark.get(id) ?? 0) < 60_000 && !state(`${id}.problem`)) return;
  lastMark.set(id, now);
  setState(`${id}.ok`, new Date(now).toISOString());
  if (state(`${id}.problem`)) setState(`${id}.problem`, "");
}

/** The source refused or was silent. Kept until it next answers. */
export function failed(id: string, e: unknown): void {
  const kind: ProblemKind = e instanceof SourceError ? e.kind : "down";
  const text = (e instanceof Error ? e.message : String(e)).slice(0, 240);
  setState(`${id}.problem`, JSON.stringify({ kind, text, at: new Date().toISOString() } satisfies Problem));
}

export function health(id: string): { lastOk: string | null; problem: Problem | null } {
  let problem: Problem | null = null;
  try {
    const raw = state(`${id}.problem`);
    problem = raw ? (JSON.parse(raw) as Problem) : null;
  } catch {
    problem = null;
  }
  return { lastOk: state(`${id}.ok`) || null, problem };
}

/**
 * A source's line in Settings.
 *
 *   not connected            off, with the step. Never red: nobody was meant
 *                            to have connected it yet.
 *   connected, never asked   waiting for its first run.
 *   asked too often          waiting: it answers again by itself.
 *   refused or silent        failing, with the reason and, when a person can
 *                            fix it, the step.
 *   otherwise                connected.
 */
export function statusOf(o: {
  id: SourceId;
  /** The key under which `answered` and `failed` were called, when it differs from `id`. */
  key?: string;
  name: string;
  feeds: string;
  connected: boolean;
  /** Why it is off, in one sentence, for the `error` field of an off source. */
  offReason?: string;
  step: string;
}): SourceStatus {
  const { lastOk, problem } = health(o.key ?? o.id);
  const common = { id: o.id, name: o.name, feeds: o.feeds, lastOk };
  if (!o.connected) return { ...common, state: "off", step: o.step, ...(o.offReason ? { error: o.offReason } : {}) };
  if (problem?.kind === "quota") return { ...common, state: "waiting", error: problem.text };
  if (problem) return { ...common, state: "failing", error: problem.text, ...(problem.kind === "auth" || problem.kind === "forbidden" ? { step: o.step } : {}) };
  return { ...common, state: lastOk ? "connected" : "waiting" };
}

/* ---------- a kept answer as a reading ----------------------------------- */

/**
 * What `cached()` returned, as a `Reading`. A stale answer is still shown,
 * with the reason it is stale written into its note: a figure from yesterday
 * with its time beside it beats an empty panel.
 */
export function asReading<T>(source: SourceId, had: Kept<T> & { stale?: boolean; error?: string }, note?: string): Reading<T> {
  const late = had.stale ? `Kept from the last good read; the newest attempt failed (${(had.error ?? "no reason given").slice(0, 120)}).` : "";
  return ok(had.value, source, had.at, [note, late].filter(Boolean).join(" ") || undefined);
}

/* ---------- a count that starts again each day --------------------------- */

/**
 * How many times something was done on `day`, kept in ONE row of cc_state
 * (the day is in the value, not in the key, so the table does not grow a row
 * a day). It is in the database and not in memory because the desk restarts
 * on every deploy, and a quota that forgets is not a quota.
 */
export function countOn(key: string, day: string): number {
  try {
    const had = JSON.parse(state(key) ?? "null") as { day?: string; used?: number } | null;
    return had?.day === day ? Number(had.used ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** Write the count for `day`. Returns what was written. */
export function setCount(key: string, day: string, used: number): number {
  setState(key, JSON.stringify({ day, used }));
  return used;
}
