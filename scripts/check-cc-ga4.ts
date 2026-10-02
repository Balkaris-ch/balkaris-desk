/**
 * Does src/cc/ga4.ts read what it says it reads?
 *
 *   node --env-file=work/dev.env --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-ga4.ts
 *
 * Runs against the REAL property, read-only, for about sixty history tokens
 * (one a report) and about a hundred and fifty realtime ones. Run twice
 * within two minutes, the second run asks Google far less: most of its first
 * reads are still kept. It prints the SHAPE of every answer, the row counts
 * and the quota left. It never prints a figure: this repository is public,
 * and a terminal gets pasted.
 *
 * What it proves, and fails loudly on:
 *
 *   - every named read answers, in the shape its type promises;
 *   - over settled days, the same quantity reached two ways is one number;
 *   - a second call makes no request (the cache);
 *   - a period ends yesterday unless today is asked for, and a period that
 *     holds today is compared with nothing;
 *   - a comparison with a period before measurement began, or with the first
 *     day that was only measured in part, is null, not 0;
 *   - a period before measurement began reads as "off", not "waiting";
 *   - a parameter GA4 cannot report on answers "off" with the owner's step;
 *   - a live figure is labelled "ga4-live" whatever the caller passes;
 *   - a mistaken question comes back as Google's sentence, with no token in it;
 *   - only a read marked `screen` counts as a person looking; both jobs do
 *     nothing when no person is, and work when one is;
 *   - below the quota floor nothing is asked and the kept answer is served;
 *   - a refusal, and a 200 that is not JSON, mark the source failing and make
 *     the next question wait instead of asking again.
 */
import * as ga from "../src/cc/ga4.ts";
import { setState, state } from "../src/cc/store.ts";
import { checks, sources } from "../src/cc/sources.ts";

let failures = 0;
const say = (line = ""): void => console.log(line);
function expect(what: string, pass: boolean, detail = ""): void {
  if (!pass) failures += 1;
  say(`  ${pass ? "ok  " : "FAIL"} ${what}${detail ? `  (${detail})` : ""}`);
}

/** The outline of a value: its keys and types, the length of its lists, no contents. */
function outline(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? `[${v.length} x ${outline(v[0])}]` : "[0]";
  if (typeof v === "object") {
    return `{ ${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${k === "span" ? "Span" : outline(x)}`)
      .join(", ")} }`;
  }
  return typeof v;
}

const asked = (): number => {
  const r = ga.requests();
  return r.core + r.realtime + r.meta;
};

const when = (at: number | null): string => (at === null ? "never" : new Date(at).toISOString());

/**
 * Calls a read twice: the first may ask Google, the second must not. The
 * first accepts nothing older than two minutes, so that the reads of one run
 * are of the same moment and can be compared with each other further down.
 */
async function twice<T>(name: string, read: (o: ga.Ask) => Promise<ga.Read<T>>): Promise<ga.Read<T>> {
  const before = asked();
  const first = await read({ ttl: 120_000, wait: true });
  const cost = asked() - before;
  say(`\n${name}`);
  if (first.data === null) {
    expect("answered", false, first.error ?? "no data and no reason");
    return first;
  }
  say(`  shape   ${outline(first.data)}`);
  say(`  read at ${when(first.at)}  requests ${cost}${first.refreshing ? "  (earlier answer, refreshing behind)" : ""}${first.stale ? `  STALE: ${first.error}` : ""}`);
  expect("answered", true);
  const mid = asked();
  const second = await read({});
  expect("second call made no request", asked() === mid && second.at === first.at);
  return first;
}

say(`GA4 property ${process.env.GA4_PROPERTY_ID ?? "(default)"}  hosts ${ga.hosts().join(", ")}  zone ${ga.zone()}  today ${ga.propertyToday()}`);

/* ---- since, and the ranges ---- */

/** A day `by` days away, as the module counts them: at noon, so a clock change cannot move it. */
const day = (from: string, by: number): string => new Date(Date.parse(`${from}T12:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
const today = ga.propertyToday();
const yesterday = day(today, -1);

const since = await ga.measuredSince();
const again = asked();
await ga.measuredSince();
expect("found once, then remembered", asked() === again);
const opening = await ga.totals("24h");
const fullFrom = opening.data?.span.fullFrom ?? null;
say(`\nmeasured since ${since ?? "nothing yet"}, whole days from ${fullFrom ?? "?"}`);
expect("the website's host has a first day", !!since && /^\d{4}-\d\d-\d\d$/.test(since));
expect("the first whole day is that day, or the day after it when measurement began part-way through", !!since && !!fullFrom && (fullFrom === since || fullFrom === day(since, 1)));

const RANGES: ga.GaRange[] = ["24h", "7d", "30d", "90d", "1y"];
say("\nranges");
for (const range of RANGES) {
  const d = ga.rangeDates(range);
  const comparable = !!fullFrom && fullFrom <= d.previous.start;
  say(`  ${range.padEnd(3)} ${d.current.start} to ${d.current.end} (${d.current.days} days), before it ${d.previous.start} to ${d.previous.end}: ${comparable ? "measured whole" : "not measured whole, so no comparison"}`);
}
expect('"1h" reads as "24h", nonsense as "30d"', ga.gaRange("1h") === "24h" && ga.gaRange("x") === "30d" && ga.gaRange("7d") === "7d");
expect("by default every period ends yesterday, whole, and the one before it is as long", RANGES.every((r) => {
  const d = ga.rangeDates(r);
  return d.complete && d.current.end === yesterday && d.previous.end === day(d.current.start, -1) && d.current.days === d.previous.days;
}));
expect('"24h" is one whole day', ga.rangeDates("24h").current.start === yesterday && ga.rangeDates("24h").current.days === 1);
/* ---- every named read, twice ---- */

const R: ga.GaRange = "30d";

/* Each read as a function of how to ask, so the same read can be asked again
   further down when two of them have to be compared at the same moment. */
const read = {
  totals: (o: ga.Ask) => ga.totals(R, o),
  byDay: (o: ga.Ask) => ga.byDay(R, o),
  usersByDay: (o: ga.Ask) => ga.usersByDay(R, o),
  channels: (o: ga.Ask) => ga.channels(R, o),
  sources: (o: ga.Ask) => ga.sourcesMediums(R, o),
  pages: (o: ga.Ask) => ga.pages(R, o),
  landings: (o: ga.Ask) => ga.landingPages(R, undefined, o),
  countries: (o: ga.Ask) => ga.countries(R, o),
  devices: (o: ga.Ask) => ga.devices(R, o),
  events: (o: ga.Ask) => ga.events(R, o),
  leadPages: (o: ga.Ask) => ga.eventByPage("generate_lead", R, o),
  viewPages: (o: ga.Ask) => ga.eventByPage("page_view", R, o),
  leadChannels: (o: ga.Ask) => ga.eventByChannel("generate_lead", R, o),
  viewChannels: (o: ga.Ask) => ga.eventByChannel("page_view", R, o),
  leadMethods: (o: ga.Ask) => ga.eventByParam("generate_lead", "method", R, o),
  insightDays: (o: ga.Ask) => ga.insightsByDay(R, o),
  articles: (o: ga.Ask) => ga.articleStats(R, o),
};

const totals = await twice("totals", read.totals);
const days = await twice("byDay", read.byDay);
const users = await twice("usersByDay", read.usersByDay);
const channels = await twice("channels", read.channels);
await twice("sourcesMediums", read.sources);
const pages = await twice("pages", read.pages);
await twice("landingPages", read.landings);
await twice("landingPages, organic search only", (o) => ga.landingPages(R, "organic-search", o));
await twice("landingPages, LinkedIn only", (o) => ga.landingPages(R, "linkedin", o));
const countries = await twice("countries", read.countries);
await twice("devices", read.devices);
const events = await twice("events", read.events);
await twice("eventByPage generate_lead", read.leadPages);
await twice("eventByPage page_view", read.viewPages);
await twice("eventByChannel generate_lead", read.leadChannels);
await twice("eventByChannel page_view", read.viewChannels);
await twice("eventByParam generate_lead by method", read.leadMethods);
await twice("eventByParam invite_shown by method", (o) => ga.eventByParam("invite_shown", "method", R, o));
const insightDays = await twice("insightsByDay", read.insightDays);
const articles = await twice("articleStats", read.articles);
say("\nwhat the shapes must hold");
if (totals.data && days.data && users.data) {
  const span = totals.data.span;
  const first = span.since > span.start ? span.since : span.start;
  const length = Math.round((Date.parse(span.end) - Date.parse(first)) / 86_400_000) + 1;
  expect("a day series has one point for every measured day of the period, and begins where measurement does", users.data.length === length && users.data[0]?.date === first && users.data.at(-1)?.date === span.end, `${users.data.length} points`);
  expect("no day is NaN or negative", [...days.data.users, ...days.data.sessions, ...days.data.views].every((p) => Number.isFinite(p.value) && p.value >= 0));
}
if (channels.data) {
  const sum = channels.data.rows.reduce((n, r) => n + r.sessions, 0);
  expect("channel sessions add up to the stated whole", sum === channels.data.sessions);
  expect("LinkedIn, when present, is one row and no other row is named after it", channels.data.rows.filter((r) => /linkedin/i.test(r.label)).length <= 1);
}
if (pages.data) {
  expect("every address is normalised", pages.data.rows.every((r) => r.path === ga.normalPath(r.path) && (r.path === "/" || !r.path.endsWith("/")) && !r.path.includes("?")));
  expect("no address appears twice", new Set(pages.data.rows.map((r) => r.path)).size === pages.data.rows.length);
}
if (countries.data) expect("country codes are two capital letters or null", countries.data.rows.every((r) => r.code === null || /^[A-Z]{2}$/.test(r.code)));
if (events.data) {
  const ours = events.data.rows.filter((r) => r.ours).map((r) => r.name);
  say(`  the website's own events seen in ${R}: ${ours.length ? ours.join(", ") : "none"}`);
  say(`  not seen in ${R} (never fired with consent): ${Object.keys(ga.SITE_EVENTS).filter((n) => !ours.includes(n)).join(", ") || "none"}`);
  say(`  marked as key events in GA4 Admin: ${events.data.rows.filter((r) => r.key).map((r) => r.name).join(", ") || "none"}`);
  expect("a day line exists for each of the website's five events", Object.keys(events.data.byDay).length === Object.keys(ga.SITE_EVENTS).length);
}
if (articles.data) expect("every article row is /insights/<slug>", articles.data.rows.every((r) => r.path === `/insights/${r.slug}` && !r.slug.includes("/")));
/* The same quantity reached two ways must be the same number. Only counts
   that add up are compared: views, events, sessions by a dimension that has
   one value per session.

   They are compared over a period that ENDS THREE DAYS AGO, because the last
   two days do not hold still. Seen while writing this, 2 October 2026: two
   reads forty seconds apart, one session apart; the events report one
   page_view behind every other read for several minutes, because Google
   answers a question it was just asked from its own memory of the answer;
   and landing pages adding up to one session more than the period had,
   because GA4 held one of today's sessions under two landing pages. None of
   that happens on settled days, so there the two numbers must be equal, and
   a difference is a fault in the code. */
const settled = new Date(Date.parse(`${ga.propertyToday()}T12:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10);
say(`\nthe reads agree with each other, over the period ending ${settled}`);
type Reader<T> = (o: ga.Ask) => Promise<ga.Read<T>>;
async function agree<A, B>(what: string, a: Reader<A>, b: Reader<B>, left: (a: A) => number, right: (b: B) => number): Promise<void> {
  if (!since || since > settled) return say(`  skip ${what}  (nothing was measured by ${settled})`);
  const ra = await a({ end: settled });
  const rb = await b({ end: settled });
  if (ra.data === null || rb.data === null) return expect(what, false, ra.error ?? rb.error ?? "one of the two did not answer");
  expect(what, left(ra.data) === right(rb.data), left(ra.data) === right(rb.data) ? "equal" : "DIFFERENT");
}
const sumOf = <T,>(rows: T[], pick: (row: T) => number): number => rows.reduce((n, row) => n + pick(row), 0);
const countOf = (e: ga.Events, name: string): number => e.rows.find((r) => r.name === name)?.count ?? 0;
const isArticlePath = (path: string): boolean => /^\/insights\/[^/]+$/.test(path) && path !== "/insights/topic";

await agree("channels add up to the period's sessions", read.channels, read.totals, (c) => c.sessions, (t) => t.current.sessions);
await agree("sources and mediums add up to the period's sessions", read.sources, read.totals, (s) => sumOf(s.rows, (r) => r.sessions), (t) => t.current.sessions);
await agree("devices add up to the period's sessions", read.devices, read.totals, (d) => sumOf(d.rows, (r) => r.sessions), (t) => t.current.sessions);
await agree("countries add up to the period's sessions", read.countries, read.totals, (c) => sumOf(c.rows, (r) => r.sessions), (t) => t.current.sessions);
await agree("landing pages add up to the period's sessions", read.landings, read.totals, (l) => sumOf(l.rows, (r) => r.sessions), (t) => t.current.sessions);
await agree("pages add up to the period's views", read.pages, read.totals, (p) => sumOf(p.rows, (r) => r.views), (t) => t.current.screenPageViews);
await agree("days add up to the period's views", read.byDay, read.totals, (d) => sumOf(d.views, (p) => p.value), (t) => t.current.screenPageViews);
await agree("the page_view event is the period's views", read.events, read.totals, (e) => countOf(e, "page_view"), (t) => t.current.screenPageViews);
await agree("page_view by address adds up to page_view", read.viewPages, read.events, (v) => sumOf(v.rows, (r) => r.count), (e) => countOf(e, "page_view"));
await agree("page_view by channel adds up to page_view", read.viewChannels, read.events, (v) => sumOf(v.rows, (r) => r.count), (e) => countOf(e, "page_view"));
await agree("generate_lead by address adds up to generate_lead", read.leadPages, read.events, (v) => sumOf(v.rows, (r) => r.count), (e) => countOf(e, "generate_lead"));
await agree("generate_lead by channel adds up to generate_lead", read.leadChannels, read.events, (v) => sumOf(v.rows, (r) => r.count), (e) => countOf(e, "generate_lead"));
await agree("generate_lead by method adds up to generate_lead", read.leadMethods, read.events, (v) => sumOf(v.rows, (r) => r.count), (e) => countOf(e, "generate_lead"));
await agree("generate_lead day by day adds up to generate_lead", read.events, read.events, (e) => sumOf(e.byDay.generate_lead, (p) => p.value), (e) => countOf(e, "generate_lead"));
await agree("article entrances are the landing pages that are articles", read.articles, read.landings, (a) => a.entrances.all, (l) => sumOf(l.rows.filter((r) => isArticlePath(r.path)), (r) => r.sessions));
await agree("article views are the pages that are articles", read.articles, read.pages, (a) => sumOf(a.rows, (r) => r.views), (p) => sumOf(p.rows.filter((r) => isArticlePath(r.path)), (r) => r.views));
await agree("each article's channels add up to its entrances", read.articles, read.articles, (a) => sumOf(a.rows, (r) => sumOf(r.byChannel, (c) => c.value)), (a) => sumOf(a.rows, (r) => r.entrances));
if (insightDays.data) {
  const s = insightDays.data.sessions;
  expect("article days: organic + direct + other = all, every day", s.all.every((p, i) => p.value === (s.organic[i]?.value ?? 0) + (s.direct[i]?.value ?? 0) + (s.other[i]?.value ?? 0)));
  const p = insightDays.data.period;
  expect("article period: organic + direct + other = all", p.current.sessions.all === p.current.sessions.organic + p.current.sessions.direct + p.current.sessions.other && p.current.sessions.other >= 0);
  /* A session that crosses midnight is in two days, never in two periods. */
  const span = insightDays.data.span;
  const inPeriod = s.all.filter((d) => d.date >= span.start);
  expect("article period: no more sessions than its days add up to, no fewer people than either channel", p.current.sessions.all <= sumOf(inPeriod, (d) => d.value) && p.current.users.all >= Math.max(p.current.users.organic, p.current.users.direct));
  expect("article period: previous is null exactly when the span says so", (p.previous === null) === (span.previous === null));
}

expect("normalPath", ga.normalPath("/a/b/?x=1") === "/a/b" && ga.normalPath("/") === "/" && ga.normalPath("") === "(not set)" && ga.normalPath("(not set)") === "(not set)" && ga.normalPath("/x#y") === "/x");

/* ---- null, never zero, before measurement began ---- */

say("\nbefore measurement began");
const year = await ga.totals("1y");
const yearDays = await ga.usersByDay("1y");
const yearChannels = await ga.channels("1y");
const yearPages = await ga.pages("1y");
if (year.data && since && fullFrom) {
  const d = ga.rangeDates("1y");
  const unmeasured = fullFrom > d.previous.start;
  say(`  the year before this one starts ${d.previous.start}; measurement starts ${since}, whole from ${fullFrom}`);
  if (unmeasured) {
    expect("totals: previous is null", year.data.previous === null && year.data.span.previous === null);
    expect("totals: the span says the period itself is only partly measured", year.data.span.partial === fullFrom > d.current.start);
    expect("day series: every previous is null, none is 0", !!yearDays.data && yearDays.data.every((p) => p.previous === null));
    expect("channels: every previous is null", !!yearChannels.data && yearChannels.data.rows.every((r) => r.previous === null));
    expect("pages: every previous is null", !!yearPages.data && yearPages.data.rows.every((r) => r.previous === null));
  } else {
    say("  (a full year before is measured by now: this proof has outlived itself)");
  }
} else {
  expect("the one-year reads answered", false, year.error);
}
const short = RANGES.find((r) => fullFrom && fullFrom <= ga.rangeDates(r).previous.start);
if (short) {
  const t = await ga.totals(short);
  expect(`and where the period before WAS measured (${short}), previous is a set of counts`, !!t.data && t.data.previous !== null && typeof t.data.previous.sessions === "number");
  const u = await ga.usersByDay(short);
  expect(`${short} day series carries a number for each earlier day`, !!u.data && u.data.every((p) => typeof p.previous === "number"));
  const i = await ga.insightsByDay(short);
  expect(`${short} article period carries the period before`, !!i.data && i.data.period.previous !== null && typeof i.data.period.previous.sessions.all === "number");
}
if (since) {
  const nothing = await ga.totals("7d", { end: day(since, -1) });
  expect("a period that ended before measurement began answers null with the reason, never zeros", nothing.data === null && /measured nothing/.test(nothing.error ?? ""), nothing.error);
  const said = ga.asReading(nothing);
  expect('and reads as "off" with no step, since nothing would ever connect it', said.state === "off" && !("step" in said), said.state);
}

/* The first day of data began at some hour of it. Compared with a whole day
   it would look like growth, so it is never compared, and a period that
   begins on it says it is only partly measured. */
say("\nthe first day, measured in part");
if (since && fullFrom && fullFrom > since && day(fullFrom, 1) < yesterday) {
  say(`  measurement began part-way through ${since}, so whole days start ${fullFrom}`);
  const first = await ga.totals("24h", { end: fullFrom });
  expect("the first whole day is not compared with the part-measured day before it", !!first.data && first.data.previous === null && first.data.span.previous === null);
  const firstLine = await ga.usersByDay("24h", { end: fullFrom });
  expect("nor is its point in a day series", !!firstLine.data && firstLine.data.length === 1 && firstLine.data[0]!.previous === null);
  const second = await ga.totals("24h", { end: day(fullFrom, 1) });
  expect("the day after it is compared with it: both are whole", !!second.data && second.data.previous !== null && second.data.span.previous?.start === fullFrom);
  const week = await ga.totals("7d", { end: day(since, 6) });
  expect("a week that begins on the part-measured day says it is partial", !!week.data && week.data.span.partial && week.data.previous === null);
} else if (since && fullFrom === since) {
  say("  measurement began at midnight: the first day is whole, nothing to prove");
} else {
  say("  skip: not enough whole days measured yet to compare two of them");
}

/* Today is still being counted, hours behind. A period that holds it is
   given, when asked for, and compared with nothing. */
say("\ntoday so far");
const withToday = await ga.totals("7d", { end: "today" });
expect('with end "today" the period ends today, says it is not complete, and compares with nothing', !!withToday.data && withToday.data.span.end === today && !withToday.data.span.complete && withToday.data.previous === null && withToday.data.span.previous === null);
const todayLine = await ga.usersByDay("7d", { end: "today" });
expect(
  "in its day series today alone loses its previous; the whole days before it keep theirs where their twin was measured whole",
  !!todayLine.data && !!fullFrom &&
    todayLine.data.every((p, i, all) => (i === all.length - 1 ? p.date === today && p.previous === null : (day(p.date, -7) >= fullFrom!) === (typeof p.previous === "number"))),
);
expect("today's own date means the same as \"today\"", !ga.rangeDates("7d", today).complete && ga.rangeDates("7d", today).current.end === today);
expect("an end after today, or not a date, is ignored: the period ends yesterday", ga.rangeDates("7d", "2999-01-01").current.end === yesterday && ga.rangeDates("7d", "not a date").current.end === yesterday);

/* ---- parameters GA4 cannot see ---- */

say("\nevent parameters");
const params = await ga.eventParams();
if (params.data) {
  say(`  readable today: ${params.data.readable.join(", ") || "none"}`);
  say(`  not registered in GA4 (the owner's step): ${params.data.unregistered.map((u) => u.param).join(", ") || "none"}`);
  for (const u of params.data.unregistered) {
    const r = await ga.eventByParam("generate_lead", u.param, R);
    expect(`eventByParam by "${u.param}" answers off with a step, not an empty list`, r.data === null && r.off === true && !!r.step);
    const reading = ga.asReading(r);
    expect(`  and reads as a Reading that is "off"`, reading.state === "off" && !!reading.step);
  }
} else {
  expect("the property's dimensions could be listed", false, params.error);
}

/* ---- the generic door ---- */

say("\nthe generic door");
const own = await twice("report: views by page title, top 5", (o) =>
  ga.report({ dimensions: ["pageTitle"], metrics: ["screenPageViews"], dateRanges: [{ startDate: ga.rangeDates("7d").current.start, endDate: ga.propertyToday() }], orderBys: [{ by: "screenPageViews", desc: true }], limit: 5 }, o),
);
if (own.data) expect("rows are plain objects keyed by the names asked for", own.data.rows.every((r) => typeof r.pageTitle === "string" && typeof r.screenPageViews === "number") && own.data.rows.length <= 5);
const two = await ga.report({
  metrics: ["sessions"],
  dateRanges: [
    { startDate: ga.rangeDates("24h").current.start, endDate: ga.rangeDates("24h").current.end },
    { startDate: ga.rangeDates("24h").previous.start, endDate: ga.rangeDates("24h").previous.end },
  ],
});
expect("two date ranges come back as two lists, without Google's dateRange column", !!two.data && two.data.ranges.length === 2 && two.data.ranges.every((rows) => rows.every((r) => !("dateRange" in r))));
const everyHost = await ga.report({ dimensions: ["hostName"], metrics: ["screenPageViews"], dateRanges: [{ startDate: "2026-06-01", endDate: ga.propertyToday() }], allHosts: true });
const website = await ga.report({ dimensions: ["hostName"], metrics: ["screenPageViews"], dateRanges: [{ startDate: "2026-06-01", endDate: ga.propertyToday() }] });
if (everyHost.data && website.data) {
  say(`  hosts in the property: ${everyHost.data.rows.length}; hosts a read is narrowed to: ${website.data.rows.map((r) => r.hostName).join(", ")}`);
  expect("a read sees only the website's host", website.data.rows.every((r) => ga.hosts().includes(String(r.hostName))));
}
const errorsBefore = sources().find((s) => s.id === "ga4")?.state;
const wrong = await ga.report({ metrics: ["notAMetricOfGa4"], dateRanges: [{ startDate: ga.propertyToday(), endDate: ga.propertyToday() }] });
say(`  a mistaken question answers: ${wrong.error ?? "(no error)"}`);
expect("a mistaken question is Google's own sentence, with no token in it", wrong.data === null && /^GA4 answered 400: /.test(wrong.error ?? "") && !/ya29\.|Bearer/i.test(wrong.error ?? "") && (wrong.error ?? "").length <= 240);
expect("and does not mark the source as failing", sources().find((s) => s.id === "ga4")?.state === errorsBefore);

/* ---- the jobs, idle and awake ---- */

say("\nthe jobs");
const job = (name: string) => {
  const j = ga.jobs.find((x) => x.name === name);
  if (!j) throw new Error(`no job named ${name}`);
  return () => j.run({ progress: () => undefined });
};
expect("two jobs are exported, ga4-live and ga4-warm", ga.jobs.length === 2 && ga.jobs.every((j) => j.ready?.() === true));
say(`  ga4-live every ${ga.jobs.find((j) => j.name === "ga4-live")?.every} s, ga4-warm every ${ga.jobs.find((j) => j.name === "ga4-warm")?.every} s`);

ga.touch();
let before = asked();
say(`  awake, warm:  ${await job("ga4-warm")()}`);
say(`                (${asked() - before} requests: the reads above were minutes old at most)`);

/* Only a person's screen keeps the desk awake. Every read above was made
   without `screen`, as a job, a rule or the AI operator would make it. */
ga.touch(Date.now() - 16 * 60_000);
await ga.totals(R);
await ga.report({ metrics: ["sessions"], dateRanges: [{ startDate: yesterday, endDate: yesterday }] });
await ga.eventParams();
expect("reads without `screen` do not count as a person looking", ga.idle());
await ga.totals(R, { screen: true });
expect("a read with `screen: true` does", !ga.idle());

ga.touch(Date.now() - 16 * 60_000);
expect("sixteen minutes after the last screen, the desk is idle", ga.idle());
before = asked();
const idleLive = await job("ga4-live")();
expect("idle: ga4-live asks nothing", asked() === before && /^skipped/.test(String(idleLive)), String(idleLive));
const idleWarm = await job("ga4-warm")();
expect("idle: ga4-warm asks nothing (it warmed a moment ago)", asked() === before && /^skipped/.test(String(idleWarm)), String(idleWarm));

ga.touch();
before = ga.requests().realtime;
const awake = await job("ga4-live")();
const cycle = ga.requests().realtime - before;
say(`  awake, live:  ${awake}`);
expect("awake: ga4-live makes three realtime reports, or none when a cycle is under a minute old", cycle === 3 || cycle === 0, `${cycle} requests`);

const live = await ga.live();
say(`\nlive\n  shape   ${live.data ? outline(live.data) : "null"}\n  age     ${live.age} s`);
expect("live answered with its age", live.data !== null && live.age !== null && live.age >= 0);
if (live.data) {
  expect("thirty minutes, oldest first", live.data.minutes.length === 30 && live.data.minutes[0]?.minutesAgo === 29 && live.data.minutes[29]?.minutesAgo === 0);
  expect("countries and devices each add up to the total", live.data.countries.reduce((n, c) => n + c.users, 0) === live.data.total && live.data.devices.reduce((n, c) => n + c.users, 0) === live.data.total);
  const perDay = Math.round((86_400 / ga.LIVE_EVERY) * live.data.tokens);
  say(`  one cycle cost ${live.data.tokens} realtime tokens; watched all day at ${ga.LIVE_EVERY} s that is ${perDay.toLocaleString("en-GB")} of 200,000, and ${Math.round((3600 / ga.LIVE_EVERY) * live.data.tokens).toLocaleString("en-GB")} an hour of 14,000`);
  expect("a day of watching fits the realtime bucket with half to spare", perDay < 100_000 || live.data.tokens === 0);
  /* The total is the sum of the country-and-device cells. Ask Google for the
     undivided number as well: if a visitor were in two cells they would differ. */
  if (cycle === 3) {
    const whole = await ga.realtime({ metrics: ["activeUsers"] }, { ttl: 1 });
    const n = whole.data?.rows[0]?.activeUsers;
    const undivided = typeof n === "number" ? n : 0;
    expect("the summed total equals Google's undivided count, asked seconds later", Math.abs(undivided - live.data.total) <= 1, undivided === live.data.total ? "equal" : "off by one: somebody arrived or left in between");
    expect("the realtime door labels what it reads ga4-live", whole.source === "ga4-live");
    say(`  an undivided realtime count cost ${whole.data?.tokens ?? "?"} tokens`);
  }
}
before = asked();
await ga.live();
expect("a second look makes no request", asked() === before);
const liveSaid = ga.asReading(live, (d) => d.total);
expect("as a Reading, with no source passed, it is ga4-live and carries the live caveat", liveSaid.state === "ok" && liveSaid.source === "ga4-live" && (liveSaid.note ?? "").startsWith(ga.LIVE_NOTE));
expect("a live read passed as \"ga4\" is still labelled ga4-live", ga.asReading(live, (d) => d.total, "ga4").source === "ga4-live");
if (totals.data) {
  const historySaid = ga.asReading(totals, (d) => d.current.sessions);
  expect("a history read is ga4 and carries the consent caveat", historySaid.state === "ok" && historySaid.source === "ga4" && (historySaid.note ?? "").startsWith(ga.GA4_NOTE));
}

/* ---- the meter ---- */

say("\nquota");
const q = ga.quota();
for (const [name, b] of Object.entries(q)) {
  say(`  ${name.padEnd(8)} hour ${b.hourLeft?.toLocaleString("en-GB") ?? "?"} of ${b.hourLimit.toLocaleString("en-GB")}   day ${b.dayLeft?.toLocaleString("en-GB") ?? "?"} of ${b.dayLimit.toLocaleString("en-GB")}   last request cost ${b.lastCost ?? "?"}   pace ${b.pace}   read ${when(b.at)}`);
}
expect("both buckets were read from Google", q.core.hourLeft !== null && q.core.dayLeft !== null && q.realtime.hourLeft !== null);
say(`  requests this run: ${JSON.stringify(ga.requests())}`);

/* Below the floor. A second copy of the module is loaded with a meter that
   says the hour is nearly spent; the real one is put back at once. */
say("\nbelow the floor");
const meterKey = "ga4:meter:core";
const real = state(meterKey);
let low: typeof ga | null = null;
try {
  setState(meterKey, JSON.stringify({ ...JSON.parse(real ?? "{}"), hour: 200, at: Date.now() }));
  low = (await import("../src/cc/ga4.ts?low" as string)) as typeof ga;
} finally {
  if (real !== null) setState(meterKey, real);
}
if (low) {
  expect("the meter reads hold", low.quota().core.pace === "hold", low.quota().core.reason);
  const held = await low.totals(R, { ttl: 1, wait: true });
  expect("nothing is asked", low.requests().core === 0);
  expect("the kept answer is served, marked stale, with the reason", held.data !== null && held.stale === true && /quota/i.test(held.error ?? ""));
  const never = await low.report({ metrics: ["sessions"], dateRanges: [{ startDate: "2026-09-30", endDate: "2026-09-30" }], dimensions: ["browser"] });
  expect("with nothing kept it answers null and the reason, not a zero", never.data === null && /quota/i.test(never.error ?? "") && low.requests().core === 0);
  if (real !== null) setState(meterKey, real);
}

/* Refused. A third copy of the module asks about a property the desk's
   account was never given, so Google answers 403. That is a real failure of
   the source, unlike the mistaken question above: the copy must say failing,
   wait before trying again, and still not throw. The meter it wrote is put
   back, so the desk that shares this database never sees it. */
say("\nwhen Google refuses");
const realProperty = process.env.GA4_PROPERTY_ID;
const realMeter = state(meterKey);
try {
  process.env.GA4_PROPERTY_ID = "1";
  const refused = (await import("../src/cc/ga4.ts?refused" as string)) as typeof ga;
  const spec = { metrics: ["sessions"], dateRanges: [{ startDate: "2026-09-30", endDate: "2026-09-30" }] };
  const first = await refused.report(spec, { wait: true });
  say(`  Google's answer: ${first.error ?? "(no error)"}`);
  expect("the answer is null with Google's own sentence, and no token in it", first.data === null && /^GA4 answered 40[13]: /.test(first.error ?? "") && !/ya29\.|Bearer/i.test(first.error ?? ""));
  expect("one request was made", refused.requests().core === 1);
  const second = await refused.report(spec, { wait: true });
  expect("asked again at once, it waits instead of asking Google a second time", refused.requests().core === 1 && second.data === null && second.error === first.error);
  /* The copies registered their own status after the real module's two. */
  const status = sources().filter((x) => x.id === "ga4").at(-1);
  expect("that copy reports the source as failing, with the reason", status?.state === "failing" && /^GA4 answered/.test(status.error ?? ""));
} finally {
  if (realProperty === undefined) delete process.env.GA4_PROPERTY_ID;
  else process.env.GA4_PROPERTY_ID = realProperty;
  if (realMeter !== null) setState(meterKey, realMeter);
}

/* A 200 that is not JSON: what a proxy's page in front of Google would be.
   A fourth copy of the module is given a fetch that answers every Data API
   question that way (the token request still goes to Google). Nothing is
   sent to the Data API at all; the meter it wrote is put back. The question
   is one nothing else here asks, so no kept answer can stand in for it. */
say("\nwhen the answer is not JSON");
const meterBeforeGarble = state(meterKey);
const realFetch = globalThis.fetch;
try {
  const garbled = (await import("../src/cc/ga4.ts?garbled" as string)) as typeof ga;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://analyticsdata.googleapis.com/")) return new Response("<html><body>a proxy's page</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    return realFetch(input, init);
  }) as typeof fetch;
  const spec = { dimensions: ["browser", "operatingSystem", "screenResolution"], metrics: ["sessions"], dateRanges: [{ startDate: "2026-09-28", endDate: "2026-09-28" }] };
  const first = await garbled.report(spec, { wait: true });
  say(`  it answers: ${first.error ?? "(no error)"}`);
  expect("a 200 that is not JSON answers null with the reason, and does not throw", first.data === null && /not JSON/.test(first.error ?? ""));
  const status = sources().filter((x) => x.id === "ga4").at(-1);
  expect("that copy reports the source as failing", status?.state === "failing" && /not JSON/.test(status.error ?? ""));
  const second = await garbled.report(spec, { wait: true });
  expect("asked again at once, it waits instead of asking a second time", garbled.requests().core === 1 && second.data === null);
} finally {
  globalThis.fetch = realFetch;
  if (meterBeforeGarble !== null) setState(meterKey, meterBeforeGarble);
}

/* ---- an earlier answer now, a newer one behind it ---- */

say("\nserved at once, refreshed behind");
const earlier = await ga.totals(R);
const sentBefore = ga.requests().core;
const started = Date.now();
const atOnce = await ga.totals(R, { ttl: 1 });
expect("an answer older than its ttl is handed back at once, marked as refreshing", atOnce.refreshing === true && atOnce.at === earlier.at && Date.now() - started < 150, `${Date.now() - started} ms`);
let newer = atOnce;
for (let i = 0; i < 40 && newer.at === earlier.at; i++) {
  await new Promise((done) => setTimeout(done, 250));
  newer = await ga.totals(R);
}
expect("and the newer one arrives behind it with exactly one request", newer.at !== null && earlier.at !== null && newer.at > earlier.at && ga.requests().core === sentBefore + 1);
const waited = await ga.totals(R, { ttl: 1, wait: true });
expect("with wait, the caller gets the newer one itself", waited.refreshing !== true && waited.at !== null && newer.at !== null && waited.at > newer.at);

/* ---- how it reports on itself ---- */

say("\nsources and the light");
for (const id of ["ga4", "ga4-live"] as const) {
  const s = sources().find((x) => x.id === id);
  if (s) say(`  ${s.id.padEnd(8)} ${s.state}  last ok ${s.lastOk ?? "never"}${s.error ? `  ${s.error}` : ""}${s.step ? `  step: ${s.step}` : ""}`);
}
expect("both sources are connected", (["ga4", "ga4-live"] as const).every((id) => sources().find((x) => x.id === id)?.state === "connected"));
const light = checks().find((c) => c.name === "Analytics answered");
expect('the check "Analytics answered" is green', !!light?.ok, light?.detail);

say(`\n${failures ? `${failures} FAILED` : "all passed"}`);
process.exit(failures ? 1 : 0);