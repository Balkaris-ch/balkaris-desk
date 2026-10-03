/**
 * The Conversions screen, proved without a single real figure.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-conversions.ts
 *
 * Nothing leaves this machine: a throwaway database, no GA4 key, no engine
 * key, and a guard on `fetch` that refuses every request. Every row in here
 * is made up to be recognisably artificial ("Zzyzx Specimen", /specimen-a);
 * none of it describes the real website or a real person.
 *
 * What is proved:
 *   1. synthetic engine rows, shaped as the desk reads the engine's route,
 *      are counted the engine's way: whole Zurich days, the window before,
 *      a cancelled call not counted as booked, an enquiry naming two
 *      services under both, a row outside both windows nowhere;
 *   2. pages group by the kind of page the crawl knows, an industry page by
 *      its own title, /contact and /book by name, no page as "not recorded";
 *   3. recent enquiries reach only a person who may see leads, with only the
 *      fields the table prints (never an address, a telephone or a message);
 *      anybody else gets counts in words and not one name;
 *   4. the tiles: the engine's figures are the engine's readings, GA4's are
 *      GA4's, nothing is compared with a period GA4 did not measure, the
 *      rate carries its two counts, no sessions is no rate, and the pipeline
 *      value is absent with its reason and step, never a figure;
 *   5. the funnel names each step by its real event, channels fold a long
 *      tail into "Other", a page's rate needs 100 sessions, the trend leaves
 *      days before measurement empty and not zero, and enquiries start where
 *      the method parameter says, or the panel says the parameter is missing;
 *   6. through the route itself: ?specimen=1 is honoured only behind the
 *      three locks, a person who may not see leads gets no name even from
 *      the specimen, GA4 without a key is "off" with its step, and every
 *      panel is a reading on its own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-conversions-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["ENGINE_READ_KEY", "ENGINE_URL", "CLARITY_PROJECT_ID", "GA4_PROPERTY_ID"]) delete process.env[k];
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "absent.json");

/* ---- nothing leaves this machine ------------------------------------------ */
let requests = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  requests++;
  throw new Error(`the check tried to leave the machine: ${String(input instanceof Request ? input.url : input)}`);
}) as typeof fetch;

let failures = 0;
let passed = 0;
function check(name: string, ok: unknown, detail?: unknown): void {
  if (ok) {
    passed++;
    return;
  }
  failures++;
  console.error(`FAIL ${name}${detail === undefined ? "" : `\n     ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 600)}`}`);
}

const { Hono } = await import("hono");
const conv = await import("../src/cc/routes/conversions.ts");
const store = await import("../src/cc/store.ts");
const { dayIn, addDays } = await import("../src/cc/search/shared.ts");
type Enquiry = import("../src/cc/leads.ts").Enquiry;
type PageRow = import("../src/cc/site/index.ts").PageRow;
type Events = import("../src/cc/ga4.ts").Events;
type Totals = import("../src/cc/ga4.ts").Totals;
type Days = import("../src/cc/ga4.ts").Days;
type Span = import("../src/cc/ga4.ts").Span;
type Reading<T> = import("../web/src/contract/common.ts").Reading<T>;
type Person = import("../src/people.ts").Person;

const DAY = 86_400_000;
const now = Date.now();
const today = dayIn("Europe/Zurich", now);
/* Noon in Zurich, n days ago: never near a midnight, whatever the season. */
const at = (daysAgo: number): string => new Date(Date.parse(`${addDays(today, -daysAgo)}T10:00:00Z`)).toISOString();

/* ---- 1. synthetic engine rows ------------------------------------------------ */

function row(n: number, o: Partial<Enquiry> & { daysAgo: number }): Enquiry {
  const id = `web_zzyzx_${String(n).padStart(2, "0")}`;
  return {
    id,
    leadId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    ref: `ZZYZX-${n}`,
    capturedAt: at(o.daysAgo),
    current: true,
    name: `Zzyzx Specimen ${n}`,
    company: `Zzyzx Holdings ${n}`,
    email: `zzyzx-${n}@example.invalid`,
    phone: "+00 000 00 00",
    website: null,
    intent: "quote",
    services: ["specimen-a"],
    servicesNamed: ["Specimen A"],
    message: "Zzyzx specimen message: never shown on this screen.",
    firstWords: null,
    recommendation: null,
    links: null,
    summary: null,
    page: "https://www.balkaris.ch/contact",
    stage: "received",
    timeline: [],
    updates: [],
    booking: null,
    owner: null,
    leadStatus: "new",
    leadSource: "website_form",
    ...o,
  };
}
const booking = (cancelled: boolean): Enquiry["booking"] => ({
  start: new Date(now + 2 * DAY).toISOString(),
  end: new Date(now + 2 * DAY + 1_800_000).toISOString(),
  startZurich: null,
  meetUrl: "https://meet.example.invalid/zzyzx",
  bookedAt: at(1),
  cancelled,
  cancelledAt: cancelled ? at(0) : null,
  cancelledBy: cancelled ? "visitor" : null,
});

const rows: Enquiry[] = [
  row(1, { daysAgo: 0, booking: booking(false), owner: { email: "host@example.invalid", name: "Zzyzx Host" }, stage: "meeting_confirmed" }),
  row(2, { daysAgo: 1, booking: booking(true), owner: { email: "host@example.invalid", name: "Zzyzx Host" } }),
  row(3, { daysAgo: 2, services: ["specimen-a", "specimen-b"], servicesNamed: ["Specimen A", "Specimen B"], page: "https://www.balkaris.ch/specimen-industry" }),
  row(4, { daysAgo: 3, page: null, services: [], servicesNamed: [] }),
  row(5, { daysAgo: 5, page: "https://www.balkaris.ch/book", services: ["specimen-b"], servicesNamed: ["Specimen B"] }),
  row(6, { daysAgo: 9, page: "https://www.balkaris.ch/insights/specimen-article" }), /* the window before 7d */
  row(7, { daysAgo: 12, booking: booking(false) }), /* the window before 7d */
  row(8, { daysAgo: 20, page: "https://www.balkaris.ch/specimen-unknown" }), /* outside both 7d windows */
];

const seven = conv.countEnquiries(rows, "7d", today);
check("7d: five enquiries in the window", seven.counts.enquiries.value === 5, seven.counts.enquiries);
check("7d: two in the window before", seven.counts.enquiries.previous === 2, seven.counts.enquiries);
check("7d: a cancelled call is not booked", seven.counts.booked.value === 1, seven.counts.booked);
check("7d: one booked in the window before", seven.counts.booked.previous === 1, seven.counts.booked);
check("7d: one point per day, seven days", seven.counts.days.length === 7 && seven.counts.enquiries.series.length === 7, seven.counts.days);
check("7d: days add up to the figure", seven.counts.days.reduce((n, d) => n + d.value, 0) === 5);
const svcA = seven.services.find((g) => g.key === "specimen-a");
const svcB = seven.services.find((g) => g.key === "specimen-b");
check("7d: two services named once are counted under both", svcA?.count === 3 && svcB?.count === 2, seven.services);
check("7d: no service named is its own group", seven.services.some((g) => g.key === "" && g.count === 1), seven.services);
const thirty = conv.countEnquiries(rows, "30d", today);
check("30d: every row lands in the window", thirty.counts.enquiries.value === 8, thirty.counts.enquiries);

/* ---- 2. page groups ---------------------------------------------------------- */

function page(p: string, kind: PageRow["kind"], title: string | null): PageRow {
  return { path: p, url: `https://www.balkaris.ch${p}`, kind, kindLabel: kind, status: 200, title, sharePicture: null, h1: null } as unknown as PageRow;
}
const crawl: Reading<PageRow[]> = store.ok(
  [page("/contact", "standard", "Contact | Balkaris"), page("/specimen-industry", "segment", "How to get more specimen clients | Balkaris"), page("/insights/specimen-article", "article", "A specimen article | Balkaris")],
  "crawl",
  now,
);
const countsOk = store.ok(thirty.counts, "engine", now, "specimen");
const groups = conv.pageGroupsFrom(store.ok(thirty.pages, "engine", now), countsOk, crawl);
check("page groups read", groups.state === "ok", groups);
if (groups.state === "ok") {
  const label = (k: string) => groups.value.rows.find((r) => r.key === k)?.label;
  check("an industry page is named by its title", label("segment:/specimen-industry") === "How to get more specimen clients", groups.value.rows);
  check("/contact is the contact page", label("contact") === "Contact page");
  check("/book is the booking page", label("book") === "Booking page");
  check("an article is an insight", label("article") === "Insights (articles)", groups.value.rows);
  check("no page is said, not guessed", label("none") === "Page not recorded");
  check("a page the crawl does not know is said so", label("unknown") === "Page not in the crawl");
  check("the total travels for the shares", groups.value.total === 8);
  check("the note says the engine has no industry", /no industry/.test(groups.note ?? ""), groups.note);
}
const off = store.off<never>("engine", "No key for the engine.", "Specimen step.");
check("page groups absent while the engine is", conv.pageGroupsFrom(off, off, crawl).state === "off");
check("services absent while the engine is", conv.servicesFrom(off, off).state === "off");

/* ---- 3. recent enquiries and who may see them --------------------------------- */

const recentRows = store.ok(rows.slice(0, 5), "engine", now);
const shown = conv.recentFrom(recentRows, countsOk, true, "30d");
check("recent: rows for a person who may see leads", shown.state === "ok" && shown.value.length === 5, shown);
if (shown.state === "ok") {
  const keys = new Set(shown.value.flatMap((r) => Object.keys(r)));
  check("recent: only the table's fields", [...keys].sort().join(",") === "call,capturedAt,company,id,name,page,services,stage", [...keys]);
  const text = JSON.stringify(shown);
  check("recent: no address, telephone or message", !/example\.invalid|\+00 000|never shown/.test(text), text);
  check("recent: page as a path", shown.value[0]!.page === "/contact", shown.value[0]);
  check("recent: who holds the call", shown.value[0]!.call?.with === "Zzyzx Host" && shown.value[0]!.call?.cancelled === false);
  check("recent: a cancelled call stays, marked", shown.value[1]!.call?.cancelled === true);
}
const hidden = conv.recentFrom(null, countsOk, false, "30d");
check("recent: absent for a person who may not see leads", hidden.state === "off", hidden);
check("recent: counts in words, not one name", hidden.state === "off" && /8 enquiries, 2 with a booked call/.test(hidden.reason) && !/Zzyzx/.test(JSON.stringify(hidden)), hidden);
check("recent: the engine's own absence passes through", conv.recentFrom(null, off, false, "30d").state === "off");

/* ---- 4. the tiles ------------------------------------------------------------- */

const SINCE = addDays(today, -12);
/* As the route words a day in a note: "21 Sep 2026". */
const sinceText = new Date(`${SINCE}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
function span(o: Partial<Span> = {}): Span {
  return {
    range: "30d",
    start: addDays(today, -30),
    end: addDays(today, -1),
    days: 30,
    since: SINCE,
    fullFrom: addDays(SINCE, 1),
    complete: true,
    partial: true,
    previous: null,
    provisionalFrom: addDays(today, -1),
    ...o,
  };
}
const days = (s: Span, values: number[]) => {
  const out = [];
  for (let d = s.since > s.start ? s.since : s.start, i = 0; d <= s.end; d = addDays(d, 1), i++) out.push({ date: d, value: values[i] ?? 0, previous: null });
  return out;
};
const s1 = span();
const ev = (o: { gl: number; bm: number; fs: number; inv: number; previous?: boolean }): Events => ({
  span: o.previous ? span({ previous: { start: addDays(today, -60), end: addDays(today, -31) }, partial: false, since: addDays(today, -90) }) : s1,
  rows: [
    { name: "generate_lead", count: o.gl, users: 1, key: false, ours: true, previous: o.previous ? { count: 4, users: 1 } : null },
    { name: "book_meeting", count: o.bm, users: 1, key: false, ours: true, previous: o.previous ? { count: 1, users: 1 } : null },
    { name: "form_start", count: o.fs, users: 1, key: false, ours: false, previous: o.previous ? { count: 9, users: 1 } : null },
    { name: "invite_shown", count: o.inv, users: 1, key: false, ours: true, previous: null },
  ],
  byDay: {
    generate_lead: days(s1, [0, 2, 0, 0, 1]),
    book_meeting: days(s1, [0, 1]),
    cancel_meeting: days(s1, []),
    invite_shown: days(s1, []),
    commercial_ask: days(s1, []),
  },
});
const counts0 = { activeUsers: 40, newUsers: 30, sessions: 120, engagedSessions: 80, screenPageViews: 400, engagementSeconds: 9000 };
const totals = (sessions: number, previous: boolean): Totals => ({ span: s1, current: { ...counts0, sessions }, previous: previous ? { ...counts0, sessions: 100 } : null });
const dayRead: Days = { span: s1, users: days(s1, []), sessions: days(s1, [3, 10, 0, 4, 5]), views: days(s1, []) };
const r = <T>(v: T): Reading<T> => store.ok(v, "ga4", now, "Specimen GA4 note.");

const tiles = conv.tilesFrom({
  events: r(ev({ gl: 6, bm: 2, fs: 14, inv: 30 })),
  totals: r(totals(120, false)),
  days: r(dayRead),
  formDays: r({ span: s1, days: { [addDays(SINCE, 1)]: 3 }, previous: null }),
  counts: off,
});
check("tiles: leads are the engine's reading, absent", tiles.leads.state === "off" && tiles.leads.source === "engine", tiles.leads);
check("tiles: booked calls are the engine's reading, absent", tiles.booked.state === "off");
check("tiles: the GA4 stand-in is GA4's own count", tiles.leadsGa4.state === "ok" && tiles.leadsGa4.source === "ga4" && tiles.leadsGa4.value.value === 6, tiles.leadsGa4);
check("tiles: book_meeting stand-in", tiles.bookedGa4.state === "ok" && tiles.bookedGa4.value.value === 2);
check("tiles: nothing compared with an unmeasured period", tiles.submissions.state === "ok" && tiles.submissions.value.previous === null, tiles.submissions);
check("tiles: form starts from form_start, a day series from the first measured day", tiles.formStarts.state === "ok" && tiles.formStarts.value.value === 14 && tiles.formStarts.value.series[1] === 3, tiles.formStarts);
check("tiles: form starts say what form_start is", tiles.formStarts.state === "ok" && /any form/.test(tiles.formStarts.note ?? ""));
check("tiles: rate is generate_lead per session", tiles.rate.state === "ok" && Math.abs(tiles.rate.value.value - 5) < 1e-9, tiles.rate);
check("tiles: rate carries its two counts", tiles.rate.state === "ok" && tiles.rate.value.part === 6 && tiles.rate.value.whole === 120 && tiles.rate.value.sub === "6 in 120 sessions", tiles.rate);
check("tiles: a day without a session has no rate in the spark", tiles.rate.state === "ok" && tiles.rate.value.series.length === 4, tiles.rate);
check("tiles: pipeline is absent with its reason and step", tiles.pipeline.state === "off" && tiles.pipeline.source === "none" && !!tiles.pipeline.step && /budget/.test(tiles.pipeline.step ?? ""), tiles.pipeline);
check("tiles: no CHF anywhere", !/CHF/.test(JSON.stringify(tiles)));

const compared = conv.rateTile(r(ev({ gl: 6, bm: 2, fs: 14, inv: 30, previous: true })), r(totals(120, true)), r(dayRead));
check("rate: compared only when both periods were measured", compared.state === "ok" && Math.abs((compared.value.previous ?? 0) - 4) < 1e-9, compared);
const noSessions = conv.rateTile(r(ev({ gl: 0, bm: 0, fs: 0, inv: 0 })), r(totals(0, false)), r(dayRead));
check("rate: no sessions is no rate, not zero", noSessions.state === "waiting", noSessions);

const withEngine = conv.tilesFrom({ events: r(ev({ gl: 6, bm: 2, fs: 14, inv: 30 })), totals: r(totals(120, false)), days: r(dayRead), formDays: r({ span: s1, days: {}, previous: null }), counts: countsOk });
check("tiles: with the engine, its figure is its own", withEngine.leads.state === "ok" && withEngine.leads.value.value === 8 && withEngine.leads.source === "engine");
check("tiles: a period that begins before GA4 measured says so", withEngine.submissions.state === "ok" && new RegExp(`measured the website from ${sinceText}:`).test(withEngine.submissions.note ?? ""), withEngine.submissions);

/* An event that fired in the period before and not in this one: GA4's events() leaves it out of `rows`.
   Its count before is the day series' (the website's own events) or form_start's own read, never a made-up zero. */
const week = span({ range: "7d", start: addDays(today, -7), end: addDays(today, -1), days: 7, since: addDays(today, -60), fullFrom: addDays(today, -59), partial: false, previous: { start: addDays(today, -14), end: addDays(today, -8) } });
const weekDays = (prev: number[]) => Array.from({ length: 7 }, (_, i) => ({ date: addDays(week.start, i), value: 0, previous: prev[i] ?? 0 }));
const quiet: Events = {
  span: week,
  rows: [{ name: "page_view", count: 120, users: 30, key: false, ours: false, previous: { count: 100, users: 28 } }],
  byDay: { generate_lead: weekDays([1, 1, 1, 1]), book_meeting: weekDays([1, 1]), cancel_meeting: weekDays([]), invite_shown: weekDays([]), commercial_ask: weekDays([]) },
};
const quietTotals: Totals = { span: week, current: { ...counts0, sessions: 60 }, previous: { ...counts0, sessions: 50 } };
const quietTiles = conv.tilesFrom({ events: r(quiet), totals: r(quietTotals), days: store.waiting("ga4", "Specimen."), formDays: r({ span: week, days: {}, previous: 7 }), counts: off });
const before = (x: Reading<{ value: number; previous: number | null }>) => (x.state === "ok" ? `${x.value.value} (before ${x.value.previous})` : x.state);
check("before: generate_lead absent now is 0 now and 4 before", before(quietTiles.submissions) === "0 (before 4)", before(quietTiles.submissions));
check("before: book_meeting absent now is 0 now and 2 before", before(quietTiles.bookedGa4) === "0 (before 2)", before(quietTiles.bookedGa4));
check("before: form_start absent now takes its own count before", before(quietTiles.formStarts) === "0 (before 7)", before(quietTiles.formStarts));
check("before: the rate before is 4 in 50 sessions", quietTiles.rate.state === "ok" && Math.abs((quietTiles.rate.value.previous ?? 0) - 8) < 1e-9, quietTiles.rate);
check("before: a day of the period before not measured whole is unknown, not zero", conv.eventCount({ ...quiet, byDay: { ...quiet.byDay, generate_lead: [{ date: week.start, value: 0, previous: null }] } }, "generate_lead").before === null);
check("before: an event that is not the website's own, absent now, has no count before", conv.eventCount(quiet, "scroll").before === null);
check("before: nothing before when the period before was not measured", conv.eventCount({ ...quiet, span: { ...week, previous: null } }, "generate_lead").before === null);

/* ---- 5. the panels ------------------------------------------------------------ */

const funnel = conv.funnelFrom(r(ev({ gl: 6, bm: 2, fs: 14, inv: 30 })), r(totals(120, false)));
check("funnel reads", funnel.state === "ok", funnel);
if (funnel.state === "ok") {
  check("funnel: five steps by their real events", funnel.value.steps.map((s) => s.event).join(",") === "active users,invite_shown,form_start,generate_lead,book_meeting", funnel.value.steps);
  check("funnel: figures are the counts", funnel.value.steps.map((s) => s.value).join(",") === "40,30,14,6,2");
  check("funnel: the note says it is an open funnel", /not one visitor/.test(funnel.note ?? ""));
}
const ch = conv.channelsFrom(r({ note: "specimen", rows: ["A", "B", "C", "D", "E", "F", "G"].map((x, i) => ({ key: x, label: `Specimen ${x}`, count: 7 - i, previous: null })) }));
check("channels: four slices and Other", ch.state === "ok" && ch.value.slices.length === 5 && ch.value.slices[4]!.label === "Other" && ch.value.slices[4]!.value === 6 && ch.value.total === 28, ch);
check("channels: no span, no claim about where measurement began", ch.state === "ok" && ch.value.measuredFrom === null);
const chPartial = conv.channelsFrom(r({ note: "specimen", span: s1, rows: [{ key: "a", label: "Specimen A", count: 2, previous: null }] }));
check("channels: a period that begins before measurement says from when", chPartial.state === "ok" && chPartial.value.measuredFrom === SINCE, chPartial);
const top = conv.topPagesFrom(
  r({ rows: [{ path: "/specimen-a", count: 3, users: 1, previous: null }, { path: "/specimen-b", count: 2, users: 1, previous: null }, { path: "/specimen-c", count: 0, users: 0, previous: null }] }),
  r({ "/specimen-a": 150, "/specimen-b": 99 }),
  crawl,
);
check("top pages: a page with no enquiry is not listed", top.state === "ok" && top.value.rows.length === 2, top);
check("top pages: a rate at 100 sessions or more", top.state === "ok" && Math.abs((top.value.rows[0]!.rate ?? 0) - 2) < 1e-9);
check("top pages: no rate under 100 sessions", top.state === "ok" && top.value.rows[1]!.rate === null && top.value.rows[1]!.sessions === 99);
const topPartial = conv.topPagesFrom(r({ span: s1, rows: [{ path: "/specimen-a", count: 1, users: 1, previous: null }] }), null, crawl);
check("top pages: a period that begins before measurement says from when", topPartial.state === "ok" && topPartial.value.measuredFrom === SINCE && new RegExp(`measured the website from ${sinceText}:`).test(topPartial.note ?? ""), topPartial);
const trend = conv.trendFrom(r(ev({ gl: 6, bm: 2, fs: 14, inv: 30 })));
check("trend reads", trend.state === "ok", trend);
if (trend.state === "ok") {
  check("trend: the whole period, day by day", trend.value.days.length === 30, trend.value.days.length);
  check("trend: a day before measurement is empty, not zero", trend.value.days[0]!.submissions === null && trend.value.days[0]!.booked === null);
  check("trend: a measured day without events is zero", trend.value.days.find((d) => d.date === SINCE)?.submissions === 0);
  check("trend: measured days carry the counts", trend.value.days.find((d) => d.date === addDays(SINCE, 1))?.submissions === 2);
}
const params = r({ readable: ["method"], unregistered: [] });
const starts = conv.startsFrom(
  r([
    { eventName: "generate_lead", method: "contact_form", pagePath: "/contact", count: 3 },
    { eventName: "generate_lead", method: "contact_form", pagePath: "/specimen-industry", count: 2 },
    { eventName: "generate_lead", method: "ai_guide", pagePath: "/insights/specimen-article", count: 1 },
    { eventName: "generate_lead", method: "avp_dock", pagePath: "/specimen-video", count: 1 },
    { eventName: "book_meeting", method: "contact_form", pagePath: "/book", count: 2 },
    { eventName: "invite_shown", method: "specimen-sheet-a", pagePath: "/specimen-industry", count: 5 },
    { eventName: "invite_shown", method: "specimen-sheet-b", pagePath: "/specimen-b", count: 4 },
  ]),
  params,
);
check("starts read", starts.state === "ok", starts);
if (starts.state === "ok") {
  const place = (k: string) => starts.value.enquiries.find((p) => p.key === k)?.count;
  check("starts: contact page", place("contact-page") === 3, starts.value);
  check("starts: the sheet on a marketing page", place("sheet") === 2);
  check("starts: the AI guide", place("ai-guide") === 1);
  check("starts: the video page's dock", place("video-dock") === 1);
  check("starts: calls from /book are the contact page's", starts.value.calls[0]?.key === "contact-page" && starts.value.callTotal === 2);
  check("starts: sheets shown, and on how many sheets", starts.value.sheetsShown === 9 && starts.value.sheets === 2);
}
const unregistered = conv.startsFrom(r([]), r({ readable: [], unregistered: [{ param: "method", step: "Specimen: register method." }] }));
check("starts: an unreadable method parameter is absent with its step", unregistered.state === "off" && unregistered.step === "Specimen: register method.", unregistered);

/* ---- 6. through the route -------------------------------------------------------- */

const person = (seesLeads: boolean): Person => ({ telegram: 1, name: "Zzyzx Viewer", email: "viewer@example.invalid", author: "balkaris", canPublish: false, owner: false, revoked: false, seesLeads, grants: null, invitedAt: null });
async function ask(query: string, seesLeads: boolean): Promise<{ status: number; body: import("../web/src/contract/conversions.ts").ConversionsPayload }> {
  const app = new Hono<import("../src/cc/access.ts").Vars>();
  app.use("*", async (c, next) => {
    c.set("who", person(seesLeads));
    await next();
  });
  app.route("/", conv.routes);
  const res = await app.request(`/${query}`);
  return { status: res.status, body: (await res.json()) as never };
}

process.env.NODE_ENV = "development";
process.env.DESK_DEV_USER = "zzyzx@example.invalid";
process.env.DESK_URL = "http://127.0.0.1:3400";

const plain = await ask("?range=7d", true);
check("route: answers 200", plain.status === 200, plain);
check("route: no specimen unless asked", plain.body.specimen === false);
check("route: the range is the one asked", plain.body.range === "7d" && plain.body.ranges.funnel === "7d");
check("route: GA4 without a key is off with its step", plain.body.funnel.state === "off" && !!(plain.body.funnel.state === "off" && plain.body.funnel.step), plain.body.funnel);
check("route: the engine without a key is off with its step", plain.body.services.state === "off" && plain.body.recent.state === "off" && plain.body.tiles.leads.state === "off");
check("route: the pipeline tile is absent", plain.body.tiles.pipeline.state === "off");
check("route: without Clarity's project id the link is not called heatmaps", plain.body.heatmapsDirect === false && /clarity\.microsoft\.com\/projects$/.test(plain.body.heatmaps), plain.body.heatmaps);
check("route: a panel's own period", (await ask("?range=7d&trend=90d&funnel=bogus", true)).body.ranges.trend === "90d");

const spec = await ask("?range=30d&specimen=1", true);
check("route: the specimen behind the three locks", spec.body.specimen === true, spec.body.specimen);
check("route: specimen feeds the engine's panels", spec.body.services.state === "ok" && spec.body.pageGroups.state === "ok" && spec.body.tiles.leads.state === "ok" && spec.body.recent.state === "ok");
check("route: specimen rows say they are specimens", spec.body.recent.state === "ok" && spec.body.recent.value.every((x) => /^Specimen /.test(x.name ?? "")) && /SPECIMEN/.test(spec.body.recent.note ?? ""));
check("route: specimen never touches GA4's panels", spec.body.funnel.state === "off");
const specHidden = await ask("?range=30d&specimen=1", false);
check("route: no name even from the specimen without the right", specHidden.body.recent.state === "off" && !/Specimen Person/.test(JSON.stringify(specHidden.body)), specHidden.body.recent);

process.env.DESK_URL = "https://desk.balkaris.ch";
check("route: no specimen on an https desk", (await ask("?specimen=1", true)).body.specimen === false);
process.env.DESK_URL = "http://127.0.0.1:3400";
delete process.env.DESK_DEV_USER;
check("route: no specimen without the development user", (await ask("?specimen=1", true)).body.specimen === false);
process.env.DESK_DEV_USER = "zzyzx@example.invalid";
process.env.NODE_ENV = "production";
check("route: no specimen in production", (await ask("?specimen=1", true)).body.specimen === false);

check("nothing left the machine", requests === 0, requests);

const { db } = await import("../src/db.ts");
db.close();
try {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch {
  /* Windows may hold the file a moment longer; it is in the temporary folder either way. */
}
console.log(`${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
