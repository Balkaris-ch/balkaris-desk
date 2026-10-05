import { db } from "../../db.ts";
import * as tg from "../../telegram.ts";
import type { Tone } from "../../../web/src/contract/common.ts";
import type { SeoDigest, SeoDigestLine } from "../../../web/src/contract/seo/automations.ts";
import { status as jobStatus } from "../scheduler.ts";
import { note, setState, state } from "../store.ts";
import { scrub } from "../system.ts";
import { runTally, standings, watched } from "./jobs.ts";
import { json } from "./tables.ts";

/**
 * The week, in short: one job (seo-digest, weekly, in ./jobs.ts) gathers what
 * the SEO jobs did and found since the last summary into a few plain lines,
 * keeps them for SEO › Automations, and, when the owner has said so on that
 * page, sends them to him on Telegram through the desk's own door
 * (src/telegram.ts `tellOwner`).
 *
 * Every figure is counted from the table its job writes; a table that cannot
 * be read leaves its line out instead of saying 0. Nothing outside the box is
 * asked, except Telegram when the owner switched it on.
 */

/** The kept summaries, newest first, and the owner's say on Telegram. */
const KEPT = "seo:digest";
const TELEGRAM = "seo:digest:telegram";
/** Summaries kept for the page. */
const KEEP = 8;
const DAY = 86_400_000;

/**
 * The desk's door to the owner on Telegram (src/telegram.ts `tellOwner` and
 * `ownerChat`, added on master on 5 October 2026 for outages). Read through
 * the module's namespace so this file works on a desk built before that door
 * existed: there it is simply not ready, and the summary stays on the page.
 */
const door = tg as unknown as { esc: (s: string) => string; tellOwner?: (html: string) => Promise<boolean>; ownerChat?: () => number | null };

/** Where the summary is sent, and whether it can be. The check script replaces both, so nothing is sent from a check. */
export const wire = {
  tell: (html: string): Promise<boolean> => (door.tellOwner ? door.tellOwner(html) : Promise.resolve(false)),
  ready: (): boolean => !!door.tellOwner && !!door.ownerChat && !!(process.env.TELEGRAM_BOT_TOKEN ?? "").trim() && door.ownerChat() !== null,
};

/** The log's kinds the SEO section writes (src/cc/routes/seo/shared.ts SEO_KINDS, repeated so a job does not load a screen's helpers). */
const KINDS = ["seo", "seo-action", "seo-state", "seo-import", "seo-research", "seo-ai", "seo-competitors", "seo-presence", "gsc.indexed", "gsc.dropped", "seo-backlinks"];

/** A count from one of the desk's tables, or null when it cannot be read: a line is then left out, never shown as 0. */
const counted = (sql: string, ...args: (string | number)[]): number | null => {
  try {
    return (db.prepare(sql).get(...args) as { n: number | null }).n ?? 0;
  } catch {
    return null;
  }
};

const count = (n: number): string => n.toLocaleString("en-GB");
const plural = (n: number, one: string, many = `${one}s`): string => `${count(n)} ${n === 1 ? one : many}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "5 Oct", by the studio's clock, as the desk's screens print a day. */
const day = (iso: string): string => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)).split("-");
  return y && m && d ? `${Number(d)} ${MONTHS[Number(m) - 1]}` : iso.slice(0, 10);
};

/** The summaries kept, newest first. */
export function digests(): SeoDigest[] {
  const list = json<SeoDigest[]>(state(KEPT), []);
  return Array.isArray(list) ? list : [];
}

/** Whether the owner asked for the summary on Telegram, and whether the desk can send it there at all. */
export function telegram(): { on: boolean; ready: boolean } {
  let ready = false;
  try {
    ready = wire.ready();
  } catch {
    ready = false;
  }
  return { on: state(TELEGRAM) === "on", ready };
}

/** The owner says yes or no to the summary on Telegram. */
export function setTelegram(on: boolean, by: string): void {
  const had = telegram().on;
  setState(TELEGRAM, on ? "on" : "off");
  if (had !== on) note("seo", on ? "The week's SEO summary will be sent on Telegram" : "The week's SEO summary is no longer sent on Telegram", { tone: "info", actor: by, href: "/seo/automations#digest" });
}

/**
 * Gather the lines for the time since `since`. Exported for the check script;
 * the job calls `writeDigest`.
 */
export function gather(since: string, nowMs = Date.now()): SeoDigestLine[] {
  const lines: SeoDigestLine[] = [];
  const add = (text: string, tone: Tone = "info", href: string | null = null) => lines.push({ text, tone, href });
  /* Jobs by their titles, as the page names them; a job the scheduler does not list keeps its name. */
  const titles = new Map(jobStatus().map((j) => [j.name, j.title]));
  const named = (n: string): string => titles.get(n) ?? n;

  /* The runs, from the scheduler's week and the SEO section's own longer copy. */
  try {
    let ok = 0;
    let failed = 0;
    let open = 0;
    for (const r of runTally(since)) {
      ok += r.ok;
      failed += r.failed;
      open += r.open;
    }
    /* The open row of a job running now (this summary's own run among them) is a run in progress, not one a restart cut off. */
    open = Math.max(0, open - jobStatus().filter((j) => j.running && j.lastStart !== null && j.lastStart >= since).length);
    add(`Runs: ${count(ok)} finished, ${count(failed)} failed${open ? `, ${count(open)} cut off by a restart` : ""}.`, failed ? "warn" : "good", "/seo/automations");
  } catch {
    /* The run tables could not be read: no line rather than a zero. */
  }

  /* Which jobs are late or failing now. */
  try {
    const stands = standings(nowMs);
    const names = new Set(watched());
    const rows = db.prepare("SELECT name, enabled, last_ok FROM cc_jobs").all() as { name: string; enabled: number; last_ok: number | null }[];
    const failing = rows.filter((r) => names.has(r.name) && r.enabled && r.last_ok === 0).map((r) => named(r.name));
    /* A failing job that is also late is said once, as failing. */
    const late = [...stands].filter(([n, s]) => s.lateSince && !failing.includes(named(n))).map(([n]) => named(n));
    if (failing.length) add(`Failing now: ${failing.join("; ")}.`, "bad", "/seo/automations");
    if (late.length) add(`Late now: ${late.join("; ")}.`, "warn", "/seo/automations");
    if (!failing.length && !late.length) add("Every SEO job that is on ran at its time and its last run finished.", "good");
  } catch {
    /* As above. */
  }

  const fresh = counted("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE first_seen >= ?", since);
  const cleared = counted("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE active = 0 AND cleared_at >= ?", since);
  const openOpps = counted("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE active = 1");
  if (fresh !== null && openOpps !== null) {
    add(`Opportunities: ${count(fresh)} new${cleared !== null ? `, ${count(cleared)} the rules no longer find` : ""}; ${count(openOpps)} open in all.`, "info", "/seo/opportunities");
  }

  const indexed = counted("SELECT COUNT(*) AS n FROM cc_activity WHERE kind = 'gsc.indexed' AND at >= ?", since);
  const dropped = counted("SELECT COUNT(*) AS n FROM cc_activity WHERE kind = 'gsc.dropped' AND at >= ?", since);
  let now: { day: string; value: number } | null = null;
  try {
    now = (db.prepare("SELECT day, value FROM cc_series WHERE metric = 'gsc.indexed' ORDER BY day DESC LIMIT 1").get() as { day: string; value: number } | undefined) ?? null;
  } catch {
    now = null;
  }
  if (indexed !== null && dropped !== null) {
    add(
      `Google's index: ${plural(indexed, "page")} newly indexed, ${plural(dropped, "page")} dropped${now ? `; ${plural(Math.round(now.value), "page")} indexed at the last whole check (${day(`${now.day}T12:00:00Z`)})` : ""}.`,
      dropped ? "warn" : "info",
      "/seo/technical#indexing",
    );
  }

  /* As the page counts them: a phrase the audit's import brought in is the audit's, not a job's. */
  const phrases = counted("SELECT COUNT(*) AS n FROM cc_seo_keywords WHERE first_seen >= ? AND sources LIKE '%autocomplete%' AND sources NOT LIKE '%audit%'", since);
  const queries = counted("SELECT COUNT(*) AS n FROM cc_seo_keywords WHERE first_seen >= ? AND sources LIKE '%gsc%' AND sources NOT LIKE '%audit%' AND sources NOT LIKE '%autocomplete%'", since);
  if (phrases !== null && queries !== null) {
    add(`Keywords: ${plural(phrases, "new phrase")} from Google Autocomplete, ${plural(queries, "new search", "new searches")} seen in Search Console.`, "info", "/seo/keywords");
  }

  const proposals = counted("SELECT COUNT(*) AS n FROM cc_proposals WHERE state = 'waiting'");
  const steps = counted("SELECT COUNT(*) AS n FROM cc_seo_owner_tasks WHERE done = 0 AND who = 'owner'");
  const hand = counted("SELECT COUNT(*) AS n FROM cc_seo_owner_tasks WHERE done = 0 AND who = 'lead-chrome'");
  const people = [
    proposals !== null && proposals ? `${plural(proposals, "proposal")} to approve` : null,
    steps !== null && steps ? `${plural(steps, "owner step")} open` : null,
    hand !== null && hand ? `${plural(hand, "step")} to do by hand in the browser` : null,
  ].filter((x): x is string => !!x);
  if (people.length) add(`Waiting for people: ${people.join(", ")}.`, "info", "/seo#needs-you");

  /* What went wrong or needs a look, in the jobs' own words: the newest five. */
  try {
    const marks = KINDS.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT text, tone, href FROM cc_activity WHERE at >= ? AND kind IN (${marks}) AND tone IN ('warn', 'bad') ORDER BY at DESC LIMIT 5`)
      .all(since, ...KINDS) as { text: string; tone: Tone; href: string | null }[];
    for (const r of rows) add(scrub(r.text), r.tone, r.href && r.href.startsWith("/") ? r.href : null);
  } catch {
    /* No log to read. */
  }
  return lines;
}

/** The lines as one Telegram message: HTML as `send` takes it, everything that is not ours escaped. */
export function asMessage(d: SeoDigest): string {
  const base = (process.env.DESK_URL ?? "https://desk.balkaris.ch").replace(/\/$/, "");
  return [`<b>SEO, ${door.esc(day(d.since))} to ${door.esc(day(d.at))}</b>`, ...d.lines.map((l) => `• ${door.esc(l.text)}`), "", `${door.esc(base)}/seo/automations`].join("\n");
}

/**
 * The job: write the summary since the last one (a week at most, two weeks
 * when the last one is older), keep it, and send it when the owner said so.
 * Returns the job's line.
 */
export async function writeDigest(nowMs = Date.now()): Promise<string> {
  const kept = digests();
  const at = new Date(nowMs).toISOString();
  const lastAt = kept[0]?.at ? Date.parse(kept[0].at) : null;
  const sinceMs = lastAt !== null && nowMs - lastAt <= 14 * DAY ? lastAt : nowMs - 7 * DAY;
  const since = new Date(sinceMs).toISOString();
  const lines = gather(since, nowMs);
  const t = telegram();
  const d: SeoDigest = { at, since, lines, sent: null };
  if (t.on) {
    d.sent = t.ready ? await wire.tell(asMessage(d)).catch(() => false) : false;
  }
  setState(KEPT, JSON.stringify([d, ...kept].slice(0, KEEP)));
  note("seo", "The week's SEO summary is written", {
    tone: "info",
    detail: `${plural(lines.length, "line")} for ${day(since)} to ${day(at)}${d.sent === true ? "; sent on Telegram" : d.sent === false ? "; Telegram could not take it" : ""}.`,
    href: "/seo/automations#digest",
    dedupe: `seo:digest:${at}`,
  });
  return `${plural(lines.length, "line")} for ${day(since)} to ${day(at)}${d.sent === true ? ", sent on Telegram" : d.sent === false ? `, not sent: ${t.ready ? "Telegram did not take it" : "the desk's Telegram bot or the owner's chat is not set"}` : ", kept on the page (Telegram is off)"}`;
}
