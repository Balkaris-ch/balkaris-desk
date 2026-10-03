import { db } from "./db.ts";
import { areaOfPath, pageOfHref } from "./grants.ts";
import { whenLinked } from "./people.ts";

/**
 * WHAT PEOPLE DO ON THE DESK, as the server sees it.
 *
 * Fini, 3 October 2026: *"…and also see their activity."* The engine learnt
 * the hard way (2026-09-24, a teammate did not show as online) that a beat
 * sent by the page depends on the page, and a request that carries a person's
 * session depends on nothing. So almost everything here is read off the requests at
 * the server's gate (src/server.ts), and the page adds only what a request
 * cannot know: that somebody is still looking at it.
 *
 *   online      any request in the last three minutes. Pages poll while their
 *               tab is visible and stop when it is hidden, so a desk left open
 *               in a background tab goes quiet, as it should.
 *   a page      opened: the GET that draws a screen (/api/v1/traffic), at most
 *               once per page per person per 45 seconds, so a screen that asks
 *               twice on load counts once. Polls (…/live) open nothing.
 *   a minute    on a page: the page's own beat, once a minute while its tab is
 *               visible and the person touched it in the last two minutes
 *               (web/src/components/shell/Beat.tsx). That is attention, not a
 *               tab left open over lunch. Counted here at most once a minute
 *               per person, however many windows beat.
 *   an action   every change a person made that the desk accepted: any POST
 *               that came back as success, the API's and the old console's,
 *               unless its route said it changed nothing. Said in the words
 *               the route itself wrote to the activity feed when it wrote
 *               any, else in this file's table of what each address does.
 *               Nothing is a model's guess.
 *
 * Per person per day, one row in `team_days`; one row per action in
 * `team_actions`. Read by the owner alone (src/cc/routes/team.ts). Both are
 * pruned after 400 days (`prune`), a person's newest day always kept.
 *
 * Every call here is wrapped: a failure to RECORD never costs anybody the
 * request they made.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS team_days (
    person   INTEGER NOT NULL,
    /* YYYY-MM-DD in Zurich: the studio's day. */
    day      TEXT NOT NULL,
    first    TEXT NOT NULL,
    last     TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    minutes  INTEGER NOT NULL DEFAULT 0,
    /* {"traffic": {"opens": 3, "minutes": 12}}: per page, that day. */
    pages    TEXT NOT NULL DEFAULT '{}',
    /* The last page they were on that day, for "where" after a restart. */
    page     TEXT,
    PRIMARY KEY (person, day)
  );

  CREATE TABLE IF NOT EXISTS team_actions (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     TEXT NOT NULL,
    person INTEGER NOT NULL,
    area   TEXT,
    page   TEXT,
    method TEXT NOT NULL,
    path   TEXT NOT NULL,
    status INTEGER NOT NULL,
    text   TEXT NOT NULL,
    href   TEXT
  );
  CREATE INDEX IF NOT EXISTS team_actions_at ON team_actions (at DESC);
  CREATE INDEX IF NOT EXISTS team_actions_person ON team_actions (person, at DESC);
`);

/** Online: a request in the last three minutes. */
export const ONLINE_MS = 3 * 60_000;
const OPEN_DEDUPE_MS = 45_000;
const FLUSH_MS = 60_000;
/** The shortest gap between two counted minutes of one person. A little under a minute: a browser's timer fires late once, then on schedule. */
const BEAT_MS = 55_000;

/** Today in Zurich, as YYYY-MM-DD (the same day src/cc/store.ts `today` means). */
export const zurichDay = (ms = Date.now()): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(ms));

/**
 * The `n` Zurich dates ending with the day of `to`, oldest first. Counted on
 * the calendar, not by stepping back 24 hours at a time: a step repeats a
 * date or skips one on the two days a year the clocks change.
 */
export function zurichDays(to: number, n: number): string[] {
  const [y, m, d] = zurichDay(to).split("-").map(Number) as [number, number, number];
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d - (n - 1 - i))).toISOString().slice(0, 10));
}

/**
 * A day row's pages, read tolerantly: {"traffic": {"opens": 3, "minutes": 12}}.
 * Anything else (a row edited by hand, the text "null", an entry that is not
 * an object) reads as nothing, so one bad row costs its own figures and never
 * the write beside it or the owner's view of that person.
 */
export function pagesOf(raw: unknown): Record<string, { opens: number; minutes: number }> {
  let v: unknown = null;
  try {
    v = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, { opens: number; minutes: number }> = {};
  for (const [key, e] of Object.entries(v as Record<string, unknown>)) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const { opens, minutes } = e as { opens?: unknown; minutes?: unknown };
    out[key] = { opens: Number(opens) || 0, minutes: Number(minutes) || 0 };
  }
  return out;
}

interface Live {
  /** Last request, ms. */
  last: number;
  /** Where they are: the last page a beat named, else the last page opened. */
  page: string | null;
  pageAt: number;
  /** When a minute was last counted for them, on any page: one clock per person. */
  beatAt: number;
  /** Not yet written: */
  hits: number;
  opens: Record<string, number>;
  minutes: Record<string, number>;
  lastOpen: Record<string, number>;
  flushed: number;
}

const LIVE = new Map<number, Live>();

const live = (person: number): Live => {
  let l = LIVE.get(person);
  if (!l) {
    l = { last: 0, page: null, pageAt: 0, beatAt: 0, hits: 0, opens: {}, minutes: {}, lastOpen: {}, flushed: Date.now() };
    LIVE.set(person, l);
  }
  return l;
};

/**
 * The GETs that draw a screen, and the page each one is. Anchored, so a
 * screen's polls (…/live, …/state, /seo/nav, /seo/audit) and its exports open
 * nothing. Keep in step with the screens' own requests.
 */
const OPENS: [RegExp, string][] = [
  [/^\/api\/v1\/overview$/, "overview"],
  [/^\/api\/v1\/activity$/, "overview"],
  [/^\/api\/v1\/insights$/, "insights"],
  [/^\/api\/v1\/article\/(?:link\/)?[^/]+$/, "insights"],
  [/^\/api\/v1\/traffic$/, "traffic"],
  [/^\/api\/v1\/seo\/overview$/, "seo"],
  [/^\/api\/v1\/seo\/(opportunities|pages|keywords|content-gaps|backlinks|technical|search-console|competitors|ai-search|automations)$/, "seo/$1"],
  [/^\/api\/v1\/seo\/optimize$/, "seo/pages"],
  [/^\/api\/v1\/pages(?:\/view)?$/, "pages"],
  [/^\/api\/v1\/(content|conversions|leads|experiments|automations|assets|operator|settings)$/, "$1"],
  [/^\/api\/v1\/health(?:\/logs|\/deployments)?$/, "site-health"],
  [/^\/api\/v1\/hosting(?:\/builds\/[^/]+)?$/, "hosting"],
  [/^\/api\/v1\/team\/activity$/, "team"],
  [/^\/api\/v1\/team\/(members|access|invitations)$/, "team/$1"],
];

/** The page a screen's GET opens, or null for a poll, an export, anything else. */
export function opened(path: string): string | null {
  for (const [re, page] of OPENS) {
    const m = re.exec(path);
    if (m) return page.replace("$1", m[1] ?? "");
  }
  return null;
}

/** Write what is pending for one person into today's row. */
function flush(person: number, l: Live, now = Date.now()): void {
  const pending = l.hits || Object.keys(l.opens).length || Object.keys(l.minutes).length;
  l.flushed = now;
  if (!pending) return;
  const day = zurichDay(now);
  const at = new Date(l.last || now).toISOString();
  const had = db.prepare("SELECT pages, minutes FROM team_days WHERE person = ? AND day = ?").get(person, day) as { pages: string; minutes: number } | undefined;
  const pages = pagesOf(had?.pages);
  let added = 0;
  for (const [k, n] of Object.entries(l.opens)) (pages[k] ??= { opens: 0, minutes: 0 }).opens += n;
  for (const [k, n] of Object.entries(l.minutes)) {
    (pages[k] ??= { opens: 0, minutes: 0 }).minutes += n;
    added += n;
  }
  db.prepare(
    `INSERT INTO team_days (person, day, first, last, requests, minutes, pages, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(person, day) DO UPDATE SET last = excluded.last, requests = requests + excluded.requests,
       minutes = minutes + excluded.minutes, pages = excluded.pages, page = coalesce(excluded.page, page)`,
  ).run(person, day, at, at, l.hits, added, JSON.stringify(pages), l.page);
  l.hits = 0;
  l.opens = {};
  l.minutes = {};
  pruneDaily(now);
}

/** Write everything pending, for everybody: before the owner reads, so what the owner reads is current. One person's row that will not write does not hold back the others'. */
export function flushAll(): void {
  for (const [person, l] of LIVE) {
    try {
      flush(person, l);
    } catch (e) {
      console.error("presence: could not write what was pending:", e);
    }
  }
  pruneDaily();
}

/* ---------- what is kept, and for how long ------------------------------------- */

/** The screens read at most 180 days back; 400 keeps a year to compare with, as the desk's other daily records do. */
const KEEP_DAYS = 400;

/**
 * Delete what is older than `KEEP_DAYS`: actions by their moment, day rows by
 * their day. A person's NEWEST day row is kept whatever its age: it is how
 * the desk knows somebody has ever been here and when they last were, and
 * without it a person last seen over a year ago would read as never seen.
 */
export function prune(now = Date.now()): void {
  const cut = now - KEEP_DAYS * 86_400_000;
  /* `at` is an ISO moment (T and Z), so it is compared with one, never with SQLite's datetime(). */
  db.prepare("DELETE FROM team_actions WHERE at < ?").run(new Date(cut).toISOString());
  db.prepare("DELETE FROM team_days WHERE day < ? AND day < (SELECT MAX(day) FROM team_days d WHERE d.person = team_days.person)").run(zurichDay(cut));
}

let prunedOn: string | null = null;

/** `prune`, at most once per Zurich day, and never at anybody's cost: it runs after the write it follows, in its own try. */
function pruneDaily(now = Date.now()): void {
  const today = zurichDay(now);
  if (prunedOn === today) return;
  prunedOn = today;
  try {
    prune(now);
  } catch (e) {
    console.error("presence: the old record was not pruned:", e);
  }
}

/**
 * A request by a signed-in person, at the gate. Never throws.
 *
 * Only the desk's own API counts: the interface's server asks it on the
 * person's behalf for every screen it draws, and their browser for every
 * poll. A request the gate refused still says they are here, but opens no
 * page: they never saw it.
 */
export function seen(person: number, path: string, method: string, allowed = true): void {
  try {
    const now = Date.now();
    const l = live(person);
    l.last = now;
    l.hits++;
    if (method === "GET" && allowed) {
      const page = opened(path);
      if (page && now - (l.lastOpen[page] ?? 0) > OPEN_DEDUPE_MS) {
        l.lastOpen[page] = now;
        l.opens[page] = (l.opens[page] ?? 0) + 1;
        if (now - l.pageAt > OPEN_DEDUPE_MS || !l.page) {
          l.page = page;
          l.pageAt = now;
        }
      }
    }
    if (now - l.flushed >= FLUSH_MS) flush(person, l, now);
  } catch (e) {
    console.error("presence: a request was not recorded:", e);
  }
}

/**
 * The page's beat: "open" when a screen is shown, "beat" once a minute of
 * attention. `href` is the address in their browser, which says exactly
 * which page (a request cannot: the SEO layout asks the same things for
 * every SEO page); null for a page that refused them, which says they are
 * here and nothing about where.
 *
 * A MINUTE IS COUNTED AT MOST ONCE A MINUTE PER PERSON, whatever is sent: two
 * desk windows side by side each beat, and anybody signed in can post this
 * address as often as they like. That keeps the figure inside real time. It
 * does not prove attention: that part is the page's word (Beat.tsx).
 */
export function beat(person: number, href: string | null, kind: "open" | "beat"): void {
  try {
    const now = Date.now();
    const l = live(person);
    const page = href === null ? null : (pageOfHref(href)?.key ?? null);
    l.last = now;
    if (page) {
      l.page = page;
      l.pageAt = now;
    }
    /* The clock moves only when a minute is counted: moved by every beat, two windows half a minute out
       of step would reset it for each other and the person would never earn one. */
    if (kind === "beat" && page && now - l.beatAt >= BEAT_MS) {
      l.beatAt = now;
      l.minutes[page] = (l.minutes[page] ?? 0) + 1;
    }
    flush(person, l, now);
  } catch (e) {
    console.error("presence: a beat was not recorded:", e);
  }
}

/** Is this person on the desk now, and where. From memory: no read. */
export function now(person: number): { online: boolean; last: number | null; page: string | null } {
  const l = LIVE.get(person);
  if (!l || !l.last) return { online: false, last: null, page: null };
  return { online: Date.now() - l.last < ONLINE_MS, last: l.last, page: l.page };
}

/* ---------- actions ------------------------------------------------------------- */

/**
 * What each address does, for a change whose route wrote nothing to the
 * activity feed. First match wins. "$1" is the first group.
 */
const SAID: [RegExp, string][] = [
  [/^\/draft\/\d+\/publish$/, "Published an article at its address"],
  [/^\/draft\/\d+\/list$/, "Listed an article on the site"],
  [/^\/draft\/\d+\/unlist$/, "Took an article out of the menus"],
  [/^\/draft\/\d+\/takedown$/, "Took an article off the site"],
  [/^\/draft\/\d+\/remove$/, "Deleted a draft"],
  [/^\/draft\/\d+\/reclose$/, "Asked for a new closing"],
  [/^\/draft\/\d+\/attach$/, "Changed whether an article carries its video"],
  [/^\/draft\/\d+\/clip$/, "Changed an article's clip"],
  [/^\/draft\/\d+\/redraw$/, "Asked for a new cover"],
  [/^\/link\/\d+\/retry$/, "Retried a shared link"],
  [/^\/api\/v1\/insights\/create$/, "Started a new insight"],
  [/^\/api\/v1\/insights\/retry\//, "Retried a shared link"],
  [/^\/api\/v1\/jobs\/([^/]+)\/run$/, "Ran “$1” ahead of its schedule"],
  [/^\/api\/v1\/jobs\/([^/]+)\/enabled$/, "Switched “$1” on or off"],
  [/^\/api\/v1\/automations\/run-due$/, "Ran the jobs that were due"],
  [/^\/api\/v1\/experiments\/saved\/[^/]+\/delete$/, "Deleted a saved comparison"],
  [/^\/api\/v1\/experiments\/saved$/, "Saved a comparison"],
  [/^\/api\/v1\/operator\/tasks\/[^/]+\/cancel$/, "Cancelled an AI Operator task"],
  [/^\/api\/v1\/operator\/tasks$/, "Asked the AI Operator"],
  [/^\/api\/v1\/operator\/proposals\/[^/]+\/approve$/, "Approved an AI Operator proposal"],
  [/^\/api\/v1\/operator\/proposals\/[^/]+\/reject$/, "Rejected an AI Operator proposal"],
  [/^\/api\/v1\/operator\/proposals\/[^/]+\/withdraw$/, "Withdrew an AI Operator proposal"],
  [/^\/api\/v1\/operator\/proposals$/, "Sent a proposal to the AI Operator"],
  [/^\/api\/v1\/operator\/todos/, "Updated the AI Operator's to-dos"],
  [/^\/api\/v1\/operator\/refresh$/, "Refreshed the AI Operator"],
  [/^\/api\/v1\/seo\/audit$/, "Started a full SEO audit"],
  [/^\/api\/v1\/spider\/audit$/, "Audited a page"],
  [/^\/api\/v1\/spider\/extract/, "Changed a custom extraction rule"],
  [/^\/api\/v1\/seo\/indexing\/requested$/, "Marked a page as sent to Google"],
  [/^\/api\/v1\/seo\/owner-tasks\//, "Closed an SEO step"],
  [/^\/api\/v1\/seo\/([a-z-]+)/, "Worked on SEO › $1"],
  [/^\/api\/v1\/settings\/people\/[^/]+\/access$/, "Switched somebody off or on"],
  [/^\/api\/v1\/settings\/people\/[^/]+\/link$/, "Linked two accounts"],
  [/^\/api\/v1\/settings\/people\//, "Changed a person's details"],
  [/^\/api\/v1\/team\/access\//, "Changed somebody's access"],
  [/^\/api\/v1\/team\/settings$/, "Changed what newcomers get"],
  [/^\/api\/v1\/team\/invitations\/[^/]+\/withdraw$/, "Withdrew an invitation"],
  [/^\/api\/v1\/team\/invitations$/, "Invited somebody"],
  [/^\/people\/[^/]+\/revoke$/, "Switched somebody off or on"],
  [/^\/people\/[^/]+\/link$/, "Linked two accounts"],
  [/^\/people\//, "Changed a person's details"],
];

const humanise = (path: string): string => {
  for (const [re, text] of SAID) {
    const m = re.exec(path);
    if (m) return text.replace("$1", m[1] ?? "");
  }
  return `Changed something at ${path}`;
};

/** Not actions: bookkeeping that changes nothing anybody cares about. */
const QUIET = ["/api/v1/team/beat", "/logout"];

/** The newest row of the activity feed, so the notes a request writes can be found afterwards. Null when the feed does not exist. */
export function feedMark(): number | null {
  try {
    return (db.prepare("SELECT MAX(id) AS m FROM cc_activity").get() as { m: number | null }).m ?? 0;
  } catch {
    return null;
  }
}

/**
 * A change a person made, after the desk answered it. Only what succeeded is
 * written: under /api a 2xx, on the old console a redirect. (Most of its forms
 * answer a failure with a page that says so, status 200, or a 404; the few
 * that redirect without having done anything say so with `did`, below.)
 *
 * The sentence is the route's own: `did` when it said what it did for this
 * record alone (the Team routes, whose changes are the owner's business and
 * not the whole desk's feed), else a note it wrote to the feed in this
 * person's name (`mark` is `feedMark()` from before the request), else this
 * file's table.
 *
 * `did` set to NULL is the route saying "accepted, and nothing changed": the
 * same value saved again, a link already on the desk, a bulk action that did
 * none of its rows. Nothing is written then. This is opt-in, route by route:
 * a route that never sets it is recorded on its status alone, so the table's
 * sentence for it means "the desk accepted this request", not a proof that
 * something moved.
 */
export function acted(
  person: { telegram: number; name: string },
  path: string,
  method: string,
  status: number,
  mark: number | null,
  did?: { text: string; href?: string } | null,
): void {
  try {
    if (/^(GET|HEAD|OPTIONS)$/i.test(method) || QUIET.includes(path)) return;
    if (did === null) return;
    const api = path.startsWith("/api/");
    if (api ? status < 200 || status >= 300 : status < 300 || status >= 400) return;
    let text = humanise(path);
    let href: string | null = null;
    if (did) {
      text = did.text;
      href = did.href ?? null;
    } else if (mark !== null) {
      const note = db.prepare("SELECT text, href FROM cc_activity WHERE id > ? AND actor = ? ORDER BY id LIMIT 1").get(mark, person.name) as
        | { text: string; href: string | null }
        | undefined;
      if (note) {
        text = note.text;
        href = note.href;
      }
    }
    /* Running a job belongs to no area: it is counted as one of its own, a refresh. Switching one on or off is Automations'. */
    const job = /^\/api\/v1\/jobs\/[^/]+\/(run|enabled)$/.exec(path)?.[1];
    const area = areaOfPath(path)?.key ?? (job === "run" ? "refresh" : job === "enabled" ? "automations" : null);
    const draft = /^\/draft\/(\d+)\//.exec(path)?.[1];
    const link = /^\/link\/(\d+)\//.exec(path)?.[1];
    href ??= draft ? `/insights/${draft}` : link ? `/insights/link/${link}` : null;
    db.prepare("INSERT INTO team_actions (at, person, area, page, method, path, status, text, href) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      new Date().toISOString(),
      person.telegram,
      area,
      null,
      method.toUpperCase(),
      path.slice(0, 200),
      status,
      text.slice(0, 240),
      href,
    );
  } catch (e) {
    console.error("presence: an action was not recorded:", e);
  }
}

/* When two rows become one person (src/people.ts `link`), their days and actions follow the row that is kept. */
whenLinked((from, to) => {
  try {
    flushAll();
    db.prepare("UPDATE OR IGNORE team_days SET person = ? WHERE person = ?").run(to, from);
    db.prepare("DELETE FROM team_days WHERE person = ?").run(from);
    db.prepare("UPDATE team_actions SET person = ? WHERE person = ?").run(to, from);
    const l = LIVE.get(from);
    if (l) {
      LIVE.delete(from);
      LIVE.set(to, l);
    }
  } catch (e) {
    console.error("presence: a link was not followed:", e);
  }
});
