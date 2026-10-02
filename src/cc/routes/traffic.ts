import { Hono } from "hono";
import type { Vars } from "../access.ts";
import { specimenAllowed } from "../specimen.ts";
import { ok, reading, waiting } from "../store.ts";
import type { DayPoint, Range, Reading, Stat } from "../../../web/src/contract/common.ts";
import type {
  TrafficCities,
  TrafficCityRow,
  TrafficClarity,
  TrafficClarityRow,
  TrafficCountryRow,
  TrafficDeviceRow,
  TrafficEventRow,
  TrafficLandingRow,
  TrafficLinks,
  TrafficLive,
  TrafficPageRow,
  TrafficPayload,
  TrafficPerDay,
  TrafficPeriod,
  TrafficSourceRow,
  TrafficTiles,
  TrafficChannels,
} from "../../../web/src/contract/traffic.ts";
import type { Ask, Days, Live, Read, Report, SiteEvent, Span, Totals } from "../ga4.ts";

/**
 * /api/v1/traffic: who visits balkaris.ch, how they arrive and what they read.
 *
 *   GET /?range=7d|30d|90d|1y   the whole screen, one payload
 *   GET /live                   the live panel alone, for the browser's poll
 *
 * Everything is GA4 history (consenting visitors only, narrowed to the
 * website's host by ga4.ts), the GA4 realtime panel, the desk's own crawl for
 * page titles and pictures, and Clarity's daily snapshot when it is connected.
 * Nothing here asks a source without its cache: GA4 reads are kept for fifteen
 * minutes (realtime under two), the crawl and Clarity are read from what their
 * jobs stored.
 *
 * Each source is loaded with import(), so a collector that fails to load costs
 * the panels it feeds and not the screen, and each panel is its own reading().
 *
 * `?specimen=1` (development only, decided by specimenAllowed) feeds the
 * Clarity panel from SPECIMEN_CLARITY below while Clarity has no token.
 */

export const routes = new Hono<Vars>();

const ga4 = () => import("../ga4.ts");
const site = () => import("../site/index.ts");
const clarity = () => import("../search/clarity.ts");

/** The ranges the screen offers; anything else reads as 30 days. */
const RANGES = ["7d", "30d", "90d", "1y"] as const satisfies readonly Range[];
type TrafficRange = (typeof RANGES)[number];
const rangeOf = (asked: string | undefined): TrafficRange => RANGES.find((r) => r === asked?.toLowerCase()) ?? "30d";

/** Every read on this screen is a person looking: it keeps the live poller awake (ga4.ts, `touch`). */
const ASK: Ask = { screen: true };

/**
 * A screen is drawn within this, whatever GA4 is doing. GA4 answers one
 * question at a time and a cold range is about twenty of them; a panel that
 * misses the moment says so and fills on the next load, because the question
 * it asked is still answered and kept.
 */
const PATIENCE_MS = 14_000;

const SLOW = "GA4 is still answering this one. It is kept as soon as it arrives: reload in a moment.";

function inTime<T>(work: Promise<Reading<T>>, until: number, source: Reading<T>["source"] = "ga4"): Promise<Reading<T>> {
  const left = Math.max(0, until - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Reading<T>>((resolve) => {
    timer = setTimeout(() => resolve(waiting(source, SLOW)), left);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** The earlier of two readings' times, and the first one's caveat: a figure is as old as its oldest part. */
function joined<A, B, T>(a: Reading<A>, b: Reading<B>, make: (a: A, b: B) => T): Reading<T> {
  if (a.state !== "ok") return a;
  if (b.state !== "ok") return b;
  const asOf = a.asOf < b.asOf ? a.asOf : b.asOf;
  return ok(make(a.value, b.value), a.source, asOf, a.note);
}

const ratio = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

/* ---------- the crawl: titles and pictures ------------------------------- */

interface Known {
  title: string | null;
  picture: string | null;
}

const siteBase = (): string => (process.env.SITE_BASE ?? "https://www.balkaris.ch").replace(/\/+$/, "");

/** Address → title and share picture, from the desk's last crawl. Empty when there has been none. */
async function knownPages(): Promise<Map<string, Known>> {
  try {
    const s = await site();
    const inv = s.inventory();
    if (inv.state !== "ok") return new Map();
    const base = siteBase();
    return new Map(
      inv.value.map((p) => {
        let picture: string | null = null;
        if (p.sharePicture) {
          try {
            const u = new URL(p.sharePicture, `${base}/`);
            picture = u.protocol === "https:" ? u.toString() : null;
          } catch {
            picture = null;
          }
        }
        return [p.path, { title: p.title, picture }];
      }),
    );
  } catch {
    return new Map();
  }
}

/** Title → address, for the titles that exactly one crawled page carries. */
function byTitle(pages: Map<string, Known>): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const [path, k] of pages) {
    if (!k.title) continue;
    seen.set(k.title, seen.has(k.title) ? null : path);
  }
  return new Map([...seen].filter((e): e is [string, string] => e[1] !== null));
}

/* ---------- what GA4's own events mean ----------------------------------- */

/**
 * GA4's automatically collected and enhanced-measurement events, in a few
 * words, as Google documents them. The website's own five are described in
 * ga4.ts (`SITE_EVENTS`), from its source.
 */
const GA4_EVENTS: Record<string, string> = {
  page_view: "A page was shown",
  session_start: "A visit began",
  first_visit: "A browser's first visit",
  user_engagement: "A page stayed in focus for a second or more",
  scroll: "Scrolled to 90% of a page's height",
  click: "A link to another site was followed",
  form_start: "A form on a page was first used",
  form_submit: "A form on a page was sent",
  file_download: "A file was downloaded",
  view_search_results: "Site search results were shown",
  video_start: "An embedded video started",
  video_progress: "An embedded video passed 10, 25, 50 or 75%",
  video_complete: "An embedded video played to the end",
};

/* ---------- specimen: Clarity before its token exists -------------------- */

/**
 * SPECIMEN rows for the Clarity panel, shown only with ?specimen=1 on a
 * development desk (specimenAllowed) and only while Clarity is not connected.
 * Addresses that do not exist and round figures halving down the list: they
 * cannot be mistaken for the website's own.
 */
const SPECIMEN_CLARITY: TrafficClarity = {
  day: "2000-01-01",
  span: 1,
  sessions: 160,
  rageClicks: 8,
  deadClicks: 16,
  quickBacks: 4,
  scriptErrors: 2,
  callsLeft: 6,
  rows: [
    { path: "/specimen-a", sessions: 80, scrollDepth: 80, activeTime: 80, rageClicks: 4, deadClicks: 8, quickBacks: 2, scriptErrors: 1 },
    { path: "/specimen-b", sessions: 40, scrollDepth: 60, activeTime: 40, rageClicks: 2, deadClicks: 4, quickBacks: 1, scriptErrors: 1 },
    { path: "/specimen-c", sessions: 20, scrollDepth: 40, activeTime: 20, rageClicks: 1, deadClicks: 2, quickBacks: 1, scriptErrors: 0 },
    { path: "/specimen-d", sessions: 10, scrollDepth: 20, activeTime: 10, rageClicks: 1, deadClicks: 1, quickBacks: 0, scriptErrors: 0 },
    { path: "/specimen-e", sessions: 10, scrollDepth: null, activeTime: null, rageClicks: 0, deadClicks: 1, quickBacks: 0, scriptErrors: 0 },
  ],
};

const SPECIMEN_NOTE = "SPECIMEN: artificial rows standing in for Clarity, which is not connected. None of these figures is real.";

/* ---------- the panels --------------------------------------------------- */

type Ga4 = Awaited<ReturnType<typeof ga4>>;

/** The period, from the totals read, as the screen prints it. */
function periodOf(span: Span): TrafficPeriod {
  return {
    start: span.start,
    end: span.end,
    days: span.days,
    since: span.since,
    partial: span.partial,
    previous: span.previous,
    provisionalFrom: span.provisionalFrom,
  };
}

/** The days of the period that were measured, oldest first. */
function daysOf(span: Span): string[] {
  const out: string[] = [];
  const shift = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  for (let d = span.since > span.start ? span.since : span.start; d <= span.end; d = shift(d)) out.push(d);
  return out;
}

const stat = (value: number, previous: number | null, series: number[], unit: Stat["unit"] = "count", sub?: string): Stat => ({
  value,
  previous,
  unit,
  series,
  ...(sub ? { sub } : {}),
});

/**
 * "12 of 20 engaged" under thirty sessions, "62% engaged" from thirty on.
 * Short on purpose: in a row of six tiles a longer line widens the figures
 * column until the spark beside it has no room left.
 */
function engagedLine(engaged: number, sessions: number): string | undefined {
  if (sessions <= 0) return undefined;
  if (sessions < 30) return `${engaged} of ${sessions} engaged`;
  return `${Math.round(ratio(engaged, sessions) * 100)}% engaged`;
}

async function tiles(g: Ga4, totals: Promise<Read<Totals>>, days: Promise<Read<Days>>, until: number): Promise<TrafficTiles> {
  const total = await inTime(
    totals.then((t) => g.asReading(t)),
    until,
  );
  if (total.state !== "ok") return { visitors: total, sessions: total, views: total, engaged: total, engagementTime: total, newVisitors: total };
  const span = total.value.span;
  /* The three figures byDay does not carry, per day, for their sparks. One report. */
  const extra = g.report(
    {
      dimensions: ["date"],
      metrics: ["activeUsers", "newUsers", "engagedSessions", "userEngagementDuration"],
      dateRanges: [{ startDate: span.since > span.start ? span.since : span.start, endDate: span.end }],
      orderBys: [{ by: "date" }],
      limit: 400,
    },
    ASK,
  );
  const dayReading = await inTime(
    days.then((d) => g.asReading(d)),
    until,
  );
  const extraReading = await inTime(
    extra.then((r) => g.asReading(r)),
    until,
  );

  /* A tile whose spark failed still has its figure: the line is left empty, never zeros. */
  const line = (pick: (d: Days) => DayPoint[]): number[] => (dayReading.state === "ok" ? pick(dayReading.value).map((p) => p.value) : []);

  /* GA4 sends no row for a measured day on which nothing happened: its counts are 0. */
  const dayRows = (): Map<string, Report["rows"][number]> | null =>
    extraReading.state === "ok" ? new Map(extraReading.value.rows.map((r) => [String(r.date), r])) : null;

  const perDay = (metric: string): number[] => {
    const rows = dayRows();
    return rows ? daysOf(span).map((d) => Number(rows.get(d)?.[metric] ?? 0)) : [];
  };

  /* Seconds per visitor, day by day. An average over nobody is not zero: a day without visitors is a gap. */
  const timePerDay = (): (number | null)[] => {
    const rows = dayRows();
    if (!rows) return [];
    return daysOf(span).map((d) => {
      const r = rows.get(d);
      const by = Number(r?.activeUsers ?? 0);
      return by > 0 ? Math.round(Number(r?.userEngagementDuration ?? 0) / by) : null;
    });
  };

  const figure = <S extends Stat>(make: (x: Totals) => S | null, empty = "No visitors in this period, so there is nothing to average."): Reading<S> => {
    const s = make(total.value);
    return s ? { ...total, value: s } : waiting("ga4", empty);
  };

  return {
    visitors: figure((x) =>
      stat(
        x.current.activeUsers,
        x.previous?.activeUsers ?? null,
        line((d) => d.users),
      ),
    ),
    sessions: figure((x) =>
      stat(
        x.current.sessions,
        x.previous?.sessions ?? null,
        line((d) => d.sessions),
      ),
    ),
    views: figure((x) =>
      stat(
        x.current.screenPageViews,
        x.previous?.screenPageViews ?? null,
        line((d) => d.views),
      ),
    ),
    engaged: figure((x) =>
      stat(x.current.engagedSessions, x.previous?.engagedSessions ?? null, perDay("engagedSessions"), "count", engagedLine(x.current.engagedSessions, x.current.sessions)),
    ),
    engagementTime: figure((x) => {
      if (x.current.activeUsers <= 0) return null;
      const now = Math.round(x.current.engagementSeconds / x.current.activeUsers);
      const before = x.previous && x.previous.activeUsers > 0 ? Math.round(x.previous.engagementSeconds / x.previous.activeUsers) : null;
      return { ...stat(now, before, [], "s"), daily: timePerDay() };
    }),
    newVisitors: figure((x) => stat(x.current.newUsers, x.previous?.newUsers ?? null, perDay("newUsers"))),
  };
}

/* ---------- the whole screen --------------------------------------------- */

async function screen(range: TrafficRange, specimen: boolean): Promise<TrafficPayload> {
  const until = Date.now() + PATIENCE_MS;
  const g = await ga4().catch(() => null);
  const pages = await knownPages();
  const gone = <T>(): Reading<T> => waiting("ga4", "The GA4 collector did not load. The reason is under the top bar's light.");

  /* Asked in the order the screen is read: GA4 answers one question at a
     time, so what is asked first is ready first. */
  const totals = g ? g.totals(range, ASK) : null;
  const daysP = g ? g.byDay(range, ASK) : null;
  const tilesP = g && totals && daysP ? tiles(g, totals, daysP, until) : null;
  const channelsP = g ? g.channels(range, ASK) : null;
  const liveP = g ? g.live(ASK) : null;
  const sourcesP = g ? g.sourcesMediums(range, ASK) : null;
  const landingP = g ? g.landingPages(range, undefined, ASK) : null;
  const pagesP = g ? g.pages(range, ASK) : null;
  const devicesP = g ? g.devices(range, ASK) : null;
  const countriesP = g ? g.countries(range, ASK) : null;
  const eventsP = g ? g.events(range, ASK) : null;

  /* Reports of our own, over the period the totals read settled on. */
  const spanP = totals ? totals.then((t) => t.data?.span ?? null) : Promise.resolve(null);
  const nowOf = (s: Span) => ({ startDate: s.since > s.start ? s.since : s.start, endDate: s.end });
  const enquiriesP = g
    ? spanP.then((s) =>
        s
          ? g.report({ dimensions: ["landingPage"], metrics: ["eventCount"], dateRanges: [nowOf(s)], dimensionFilter: g.where.is("eventName", "generate_lead"), limit: 1000 }, ASK)
          : null,
      )
    : null;
  const citiesP = g
    ? spanP.then((s) =>
        s
          ? g.report(
              { dimensions: ["city", "countryId", "country"], metrics: ["activeUsers"], dateRanges: [nowOf(s)], orderBys: [{ by: "activeUsers", desc: true }], limit: 25 },
              ASK,
            )
          : null,
      )
    : null;
  const dailyEventsP = g
    ? spanP.then((s) => (s ? g.report({ dimensions: ["date", "eventName"], metrics: ["eventCount"], dateRanges: [nowOf(s)], limit: 10_000 }, ASK) : null))
    : null;

  const period = await reading<TrafficPeriod>("ga4", async () => {
    if (!g || !totals) return gone();
    return inTime(
      totals.then((t) => g.asReading(t, (d) => periodOf(d.span))),
      until,
    );
  });

  const tileSet: TrafficTiles = tilesP
    ? await tilesP.catch((e: unknown) => {
        const r = waiting<never>("ga4", `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
        return { visitors: r, sessions: r, views: r, engaged: r, engagementTime: r, newVisitors: r };
      })
    : { visitors: gone(), sessions: gone(), views: gone(), engaged: gone(), engagementTime: gone(), newVisitors: gone() };

  const perDay = await reading<TrafficPerDay>("ga4", async () => {
    if (!g || !totals || !daysP) return gone();
    const t = await inTime(
      totals.then((x) => g.asReading(x)),
      until,
    );
    const d = await inTime(
      daysP.then((x) => g.asReading(x)),
      until,
    );
    return joined(d, t, (days, tot) => ({
      /* byDay gives a day its earlier twin whenever that one day was measured,
         even while the earlier period as a whole was not. The panel draws the
         dashed line only beside a whole earlier period, so until one exists
         no point carries a previous value. */
      points: tot.previous === null ? days.users.map((p) => ({ ...p, previous: null })) : days.users,
      total: tot.current.activeUsers,
      previous: tot.previous?.activeUsers ?? null,
      provisional: days.users.filter((p) => p.date >= days.span.provisionalFrom).length,
    }));
  });

  const channels = await reading<TrafficChannels>("ga4", async () => {
    if (!g || !channelsP) return gone();
    return inTime(
      channelsP.then((r) =>
        g.asReading(r, (d) => ({
          rows: d.rows.map((x) => ({ key: x.key, label: x.label, sessions: x.sessions, users: x.users, previous: x.previous?.sessions ?? null })),
          sessions: d.sessions,
          note: d.note,
        })),
      ),
      until,
    );
  });

  const live = await reading<TrafficLive>("ga4-live", async () =>
    g && liveP
      ? inTime(
          liveP.then((r) => liveOf(g, r, pages)),
          until,
          "ga4-live",
        )
      : gone(),
  );

  const sources = await reading<TrafficSourceRow[]>("ga4", async () => {
    if (!g || !sourcesP) return gone();
    return inTime(
      sourcesP.then((r) =>
        g.asReading(r, (d) =>
          d.rows.map((x) => ({
            source: x.source,
            medium: x.medium,
            sessions: x.sessions,
            engagedSessions: x.engagedSessions,
            users: x.users,
            previous: x.previous?.sessions ?? null,
          })),
        ),
      ),
      until,
    );
  });

  const landing = await reading<TrafficLandingRow[]>("ga4", async () => {
    if (!g || !landingP || !enquiriesP) return gone();
    const rows = await inTime(
      landingP.then((r) => g.asReading(r)),
      until,
    );
    if (rows.state !== "ok") return rows;
    /* The enquiry column is one more report; when it is late or fails the rows stand and the column says so. */
    const enquiries = await inTime(
      enquiriesP.then((r) => (r ? g.asReading(r) : waiting<Report>("ga4", "Not read."))),
      until,
    );
    const count = new Map<string, number>();
    if (enquiries.state === "ok") {
      for (const row of enquiries.value.rows) {
        const path = g.normalPath(String(row.landingPage ?? ""));
        count.set(path, (count.get(path) ?? 0) + Number(row.eventCount ?? 0));
      }
    }
    return {
      ...rows,
      value: rows.value.rows.slice(0, 200).map((x) => ({
        path: x.path,
        title: pages.get(x.path)?.title ?? null,
        picture: pages.get(x.path)?.picture ?? null,
        sessions: x.sessions,
        engagedSessions: x.engagedSessions,
        enquiries: enquiries.state === "ok" ? (count.get(x.path) ?? 0) : null,
        previous: x.previous?.sessions ?? null,
      })),
    };
  });

  const pageRows = await reading<TrafficPageRow[]>("ga4", async () => {
    if (!g || !pagesP) return gone();
    return inTime(
      pagesP.then((r) =>
        g.asReading(r, (d) =>
          d.rows.slice(0, 500).map((x) => ({
            path: x.path,
            title: pages.get(x.path)?.title ?? null,
            users: x.users,
            views: x.views,
            engagementSeconds: x.engagementSeconds,
            previous: x.previous?.users ?? null,
          })),
        ),
      ),
      until,
    );
  });

  const devices = await reading<TrafficDeviceRow[]>("ga4", async () => {
    if (!g || !devicesP) return gone();
    return inTime(
      devicesP.then((r) => g.asReading(r, (d) => d.rows.map((x) => ({ key: x.key, users: x.users, sessions: x.sessions, previous: x.previous?.users ?? null })))),
      until,
    );
  });

  const countries = await reading<TrafficCountryRow[]>("ga4", async () => {
    if (!g || !countriesP) return gone();
    return inTime(
      countriesP.then((r) => g.asReading(r, (d) => d.rows.map((x) => ({ code: x.code, name: x.name, users: x.users, sessions: x.sessions })))),
      until,
    );
  });

  const cities = await reading<TrafficCities>("ga4", async () => {
    if (!g || !citiesP) return gone();
    return inTime(
      citiesP.then((r) =>
        r
          ? g.asReading(r, (d) => ({
              rows: d.rows.map((x): TrafficCityRow => {
                const id = String(x.countryId ?? "");
                return { city: String(x.city ?? ""), country: String(x.country ?? ""), code: /^[A-Z]{2}$/.test(id) ? id : null, users: Number(x.activeUsers ?? 0) };
              }),
              /* Every city GA4 has for the period, not only the 25 it was asked for. */
              total: Math.max(d.rowCount, d.rows.length),
            }))
          : waiting<TrafficCities>("ga4", "The period could not be read, so neither could its cities."),
      ),
      until,
    );
  });

  const events = await reading<TrafficEventRow[]>("ga4", async () => {
    if (!g || !eventsP || !dailyEventsP) return gone();
    const all = await inTime(
      eventsP.then((r) => g.asReading(r)),
      until,
    );
    if (all.state !== "ok") return all;
    const daily = await inTime(
      dailyEventsP.then((r) => (r ? g.asReading(r) : waiting<Report>("ga4", "Not read."))),
      until,
    );
    const days = daysOf(all.value.span);
    const cell = new Map<string, number>();
    if (daily.state === "ok") for (const row of daily.value.rows) cell.set(`${row.eventName} ${row.date}`, Number(row.eventCount ?? 0));
    const ours = (name: string): string | undefined => (name in g.SITE_EVENTS ? g.SITE_EVENTS[name as SiteEvent].what : undefined);
    return {
      ...all,
      value: all.value.rows.map((x) => ({
        name: x.name,
        what: ours(x.name) ?? GA4_EVENTS[x.name] ?? null,
        ours: x.ours,
        key: x.key,
        count: x.count,
        users: x.users,
        previous: x.previous?.count ?? null,
        /* No spark at all when the day report is missing: an empty line is not a row of zeros. */
        daily: daily.state === "ok" ? days.map((d) => cell.get(`${x.name} ${d}`) ?? 0) : [],
      })),
    };
  });

  let usedSpecimen = false;
  const clarityReading = await reading<TrafficClarity>("clarity", async () => {
    const real = await clarityOf();
    if (real.state !== "ok" && specimen) {
      usedSpecimen = true;
      return ok(SPECIMEN_CLARITY, "clarity", new Date().toISOString(), SPECIMEN_NOTE);
    }
    return real;
  });

  return {
    range,
    specimen: usedSpecimen,
    period,
    tiles: tileSet,
    perDay,
    channels,
    sources,
    landing,
    pages: pageRows,
    devices,
    countries,
    cities,
    live,
    events,
    clarity: clarityReading,
    links: await links(),
  };
}

/** The live panel's reading, with page titles matched to addresses where the crawl allows. */
function liveOf(g: Ga4, r: Read<Live> & { age: number | null }, pages: Map<string, Known>): Reading<TrafficLive> {
  const titles = byTitle(pages);
  return g.asReading(r, (d) => ({
    total: d.total,
    minutes: d.minutes.map((m) => m.users),
    screens: d.screens.map((s) => ({ title: s.title, path: titles.get(s.title) ?? null, users: s.users, views: s.views })),
    countries: d.countries,
    devices: d.devices,
    age: r.age ?? 0,
  }));
}

/** Clarity's newest snapshot, by address, folded to one row per path. No request: the daily job keeps it. */
async function clarityOf(): Promise<Reading<TrafficClarity>> {
  const c = await clarity();
  const top = c.latest();
  if (top.state !== "ok") return top;
  const urls = c.byUrl();
  if (urls.state !== "ok") return urls;
  const seen = new Set<string>();
  const rows: TrafficClarityRow[] = [];
  /* Rows come busiest first; a path that came back under several addresses (a query string) keeps its busiest. */
  for (const r of urls.value.rows) {
    if (seen.has(r.path)) continue;
    seen.add(r.path);
    rows.push({
      path: r.path,
      sessions: r.sessions,
      scrollDepth: r.scrollDepth,
      activeTime: r.activeTime,
      rageClicks: r.rageClicks.count,
      deadClicks: r.deadClicks.count,
      quickBacks: r.quickBacks.count,
      scriptErrors: r.scriptErrors.count,
    });
    if (rows.length >= 100) break;
  }
  const v = top.value;
  return {
    ...top,
    value: {
      day: v.day,
      span: v.span,
      sessions: v.sessions,
      rageClicks: v.rageClicks,
      deadClicks: v.deadClicks,
      quickBacks: v.quickBacks,
      scriptErrors: v.scriptErrors,
      rows,
      callsLeft: v.callsLeft,
    },
  };
}

/**
 * Into GA4 and Clarity themselves. The GA4 property is the one ga4.ts reads
 * every figure from (its default when GA4_PROPERTY_ID is not set), so the
 * link opens the reports behind this screen's numbers.
 */
async function links(): Promise<TrafficLinks> {
  const ga = "https://analytics.google.com/analytics/web/";
  const id = await ga4()
    .then((g) => g.propertyId())
    .catch(() => "");
  const analytics = id ? `${ga}#/p${id}/reports/intelligenthome` : ga;
  const realtime = id ? `${ga}#/p${id}/realtime/overview` : ga;
  const home = "https://clarity.microsoft.com/projects";
  try {
    const c = await clarity();
    const d = c.deepLink();
    /* Without CLARITY_PROJECT_ID all three are the list of projects. */
    return { analytics, realtime, clarity: { project: d.dashboard !== home, dashboard: d.dashboard, recordings: d.recordings, heatmaps: d.heatmaps } };
  } catch {
    return { analytics, realtime, clarity: { project: false, dashboard: home, recordings: home, heatmaps: home } };
  }
}

routes.get("/", async (c) => c.json<TrafficPayload>(await screen(rangeOf(c.req.query("range")), specimenAllowed(c))));

/** The live panel alone: what the browser polls, every LIVE_EVERY seconds. */
routes.get("/live", async (c) => {
  const live = await reading<TrafficLive>("ga4-live", async () => {
    const g = await ga4();
    return liveOf(g, await g.live(ASK), await knownPages());
  });
  return c.json<Reading<TrafficLive>>(live);
});
