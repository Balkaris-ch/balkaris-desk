import { lastBeat } from "../db.ts";
import { noticeFor, readsFeed, seesJob, type Holder } from "../grants.ts";
import { status as jobStatus } from "./scheduler.ts";
import { checks as registeredChecks, sources, type Check } from "./sources.ts";
import { activity } from "./store.ts";
import type { ActivityItem, SystemStatus } from "../../web/src/contract/common.ts";

/**
 * The top bar's light, and what stands behind it.
 *
 * The board says "All systems operational". The desk may only say that about
 * things it has actually checked, so the light is assembled from four places
 * and every one of them is a fact:
 *
 *   checks    what the collectors vouch for (src/cc/sources.ts `registerCheck`):
 *             the website answers, the last crawl finished.
 *   jobs      a scheduled job whose LAST RUN FAILED is a failing check. A job
 *             that is not ready (no credential yet), switched off, or has
 *             never run is not a check at all: the desk does not show red for
 *             something that was never meant to be running.
 *   sources   a source that reports itself `failing` turns the light red; one
 *             that is `off` or `waiting` does not.
 *   runner    the workstation's heartbeat, as information only. It is listed
 *             so a person can see whether articles are being written, and it
 *             never turns the light red: the workstation is allowed to be
 *             asleep, that is the premise of the whole arrangement.
 *
 * When nothing has been checked yet the line says exactly that, and `checked`
 * is 0 so the light can be drawn neither green nor red. Green with the words
 * "All systems operational" over zero checks would be the desk inventing a
 * figure.
 */

const AWAKE_MS = 5 * 60_000;

/**
 * A collector's words with any credential in them blanked out.
 *
 * Job notes, check details, source errors and activity are written by the
 * collectors, often from what a source threw, and every signed-in browser is
 * shown them. The collectors keep keys out of their own messages; this is the
 * second lock, at the door, for the one that forgets: a key in a query string
 * (Bing and the Chrome UX Report carry theirs there), a Google API key
 * anywhere, a bearer token.
 */
export function scrub(text: string): string {
  return text
    .replace(/([?&;](?:key|api[-_]?key|token|access[-_]?token|secret|password|sig|signature)=)[^&\s"'<>]+/gi, "$1[hidden]")
    .replace(/\bAIza[\w-]{30,}/g, "[hidden]")
    .replace(/\b(Bearer)\s+[\w.~+/=-]{8,}/gi, "$1 [hidden]");
}

/**
 * Lines of an error that say nothing about why the job failed. A line that
 * matches one of these is never chosen as the "why"; the whole text keeps it.
 * Add a pattern only for a line known to be harmless, with the reason.
 */
const NOISE: readonly RegExp[] = [
  /* llama.cpp, inside Ollama, prints this while it tries context sizes to fit
     the model into the card's memory. Its own words: "this warning is normal
     during memory fitting". It comes before the real cause on every failed
     load, and Ollama's 500 begins with it. */
  /this warning is normal during memory fitting/i,
  /requires ctx_other to be set/i,
  /* Node's hint after a warning: how to find where it came from, not what failed. */
  /^\(Use `node --trace-\w+ \.\.\.` to show where the warning was created\)$/,
  /* Stack frames, Node's ("    at fn (file:1:2)") and Python's ("  File "x.py", line 3, in f"): where, not why. */
  /^at\s+\S.*(:\d+:\d+\)?|\(native\)|<anonymous>\)?)$/,
  /^File ".+", line \d+/,
  /* Python's announcement that a trace follows, and the line joining two of them. */
  /^Traceback \(most recent call last\):$/,
  /^During handling of the above exception, another exception occurred:$/,
];

/**
 * An error's lines. A source's JSON body inside the text (Ollama's
 * `Ollama 500: {"error":"…\n…"}`) is opened up first, so its escaped line
 * breaks become lines; a body cut short by the caller is split on its escaped
 * breaks instead, with the JSON's quoting taken off each line's ends.
 */
function linesOf(text: string): { label: string; lines: string[] } {
  const split = (s: string): string[] =>
    s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  /* "Name 500: {…}": a short label, then a JSON body to the end. */
  const m = /^([^{\n]{0,60}?)\s*:?\s*(\{[\s\S]*)$/.exec(text);
  if (!m) return { label: "", lines: split(text) };
  const label = m[1]!.trim();
  const body = m[2]!;
  let inner: string | null = null;
  try {
    const j = JSON.parse(body) as { error?: unknown; message?: unknown };
    const nested = j.error && typeof j.error === "object" ? (j.error as { message?: unknown }).message : undefined;
    inner = typeof j.error === "string" ? j.error : typeof nested === "string" ? nested : typeof j.message === "string" ? j.message : null;
  } catch {
    /* Cut short (llm.ts keeps 300 characters of Ollama's answer): open it by hand when it is the usual shape. */
    if (/^\{\s*"(?:error|message)"\s*:\s*"/.test(body)) inner = body.replace(/^\{\s*"(?:error|message)"\s*:\s*"/, "").replace(/"\s*\}?\s*$/, "").replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  return inner === null ? { label: "", lines: split(text) } : { label, lines: split(inner) };
}

/**
 * The one line that says why a job failed, for a row with room for one: the
 * LAST line of the error that is not noise (a failing program prints its real
 * cause last, after the warnings it met on the way), with the source's label
 * in front when the line came from inside its body ("Ollama 500: error
 * loading model: vector"). The whole text stays available beside it: this is
 * a choice of line, never a rewrite. Both go through `scrub` first.
 */
export function whyLine(text: string): { line: string; full: string } {
  const full = scrub(text).trim();
  const { label, lines } = linesOf(full);
  const said = lines.filter((l) => !NOISE.some((n) => n.test(l)));
  /* All of it noise: the last line still beats an empty cell. */
  const line = said.at(-1) ?? lines.at(-1) ?? full;
  return { line: label && !line.startsWith(label) ? `${label}: ${line}` : line, full };
}

/** An activity row as a browser is shown it: its words through `scrub`. */
export const scrubItem = (a: ActivityItem): ActivityItem => ({
  ...a,
  text: scrub(a.text),
  ...(a.detail ? { detail: scrub(a.detail) } : {}),
});

/** "3 minutes ago", for a moment given in milliseconds. */
function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 90) return s < 10 ? "just now" : `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** The workstation's heartbeat. Always `ok`: asleep is a state, not a fault. */
function runner(): Check {
  const seen = lastBeat();
  if (!seen) return { name: "Workstation", ok: true, detail: "No runner has asked this desk for work yet." };
  /* SQLite's datetime('now') is UTC without saying so. */
  const at = Date.parse(`${seen.replace(" ", "T")}Z`);
  return Date.now() - at < AWAKE_MS
    ? { name: "Workstation", ok: true, detail: `Awake: it asked for work ${ago(at)}.` }
    : { name: "Workstation", ok: true, detail: `Asleep: it last asked for work ${ago(at)}. Shared links wait in the queue until it wakes.` };
}

/**
 * One check per scheduled job that has something to say: see the note above
 * for which do not. The check and whether it holds are everybody's, since the
 * light is; what the run said is given only to somebody who sees an area the
 * job feeds (src/grants.ts `seesJob`), and anybody else reads that it
 * finished or failed, and when.
 */
function jobs(who?: Holder): Check[] {
  const out: Check[] = [];
  for (const j of jobStatus()) {
    if (!j.ready || !j.enabled || j.lastOk === null) continue;
    const when = j.lastEnd ? ` (${ago(Date.parse(j.lastEnd))})` : "";
    const told = !who || seesJob(who, j.name);
    out.push(
      j.lastOk
        ? { name: j.title, ok: true, detail: `${told ? (j.lastNote ?? "The last run finished") : "The last run finished"}${when}` }
        : { name: j.title, ok: false, detail: told ? `The last run failed${when}: ${j.lastNote ?? "no reason was given"}` : `The last run failed${when}` },
    );
  }
  return out;
}

/** How far back the bell looks for rows a person may be shown, when they may not read the whole feed. */
const BELL_LOOKS_BACK = 100;
const BELL_SHOWS = 10;

/**
 * The bell's rows for one person. Somebody who reads the feed (the Command
 * Center's, src/grants.ts) gets its newest ten, as everybody did. Anybody
 * else gets only the rows that lead to a page they may open, picked from the
 * newest hundred BEFORE cutting to ten, so their bell is not emptied by ten
 * newer rows about parts of the desk they were not given. Always a list,
 * possibly empty: the frame throws the whole status away without one.
 */
function notices(who?: Holder): ActivityItem[] {
  if (!who || readsFeed(who)) return activity(BELL_SHOWS);
  return activity(BELL_LOOKS_BACK)
    .filter((a) => noticeFor(who, a.href))
    .slice(0, BELL_SHOWS);
}

/**
 * What `GET /api/v1/system` answers. Cheap: it reads the database and asks
 * nothing outside. `who` is the person asking, for the two parts that depend
 * on them (the bell, and what each job's last run said); without one
 * (Settings, which is given whole) nothing is left out. The light, its line
 * and the sources are the same for everybody.
 */
export function systemStatus(who?: Holder): SystemStatus {
  const vouched = [...registeredChecks(), ...jobs(who)].map((c) => ({ ...c, detail: scrub(c.detail) }));
  const listed = sources().map((s) => (s.error ? { ...s, error: scrub(s.error) } : s));

  const failing = [
    ...vouched.filter((c) => !c.ok).map((c) => c.name),
    ...listed.filter((s) => s.state === "failing").map((s) => s.name),
  ];
  const answering = listed.filter((s) => s.state === "connected").length;
  /* A failing source answered too, with a failure; it is something checked. */
  const checked = vouched.length + answering + listed.filter((s) => s.state === "failing").length;

  const line = failing.length
    ? `Failing: ${failing[0]}${failing.length > 1 ? ` and ${failing.length - 1} more` : ""}`
    : checked
      ? "All systems operational"
      : "Nothing has been checked yet";

  return {
    /* Nothing failing. With `checked` at 0 that is not a green light, and the
       interface is told so by `checked`, not by turning this false. */
    ok: failing.length === 0,
    checked,
    line,
    checks: [...vouched, runner()],
    sources: listed,
    notices: notices(who).map(scrubItem),
  };
}
