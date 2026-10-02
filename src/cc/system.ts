import { lastBeat } from "../db.ts";
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

/** One check per scheduled job that has something to say: see the note above for which do not. */
function jobs(): Check[] {
  const out: Check[] = [];
  for (const j of jobStatus()) {
    if (!j.ready || !j.enabled || j.lastOk === null) continue;
    const when = j.lastEnd ? ` (${ago(Date.parse(j.lastEnd))})` : "";
    out.push(
      j.lastOk
        ? { name: j.title, ok: true, detail: `${j.lastNote ?? "The last run finished"}${when}` }
        : { name: j.title, ok: false, detail: `The last run failed${when}: ${j.lastNote ?? "no reason was given"}` },
    );
  }
  return out;
}

/** What `GET /api/v1/system` answers. Cheap: it reads the database and asks nothing outside. */
export function systemStatus(): SystemStatus {
  const vouched = [...registeredChecks(), ...jobs()].map((c) => ({ ...c, detail: scrub(c.detail) }));
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
    notices: activity(10).map(scrubItem),
  };
}
