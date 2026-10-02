import { Hono, type Context } from "hono";
import type { Vars } from "../access.ts";
import { attention } from "../attention.ts";
import { status as jobStatus } from "../scheduler.ts";
import { specimenAllowed } from "../specimen.ts";
import { activity, ok, reading, waiting } from "../store.ts";
import { scrub, scrubItem } from "../system.ts";
import type { ActivityItem, AttentionItem, Reading, Stat } from "../../../web/src/contract/common.ts";
import type {
  AuditJob,
  CountriesPanel,
  LivePage,
  LivePanel,
  Overview,
  OverviewAttention,
  OverviewLive,
  OverviewTiles,
  PageSends,
  PerformancePanel,
  SourcesPanel,
  TopPagesPanel,
  TrafficPanel,
  UptimeCell,
  VitalCell,
} from "../../../web/src/contract/overview.ts";

/**
 * /api/v1/overview: the Command Center, in one answer.
 *
 *   GET /           the whole screen for ?range=7d|30d|90d|1y (default 30d)
 *   GET /live       the Live visitors panel alone, for the page's minute poll
 *   GET /attention  every "Attention required" row and every rule, for /attention
 *
 * Every panel is read on its own inside `reading()`, so one failing source
 * costs one panel. Nothing here asks a slow source past its cache: GA4 reads
 * are the GA4 module's own cached reads (the 30-day ones are kept warm by its
 * job), Search Console's are kept six hours, the engine's a minute, and the
 * crawl, probes and speed tests are what the desk already stored.
 *
 * The collectors are loaded inside the panels (`import()`), not at the top:
 * a collector that fails to load costs its panels, not this screen.
 *
 * Enquiries are read as counts only (countsByDay, byPage). No name, contact
 * detail or message is asked for here, so nothing needs `requireLeads`.
 *
 * ?specimen=1 (the dev copy only: specimenAllowed) fills the panels whose
 * source is not connected with the SPECIMEN_ rows at the end of this file.
 */
export const routes = new Hono<Vars>();

const ga4 = () => import("../ga4.ts");
const site = () => import("../site/index.ts");
const gsc = () => import("../search/gsc.ts");
const leads = () => import("../leads.ts");

type ScreenRange = "7d" | "30d" | "90d" | "1y";
const RANGES: readonly ScreenRange[] = ["7d", "30d", "90d", "1y"];
const rangeOf = (c: Context): ScreenRange => RANGES.find((r) => r === c.req.query("range")) ?? "30d";
const DAYS: Record<ScreenRange, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

/** A person's screen is asking: GA4 keeps its live poller and warm-up awake while this is said. */
const SCREEN = { screen: true } as const;

/* Noon, so a day shifted across a clock change is still that day. */
const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

/** One request's reads, each asked once however many panels need it. */
function once<T>(make: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= make());
}

/* ---------- the GA4 panels ------------------------------------------------ */

function ga4Reads(range: ScreenRange) {
  return {
    totals: once(async () => (await ga4()).totals(range, SCREEN)),
    byDay: once(async () => (await ga4()).byDay(range, SCREEN)),
    events: once(async () => (await ga4()).events(range, SCREEN)),
  };
}

async function visitorsTile(reads: ReturnType<typeof ga4Reads>): Promise<Reading<Stat>> {
  const g = await ga4();
  const [t, d] = await Promise.all([reads.totals(), reads.byDay()]);
  return g.asReading(t, (v) => ({
    value: v.current.activeUsers,
    previous: v.previous?.activeUsers ?? null,
    unit: "count" as const,
    series: d.data?.users.map((p) => p.value) ?? [],
  }));
}

/** GA4's generate_lead count: the stand-in under an absent Leads tile, named as what it is. */
async function formsSeen(reads: ReturnType<typeof ga4Reads>): Promise<Reading<Stat>> {
  const g = await ga4();
  const e = await reads.events();
  return g.asReading(e, (v) => {
    const row = v.rows.find((r) => r.name === "generate_lead");
    return {
      value: row?.count ?? 0,
      previous: v.span.previous ? (row?.previous?.count ?? 0) : null,
      unit: "count" as const,
      series: v.byDay.generate_lead.map((p) => p.value),
    };
  });
}

/**
 * GA4 generate_lead events over GA4 sessions: both counted from the same
 * consenting visitors, so the rate is of like over like. Never the engine's
 * enquiries over GA4's visitors.
 */
async function conversionTile(reads: ReturnType<typeof ga4Reads>): Promise<Reading<Stat>> {
  const g = await ga4();
  const [t, e, d] = await Promise.all([reads.totals(), reads.events(), reads.byDay()]);
  if (t.data === null) return g.asReading(t);
  if (e.data === null) return g.asReading(e);
  const sessions = t.data.current.sessions;
  const row = e.data.rows.find((r) => r.name === "generate_lead");
  const sent = row?.count ?? 0;
  if (sessions === 0) return waiting("ga4", "GA4 counted no sessions in this range, so there is nothing to divide by.");
  const before = t.data.previous && e.data.span.previous ? { sent: row?.previous?.count ?? 0, sessions: t.data.previous.sessions } : null;
  /* A day's rate from fewer than 30 sessions is noise (one form in three
     sessions is a 33% spike): such days are left out of the line, and with
     fewer than two days left the tile draws no line at all. */
  const perDay = new Map((d.data?.sessions ?? []).map((p) => [p.date, p.value]));
  const series = e.data.byDay.generate_lead.flatMap((p) => {
    const s = perDay.get(p.date) ?? 0;
    return s >= 30 ? [(p.value / s) * 100] : [];
  });
  /* A rate from fewer than 30 events has no second decimal to speak of: 5 of 95 is "5.3%", not "5.26%". */
  const rate = (n: number, of: number): number => (n < 30 ? Math.round((n / of) * 1000) / 10 : (n / of) * 100);
  return g.asReading(t, () => ({
    value: rate(sent, sessions),
    previous: before && before.sessions > 0 ? rate(before.sent, before.sessions) : null,
    unit: "percent" as const,
    series,
    sub: `${sent.toLocaleString("en-GB")} form submissions / ${sessions.toLocaleString("en-GB")} sessions`,
  }));
}

async function trafficPanel(reads: ReturnType<typeof ga4Reads>): Promise<Reading<TrafficPanel>> {
  const g = await ga4();
  const [t, d] = await Promise.all([reads.totals(), reads.byDay()]);
  if (d.data === null) return g.asReading(d);
  if (t.data === null) return g.asReading(t);
  const span = d.data.span;
  /* GA4 may still change yesterday and the day before. */
  const settledBefore = shift(span.provisionalFrom, -1);
  const days = d.data.users;
  return g.asReading(d, () => ({
    days,
    total: t.data!.current.activeUsers,
    previous: t.data!.previous?.activeUsers ?? null,
    provisional: days.filter((p) => p.date >= settledBefore).length,
    since: span.since,
    partial: span.partial,
  }));
}

/* Our six groups, in the board's order. LinkedIn is the GA4 module's own carve-out. */
const GROUPS = [
  ["organic", "Organic"],
  ["direct", "Direct"],
  ["linkedin", "LinkedIn"],
  ["referral", "Referral"],
  ["social", "Social"],
  ["other", "Other"],
] as const;

const groupOf = (key: string): (typeof GROUPS)[number][0] =>
  key === "organic-search" ? "organic" : key === "direct" ? "direct" : key === "linkedin" ? "linkedin" : key === "referral" ? "referral" : key === "organic-social" || key === "paid-social" ? "social" : "other";

async function sourcesPanel(range: ScreenRange): Promise<Reading<SourcesPanel>> {
  const g = await ga4();
  const r = await g.channels(range, SCREEN);
  const got = g.asReading(r, (v) => {
    const sum = new Map<string, number>(GROUPS.map(([k]) => [k, 0]));
    for (const row of v.rows) sum.set(groupOf(row.key), (sum.get(groupOf(row.key)) ?? 0) + row.sessions);
    return { slices: GROUPS.map(([key, label]) => ({ key, label, value: sum.get(key) ?? 0 })), total: v.sessions };
  });
  return got.state === "ok" && r.data ? { ...got, note: `Sessions. ${got.note ?? ""} Organic is Google's Organic Search group; Social is Organic and Paid Social without LinkedIn; Other is every remaining group. ${r.data.note}` } : got;
}

/** GA4's own realtime report for the property. */
const realtimeReport = (): string => `https://analytics.google.com/analytics/web/#/p${(process.env.GA4_PROPERTY_ID ?? "543223467").replace(/\D/g, "")}/realtime/overview`;

/**
 * Who is on the site now. Realtime knows page titles only, so each title is
 * matched to an address through the crawl's page table: the address when
 * exactly one page carries the title, the title as GA4 gave it otherwise.
 */
async function livePanel(): Promise<Reading<LivePanel>> {
  const g = await ga4();
  /* A person is looking at this panel: keep the live poller awake. */
  g.touch();
  const r = await g.live();
  const byTitle = new Map<string, string[]>();
  try {
    const inv = (await site()).inventory();
    if (inv.state === "ok") {
      for (const p of inv.value) {
        const t = p.title?.trim();
        if (!t) continue;
        byTitle.set(t, [...(byTitle.get(t) ?? []), p.path]);
      }
    }
  } catch {
    /* Without the crawl every row keeps its title. */
  }
  const got = g.asReading(r, (v) => {
    /* A title with views but nobody active on it now is not a live page. */
    const screens = v.screens.filter((s) => s.users > 0);
    const pages: LivePage[] = screens.slice(0, 5).map((s) => {
      const paths = byTitle.get(s.title.trim()) ?? [];
      return paths.length === 1
        ? { label: paths[0]!, href: `/pages?open=${encodeURIComponent(paths[0]!)}`, shown: "address" as const, users: s.users }
        : { label: s.title || "(not set)", href: null, shown: "title" as const, users: s.users };
    });
    return { total: v.total, pages, more: Math.max(0, screens.length - 5), age: r.age, report: realtimeReport() };
  });
  return got.state === "ok" ? { ...got, note: `${got.note} Pages are matched to addresses by their title through the desk's crawl; a title no page or several pages carry is shown as GA4 gave it.` } : got;
}

async function countriesPanel(range: ScreenRange): Promise<Reading<CountriesPanel>> {
  const g = await ga4();
  return g.asReading(await g.countries(range, SCREEN), (v) => ({
    rows: v.rows.filter((c) => c.users > 0).map((c) => ({ code: c.code, name: c.name, users: c.users })),
    total: v.rows.reduce((n, c) => n + c.users, 0),
  }));
}

async function topPagesPanel(range: ScreenRange, specimen: boolean): Promise<Reading<TopPagesPanel>> {
  const g = await ga4();
  const r = await g.pages(range, SCREEN);
  if (r.data === null) return g.asReading(r);
  const pictures = new Map<string, string | null>();
  try {
    const inv = (await site()).inventory();
    if (inv.state === "ok") for (const p of inv.value) pictures.set(p.path, p.sharePicture);
  } catch {
    /* No pictures without the crawl; the rows stand. */
  }
  const rows = r.data.rows.slice(0, 5).map((p) => ({ path: p.path, picture: pictures.get(p.path) ?? null, users: p.users, previous: p.previous?.users ?? null }));
  const sends = await reading<PageSends>("engine", () => (specimen ? SPECIMEN_SENDS(rows.map((x) => x.path)) : pageSends(range)));
  return g.asReading(r, () => ({ rows, sends }));
}

/** The last column of Top pages: the engine's enquiries per page, or GA4's form submissions standing in, labelled. */
async function pageSends(range: ScreenRange): Promise<Reading<PageSends>> {
  const l = await leads();
  if (l.configured()) {
    const r = await l.byPage(range);
    if (r.state !== "ok") return r;
    return ok(
      { label: "Enquiries", note: "Enquiries sent from the page's form, counted by the engine.", byPath: Object.fromEntries(r.value.filter((x) => x.key).map((x) => [x.key, x.count])) },
      "engine",
      r.asOf,
      r.note,
    );
  }
  const g = await ga4();
  const e = await g.eventByPage("generate_lead", range, SCREEN);
  return g.asReading(e, (v) => ({
    label: "Form sends",
    note: "Standing in until the engine's enquiry counts are connected: generate_lead events GA4 saw on the page, from consenting visitors only.",
    byPath: Object.fromEntries(v.rows.map((x) => [x.path, x.count])),
  }));
}

/* ---------- the tiles that wait for a key ---------------------------------- */

async function leadsTile(range: ScreenRange): Promise<Reading<Stat>> {
  const r = await (await leads()).countsByDay(range);
  return r.state === "ok" ? { ...r, value: r.value.enquiries } : r;
}

async function organicTile(range: ScreenRange): Promise<Reading<Stat>> {
  const r = await (await gsc()).totalsByDay(range);
  return r.state === "ok" ? { ...r, value: r.value.clicks } : r;
}

/** Indexed sitemap addresses / the sitemap's count. URL Inspection, once a day; never the crawl's page count. */
async function indexedTile(range: ScreenRange): Promise<Reading<Stat>> {
  const g = await gsc();
  const r = await g.indexing();
  if (r.state !== "ok") return r;
  /* The whole is the sitemap as it stood on the day that was checked; today's
     sitemap only for a day checked before that count was kept. */
  let total = r.value.of ?? null;
  if (total === null) {
    try {
      total = (await site()).lastSitemap()?.entries.length ?? null;
    } catch {
      total = null;
    }
  }
  total ??= r.value.inspected;
  const history = g.indexHistory(DAYS[range]);
  const first = history[0];
  const issues = r.value.rows.filter((x) => !x.indexed || x.canonicalOk === false).length;
  const says = `${issues} ${issues === 1 ? "issue" : "issues"}`;
  /* A check cut short covers part of the sitemap: the addresses without a
     result are neither indexed nor an issue, and the line says how many had one. */
  const complete = r.value.complete === true && r.value.inspected >= total;
  return ok(
    {
      value: r.value.indexed,
      of: total,
      /* The day the range began, when the desk was already checking then. */
      previous: first && history.length > 1 && first.day <= shift(r.value.day, -(DAYS[range] - 1)) ? first.indexed : null,
      unit: "count",
      series: history.map((h) => h.indexed),
      sub: complete ? says : `${r.value.inspected} of ${total} checked · ${says}`,
    },
    "gsc",
    r.asOf,
    `${r.note ?? ""} An issue is an address Google has not indexed or for which it chose another canonical.`.trim(),
  );
}

/* ---------- the desk's own panels ----------------------------------------- */

function activityPanel(): Reading<ActivityItem[]> {
  return ok(activity(5).map(scrubItem), "desk", new Date().toISOString(), "The desk's activity log: deployments and published insights from the website's repository, sitemap and crawl changes, incidents, and changes made in the desk.");
}

function auditJob(): AuditJob | null {
  const j = jobStatus().find((x) => x.name === "crawl");
  if (!j) return null;
  return {
    name: j.name,
    title: j.title,
    every: j.every,
    ready: j.ready,
    enabled: j.enabled,
    running: j.running,
    lastStart: j.lastStart,
    lastEnd: j.lastEnd,
    lastOk: j.lastOk,
    progress: j.progress ? { ...j.progress, ...(j.progress.what ? { what: scrub(j.progress.what) } : {}) } : null,
  };
}

type VitalReading = Awaited<ReturnType<Awaited<ReturnType<typeof site>>["vital"]>>;

const cell = (r: VitalReading): Reading<VitalCell> =>
  r.state === "ok"
    ? { ...r, value: { kind: r.value.kind, value: r.value.value, unit: r.value.unit, rating: r.value.rating, strategy: r.value.strategy, pages: r.value.pages, history: r.value.history.map((p) => p.value) } }
    : r;

async function performancePanel(range: ScreenRange): Promise<PerformancePanel> {
  const days = DAYS[range];
  const one = async <T>(source: "psi" | "crux" | "probe", make: (s: Awaited<ReturnType<typeof site>>) => Reading<T>): Promise<Reading<T>> =>
    reading<T>(source, async () => make(await site()));
  /* Field when Google has it, the lab otherwise; the cell says which. */
  const fieldOrLab = (s: Awaited<ReturnType<typeof site>>, m: "lcp" | "cls"): Reading<VitalCell> => {
    const f = s.vital(m, "mobile", { from: "field", days });
    return cell(f.state === "ok" ? f : s.vital(m, "mobile", { days }));
  };
  const [lcp, inp, tbt, cls, uptime] = await Promise.all([
    one("psi", (s) => fieldOrLab(s, "lcp")),
    one("crux", (s) => {
      const r = cell(s.vital("inp", "mobile", { days }));
      /* The speed module's step for INP is written for a screen builder; the
         person reading this has nothing to switch on, and the lab stand-in
         is drawn right under it. */
      return r.state === "off" && r.step?.includes("vital(") ? { state: "off" as const, source: r.source, reason: r.reason } : r;
    }),
    one("psi", (s) => cell(s.vital("tbt", "mobile", { days }))),
    one("psi", (s) => fieldOrLab(s, "cls")),
    one<UptimeCell>("probe", (s) => {
      const u = s.uptime(range);
      return u.state === "ok" ? { ...u, value: { percent: u.value.percent, checks: u.value.checks, failed: u.value.failed, since: u.value.since, history: u.value.days.map((p) => p.value) } } : u;
    }),
  ]);
  return { lcp, inp, tbt, cls, uptime };
}

/* ---------- the routes ------------------------------------------------------ */

routes.get("/", async (c) => {
  const range = rangeOf(c);
  const specimen = specimenAllowed(c);
  const reads = ga4Reads(range);

  const [visitors, leadsR, formsR, organic, indexed, conversion, traffic, sources, live, att, perf, topPages, countries] = await Promise.all([
    reading("ga4", () => visitorsTile(reads)),
    specimen ? SPECIMEN_LEADS : reading("engine", () => leadsTile(range)),
    reading("ga4", () => formsSeen(reads)),
    specimen ? SPECIMEN_CLICKS : reading("gsc", () => organicTile(range)),
    specimen ? SPECIMEN_INDEXED : reading("gsc", () => indexedTile(range)),
    reading("ga4", () => conversionTile(reads)),
    reading("ga4", () => trafficPanel(reads)),
    reading("ga4", () => sourcesPanel(range)),
    reading("ga4-live", () => livePanel()),
    reading("desk", () => attention(range, specimen ? { replace: SPECIMEN_RULES } : {})),
    performancePanel(range).catch((e: unknown): PerformancePanel => {
      const w = waiting<never>("psi", `The speed and uptime figures could not be read: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
      return { lcp: w, inp: w, tbt: w, cls: w, uptime: w };
    }),
    reading("ga4", () => topPagesPanel(range, specimen)),
    reading("ga4", () => countriesPanel(range)),
  ]);

  const tiles: OverviewTiles = {
    visitors,
    leads: leadsR,
    formsSeen: leadsR.state === "ok" ? null : formsR,
    organicClicks: organic,
    indexed,
    conversion,
  };

  /* In a specimen, the speed cells that have no real reading are fed too. */
  const performance: PerformancePanel = specimen
    ? { ...perf, lcp: perf.lcp.state === "ok" ? perf.lcp : SPECIMEN_VITAL("lcp"), tbt: perf.tbt.state === "ok" ? perf.tbt : SPECIMEN_VITAL("tbt"), cls: perf.cls.state === "ok" ? perf.cls : SPECIMEN_VITAL("cls") }
    : perf;

  let activityR: Reading<ActivityItem[]>;
  try {
    activityR = activityPanel();
  } catch (e) {
    activityR = waiting("desk", `The activity log could not be read: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
  }

  return c.json<Overview>({
    range,
    specimen,
    tiles,
    traffic,
    sources,
    live,
    attention: att.state === "ok" ? { ...att, value: { ...att.value, items: att.value.items.slice(0, 3) } } : att,
    activity: activityR,
    audit: auditJob(),
    performance,
    topPages,
    countries,
  });
});

routes.get("/live", async (c) => {
  const live = await reading("ga4-live", () => livePanel());
  return c.json<OverviewLive>(live);
});

routes.get("/attention", async (c) => {
  const range = rangeOf(c);
  const specimen = specimenAllowed(c);
  const att = await reading("desk", () => attention(range, specimen ? { replace: SPECIMEN_RULES } : {}));
  return c.json<OverviewAttention>({ range, specimen, attention: att });
});

/* ---------- specimen: the dev copy's ?specimen=1 only ------------------------
   Obviously made-up figures and addresses, for photographing the connected
   state of panels whose key does not exist yet. Never served on the real desk
   (specimenAllowed has the dev sign-in's three locks). */

const SPECIMEN_AT = "2000-01-01T00:00:00.000Z";
const SPECIMEN_NOTE = "Specimen: made-up figures for the dev copy, not a reading.";
const ramp = (n: number, step = 1): number[] => Array.from({ length: n }, (_, i) => (i % 7) * step + step);

const SPECIMEN_LEADS: Reading<Stat> = ok({ value: 123, previous: 100, unit: "count", series: ramp(30) }, "engine", SPECIMEN_AT, SPECIMEN_NOTE);
const SPECIMEN_CLICKS: Reading<Stat> = ok({ value: 456, previous: 400, unit: "count", series: ramp(30, 2) }, "gsc", SPECIMEN_AT, SPECIMEN_NOTE);
const SPECIMEN_INDEXED: Reading<Stat> = ok({ value: 90, of: 100, previous: 80, unit: "count", series: ramp(30, 3), sub: "10 issues" }, "gsc", SPECIMEN_AT, SPECIMEN_NOTE);

const specimenRow = (rule: string, letter: string, area: AttentionItem["area"], tone: AttentionItem["tone"], text: string, label: string, source: AttentionItem["source"]): AttentionItem => ({
  id: `${rule}|/specimen-${letter}`,
  subject: `/specimen-${letter}`,
  text,
  area,
  tone,
  action: { label, href: `/pages?open=${encodeURIComponent(`/specimen-${letter}`)}` },
  source,
});

const SPECIMEN_RULES: Record<string, () => Reading<AttentionItem[]>> = {
  "seo.position-drop": () => ok([specimenRow("seo.position-drop", "a", "SEO", "bad", "Average position 1 → 11 in Google", "Investigate", "gsc")], "gsc", SPECIMEN_AT, SPECIMEN_NOTE),
  "seo.low-ctr": () => ok([specimenRow("seo.low-ctr", "b", "SEO", "warn", "CTR 1% against 3%, our median at positions 4 to 6", "Improve", "gsc")], "gsc", SPECIMEN_AT, SPECIMEN_NOTE),
  "conversion.page-enquiries": () => ok([specimenRow("conversion.page-enquiries", "c", "CONVERSION", "good", "Enquiries sent from this page 1 → 10", "View", "engine")], "engine", SPECIMEN_AT, SPECIMEN_NOTE),
};

const SPECIMEN_SENDS = (paths: string[]): Reading<PageSends> =>
  ok({ label: "Enquiries", note: SPECIMEN_NOTE, byPath: Object.fromEntries(paths.map((p, i) => [p, (i + 1) * 11])) }, "engine", SPECIMEN_AT, SPECIMEN_NOTE);

const SPECIMEN_VITAL = (m: "lcp" | "tbt" | "cls"): Reading<VitalCell> =>
  ok(
    m === "cls"
      ? { kind: "lab", value: 0.05, unit: "score", rating: "good", strategy: "mobile", pages: 7, history: ramp(30).map((v) => v / 100) }
      : { kind: "lab", value: m === "lcp" ? 1234 : 123, unit: "ms", rating: "good", strategy: "mobile", pages: 7, history: ramp(30, m === "lcp" ? 100 : 10) },
    "psi",
    SPECIMEN_AT,
    SPECIMEN_NOTE,
  );
