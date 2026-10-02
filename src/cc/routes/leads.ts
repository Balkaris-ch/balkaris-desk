import { Hono, type Context } from "hono";
import { me, type Vars } from "../access.ts";
import {
  byFirstMove,
  byPage,
  byService,
  byStage,
  countsByDay,
  list as enquiryList,
  MINT_LINE,
  movedOn,
  returning,
  status as engineStatus,
  type Enquiry,
  type EnquiryCounts,
  type Group,
} from "../leads.ts";
import { addDays, dayIn, pathOf, SPAN } from "../search/shared.ts";
import { inventory, KIND_LABEL, type PageKind } from "../site/index.ts";
import { specimenAllowed } from "../specimen.ts";
import { off, ok, reading, today } from "../store.ts";
import type { Range, Reading, SourceStatus, Stat } from "../../../web/src/contract/common.ts";
import type {
  LeadsCall,
  LeadsDays,
  LeadsDetail,
  LeadsFilters,
  LeadsGroups,
  LeadsList,
  LeadsPage,
  LeadsPayload,
  LeadsRow,
  LeadStage,
} from "../../../web/src/contract/leads.ts";

/**
 * /api/v1/leads — the Leads screen.
 *
 * Every enquiry is read from the engine (src/cc/leads.ts, which holds each
 * answer in memory for at most a minute) and nothing about one is kept here:
 * not in the database, not in a log line, not in a cache entry. Two kinds of
 * figure leave this file:
 *
 *   counts   the tiles, the day chart, By page, By service, By stage. They
 *            come from the collector's count functions, which hand out no
 *            personal field, so everybody signed in receives them.
 *   rows     the list and the open enquiry. They are read only when the
 *            person may see leads (Person.seesLeads); for anybody else the
 *            engine is not even asked for them.
 *
 * ?specimen=1 (only where specimenAllowed says so: a workstation with the
 * development sign-in) feeds every panel from SPECIMEN_* below instead of the
 * engine, so the connected screen can be looked at before the key exists.
 */
export const routes = new Hono<Vars>();

/* ---------- words ------------------------------------------------------------ */

const RANGES: readonly Range[] = ["7d", "30d", "90d", "1y"];
const ZURICH = "Europe/Zurich";

/** The engine's stages, in order, as a person says them. */
const STAGES: readonly LeadStage[] = ["received", "processed", "expert_assigned", "meeting_confirmed", "proposal_in_preparation", "proposal_ready"];
const STAGE_LABEL: Record<LeadStage, string> = {
  received: "Received",
  processed: "Processed",
  expert_assigned: "Expert assigned",
  meeting_confirmed: "Meeting confirmed",
  proposal_in_preparation: "Proposal in preparation",
  proposal_ready: "Proposal ready",
};
const isStage = (s: string | null | undefined): s is LeadStage => !!s && (STAGES as readonly string[]).includes(s);
const stageLabel = (s: string | null): string => (isStage(s) ? STAGE_LABEL[s] : s ? s.replace(/_/g, " ") : "No stage");

/** Where the engine's own interface opens one lead: the address its calendar invitations carry (engine src/website-booking.ts, leadLink). */
const engineHref = (leadId: string | null): string | null => (leadId ? `https://operation.balkaris.ch/#campaignleads?lead=${encodeURIComponent(leadId)}` : null);

/** The step every absent panel points at: the banner at the top of the screen carries the line itself. */
const SEE_TOP = "The owner runs the one line shown at the top of this screen.";

const ACCESS =
  "Names, contact details and messages of enquiries are shown only to people the owner has allowed to see them. The owner can change that in Settings.";

/** The facts that belong beside every figure on this screen, from the engine's contract. */
const FACTS = [
  "Read from the engine, at most a minute ago; nothing about an enquiry is kept on the desk.",
  "A floor, not an audited total: an enquiry from a suppressed sender is never stored, and the engine keeps each lead's current enquiry and the five before it.",
  "The page is the one the form was sent from. No traffic source, referrer or campaign is recorded with an enquiry.",
  "No value, budget or deal amount is recorded with an enquiry.",
  "The address shown is the lead's: the engine keeps one per lead, not one per enquiry.",
  "A booked call counts on the day its enquiry came in, while it is not cancelled.",
];

/** At most this many rows are sent to the list; the filters narrow the rest. */
const CAP = 250;

/* ---------- the question ------------------------------------------------------ */

const rangeOf = (raw: string | undefined): Range => RANGES.find((r) => r === raw?.toLowerCase()) ?? "30d";

function filtersOf(c: Context<Vars>): LeadsFilters {
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const stage = c.req.query("stage") ?? "";
  const group = (c.req.query("group") ?? "").trim();
  const call = c.req.query("call") ?? "";
  return {
    q,
    stage: isStage(stage) ? stage : "",
    group: /^[\w-]{1,40}$/.test(group) ? group : "",
    call: call === "booked" || call === "cancelled" || call === "none" ? call : "",
  };
}

/** The Zurich days of a range, ending today: the same window the collector counts in. */
function windowOf(range: Range): { start: string; end: string } {
  const end = today();
  return { start: addDays(end, -(SPAN[range] - 1)), end };
}

const inWindow = (at: string | null, w: { start: string; end: string }): boolean => {
  if (!at) return false;
  const day = dayIn(ZURICH, Date.parse(at));
  return day >= w.start && day <= w.end;
};

/* ---------- pages and their groups -------------------------------------------- */

type Kinds = (path: string) => PageKind | null;

/** The crawl's kind for each address it knows. Without a crawl every page is "not in the crawl". */
function crawlKinds(): Kinds {
  const inv = inventory();
  const by = new Map(inv.state === "ok" ? inv.value.map((p) => [p.path, p.kind] as const) : []);
  return (path) => by.get(path) ?? null;
}

function pageOf(raw: string | null, kinds: Kinds): LeadsPage {
  if (!raw) return { path: null, group: "none", groupLabel: "Page not recorded" };
  const path = pathOf(raw);
  const kind = kinds(path);
  return kind ? { path, group: kind, groupLabel: KIND_LABEL[kind] } : { path, group: "unknown", groupLabel: "Not in the crawl" };
}

const pageHref = (path: string): string => `/pages/view?path=${encodeURIComponent(path)}`;

/* ---------- one enquiry, as the screen shows it ------------------------------------ */

const callOf = (e: Enquiry): LeadsCall | null =>
  e.booking
    ? {
        start: e.booking.start,
        end: e.booking.end,
        meetUrl: e.booking.meetUrl,
        bookedAt: e.booking.bookedAt,
        cancelled: e.booking.cancelUnknown ? null : e.booking.cancelled,
        cancelledAt: e.booking.cancelledAt,
        cancelledBy: e.booking.cancelledBy,
        with: e.owner?.name ?? e.owner?.email ?? null,
      }
    : null;

const time = (at: string | null): number => (at ? Date.parse(at) : Number.NaN);

/** True when the same lead sent an enquiry before this one. */
const isReturning = (e: Enquiry, all: readonly Enquiry[]): boolean =>
  !!e.leadId && all.some((o) => o !== e && o.leadId === e.leadId && time(o.capturedAt) < time(e.capturedAt));

function rowOf(e: Enquiry, all: readonly Enquiry[], kinds: Kinds): LeadsRow {
  return {
    id: e.id ?? "",
    leadId: e.leadId,
    ref: e.ref,
    receivedAt: e.capturedAt,
    name: e.name,
    company: e.company,
    email: e.email,
    services: e.servicesNamed.length ? e.servicesNamed : e.services,
    intent: e.intent,
    page: pageOf(e.page, kinds),
    stage: e.stage,
    call: callOf(e),
    returning: isReturning(e, all),
  };
}

/** `specimen`: the enquiry is made up, so it has no lead in the engine to link to. */
function detailOf(e: Enquiry, all: readonly Enquiry[], kinds: Kinds, specimen: boolean): LeadsDetail {
  const others = all
    .filter((o) => o !== e && !!e.leadId && o.leadId === e.leadId)
    .sort((a, b) => (time(b.capturedAt) || 0) - (time(a.capturedAt) || 0))
    .map((o) => ({
      id: o.id ?? "",
      ref: o.ref,
      receivedAt: o.capturedAt,
      services: o.servicesNamed.length ? o.servicesNamed : o.services,
      intent: o.intent,
      stage: o.stage,
      current: o.current === true,
    }));
  return {
    ...rowOf(e, all, kinds),
    phone: e.phone,
    website: e.website,
    message: e.message,
    firstWords: e.firstWords,
    recommendation: e.recommendation,
    links: e.links,
    summary: e.summary,
    timeline: e.timeline,
    updates: e.updates,
    current: e.current,
    leadStatus: e.leadStatus,
    leadSource: e.leadSource,
    others,
    engineHref: specimen ? null : engineHref(e.leadId),
  };
}

/* ---------- the list ---------------------------------------------------------------- */

/** Lower case, accents dropped: "Müller" is found by "muller". */
const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A search word, matched where a word starts: "k" finds "Person K" and "k@…", not the k inside "breaks". */
function wordStart(word: string): RegExp {
  const literal = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?:^|[^\\p{L}\\p{N}])" + literal, "u");
}

/** The label of a page group the list's filter may name. */
function groupLabel(group: string): string {
  if (group === "none") return "Page not recorded";
  if (group === "unknown") return "Not in the crawl";
  return (KIND_LABEL as Record<string, string>)[group] ?? group;
}

function listOf(all: readonly Enquiry[], range: Range, f: LeadsFilters, kinds: Kinds): LeadsList {
  const w = windowOf(range);
  const rows = all.filter((e) => e.id && inWindow(e.capturedAt, w)).map((e) => rowOf(e, all, kinds));
  const words = fold(f.q).split(/\s+/).filter(Boolean).slice(0, 6);
  const tests = words.map((word) => ({ word, at: wordStart(word) }));
  const message = new Map(all.map((e) => [e.id, e.message] as const));

  const matched = rows.filter((r) => {
    if (f.stage && r.stage !== f.stage) return false;
    if (f.group && r.page.group !== f.group) return false;
    if (f.call === "booked" && r.call?.cancelled !== false) return false;
    if (f.call === "cancelled" && r.call?.cancelled !== true) return false;
    if (f.call === "none" && r.call) return false;
    if (!tests.length) return true;
    /* Who it is, and what it is about. A single letter is looked for only in
       who it is (an initial, a reference): in a whole message it starts some
       word or other in nearly every enquiry. */
    const who = fold([r.name, r.company, r.email, r.ref].filter(Boolean).join(" "));
    const about = fold([r.page.path, ...r.services, message.get(r.id)].filter(Boolean).join(" "));
    return tests.every(({ word, at }) => at.test(who) || (word.length > 1 && at.test(about)));
  });

  /* The selects offer what the range holds, and always what a filter applies,
     so a filter carried over from another range is seen, and can be undone. */
  const stages = STAGES.filter((s) => s === f.stage || rows.some((r) => r.stage === s)).map((s) => ({ value: s as string, label: STAGE_LABEL[s] }));
  const present = new Map(rows.map((r) => [r.page.group, r.page.groupLabel]));
  if (f.group && !present.has(f.group)) present.set(f.group, groupLabel(f.group));
  const groups = [...present.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));

  return {
    rows: matched.slice(0, CAP),
    total: rows.length,
    matched: matched.length,
    cap: matched.length > CAP ? CAP : null,
    filters: f,
    options: { stages, groups },
  };
}

/* ---------- counts into panels ------------------------------------------------------- */

/** A reading's value through `fn`, keeping its source, age and note; a reading without a value stays as it is. */
function mapped<T, U>(r: Reading<T>, fn: (v: T) => U): Reading<U> {
  return r.state === "ok" ? { ...r, value: fn(r.value) } : r;
}

/**
 * An absent engine reading on this screen points at the banner instead of
 * repeating the whole line: the banner carries it, with its Copy button, both
 * while the desk has no key (Connect) and when the engine refuses the key it
 * has (Failing, which shows the line whenever the status has a step).
 */
function pointed<T>(r: Reading<T>, st: SourceStatus): Reading<T> {
  const banner = st.state === "off" || (st.state === "failing" && !!st.step);
  return r.state === "off" && r.source === "engine" && banner ? { ...r, step: SEE_TOP } : r;
}

function groupsOf(r: Reading<Group[]>, of: Reading<number>, href?: (key: string) => string | undefined): Reading<LeadsGroups> {
  if (r.state !== "ok") return r;
  return {
    ...r,
    value: {
      /* A group the collector made for the window before alone has nothing in this range: it is not a row of this panel. */
      groups: r.value.filter((g) => g.count > 0).map((g) => ({ key: g.key, label: g.label, count: g.count, ...(href?.(g.key) ? { href: href(g.key) } : {}) })),
      of: of.state === "ok" ? of.value : r.value.reduce((n, g) => n + g.count, 0),
    },
  };
}

/** By stage in the engine's order, every stage named in plain words. */
function stagesOf(r: Reading<Group[]>): Reading<Group[]> {
  return mapped(r, (groups) => {
    const rank = (k: string) => (isStage(k) ? STAGES.indexOf(k) : STAGES.length);
    return [...groups].sort((a, b) => rank(a.key) - rank(b.key) || b.count - a.count).map((g) => ({ ...g, label: stageLabel(g.key || null) }));
  });
}

/** Of the enquiries in the range, how many are in the group `key` of `r`. A part of a whole as it stands today: no period before. */
function partTile(r: Reading<Group[]>, key: string): Reading<Stat> {
  return mapped(r, (groups) => ({
    value: groups.find((g) => g.key === key)?.count ?? 0,
    previous: null,
    unit: "count" as const,
    series: [],
    of: groups.reduce((n, g) => n + g.count, 0),
  }));
}

/** The day chart's points, and the day the engine's record begins when the range reaches back past it. */
function daysOf(r: Reading<EnquiryCounts>, range: Range): Reading<LeadsDays> {
  const start = windowOf(range).start;
  return mapped(r, (c) => {
    const first = c.days[0]?.date ?? null;
    return { days: c.days.map((d) => ({ date: d.date, enquiries: d.value, booked: d.booked })), recordBegins: first && first > start ? first : null };
  });
}

interface Counts {
  counts: Reading<EnquiryCounts>;
  pages: Reading<Group[]>;
  services: Reading<Group[]>;
  stages: Reading<Group[]>;
  /** byFirstMove: "waiting" and "moved". */
  moves: Reading<Group[]>;
  returning: Reading<Stat>;
}

function panels(c: Counts, range: Range, st: SourceStatus): Pick<LeadsPayload, "tiles" | "perDay" | "byPage" | "byService" | "byStage"> {
  const total = mapped(c.counts, (v) => v.enquiries.value);
  const stages = stagesOf(c.stages);
  const p = <T>(r: Reading<T>) => pointed(r, st);
  return {
    tiles: {
      enquiries: p(mapped(c.counts, (v) => v.enquiries)),
      booked: p(mapped(c.counts, (v) => v.booked)),
      awaiting: p(partTile(c.moves, "waiting")),
      talking: p(partTile(c.moves, "moved")),
      returning: p(c.returning),
    },
    perDay: p(daysOf(c.counts, range)),
    byPage: p(groupsOf(c.pages, total, (key) => (key ? pageHref(key) : undefined))),
    byService: p(groupsOf(c.services, total)),
    byStage: p(groupsOf(stages, total)),
  };
}

/* ---------- the screen -------------------------------------------------------------- */

routes.get("/", async (c) => {
  const who = me(c);
  const range = rangeOf(c.req.query("range"));
  const filters = filtersOf(c);
  const openId = (c.req.query("open") ?? "").trim().slice(0, 120);
  const specimen = specimenAllowed(c);
  const kinds = crawlKinds();

  let counts: Counts;
  let rows: Reading<Enquiry[]>;

  if (specimen) {
    const all = specimenRows();
    counts = specimenCounts(range, all);
    rows = ok(all, "engine", new Date().toISOString(), SPECIMEN_NOTE);
  } else {
    /* Each panel is read on its own, so one refusal costs one panel. The
       collector asks the engine at most once a minute per question. */
    const [cnt, pages, services, stages, moves, back] = await Promise.all([
      reading("engine", () => countsByDay(range)),
      reading("engine", () => byPage(range)),
      reading("engine", () => byService(range)),
      reading("engine", () => byStage(range)),
      reading("engine", () => byFirstMove(range)),
      reading("engine", () => returning(range)),
    ]);
    counts = { counts: cnt, pages, services, stages, moves, returning: back };
    /* Rows only for a person who may see them: for anybody else the engine is not asked. */
    rows = who.seesLeads ? await reading("engine", () => enquiryList({ limit: 1000 })) : off("engine", ACCESS);
  }

  /* After the reads, so a refusal met just now is in it. */
  const status = engineStatus();
  const list: Reading<LeadsList> = !who.seesLeads ? off("engine", ACCESS) : pointed(mapped(rows, (all) => listOf(all, range, filters, kinds)), status);

  let open: Reading<LeadsDetail> | null = null;
  if (openId) {
    if (!who.seesLeads) open = off("engine", ACCESS);
    else if (rows.state !== "ok") open = pointed<LeadsDetail>(rows, status);
    else {
      const hit = rows.value.find((e) => e.id === openId);
      open = hit
        ? { ...rows, value: detailOf(hit, rows.value, kinds, specimen) }
        : off(rows.source, "The engine holds no enquiry with that id any more, or it is older than the newest thousand it sends.");
    }
  }

  return c.json<LeadsPayload>({
    range,
    specimen,
    viewer: { seesLeads: who.seesLeads, owner: who.owner },
    engine: { status, line: MINT_LINE },
    ...panels(counts, range, status),
    list,
    open,
    facts: FACTS,
  });
});

/* ===================================================================================
 * SPECIMEN DATA. Made up, and made to look made up: nobody here exists. Used only
 * when specimenAllowed(c) is true, which it never is on desk.balkaris.ch.
 * The pages are real addresses of the website when the crawl knows them, so the
 * page links and the page-group filter can be tried; everything else is invented.
 * =================================================================================== */

const SPECIMEN_NOTE = "Specimen data: made-up enquiries for looking at this screen before the engine is connected. None of it is real.";

const SPECIMEN_SERVICES = [
  { slug: "specimen-a", named: "Specimen service A" },
  { slug: "specimen-b", named: "Specimen service B" },
  { slug: "specimen-c", named: "Specimen service C" },
  { slug: "specimen-d", named: "Specimen service D" },
];

/** One page per kind the crawl knows, in this order; invented addresses without a crawl. */
function specimenPages(): string[] {
  const inv = inventory();
  const order: PageKind[] = ["home", "landing", "segment", "article", "service", "standard", "case"];
  const picked =
    inv.state === "ok"
      ? order.flatMap((k) => {
          const hit = inv.value.find((p) => p.kind === k && p.status === 200);
          return hit ? [hit.path] : [];
        })
      : [];
  return picked.length >= 3 ? picked : ["/specimen-page-a", "/specimen-page-b", "/specimen-page-c"];
}

interface SpecimenSeed {
  /** Letter of the specimen person. */
  who: string;
  /** Days before today (Zurich) the enquiry came in, and the hour (UTC). */
  ago: number;
  hour: number;
  stage: LeadStage;
  intent: "quote" | "talk" | "meeting";
  services: number[];
  /** Index into specimenPages(), or -1 for no page. */
  page: number;
  /** Days after it came in that the call was booked for, and whether it was cancelled. */
  call?: { after: number; cancelled?: boolean };
  /** An earlier enquiry of the same specimen person: days before today. */
  before?: number;
  company?: boolean;
  /** Nobody has touched it in the engine: its only stages are the ones the engine sets itself (received, and meeting confirmed from the visitor's booking). */
  untouched?: boolean;
}

const SPECIMEN_SEEDS: SpecimenSeed[] = [
  { who: "A", ago: 0, hour: 8, stage: "received", intent: "quote", services: [0], page: 1, company: true },
  { who: "B", ago: 1, hour: 13, stage: "received", intent: "talk", services: [1, 2], page: 0 },
  { who: "C", ago: 2, hour: 9, stage: "meeting_confirmed", intent: "meeting", services: [0], page: 2, call: { after: 3 }, before: 48, company: true, untouched: true },
  { who: "D", ago: 3, hour: 15, stage: "processed", intent: "quote", services: [2], page: 3, company: true },
  { who: "E", ago: 5, hour: 10, stage: "expert_assigned", intent: "talk", services: [1], page: 1 },
  { who: "F", ago: 6, hour: 7, stage: "received", intent: "meeting", services: [3], page: -1, call: { after: 2, cancelled: true }, company: true, untouched: true },
  { who: "G", ago: 8, hour: 12, stage: "proposal_in_preparation", intent: "quote", services: [0, 3], page: 4, company: true },
  { who: "H", ago: 11, hour: 16, stage: "meeting_confirmed", intent: "meeting", services: [2], page: 0, call: { after: 1 }, company: true },
  { who: "I", ago: 13, hour: 9, stage: "processed", intent: "talk", services: [], page: 2 },
  { who: "J", ago: 16, hour: 11, stage: "proposal_ready", intent: "quote", services: [0], page: 1, call: { after: 2 }, before: 22, company: true },
  { who: "K", ago: 19, hour: 14, stage: "received", intent: "quote", services: [1], page: 5 },
  { who: "L", ago: 24, hour: 8, stage: "expert_assigned", intent: "meeting", services: [3], page: 0, call: { after: 4 }, company: true },
  { who: "M", ago: 27, hour: 17, stage: "processed", intent: "talk", services: [2], page: 3, company: true },
  { who: "N", ago: 34, hour: 10, stage: "proposal_ready", intent: "quote", services: [0, 1], page: 2, call: { after: 2 }, company: true },
  { who: "O", ago: 41, hour: 13, stage: "processed", intent: "talk", services: [1], page: 1 },
  { who: "P", ago: 57, hour: 9, stage: "meeting_confirmed", intent: "meeting", services: [2], page: 4, call: { after: 3 }, company: true },
  { who: "Q", ago: 73, hour: 15, stage: "received", intent: "quote", services: [3], page: 0 },
];

/** An ISO time `days` before today's Zurich date at `hour` UTC. */
const specimenAt = (days: number, hour: number, minute = 0): string => `${addDays(today(), -days)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
const plus = (iso: string, hours: number): string => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();

function specimenEnquiry(s: SpecimenSeed, n: number, pages: string[], earlier: boolean): Enquiry {
  const at = specimenAt(earlier ? s.before! : s.ago, s.hour, 12);
  const stage: LeadStage = earlier ? "proposal_ready" : s.stage;
  const services = s.services.map((i) => SPECIMEN_SERVICES[i]!);
  const callAt = s.call && !earlier ? specimenAt(s.ago - s.call.after, 12) : null;
  /* Untouched: received, then the visitor's own booking (and, when they
     cancelled it, the stage falls back and the engine notes the cancellation).
     Otherwise every stage up to the current one, as a founder would set them. */
  const untouched = !earlier && !!s.untouched;
  const reached: LeadStage[] = untouched ? (callAt ? ["received", "meeting_confirmed"] : ["received"]) : STAGES.slice(0, STAGES.indexOf(stage) + 1);
  const updates: Enquiry["updates"] = untouched
    ? s.call?.cancelled
      ? [{ at: plus(at, 20), text: `Specimen note ${s.who}: the call was cancelled.`, by: "the visitor" }]
      : []
    : STAGES.indexOf(stage) >= 2
      ? [{ at: plus(at, 6), text: `Specimen update ${s.who}: a line the visitor reads on their status page.`, by: "Specimen Owner" }]
      : [];
  return {
    id: `web_specimen_${s.who.toLowerCase()}${earlier ? "_earlier" : ""}`,
    leadId: `specimen-lead-${s.who.toLowerCase()}`,
    ref: `BK-SPEC-${String(n).padStart(4, "0")}`,
    capturedAt: at,
    current: !earlier,
    name: `Specimen Person ${s.who}`,
    company: s.company ? `Specimen Company ${s.who}` : null,
    email: `person-${s.who.toLowerCase()}@specimen.invalid`,
    phone: s.company ? `+00 00 000 00 ${String(n).padStart(2, "0")}` : null,
    website: s.company ? `https://specimen-${s.who.toLowerCase()}.invalid` : null,
    intent: s.intent,
    services: services.map((x) => x.slug),
    servicesNamed: services.map((x) => x.named),
    message: earlier
      ? `Specimen message, an earlier enquiry of Specimen Person ${s.who}. It stands where a visitor's own words would be.`
      : `Specimen message ${s.who}. It stands where a visitor's own words would be: what they want made, for whom, and by when.\n\nA second paragraph, so that a long message can be seen wrapping and keeping its breaks.`,
    firstWords: s.who === "A" || s.who === "C" ? `Specimen first words ${s.who}, as typed to the website's guide.` : null,
    recommendation: null,
    links: s.company ? `https://specimen-${s.who.toLowerCase()}.invalid/profile` : null,
    summary: s.company
      ? { projectType: `Specimen project type ${s.who}`, goals: [`Specimen goal ${s.who}1`, `Specimen goal ${s.who}2`], timeline: "Specimen timeline", references: null }
      : null,
    page: s.page >= 0 ? (pages[s.page % pages.length] ?? null) : null,
    stage,
    timeline: reached.map((st, i) => ({ stage: st, at: plus(at, i * 4) })),
    updates,
    booking: callAt
      ? {
          start: callAt,
          end: plus(callAt, 0.5),
          startZurich: null,
          meetUrl: `https://specimen.invalid/meet/${s.who.toLowerCase()}`,
          bookedAt: plus(at, 0.1),
          cancelled: !!s.call?.cancelled,
          cancelledAt: s.call?.cancelled ? plus(at, 20) : null,
          cancelledBy: s.call?.cancelled ? "the visitor" : null,
        }
      : null,
    owner: callAt ? { email: "owner@specimen.invalid", name: "Specimen Owner" } : null,
    leadStatus: earlier ? "client" : "new",
    leadSource: "website_form",
  };
}

/** Every specimen enquiry, newest first, as the engine would send them. */
function specimenRows(): Enquiry[] {
  const pages = specimenPages();
  const out: Enquiry[] = [];
  SPECIMEN_SEEDS.forEach((s, i) => {
    out.push(specimenEnquiry(s, i + 1, pages, false));
    if (s.before !== undefined) out.push(specimenEnquiry(s, i + 101, pages, true));
  });
  return out.sort((a, b) => Date.parse(b.capturedAt!) - Date.parse(a.capturedAt!));
}

/** The collector's counts, worked out from the specimen rows the way the collector works them out from the engine's. */
function specimenCounts(range: Range, all: Enquiry[]): Counts {
  const span = SPAN[range];
  const w = windowOf(range);
  const before = { start: addDays(w.start, -span), end: addDays(w.start, -1) };
  const day = (e: Enquiry) => dayIn(ZURICH, Date.parse(e.capturedAt!));
  const first = all.map(day).sort()[0]!;
  const compared = first <= before.start;
  const now = all.filter((e) => inWindow(e.capturedAt, w));
  const then = all.filter((e) => inWindow(e.capturedAt, before));
  const booked = (e: Enquiry) => !!e.booking && !e.booking.cancelled && !e.booking.cancelUnknown;
  const asOf = new Date().toISOString();
  const note = SPECIMEN_NOTE;
  /* Stamped as the engine, as the connected screen will be; the note (the stamp's tooltip) says it is specimen. */
  const src = "engine" as const;

  const from = first > w.start ? first : w.start;
  const days: EnquiryCounts["days"] = [];
  for (let d = from; d <= w.end; d = addDays(d, 1)) {
    const p = addDays(d, -span);
    const on = all.filter((e) => day(e) === d);
    const was = all.filter((e) => day(e) === p);
    days.push({ date: d, value: on.length, previous: p >= first ? was.length : null, booked: on.filter(booked).length });
  }
  const counts: EnquiryCounts = {
    enquiries: { value: now.length, previous: compared ? then.length : null, unit: "count", series: days.map((d) => d.value) },
    booked: { value: now.filter(booked).length, previous: compared ? then.filter(booked).length : null, unit: "count", series: days.map((d) => d.booked) },
    from,
    days,
  };

  const group = (keys: (e: Enquiry) => { key: string; label: string }[]): Reading<Group[]> => {
    const by = new Map<string, Group>();
    for (const e of now)
      for (const k of keys(e)) {
        const g = by.get(k.key) ?? { key: k.key, label: k.label, count: 0, previous: null };
        g.count++;
        by.set(k.key, g);
      }
    return ok([...by.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)), src, asOf, note);
  };

  const leads = new Map<string, Enquiry[]>();
  for (const e of all) leads.set(e.leadId!, [...(leads.get(e.leadId!) ?? []), e]);
  const back = (win: { start: string; end: string }) =>
    [...leads.values()].filter((list) => [...list].sort((a, b) => Date.parse(a.capturedAt!) - Date.parse(b.capturedAt!)).some((e, i) => i > 0 && inWindow(e.capturedAt, win))).length;

  return {
    counts: ok(counts, src, asOf, note),
    pages: group((e) => [e.page ? { key: pathOf(e.page), label: pathOf(e.page) } : { key: "", label: "Page not recorded" }]),
    services: group((e) => (e.services.length ? e.services.map((key, i) => ({ key, label: e.servicesNamed[i] ?? key })) : [{ key: "", label: "No service named" }])),
    stages: group((e) => [{ key: e.stage ?? "", label: e.stage ?? "No stage" }]),
    /* The collector's byFirstMove, by the same rule (movedOn). */
    moves: group((e) => [movedOn(e) ? { key: "moved", label: "Moved on by Balkaris" } : { key: "waiting", label: "Nothing done in the engine yet" }]),
    returning: ok({ value: back(w), previous: compared ? back(before) : null, unit: "count", series: [] }, src, asOf, note),
  };
}
