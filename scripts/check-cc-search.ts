/**
 * The five sources that wait for a credential, proved without one.
 *
 *   node --experimental-sqlite --disable-warning=ExperimentalWarning --import tsx scripts/check-cc-search.ts
 *
 * Nothing leaves this machine: a throwaway database, a stand-in for every API
 * on 127.0.0.1:3414 that answers in the shapes the official documentation
 * shows, and a guard on `fetch` that refuses any other host. Every figure in
 * here is a SPECIMEN, made up to be recognisably artificial ("specimen alpha",
 * /specimen-a, a person called Zzyzx); none of it describes the real website.
 *
 * What is proved:
 *   1. with no credential, every module says "off" with its step, no job is
 *      ready, the search box offers nothing of theirs, and not one request
 *      is made;
 *   2. Search Console tells apart "API not enabled", "not added to any
 *      property" and "the property does not contain www", and picks the
 *      Domain property when it can read one;
 *   3. each Search Console read parses, days before Google's first figure
 *      are left out rather than drawn as zero, a series is never shorter
 *      than its days, the rules built on the reads (movers, opportunities,
 *      CTR outliers, gaps) find what they should and nothing under their
 *      floors, and keywords reach the search box; on a young property the
 *      lists that show (opportunities, gaps) read early from one impression,
 *      marked, while the ones that compare (movers, CTR outliers) wait with
 *      the reason and the date, and the attention rules keep their floors;
 *   4. the daily index check writes "Google indexed ..." exactly once, treats
 *      the front page's trailing slash as no difference, notes a drop, and a
 *      run cut short never writes part of the site into the daily counts;
 *   5. Bing's links are a baseline the first day and news only afterwards
 *      (and only where the desk could have seen them before), say "Bing",
 *      and Bing's traffic is compared only with a window it fully counted;
 *   6. Clarity's four questions are kept row for row (several rows of one
 *      metric for one page included) and read back, a missing figure is null
 *      and not zero, the eleventh request of a day is refused before it is
 *      sent, the snapshot never spends the last two, and a table made by the
 *      first version of this code is rebuilt without losing a row;
 *   7. CrUX reads its vitals and history, and "no data" is an answer, not a
 *      fault;
 *   8. the engine's enquiries match the route as built (engine 031330f):
 *      every field parsed tolerantly, counts from the engine's own totals,
 *      no window before compared where the engine's record does not reach,
 *      no proxy header sent, asked once a minute at most, found in the search
 *      box only by a person who may see leads, and no trace left in any
 *      table or log line;
 *   9. a 401, 403 and 429 from each API (and the engine's 404 and 502, and a
 *      key Google's token service turns down) become the words a person can
 *      act on.
 */
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 3414;
const HERE = `http://127.0.0.1:${PORT}`;

const dir = mkdtempSync(path.join(tmpdir(), "desk-cc-search-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.CC_SCHEDULER = "off";
process.env.SITE_BASE = "https://www.balkaris.ch";
for (const k of ["GSC_SITE", "BING_API_KEY", "BING_SITE", "CLARITY_TOKEN", "CLARITY_PROJECT_ID", "GOOGLE_API_KEY", "ENGINE_READ_KEY", "ENGINE_URL"]) delete process.env[k];
/* No key file: the path names nothing. */
process.env.GA4_CREDENTIALS_FILE = path.join(dir, "absent.json");

/* ---- nothing leaves this machine ------------------------------------------ */
const realFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(`${HERE}/`)) throw new Error(`the check tried to leave the machine: ${new URL(url).host}`);
  requests++;
  return realFetch(input as never, init);
}) as typeof fetch;

/* ---- what was said on the console, to prove what was not ------------------- */
const said: string[] = [];
for (const level of ["log", "info", "warn", "error"] as const) {
  const real = console[level].bind(console);
  console[level] = (...a: unknown[]) => {
    said.push(a.map(String).join(" "));
    real(...a);
  };
}

let passed = 0;
let failedChecks = 0;
function check(name: string, good: boolean, detail?: unknown): void {
  if (good) passed++;
  else failedChecks++;
  console.log(`  ${good ? "ok  " : "FAIL"} ${name}${!good && detail !== undefined ? `\n         ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}
const section = (title: string) => console.log(`\n${title}`);

/* ---- specimen data ---------------------------------------------------------- */
const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayIn = (zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
const between = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** The stand-in's Search Console has sixty finished days, ending three days ago in Pacific Time. */
const ANCHOR = addDays(dayIn("America/Los_Angeles"), -3);
/** The first day the stand-in has figures for. A test moves it once, to make a young property. */
let FIRST = addDays(ANCHOR, -59);
const onDay = (date: string) => {
  const i = between(FIRST, date);
  return { clicks: 2 + (i % 3), impressions: 100 + 10 * (i % 5), position: 10 - (i % 4) };
};

type Fig = [position: number, impressions: number, clicks: number];
const SITE = "https://www.balkaris.ch";
const QUERIES: Record<string, { now: Fig; before?: Fig; page: string }> = {
  "specimen alpha": { now: [8, 400, 20], before: [17, 300, 6], page: "/specimen-a" },
  "specimen beta": { now: [2, 500, 60], before: [2.4, 450, 50], page: "/specimen-b" },
  "specimen gamma": { now: [12, 200, 2], before: [11.5, 180, 2], page: "/specimen-c" },
  "specimen delta": { now: [15, 12, 0], before: [30, 12, 0], page: "/specimen-a" },
  "uncovered thing": { now: [9, 80, 1], page: "/specimen-b" },
};
const PAGES: Record<string, { now: Fig; before?: Fig }> = {
  "/specimen-a": { now: [2, 1000, 100], before: [2, 900, 90] },
  "/specimen-b": { now: [2.5, 800, 72], before: [2.5, 700, 60] },
  "/specimen-c": { now: [1.8, 600, 12], before: [1.8, 500, 10] },
  "/": { now: [8, 300, 9], before: [14, 250, 5] },
};
const row = (keys: string[], [position, impressions, clicks]: Fig) => ({ keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

/**
 * A young property's query and page rows, for the early-signals checks: a
 * handful of impressions, nowhere near a floor. With `fake.young` "new" the
 * window before has nothing; with "thin" it has a little of the same.
 */
const YOUNG_QUERIES: Record<string, { now: Fig; before?: Fig; page: string }> = {
  "specimen early one": { now: [6, 4, 0], before: [7, 3, 0], page: "/specimen-a" },
  "specimen early two": { now: [12, 2, 0], page: "/specimen-b" },
  "specimen early three": { now: [2, 3, 1], page: "/specimen-c" },
};
const YOUNG_PAGES: Record<string, { now: Fig; before?: Fig }> = {
  "/specimen-a": { now: [5, 7, 1], before: [6, 5, 0] },
  "/": { now: [3, 2, 0] },
};
/**
 * A window well past 1,000 impressions that one query at the top carries
 * ("brand"): no row at position 4 to 20 reaches 30. And a window where twelve
 * rows at 4 to 20 reach it ("wide"). Repeated digits, specimen words.
 */
const BRAND_QUERIES: Record<string, { now: Fig; before?: Fig; page: string }> = {
  "specimen brand": { now: [1, 1111, 99], before: [1, 999, 88], page: "/" },
  "specimen early one": { now: [6, 4, 0], page: "/specimen-a" },
  "specimen early two": { now: [12, 2, 0], page: "/specimen-b" },
};
const WIDE_QUERIES: Record<string, { now: Fig; before?: Fig; page: string }> = Object.fromEntries([
  ...Array.from({ length: 12 }, (_, i) => [`specimen wide ${String(i + 1).padStart(2, "0")}`, { now: [5 + i, 111, 1] as Fig, before: [6 + i, 111, 1] as Fig, page: "/specimen-a" }] as const),
  ["specimen wide small", { now: [7, 3, 0] as Fig, page: "/specimen-b" }] as const,
]);
const youngTable = () => (fake.young === "brand" ? BRAND_QUERIES : fake.young === "wide" ? WIDE_QUERIES : YOUNG_QUERIES);

const PERSON = "Specimen Person Zzyzx";
const MAILBOX = "zzyzx@specimen.invalid";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/* ---- the stand-in ----------------------------------------------------------- */
const fake = {
  hits: { gsc: 0, inspect: 0, bing: 0, clarity: 0, crux: 0, engine: 0, sitemap: 0 } as Record<string, number>,
  /** A status to answer with instead of the real answer, per API. 0 answers normally. */
  refuse: { gsc: 0, inspect: 0, bing: 0, clarity: 0, crux: 0, engine: 0 } as Record<string, number>,
  gscDisabled: false,
  sites: [] as { siteUrl: string; permissionLevel: string }[],
  lastQuery: null as Record<string, unknown> | null,
  indexed: new Set<string>(["/", "/specimen-a"]),
  links: { "/specimen-a": [{ Url: "https://first.specimen.example/post", AnchorText: "a specimen" }] } as Record<string, { Url: string; AnchorText: string }[]>,
  cruxHasData: true,
  /** Every question the engine stand-in was asked: its since, its limit and the names of the headers that came with it. */
  engineAsks: [] as { since: string | null; limit: string | null; headers: string[] }[],
  engineCut: null as number | null,
  engineJunk: true,
  /** Pages whose links Bing refuses to list (ErrorCode 7, InvalidUrl). */
  bingRefusesLinksOf: new Set<string>(),
  /** A day the stand-in's Search Console has no impressions for (it sends no row then, as Google does). */
  gscQuietDay: null as string | null,
  /** URL Inspection answers 500 once it has answered this many times since `inspectSeen` was reset. */
  inspectFailAfter: null as number | null,
  inspectSeen: 0,
  /** Bing's traffic as ten clicks and a hundred impressions a day, from `from` to `to` days ago. Null: the two documented sample rows. */
  bingTraffic: null as { from: number; to: number } | null,
  /** The engine holds only enquiries younger than this many hours: a record that began recently. */
  engineHoldsHours: null as number | null,
  /** Answer query and page questions with the young property's rows (YOUNG_*): "new" has nothing before, "thin" a little; "brand" and "wide" are BRAND_QUERIES and WIDE_QUERIES. */
  young: null as null | "new" | "thin" | "brand" | "wide",
  /** The first day the stand-in reports queries for (date and query rows), when later than its first figure: a property whose query rows begin after its totals. */
  queriesFrom: null as string | null,
};

const GOOGLE_DISABLED = {
  error: {
    code: 403,
    message: "specimen: the API is disabled",
    status: "PERMISSION_DENIED",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com", metadata: { service: "searchconsole.googleapis.com", consumer: "projects/0" } }],
  },
};
const googleError = (code: number) => ({
  error: { code, message: "specimen refusal", status: code === 401 ? "UNAUTHENTICATED" : code === 403 ? "PERMISSION_DENIED" : code === 429 ? "RESOURCE_EXHAUSTED" : code === 404 ? "NOT_FOUND" : "INTERNAL" },
});

function searchAnalytics(body: { startDate: string; endDate: string; dimensions?: string[] }): unknown {
  const dims = (body.dimensions ?? []).join(",");
  const current = body.endDate === ANCHOR;
  const pick = <T extends { now: Fig; before?: Fig }>(v: T): Fig | undefined => (current ? v.now : fake.young === "new" ? undefined : v.before);
  if (fake.young) {
    if (dims === "query") return { rows: Object.entries(youngTable()).flatMap(([q, v]) => (pick(v) ? [row([q], pick(v)!)] : [])) };
    if (dims === "page") return { rows: Object.entries(YOUNG_PAGES).flatMap(([p, v]) => (pick(v) ? [row([`${SITE}${p}`], pick(v)!)] : [])) };
    if (dims === "query,page") return { rows: Object.entries(youngTable()).map(([q, v]) => row([q, `${SITE}${v.page}`], v.now)) };
  }
  if (dims === "date") {
    const rows = [];
    for (let d = body.startDate < FIRST ? FIRST : body.startDate; d <= body.endDate && d <= ANCHOR; d = addDays(d, 1)) {
      if (d === fake.gscQuietDay) continue;
      const f = onDay(d);
      rows.push(row([d], [f.position, f.impressions, f.clicks]));
    }
    return { rows, responseAggregationType: "byProperty" };
  }
  if (dims === "query") return { rows: Object.entries(QUERIES).flatMap(([q, v]) => (pick(v) ? [row([q], pick(v)!)] : [])) };
  if (dims === "page") return { rows: Object.entries(PAGES).flatMap(([p, v]) => (pick(v) ? [row([`${SITE}${p}`], pick(v)!)] : [])) };
  if (dims === "query,page") return { rows: Object.entries(QUERIES).map(([q, v]) => row([q, `${SITE}${v.page}`], v.now)) };
  if (dims === "country") return { rows: [row(["che"], [5, 900, 80]), row(["deu"], [9, 300, 12]), row(["zzz"], [20, 10, 0])] };
  if (dims === "device") return { rows: [row(["DESKTOP"], [6, 700, 60]), row(["MOBILE"], [7, 500, 32])] };
  if (dims === "date,query") {
    const rows = [];
    const from = [FIRST, fake.queriesFrom ?? FIRST, body.startDate].sort().at(-1)!;
    for (let d = from; d <= body.endDate; d = addDays(d, 1)) {
      rows.push(row([d, "specimen beta"], [2, 10, 1]), row([d, "specimen alpha"], [8, 10, 1]), row([d, "specimen gamma"], [12, 10, 0]), row([d, "uncovered thing"], [60, 10, 0]));
    }
    return { rows };
  }
  return { rows: [] };
}

function inspection(url: string): unknown {
  const p = new URL(url).pathname.replace(/\/+$/, "") || "/";
  const indexed = fake.indexed.has(p);
  return {
    inspectionResult: {
      inspectionResultLink: `https://search.google.com/search-console/inspect?specimen=${encodeURIComponent(p)}`,
      indexStatusResult: {
        verdict: indexed ? "PASS" : "NEUTRAL",
        coverageState: indexed ? "Submitted and indexed" : "Crawled - currently not indexed",
        robotsTxtState: "ALLOWED",
        indexingState: "INDEXING_ALLOWED",
        lastCrawlTime: "2026-01-01T06:00:00Z",
        pageFetchState: "SUCCESSFUL",
        /* The front page: Google's canonical has the slash, the page's own does not. One page. */
        ...(indexed ? { googleCanonical: p === "/" ? `${SITE}/` : p === "/specimen-a" ? `${SITE}/somewhere-else` : `${SITE}${p}` } : {}),
        userCanonical: p === "/" ? SITE : `${SITE}${p}`,
        crawledAs: "MOBILE",
      },
    },
  };
}

const bingDate = (daysAgo: number) => `/Date(${Date.parse(`${addDays(dayIn("UTC"), -daysAgo)}T00:00:00Z`)}+0000)/`;

function bing(method: string, q: URLSearchParams): unknown {
  switch (method) {
    case "GetLinkCounts": {
      const all = Object.entries(fake.links).map(([p, l]) => ({ __type: "LinkCount:#Microsoft.Bing.Webmaster.Api", Count: l.length, Url: `${SITE}${p}` }));
      /* Two pages of results, to prove the paging. */
      return { __type: "LinkCounts:#Microsoft.Bing.Webmaster.Api", Links: q.get("page") === "0" ? all.slice(0, 1) : all.slice(1), TotalPages: 2 };
    }
    case "GetUrlLinks": {
      const p = new URL(q.get("link") ?? SITE).pathname;
      if (fake.bingRefusesLinksOf.has(p)) return { refused: { ErrorCode: 7, Message: "InvalidUrl" } };
      return { __type: "LinkDetails:#Microsoft.Bing.Webmaster.Api", Details: fake.links[p] ?? [], TotalPages: 1 };
    }
    case "GetQueryStats":
      return [
        { __type: "QueryStats:#Microsoft.Bing.Webmaster.Api", AvgClickPosition: 4, AvgImpressionPosition: 6, Clicks: 3, Date: bingDate(5), Impressions: 30, Query: "specimen alpha" },
        { __type: "QueryStats:#Microsoft.Bing.Webmaster.Api", AvgClickPosition: 2, AvgImpressionPosition: 8, Clicks: 1, Date: bingDate(12), Impressions: 10, Query: "specimen alpha" },
        { __type: "QueryStats:#Microsoft.Bing.Webmaster.Api", AvgClickPosition: 0, AvgImpressionPosition: 20, Clicks: 0, Date: bingDate(200), Impressions: 99, Query: "long ago" },
      ];
    case "GetPageStats":
      return [{ __type: "QueryStats:#Microsoft.Bing.Webmaster.Api", AvgClickPosition: 3, AvgImpressionPosition: 5, Clicks: 2, Date: bingDate(5), Impressions: 20, Query: `${SITE}/specimen-a` }];
    case "GetRankAndTrafficStats":
      if (fake.bingTraffic) {
        const out = [];
        for (let ago = fake.bingTraffic.from; ago >= fake.bingTraffic.to; ago--) out.push({ __type: "RankAndTrafficStats:#Microsoft.Bing.Webmaster.Api", Clicks: 10, Date: bingDate(ago), Impressions: 100 });
        return out;
      }
      return [
        { __type: "RankAndTrafficStats:#Microsoft.Bing.Webmaster.Api", Clicks: 2, Date: bingDate(3), Impressions: 40 },
        { __type: "RankAndTrafficStats:#Microsoft.Bing.Webmaster.Api", Clicks: 1, Date: bingDate(4), Impressions: 30 },
      ];
    case "GetCrawlIssues":
      return [{ __type: "UrlWithCrawlIssues:#Microsoft.Bing.Webmaster.Api", HttpCode: 404, Issues: 36, Url: `${SITE}/specimen-gone`, InLinks: 2 }];
    case "GetCrawlStats":
      return [{ __type: "CrawlStats:#Microsoft.Bing.Webmaster.Api", AllOtherCodes: 0, BlockedByRobotsTxt: 0, Code2xx: 90, Code301: 2, Code302: 0, Code4xx: 1, Code5xx: 0, ContainsMalware: 0, CrawlErrors: 1, CrawledPages: 93, Date: bingDate(1), InIndex: 80, InLinks: 5 }];
    default:
      return null;
  }
}

function clarityAnswer(q: URLSearchParams): unknown {
  const a = `${SITE}/specimen-a`;
  const b = `${SITE}/specimen-b?utm=specimen`;
  const friction = (subTotal: string, pct: number, key: Record<string, string>) => ({ sessionsCount: "40", sessionsWithMetricPercentage: pct, sessionsWithoutMetricPercentage: 100 - pct, pagesViews: "60", subTotal, ...key });
  switch (q.get("dimension1")) {
    case "URL":
      return [
        {
          metricName: "Traffic",
          information: [
            { totalSessionCount: "40", totalBotSessionCount: "4", distantUserCount: "30", PagesPerSessionPercentage: 1.5, Url: a },
            { totalSessionCount: "10", totalBotSessionCount: "1", distantUserCount: "8", PagesPerSessionPercentage: 1.2, Url: b },
          ],
        },
        { metricName: "ScrollDepth", information: [{ averageScrollDepth: 62.5, Url: a }, { averageScrollDepth: 40, Url: b }] },
        { metricName: "EngagementTime", information: [{ totalTime: "120", activeTime: "45", Url: a }] },
        { metricName: "RageClickCount", information: [friction("3", 5, { Url: a })] },
        { metricName: "DeadClickCount", information: [friction("7", 12.5, { Url: a })] },
        { metricName: "QuickbackClick", information: [friction("2", 2.5, { Url: a })] },
        { metricName: "ExcessiveScroll", information: [friction("1", 2.5, { Url: a })] },
        { metricName: "ScriptErrorCount", information: [friction("4", 7.5, { Url: a })] },
        { metricName: "ErrorClickCount", information: [friction("0", 0, { Url: a })] },
        { metricName: "A metric nobody has heard of", information: [{ something: 1, Url: a }] },
        /* One of the metrics Microsoft lists that send several rows for one value of the dimension asked for. */
        { metricName: "Browser", information: [{ name: "SpecimenBrowserA", sessionsCount: "3", Url: a }, { name: "SpecimenBrowserB", sessionsCount: "4", Url: a }] },
      ];
    case "Device":
      return [
        {
          metricName: "Traffic",
          information: [
            { totalSessionCount: "30", totalBotSessionCount: "3", distantUserCount: "25", PagesPerSessionPercentage: 1.4, Device: "Mobile" },
            { totalSessionCount: "20", totalBotSessionCount: "2", distantUserCount: "13", PagesPerSessionPercentage: 1.6, Device: "PC" },
          ],
        },
        { metricName: "Rage Click Count", information: [friction("2", 5, { Device: "Mobile" }), friction("1", 5, { Device: "PC" })] },
      ];
    case "Source":
      return [{ metricName: "Traffic", information: [{ totalSessionCount: "5", totalBotSessionCount: "0", distantUserCount: "5", PagesPerSessionPercentage: 1, Source: "specimen-source", Medium: "referral" }] }];
    case "Country/Region":
      return [{ metricName: "Traffic", information: [{ totalSessionCount: "45", totalBotSessionCount: "5", distantUserCount: "35", PagesPerSessionPercentage: 1.5, "Country/Region": "Specimenland" }] }];
    default:
      return [{ metricName: "Traffic", information: [{ totalSessionCount: "1", totalBotSessionCount: "0", distantUserCount: "1", PagesPerSessionPercentage: 1, OS: "Other" }] }];
  }
}

const histogram = (a: number, b: number, c: number, quoted = false) => [
  { start: quoted ? "0.00" : 0, end: quoted ? "0.10" : 2500, density: a },
  { start: quoted ? "0.10" : 2500, end: quoted ? "0.25" : 4000, density: b },
  { start: quoted ? "0.25" : 4000, density: c },
];

/**
 * The engine's rows, newest first, in the route's own field names
 * (work/engine-enquiries-contract.txt). Three tell a story; three more,
 * three days old, are there so that the engine's totals hold more than one
 * row of an answer does.
 */
function enquiryRows(): Record<string, unknown>[] {
  return [
    {
      id: "web_specimen_1",
      lead_id: "lead_specimen_1",
      ref: "BK-0000-0001",
      captured_at: hoursAgo(2),
      current: true,
      name: PERSON,
      company: "Specimen Works",
      email: MAILBOX,
      phone: "+00 000 000 00 00",
      website: "https://specimen.invalid",
      intent: "meeting",
      services: ["specimen-service", "other-service"],
      services_named: ["Specimen Service", "Other Service"],
      message: `A specimen message from ${PERSON}.`,
      first_words: "specimen first words",
      recommendation: "specimen recommendation",
      links: "https://specimen.invalid/brief",
      summary: { project_type: "specimen project", goals: ["specimen goal"], timeline: "specimen weeks", references: null },
      page: "/specimen-a",
      stage: "meeting_confirmed",
      timeline: [{ stage: "received", at: hoursAgo(2) }, { stage: "meeting_confirmed", at: hoursAgo(1) }, { stage: "broken" }],
      updates: [{ at: hoursAgo(1), text: "specimen update", by: null }, { text: "no time" }],
      booking: {
        start: hoursAgo(-48),
        end: hoursAgo(-47.5),
        start_zurich: "2026-01-01T10:00:00+01:00",
        meet_url: "https://meet.specimen.invalid/x",
        booked_at: hoursAgo(1),
        cancelled: false,
        cancelled_at: null,
        cancelled_by: null,
      },
      owner: { email: "owner@specimen.invalid", name: "Specimen Owner" },
      lead_status: "meeting",
      lead_source: "website_form",
      a_field_added_later: { anything: true },
    },
    /* An enquiry with almost nothing on it: every missing field must come out null, not a guess. */
    { id: "web_specimen_2", captured_at: hoursAgo(30), email: MAILBOX, services: "not a list", page: "https://www.balkaris.ch/specimen-b/", stage: "received", booking: { start: "not a time" } },
    /* A second one the day before yesterday, so that a cut answer can reach past a window's start and still miss one. */
    { id: "web_specimen_4", lead_id: "lead_specimen_4", captured_at: hoursAgo(40), current: true, email: "four@specimen.invalid", services: [], message: "", page: "/specimen-b", stage: "received", timeline: [], updates: [], booking: null, owner: null, lead_status: "new", lead_source: null },
    ...[1, 2, 3].map((n) => ({
      id: `web_specimen_bulk_${n}`,
      lead_id: `lead_specimen_bulk_${n}`,
      captured_at: hoursAgo(72 + n),
      current: true,
      email: `bulk${n}@specimen.invalid`,
      services: ["specimen-service"],
      message: "",
      page: "/specimen-c",
      stage: "processed",
      timeline: [],
      updates: [],
      booking: null,
      owner: null,
      lead_status: "new",
      lead_source: "website_form",
    })),
    /* One from the window before (nine days ago), with a cancelled booking and an owner sent as a bare address. */
    {
      id: "web_specimen_3",
      lead_id: "lead_specimen_3",
      captured_at: hoursAgo(9 * 24),
      current: false,
      name: PERSON,
      email: MAILBOX,
      services: ["specimen-service"],
      page: "/specimen-a",
      stage: "received",
      booking: { start: hoursAgo(-24), end: hoursAgo(-23.5), cancelled: true, cancelled_at: hoursAgo(5), cancelled_by: "visitor" },
      owner: "owner@specimen.invalid",
    },
    /* The oldest the engine holds, forty days back: where its record begins. */
    {
      id: "web_specimen_oldest",
      lead_id: "lead_specimen_oldest",
      captured_at: hoursAgo(40 * 24),
      current: true,
      email: "oldest@specimen.invalid",
      services: [],
      message: "",
      page: "/specimen-c",
      stage: "processed",
      timeline: [],
      updates: [],
      booking: null,
      owner: null,
      lead_status: "new",
      lead_source: "website_form",
    },
  ];
}

/** Zurich's calendar day of an ISO time, as the engine counts it. */
const zurichDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip", "via"];

/** The engine's route, as src/desk-enquiries.ts in the engine answers: the gate, `since`, `limit`, rows and totals. */
function engineAnswer(url: URL, headers: http.IncomingHttpHeaders): { status: number; body: unknown } {
  const sinceRaw = url.searchParams.get("since");
  const limitRaw = url.searchParams.get("limit");
  fake.engineAsks.push({ since: sinceRaw, limit: limitRaw, headers: Object.keys(headers) });
  if (PROXY_HEADERS.some((h) => headers[h] !== undefined)) return { status: 404, body: { ok: false, error: "not found" } };
  if (headers.authorization !== "Bearer check-engine-key-0123456789abcdef") return { status: 401, body: { ok: false, error: "unauthorized" } };
  const since = sinceRaw ? Date.parse(sinceRaw) : NaN;
  if (sinceRaw && !Number.isFinite(since)) return { status: 400, body: { ok: false, error: "since must be an ISO time" } };
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(limitRaw)) || 200));
  const holds = fake.engineHoldsHours === null ? -Infinity : Date.now() - fake.engineHoldsHours * 3_600_000;
  const rows = enquiryRows()
    .filter((r) => fake.engineHoldsHours === null || Date.parse(String(r.captured_at)) >= holds)
    .filter((r) => !Number.isFinite(since) || (typeof r.captured_at === "string" && Date.parse(r.captured_at) >= since));
  const byDay = new Map<string, { count: number; booked: number }>();
  for (const r of rows) {
    const day = zurichDay(String(r.captured_at));
    const d = byDay.get(day) ?? { count: 0, booked: 0 };
    d.count++;
    const b = r.booking as { start?: string; cancelled?: boolean } | null | undefined;
    if (b && Number.isFinite(Date.parse(String(b.start))) && !b.cancelled) d.booked++;
    byDay.set(day, d);
  }
  /* `cut` stands for an engine holding more than one answer carries: it sends fewer rows than it counts. */
  const sent = rows.slice(0, Math.min(limit, fake.engineCut ?? limit));
  return {
    status: 200,
    body: {
      ok: true,
      as_of: new Date().toISOString(),
      since: Number.isFinite(since) ? new Date(since).toISOString() : null,
      limit,
      total: rows.length,
      count: sent.length,
      /* Two things that are not rows ride along, to prove they are dropped. */
      rows: [...sent, ...(fake.engineJunk ? ["not a row at all", null] : [])],
      totals: { tz: "Europe/Zurich", by_day: [...byDay.entries()].map(([day, v]) => ({ day, ...v })).sort((a, b) => b.day.localeCompare(a.day)) },
      a_field_added_later: 1,
    },
  };
}

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json"): void {
  res.writeHead(status, { "content-type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", HERE);
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const text = Buffer.concat(chunks).toString("utf8");
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const [, api, ...rest] = url.pathname.split("/");
    const tail = rest.join("/");

    if (api === "sitemap.xml") {
      fake.hits.sitemap!++;
      return send(res, 200, `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["", "/specimen-a", "/specimen-b", "/specimen-c"].map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`, "application/xml");
    }
    if (!api || !(api in fake.hits)) return send(res, 404, { error: "no such stand-in" });
    fake.hits[api]!++;
    if (fake.refuse[api]) {
      if (api === "bing") return send(res, fake.refuse.bing!, fake.refuse.bing === 400 ? { ErrorCode: 3, Message: "InvalidApiKey" } : {});
      if (api === "clarity" || api === "engine") return send(res, fake.refuse[api]!, api === "engine" ? { ok: false, error: "specimen refusal" } : "");
      return send(res, fake.refuse[api]!, googleError(fake.refuse[api]!));
    }

    if (api === "gsc" || api === "inspect") {
      if (req.headers.authorization !== "Bearer check-token") return send(res, 401, googleError(401));
      if (fake.gscDisabled) return send(res, 403, GOOGLE_DISABLED);
      if (api === "inspect" && fake.inspectFailAfter !== null && ++fake.inspectSeen > fake.inspectFailAfter) return send(res, 500, googleError(500));
      if (api === "inspect") return send(res, 200, inspection(String(body.inspectionUrl)));
      if (tail === "sites") return send(res, 200, fake.sites.length ? { siteEntry: fake.sites } : {});
      if (tail.endsWith("/searchAnalytics/query")) {
        fake.lastQuery = { ...body, site: decodeURIComponent(rest[1] ?? "") };
        return send(res, 200, searchAnalytics(body as never));
      }
      if (tail.endsWith("/sitemaps"))
        return send(res, 200, { sitemap: [{ path: `${SITE}/sitemap.xml`, lastSubmitted: "2026-01-01T00:00:00.000Z", lastDownloaded: "2026-01-02T00:00:00.000Z", isPending: false, isSitemapsIndex: false, type: "sitemap", warnings: "0", errors: "1", contents: [{ type: "web", submitted: "4", indexed: "0" }] }] });
      return send(res, 404, googleError(404));
    }
    if (api === "bing") {
      if (url.searchParams.get("apikey") !== "check-bing-key") return send(res, 400, { ErrorCode: 3, Message: "InvalidApiKey" });
      const d = bing(tail, url.searchParams) as { refused?: unknown } | null;
      /* Bing's documented way of refusing: HTTP 400 with { ErrorCode, Message }. */
      if (d && typeof d === "object" && "refused" in d) return send(res, 400, d.refused);
      return send(res, 200, { d });
    }
    if (api === "clarity") {
      if (req.headers.authorization !== "Bearer check-clarity-token") return send(res, 401, "");
      return send(res, 200, clarityAnswer(url.searchParams));
    }
    if (api === "crux") {
      if (url.searchParams.get("key") !== "check-google-key") return send(res, 400, { error: { code: 400, message: "specimen", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } });
      if (!fake.cruxHasData) return send(res, 404, { error: { code: 404, message: "chrome ux report data not found", status: "NOT_FOUND" } });
      if (tail === "records:queryRecord")
        return send(res, 200, {
          record: {
            key: { origin: body.origin, ...(body.formFactor ? { formFactor: body.formFactor } : {}) },
            metrics: {
              largest_contentful_paint: { histogram: histogram(0.8, 0.15, 0.05), percentiles: { p75: 1800 } },
              interaction_to_next_paint: { histogram: histogram(0.9, 0.08, 0.02), percentiles: { p75: 120 } },
              cumulative_layout_shift: { histogram: histogram(0.95, 0.04, 0.01, true), percentiles: { p75: "0.05" } },
            },
            collectionPeriod: { firstDate: { year: 2026, month: 1, day: 5 }, lastDate: { year: 2026, month: 2, day: 1 } },
          },
        });
      return send(res, 200, {
        record: {
          key: { origin: body.origin },
          metrics: {
            largest_contentful_paint: { percentilesTimeseries: { p75s: [1900, null, 1800] } },
            interaction_to_next_paint: { percentilesTimeseries: { p75s: [130, null, 120] } },
            cumulative_layout_shift: { percentilesTimeseries: { p75s: ["0.06", "NaN", "0.05"] } },
          },
          collectionPeriods: [0, 7, 14].map((d) => ({ firstDate: { year: 2026, month: 1, day: 4 + d }, lastDate: { year: 2026, month: 1, day: 31 - 14 + d } })),
        },
      });
    }
    if (api === "engine") {
      const answer = engineAnswer(url, req.headers);
      return send(res, answer.status, answer.body);
    }
    return send(res, 404, {});
  });
});
await new Promise<void>((go) => server.listen(PORT, "127.0.0.1", go));

/* ---- a database left by the first version of the Clarity table ----------------
   Its key had no place for several rows of one metric under one value. The
   module must rebuild it on load, numbering the rows, losing none. */
{
  const { DatabaseSync } = await import("node:sqlite");
  const old = new DatabaseSync(process.env.DESK_DB!);
  old.exec(
    "CREATE TABLE cc_clarity (day TEXT NOT NULL, cut TEXT NOT NULL, metric TEXT NOT NULL, k1 TEXT NOT NULL DEFAULT '', k2 TEXT NOT NULL DEFAULT '', json TEXT NOT NULL, span INTEGER NOT NULL, at TEXT NOT NULL, PRIMARY KEY (day, cut, metric, k1, k2))",
  );
  const put = old.prepare("INSERT INTO cc_clarity (day, cut, metric, k1, k2, json, span, at) VALUES ('2000-01-01', ?, 'Traffic', ?, '', '{}', 1, '2000-01-01T00:00:00Z')");
  put.run("url", `${SITE}/specimen-old-b`);
  put.run("url", `${SITE}/specimen-old-a`);
  put.run("device", "Specimen device");
  old.close();
}

/* ---- the modules, loaded after the environment is set ----------------------- */
const { db } = await import("../src/db.ts");
const store = await import("../src/cc/store.ts");
const sources = await import("../src/cc/sources.ts");
const search = await import("../src/cc/search/index.ts");
const shared = await import("../src/cc/search/shared.ts");
const { gsc, bing: bingApi, clarity, crux, leads } = search;
type AnyReading = { state: string; reason?: string; step?: string; value?: unknown; note?: string };
/** A reading's note, which only an `ok` reading has; "" for the others. */
const noteOf = (r: { state: string }): string => (r.state === "ok" ? ((r as { note?: string }).note ?? "") : "");
const activityWith = (text: string) => (db.prepare("SELECT COUNT(*) AS c FROM cc_activity WHERE text = ?").get(text) as { c: number }).c;
/** 3b's 90-day totals where the first figure and the first query differ, and the day the collector promised: read against the screen's gate in 9b. */
let sameDay: { totals: Awaited<ReturnType<typeof gsc.totalsByDay>>; promised: string } | null = null;

try {
  /* ============ 0. the Clarity table of the first version, rebuilt ============ */
  section("0. A Clarity table from the first version");
  {
    const cols = (db.prepare("PRAGMA table_info(cc_clarity)").all() as { name: string; pk: number }[]).filter((c) => c.pk > 0).map((c) => c.name);
    check("the table is rebuilt with each row's place in its key", cols.join() === "day,cut,metric,n", cols);
    const kept = db.prepare("SELECT cut, n, k1 FROM cc_clarity WHERE day = '2000-01-01' ORDER BY cut, n").all() as { cut: string; n: number; k1: string }[];
    check("  every row is still there, numbered per metric", kept.map((r) => `${r.cut}:${r.n}:${r.k1.replace(SITE, "")}`).join() === "device:0:Specimen device,url:0:/specimen-old-a,url:1:/specimen-old-b", kept);
    check("  and the old table is gone", !(db.prepare("SELECT name FROM sqlite_master WHERE name = 'cc_clarity_before_n'").get() as unknown));
    /* These rows would read as an old snapshot from now on; the rest of the check starts without them. */
    db.prepare("DELETE FROM cc_clarity WHERE day = '2000-01-01'").run();
  }

  /* ============ 1. no credential: off, with the step, and silent ============ */
  section("1. With no credential set");
  {
    const reads: [string, AnyReading][] = [
      ["gsc.totalsByDay", await gsc.totalsByDay("30d")],
      ["gsc.queries", await gsc.queries("30d")],
      ["gsc.pages", await gsc.pages("7d")],
      ["gsc.queryPages", await gsc.queryPages("30d")],
      ["gsc.byCountry", await gsc.byCountry("30d")],
      ["gsc.byDevice", await gsc.byDevice("30d")],
      ["gsc.positionBuckets", await gsc.positionBuckets("30d")],
      ["gsc.movers", await gsc.movers("30d")],
      ["gsc.opportunities", await gsc.opportunities("30d")],
      ["gsc.ctrOutliers", await gsc.ctrOutliers("30d")],
      ["gsc.gaps", await gsc.gaps("30d", [])],
      ["gsc.sitemaps", await gsc.sitemaps()],
      ["gsc.indexing", await gsc.indexing()],
      ["gsc.query", await gsc.query({ range: "30d", dimensions: ["query"] })],
      ["bing.linkCounts", await bingApi.linkCounts()],
      ["bing.inboundLinks", bingApi.inboundLinks()],
      ["bing.linksTo", bingApi.linksTo("/specimen-a")],
      ["bing.queryStats", await bingApi.queryStats("30d")],
      ["bing.pageStats", await bingApi.pageStats("30d")],
      ["bing.traffic", await bingApi.traffic("30d")],
      ["bing.crawlIssues", await bingApi.crawlIssues()],
      ["bing.crawlStats", await bingApi.crawlStats()],
      ["clarity.latest", clarity.latest()],
      ["clarity.byUrl", clarity.byUrl()],
      ["clarity.friction", clarity.friction("/specimen-a")],
      ["clarity.scrollDepth", clarity.scrollDepth()],
      ["clarity.engagementTime", clarity.engagementTime()],
      ["crux.vitals", await crux.vitals()],
      ["crux.history", await crux.history()],
      ["leads.list", await leads.list()],
      ["leads.recent", await leads.recent(5)],
      ["leads.countsByDay", await leads.countsByDay("30d")],
      ["leads.byPage", await leads.byPage("30d")],
      ["leads.byService", await leads.byService("30d")],
      ["leads.byStage", await leads.byStage("30d")],
    ];
    const wrong = reads.filter(([, r]) => r.state !== "off" || !r.reason || !r.step);
    check(`all ${reads.length} reads are off, each with a reason and a step`, wrong.length === 0, wrong.map(([n, r]) => `${n}: ${r.state}`).join(", "));
    check("no job is ready", search.jobs.every((j) => j.ready && !j.ready()), search.jobs.filter((j) => !j.ready || j.ready()).map((j) => j.name));
    check("the jobs are the seven of this slice", search.jobs.map((j) => j.name).join(",") === "gsc-access,gsc-daily,gsc-inspect,bing-daily,clarity-daily,crux-daily", search.jobs.map((j) => j.name));
    const st = sources.sources();
    check("five sources are registered, in order", st.map((s) => s.id).join(",") === "gsc,bing,clarity,crux,engine", st.map((s) => s.id));
    check("every source is off, with a step, and none is failing", st.every((s) => s.state === "off" && !!s.step && s.step.length > 40), st.map((s) => `${s.id}:${s.state}`));
    check("the steps name the variable or the place to act", /BING_API_KEY/.test(st[1]!.step!) && /CLARITY_TOKEN/.test(st[2]!.step!) && /GOOGLE_API_KEY/.test(st[3]!.step!) && /mint-desk-key\.sh/.test(st[4]!.step!) && /ga4\.json/.test(st[0]!.step!));
    check("ownerSteps lists all five", search.ownerSteps().length === 5);
    let refused = "";
    try {
      await clarity.pull(["OS"]);
    } catch (e) {
      refused = e instanceof Error ? e.message : String(e);
    }
    check("Clarity's pull refuses without a token", refused.includes("not connected"));
    check("a link into Clarity works without anything", clarity.deepLink("/specimen-a").dashboard === "https://clarity.microsoft.com/projects");
    const { find } = await import("../src/cc/find.ts");
    const owner = { name: "Specimen Owner", email: null, owner: true, canPublish: true, revoked: false, seesLeads: true, telegram: 0, author: "balkaris" } as never;
    const box = await find("specimen", owner);
    check("the search box offers no keyword and no enquiry", !box.some((h) => h.kind === "keyword" || h.kind === "lead"), box);
    check("NOT ONE request was made", requests === 0, `${requests} requests`);
  }

  /* ============ the credentials appear ====================================== */
  writeFileSync(path.join(dir, "key.json"), JSON.stringify({ client_email: "desk-check@specimen-project.iam.gserviceaccount.com", private_key: "not a key: the check never signs with it" }));
  process.env.GA4_CREDENTIALS_FILE = path.join(dir, "key.json");
  gsc.wire.bearer = async () => "check-token";
  process.env.GSC_API_BASE = `${HERE}/gsc`;
  process.env.GSC_INSPECT_BASE = `${HERE}/inspect`;
  process.env.CC_SITEMAP_URL = `${HERE}/sitemap.xml`;
  process.env.BING_API_BASE = `${HERE}/bing`;
  process.env.CLARITY_API_BASE = `${HERE}/clarity`;
  process.env.CRUX_API_BASE = `${HERE}/crux`;

  /* ============ 2. Search Console: which of the three steps ================== */
  section("2. Search Console: connected or not, and why not");
  {
    check("a key file alone is 'not asked yet', and waits", gsc.access().state === "unchecked" && gsc.status().state === "waiting");
    check("the access job is ready, the data jobs are not", !!search.jobs[0]!.ready!() && !search.jobs[1]!.ready!() && !search.jobs[2]!.ready!());

    fake.gscDisabled = true;
    let a = await gsc.checkAccess();
    check("API not enabled is its own state", a.state === "api-off");
    check("  its step is the Cloud console's Library, in the account's project", /specimen-project/.test(gsc.stepFor(a)) && /Library/.test(gsc.stepFor(a)) && /Enable/.test(gsc.stepFor(a)), gsc.stepFor(a));
    check(
      "  and it goes on to everything else still missing, so one visit does it: the property with www, the account as a Full user",
      /Users and permissions/.test(gsc.stepFor(a)) && /desk-check@specimen-project/.test(gsc.stepFor(a)) && /Full/.test(gsc.stepFor(a)) && /only https:\/\/balkaris\.ch\/, which does not contain the www pages/.test(gsc.stepFor(a)) && /Domain property for balkaris\.ch/.test(gsc.stepFor(a)),
      gsc.stepFor(a),
    );
    check("  the source is off, not failing", gsc.status().state === "off" && /not enabled/.test(gsc.status().error ?? ""), gsc.status());
    const before = requests;
    const r = (await gsc.queries("30d")) as AnyReading;
    check("  a read says the same and asks nothing more", r.state === "off" && /not enabled/.test(r.reason ?? "") && requests === before, r);
    fake.gscDisabled = false;

    fake.sites = [];
    a = await gsc.checkAccess();
    check("no property at all is its own state", a.state === "no-property");
    check("  its step is Users and permissions, with the account's address", /Users and permissions/.test(gsc.stepFor(a)) && /desk-check@specimen-project/.test(gsc.stepFor(a)) && /Full/.test(gsc.stepFor(a)), gsc.stepFor(a));
    check("  and it says what to add first when the only property is the apex one", /if there is only https:\/\/balkaris\.ch\/, which does not contain the www pages, first add a Domain property/.test(gsc.stepFor(a)), gsc.stepFor(a));

    fake.sites = [{ siteUrl: "sc-domain:balkaris.ch", permissionLevel: "siteUnverifiedUser" }];
    a = await gsc.checkAccess();
    check("an unverified user counts as not added", a.state === "no-property");

    fake.sites = [{ siteUrl: "https://balkaris.ch/", permissionLevel: "siteFullUser" }];
    a = await gsc.checkAccess();
    check("a property without www is its own state", a.state === "no-www" && /does not contain https:\/\/www\.balkaris\.ch\//.test(gsc.reasonFor(a)), gsc.reasonFor(a));
    check("  its step is to add a Domain or www property", /Domain property/.test(gsc.stepFor(a)) && /https:\/\/www\.balkaris\.ch\//.test(gsc.stepFor(a)));

    fake.sites = [
      { siteUrl: "https://www.balkaris.ch/", permissionLevel: "siteRestrictedUser" },
      { siteUrl: "sc-domain:balkaris.ch", permissionLevel: "siteFullUser" },
      { siteUrl: "https://balkaris.ch/", permissionLevel: "siteOwner" },
    ];
    process.env.GSC_SITE = "https://www.balkaris.ch/";
    a = await gsc.checkAccess();
    check("GSC_SITE, when set, is the property", a.state === "ok" && a.site === "https://www.balkaris.ch/" && a.permission === "siteRestrictedUser", a);
    process.env.GSC_SITE = "https://elsewhere.specimen.example/";
    a = await gsc.checkAccess();
    check("GSC_SITE the account cannot read is 'not added to that property'", a.state === "no-property" && /elsewhere\.specimen/.test(gsc.reasonFor(a)), a);
    delete process.env.GSC_SITE;
    check("changing GSC_SITE makes the old answer a new question", gsc.access().state === "unchecked");
    a = await gsc.checkAccess();
    check("the Domain property is preferred", a.state === "ok" && a.site === "sc-domain:balkaris.ch", a);
    check("connected: the access job rests, the data jobs are ready", !search.jobs[0]!.ready!() && !!search.jobs[1]!.ready!() && !!search.jobs[2]!.ready!());
    check("the source reads connected", gsc.status().state === "connected", gsc.status());
  }

  /* ============ 3. Search Console: the reads ================================= */
  section("3. Search Console: the reads and the rules on them");
  {
    const days30 = Array.from({ length: 30 }, (_, i) => addDays(ANCHOR, -29 + i));
    const sum = (list: string[], k: "clicks" | "impressions") => list.reduce((n, d) => n + onDay(d)[k], 0);
    const weighted = (list: string[]) => list.reduce((n, d) => n + onDay(d).position * onDay(d).impressions, 0) / sum(list, "impressions");

    const t = await gsc.totalsByDay("30d");
    check("totalsByDay reads", t.state === "ok", t);
    if (t.state === "ok") {
      const v = t.value;
      check("  the window ends on Google's last finished day, not today", v.window.end === ANCHOR && v.window.start === days30[0] && v.days.length === 30, v.window);
      check("  clicks and impressions are the sums of the days", v.clicks.value === sum(days30, "clicks") && v.impressions.value === sum(days30, "impressions"), [v.clicks.value, sum(days30, "clicks")]);
      check("  CTR is in percent, position is weighted by impressions", Math.abs((v.ctr?.value ?? NaN) - (sum(days30, "clicks") / sum(days30, "impressions")) * 100) < 0.01 && Math.abs((v.position?.value ?? NaN) - weighted(days30)) < 0.01, [v.ctr, v.position?.value, weighted(days30)]);
      const prev = days30.map((d) => addDays(d, -30));
      check("  the window before is there, day for day", v.clicks.previous === sum(prev, "clicks") && v.days[0]!.previous?.date === prev[0] && v.days[0]!.previous?.clicks === onDay(prev[0]!).clicks, v.clicks);
      check("  the note says whose figures and how late", /Google Search only/.test(t.note ?? "") && /two to three days behind/.test(t.note ?? ""), t.note);
      check("  it asked for web results and final data", fake.lastQuery?.type === "web" && fake.lastQuery?.dataState === "final" && fake.lastQuery?.site === "sc-domain:balkaris.ch", fake.lastQuery);
      check("  every series has one point per day", [v.clicks, v.impressions, v.ctr, v.position].every((s) => s?.series.length === v.days.length), [v.clicks.series.length, v.ctr?.series.length, v.position?.series.length, v.days.length]);
    }
    const t90 = await gsc.totalsByDay("90d");
    check("with no data in the window before, previous is null, not zero", t90.state === "ok" && t90.value.clicks.previous === null && t90.value.position?.previous === null && t90.value.days.at(-1)!.previous === null, t90.state === "ok" ? t90.value.clicks : t90);
    check("  and the days before Google's first figure are left out, not drawn as zero", t90.state === "ok" && t90.value.from === FIRST && t90.value.days.length === 60 && t90.value.days[0]!.date === FIRST && t90.value.clicks.series.length === 60, t90.state === "ok" ? [t90.value.from, t90.value.days.length] : t90);
    const short = (await gsc.totalsByDay("24h")) as AnyReading;
    check("the last hour or day is refused in words, without a step", short.state === "off" && !short.step && /seven days/.test(short.reason ?? ""), short);

    const q = await gsc.queries("30d");
    check("queries reads, with the window before joined on", q.state === "ok" && q.value.rows.length === 5 && q.value.rows.find((r) => r.query === "specimen alpha")?.previous?.position === 17 && q.value.rows.find((r) => r.query === "uncovered thing")?.previous === null, q);
    check("  CTR arrives in percent", q.state === "ok" && q.value.rows.find((r) => r.query === "specimen alpha")?.ctr === 5);
    const p = await gsc.pages("30d");
    check("pages reads, with paths", p.state === "ok" && p.value.rows.some((r) => r.path === "/" && r.page === `${SITE}/`) && p.value.rows.some((r) => r.path === "/specimen-a"), p);
    const qp = await gsc.queryPages("30d");
    check("queryPages reads", qp.state === "ok" && qp.value.rows.length === 5 && qp.value.rows[0]!.path.startsWith("/specimen"), qp);
    const c = await gsc.byCountry("30d");
    check("byCountry reads and names the countries", c.state === "ok" && c.value.rows[0]!.key === "CHE" && c.value.rows[0]!.label === "Switzerland" && c.value.rows[1]!.label === "Germany" && c.value.rows[2]!.label === "Unknown region", c.state === "ok" ? c.value.rows.map((r) => r.label) : c);
    const d = await gsc.byDevice("30d");
    check("byDevice reads", d.state === "ok" && d.value.rows.map((r) => r.label).join() === "Desktop,Mobile", d);
    const b = await gsc.positionBuckets("30d");
    check("positionBuckets counts per day, each bucket inside the next", b.state === "ok" && b.value.days.length === 30 && b.value.days.every((x) => x.top3 === 1 && x.top10 === 2 && x.top50 === 3 && x.queries === 4), b.state === "ok" ? b.value.days[0] : b);

    const m = await gsc.movers("30d");
    check("movers: the query and the page that moved, largest first", m.state === "ok" && m.value.rows.length === 2 && m.value.rows[0]!.key === "specimen alpha" && m.value.rows[0]!.change === 9 && m.value.rows[1]!.path === "/" && m.value.rows[1]!.change === 6, m.state === "ok" ? m.value.rows : m);
    check("  nothing under the floor: 'specimen delta' moved 15 places on 12 impressions and is not reported", m.state === "ok" && !m.value.rows.some((r) => r.key === "specimen delta") && m.value.floor === 30);
    /* At the standard floor, named: this specimen has only three rows at 4 to 20 over it, so read by itself the list is early (3b). */
    const o = await gsc.opportunities("30d", { floor: gsc.FLOOR.opportunities });
    check("opportunities: positions 4 to 20 over the floor, most impressions first, with their page", o.state === "ok" && o.value.rows.map((r) => r.query).join() === "specimen alpha,specimen gamma,uncovered thing" && o.value.rows[0]!.path === "/specimen-a", o.state === "ok" ? o.value.rows.map((r) => r.query) : o);
    const out = await gsc.ctrOutliers("30d");
    check("ctrOutliers: the page far under its neighbours' median", out.state === "ok" && out.value.rows.length === 1 && out.value.rows[0]!.path === "/specimen-c" && out.value.rows[0]!.median === 9 && out.value.rows[0]!.peers === 3, out.state === "ok" ? out.value.rows : out);
    check("  the yardstick is labelled as ours", /Our own yardstick, not Google's/.test(noteOf(out)) && /no expected CTR/.test(noteOf(out)), noteOf(out));
    const g = await gsc.gaps("30d", [
      { path: "/specimen-a", title: "Specimen Alpha, explained", h1: "Alpha" },
      { path: "/specimen-b", title: "The beta specimen" },
      { path: "/specimen-c", title: "Something", h1: "A specimen called Gamma" },
      { path: "/specimen-d", title: "Specimen delta" },
    ]);
    check("gaps: the one query no title or h1 answers", g.state === "ok" && g.value.rows.length === 1 && g.value.rows[0]!.query === "uncovered thing" && g.value.rows[0]!.path === "/specimen-b", g.state === "ok" ? g.value.rows : g);
    const sm = await gsc.sitemaps();
    check("sitemaps reads Google's string counts as numbers", sm.state === "ok" && sm.value[0]!.errors === 1 && sm.value[0]!.submitted === 4 && sm.value[0]!.isPending === false, sm);
    const door = await gsc.query({ startDate: ANCHOR, endDate: ANCHOR, dimensions: ["device"], filters: [{ dimension: "country", expression: "che" }], rowLimit: 10 });
    check("the general door passes dates and filters through", door.state === "ok" && door.value.rows.length === 2 && JSON.stringify(fake.lastQuery?.dimensionFilterGroups) === JSON.stringify([{ groupType: "and", filters: [{ dimension: "country", operator: "equals", expression: "che" }] }]) && fake.lastQuery?.rowLimit === 10, fake.lastQuery);

    const asked = requests;
    await gsc.queries("30d");
    await gsc.movers("30d");
    await gsc.totalsByDay("30d");
    check("a second read is answered from what was kept", requests === asked, `${requests - asked} requests`);
    const { find } = await import("../src/cc/find.ts");
    const reader = { name: "Specimen Reader", email: null, owner: false, canPublish: false, revoked: false, seesLeads: false, telegram: 0, author: "balkaris" } as never;
    const kw = (await find("alpha specimen", reader)).filter((h) => h.kind === "keyword");
    check(
      "the search box finds a keyword from the kept answer, with Google's figures, and asks nothing",
      kw.length === 1 && kw[0]!.title === "specimen alpha" && kw[0]!.href === "/seo?open=specimen%20alpha" && /Google Search, .* 20 clicks, 400 impressions, average position 8/.test(kw[0]!.sub ?? "") && requests === asked,
      kw,
    );

    /* An answer of the general door from three days ago, which nothing reads any more. */
    db.prepare("INSERT INTO cc_cache (key, json, at) VALUES ('gsc:q:specimen-old', '{}', ?)").run(Date.now() - 72 * 3_600_000);
    const said1 = await search.jobs[1]!.run({ progress: () => {} });
    check("the daily job refreshes and says up to which day", typeof said1 === "string" && said1.includes(ANCHOR), said1);
    const doorRows = db.prepare("SELECT key FROM cc_cache WHERE key LIKE 'gsc:q:%'").all() as { key: string }[];
    check("  and deletes the general door's answers older than two days, keeping the recent ones", !doorRows.some((r) => r.key === "gsc:q:specimen-old") && doorRows.length >= 1, doorRows);
    check("  and writes each day into the desk's own series", store.series("gsc.clicks", 400).length === 60 && store.series("gsc.clicks", 400).at(-1)?.day === ANCHOR && store.series("gsc.clicks", 400).at(-1)?.value === onDay(ANCHOR).clicks, store.series("gsc.clicks", 400).length);
    const b90 = await gsc.positionBuckets("90d");
    check("positionBuckets leaves out the days before Google's first figure", b90.state === "ok" && b90.value.from === FIRST && b90.value.days.length === 60 && b90.value.days[0]!.date === FIRST, b90.state === "ok" ? [b90.value.from, b90.value.days.length] : b90);

    /* A property whose figures begin inside the window before: that window is not compared as a whole. */
    const firstWas = FIRST;
    FIRST = addDays(ANCHOR, -40);
    store.forget("gsc:totals:30d");
    const young = await gsc.totalsByDay("30d");
    check(
      "a window before that Google only partly counted is not compared, and its uncounted days have no previous",
      young.state === "ok" && young.value.clicks.previous === null && young.value.impressions.previous === null && young.value.days[0]!.previous === null && young.value.days.at(-1)!.previous !== null && young.value.from === young.value.window.start,
      young.state === "ok" ? [young.value.clicks, young.value.days[0]!.previous, young.value.days.at(-1)!.previous] : young,
    );
    FIRST = firstWas;
    store.forget("gsc:totals:30d");

    /* A day without impressions inside the window: Google sends no row for it. */
    const quiet = addDays(ANCHOR, -5);
    fake.gscQuietDay = quiet;
    const gapped = await gsc.totalsByDay("30d");
    const q5 = gapped.state === "ok" ? gapped.value.days.find((x) => x.date === quiet) : undefined;
    check(
      "a day without impressions: clicks still have a point for it, CTR and position have no series rather than one that skips it",
      gapped.state === "ok" && gapped.value.clicks.series.length === 30 && gapped.value.days.length === 30 && q5?.impressions === 0 && q5.ctr === null && q5.position === null && gapped.value.ctr?.series.length === 0 && gapped.value.position?.series.length === 0,
      gapped.state === "ok" ? [gapped.value.ctr?.series.length, gapped.value.position?.series.length, q5] : gapped,
    );
    fake.gscQuietDay = null;
    store.forget("gsc:totals:30d");
  }

  /* ============ 3b. a young property: early signals, and honest waits ======== */
  section("3b. Search Console: a young property");
  {
    const lists = ["gsc:queries:30d", "gsc:pages:30d", "gsc:query-pages:30d"];
    const fresh = () => lists.forEach((k) => store.forget(k));

    const many = (n: number, impressions: number) => Array.from({ length: n }, () => ({ impressions }));
    check("the early rule: a window under 1,000 impressions is early, however many of the list's rows reach its floor", gsc.isEarly(many(12, 50), many(12, 50), 30) && gsc.isEarly(many(10, 30), [...many(10, 30), { impressions: 699 }], 30));
    check("  and so is a list with fewer than 10 of its own rows over its floor, however large the window", gsc.isEarly(many(9, 40), [{ impressions: 5000 }, ...many(9, 40)], 30) && gsc.isEarly([], [{ impressions: 5000 }], 30));
    check("  ten of its own rows at the floor, in a window of 1,000 impressions, is not", !gsc.isEarly(many(10, 30), [...many(10, 30), { impressions: 700 }], 30));
    const grown = await gsc.opportunities("30d");
    check(
      "  the specimen window above (1,192 impressions, but only three of its rows at 4 to 20 over 30) is early by the list's own count: those three unmarked, 'specimen delta' (12) listed and marked",
      grown.state === "ok" &&
        grown.value.early !== null &&
        grown.value.floor === 1 &&
        grown.value.rows.map((r) => `${r.query}${r.early ? " (early)" : ""}`).join() === "specimen alpha,specimen gamma,uncovered thing,specimen delta (early)",
      grown.state === "ok" ? grown.value : grown,
    );

    /* One query at the top carries the window past 1,000 impressions and 30: the list at 4 to 20 must not go back to an empty standard floor. */
    fake.young = "brand";
    fresh();
    const brand = await gsc.opportunities("30d");
    check(
      "a window past 1,000 impressions that one top query carries: the list at 4 to 20 stays early, its rows listed and marked, never empty",
      brand.state === "ok" && brand.value.early?.impressions === 1117 && brand.value.floor === 1 && brand.value.rows.map((r) => r.query).join() === "specimen early one,specimen early two" && brand.value.rows.every((r) => r.early),
      brand.state === "ok" ? brand.value : brand,
    );
    fake.young = "wide";
    fresh();
    const wide = await gsc.opportunities("30d");
    check(
      "twelve rows at 4 to 20 over 30 in a window past 1,000: the standard floor, unmarked, the row under it left out",
      wide.state === "ok" && wide.value.early === null && wide.value.floor === 30 && wide.value.rows.length === 12 && wide.value.rows.every((r) => !r.early) && !wide.value.rows.some((r) => r.query === "specimen wide small"),
      wide.state === "ok" ? wide.value : wide,
    );

    fake.young = "new";
    fresh();
    const o = await gsc.opportunities("30d");
    check(
      "opportunities, early: from one impression up, each row under the standard floor marked",
      o.state === "ok" && o.value.floor === 1 && o.value.rows.map((r) => r.query).join() === "specimen early one,specimen early two" && o.value.rows.every((r) => r.early === true),
      o.state === "ok" ? o.value : o,
    );
    check(
      "  with what the window holds and the standard floor it returns to",
      o.state === "ok" && o.value.early?.standard === 30 && o.value.early.impressions === 9 && o.value.early.queries === 3 && /^Early signals: Google showed the site 9 times for the 3 queries/.test(o.value.early.line) && /standard floor of 30 by itself/.test(o.value.early.line),
      o.state === "ok" ? o.value.early : o,
    );
    check("  and the note says it in plain words, with the rule", /Early signals/.test(noteOf(o)) && /1,000 impressions/.test(noteOf(o)), noteOf(o));
    const asked = await gsc.opportunities("30d", { floor: 30 });
    check("a floor asked for is kept exactly and is never early", asked.state === "ok" && asked.value.floor === 30 && asked.value.early === null && asked.value.rows.length === 0, asked.state === "ok" ? asked.value : asked);
    const g = await gsc.gaps("30d", []);
    check(
      "gaps, early: from one impression up, marked under their own standard floor of 10",
      g.state === "ok" && g.value.floor === 1 && g.value.early?.standard === 10 && g.value.rows.map((r) => r.query).join() === "specimen early one,specimen early three,specimen early two" && g.value.rows.every((r) => r.early),
      g.state === "ok" ? g.value : g,
    );

    const m = (await gsc.movers("30d")) as AnyReading;
    const start = addDays(ANCHOR, -29);
    check(
      "movers with no query in the window before (Google's figures cover it): waiting, never early, with the day that window first holds one",
      m.state === "waiting" && /^No comparison yet/.test(m.reason ?? "") && (m.reason ?? "").includes(`queries from ${gsc.dayText(start)}`) && (m.reason ?? "").includes(`reach ${gsc.dayText(addDays(start, 30))}`),
      m,
    );
    const c = (await gsc.ctrOutliers("30d")) as AnyReading;
    check("CTR outliers on a handful of clicks: waiting, with the window's actual counts", c.state === "waiting" && /^Too few to compare click rates: [\d,]+ clicks and [\d,]+ impressions in this window, and no page shown 50 times/.test(c.reason ?? ""), c);

    /* The one rule for the day a movement can first be measured: the later of the two gates. */
    const byFigures = gsc.firstComparison({ figures: "2026-01-01" }, 30);
    check("firstComparison: from Google's first figure, two whole windows", byFigures.includes("begin on 1 Jan 2026") && byFigures.includes("reach 1 Mar 2026"), byFigures);
    const byQueries = gsc.firstComparison({ figures: "2026-01-01", queries: "2026-02-15" }, 30);
    check("  and the later day when the first query comes after that: the window before must hold one", byQueries.includes("queries from 15 Feb 2026") && byQueries.includes("reach 17 Mar 2026") && !byQueries.includes("1 Mar 2026"), byQueries);
    const byYear = gsc.firstComparison({ figures: "2026-01-01" }, 365);
    check("  and for a year, never a day: Google keeps sixteen months, so two whole years are never both there", /sixteen months/.test(byYear) && !/reach/.test(byYear), byYear);
    check("a period inside one year is dated once, across New Year with both years", gsc.spanText("2026-09-01", "2026-09-30") === "1 Sep – 30 Sep 2026" && gsc.spanText("2024-09-30", "2025-09-29") === "30 Sep 2024 – 29 Sep 2025", [gsc.spanText("2026-09-01", "2026-09-30"), gsc.spanText("2024-09-30", "2025-09-29")]);
    const asked1y = requests;
    const year = (await gsc.movers("1y")) as AnyReading;
    check(
      "movers over a year: off, without a step, saying why, and no day promised that Search Console cannot reach; nothing is asked",
      year.state === "off" && !year.step && /sixteen months/.test(year.reason ?? "") && !/reach/.test(year.reason ?? "") && requests === asked1y,
      year,
    );

    /* Query rows that begin later than Google's first figure (a property whose old pages were shown without a query Google reports). The day
       named by the collector and the day the screen's own gate (routes/seo.ts, moversRead) holds to must be the same day. */
    fake.queriesFrom = addDays(ANCHOR, -20);
    const kept90 = ["gsc:buckets:30d", "gsc:buckets:90d", "gsc:totals:90d", "gsc:queries:90d", "gsc:pages:90d"];
    kept90.forEach((k) => store.forget(k));
    const m90 = (await gsc.movers("90d")) as AnyReading;
    const t90y = await gsc.totalsByDay("90d");
    const promised = gsc.dayText(addDays(FIRST, 179));
    check(
      "first figure and first query on different days, 90 days: the later gate is the figures', and the day is theirs",
      m90.state === "waiting" && (m90.reason ?? "").includes(`begin on ${gsc.dayText(FIRST)}`) && (m90.reason ?? "").includes(`reach ${promised}`) && !(m90.reason ?? "").includes(gsc.dayText(addDays(ANCHOR, 70))),
      m90,
    );
    /* The screen's own gate is read at the end (9b): loading the SEO screen's module registers sources this check does not set up. */
    sameDay = { totals: t90y, promised };
    const m30q = (await gsc.movers("30d")) as AnyReading;
    check(
      "  30 days, where Google's figures cover the window before: the day is the first query's, a window later",
      m30q.state === "waiting" && (m30q.reason ?? "").includes(`queries from ${gsc.dayText(addDays(ANCHOR, -20))}`) && (m30q.reason ?? "").includes(`reach ${gsc.dayText(addDays(ANCHOR, 10))}`),
      m30q,
    );
    fake.queriesFrom = null;
    kept90.forEach((k) => store.forget(k));

    fake.young = "thin";
    fresh();
    const thin = (await gsc.movers("30d")) as AnyReading;
    check(
      "movers with a little in both windows: waiting, with how much was shown in both and the floor",
      thin.state === "waiting" && /^Too few impressions to measure a movement: 1 query and 1 page were shown in both/.test(thin.reason ?? "") && /30 times in each/.test(thin.reason ?? ""),
      thin,
    );

    /* The attention rules keep the standard floors: no alert is raised on noise, and the young window gives them nothing to find. */
    const { RULES } = await import("../src/cc/attention.ts");
    const drop = await RULES.find((r) => r.id === "seo.position-drop")!.find("30d");
    const lowCtr = await RULES.find((r) => r.id === "seo.low-ctr")!.find("30d");
    check("the attention rules raise nothing on a young window: they wait, with the reason", drop.state === "waiting" && lowCtr.state === "waiting", [drop.state, lowCtr.state]);
    const { readFileSync } = await import("node:fs");
    const ruleSource = readFileSync(new URL("../src/cc/attention.ts", import.meta.url), "utf8");
    check(
      "  and they name the standard floors explicitly, so an early mode can never reach them",
      ruleSource.includes("movers(range, { floor: g.FLOOR.movers })") && ruleSource.includes("ctrOutliers(range, { floor: g.FLOOR.ctr })"),
    );

    /* Back to the grown specimen, and its answers kept again: later sections read them as kept. */
    fake.young = null;
    fresh();
    await Promise.all([gsc.queries("30d"), gsc.pages("30d"), gsc.queryPages("30d")]);
  }

  /* ============ 4. the daily index check ===================================== */
  section("4. Search Console: which pages are indexed");
  {
    const [d1, d2, d3, d4] = [store.today(-3), store.today(-2), store.today(-1), store.today()];
    const line1 = await gsc.inspectAll(d1);
    check("day one inspects the four sitemap addresses", /^4 of 4 addresses inspected: 2 indexed, 2 not/.test(line1), line1);
    check("  and announces nothing: looking for the first time is not news", (db.prepare("SELECT COUNT(*) AS c FROM cc_activity WHERE kind LIKE 'gsc.%'").get() as { c: number }).c === 0);
    const ix = await gsc.indexing();
    check("indexing() reports the day", ix.state === "ok" && ix.value.day === d1 && ix.value.inspected === 4 && ix.value.indexed === 2 && ix.value.notIndexed === 2, ix);
    const home = ix.state === "ok" ? ix.value.rows.find((r) => r.path === "/") : null;
    check("  the front page's trailing slash is not a canonical difference", home?.canonicalOk === true && home.googleCanonical === `${SITE}/` && home.userCanonical === SITE, home);
    check("  a real difference is one", ix.state === "ok" && ix.value.canonicalDiffers === 1 && ix.value.rows.find((r) => r.path === "/specimen-a")?.canonicalOk === false);
    check("  an address Google has not indexed has no canonical verdict", ix.state === "ok" && ix.value.rows.find((r) => r.path === "/specimen-b")?.canonicalOk === null && ix.value.rows.find((r) => r.path === "/specimen-b")?.coverage === "Crawled - currently not indexed");

    fake.indexed.add("/specimen-b");
    await gsc.inspectAll(d2);
    await gsc.inspectAll(d2);
    check("day two, run twice: 'Google indexed /specimen-b' is written exactly once", activityWith("Google indexed /specimen-b") === 1, activityWith("Google indexed /specimen-b"));
    await gsc.inspectAll(d3);
    check("day three, nothing changed: still exactly once", activityWith("Google indexed /specimen-b") === 1 && (db.prepare("SELECT COUNT(*) AS c FROM cc_activity WHERE kind = 'gsc.indexed'").get() as { c: number }).c === 1);
    fake.indexed.delete("/specimen-a");
    const line4 = await gsc.inspectAll(d4);
    check("day four: a page that left the index is noted, in Google's words", activityWith("Google no longer has /specimen-a in its index") === 1 && /1 dropped/.test(line4), line4);
    const hist = gsc.indexHistory(30);
    check("the counts are in the daily series", hist.length === 4 && hist.map((h) => h.indexed).join() === "2,3,3,2" && hist.map((h) => h.notIndexed).join() === "2,1,1,2", hist);
    check("the inspections are counted against Google's daily allowance", shared.countOn("gsc.inspect.used", dayIn("America/Los_Angeles")) === 20, shared.countOn("gsc.inspect.used", dayIn("America/Los_Angeles")));
    check("each day is kept", (db.prepare("SELECT COUNT(*) AS c FROM cc_inspect").get() as { c: number }).c === 16);

    /* Runs cut short. Day four has a whole check already; a second run that Google cuts must not shrink it. */
    fake.inspectFailAfter = 2;
    fake.inspectSeen = 0;
    const cut4 = await gsc.inspectAll(d4);
    check("a second run of a day, cut short by Google, leaves the day's counts whole", /^2 of 4 addresses inspected; with the day's earlier results: 2 indexed, 2 not/.test(cut4) && gsc.indexHistory(30).map((h) => h.indexed).join() === "2,3,3,2", [cut4, gsc.indexHistory(30)]);

    /* A day whose only run is cut short. */
    const d5 = store.today(1);
    fake.inspectSeen = 0;
    const cut5 = await gsc.inspectAll(d5);
    check("a day whose check was cut short writes no counts: part of the site is not the site", /2 of 4 have a result for .*, too few to count the day/.test(cut5) && gsc.indexHistory(30).length === 4 && store.series("gsc.indexed", 30).every((p) => p.day !== d5), [cut5, gsc.indexHistory(30)]);
    const part = await gsc.indexing();
    check(
      "  and indexing() says the newest check is a part, of how many",
      part.state === "ok" && part.value.day === d5 && part.value.complete === false && part.value.of === 4 && part.value.inspected === 2 && /cut short: 2 of 4/.test(part.note ?? ""),
      part.state === "ok" ? [part.value.complete, part.value.of, part.value.inspected, part.note] : part,
    );
    fake.inspectFailAfter = null;

    /* The allowance nearly used: one inspection left. It goes to an address with no result yet for the day. */
    const pacific = dayIn("America/Los_Angeles");
    const usedBefore = shared.countOn("gsc.inspect.used", pacific);
    shared.setCount("gsc.inspect.used", pacific, 1799);
    const urlsOf = (day: string) => (db.prepare("SELECT url FROM cc_inspect WHERE day = ? ORDER BY url").all(day) as { url: string }[]).map((r) => r.url);
    const hadBefore = urlsOf(d5);
    const one = await gsc.inspectAll(d5);
    check(
      "a run cut by the allowance asks first for an address the day has no result for, and still writes no counts",
      /^1 of 4 addresses inspected; 3 of 4 have a result/.test(one) && urlsOf(d5).length === 3 && hadBefore.every((u) => urlsOf(d5).includes(u)) && store.series("gsc.indexed", 30).every((p) => p.day !== d5),
      [one, urlsOf(d5)],
    );
    shared.setCount("gsc.inspect.used", pacific, usedBefore);
    const whole5 = await gsc.inspectAll(d5);
    const after = await gsc.indexing();
    check(
      "with the allowance back, the day is finished and counted once whole",
      /^4 of 4 addresses inspected: 2 indexed, 2 not/.test(whole5) && gsc.indexHistory(30).length === 5 && after.state === "ok" && after.value.complete === true && after.value.of === 4 && !/cut short/.test(after.note ?? ""),
      [whole5, gsc.indexHistory(30)],
    );
  }

  /* ============ 5. Bing ======================================================== */
  section("5. Bing Webmaster");
  {
    process.env.BING_API_KEY = "check-bing-key";
    check("the key makes the job ready", !!search.jobs[3]!.ready!());
    check("Bing's date is read in its own offset", bingApi.bingDay("/Date(1316156400000-0700)/") === "2011-09-16" && bingApi.bingDay("nonsense") === null);

    fake.links["/specimen-b"] = [{ Url: "https://second.specimen.example/a", AnchorText: "" }];
    const lc = await bingApi.linkCounts({ fresh: true });
    check("linkCounts follows Bing's pages", lc.state === "ok" && lc.value.total === 2 && lc.value.pages.length === 2 && lc.value.complete, lc);
    check("  and every note says Bing, not Google's", /Bing only/.test(noteOf(lc)) && /not Google's/.test(noteOf(lc)), noteOf(lc));
    check("the list of links waits for the first daily read", bingApi.inboundLinks().state === "waiting");

    const first = await bingApi.daily(store.today(-1));
    check("the first daily read is a baseline and announces nothing", /first read, nothing announced/.test(first) && (db.prepare("SELECT COUNT(*) AS c FROM cc_activity WHERE kind = 'bing.link'").get() as { c: number }).c === 0, first);
    fake.links["/specimen-a"]!.push({ Url: "https://www.newcomer.specimen.example/page", AnchorText: "the specimen" });
    const second = await bingApi.daily(store.today());
    await bingApi.daily(store.today());
    check("a link not seen before is announced once, as Bing's", activityWith("Bing found a new link from newcomer.specimen.example") === 1 && /1 new/.test(second), second);
    const detail = (db.prepare("SELECT detail, href FROM cc_activity WHERE kind = 'bing.link'").get() as { detail: string; href: string });
    check("  with the page, the words, and whose index it is", /To \/specimen-a/.test(detail.detail) && /the specimen/.test(detail.detail) && /not Google's/.test(detail.detail) && detail.href === "https://www.newcomer.specimen.example/page", detail);
    const links = bingApi.inboundLinks();
    check("inboundLinks reads the desk's own list, newest first", links.state === "ok" && links.value.length === 3 && links.value[0]!.host === "newcomer.specimen.example" && links.value[0]!.firstSeen === store.today(), links);
    const to = bingApi.linksTo(`${SITE}/specimen-a/`);
    check("linksTo finds a page's links by path", to.state === "ok" && to.value.length === 2, to);
    check("the link count is kept per day", bingApi.linkHistory(30).map((h) => h.links).join() === "2,3", bingApi.linkHistory(30));

    const qs = await bingApi.queryStats("30d");
    check("queryStats sums the dates inside the range and weights the positions", qs.state === "ok" && qs.value.rows.length === 1 && qs.value.rows[0]!.clicks === 4 && qs.value.rows[0]!.impressions === 40 && qs.value.rows[0]!.avgImpressionPosition === 6.5 && qs.value.rows[0]!.avgClickPosition === 3.5, qs);
    const ps = await bingApi.pageStats("30d");
    check("pageStats reads pages with their path", ps.state === "ok" && ps.value.rows[0]!.path === "/specimen-a", ps);
    const tr = await bingApi.traffic("30d");
    check("traffic reads days, and has no window before to compare", tr.state === "ok" && tr.value.clicks.value === 3 && tr.value.impressions.value === 70 && tr.value.clicks.previous === null && tr.value.days.length === 2, tr);
    fake.bingTraffic = { from: 40, to: 3 };
    const young = await bingApi.traffic("30d", { fresh: true });
    check(
      "Bing's history beginning inside the window before: not compared (eleven counted days are not thirty)",
      young.state === "ok" && young.value.clicks.value === 270 && young.value.clicks.previous === null && young.value.impressions.previous === null && young.value.clicks.series.length === young.value.days.length,
      young.state === "ok" ? [young.value.clicks.value, young.value.clicks.previous] : young,
    );
    fake.bingTraffic = { from: 70, to: 3 };
    const covered = await bingApi.traffic("30d", { fresh: true });
    check("  reaching back over the whole window before: compared", covered.state === "ok" && covered.value.clicks.value === 270 && covered.value.clicks.previous === 300 && covered.value.impressions.previous === 3000, covered.state === "ok" ? [covered.value.clicks.value, covered.value.clicks.previous] : covered);
    fake.bingTraffic = null;
    const ci = await bingApi.crawlIssues();
    check("crawlIssues spells the flags out", ci.state === "ok" && ci.value[0]!.issues.join() === "Answers 4xx,Contains malware" && ci.value[0]!.httpCode === 404, ci);
    const cs = await bingApi.crawlStats();
    check("crawlStats reads", cs.state === "ok" && cs.value[0]!.inIndex === 80 && cs.value[0]!.crawledPages === 93, cs);

    /* What counts as news. */
    fake.links["/specimen-c"] = [{ Url: "https://third.specimen.example/x", AnchorText: "third" }];
    fake.links["/specimen-d"] = [{ Url: "https://fourth.specimen.example/y", AnchorText: "fourth" }];
    fake.bingRefusesLinksOf.add("/specimen-d");
    const third = await bingApi.daily(store.today());
    check("a page linked for the first time announces its link", activityWith("Bing found a new link from third.specimen.example") === 1, third);
    check("  a page Bing will not list links for is skipped and named, not a failed run", /1 pages Bing would not answer for were skipped/.test(third) && activityWith("Bing found a new link from fourth.specimen.example") === 0, third);
    fake.bingRefusesLinksOf.delete("/specimen-d");
    const fourth = await bingApi.daily(store.today());
    check("  read at last, its link is not news: it was there all along", activityWith("Bing found a new link from fourth.specimen.example") === 0 && /none new/.test(fourth), fourth);
    check("  and it is in the desk's list from now on", bingApi.linksTo("/specimen-d").state === "ok" && (bingApi.linksTo("/specimen-d") as { value: unknown[] }).value.length === 1);
    check("the source reads connected", bingApi.status().state === "connected");
  }

  /* ============ 6. Clarity ===================================================== */
  section("6. Microsoft Clarity");
  {
    process.env.CLARITY_TOKEN = "check-clarity-token";
    check("the token makes the job ready, and nothing is kept yet", !!search.jobs[4]!.ready!() && clarity.latest().state === "waiting");
    const line = await clarity.snapshot();
    check("the snapshot asks four questions", fake.hits.clarity === 4 && clarity.callsToday() === 4 && /4 questions/.test(line), line);
    const stored = (db.prepare("SELECT COUNT(*) AS c FROM cc_clarity WHERE day = ?").get(dayIn("UTC")) as { c: number }).c;
    check("  every row Clarity sent is stored, and the line counts what was stored", stored === 20 && line.startsWith(`Snapshot taken: ${stored} rows`), [stored, line]);
    const browsers = db.prepare("SELECT n, json FROM cc_clarity WHERE metric = 'Browser' AND cut = 'url' ORDER BY n").all() as { n: number; json: string }[];
    check("  two rows of one metric for the same page are both kept, in their order", browsers.length === 2 && browsers[0]!.json.includes("SpecimenBrowserA") && browsers[1]!.json.includes("SpecimenBrowserB"), browsers);
    const again = await clarity.snapshot();
    check("running it again the same day asks nothing", fake.hits.clarity === 4 && /already in/.test(again), again);

    const u = clarity.byUrl();
    check("byUrl folds the metrics into one row per page", u.state === "ok" && u.value.rows.length === 2 && u.value.rows[0]!.path === "/specimen-a" && u.value.rows[0]!.sessions === 40 && u.value.rows[0]!.users === 30 && u.value.rows[0]!.scrollDepth === 62.5 && u.value.rows[0]!.activeTime === 45, u);
    check("  friction is a count and a share of sessions", u.state === "ok" && u.value.rows[0]!.rageClicks.count === 3 && u.value.rows[0]!.rageClicks.sessionsPct === 5 && u.value.rows[0]!.deadClicks.count === 7 && u.value.rows[0]!.errorClicks.count === 0);
    check("  what Clarity did not send is null, never zero", u.state === "ok" && u.value.rows[1]!.rageClicks.count === null && u.value.rows[1]!.totalTime === null && u.value.rows[1]!.scrollDepth === 40, u.state === "ok" ? u.value.rows[1] : u);
    const f = clarity.friction(`${SITE}/specimen-a/`);
    check("friction(url) finds the page by its path", f.state === "ok" && f.value.scriptErrors.count === 4 && f.value.quickBacks.sessionsPct === 2.5 && f.value.span === 1, f);
    check("friction for a page with no sessions says so", clarity.friction("/never-visited").state === "waiting");
    const l = clarity.latest();
    check("latest adds up the devices", l.state === "ok" && l.value.sessions === 50 && l.value.botSessions === 5 && l.value.rageClicks === 3 && l.value.deadClicks === null && l.value.callsLeft === 6, l);
    check("  and says what it is", /allowed session recording/.test(noteOf(l)) && /ten times a day/.test(noteOf(l)), noteOf(l));
    const s = clarity.bySource();
    check("bySource keeps source and medium", s.state === "ok" && s.value.rows[0]!.key === "specimen-source" && s.value.rows[0]!.key2 === "referral", s);
    const co = clarity.byCountry();
    check("byCountry reads the 'Country/Region' key", co.state === "ok" && co.value.rows[0]!.key === "Specimenland" && co.value.rows[0]!.sessions === 45, co);
    const sd = clarity.scrollDepth();
    check("scrollDepth lists pages, deepest first", sd.state === "ok" && sd.value.rows.map((r) => r.scrollDepth).join() === "62.5,40", sd);
    const et = clarity.engagementTime();
    check("engagementTime lists only pages that have one", et.state === "ok" && et.value.rows.length === 1 && et.value.rows[0]!.totalTime === 120, et);
    check("the day's totals are in the series", clarity.history(5).length === 1 && clarity.history(5)[0]!.sessions === 50 && clarity.history(5)[0]!.rageClicks === 3 && clarity.history(5)[0]!.deadClicks === null, clarity.history(5));
    check("the rows are kept exactly as sent, unknown metrics too", (db.prepare("SELECT COUNT(*) AS c FROM cc_clarity WHERE metric = 'A metric nobody has heard of'").get() as { c: number }).c === 1);
    process.env.CLARITY_PROJECT_ID = "specimen123";
    const link = clarity.deepLink("/specimen-a/");
    check("deepLink opens the project in Clarity", link.dashboard === "https://clarity.microsoft.com/projects/view/specimen123/dashboard" && link.page === `${SITE}/specimen-a`, link);
    let badLink: unknown;
    try {
      badLink = clarity.deepLink("http://[");
    } catch (e) {
      badLink = e;
    }
    check("  an address that cannot be read gives no page, and does not throw", (badLink as { page?: unknown; dashboard?: string } | null)?.page === null && !!(badLink as { dashboard?: string }).dashboard, String(badLink));

    for (let i = 0; i < 6; i++) await clarity.pull(["OS"]);
    check("ten requests are allowed", fake.hits.clarity === 10 && clarity.callsLeft() === 0);
    let refused: unknown = null;
    try {
      await clarity.pull(["OS"]);
    } catch (e) {
      refused = e;
    }
    check("THE ELEVENTH IS REFUSED, and was never sent", refused instanceof shared.SourceError && refused.kind === "quota" && /will not send another/.test(refused.message) && fake.hits.clarity === 10, String(refused));
    check("  and Clarity still reads connected: the desk holding back is not Clarity failing", clarity.status().state === "connected", clarity.status());
    store.setState("clarity.snapshot", "null");
    shared.setCount("clarity.calls", dayIn("UTC"), 7);
    const sentBefore = fake.hits.clarity;
    const reserved = await clarity.snapshot();
    check("the scheduled snapshot never spends the last two requests", /Not asked: 3 of Clarity's 10 requests are left today and 2 are kept in reserve/.test(reserved) && fake.hits.clarity === sentBefore, reserved);
  }

  /* ============ 7. CrUX ======================================================== */
  section("7. Chrome UX Report");
  {
    process.env.GOOGLE_API_KEY = "check-google-key";
    check("the key makes the job ready", !!search.jobs[5]!.ready!());
    const v = await crux.vitals("ALL", { fresh: true });
    check("vitals reads the three at the 75th percentile", v.state === "ok" && v.value.lcp?.p75 === 1800 && v.value.inp?.p75 === 120 && v.value.origin === SITE, v);
    check("  CLS arrives as a string and is read as a number", v.state === "ok" && v.value.cls?.p75 === 0.05 && v.value.cls.good === 95);
    check("  with the shares per band and the 28 days", v.state === "ok" && v.value.lcp?.good === 80 && v.value.lcp.poor === 5 && v.value.from === "2026-01-05" && v.value.to === "2026-02-01" && v.value.ttfb === null);
    check("  and is labelled as field data", /Field data/.test(noteOf(v)) && /Not a lab run/.test(noteOf(v)), noteOf(v));
    const h = await crux.history("ALL", { fresh: true });
    check("history reads the weeks; a week without data stays null", h.state === "ok" && h.value.weeks.length === 3 && h.value.weeks[0]!.lcp === 1900 && h.value.weeks[1]!.lcp === null && h.value.weeks[1]!.cls === null && h.value.weeks[2]!.cls === 0.05 && h.value.weeks[0]!.end === "2026-01-17", h);
    const done = await search.jobs[5]!.run({ progress: () => {} });
    check("the daily job writes the day's figures into the series", typeof done === "string" && store.series("crux.lcp", 2)[0]?.value === 1800 && store.series("crux.cls", 2)[0]?.value === 0.05, done);

    fake.cruxHasData = false;
    const none = (await crux.vitals("ALL", { fresh: true })) as AnyReading;
    check("no data is a fact: off, in these words, with no step", none.state === "off" && none.reason === "Google has no field data for this site yet." && none.step === undefined, none);
    check("  and the source is connected, not failing", crux.status().state === "connected", crux.status());
    const noneJob = await search.jobs[5]!.run({ progress: () => {} });
    check("  and the job says so without failing", noneJob === "Google has no field data for this site yet.", noneJob);
    fake.cruxHasData = true;
  }

  /* ============ 8. the engine's enquiries ====================================== */
  section("8. Enquiries from the engine");
  {
    process.env.ENGINE_URL = `${HERE}/engine`;
    process.env.ENGINE_READ_KEY = "check-engine-key-0123456789abcdef";
    const mark = said.length;
    const { find } = await import("../src/cc/find.ts");
    const asks = () => fake.engineAsks.length;

    const all = await leads.list();
    check("list parses the engine's rows and drops what is not a row", all.state === "ok" && all.value.length === 8, all.state === "ok" ? all.value.length : all);
    const one = all.state === "ok" ? all.value[0]! : null;
    check(
      "  a full row maps every field of the contract",
      !!one &&
        one.id === "web_specimen_1" && one.leadId === "lead_specimen_1" && one.ref === "BK-0000-0001" && one.current === true &&
        one.name === PERSON && one.company === "Specimen Works" && one.email === MAILBOX && one.phone === "+00 000 000 00 00" && one.website === "https://specimen.invalid" &&
        one.intent === "meeting" && one.services.join() === "specimen-service,other-service" && one.servicesNamed[0] === "Specimen Service" &&
        one.message === `A specimen message from ${PERSON}.` && one.firstWords === "specimen first words" && one.recommendation === "specimen recommendation" && one.links === "https://specimen.invalid/brief" &&
        one.summary?.projectType === "specimen project" && one.summary.goals[0] === "specimen goal" && one.summary.timeline === "specimen weeks" && one.summary.references === null &&
        one.page === "/specimen-a" && one.stage === "meeting_confirmed" && one.leadStatus === "meeting" && one.leadSource === "website_form",
      one,
    );
    check("  the timeline and updates keep only whole entries", !!one && one.timeline.length === 2 && one.updates.length === 1 && one.updates[0]!.by === null);
    check(
      "  the booking has its eight fields, the owner its two",
      !!one && one.booking?.cancelled === false && Object.keys(one.booking).sort().join() === "bookedAt,cancelled,cancelledAt,cancelledBy,end,meetUrl,start,startZurich" &&
        one.booking.meetUrl === "https://meet.specimen.invalid/x" && one.booking.startZurich === "2026-01-01T10:00:00+01:00" && one.booking.cancelledAt === null && !!one.booking.bookedAt &&
        one.owner?.email === "owner@specimen.invalid" && one.owner.name === "Specimen Owner",
      one?.booking,
    );
    check("  unknown fields are ignored", !!one && !("a_field_added_later" in one) && !("lead_id" in one));
    const bare = all.state === "ok" ? all.value[1]! : null;
    check(
      "  missing fields are null, a list that is not one is empty, a booking without a time is none, no message is \"\"",
      !!bare && bare.name === null && bare.company === null && bare.ref === null && bare.leadId === null && bare.website === null && bare.summary === null &&
        bare.services.length === 0 && bare.booking === null && bare.owner === null && bare.current === null && bare.message === "" && bare.leadStatus === null,
      bare,
    );
    const old = all.state === "ok" ? all.value[6]! : null;
    check("  an owner sent as a bare address is accepted; a cancelled call stays, marked", old?.owner?.email === "owner@specimen.invalid" && old.booking?.cancelled === true && old.booking.cancelledBy === "visitor" && old.current === false, old);
    const first = fake.engineAsks[0]!;
    check("the key travels as a bearer, and not one proxy header goes with it", !first.headers.some((h) => PROXY_HEADERS.includes(h)) && first.headers.includes("authorization"), first.headers);
    check("  every question carries a limit of 1 to 1,000, and a since only as an ISO time", fake.engineAsks.every((a) => Number(a.limit) >= 1 && Number(a.limit) <= 1000 && (a.since === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(a.since))), fake.engineAsks);

    const r = await leads.recent(1);
    check("recent(n) is the newest n, and says the engine holds more", r.state === "ok" && r.value.length === 1 && r.value[0]!.id === "web_specimen_1" && /holds 8 matching enquiries; the newest 1/.test(noteOf(r)), r);
    const before = asks();
    const bad = (await leads.list({ since: "last tuesday" })) as AnyReading;
    check("a since that is not a time is refused here, and the engine is not asked", bad.state === "off" && /ISO time/.test(bad.reason ?? "") && asks() === before, bad);
    await leads.list({ limit: 5000 });
    check("a limit above 1,000 is sent as 1,000", fake.engineAsks.at(-1)?.limit === "1000", fake.engineAsks.at(-1));
    const since = await leads.list({ since: hoursAgo(48) });
    check("since is passed through and the engine filters on it", since.state === "ok" && since.value.length === 3, since.state === "ok" ? since.value.map((e) => e.id) : since);

    const c7 = await leads.countsByDay("7d");
    const countsAsk = fake.engineAsks.at(-1)!;
    check("countsByDay: six this week, one the week before, from the engine's totals", c7.state === "ok" && c7.value.enquiries.value === 6 && c7.value.enquiries.previous === 1 && c7.value.days.length === 7 && c7.value.days.reduce((n, d) => n + d.value, 0) === 6, c7.state === "ok" ? c7.value.enquiries : c7);
    check("  it asked for ONE row and no since: the totals then cover the engine's whole record", countsAsk.limit === "1" && countsAsk.since === null, countsAsk);
    check("  booked calls count only the ones not cancelled", c7.state === "ok" && c7.value.booked.value === 1 && c7.value.booked.previous === 0, c7.state === "ok" ? c7.value.booked : c7);
    check("  each day carries the same day one window earlier", c7.state === "ok" && c7.value.days.every((d) => typeof d.previous === "number") && c7.value.days.reduce((n, d) => n + (d.previous ?? 0), 0) === 1);
    const c24 = await leads.countsByDay("24h");
    check("  the last day is counted to the minute, with no days to draw", c24.state === "ok" && c24.value.enquiries.value === 1 && c24.value.enquiries.previous === 2 && c24.value.days.length === 0, c24.state === "ok" ? c24.value.enquiries : c24);
    const bp = await leads.byPage("7d");
    check(
      "byPage groups by path, whatever the spelling",
      bp.state === "ok" && bp.value.length === 3 && bp.value[0]!.key === "/specimen-c" && bp.value[0]!.count === 3 && bp.value.find((x) => x.key === "/specimen-a")?.count === 1 && bp.value.find((x) => x.key === "/specimen-a")?.previous === 1 && bp.value.find((x) => x.key === "/specimen-b")?.count === 2 && bp.value[1]!.key === "/specimen-b",
      bp,
    );
    const bs = await leads.byService("7d");
    check(
      "byService counts an enquiry under each service it names",
      bs.state === "ok" && bs.value.find((x) => x.key === "specimen-service")?.count === 4 && bs.value.find((x) => x.key === "specimen-service")?.previous === 1 && bs.value.find((x) => x.key === "other-service")?.count === 1 && bs.value.find((x) => x.key === "")?.label === "No service named" && bs.value.find((x) => x.key === "")?.count === 2,
      bs,
    );
    const bst = await leads.byStage("7d");
    check("byStage reads the stage in words", bst.state === "ok" && bst.value.find((x) => x.key === "meeting_confirmed")?.label === "meeting confirmed" && bst.value.find((x) => x.key === "processed")?.count === 3 && bst.value.find((x) => x.key === "received")?.count === 2 && bst.value.find((x) => x.key === "received")?.previous === 1, bst);
    /* Where the engine's record begins: forty days back. */
    const recordStart = zurichDay(hoursAgo(40 * 24));
    const c30 = await leads.countsByDay("30d");
    const atFirst = c30.state === "ok" ? c30.value.days.find((d) => d.date === addDays(recordStart, 30)) : undefined;
    check(
      "a window before that reaches past the start of the engine's record is not compared, and says why",
      c30.state === "ok" && c30.value.enquiries.previous === null && c30.value.booked.previous === null && new RegExp(`record begins on ${recordStart}`).test(noteOf(c30)),
      c30.state === "ok" ? [c30.value.enquiries, noteOf(c30)] : c30,
    );
    check(
      "  day by day: before the record, no previous; from its first day on, the engine's count, zeros included",
      c30.state === "ok" && c30.value.from === c30.value.days[0]!.date && c30.value.days.length === 30 && c30.value.days[0]!.previous === null && atFirst?.previous === 1 && c30.value.days.at(-1)!.previous === 0,
      c30.state === "ok" ? [c30.value.days[0], atFirst, c30.value.days.at(-1)] : c30,
    );
    const c1y = await leads.countsByDay("1y");
    check("  a year against the year before, which the engine never held: not compared", c1y.state === "ok" && c1y.value.enquiries.previous === null && c1y.value.enquiries.value === 8, c1y.state === "ok" ? c1y.value.enquiries : c1y);

    /* A record that began two days ago. */
    leads.forgetAll();
    fake.engineHoldsHours = 50;
    const youngFirst = zurichDay(hoursAgo(40));
    const y7 = await leads.countsByDay("7d");
    check(
      "a record that began inside the window: the days before it are left out, not drawn as zero, and nothing is compared",
      y7.state === "ok" && y7.value.from === youngFirst && y7.value.days[0]!.date === youngFirst && y7.value.days.length < 7 && y7.value.enquiries.value === 3 && y7.value.enquiries.previous === null && y7.value.days.every((d) => d.previous === null),
      y7.state === "ok" ? [y7.value.from, y7.value.days, y7.value.enquiries] : y7,
    );
    const yp = await leads.byPage("7d");
    check("  the groups have no previous either", yp.state === "ok" && yp.value.length > 0 && yp.value.every((g) => g.previous === null) && /record begins/.test(noteOf(yp)), yp);
    leads.forgetAll();
    fake.engineHoldsHours = 0;
    const none = await leads.countsByDay("7d");
    check("  an engine that holds no enquiry yet: zero, as it says, with nothing to compare", none.state === "ok" && none.value.enquiries.value === 0 && none.value.enquiries.previous === null && /holds no enquiry yet/.test(noteOf(none)), none.state === "ok" ? none.value.enquiries : none);
    fake.engineHoldsHours = null;
    leads.forgetAll();

    const counts = JSON.stringify([c7, c24, bp, bs, bst, c30, c1y, y7, yp, none]);
    check("NO personal field leaves the count functions", !/zzyzx|specimen\.invalid|\+00 000|specimen message|specimen works|BK-0000/i.test(counts));

    /* An engine holding more than one answer carries. */
    leads.forgetAll();
    fake.engineCut = 2;
    const cutPages = (await leads.byPage("7d")) as AnyReading;
    check("when the rows are cut short inside the window, no group is counted", cutPages.state === "waiting" && /more than 1000 enquiries/.test(cutPages.reason ?? ""), cutPages);
    const cutDay = await leads.countsByDay("24h");
    check("  when only the window before is cut, it is counted with no comparison", cutDay.state === "ok" && cutDay.value.enquiries.value === 1 && cutDay.value.enquiries.previous === null && /window before is not compared/.test(noteOf(cutDay)), cutDay);
    const cutTotals = await leads.countsByDay("7d");
    check("  the totals per day are not cut: they cover every enquiry", cutTotals.state === "ok" && cutTotals.value.enquiries.value === 6);
    fake.engineCut = null;
    leads.forgetAll();

    const hits = fake.hits.engine!;
    await leads.list();
    await leads.countsByDay("7d");
    await leads.byPage("7d");
    await leads.list();
    await leads.countsByDay("7d");
    await leads.byPage("7d");
    check("within a minute the same question is not asked twice", fake.hits.engine === hits + 3, `${fake.hits.engine! - hits} asked`);
    leads.forgetAll();
    await leads.list();
    check("forgetAll drops the held answers", fake.hits.engine === hits + 4);

    /* The search box: enquiries only for a person who may see them. */
    const person = (seesLeads: boolean) => ({ name: "Specimen Reader", email: "reader@specimen.invalid", owner: false, canPublish: false, revoked: false, seesLeads, telegram: 0, author: "balkaris" }) as never;
    const asked = asks();
    const hidden = await find("zzyzx", person(false));
    check("a person who may not see leads finds none, and the engine is not even asked", !hidden.some((h) => h.kind === "lead") && asks() === asked, hidden);
    const shown = await find("specimen works", person(true));
    const lead = shown.find((h) => h.kind === "lead");
    check("a person who may finds the enquiry by company, and is sent to the Leads screen", !!lead && lead.title === PERSON && lead.href === "/leads?open=web_specimen_1" && /BK-0000-0001/.test(lead.sub ?? ""), shown);

    /* The heart of it: the enquiry is nowhere on the desk. */
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    const stained: string[] = [];
    for (const t of tables) {
      for (const rowOf of db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]) {
        const text = JSON.stringify(rowOf).toLowerCase();
        if (/zzyzx|specimen message|specimen works|\+00 000|bk-0000|specimen first words|meet\.specimen/.test(text)) stained.push(t);
      }
    }
    check(`no table of the ${tables.length} holds a trace of the enquiry`, stained.length === 0, [...new Set(stained)]);
    check("no table was made for enquiries", !tables.some((t) => /lead|enquir/i.test(t)), tables);
    check("no cache row was written for them", (db.prepare("SELECT COUNT(*) AS c FROM cc_cache WHERE key LIKE '%lead%' OR key LIKE '%enquir%' OR key LIKE '%engine%'").get() as { c: number }).c === 0);
    check("nothing about a person was printed", !said.slice(mark).some((line) => /zzyzx|specimen\.invalid|BK-0000/i.test(line)));
    check("the source reads connected", leads.status().state === "connected");
  }

  /* ============ 9. refusals, in words ========================================== */
  section("9. A 401, a 403 and a 429 from each API");
  {
    const reason = (r: AnyReading) => `${r.state}: ${r.reason ?? ""}`;

    /* Search Console */
    fake.refuse.gsc = 429;
    let r = (await gsc.queries("30d", { fresh: true })) as AnyReading;
    check("Search Console 429: the kept answer is shown, marked as kept", r.state === "ok" && /Kept from the last good read/.test(r.note ?? "") && /quota/.test(r.note ?? ""), r.note);
    check("  the source waits, it is not failing", gsc.status().state === "waiting" && /quota is used up/.test(gsc.status().error ?? ""), gsc.status());
    r = (await gsc.query({ range: "7d", dimensions: ["searchAppearance"] })) as AnyReading;
    check("  a question never asked before has nothing to show and says why", r.state === "waiting" && /quota is used up/.test(r.reason ?? ""), reason(r));
    fake.refuse.gsc = 403;
    r = (await gsc.query({ range: "7d", dimensions: ["hour"] })) as AnyReading;
    check("Search Console 403: 'may not read this property'", r.state === "waiting" && /may not read this Search Console property \(403\)/.test(r.reason ?? ""), reason(r));
    check("  and access is asked again", gsc.access().state === "unchecked");
    let a = await gsc.checkAccess();
    check("  which finds the account refused, with the step to check it", a.state === "refused" && gsc.status().state === "off" && /may not read/.test(gsc.status().error ?? "") && /still exists/.test(gsc.status().step ?? ""), gsc.status());
    fake.refuse.gsc = 401;
    a = await gsc.checkAccess();
    check("Search Console 401: 'refused the desk's service-account key'", a.state === "refused" && /refused the desk's service-account key \(401\)/.test(gsc.reasonFor(a)), gsc.reasonFor(a));
    check("  no data job runs while it is refused", !search.jobs[1]!.ready!() && !search.jobs[2]!.ready!());
    fake.refuse.gsc = 0;
    a = await gsc.checkAccess();
    check("  and it reconnects by itself when Google answers again", a.state === "ok" && gsc.status().state === "connected", gsc.status());

    /* A deleted or disabled key: Google's token service refuses it before Search Console is reached (gauth.ts throws this). */
    const realBearer = gsc.wire.bearer;
    gsc.wire.bearer = async () => {
      throw new Error("Google refused the service account key (400)");
    };
    r = (await gsc.query({ range: "7d", dimensions: ["page"], rowLimit: 7 })) as AnyReading;
    check("a key the token service turns down: the read says so, and access is asked again", r.state === "waiting" && /refused the desk's service-account key when asked for a token \(400\)/.test(r.reason ?? "") && gsc.access().state === "unchecked", reason(r));
    r = (await gsc.query({ range: "7d", dimensions: ["page"], rowLimit: 7 })) as AnyReading;
    check(
      "  which finds it refused: off, with the step to check the account and its key file, not 'failing' without a step",
      r.state === "off" && gsc.access().state === "refused" && gsc.status().state === "off" && /still exists/.test(gsc.status().step ?? "") && /when asked for a token/.test(gsc.status().error ?? ""),
      [reason(r), gsc.status()],
    );
    gsc.wire.bearer = async () => {
      throw new TypeError("fetch failed");
    };
    let unreachable = "";
    try {
      await gsc.checkAccess();
    } catch (e) {
      unreachable = e instanceof Error ? e.message : String(e);
    }
    check("  a token service that cannot be reached is the network, not the key: nothing is written down", /token service could not be reached/.test(unreachable) && gsc.access().state === "refused", unreachable);
    gsc.wire.bearer = realBearer;
    a = await gsc.checkAccess();
    check("  with the key accepted again it is connected", a.state === "ok" && gsc.status().state === "connected", gsc.status());
    fake.refuse.inspect = 429;
    let stopped = "";
    try {
      await gsc.inspectAll(store.today());
    } catch (e) {
      stopped = e instanceof Error ? e.message : String(e);
    }
    check("URL Inspection 429 ends the run and says so", /quota is used up/.test(stopped), stopped);
    fake.refuse.inspect = 0;

    /* Bing */
    for (const [status, words, state] of [
      [400, /refused the API key/, "failing"],
      [401, /refused the API key/, "failing"],
      [403, /not verified in that Bing Webmaster Tools account/, "failing"],
      [429, /asked too often/, "waiting"],
    ] as [number, RegExp, string][]) {
      fake.refuse.bing = status;
      store.forget("bing:link-counts");
      const b = (await bingApi.linkCounts({ fresh: true })) as AnyReading;
      check(`Bing ${status}${status === 400 ? " (ErrorCode 3, as documented)" : ""}: ${words.source}`, b.state === "waiting" && words.test(b.reason ?? "") && bingApi.status().state === state && words.test(bingApi.status().error ?? ""), `${reason(b)} / ${bingApi.status().state}`);
    }
    fake.refuse.bing = 0;
    check("Bing answers again and the source recovers", (await bingApi.linkCounts({ fresh: true })).state === "ok" && bingApi.status().state === "connected");

    /* Clarity: a new day's allowance, so the request is really sent */
    for (const [status, words, state] of [
      [401, /missing, mistyped or expired/, "failing"],
      [403, /not allowed to export/, "failing"],
      [429, /today's ten requests are used/, "waiting"],
    ] as [number, RegExp, string][]) {
      fake.refuse.clarity = status;
      shared.setCount("clarity.calls", dayIn("UTC"), 0);
      let said2 = "";
      try {
        await clarity.pull(["OS"]);
      } catch (e) {
        said2 = e instanceof Error ? e.message : String(e);
      }
      check(`Clarity ${status}: ${words.source}`, words.test(said2) && clarity.status().state === state && words.test(clarity.status().error ?? ""), `${said2} / ${clarity.status().state}`);
    }
    check("  after Clarity's own 429 the desk sends nothing more today", clarity.callsLeft() === 0);
    fake.refuse.clarity = 0;
    check("  what was kept is still readable while Clarity refuses", clarity.byUrl().state === "ok");

    /* CrUX */
    for (const [status, words, state] of [
      [401, /API key is not valid/, "failing"],
      [403, /refused the API key/, "failing"],
      [429, /asked too often/, "waiting"],
    ] as [number, RegExp, string][]) {
      fake.refuse.crux = status;
      store.forget("crux:");
      const c = (await crux.vitals("ALL", { fresh: true })) as AnyReading;
      check(`CrUX ${status}: ${words.source}`, c.state === "waiting" && words.test(c.reason ?? "") && crux.status().state === state, `${reason(c)} / ${crux.status().state}`);
    }
    fake.refuse.crux = 0;
    process.env.GOOGLE_API_KEY = "a-wrong-key";
    const bad = (await crux.vitals("ALL", { fresh: true })) as AnyReading;
    check("CrUX 400 with API_KEY_INVALID, as Google sends a bad key", bad.state === "waiting" && /API key is not valid/.test(bad.reason ?? ""), reason(bad));
    process.env.GOOGLE_API_KEY = "check-google-key";
    check("CrUX answers again and the source recovers", (await crux.vitals("ALL", { fresh: true })).state === "ok" && crux.status().state === "connected", crux.status());

    /* the engine */
    /* A shut door or a refused key waits for a person, so the reading is off with the mint step; a 429 or a 502 passes by itself and waits. */
    for (const [status, words, readingState, state] of [
      [401, /refused the desk's key \(401\)/, "off", "failing"],
      [403, /refused the desk \(403\)/, "off", "failing"],
      [404, /answered 404: DESK_READ_KEY is not set on the engine, the route is not deployed yet, or the request did not come straight from the box/, "off", "failing"],
      [429, /asked too often/, "waiting", "waiting"],
      [502, /could not read its own enquiries \(502\), so how many there are is unknown/, "waiting", "failing"],
    ] as [number, RegExp, string, string][]) {
      fake.refuse.engine = status;
      leads.forgetAll();
      const e = (await leads.countsByDay("7d")) as AnyReading;
      const stepOk = readingState === "off" ? /mint-desk-key\.sh/.test(e.step ?? "") : e.step === undefined;
      check(`engine ${status}: ${words.source}`, e.state === readingState && stepOk && words.test(e.reason ?? "") && e.value === undefined && leads.status().state === state, `${reason(e)} / ${leads.status().state}`);
    }
    fake.refuse.engine = 401;
    leads.forgetAll();
    const refusedRows = (await leads.list()) as AnyReading;
    check("  rows refused are no rows, and the refusal a person can mend carries the mint step", refusedRows.state === "off" && refusedRows.value === undefined && /mint-desk-key\.sh/.test(leads.status().step ?? ""), [refusedRows.state, leads.status()]);
    fake.refuse.engine = 0;
    leads.forgetAll();
    check("the engine answers again and the source recovers", (await leads.countsByDay("7d")).state === "ok" && leads.status().state === "connected");

    const st = sources.sources();
    check("in the end every source is connected or waiting, none failing", st.every((s) => s.state === "connected" || s.state === "waiting"), st.map((s) => `${s.id}:${s.state}`));
    check("and nothing is left for the owner to do", search.ownerSteps().length === 0, search.ownerSteps());
  }

  /* ============ 9b. one day for a movement, on the collector and on the screen ============ */
  section("9b. The day a movement can first be measured, as the screen's own gate names it");
  {
    const seoRoutes = await import("../src/cc/routes/seo.ts");
    const t = sameDay?.totals;
    const gate =
      t?.state === "ok"
        ? seoRoutes.moversRead({ totals: t, movers: { state: "ok", value: { window: t.value.window, floor: 30, rows: [] }, source: "gsc", asOf: new Date().toISOString() } } as unknown as Parameters<typeof seoRoutes.moversRead>[0])
        : null;
    check(
      "once the window before holds queries, the screen's gate names the day the collector promised (3b, 90 days)",
      !!sameDay && gate?.state === "waiting" && gate.reason.includes(`reach ${sameDay.promised}`) && /do not cover the period this one is measured against/.test(gate.reason),
      gate ?? sameDay,
    );
  }
} catch (e) {
  failedChecks++;
  console.log(`\n  FAIL the check itself threw: ${e instanceof Error ? e.stack : String(e)}`);
} finally {
  server.close();
  server.closeAllConnections();
  try {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows keeps the file a moment longer; the temp folder is cleaned by the system. */
  }
}

console.log(`\n${passed} passed, ${failedChecks} failed`);
process.exit(failedChecks ? 1 : 0);
