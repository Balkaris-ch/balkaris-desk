import { Hono } from "hono";
import type { Vars } from "../access.ts";
import { specimenAllowed } from "../specimen.ts";
import { off, ok, reading, today, waiting } from "../store.ts";
import { scrub } from "../system.ts";
import type { Reading, Share, Stat } from "../../../web/src/contract/common.ts";
import type {
  AttackStatus,
  BuildLog,
  BuildLogPayload,
  BuildRow,
  ConsentGap,
  DashboardLink,
  DomainRow,
  DrainCounting,
  EngineLocal,
  EnginePublic,
  HostingPayload,
  HostingRange,
  PlatformStatus,
  ProductionNow,
  ViewRule,
  ViewsChart,
} from "../../../web/src/contract/hosting.ts";
import type { Ask, Days, Read } from "../ga4.ts";

/**
 * /api/v1/hosting: what only Vercel knows about the website, and the engine.
 *
 *   GET /?range=7d|30d|90d   the whole screen
 *   GET /builds/:uid         a production build's last log lines, read on demand
 *
 * Four sources, each its own reading, so one that is not connected costs its
 * panels and says why:
 *
 *   vercel-drain    Vercel's request records (src/cc/vercel/drain.ts): page
 *                   views by stated rules, from the first day the drain
 *                   delivered. Never back-filled.
 *   ga4             GA4's page views on the same days, beside them: the gap
 *                   between the two is what consent costs the GA4 figures.
 *   vercel-api      builds, the production domain, the firewall
 *   vercel-status   Vercel's status page for the parts the site stands on
 *   probe           the desk's own check of the engine
 *
 * `?specimen=1` (development only, decided by specimenAllowed) fills each
 * panel that has nothing with the SPECIMEN_ rows at the bottom, and says
 * which it filled. A real figure is never covered.
 */

export const routes = new Hono<Vars>();

const vercel = () => import("../vercel/index.ts");
const ga4 = () => import("../ga4.ts");
type V = Awaited<ReturnType<typeof vercel>>;

const RANGES = ["7d", "30d", "90d"] as const satisfies readonly HostingRange[];
const DAYS: Record<HostingRange, number> = { "7d": 7, "30d": 30, "90d": 90 };
const rangeOf = (asked: string | undefined): HostingRange => RANGES.find((r) => r === asked?.toLowerCase()) ?? "30d";

const DAY = 86_400_000;
/* Noon, so a day shifted across a clock change is still that day. */
const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + by * DAY).toISOString().slice(0, 10);
const zurichDay = (iso: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));
const zurichClock = (iso: string): string => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = (day: string): string => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
/** "1 Oct at 23:58": a moment in the studio's words. */
const momentWords = (iso: string): string => `${dayWords(zurichDay(iso))} at ${zurichClock(iso)}`;
const n = (x: number): string => x.toLocaleString("en-GB");

/** GA4 answers one question at a time; a panel that misses this moment says so and fills on the next load. */
const PATIENCE_MS = 12_000;
const ASK: Ask = { screen: true, end: "today" };

function inTime<T>(work: Promise<T>, ms: number, late: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(late), ms);
  });
  return Promise.race([work, slow]).finally(() => clearTimeout(timer));
}

/* ---------- the drain ----------------------------------------------------------------------- */

const DRAIN_STEP = "Run bash deploy/vercel-connect.sh on the workstation: it creates the drain for the website's production and puts VERCEL_DRAIN_SECRET in the desk's environment.";
const DRAIN_NOTE = "Vercel's own request records, counted by the rules on this screen: pages loaded and navigations that reached Vercel; robots, prefetches and files set aside. No IP address or browser is kept, only counts per day.";

/** The days the drain covers in this range, or why it covers none. */
interface Span {
  from: string;
  to: string;
  firstDay: string;
  firstAt: string;
  last: string;
  /** Days with any delivery: the others are unknown. */
  known: Set<string>;
  closed: boolean;
}

function drainSpan(v: V, range: HostingRange): Span | Reading<never> {
  const s = v.drainState();
  if (!s.first || !s.last) {
    if (!s.ready) return off("vercel-drain", "Vercel's request records do not reach the desk yet: no drain delivers to it, and the desk has no VERCEL_DRAIN_SECRET.", DRAIN_STEP);
    return waiting("vercel-drain", "The drain's secret is set and no signed delivery has arrived yet. Records arrive within minutes of the drain being created by deploy/vercel-connect.sh.");
  }
  const to = today();
  const firstDay = zurichDay(s.first);
  const start = shift(to, 1 - DAYS[range]);
  const from = firstDay > start ? firstDay : start;
  return { from, to, firstDay, firstAt: s.first, last: s.last, known: v.deliveredDays(from, to), closed: !s.ready };
}

const isSpan = (x: Span | Reading<never>): x is Span => "from" in x;
const drainNote = (sp: Span): string => (sp.closed ? `${DRAIN_NOTE} The door is closed now (VERCEL_DRAIN_SECRET is not set): nothing new is counted.` : DRAIN_NOTE);

/** Each day of the span, oldest first. */
function daysOf(sp: Span): string[] {
  const out: string[] = [];
  for (let d = sp.from; d <= sp.to; d = shift(d, 1)) out.push(d);
  return out;
}

function shares(rows: { key: string; n: number }[], label: (k: string) => string = (k) => k): Share[] {
  return rows.map((r) => ({ key: r.key, label: label(r.key), value: r.n }));
}

const REF_LABEL: Record<string, string> = { "(none)": "Direct, or no referrer sent", "(this site)": "Inside the site", "(unreadable)": "Unreadable referrer", "(other)": "Others (beyond 300 a day)" };
const DEVICE_LABEL: Record<string, string> = { mobile: "Mobile", tablet: "Tablet", desktop: "Desktop", other: "Other" };

/* ---------- GA4 beside it -------------------------------------------------------------------- */

interface Ga4Days {
  views: Map<string, number>;
  /** The first day GA4 measured, and its zone. */
  since: string;
  at: number;
  zone: string;
}

async function ga4Days(range: HostingRange): Promise<Ga4Days | Reading<never>> {
  const g = await ga4();
  const r: Read<Days> = await inTime(g.byDay(range, ASK), PATIENCE_MS, { data: null, at: null, error: "GA4 is still answering this one. It is kept as soon as it arrives: reload in a moment.", source: "ga4" } as Read<Days>);
  if (r.data === null || r.at === null) {
    const why = r.error ?? "GA4 has not answered yet.";
    return r.off ? off("ga4", why, r.step) : waiting("ga4", why);
  }
  return { views: new Map(r.data.views.map((p) => [p.date, p.value])), since: r.data.span.since, at: r.at, zone: g.zone() };
}

const isGa = (x: Ga4Days | Reading<never>): x is Ga4Days => "views" in x;

/**
 * The whole days both sources counted: after the drain's first (partial) day,
 * before today, delivered, and a day GA4 answered for. A day either source
 * has nothing for is left out, never read as zero.
 */
function wholeDays(sp: Span, g: Ga4Days): string[] {
  return daysOf(sp).filter((d) => d > sp.firstDay && d < sp.to && sp.known.has(d) && d >= g.since && g.views.has(d));
}

/* ---------- the Vercel API ------------------------------------------------------------------ */

function apiReading<T, U>(v: V, name: "builds" | "project" | "domains" | "attacks", pick: (value: T) => U): Reading<U> {
  if (!v.vercelConfigured()) return off("vercel-api", v.NO_TOKEN, v.TOKEN_STEP);
  const p = v.partOf<T>(name);
  if (p.error?.status === 401) return off("vercel-api", p.error.message, v.TOKEN_STEP);
  if (p.error?.status === 403) return off("vercel-api", `${p.error.message} The desk's token is scoped to the project; this part is in Vercel's dashboard.`);
  if (p.value !== null && p.at !== null) return ok(pick(p.value), "vercel-api", p.at, p.error ? `Not refreshed: ${p.error.message}` : undefined);
  if (p.error) return waiting("vercel-api", p.error.message);
  return waiting("vercel-api", "The token is set; the first read runs within a minute of the desk starting, then every ten minutes.");
}

/* ---------- what the dashboard alone shows ----------------------------------------------------- */

const PROJECT = "https://vercel.com/balkaris/balkaris-web-infrastructure";
const DASHBOARD: DashboardLink[] = [
  {
    key: "functions",
    label: "Function invocations and duration",
    href: `${PROJECT}/observability`,
    why: "Observability › Vercel Functions. No documented endpoint returns them: Vercel's metrics query (POST /v2/observability/query) publishes no response format and needs Observability Plus.",
  },
  {
    key: "errors",
    label: "Function errors",
    href: `${PROJECT}/logs`,
    why: "Logs, filtered to errors. The one documented logs endpoint streams a deployment live and takes no time range; a day of errors exists only in the dashboard (Pro keeps one day).",
  },
  {
    key: "cache",
    label: "Edge cache and CDN requests",
    href: `${PROJECT}/observability`,
    why: "Observability › CDN Requests: cached against uncached, per route. Dashboard only; the desk's own cache figure on Site Health is of its checks, not of visitors.",
  },
  {
    key: "transfer",
    label: "Bandwidth and data transfer",
    href: "https://vercel.com/balkaris/~/usage",
    why: "Usage. Read by API only through billing (/v1/billing/charges), which needs a team-scoped token; the desk's token is scoped to this project on purpose.",
  },
  {
    key: "usage",
    label: "Usage and cost against the $20 credit",
    href: "https://vercel.com/balkaris/~/usage",
    why: "Usage, and Settings › Billing. The same team-level billing API as above: not for a project token.",
  },
];

/* ---------- the screen ------------------------------------------------------------------------- */

routes.get("/", async (c) => {
  const range = rangeOf(c.req.query("range"));
  const specimen = specimenAllowed(c);
  let v: V | null = null;
  try {
    v = await vercel();
  } catch {
    v = null;
  }
  const failed = <T>(source: Reading<T>["source"]): Reading<T> => waiting(source, "The Vercel collector did not load. The reason is under the top bar's light.");

  /* The drain's span and GA4's days, each asked once; every panel below is its own reading of them. */
  let span: Span | Reading<never>;
  try {
    span = v ? drainSpan(v, range) : failed("vercel-drain");
  } catch (e) {
    span = waiting("vercel-drain", `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }
  const ga: Ga4Days | Reading<never> = await ga4Days(range).catch((e: unknown) => waiting<never>("ga4", `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`));

  const withSpan = <T>(make: (sp: Span, v: V) => Reading<T>): Promise<Reading<T>> =>
    reading("vercel-drain", () => (v && isSpan(span) ? make(span, v) : (span as Reading<T>)));

  /* The router's markers over the range: a day whose page views stood without one router record may hold prefetches. */
  const gaps = v && isSpan(span) ? v.markerGaps(span.from, span.to) : [];
  const gapNote = gaps.length
    ? ` Router markers absent on ${gaps.map((g) => dayWords(g.day)).join(", ")}: not one prefetch, router request or navigation beside those page views, so they may include prefetches.`
    : "";

  /*
   * Today's figure exists only when the drain delivered today: a day without
   * a delivery is unknown, not zero (the chart leaves it a gap for the same
   * reason). The bars and the range's total are of the delivered days only.
   */
  const viewsToday = await withSpan<Stat>((sp, v) => {
    if (!sp.known.has(sp.to)) {
      const last = momentWords(sp.last);
      if (sp.closed) return off("vercel-drain", `Nothing is counted today: the desk has no VERCEL_DRAIN_SECRET, so its door refuses Vercel's deliveries. The last signed delivery came on ${last}.`, DRAIN_STEP);
      return waiting(
        "vercel-drain",
        `No signed delivery has arrived today (Zurich) yet: the last came on ${last}. A day without a delivery is unknown, not zero. While the drain runs, records arrive within minutes; Vercel's Team Settings > Drains says whether it paused or disabled the drain.`,
      );
    }
    const per = v.viewsPerDay(sp.from, sp.to);
    const days = daysOf(sp);
    const known = days.filter((d) => sp.known.has(d));
    const series = known.map((d) => per.get(d) ?? 0);
    const total = series.reduce((a, x) => a + x, 0);
    const sub =
      known.length < days.length
        ? `${n(total)} on the ${known.length} of ${days.length} days delivered`
        : sp.from === sp.firstDay
          ? `${n(total)} since ${dayWords(sp.firstDay)}`
          : `${n(total)} in ${days.length} days`;
    const quiet = Date.now() - Date.parse(sp.last);
    const quietNote = quiet > v.QUIET_MS ? ` No delivery since ${zurichClock(sp.last)}: today's count stops there.` : "";
    return ok({ value: per.get(sp.to) ?? 0, unit: "count", previous: null, series, sub }, "vercel-drain", sp.last, `${drainNote(sp)}${quietNote}${gapNote}`);
  });

  const gapDays = (sp: Span, g: Ga4Days) => wholeDays(sp, g);
  /** Why no whole day can be compared yet: none has passed since the drain's first, or GA4 answered for none of those that have. */
  const noWholeDay = (sp: Span, g: Ga4Days): string => {
    const drained = daysOf(sp).filter((d) => d > sp.firstDay && d < sp.to && sp.known.has(d));
    if (!drained.length) return `GA4 is compared on whole days the drain counted: the first is ${dayWords(shift(sp.firstDay, 1))}, readable from the day after.`;
    return `GA4 has answered for none of the ${drained.length} whole day${drained.length === 1 ? "" : "s"} the drain counted (${dayWords(drained[0]!)}–${dayWords(drained[drained.length - 1]!)}); GA4's days here begin on ${dayWords(g.since)}.`;
  };
  const ga4Views = await reading<Stat>("ga4", () => {
    if (!isGa(ga)) return ga;
    if (!v || !isSpan(span)) return isSpan(span) ? failed("ga4") : (span as Reading<Stat>);
    const days = gapDays(span, ga);
    if (!days.length) return waiting("vercel-drain", noWholeDay(span, ga));
    /* wholeDays keeps only days GA4 answered for: every one of them has a value. */
    const series = days.map((d) => ga.views.get(d)!);
    const total = series.reduce((a, x) => a + x, 0);
    return ok(
      { value: total, unit: "count", previous: null, series, sub: `${dayWords(days[0]!)}–${dayWords(days[days.length - 1]!)} · consenting only` },
      "ga4",
      ga.at,
      `GA4's page views on the same whole days as the server's count. GA4 loads only after a visitor accepts the cookie banner, so it counts consenting visitors only; it may still add to yesterday.${ga.zone !== "Europe/Zurich" ? ` GA4's days are in ${ga.zone}.` : ""}`,
    );
  });

  const gap = await reading<ConsentGap>("ga4", () => {
    if (!isSpan(span)) return span as Reading<ConsentGap>;
    if (!isGa(ga)) return ga;
    if (!v) return failed("vercel-drain");
    const days = gapDays(span, ga);
    if (!days.length) return waiting("vercel-drain", noWholeDay(span, ga));
    /* Every day here was delivered (a missing page-view row is the drain's own zero) and answered by GA4. */
    const per = v.viewsPerDay(days[0]!, days[days.length - 1]!);
    const server = days.reduce((a, d) => a + (per.get(d) ?? 0), 0);
    const g = days.reduce((a, d) => a + ga.views.get(d)!, 0);
    const compared = gaps.filter((x) => days.includes(x.day));
    return ok(
      { ga4: g, server, from: days[0]!, to: days[days.length - 1]!, days: days.length },
      "vercel-drain",
      span.last,
      `GA4's page views against the server's own count of page loads on the same whole days. They count differently: GA4 counts consenting visitors and every in-site click; the server counts every visitor's page loads and only the in-site clicks that reach Vercel. The gap is a measured share, not a consent rate.${compared.length ? ` The server's count on ${compared.map((x) => dayWords(x.day)).join(", ")} may include prefetches: router markers absent.` : ""}`,
    );
  });

  const chart = await withSpan<ViewsChart>((sp, v) => {
    const per = v.viewsPerDay(sp.from, sp.to);
    const days = daysOf(sp);
    const views = days.map((d) => (sp.known.has(d) ? (per.get(d) ?? 0) : null));
    const g = isGa(ga) ? ga : null;
    return ok(
      {
        days,
        views,
        ga4: g ? days.map((d) => (d >= g.since && g.views.has(d) ? g.views.get(d)! : null)) : null,
        ga4Why: g ? null : (ga as Reading<never>).state !== "ok" ? (ga as Exclude<Reading<never>, { state: "ok" }>).reason : null,
        firstDay: sp.firstDay,
        firstAt: sp.firstAt,
      },
      "vercel-drain",
      sp.last,
      `${drainNote(sp)}${gapNote}`,
    );
  });

  const kinds = v && isSpan(span) ? v.kindsBetween(span.from, span.to) : null;
  const counting = await withSpan<DrainCounting>((sp, v) => {
    const s = v.drainState();
    const quiet = Date.now() - Date.parse(sp.last);
    return ok(
      {
        since: sp.firstAt,
        lastDelivery: sp.last,
        newestRecord: s.newest,
        today: v.deliveriesOn(today()),
        lastRefused: s.lastRefused,
        records: kinds ? Object.values(kinds).reduce((a, x) => a + x, 0) : 0,
        quietHours: quiet > v.QUIET_MS ? Math.round(quiet / 3_600_000) : null,
        markers: { minViews: v.MARKER_MIN_VIEWS, gaps },
      },
      "vercel-drain",
      sp.last,
      drainNote(sp),
    );
  });

  let rules: ViewRule[] = [];
  try {
    rules = (v ? v.RULES : []).map((r) => ({ kind: r.kind, rule: r.rule, why: r.why, count: kinds ? kinds[r.kind] : null }));
  } catch {
    rules = [];
  }

  const list = (dim: "path" | "ref" | "device" | "region", label?: (k: string) => string) =>
    withSpan<Share[]>((sp, v) => ok(shares(v.topBetween(dim, sp.from, sp.to, dim === "device" ? 4 : 10), label), "vercel-drain", sp.last, drainNote(sp)));
  const [pages, referrers, devices, regions] = await Promise.all([
    list("path", (k) => (k === "(other)" ? "Others (beyond 300 a day)" : k)),
    list("ref", (k) => REF_LABEL[k] ?? k),
    list("device", (k) => DEVICE_LABEL[k] ?? k),
    list("region"),
  ]);
  const countries: Reading<Share[]> = off(
    "vercel-drain",
    "Vercel's request records carry no country, and the desk does not look one up from an IP address. The edge region that served each view is shown instead; GA4's countries (consenting visitors) are on Traffic.",
  );
  const bots = await withSpan((sp, v) => ok({ total: kinds?.bot ?? 0, list: shares(v.topBetween("bot", sp.from, sp.to, 10)) }, "vercel-drain", sp.last, "Page requests whose user agent names a robot, by family. Robots that hide as browsers are counted as views: this is a floor."));
  const notFound = await withSpan((sp, v) => ok({ total: kinds?.notFound ?? 0, list: shares(v.topBetween("404", sp.from, sp.to, 10), (k) => (k === "(other)" ? "Others (beyond 300 a day)" : k)) }, "vercel-drain", sp.last, "People's page requests answered 404, by address. Robots' 404s are in the bot count."));

  /* Vercel's API, from what the job last read. */
  const builds: Reading<BuildRow[]> = v ? await reading("vercel-api", () => apiReading<BuildRow[], BuildRow[]>(v!, "builds", (x) => x)) : failed("vercel-api");
  const production: Reading<ProductionNow> = v ? await reading("vercel-api", () => apiReading<ProductionNow & { deploymentId?: string | null }, ProductionNow>(v!, "project", ({ deploymentId: _id, ...rest }) => rest)) : failed("vercel-api");
  const domains: Reading<DomainRow[]> = v ? await reading("vercel-api", () => apiReading<DomainRow[], DomainRow[]>(v!, "domains", (x) => x)) : failed("vercel-api");
  const attacks: Reading<AttackStatus> = v ? await reading("vercel-api", () => apiReading<AttackStatus, AttackStatus>(v!, "attacks", (x) => x)) : failed("vercel-api");
  const build: Reading<BuildRow> = builds.state === "ok" ? (builds.value[0] ? ok(builds.value[0], "vercel-api", builds.asOf, builds.note) : waiting("vercel-api", "Vercel lists no production deployment for the project.")) : (builds as Reading<BuildRow>);

  const platform: Reading<PlatformStatus> = v
    ? await reading("vercel-status", () => {
        const p = v!.platform();
        const err = v!.statusError();
        if (p) return ok(p.value, "vercel-status", p.at, err ? `Not refreshed: ${err}` : "Vercel's public status page, read every five minutes, for the parts of Vercel this website stands on.");
        return waiting("vercel-status", err || "The status page is read within a minute of the desk starting, then every five minutes.");
      })
    : failed("vercel-status");

  const engineLocal: Reading<EngineLocal> = v
    ? await reading("probe", () => {
        const e = v!.engineLocal();
        return e ? ok(e, "probe", e.at, `The desk's own check of ${e.url} every two minutes, over the box's loopback: the engine itself, nothing in between.`) : waiting("probe", "The engine is checked within a minute of the desk starting, then every two minutes.");
      })
    : failed("probe");
  const enginePublic: Reading<EnginePublic> = v
    ? await reading("probe", () => {
        const e = v!.enginePublic();
        return e ? ok(e, "probe", e.at, `${e.url} once an hour, the way the website reaches it, with the certificate of its name.`) : waiting("probe", "The public address is checked once an hour, the first time with the first check of the engine.");
      })
    : failed("probe");

  const payload: HostingPayload = {
    range,
    specimen: false,
    specimenPanels: [],
    tiles: { viewsToday, ga4Views, gap, build, platform, engine: engineLocal },
    chart,
    counting,
    rules,
    pages,
    referrers,
    devices,
    regions,
    countries,
    bots,
    notFound,
    builds,
    production,
    domains,
    attacks,
    platform,
    engine: { local: engineLocal, public: enginePublic },
    dashboard: DASHBOARD,
  };
  return c.json<HostingPayload>(specimen ? SPECIMEN_fill(payload) : payload);
});

/** One production build's last log lines, on demand. The lines go through scrub(): a build can print what it should not. */
routes.get("/builds/:uid", async (c) => {
  const uid = c.req.param("uid");
  let v: V | null = null;
  try {
    v = await vercel();
  } catch {
    v = null;
  }
  const log = await reading("vercel-api", async () => {
    if (!v) return waiting<never>("vercel-api", "The Vercel collector did not load. The reason is under the top bar's light.");
    if (!/^dpl_[A-Za-z0-9]{6,40}$/.test(uid)) return off<never>("vercel-api", "That is not a Vercel deployment id.");
    if (!v.vercelConfigured()) return off<never>("vercel-api", v.NO_TOKEN, v.TOKEN_STEP);
    try {
      const l = await v.buildLog(uid);
      return ok({ ...l, lines: l.lines.map((x) => ({ ...x, text: scrub(x.text) })) }, "vercel-api", Date.now(), "Vercel's build log, the last lines; kept a day.");
    } catch (e) {
      if (e instanceof v.VercelError && (e.status === 401 || e.status === 403)) return off<never>("vercel-api", e.message, e.status === 401 ? v.TOKEN_STEP : undefined);
      throw e;
    }
  });
  if (specimenAllowed(c) && log.state !== "ok" && uid.startsWith("dpl_specimen")) return c.json<BuildLogPayload>({ uid, log: SPECIMEN_log() });
  return c.json<BuildLogPayload>({ uid, log });
});

/* ---------- specimen: every panel before its source exists ------------------------------------ */

/*
 * SPECIMEN values for ?specimen=1 on a development desk only (specimenAllowed).
 * Round numbers in a saw-tooth, addresses under /specimen/, hosts under
 * .example and .invalid, a creator called "specimen": nobody can mistake them
 * for the website's figures. Each fills only a panel that has no value.
 */
const SPEC = "Specimen: artificial values to show the panel connected. Not a measurement of the website.";
const saw = (i: number, lo: number, hi: number, period = 4): number => Math.round(lo + ((hi - lo) * (i % period)) / (period - 1));
const sDays = (count: number): string[] => Array.from({ length: count }, (_, i) => shift(today(), i - count + 1));
const sAt = (): string => new Date().toISOString();

function SPECIMEN_fill(p: HostingPayload): HostingPayload {
  const filled: string[] = [];
  const fill = <T>(name: string, r: Reading<T>, make: () => T, source: Reading<T>["source"] = "none"): Reading<T> => {
    if (r.state === "ok") return r;
    filled.push(name);
    return ok(make(), source, sAt(), SPEC);
  };
  const days = sDays(10);
  const views = days.map((_, i) => saw(i, 100, 400));
  const builds: BuildRow[] = [
    { uid: "dpl_specimenA1", state: "READY", createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), durationMs: 60_000, sha: "0000000000000000000000000000000000000001", ref: "main", creator: "specimen", error: null, inspectorUrl: null, current: true },
    { uid: "dpl_specimenA2", state: "ERROR", createdAt: new Date(Date.now() - 26 * 3_600_000).toISOString(), durationMs: 30_000, sha: "0000000000000000000000000000000000000002", ref: "main", creator: "specimen", error: { code: "SPECIMEN_ERROR", message: "Specimen: a build that failed, to show the row.", step: "build" }, inspectorUrl: null, current: false },
    { uid: "dpl_specimenA3", state: "BUILDING", createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), durationMs: null, sha: "0000000000000000000000000000000000000003", ref: "main", creator: "specimen", error: null, inspectorUrl: null, current: false },
  ];
  const platform: PlatformStatus = {
    indicator: "minor",
    description: "Specimen: partial system outage",
    components: [
      { id: "specimen-cdn", name: "Specimen CDN region", why: "CDN: the edge that answers the desk's checks (specimen)", status: "operational" },
      { id: "specimen-builds", name: "Specimen builds", why: "Builds: every push to main is a production build", status: "degraded_performance" },
      { id: "specimen-functions", name: "Specimen functions", why: "Functions: the site's /api routes", status: "operational" },
    ],
    incidents: [{ id: "specimen-incident", name: "Specimen incident", status: "investigating", impact: "minor", startedAt: new Date(Date.now() - 40 * 60_000).toISOString(), link: null, touches: ["Specimen builds"] }],
  };
  const engine: EngineLocal = { at: sAt(), url: "http://specimen.invalid/health", status: 200, ok: true, ms: 10, failure: null, body: { ok: true, aiMode: "specimen", store: "SpecimenStore", crm: "off" }, checks: 720, passed: 720, since: new Date(Date.now() - 86_400_000).toISOString(), spark: Array.from({ length: 24 }, (_, i) => saw(i, 5, 20)) };

  const out: HostingPayload = {
    ...p,
    tiles: {
      viewsToday: fill("True page views", p.tiles.viewsToday, () => ({ value: 200, unit: "count", previous: null, series: views, sub: "2,500 in 10 days" })),
      ga4Views: fill("GA4 page views", p.tiles.ga4Views, () => ({ value: 500, unit: "count", previous: null, series: days.slice(1, -1).map((_, i) => saw(i, 20, 100)), sub: "Specimen days · consenting only" })),
      gap: fill("Consent gap", p.tiles.gap, () => ({ ga4: 500, server: 2000, from: days[1]!, to: days[days.length - 2]!, days: 8 })),
      build: fill("Last build", p.tiles.build, () => builds[0]!),
      platform: fill("Vercel status", p.tiles.platform, () => platform),
      engine: fill("Engine", p.tiles.engine, () => engine),
    },
    chart: fill("Page views per day", p.chart, () => ({ days, views, ga4: days.map((_, i) => (i === 0 ? null : saw(i, 20, 100))), ga4Why: null, firstDay: days[0]!, firstAt: `${days[0]}T08:00:00.000Z` })),
    counting: fill("How page views are counted", p.counting, () => ({ since: `${days[0]}T08:00:00.000Z`, lastDelivery: sAt(), newestRecord: sAt(), today: { deliveries: 100, records: 1000, refused: 1 }, lastRefused: sAt(), records: 10000, quietHours: null, markers: { minViews: 25, gaps: [{ day: days[2]!, views: 100 }] } })),
    rules: p.rules.map((r, i) => (r.count === null ? { ...r, count: saw(i, 0, 300) } : r)),
    pages: fill("Top pages", p.pages, () => [1, 2, 3, 4, 5].map((i) => ({ key: `/specimen/${i}`, label: `/specimen/${i}`, value: 600 - i * 100 }))),
    referrers: fill("Referrers", p.referrers, () => [
      { key: "(none)", label: "Direct, or no referrer sent", value: 400 },
      { key: "specimen.example", label: "specimen.example", value: 200 },
      { key: "(this site)", label: "Inside the site", value: 100 },
    ]),
    devices: fill("Devices", p.devices, () => [
      { key: "desktop", label: "Desktop", value: 300 },
      { key: "mobile", label: "Mobile", value: 200 },
      { key: "tablet", label: "Tablet", value: 100 },
    ]),
    regions: fill("Edge regions", p.regions, () => [
      { key: "specimen1", label: "specimen1", value: 500 },
      { key: "specimen2", label: "specimen2", value: 100 },
    ]),
    bots: fill("Bots", p.bots, () => ({ total: 1000, list: [{ key: "specimen-a", label: "Specimen robots A", value: 700 }, { key: "specimen-b", label: "Specimen robots B", value: 300 }] })),
    notFound: fill("404s", p.notFound, () => ({ total: 30, list: [{ key: "/specimen/gone", label: "/specimen/gone", value: 20 }, { key: "/specimen/old", label: "/specimen/old", value: 10 }] })),
    builds: fill("Production builds", p.builds, () => builds),
    production: fill("Production domain", p.production, () => ({ deploymentUrl: "specimen.vercel.invalid", readyState: "READY", aliases: ["www.specimen.example", "specimen.example"], paused: false, firewall: { enabled: true, attackMode: false, attackModeUntil: null, botId: false } })),
    domains: fill("Domains", p.domains, () => [
      { name: "www.specimen.example", verified: true, redirect: null, redirectStatus: null },
      { name: "specimen.example", verified: true, redirect: "www.specimen.example", redirectStatus: 308 },
    ]),
    attacks: fill("Firewall", p.attacks, () => ({ total: 0, active: 0, newest: null })),
    platform: fill("Vercel platform status", p.platform, () => platform),
    engine: {
      local: fill("Engine", p.engine.local, () => engine),
      public: fill("Engine (public)", p.engine.public, () => ({ ...engine, url: "https://specimen.invalid/health", status: 401, ok: false, ms: 100, failure: "answered 401, not the engine's health answer", body: null, cert: { daysLeft: 60, validTo: new Date(Date.now() + 60 * DAY).toISOString(), issuer: "Specimen CA", trusted: true, problem: null } })),
    },
  };
  return { ...out, specimen: filled.length > 0, specimenPanels: [...new Set(filled)] };
}

function SPECIMEN_log(): Reading<BuildLog> {
  const at = (s: number) => new Date(Date.now() - 26 * 3_600_000 + s * 1000).toISOString();
  return ok(
    {
      build: null,
      lines: [
        { at: at(0), type: "command", error: false, text: "Specimen: npm run build" },
        { at: at(10), type: "stdout", error: false, text: "Specimen: compiling" },
        { at: at(20), type: "stderr", error: true, text: "Specimen: an error line, to show how one looks" },
        { at: at(21), type: "exit", error: false, text: "Specimen: exited with 1" },
      ],
      total: 4,
    },
    "none",
    sAt(),
    SPEC,
  );
}
