import { Hono } from "hono";
import { me, type Vars } from "../access.ts";
import { specimenAllowed } from "../specimen.ts";
import { off, ok, reading, today, waiting } from "../store.ts";
import * as ga4 from "../ga4.ts";
import * as leads from "../leads.ts";
import { inventory, KIND_LABEL, type PageRow } from "../site/index.ts";
import { deepLink } from "../search/clarity.ts";
import { addDays, dayIn, eachDay } from "../search/shared.ts";
import type { Reading, Share, Stat } from "../../../web/src/contract/common.ts";
import type {
  ChannelData,
  ConversionTiles,
  ConversionsPayload,
  ConversionsRange,
  FunnelData,
  GroupList,
  GroupRow,
  RateStat,
  RecentLead,
  StartPlace,
  StartsData,
  TopPage,
  TopPages,
  TrendData,
} from "../../../web/src/contract/conversions.ts";

/**
 * /api/v1/conversions — the Conversions screen, in one GET.
 *
 *   GET /?range=30d&funnel=&channels=&trend=&specimen=1
 *
 * `range` is the page's period; `funnel`, `channels` and `trend` are the
 * periods of the three panels that have a select of their own on the board,
 * and follow `range` when they are not given.
 *
 * TWO SOURCES, NEVER BLENDED. GA4 (events from consenting visitors, tied to
 * pages, channels and days) and the engine (every stored enquiry, with stage
 * and call, but no source and no value). A tile that belongs to the engine
 * never shows a GA4 figure as its own: the GA4 count travels beside it as a
 * separate reading, named as what it is.
 *
 * Each panel is made by its own function from what was read, and each read is
 * wrapped so that one failing source costs its own panels only. The
 * functions that make panels take plain inputs and are exported, so
 * scripts/check-cc-conversions.ts can feed them rows of its own.
 *
 * PERSONAL DATA. Enquiry rows are asked for only when the person may see
 * leads, and only the fields the table prints leave this file: never an
 * address, a telephone number or a message. Counts go to everybody signed in.
 */
export const routes = new Hono<Vars>();

const RANGES: readonly ConversionsRange[] = ["7d", "30d", "90d", "1y"];

/** A period from a query string; anything unknown is `fallback`. */
export const rangeOf = (asked: string | undefined, fallback: ConversionsRange): ConversionsRange =>
  RANGES.find((r) => r === asked) ?? fallback;

/** The fewest sessions a page needs before "Top converting pages" prints its rate. */
export const RATE_FLOOR = 100;
/** How many recent enquiries the table shows. */
const RECENT = 5;
/** How many slices the channel donut draws before folding the rest into "Other". */
const SLICES = 5;

const FUNNEL_NOTE =
  "Event counts, not one visitor followed through: a sheet can open without a click, a form can be started on a page with no sheet, so a step can be larger than the one before it.";
const FORM_START_NOTE =
  "form_start is GA4's own event (enhanced measurement): the first time in a session a visitor uses any form on the site, the search and the AI guide included, not only the enquiry form.";
const SPECIMEN_NOTE = "SPECIMEN: artificial rows written into the route's own file for the development copy. Not enquiries.";

/* ---------- the route ------------------------------------------------------ */

routes.get("/", async (c) => {
  const who = me(c);
  const range = rangeOf(c.req.query("range"), "30d");
  const ranges = {
    funnel: rangeOf(c.req.query("funnel"), range),
    channels: rangeOf(c.req.query("channels"), range),
    trend: rangeOf(c.req.query("trend"), range),
  };
  const specimen = specimenAllowed(c);
  /* A person has this screen open: the GA4 warm-up and live poller may stay awake. */
  ga4.touch();
  return c.json<ConversionsPayload>(await screen({ range, ranges, specimen, seesLeads: who.seesLeads }));
});

async function screen(o: { range: ConversionsRange; ranges: ConversionsPayload["ranges"]; specimen: boolean; seesLeads: boolean }): Promise<ConversionsPayload> {
  const { range, ranges, specimen, seesLeads } = o;

  /* GA4: the page's period, then whatever the three panels' own periods add.
     Reads of the same period are the same question and come from GA4's cache. */
  const [events, totals, days] = await Promise.all([ga4.events(range), ga4.totals(range), ga4.byDay(range)]);
  const span = events.data?.span ?? null;
  const [formDays, byPage, starts, params] = await Promise.all([
    span ? formStartDays(span) : Promise.resolve(null),
    ga4.eventByPage("generate_lead", range),
    span ? startsReport(span) : Promise.resolve(null),
    ga4.eventParams(),
  ]);
  const sessions = byPage.data && span ? await pageSessions(byPage.data.rows.slice(0, 100).map((r) => r.path), span) : null;
  const [funnelEvents, funnelTotals, channels, trendEvents] = await Promise.all([
    ranges.funnel === range ? events : ga4.events(ranges.funnel),
    ranges.funnel === range ? totals : ga4.totals(ranges.funnel),
    ga4.eventByChannel("generate_lead", ranges.channels),
    ranges.trend === range ? events : ga4.events(ranges.trend),
  ]);

  /* The engine, or its specimen. */
  const engine = specimen ? specimenEngine(range, Date.now(), seesLeads) : await engineReads(range, seesLeads);
  const pages = inventory();

  const ev = asRead(events);
  /* A read that could not be asked because the period itself could not be read says why the period could not. */
  const orEvents = <T>(r: ga4.Read<T> | null): Reading<T> => (r ? asRead(r) : ev.state === "ok" ? waiting("ga4", "Not read yet.") : ev);
  return {
    range,
    ranges,
    specimen,
    seesLeads,
    tiles: tilesSafely(() => tilesFrom({ events: ev, totals: asRead(totals), days: asRead(days), formDays: orEvents(formDays), counts: engine.counts })),
    funnel: await reading("ga4", () => funnelFrom(asRead(funnelEvents), asRead(funnelTotals))),
    channels: await reading("ga4", () => channelsFrom(asRead(channels))),
    topPages: await reading("ga4", () => topPagesFrom(asRead(byPage), sessions ? asRead(sessions) : null, pages)),
    trend: await reading("ga4", () => trendFrom(asRead(trendEvents))),
    services: await reading("engine", () => servicesFrom(engine.services, engine.counts)),
    pageGroups: await reading("engine", () => pageGroupsFrom(engine.pages, engine.counts, pages)),
    starts: await reading("ga4", () => startsFrom(orEvents(starts), asRead(params))),
    ...clarityLink(),
    recent: await reading("engine", () => recentFrom(engine.recent, engine.counts, seesLeads, range)),
  };
}

/** Clarity's heatmaps, and whether the link really reaches them: without the project id it is Clarity's list of projects. */
function clarityLink(): Pick<ConversionsPayload, "heatmaps" | "heatmapsDirect"> {
  const link = deepLink();
  return { heatmaps: link.heatmaps, heatmapsDirect: link.heatmaps.endsWith("/heatmaps") };
}

/** The tiles are eight readings, not one: if making them throws, each says so and the pipeline tile still says what it always says. */
function tilesSafely(make: () => ConversionTiles): ConversionTiles {
  try {
    return make();
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    const w = <T>(): Reading<T> => waiting("ga4", `The last read failed: ${why}`);
    return { leads: w(), leadsGa4: w(), booked: w(), bookedGa4: w(), formStarts: w(), submissions: w(), rate: w(), pipeline: pipelineTile() };
  }
}

/* ---------- reading GA4 ------------------------------------------------------ */

/** A GA4 read as a Reading whose value is the whole answer. */
const asRead = <T>(read: ga4.Read<T>): Reading<T> => ga4.asReading(read);

/** The days of a span GA4 has data for: from where measurement began, or the span's start. */
const measured = (span: ga4.Span): { startDate: string; endDate: string } => ({ startDate: span.since > span.start ? span.since : span.start, endDate: span.end });

/** form_start day by day, and its count in the period before when that period was measured whole. */
export interface FormStartDays {
  span: ga4.Span;
  days: Record<string, number>;
  /** form_start in `span.previous`; null when there is no period before to compare with. */
  previous: number | null;
}

/**
 * form_start per day: GA4's own event is not among the website's five that
 * `events()` lines up by day. The period before is asked in the same request,
 * because `events()` lists only what fired in this period: a form_start that
 * happened only before would otherwise have no count before at all.
 */
function formStartDays(span: ga4.Span): Promise<ga4.Read<FormStartDays>> {
  const before = span.previous ? [{ startDate: span.previous.start, endDate: span.previous.end }] : [];
  return ga4
    .report({ dimensions: ["date"], metrics: ["eventCount"], dateRanges: [measured(span), ...before], dimensionFilter: ga4.where.is("eventName", "form_start"), orderBys: [{ by: "date" }], limit: 1600 })
    .then((r) =>
      r.data
        ? {
            ...r,
            data: {
              span,
              days: Object.fromEntries(r.data.rows.map((row) => [String(row.date), Number(row.eventCount) || 0])),
              previous: span.previous ? (r.data.ranges[1] ?? []).reduce((n, row) => n + (Number(row.eventCount) || 0), 0) : null,
            },
          }
        : { ...r, data: null },
    );
}

/** Sessions in which each of these pages was seen, over the span. */
function pageSessions(paths: string[], span: ga4.Span): Promise<ga4.Read<Record<string, number>>> {
  if (!paths.length) return Promise.resolve({ data: {}, at: Date.now(), source: "ga4" });
  /* GA4 may hold an address with or without its trailing slash; both are asked and added. */
  const asked = [...new Set(paths.flatMap((p) => (p === "/" ? [p] : [p, `${p}/`])))];
  return ga4
    .report({ dimensions: ["pagePath"], metrics: ["sessions"], dateRanges: [measured(span)], dimensionFilter: ga4.where.among("pagePath", asked), limit: 1000 })
    .then((r) => {
      if (!r.data) return { ...r, data: null };
      const out: Record<string, number> = {};
      for (const row of r.data.rows) {
        const path = ga4.normalPath(String(row.pagePath));
        out[path] = (out[path] ?? 0) + (Number(row.sessions) || 0);
      }
      return { ...r, data: out };
    });
}

/** One row of the "Where enquiries start" report. */
export interface StartRow {
  eventName: string;
  method: string;
  pagePath: string;
  count: number;
}

/** generate_lead, book_meeting and invite_shown by their `method` and the page they were sent from. One request. */
function startsReport(span: ga4.Span): Promise<ga4.Read<StartRow[]>> {
  return ga4
    .report({
      dimensions: ["eventName", "method", "pagePath"],
      metrics: ["eventCount"],
      dateRanges: [measured(span)],
      dimensionFilter: ga4.where.among("eventName", ["generate_lead", "book_meeting", "invite_shown"]),
      limit: 2000,
    })
    .then((r) =>
      r.data
        ? { ...r, data: r.data.rows.map((row) => ({ eventName: String(row.eventName), method: String(row.method ?? ""), pagePath: ga4.normalPath(String(row.pagePath ?? "")), count: Number(row.eventCount) || 0 })) }
        : { ...r, data: null },
    );
}

/* ---------- reading the engine ----------------------------------------------- */

/** What the engine's panels are made from. Rows only when the person may see leads. */
export interface EngineInputs {
  counts: Reading<leads.EnquiryCounts>;
  services: Reading<leads.Group[]>;
  pages: Reading<leads.Group[]>;
  /** Null when the person may not see leads: then nobody asked for rows. */
  recent: Reading<leads.Enquiry[]> | null;
}

async function engineReads(range: ConversionsRange, seesLeads: boolean): Promise<EngineInputs> {
  const [counts, services, pages, recent] = await Promise.all([
    reading("engine", () => leads.countsByDay(range)),
    reading("engine", () => leads.byService(range)),
    reading("engine", () => leads.byPage(range)),
    /* PERSONAL DATA: asked for only here, only for a person who may see leads. */
    seesLeads ? reading("engine", () => leads.recent(RECENT)) : Promise.resolve(null),
  ]);
  return { counts, services, pages, recent };
}

/* ---------- making the panels: plain inputs in, readings out ------------------- */

/** All readings ok, or the first that is not. The figure is as old as its oldest part. */
function joined<A, B, T>(a: Reading<A>, b: Reading<B>, make: (a: A, b: B) => T, note?: string): Reading<T> {
  if (a.state !== "ok") return a;
  if (b.state !== "ok") return b;
  const asOf = a.asOf < b.asOf ? a.asOf : b.asOf;
  return ok(make(a.value, b.value), a.source, asOf, [a.note, note].filter(Boolean).join(" ") || undefined);
}

const mapped = <A, T>(r: Reading<A>, make: (a: A) => T, note?: string): Reading<T> =>
  r.state === "ok" ? ok(make(r.value), r.source, r.asOf, [r.note, note].filter(Boolean).join(" ") || undefined) : r;

/**
 * One event's count in the period and the one before. An event that did not
 * fire in this period is a zero now, but `events()` lists only what fired in
 * this period, so its count before is not in `rows`: for the website's own
 * events it is added up from the day series, which covers both periods. For
 * any other event it is unknown here (null), never a made-up zero.
 */
export function eventCount(e: ga4.Events, name: string): { now: number; before: number | null } {
  const row = e.rows.find((r) => r.name === name);
  const now = row?.count ?? 0;
  if (!e.span.previous) return { now, before: null };
  if (row?.previous) return { now, before: row.previous.count };
  const days = (e.byDay as Partial<Record<string, { previous: number | null }[]>>)[name];
  if (!days) return { now, before: null };
  return { now, before: days.reduce<number | null>((n, p) => (n === null || p.previous === null ? null : n + p.previous), 0) };
}

/** Said when a period begins before GA4 measured the website: its figures cover the days since. */
const measuredNote = (span: ga4.Span): string | undefined => (span.partial ? `GA4 measured the website from ${dayText(span.since)}: the period's earlier days hold nothing, so these figures cover ${dayText(span.since)} to ${dayText(span.end)}.` : undefined);

/** "21 Sep 2026", as the desk writes a day in words. */
const dayText = (day: string): string => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The first day measured, when the period begins before it; null when it was measured whole. */
const measuredFrom = (span: ga4.Span | undefined): string | null => (span?.partial ? span.since : null);

const daily = (points: { value: number }[] | undefined): number[] => (points ?? []).map((p) => p.value);

/** The six tiles. */
export function tilesFrom(i: {
  events: Reading<ga4.Events>;
  totals: Reading<ga4.Totals>;
  days: Reading<ga4.Days>;
  formDays: Reading<FormStartDays>;
  counts: Reading<leads.EnquiryCounts>;
}): ConversionTiles {
  const partly = i.events.state === "ok" ? measuredNote(i.events.value.span) : undefined;
  const stat = (name: ga4.SiteEvent, series: (e: ga4.Events) => number[]) =>
    mapped(
      i.events,
      (e): Stat => {
        const c = eventCount(e, name);
        return { value: c.now, previous: c.before, unit: "count", series: series(e) };
      },
      partly,
    );

  const submissions = stat("generate_lead", (e) => daily(e.byDay.generate_lead));
  const booked = stat("book_meeting", (e) => daily(e.byDay.book_meeting));

  const formStarts: Reading<Stat> = joined(
    i.events,
    i.formDays,
    (e, f) => {
      const c = eventCount(e, "form_start");
      const from = measured(e.span);
      /* form_start is not one of the website's five, so when it did not fire in this period its count before comes from its own read. */
      const before = e.span.previous ? (c.before ?? f.previous) : null;
      return { value: c.now, previous: before, unit: "count", series: eachDay(from.startDate, from.endDate).map((d) => f.days[d] ?? 0) };
    },
    [FORM_START_NOTE, partly].filter(Boolean).join(" "),
  );

  return {
    leads: mapped(i.counts, (c) => c.enquiries),
    leadsGa4: submissions,
    booked: mapped(i.counts, (c) => c.booked),
    bookedGa4: booked,
    formStarts,
    submissions,
    rate: rateTile(i.events, i.totals, i.days),
    pipeline: pipelineTile(),
  };
}

/** generate_lead per session, with the two counts. No sessions: no rate, which is not a rate of zero. */
export function rateTile(events: Reading<ga4.Events>, totals: Reading<ga4.Totals>, days: Reading<ga4.Days>): Reading<RateStat> {
  if (events.state !== "ok") return events;
  if (totals.state !== "ok") return totals;
  const leadsNow = eventCount(events.value, "generate_lead");
  const t = totals.value;
  if (t.current.sessions <= 0) return waiting("ga4", "GA4 counted no sessions in this period, so there is no rate to work out.");
  const before = t.previous && leadsNow.before !== null && t.previous.sessions > 0 ? (leadsNow.before / t.previous.sessions) * 100 : null;
  /* The spark: the rate of each day that had a session. A day without one has no rate and is left out. */
  const perDay = events.value.byDay.generate_lead;
  const sessionsOn = new Map((days.state === "ok" ? days.value.sessions : []).map((p) => [p.date, p.value]));
  const series = perDay.flatMap((p) => {
    const s = sessionsOn.get(p.date) ?? 0;
    return s > 0 ? [(p.value / s) * 100] : [];
  });
  return ok(
    {
      value: (leadsNow.now / t.current.sessions) * 100,
      previous: before,
      unit: "percent",
      series,
      part: leadsNow.now,
      whole: t.current.sessions,
      /* Short, so the tile keeps room for its spark: what the first count is, the (i) and the stamp's note say. */
      sub: `${leadsNow.now} in ${t.current.sessions} ${t.current.sessions === 1 ? "session" : "sessions"}`,
    },
    "ga4",
    events.asOf < totals.asOf ? events.asOf : totals.asOf,
    [events.note, "generate_lead events divided by sessions, both from GA4.", measuredNote(events.value.span)].filter(Boolean).join(" "),
  );
}

/** No source holds a value for an enquiry. Said, with what would make one. */
export const pipelineTile = (): Reading<Stat> =>
  off(
    "none",
    /* Short enough to be read whole in the tile; the why and the step are in its bubble. */
    "No value is recorded anywhere for an enquiry.",
    "The website's form asks no budget and the engine keeps no deal amount. Add a budget question to the enquiry form, or enter a value per enquiry in the engine; the desk would then add them up here.",
  );

/** The funnel: visitors, then each step the website really measures, by its real event. */
export function funnelFrom(events: Reading<ga4.Events>, totals: Reading<ga4.Totals>): Reading<FunnelData> {
  return joined(
    events,
    totals,
    (e, t) => ({
      steps: [
        { key: "visitors", label: "Visitors", event: "active users", value: t.current.activeUsers },
        { key: "sheet", label: "Sheet shown", event: "invite_shown", value: eventCount(e, "invite_shown").now },
        { key: "form", label: "Form started", event: "form_start", value: eventCount(e, "form_start").now },
        { key: "enquiry", label: "Enquiry (submitted)", event: "generate_lead", value: eventCount(e, "generate_lead").now },
        { key: "call", label: "Booked call", event: "book_meeting", value: eventCount(e, "book_meeting").now },
      ],
      partial: e.span.partial,
      since: e.span.since,
    }),
    [FUNNEL_NOTE, events.state === "ok" ? measuredNote(events.value.span) : undefined].filter(Boolean).join(" "),
  );
}

/** generate_lead by channel: the largest few, and the rest as "Other". */
export function channelsFrom(r: Reading<{ rows: ga4.EventChannelRow[]; note: string; span?: ga4.Span }>): Reading<ChannelData> {
  return mapped(
    r,
    (d) => {
      const rows = d.rows.filter((x) => x.count > 0);
      const head = rows.length > SLICES ? rows.slice(0, SLICES - 1) : rows;
      const tail = rows.slice(head.length).reduce((n, x) => n + x.count, 0);
      const slices: Share[] = head.map((x) => ({ key: x.key, label: x.label, value: x.count }));
      if (tail > 0) slices.push({ key: "other", label: "Other", value: tail });
      return { slices, total: rows.reduce((n, x) => n + x.count, 0), measuredFrom: measuredFrom(d.span) };
    },
    r.state === "ok" ? [r.value.note, r.value.span && measuredNote(r.value.span)].filter(Boolean).join(" ") : undefined,
  );
}

/** Pages enquiries were sent from, with a rate only where the page had enough sessions for one. */
export function topPagesFrom(byPage: Reading<{ rows: ga4.EventPageRow[]; span?: ga4.Span }>, sessions: Reading<Record<string, number>> | null, crawl: Reading<PageRow[]>): Reading<TopPages> {
  if (byPage.state !== "ok") return byPage;
  const known = new Map((crawl.state === "ok" ? crawl.value : []).map((p) => [p.path, p]));
  const seen = sessions && sessions.state === "ok" ? sessions.value : null;
  const rows: TopPage[] = byPage.value.rows
    .filter((r) => r.count > 0)
    .slice(0, 100)
    .map((r) => {
      const s = seen ? (seen[r.path] ?? null) : null;
      const page = known.get(r.path);
      return {
        path: r.path,
        title: page?.title ?? null,
        picture: page?.sharePicture ?? null,
        enquiries: r.count,
        sessions: s,
        rate: s !== null && s >= RATE_FLOOR ? (r.count / s) * 100 : null,
      };
    });
  const caveat = `generate_lead events by the page they were sent from. A rate is printed only for a page seen in ${RATE_FLOOR} sessions or more.${seen ? "" : " Sessions per page could not be read, so no rate is printed."}`;
  const span = byPage.value.span;
  return ok({ rows, floor: RATE_FLOOR, measuredFrom: measuredFrom(span) }, byPage.source, byPage.asOf, [byPage.note, caveat, span && measuredNote(span)].filter(Boolean).join(" "));
}

/** Form submissions and booked calls per day across the whole period; a day before GA4 measured anything is null, not zero. */
export function trendFrom(events: Reading<ga4.Events>): Reading<TrendData> {
  return mapped(events, (e) => {
    const sub = new Map(e.byDay.generate_lead.map((p) => [p.date, p.value]));
    const call = new Map(e.byDay.book_meeting.map((p) => [p.date, p.value]));
    return {
      days: eachDay(e.span.start, e.span.end).map((date) =>
        date < e.span.since ? { date, submissions: null, booked: null } : { date, submissions: sub.get(date) ?? 0, booked: call.get(date) ?? 0 },
      ),
      provisionalFrom: e.span.provisionalFrom,
      since: e.span.since,
    };
  });
}

/** The engine's groups as the panel lists them, with how many enquiries there were in all. */
function groupList(groups: Reading<leads.Group[]>, counts: Reading<leads.EnquiryCounts>, rows: (g: leads.Group[]) => GroupRow[], note?: string): Reading<GroupList> {
  return mapped(groups, (g) => ({ rows: rows(g), total: counts.state === "ok" ? counts.value.enquiries.value : null }), note);
}

/** Enquiries by the services ticked on the form. */
export function servicesFrom(groups: Reading<leads.Group[]>, counts: Reading<leads.EnquiryCounts>): Reading<GroupList> {
  const said = groups.state === "ok" && /counted under each/.test(groups.note ?? "");
  return groupList(
    groups,
    counts,
    (g) => g.map((x) => ({ key: x.key || "none", label: x.label, count: x.count, previous: x.previous })).filter((x) => x.count > 0),
    said ? undefined : "By the services ticked on the form. An enquiry that names several services is counted under each, so the groups add up to more than the enquiries.",
  );
}

/** "/how-to-get-more-clients-for-my-law-firm | Balkaris" without the site's name. */
const bare = (title: string | null): string | null => (title ? title.split(/\s+[|·–—]\s+/)[0]!.trim() || null : null);

/**
 * The kind of page an enquiry was sent from. An industry page is its own
 * group, named by its title: it says which industry the visitor was reading
 * about. Everything else is grouped by kind.
 */
export function pageGroupOf(path: string, crawl: Map<string, PageRow>): { key: string; label: string } {
  if (!path) return { key: "none", label: "Page not recorded" };
  if (path === "/contact") return { key: "contact", label: "Contact page" };
  if (path === "/book") return { key: "book", label: "Booking page" };
  const page = crawl.get(path);
  if (!page) return { key: "unknown", label: "Page not in the crawl" };
  if (page.kind === "segment") return { key: `segment:${path}`, label: bare(page.title) ?? bare(page.h1) ?? path };
  return { key: page.kind, label: GROUP_LABEL[page.kind] ?? page.kindLabel ?? KIND_LABEL[page.kind] };
}

/** A kind of page as a group of enquiries is named. Industry pages are named one by one above. */
const GROUP_LABEL: Partial<Record<PageRow["kind"], string>> = {
  home: "Home page",
  service: "Service pages",
  landing: "Landing pages",
  article: "Insights (articles)",
  insights: "Insights index",
  case: "Case studies",
  legal: "Legal pages",
  standard: "Other pages",
};

/** Enquiries by the kind of page the form was sent from. */
export function pageGroupsFrom(groups: Reading<leads.Group[]>, counts: Reading<leads.EnquiryCounts>, crawl: Reading<PageRow[]>): Reading<GroupList> {
  const known = new Map((crawl.state === "ok" ? crawl.value : []).map((p) => [p.path, p]));
  return groupList(
    groups,
    counts,
    (g) => {
      const by = new Map<string, GroupRow>();
      for (const x of g) {
        const k = pageGroupOf(x.key, known);
        const had = by.get(k.key) ?? { key: k.key, label: k.label, count: 0, previous: x.previous === null ? null : 0 };
        had.count += x.count;
        had.previous = had.previous === null || x.previous === null ? null : had.previous + x.previous;
        by.set(k.key, had);
      }
      return [...by.values()].filter((x) => x.count > 0).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    },
    `The engine records no industry: this is the kind of page each enquiry was sent from. ${crawl.state === "ok" ? "Kinds are the desk's crawl's; an industry page says which industry the visitor was reading about and is named by its title." : "The desk's crawl has not run, so pages are not grouped by kind yet."}`,
  );
}

/** Where an event with this `method`, sent from this page, started. */
export function placeOf(method: string, path: string): { key: string; label: string } {
  if (method === "ai_guide") return { key: "ai-guide", label: "AI guide" };
  if (method === "avp_dock") return { key: "video-dock", label: "Video page dock" };
  if (method === "contact_form") return path === "/contact" || path === "/book" ? { key: "contact-page", label: "Contact page" } : { key: "sheet", label: "Sheet on a marketing page" };
  if (!method || method === "(not set)") return { key: "not-set", label: "No method sent" };
  return { key: method, label: method };
}

/** GA4 events by their `method`: where enquiries and calls start, and how often a sheet opened. */
export function startsFrom(rows: Reading<StartRow[]>, params: Reading<{ readable: string[]; unregistered: { param: string; step: string }[] }>): Reading<StartsData> {
  if (params.state === "ok" && !params.value.readable.includes("method")) {
    const step = params.value.unregistered.find((u) => u.param === "method")?.step;
    return off("ga4", 'GA4 cannot report on the website\'s "method" parameter: it is not available to the Data API.', step);
  }
  return mapped(
    rows,
    (all) => {
      const places = (event: string): StartPlace[] => {
        const by = new Map<string, StartPlace>();
        for (const r of all) {
          if (r.eventName !== event || r.count <= 0) continue;
          const p = placeOf(r.method, r.pagePath);
          const had = by.get(p.key) ?? { key: p.key, label: p.label, methods: [], count: 0 };
          had.count += r.count;
          if (!had.methods.includes(r.method)) had.methods.push(r.method);
          by.set(p.key, had);
        }
        return [...by.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      };
      const enquiries = places("generate_lead");
      const calls = places("book_meeting");
      const sheets = all.filter((r) => r.eventName === "invite_shown" && r.count > 0);
      return {
        enquiries,
        enquiryTotal: enquiries.reduce((n, p) => n + p.count, 0),
        calls,
        callTotal: calls.reduce((n, p) => n + p.count, 0),
        sheetsShown: sheets.reduce((n, r) => n + r.count, 0),
        sheets: new Set(sheets.map((r) => r.method).filter((m) => m && m !== "(not set)")).size,
      };
    },
    "By the method parameter the website sends with each event. contact_form on /contact or /book is the contact page; anywhere else it is the sheet on a marketing page.",
  );
}

/**
 * The newest enquiries, for a person who may see them, with only the fields
 * the table prints. Anybody else gets the counts in words and no row.
 */
export function recentFrom(rows: Reading<leads.Enquiry[]> | null, counts: Reading<leads.EnquiryCounts>, seesLeads: boolean, range: ConversionsRange): Reading<RecentLead[]> {
  if (!seesLeads || rows === null) {
    if (counts.state !== "ok") return counts;
    const n = counts.value.enquiries.value;
    const b = counts.value.booked.value;
    const days = { "7d": "7 days", "30d": "30 days", "90d": "90 days", "1y": "12 months" }[range];
    return off(
      "engine",
      `Enquiries are shown only to people the owner has marked as allowed to see leads. In the last ${days} the engine stored ${n} ${n === 1 ? "enquiry" : "enquiries"}, ${b} with a booked call.`,
      "Ask the owner to mark you as allowed to see leads.",
    );
  }
  return mapped(rows, (list) =>
    list
      .filter((r) => r.id)
      .slice(0, RECENT)
      .map((r) => ({
        id: r.id!,
        name: r.name,
        company: r.company,
        services: r.servicesNamed.length ? r.servicesNamed : r.services,
        page: r.page ? pathOfPage(r.page) : null,
        stage: r.stage,
        call: r.booking ? { start: r.booking.start, cancelled: r.booking.cancelled, with: r.owner?.name ?? null } : null,
        capturedAt: r.capturedAt,
      })),
  );
}

/* ---------- the specimen --------------------------------------------------------
 *
 * What the engine's panels look like connected, before the engine's key
 * exists. Only on a development copy asked for ?specimen=1 (specimenAllowed:
 * the same three locks as the development sign-in). Every row below is made
 * up, obviously so, and dated relative to the moment it is asked for so it
 * always falls inside the period. The rows have the desk's own shape of an
 * engine enquiry (leads.ts `Enquiry`), so they are counted and listed by the
 * same functions a real answer would reach.
 */

/** [days ago, service slugs, page, stage, booked: null | "kept" | "cancelled"] */
type SpecimenSeed = [number, string[], string | null, string, null | "kept" | "cancelled"];

const SPECIMEN_SEEDS: SpecimenSeed[] = [
  [0, ["specimen-a"], "/contact", "received", null],
  [1, ["specimen-a", "specimen-b"], "/contact", "meeting_confirmed", "kept"],
  [2, ["specimen-c"], "/how-to-get-more-clients-for-my-law-firm", "processed", null],
  [3, ["specimen-b"], "/how-to-make-videos-without-a-film-crew", "expert_assigned", "kept"],
  [5, ["specimen-a"], "/contact", "proposal_in_preparation", "cancelled"],
  [6, ["specimen-d"], "/insights/autonomous-agents-change-the-nature-of-web-security", "received", null],
  [8, ["specimen-a"], "/how-to-win-more-construction-projects", "meeting_confirmed", "kept"],
  [11, ["specimen-c", "specimen-d"], "/contact", "proposal_ready", "kept"],
  [13, ["specimen-b"], null, "processed", null],
  [17, ["specimen-a"], "/", "received", null],
  [22, [], "/contact", "received", null],
  [26, ["specimen-c"], "/how-to-get-more-clients-for-my-law-firm", "meeting_confirmed", "kept"],
  [33, ["specimen-a"], "/contact", "proposal_ready", null],
  [41, ["specimen-b"], "/book", "meeting_confirmed", "kept"],
  [70, ["specimen-d"], "/contact", "processed", null],
];

const SPECIMEN_SERVICE_NAMES: Record<string, string> = {
  "specimen-a": "Specimen service A",
  "specimen-b": "Specimen service B",
  "specimen-c": "Specimen service C",
  "specimen-d": "Specimen service D",
};

/** The specimen enquiries, newest first, as of `now`. */
export function specimenEnquiries(now: number): leads.Enquiry[] {
  return SPECIMEN_SEEDS.map(([ago, services, page, stage, booked], i) => {
    const n = String(i + 1).padStart(2, "0");
    const at = new Date(now - ago * 86_400_000 - (i + 1) * 3_600_000).toISOString();
    const start = new Date(now + (i % 2 ? 2 : -1) * 86_400_000 + i * 1_800_000).toISOString();
    return {
      id: `web_specimen_${n}`,
      leadId: `00000000-0000-4000-8000-0000000000${n}`,
      ref: `SPECIMEN-${n}`,
      capturedAt: at,
      current: true,
      name: `Specimen Person ${n}`,
      company: i % 3 === 2 ? null : `Specimen Company ${n}`,
      email: `specimen-${n}@example.invalid`,
      phone: null,
      website: null,
      intent: booked ? "meeting" : "quote",
      services,
      servicesNamed: services.map((s) => SPECIMEN_SERVICE_NAMES[s] ?? s),
      message: "Specimen message, not an enquiry.",
      firstWords: null,
      recommendation: null,
      links: null,
      summary: null,
      page: page ? `https://www.balkaris.ch${page}` : null,
      stage,
      timeline: [{ stage: "received", at }],
      updates: [],
      booking: booked
        ? {
            start,
            end: new Date(Date.parse(start) + 1_800_000).toISOString(),
            startZurich: null,
            meetUrl: null,
            bookedAt: at,
            cancelled: booked === "cancelled",
            cancelledAt: booked === "cancelled" ? at : null,
            cancelledBy: booked === "cancelled" ? "visitor" : null,
          }
        : null,
      owner: booked ? { email: "specimen.host@example.invalid", name: "Specimen Host" } : null,
      leadStatus: booked ? "meeting" : "new",
      leadSource: "website_form",
    };
  });
}

/** An address as the engine's `page` holds it, reduced to the path the groups use. */
const pathOfPage = (page: string | null): string => {
  if (!page) return "";
  try {
    return ga4.normalPath(new URL(page, "https://www.balkaris.ch").pathname);
  } catch {
    return page;
  }
};

/**
 * Counts, groups and the newest rows from a list of enquiries, the way the
 * engine's own totals count them: whole Zurich days ending today, a booked
 * call counted on the day its enquiry came in while it is not cancelled, an
 * enquiry naming two services under both. Used for the specimen and by the
 * check script; a real answer is counted by the engine and leads.ts.
 */
export function countEnquiries(rows: leads.Enquiry[], range: ConversionsRange, end = today()): { counts: leads.EnquiryCounts; services: leads.Group[]; pages: leads.Group[] } {
  const span = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 }[range];
  const start = addDays(end, -(span - 1));
  const before = addDays(start, -span);
  const dayOf = (r: leads.Enquiry) => (r.capturedAt ? dayIn("Europe/Zurich", Date.parse(r.capturedAt)) : "");
  const isBooked = (r: leads.Enquiry) => !!r.booking && !r.booking.cancelled;

  const perDay = new Map<string, { count: number; booked: number }>();
  for (const r of rows) {
    const d = dayOf(r);
    if (!d) continue;
    const had = perDay.get(d) ?? { count: 0, booked: 0 };
    had.count++;
    if (isBooked(r)) had.booked++;
    perDay.set(d, had);
  }
  const at = (d: string) => perDay.get(d) ?? { count: 0, booked: 0 };
  const points = eachDay(start, end).map((date) => ({ date, value: at(date).count, previous: at(addDays(date, -span)).count, booked: at(date).booked, bookedBefore: at(addDays(date, -span)).booked }));
  const sum = (k: "value" | "previous" | "booked" | "bookedBefore") => points.reduce((n, p) => n + p[k], 0);

  const group = (keys: (r: leads.Enquiry) => { key: string; label: string }[]): leads.Group[] => {
    const by = new Map<string, leads.Group>();
    for (const r of rows) {
      const d = dayOf(r);
      const where = d >= start && d <= end ? "now" : d >= before && d < start ? "before" : null;
      if (!where) continue;
      for (const k of keys(r)) {
        const g = by.get(k.key) ?? { key: k.key, label: k.label, count: 0, previous: 0 };
        if (where === "now") g.count++;
        else g.previous = (g.previous ?? 0) + 1;
        by.set(k.key, g);
      }
    }
    return [...by.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };

  return {
    counts: {
      enquiries: { value: sum("value"), previous: sum("previous"), unit: "count", series: points.map((p) => p.value) },
      booked: { value: sum("booked"), previous: sum("bookedBefore"), unit: "count", series: points.map((p) => p.booked) },
      from: start,
      days: points.map(({ date, value, previous, booked }) => ({ date, value, previous, booked })),
    },
    services: group((r) => (r.services.length ? r.services.map((key, i) => ({ key, label: r.servicesNamed[i] ?? key })) : [{ key: "", label: "No service named" }])),
    pages: group((r) => {
      const p = pathOfPage(r.page);
      return [{ key: p, label: p || "Page not recorded" }];
    }),
  };
}

/** The engine's four inputs, made from the specimen rows. */
export function specimenEngine(range: ConversionsRange, now: number, seesLeads: boolean): EngineInputs {
  const rows = specimenEnquiries(now);
  const asOf = new Date(now).toISOString();
  const { counts, services, pages } = countEnquiries(rows, range, dayIn("Europe/Zurich", now));
  return {
    counts: ok(counts, "engine", asOf, SPECIMEN_NOTE),
    services: ok(services, "engine", asOf, SPECIMEN_NOTE),
    pages: ok(pages, "engine", asOf, SPECIMEN_NOTE),
    recent: seesLeads ? ok(rows.slice(0, RECENT), "engine", asOf, SPECIMEN_NOTE) : null,
  };
}
