import { z } from "zod";
import type { DayPoint, Range, Reading, SourceStatus, Stat } from "../../web/src/contract/common.ts";
import { off, ok, today, waiting } from "./store.ts";
import { addDays, answered, ask, base, dayIn, eachDay, failed, pathOf, SourceError, SPAN, statusOf } from "./search/shared.ts";

/**
 * Website enquiries, read live from the engine.
 *
 * The enquiry form on the website writes to the engine, and the engine is the
 * one place an enquiry lives. The desk asks the engine each time a screen
 * needs them, over loopback on the same box, with a key that opens that one
 * door and nothing else.
 *
 * NOTHING IS STORED HERE. No table, no cc_cache entry, no log line with a
 * name or an address. The website promises that an enquiry is deleted within
 * twelve months, and a promise like that can only be kept if there is exactly
 * one place to delete from. The only copy this file ever holds is in memory,
 * for at most sixty seconds, so that six panels opening together ask once.
 * Even the errors here are written without a row in them. (The engine itself
 * has no deletion job yet; that is Fini's open point, not something the desk
 * can keep by copying less.)
 *
 * TWO KINDS OF READ, and the difference is who may call them:
 *
 *   list, recent, search            ROWS: names, contact details, messages.
 *                                   Only for a caller that has already checked
 *                                   the person may see leads (`Me.seesLeads`).
 *   countsByDay, byPage,            COUNTS: how many, per day, per page, per
 *   byService, byStage              service, per stage. No personal field
 *                                   leaves them; anybody signed in may see.
 *
 * WHAT THE COUNT IS. A floor, not an audited total: the engine keeps no
 * enquiry from a suppressed address, and per person the current enquiry plus
 * the five before it. `page` is the address the form was SENT from, not
 * where the visitor came from; nothing records that, nor a value or budget.
 *
 * WHERE THE RECORD BEGINS. The engine's record starts with the oldest
 * enquiry it still holds. Before that day nothing is known (the website sent
 * its enquiries elsewhere, or they have been deleted), which is not zero: a
 * window before that reaches past it is not compared (`previous` is null),
 * and days before it are left out. After it, a day without an enquiry is a
 * real zero.
 *
 * THE ROUTE, AS BUILT (engine commit 031330f, src/desk-enquiries.ts there;
 * the contract the engine session confirmed is work/engine-enquiries-contract.txt):
 *
 *   GET http://127.0.0.1:3000/desk/web-enquiries?since=<ISO>&limit=<1-1000>
 *   Authorization: Bearer <ENGINE_READ_KEY>
 *
 *   200  { ok, as_of, since, limit, total, count, rows,
 *          totals: { tz: "Europe/Zurich", by_day: [{ day, count, booked }] } }
 *        `total` and `by_day` cover EVERY enquiry since `since`, not just the
 *        rows sent, so counts are read from them and never from a page of rows.
 *   404  the door is shut: DESK_READ_KEY unset on the engine, or the call
 *        looked forwarded. The engine treats any of x-forwarded-for,
 *        x-forwarded-host, x-forwarded-proto, forwarded, x-real-ip and via as
 *        "came from the internet", so this file sends none of them.
 *   401  the key is wrong.
 *   502  the engine could not read its database: UNKNOWN, never "none".
 *
 * Everything that knows one of the engine's field names is in ONE function,
 * `fromEngine`. The parsing is tolerant: an unknown field is ignored, a
 * missing one is null, a row that is not an object is dropped.
 */

/** The engine on this box. An ENGINE_URL that is not loopback is ignored: the key must never travel to another host. */
const ENGINE = (): string => base("ENGINE_URL", "http://127.0.0.1:3000");
const readKey = (): string => (process.env.ENGINE_READ_KEY ?? "").trim();

/** True when the desk holds a key for the engine's enquiry door. Says nothing about whether the engine agrees. */
export const configured = (): boolean => !!readKey();

const REASON = "The desk has no key for the engine's enquiries.";

/** Fini's one line, exactly as the engine session wrote it down (work/engine-enquiries-contract.txt). Run on the workstation; it prints only the two variable names. */
export const MINT_LINE = 'ssh -i E:\\Balkaris\\secrets\\hetzner_ed25519 deploy@91.99.153.205 "bash /opt/balkaris/deploy/mint-desk-key.sh"';

/** The same line in a sentence, for a source's step. */
export const step = (): string =>
  `Once the engine with the enquiry route is deployed, run on the workstation: ${MINT_LINE} (it puts one new key into /opt/balkaris/.env as DESK_READ_KEY and into /opt/balkaris-desk/.env as ENGINE_READ_KEY, restarts both, and prints only the two names).`;

export function status(): SourceStatus {
  return statusOf({
    id: "engine",
    name: "Engine enquiries",
    feeds: "Website enquiries and booked calls: counts for everyone signed in, names and messages only for people allowed to see leads",
    connected: configured(),
    offReason: REASON,
    step: step(),
  });
}

/* ---------- one enquiry ---------------------------------------------------- */

/**
 * One website enquiry, field for field the engine's row in our spelling.
 * PERSONAL DATA: hand it only to someone allowed to see leads, never write it
 * anywhere. Every field the engine may leave empty is null here; a field the
 * engine always sends is still null if it did not, rather than a guess.
 */
export interface Enquiry {
  /** The enquiry's own id ("web_…"). Unique per lead. */
  id: string | null;
  /** The engine's lead (a uuid). One lead may have several enquiries. */
  leadId: string | null;
  /** The reference the visitor was given: "BK-2026-0001". */
  ref: string | null;
  /** When it came in, ISO UTC. */
  capturedAt: string | null;
  /** True for the lead's newest enquiry, false for an earlier one the engine still keeps. */
  current: boolean | null;
  name: string | null;
  company: string | null;
  /** The LEAD's address: the engine keeps no address per enquiry. */
  email: string | null;
  phone: string | null;
  website: string | null;
  /** "quote", "talk" or "meeting". */
  intent: string | null;
  /** Service slugs. */
  services: string[];
  /** The same services as the website words them. */
  servicesNamed: string[];
  /** What they wrote; "" when they wrote nothing (the engine's own empty value). */
  message: string;
  firstWords: string | null;
  recommendation: string | null;
  links: string | null;
  summary: { projectType: string | null; goals: string[]; timeline: string | null; references: string | null } | null;
  /** The address the form was sent from. Not where the visitor came from. */
  page: string | null;
  /** received, processed, expert_assigned, meeting_confirmed, proposal_in_preparation, proposal_ready. */
  stage: string | null;
  /** Each stage it reached, oldest first as the engine sends it. */
  timeline: { stage: string; at: string }[];
  updates: { at: string; text: string; by: string | null }[];
  /** The call it booked; a cancelled call stays, with `cancelled: true`. Null when there was none. */
  booking: {
    /** ISO UTC. */
    start: string;
    /** ISO UTC; the engine's slot is thirty minutes. */
    end: string | null;
    /** The time as it was booked, with Zurich's offset. */
    startZurich: string | null;
    meetUrl: string | null;
    bookedAt: string | null;
    /** False when the row did not say (see `cancelUnknown`). */
    cancelled: boolean;
    cancelledAt: string | null;
    cancelledBy: string | null;
    /**
     * Present only when the engine's row did not say whether the call was
     * cancelled (no `cancelled` flag and no cancel time). The contract always
     * sends the flag, so this marks a row the desk cannot read whole: such a
     * call is never counted as booked.
     */
    cancelUnknown?: true;
  } | null;
  /** Who holds the booked call. Null without a booking: the engine has no assigned owner. */
  owner: { email: string | null; name: string | null } | null;
  /** The engine's pipeline status for the lead: new, meeting, client, … */
  leadStatus: string | null;
  /** website_form, or the older source of a contact the engine already knew. Do not filter on it. */
  leadSource: string | null;
}

const text = z.preprocess((v) => (typeof v === "number" ? String(v) : typeof v === "string" && v.trim() ? v.trim() : null), z.string().nullable());
const time = z.preprocess((v) => {
  const t = typeof v === "string" || typeof v === "number" ? Date.parse(String(v)) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}, z.string().nullable());
const texts = z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim()) : []), z.array(z.string()));
const flag = z.preprocess((v) => (typeof v === "boolean" ? v : null), z.boolean().nullable());
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const whenOf = (v: unknown): string | null => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const EnquirySchema = z.object({
  id: text,
  leadId: text,
  ref: text,
  capturedAt: time,
  current: flag,
  name: text,
  company: text,
  email: text,
  phone: text,
  website: text,
  intent: text,
  services: texts,
  servicesNamed: texts,
  message: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string()),
  firstWords: text,
  recommendation: text,
  links: text,
  summary: z.preprocess(
    (v) => (isObject(v) ? v : null),
    z.object({ projectType: text, goals: texts, timeline: text, references: text }).nullable(),
  ),
  page: text,
  stage: text,
  /* An entry without a stage or a readable time is left out, not guessed. */
  timeline: z.preprocess(
    (v) => (Array.isArray(v) ? v.flatMap((t) => (isObject(t) && typeof t.stage === "string" && t.stage && whenOf(t.at) ? [{ stage: t.stage, at: whenOf(t.at) }] : [])) : []),
    z.array(z.object({ stage: z.string(), at: z.string() })),
  ),
  updates: z.preprocess(
    (v) =>
      Array.isArray(v)
        ? v.flatMap((u) => (isObject(u) && typeof u.text === "string" && u.text && whenOf(u.at) ? [{ at: whenOf(u.at), text: u.text, by: typeof u.by === "string" && u.by ? u.by : null }] : []))
        : [],
    z.array(z.object({ at: z.string(), text: z.string(), by: z.string().nullable() })),
  ),
  /* A booking without a readable start is no booking. */
  booking: z.preprocess(
    (v) => (isObject(v) && whenOf(v.start) ? v : null),
    z
      .object({
        start: time.pipe(z.string()),
        end: time,
        startZurich: text,
        meetUrl: text,
        bookedAt: time,
        cancelled: flag,
        cancelledAt: time,
        cancelledBy: text,
      })
      /* Whether the call was cancelled is read, never assumed: without the
         flag a cancel time still says yes; with neither it is unknown. */
      .transform(({ cancelled, ...b }) => {
        const said = cancelled ?? (b.cancelledAt ? true : null);
        return said === null ? { ...b, cancelled: false, cancelUnknown: true as const } : { ...b, cancelled: said };
      })
      .nullable(),
  ),
  owner: z.preprocess(
    /* The engine sends { email, name }; a bare address is accepted too. */
    (v) => (typeof v === "string" && v.trim() ? { email: v, name: null } : isObject(v) ? v : null),
    z.object({ email: text, name: text }).nullable(),
  ),
  leadStatus: text,
  leadSource: text,
});

/* The schema and the interface are written separately so each can be read on
   its own; this line fails to compile the day they disagree. */
const sameShape: (parsed: z.infer<typeof EnquirySchema>) => Enquiry = (parsed) => parsed;
void sameShape;

/**
 * THE MAPPING: the engine's field names on the right, ours on the left. When
 * the engine's route changes, this is the function to change.
 */
function fromEngine(raw: Record<string, unknown>): unknown {
  const b = isObject(raw.booking) ? raw.booking : null;
  const s = isObject(raw.summary) ? raw.summary : null;
  return {
    id: raw.id,
    leadId: raw.lead_id,
    ref: raw.ref,
    capturedAt: raw.captured_at,
    current: raw.current,
    name: raw.name,
    company: raw.company,
    email: raw.email,
    phone: raw.phone,
    website: raw.website,
    intent: raw.intent,
    services: raw.services,
    servicesNamed: raw.services_named,
    message: raw.message,
    firstWords: raw.first_words,
    recommendation: raw.recommendation,
    links: raw.links,
    summary: s ? { projectType: s.project_type, goals: s.goals, timeline: s.timeline, references: s.references } : null,
    page: raw.page,
    stage: raw.stage,
    timeline: raw.timeline,
    updates: raw.updates,
    booking: b
      ? {
          start: b.start,
          end: b.end,
          startZurich: b.start_zurich,
          meetUrl: b.meet_url,
          bookedAt: b.booked_at,
          cancelled: b.cancelled,
          cancelledAt: b.cancelled_at,
          cancelledBy: b.cancelled_by,
        }
      : null,
    owner: raw.owner,
    leadStatus: raw.lead_status,
    leadSource: raw.lead_source,
  };
}

/** One Zurich day of the engine's own totals. */
export interface EngineDay {
  /** YYYY-MM-DD in Zurich. */
  day: string;
  /** Enquiries captured that day. */
  count: number;
  /** Of those, how many hold a booked call that was not cancelled. Null when the engine's entry did not say: never read as zero. */
  booked: number | null;
}

/** The engine's envelope. Only `rows` is required; the rest is read when it is there. */
const Envelope = z.object({
  ok: z.boolean().optional(),
  as_of: z.string().optional(),
  total: z.number().optional(),
  count: z.number().optional(),
  rows: z.array(z.unknown()),
  totals: z
    .object({
      tz: z.string().optional(),
      by_day: z.array(z.unknown()).optional(),
    })
    .optional(),
});

/** A count the engine sent: a whole number, or its digits. Anything else (null, "", missing) is not a count, and is not read as zero. */
const countOf = (v: unknown): number | null =>
  typeof v === "number" ? (Number.isInteger(v) && v >= 0 ? v : null) : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : null;

/**
 * The engine's totals per day, or null when it sent none or any entry cannot
 * be read: a day left out would be counted as a day without enquiries, so a
 * list with a hole in it is no list.
 */
function days(list: unknown[] | undefined): EngineDay[] | null {
  if (!list) return null;
  const out: EngineDay[] = [];
  for (const d of list) {
    if (!isObject(d) || typeof d.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.day)) return null;
    const count = countOf(d.count);
    if (count === null) return null;
    out.push({ day: d.day, count, booked: countOf(d.booked) });
  }
  return out;
}

/* ---------- asking the engine ---------------------------------------------- */

interface Answer {
  rows: Enquiry[];
  /** How many enquiries the engine says it sent (`count`), readable or not. */
  sent: number;
  /** How many enquiries matched `since`, before the limit. */
  total: number | null;
  /** The engine's own count per Zurich day, over every matching enquiry. Null when it sent none. */
  byDay: EngineDay[] | null;
  /** ISO time the engine answered. */
  asOf: string;
}

/** The engine's ceiling on one answer. */
const MOST = 1000;

/** THE ONLY COPY: answers by question, each dropped sixty seconds after it arrived. In memory, never on disk. */
const held = new Map<string, { at: number; answer: Promise<Answer> }>();
const HOLD = 60_000;

/**
 * A refusal in our own words. The engine's body is read only for a 400,
 * whose error is a fixed sentence about the question ("since must be an ISO
 * time") and never a row.
 */
function refusal(status: number, json: unknown): SourceError {
  if (status === 404)
    return new SourceError(404, "forbidden", "The engine's enquiry door answered 404: DESK_READ_KEY is not set on the engine, the route is not deployed yet, or the request did not come straight from the box", "CLOSED");
  if (status === 401) return new SourceError(401, "auth", "The engine refused the desk's key (401): ENGINE_READ_KEY here and DESK_READ_KEY on the engine differ", "KEY");
  if (status === 502)
    return new SourceError(502, "down", "The engine could not read its own enquiries (502), so how many there are is unknown", "DATABASE");
  if (status === 403) return new SourceError(403, "forbidden", "The engine refused the desk (403)", "FORBIDDEN");
  if (status === 429) return new SourceError(429, "quota", "The engine says the desk asked too often; it answers again by itself", "LIMIT");
  if (status === 400) {
    const said = String((json as { error?: unknown } | null)?.error ?? "").slice(0, 80);
    return new SourceError(400, "request", `The engine did not accept the question (400)${/^[\w\s.,'-]+$/.test(said) ? `: ${said}` : ""}`, "REQUEST");
  }
  if (status >= 500) return new SourceError(status, "down", `The engine answered ${status}, so how many enquiries there are is unknown`);
  return new SourceError(status, "request", `The engine did not accept the request (${status})`);
}

async function fetchEnquiries(since: string | null, limit: number): Promise<Answer> {
  try {
    const query = new URLSearchParams({ limit: String(limit) });
    if (since) query.set("since", since);
    /* Exactly two headers go out: what we accept and the key. Node's fetch
       adds no proxy header of its own, and none may be added here: the engine
       answers any of them with 404. */
    const res = await ask("The engine", `${ENGINE()}/desk/web-enquiries?${query}`, { headers: { authorization: `Bearer ${readKey()}` }, timeout: 15_000 });
    if (res.status !== 200) throw refusal(res.status, res.json);

    const body = Envelope.safeParse(res.json);
    if (!body.success || body.data.ok === false) throw new SourceError(200, "request", "The engine answered in a shape the desk does not know");

    const rows: Enquiry[] = [];
    for (const raw of body.data.rows) {
      if (!isObject(raw)) continue;
      const row = EnquirySchema.safeParse(fromEngine(raw));
      if (row.success) rows.push(row.data);
    }
    answered("engine");
    return {
      rows,
      /* The engine's own count of the rows it sent; whatever else rode along in `rows` is not an enquiry. */
      sent: body.data.count ?? body.data.rows.length,
      total: body.data.total ?? null,
      byDay: days(body.data.totals?.by_day),
      asOf: body.data.as_of && Number.isFinite(Date.parse(body.data.as_of)) ? body.data.as_of : new Date().toISOString(),
    };
  } catch (e) {
    /* Whatever went wrong is put on record in our own words only: an
       unexpected error's message is not trusted to be free of a row. */
    const ours = e instanceof SourceError ? e : new SourceError(0, "request", "The engine's answer could not be read");
    failed("engine", ours);
    throw ours;
  }
}

/**
 * The answer to one question, asked at most once a minute. With `rowsKept`
 * false the rows are dropped the moment the answer arrives and only the
 * engine's totals are held: a count needs no names.
 */
function enquiries(since: string | null, limit: number, rowsKept = true): Promise<Answer> {
  const key = `${since ?? ""}|${limit}|${rowsKept ? "rows" : "totals"}`;
  const had = held.get(key);
  if (had && Date.now() - had.at < HOLD) return had.answer;

  const answer = fetchEnquiries(since, limit).then((a) => (rowsKept ? a : { ...a, rows: [] }));
  held.set(key, { at: Date.now(), answer });
  /* Dropped on a timer, not on the next read: sixty seconds means sixty seconds even if nobody asks again. */
  const forget = () => held.get(key)?.answer === answer && held.delete(key);
  setTimeout(forget, HOLD).unref();
  answer.catch(forget);
  return answer;
}

/** Forget every held answer now. For a sign-out, a revoked right, and the check script. */
export function forgetAll(): void {
  held.clear();
}

const CAVEAT = "Read live from the engine; nothing is kept on the desk. A floor, not an audited total: suppressed senders are never stored, and the engine keeps each person's current enquiry and the five before it.";

async function reading<T>(make: () => Promise<Reading<T>>): Promise<Reading<T>> {
  if (!configured()) return off("engine", REASON, step());
  try {
    return await make();
  } catch (e) {
    /* Only our own words are passed on: a SourceError's message never holds a row. */
    const why = e instanceof SourceError ? e.message : "the engine's answer could not be read";
    /* A shut door (404) or a refused key (401) waits for a person: the mint
       line opens the door and rotates both sides. Anything else (a 502, no
       answer) is unknown for now and is not a reason to act. */
    if (e instanceof SourceError && (e.kind === "auth" || e.kind === "forbidden")) return off("engine", `The engine's enquiries could not be read: ${why}.`, step());
    return waiting("engine", `The engine's enquiries could not be read: ${why}.`);
  }
}

/* ---------- rows: only for people who may see leads ------------------------- */

/**
 * Enquiries, newest first. PERSONAL DATA: call it only after checking that
 * the person may see leads. `since` is an ISO time (the engine refuses
 * anything else), `limit` 1 to 1,000 and 200 when not given. The note says
 * when the engine holds more than were sent.
 */
export function list(o: { since?: string; limit?: number } = {}): Promise<Reading<Enquiry[]>> {
  return reading(async () => {
    const limit = Math.max(1, Math.min(MOST, Math.floor(Number.isFinite(o.limit) ? o.limit! : 200)));
    let since: string | null = null;
    if (o.since !== undefined) {
      const t = Date.parse(o.since);
      if (!Number.isFinite(t)) return off("engine", "The question was not right: since must be an ISO time, such as 2026-10-01T00:00:00Z.");
      since = new Date(t).toISOString();
    }
    const got = await enquiries(since, limit);
    const more = got.total !== null && got.total > got.sent ? `The engine holds ${got.total} matching enquiries; the newest ${got.sent} are here.` : "";
    return ok(got.rows, "engine", got.asOf, [CAVEAT, more].filter(Boolean).join(" "));
  });
}

/** The newest `n` enquiries (1 to 1,000). PERSONAL DATA, as `list`. */
export const recent = (n = 10): Promise<Reading<Enquiry[]>> => list({ limit: n });

/**
 * Enquiries whose name, company, address or reference contains every word of
 * `q`, newest first, at most `limit`. PERSONAL DATA, as `list`: the search box
 * calls it only for a person who may see leads. Reads the newest 500 and
 * filters here: the engine has no search of its own.
 */
export async function search(q: string, limit = 8): Promise<Enquiry[]> {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!configured() || !words.length) return [];
  const got = await enquiries(null, 500);
  return got.rows
    .filter((r) => {
      const hay = [r.name, r.company, r.email, r.ref].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

/* ---------- counts: no personal field leaves these -------------------------- */

const ZURICH = "Europe/Zurich";

/** The first moment of a Zurich day, as an ISO time: 22:00 or 23:00 UTC the day before, by the season. */
function zurichMidnight(day: string): string {
  for (const hour of ["22", "23"]) {
    const t = Date.parse(`${addDays(day, -1)}T${hour}:00:00Z`);
    if (dayIn(ZURICH, t) === day) return new Date(t).toISOString();
  }
  return `${day}T00:00:00.000Z`;
}

interface Windows {
  /** Does an enquiry captured at this ISO time fall in the window asked for, the one before, or neither? */
  place: (capturedAt: string) => "now" | "before" | null;
  /** Where the window asked for begins, in milliseconds. */
  startsAt: number;
  /** What the engine is asked for: the first moment of the window before. */
  since: string;
  /** Zurich days of the window, oldest first. Empty for the two short ranges. */
  days: string[];
  /** How many days back the window before lies. */
  shift: number;
  /** Does an engine record that begins on this Zurich day reach back over the whole window before? */
  covers: (first: string) => boolean;
}

/**
 * The two windows of a range. From seven days up they are whole Zurich days
 * ending today, the days the engine's own totals are counted in; the two
 * short ranges are the last hour or day to the minute, and have no days.
 */
function windows(range: Range): Windows {
  const span = SPAN[range];
  if (span < 7) {
    const ms = span * 86_400_000;
    /* To the minute, so that a minute's questions are one question. */
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const beforeDay = dayIn(ZURICH, now - 2 * ms);
    return {
      place: (at) => {
        const t = Date.parse(at);
        return t >= now - ms ? "now" : t >= now - 2 * ms ? "before" : null;
      },
      startsAt: now - ms,
      since: new Date(now - 2 * ms).toISOString(),
      days: [],
      shift: 0,
      /* The record is known only by its first DAY, so it covers a window that
         starts inside a day only if it began on an earlier one. */
      covers: (first) => first < beforeDay,
    };
  }
  const end = today();
  const start = addDays(end, -(span - 1));
  const previousStart = addDays(start, -span);
  return {
    place: (at) => {
      const day = dayIn(ZURICH, Date.parse(at));
      return day >= start && day <= end ? "now" : day >= previousStart && day < start ? "before" : null;
    },
    startsAt: Date.parse(zurichMidnight(start)),
    since: zurichMidnight(previousStart),
    days: eachDay(start, end),
    shift: span,
    covers: (first) => first <= previousStart,
  };
}

/** The engine's own count per Zurich day over everything it holds, and the day its record begins. */
interface EngineRecord {
  byDay: Map<string, EngineDay>;
  /** The Zurich day of the oldest enquiry the engine still holds. Null when it holds none. */
  first: string | null;
  asOf: string;
}

/**
 * The whole record in one question: no `since`, one row asked for and
 * dropped unread, and the engine's totals per day over every enquiry it
 * holds. Held for a minute like every answer; every count reads it.
 */
async function wholeRecord(): Promise<EngineRecord> {
  const got = await enquiries(null, 1, false);
  if (!got.byDay) throw new SourceError(200, "request", "The engine's answer carries no totals per day that the desk can read");
  return { byDay: new Map(got.byDay.map((d) => [d.day, d])), first: got.byDay.map((d) => d.day).sort()[0] ?? null, asOf: got.asOf };
}

/** Why the window before cannot be set beside the one asked for, or null when it can. */
function uncompared(first: string | null, w: Windows): string | null {
  if (first === null) return "The engine holds no enquiry yet, so there is no window before to compare.";
  if (!w.covers(first)) return `The engine's record begins on ${first}, after the window before began, so the window before is not compared.`;
  return null;
}

const CUT = `The engine holds more enquiries than the ${MOST} one answer carries, so the window before is not compared.`;

/**
 * The enquiries of both windows, for a count that needs more than the
 * engine's totals per day (by page, service or stage, or the last hour). At
 * most 1,000 come back, newest first: when there are more, the window before
 * is incomplete, and if even the window asked for is cut, nothing is counted.
 * `uncompared` says why the window before may not be counted, or is null.
 */
async function rowsOf(range: Range): Promise<{ w: Windows; rows: { in: "now" | "before"; row: Enquiry }[]; uncompared: string | null; asOf: string }> {
  const w = windows(range);
  const [got, held] = await Promise.all([enquiries(w.since, MOST), wholeRecord()]);
  const complete = got.total === null ? got.sent < MOST : got.total <= got.sent;
  if (!complete) {
    const oldest = got.rows.reduce((t, r) => (r.capturedAt && Date.parse(r.capturedAt) < t ? Date.parse(r.capturedAt) : t), Infinity);
    if (!(oldest < w.startsAt)) throw new SourceError(200, "request", `The engine holds more than ${MOST} enquiries for this range and sends at most ${MOST} at once, so this count would be short`);
  }
  const rows = got.rows.flatMap((row) => {
    const where = row.capturedAt ? w.place(row.capturedAt) : null;
    return where ? [{ in: where, row }] : [];
  });
  return { w, rows, uncompared: complete ? uncompared(held.first, w) : CUT, asOf: got.asOf };
}

const noteFor = (why: string | null, more = ""): string => [CAVEAT, more, why ?? ""].filter(Boolean).join(" ");

/** A booked call that was not cancelled. A call whose cancellation the engine did not state is not counted. */
const isBooked = (r: Enquiry): boolean => !!r.booking && !r.booking.cancelled && !r.booking.cancelUnknown;

export interface EnquiryCounts {
  /**
   * Enquiries in the window. `previous` is the window before, or null when it
   * cannot be counted whole: the engine's record begins inside it (or it holds
   * no enquiry yet), or the rows were cut. The note says which.
   */
  enquiries: Stat;
  /** Of those, how many have a booked call that was not cancelled. `previous` as for `enquiries`. */
  booked: Stat;
  /**
   * The first day in `days`: the window's start, or the day the engine's
   * record begins when that is later (days before it are not known to be
   * zero, so they are left out). Null for the last hour and day. Always set
   * by `countsByDay`; optional only so that a value built elsewhere (the
   * Conversions route's specimen) still fits the type.
   */
  from?: string | null;
  /**
   * One point per Zurich day from `from`, oldest first, with the same day one
   * window earlier in `previous`: null when that day lies before the engine's
   * record begins. Empty for the last hour and day.
   */
  days: (DayPoint & { booked: number })[];
}

/**
 * How many enquiries came in, per day and in all, with the window before. No
 * personal data. From seven days up it is the engine's own count per Zurich
 * day (`totals.by_day`, over every enquiry it holds, not a page of them); the
 * engine is asked for one row and that row is dropped unread.
 */
export function countsByDay(range: Range): Promise<Reading<EnquiryCounts>> {
  return reading<EnquiryCounts>(async () => {
    const w = windows(range);
    const booked = "A booked call is counted on the day its enquiry came in, while it is not cancelled.";

    if (!w.days.length) {
      const { rows, uncompared: why, asOf } = await rowsOf(range);
      const tally = (where: "now" | "before", pick: (r: Enquiry) => boolean = () => true) => rows.filter((r) => r.in === where && pick(r.row)).length;
      return ok(
        {
          enquiries: { value: tally("now"), previous: why ? null : tally("before"), unit: "count", series: [] },
          booked: { value: tally("now", isBooked), previous: why ? null : tally("before", isBooked), unit: "count", series: [] },
          from: null,
          days: [],
        },
        "engine",
        asOf,
        noteFor(why, booked),
      );
    }

    const { byDay, first, asOf } = await wholeRecord();
    /* A day whose booked calls the engine did not state makes the booked
       count unknown, and a Stat cannot say "unknown" for half its figures:
       the reading says so instead of counting that day's calls as none. */
    if ([...byDay.values()].some((d) => d.booked === null))
      throw new SourceError(200, "request", "The engine's totals per day do not say how many calls were booked, so these counts are not read");
    const at = (day: string): { count: number; booked: number } => {
      const d = byDay.get(day);
      return d ? { count: d.count, booked: d.booked ?? 0 } : { count: 0, booked: 0 };
    };
    /* Inside the record a day without an entry is a real zero; before it, unknown. */
    const known = (day: string) => first !== null && day >= first;
    const start = w.days[0]!;
    const from = first !== null && first > start ? first : start;
    const points = w.days
      .filter((date) => date >= from)
      .map((date) => {
        const then = addDays(date, -w.shift);
        return {
          date,
          value: at(date).count,
          previous: known(then) ? at(then).count : null,
          booked: at(date).booked,
          bookedBefore: known(then) ? at(then).booked : null,
        };
      });
    const why = uncompared(first, w);
    const sum = (k: "value" | "previous" | "booked" | "bookedBefore") => points.reduce((n, p) => n + (p[k] ?? 0), 0);
    return ok(
      {
        enquiries: { value: sum("value"), previous: why ? null : sum("previous"), unit: "count", series: points.map((p) => p.value) },
        booked: { value: sum("booked"), previous: why ? null : sum("bookedBefore"), unit: "count", series: points.map((p) => p.booked) },
        from,
        days: points.map(({ date, value, previous, booked: b }) => ({ date, value, previous, booked: b })),
      },
      "engine",
      asOf,
      noteFor(why, `Counted by the engine per Zurich day. ${booked}`),
    );
  });
}

/** One group of enquiries: a page, a service or a stage, with how many it had in the window before. */
export interface Group {
  key: string;
  label: string;
  count: number;
  /** Null when the window before cannot be counted whole (the engine's record begins inside it, or the rows were cut). */
  previous: number | null;
}

/** Counts per group, largest first. `keys` may put one enquiry into several groups (services) or into one. */
async function grouped(range: Range, keys: (r: Enquiry) => { key: string; label: string }[], more: string): Promise<Reading<Group[]>> {
  return reading(async () => {
    const { rows, uncompared: why, asOf } = await rowsOf(range);
    const by = new Map<string, Group>();
    for (const r of rows) {
      for (const k of keys(r.row)) {
        const g = by.get(k.key) ?? { key: k.key, label: k.label, count: 0, previous: why ? null : 0 };
        if (r.in === "now") g.count++;
        else if (g.previous !== null) g.previous++;
        by.set(k.key, g);
      }
    }
    return ok([...by.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)), "engine", asOf, noteFor(why, more));
  });
}

/**
 * Enquiries by the page the form was sent from. `key` is the path, or "" for
 * enquiries that carry no page. It is where the form was, not where the
 * visitor came from. No personal data.
 */
export const byPage = (range: Range): Promise<Reading<Group[]>> =>
  grouped(
    range,
    (r) => [r.page ? { key: pathOf(r.page), label: pathOf(r.page) } : { key: "", label: "Page not recorded" }],
    "The page is where the form was sent from, not where the visitor came from.",
  );

/** Enquiries by the service asked about. One enquiry naming two services is counted under both. No personal data. */
export const byService = (range: Range): Promise<Reading<Group[]>> =>
  grouped(
    range,
    (r) => (r.services.length ? r.services.map((key, i) => ({ key, label: r.servicesNamed[i] ?? key })) : [{ key: "", label: "No service named" }]),
    "An enquiry that names several services is counted under each, so the groups add up to more than the enquiries.",
  );

/** Enquiries by where they stand now: received, processed, meeting_confirmed, and so on. No personal data. */
export const byStage = (range: Range): Promise<Reading<Group[]>> =>
  grouped(range, (r) => [{ key: r.stage ?? "", label: r.stage ? r.stage.replace(/_/g, " ") : "No stage" }], "The stage is the one each enquiry is in today.");

/**
 * The stages the engine sets by itself: `received` when the form arrives,
 * `meeting_confirmed` when the visitor books a call on the website (engine
 * src/website-enquiry.ts, ENQUIRY_STAGES). Every other stage is set by a
 * founder on the engine's dashboard.
 */
const MACHINE_STAGES: ReadonlySet<string> = new Set(["received", "meeting_confirmed"]);

/**
 * True when somebody at Balkaris has done something with the enquiry in the
 * engine: set a stage of their own, or written the visitor an update. The one
 * update the engine writes by itself is the note that the visitor cancelled
 * their call (engine src/website-booking.ts, by "the visitor"); it does not count.
 */
export const movedOn = (r: Pick<Enquiry, "stage" | "timeline" | "updates">): boolean =>
  r.updates.some((u) => u.by !== "the visitor") || [r.stage, ...r.timeline.map((t) => t.stage)].some((s) => !!s && !MACHINE_STAGES.has(s));

/**
 * Enquiries by whether anybody at Balkaris has moved them on yet: key "moved"
 * when the engine holds a stage a founder sets or an update written to the
 * visitor, "waiting" when it holds only what the engine set by itself
 * (received, and meeting_confirmed from a call the visitor booked). A reply by
 * email or telephone is recorded nowhere, so this is what the engine knows,
 * not whether somebody answered. No personal data.
 */
export const byFirstMove = (range: Range): Promise<Reading<Group[]>> =>
  grouped(
    range,
    (r) => [movedOn(r) ? { key: "moved", label: "Moved on by Balkaris" } : { key: "waiting", label: "Nothing done in the engine yet" }],
    "Moved on means a founder set a stage or wrote the visitor an update in the engine. A call the visitor books moves an enquiry to Meeting confirmed by itself, and does not count.",
  );

/**
 * Returning contacts: leads that sent an enquiry in the window and had sent
 * one before it, each counted once, with the window before. No personal data
 * leaves: one number per window. It reads every enquiry the engine holds (the
 * newest 1,000 at most), because the earlier enquiry may lie outside both
 * windows. The engine keeps a lead's current enquiry and the five before it,
 * so an older one is not seen and the count is a floor.
 */
export function returning(range: Range): Promise<Reading<Stat>> {
  return reading<Stat>(async () => {
    const w = windows(range);
    const [got, held] = await Promise.all([enquiries(null, MOST), wholeRecord()]);
    const complete = got.total === null ? got.sent < MOST : got.total <= got.sent;
    if (!complete) {
      const oldest = got.rows.reduce((t, r) => (r.capturedAt && Date.parse(r.capturedAt) < t ? Date.parse(r.capturedAt) : t), Infinity);
      if (!(oldest < w.startsAt)) throw new SourceError(200, "request", `The engine holds more than ${MOST} enquiries and sends at most ${MOST} at once, so this count would be short`);
    }
    /* Each lead's enquiry times, oldest first. */
    const times = new Map<string, string[]>();
    for (const r of got.rows) {
      if (!r.leadId || !r.capturedAt) continue;
      times.set(r.leadId, [...(times.get(r.leadId) ?? []), r.capturedAt]);
    }
    /* A lead returns in a window when one of its enquiries there is not its first. */
    const count = (where: "now" | "before") => {
      let n = 0;
      for (const list of times.values()) {
        const sorted = [...list].sort((a, b) => Date.parse(a) - Date.parse(b));
        if (sorted.some((at, i) => i > 0 && w.place(at) === where)) n++;
      }
      return n;
    };
    const why = complete ? uncompared(held.first, w) : CUT;
    return ok(
      { value: count("now"), previous: why ? null : count("before"), unit: "count", series: [] },
      "engine",
      got.asOf,
      noteFor(why, "A lead counts once, however many enquiries it sent in the window."),
    );
  });
}
