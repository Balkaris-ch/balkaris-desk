import { Hono } from "hono";
import { me, requireOwner, type Vars } from "../../access.ts";
import * as ga4 from "../../ga4.ts";
import { hasKey } from "../../gauth.ts";
import { status as jobStatus } from "../../scheduler.ts";
import * as bing from "../../search/bing.ts";
import { addDays } from "../../search/shared.ts";
import { sources } from "../../sources.ts";
import { off, ok, reading, today, waiting } from "../../store.ts";
import type { ApiError, Reading, SourceId } from "../../../../web/src/contract/common.ts";
import type { NewTask } from "../../../../web/src/contract/operator.ts";
import type {
  AiCheckRow,
  AiChecks,
  AiCrawlers,
  AiEngine,
  AiLever,
  AiListings,
  AiReferrals,
  AiRound,
  CitedListing,
  ImportStep,
  ManualImport,
  NewAiCheck,
  PageReadinessAnswer,
  Readiness,
  ReadinessCheck,
  ReadinessTally,
  RecordAnswer,
  SeoAiSearchPayload,
} from "../../../../web/src/contract/seo/ai-search.ts";
import type { ProfileRow } from "../../../../web/src/contract/seo/backlinks.ts";
import type { OpportunityRow, OpportunityType, OwnerTaskRow, SeoRange } from "../../../../web/src/contract/seo/common.ts";
import { addCheck, aiCrawlers, aiLabel, AI_RULE, checkRefusal, checks, ENGINE_LABEL, isAi, lastImport, referrals, referralSpan, type ImportKind } from "../../seo/aisearch.ts";
import { PLATFORMS } from "../../seo/competitors.ts";
import { allOpportunities, clusterNames, rank, toRow } from "../../seo/engine.ts";
import { latestInspection } from "../../seo/indexation.ts";
import { keywords } from "../../seo/keywords.ts";
import { headOf, ownerTasks, type OwnerTask } from "../../seo/owner.ts";
import { napMatrix, profiles } from "../../seo/presence.ts";
import { daysOf } from "../../seo/rank.ts";
import { pageReadiness, readinessOf, siteReadiness } from "../../seo/readiness.ts";
import { TYPE_LABEL } from "../../seo/rules.ts";
import { ownTitle, siteView, type SiteView } from "../../seo/site.ts";
import { body, head, operatorPanel, rangeFrom } from "./shared.ts";

/**
 * /api/v1/seo/ai-search — AI search visibility: whether AI assistants name
 * Balkaris, where their answers look, who comes to the site from them, and
 * what would move the share.
 *
 *   GET  /?range=7d|30d|90d|1y   the whole page (SeoAiSearchPayload)
 *   GET  /page?path=/a-page      one page's readiness checks with what each read (PageReadinessAnswer)
 *   POST /record        OWNER    { check: NewAiCheck }: one answer as a person read it in a browser (RecordAnswer)
 *
 * The page's other changes are the engine's own addresses (src/cc/seo/api.ts):
 * a batch of answers through the API (POST /api/v1/seo/ai-checks) and the
 * monthly imports (POST /api/v1/seo/imports/<kind>), both the owner's; an
 * opportunity's action and an owner task's done mark go through the
 * Overview's addresses; a suggestion is an operator task. Nothing here
 * changes the live website.
 *
 * WHERE EACH PANEL COMES FROM. The answers are the AI checks as recorded (the
 * audit, a person in a browser, an API): never sampled, never guessed. Every
 * figure counts each assistant's newest answer to each question; a later
 * record of the same question, assistant and day takes the earlier one's
 * place. Visits are GA4's sessions from AI assistants (consenting visitors
 * only), crawler requests Vercel's request records once the drain delivers
 * them, readiness the desk's own daily read of every sitemap page, the levers
 * the desk's own tables (URL Inspection, profiles, owner tasks, keyword
 * table, crawl). Each panel is its own reading, so one source that fails
 * costs one panel. No figure on this page is an estimate.
 */
export const routes = new Hono<Vars>();

/* ---------- small helpers ---------------------------------------------------------------------- */

const fmt = (n: number): string => n.toLocaleString("en-GB");
const plural = (n: number, one: string, many = `${one}s`): string => `${fmt(n)} ${n === 1 ? one : many}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (d: string): string => {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[(m ?? 1) - 1]} ${y}`;
};

/** The Zurich calendar day of an ISO time. */
const zurichDay = (iso: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));

/** The window GA4 and the drain count in: whole days, ending yesterday (as the Overview counts). */
const dayWindow = (range: SeoRange): { start: string; end: string } => ({ start: today(-daysOf(range)), end: today(-1) });

/** Whole days from start to end, both counted. */
const daysBetween = (start: string, end: string): number => Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;

const job = (name: string) => jobStatus().find((j) => j.name === name) ?? null;

const safe = <T>(fallback: T, f: () => T): T => {
  try {
    return f();
  } catch {
    return fallback;
  }
};

/** Everything a page's figures read only once per answer. */
interface Ctx {
  range: SeoRange;
  view: SiteView;
  /** Every record kept, newest day first. */
  all: AiCheckRow[];
  /** One per question, assistant and day: the latest record of each. The rounds count these. */
  byDay: AiCheckRow[];
  /** Each assistant's newest answer to each question: what every other figure counts. */
  rows: AiCheckRow[];
  tasks: OwnerTask[];
  open: OpportunityRow[];
}

/**
 * A task's title as the page prints it. The engine's titles end at the first
 * sentence, and a numbered list ("in this order: 1. …") cut one after "1":
 * such a title is made again from the step's first sentence, ended at its
 * colon. (The engine's own rule is src/cc/seo/owner.ts titleOf.)
 */
const tidyTitle = (t: { title: string; step?: string }): string => {
  if (!/[:,]\s*\d+$/.test(t.title)) return t.title;
  const head = headOf((t.step ?? t.title).replace(/\s+/g, " "));
  const colon = head.indexOf(": ");
  return (colon >= 25 ? head.slice(0, colon) : t.title.replace(/[:,]\s*\d+$/, "")).replace(/[.:]$/, "");
};

const taskRef = (t: OwnerTask | undefined | null) => (t ? { id: t.id, title: tidyTitle(t), done: t.done, doneBy: t.doneBy } : null);
const taskOf = (ctx: Ctx, id: string | null | undefined) => (id ? ctx.tasks.find((t) => t.id === id) : undefined);

/** Lower case letters and digits only: "example.ch", "Example-ch" and "example ch" are one key. */
const key = (s: string): string =>
  s
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]/g, "");

/** A question as one key, whatever its spacing or capitals. */
const qKey = (q: string): string => q.trim().replace(/\s+/g, " ").toLowerCase();

/** Questions that name Balkaris or its address themselves: an answer naming it is prompted. */
const PROMPTED = new Set<AiCheckRow["kind"]>(["brand", "domain"]);

/** Of the records that share a key, the newest: the latest day, then the latest recorded (the highest id). The order given is kept. */
function newestOf(rows: AiCheckRow[], keyOf: (r: AiCheckRow) => string): AiCheckRow[] {
  const best = new Map<string, AiCheckRow>();
  for (const r of rows) {
    const k = keyOf(r);
    const had = best.get(k);
    if (!had || r.day > had.day || (r.day === had.day && r.id > had.id)) best.set(k, r);
  }
  return rows.filter((r) => best.get(keyOf(r)) === r);
}

const dayKey = (r: AiCheckRow) => `${r.engine}|${qKey(r.question)}|${r.day}`;
const pairKey = (r: AiCheckRow) => `${r.engine}|${qKey(r.question)}`;

/* ---------- the answers ------------------------------------------------------------------------- */

/** Per assistant, its newest answer to each question asked of it. */
function tallyOf(rows: AiCheckRow[]): AiChecks["tally"] {
  const out: AiChecks["tally"] = [];
  for (const engine of Object.keys(ENGINE_LABEL) as AiEngine[]) {
    const mine = rows.filter((r) => r.engine === engine);
    if (!mine.length) continue;
    const days = mine.map((r) => r.day).sort();
    const unprompted = mine.filter((r) => !PROMPTED.has(r.kind));
    out.push({
      engine,
      label: ENGINE_LABEL[engine],
      since: days[0]!,
      day: days.at(-1)!,
      asked: mine.length,
      mentioned: mine.filter((r) => r.mentioned === true).length,
      unprompted: { asked: unprompted.length, mentioned: unprompted.filter((r) => r.mentioned === true).length },
    });
  }
  return out;
}

/** Every recorded day, oldest first, over the latest record of each question, assistant and day. */
function roundsOf(rows: AiCheckRow[]): AiRound[] {
  const days = [...new Set(rows.map((r) => r.day))].sort();
  return days.map((day) => {
    const round = rows.filter((r) => r.day === day);
    const unprompted = round.filter((r) => !PROMPTED.has(r.kind));
    const engines = [...new Set(round.map((r) => r.engine))].map((engine) => {
      const mine = round.filter((r) => r.engine === engine);
      return { engine, label: ENGINE_LABEL[engine] ?? engine, asked: mine.length, mentioned: mine.filter((r) => r.mentioned === true).length };
    });
    return {
      day,
      asked: round.length,
      mentioned: round.filter((r) => r.mentioned === true).length,
      unread: round.filter((r) => r.mentioned === null).length,
      unprompted: { asked: unprompted.length, mentioned: unprompted.filter((r) => r.mentioned === true).length },
      engines,
    };
  });
}

function checksPanel(ctx: Ctx): Reading<AiChecks> {
  if (!ctx.all.length) {
    return waiting(
      "desk",
      "No answer of an AI assistant is recorded yet. The audit's answers come in with the SEO import (scripts/seo-import.ts); later rounds are recorded here by the owner (Record answers).",
    );
  }
  const last = ctx.rows.map((r) => r.day).sort().at(-1)!;
  const replaced = ctx.all.length - ctx.byDay.length;
  return ok(
    { tally: tallyOf(ctx.rows), rows: ctx.rows, rounds: roundsOf(ctx.byDay), records: ctx.all.length, replaced },
    "desk",
    `${last}T12:00:00.000Z`,
    `Questions asked of AI assistants and what each answer said, as recorded by whoever asked (the audit, a person in a browser, an API). Each assistant's newest answer to each question counts${replaced ? `; ${plural(replaced, "earlier record")} of the same question, assistant and day ${replaced === 1 ? "is" : "are"} kept and not counted` : ""}. A fixed set of questions, not a sample of what people ask; no job asks the assistants by itself.`,
  );
}

/* ---------- visits from AI assistants (GA4) -------------------------------------------------------- */

/** What connects GA4, as Settings says it. */
const ga4Step = (): string | undefined => safe<string | undefined>(undefined, () => sources().find((s) => s.id === "ga4")?.step);

async function referralsPanel(range: SeoRange): Promise<Reading<AiReferrals>> {
  if (!hasKey()) return off("ga4", "The desk has no Google service-account key on this machine, so GA4 cannot be asked for visits from AI assistants.", ga4Step());
  const j = job("seo-referrals");
  const span = referralSpan();
  /* Read through: the day before the read job's last good run (it reads up to yesterday), else the newest day kept. */
  const through = j?.lastOk && j.lastEnd ? addDays(zurichDay(j.lastEnd), -1) : (span?.to ?? null);
  if (!through) return waiting("ga4", "Visits from AI assistants are read from GA4 once a day (Automations: Read referrals and AI assistant visits from GA4); the first read has not run yet.");
  let since: string | null = null;
  try {
    since = await ga4.measuredSince();
  } catch {
    since = null;
  }
  since ??= span?.from ?? null;
  const w = dayWindow(range);
  const start = since && since > w.start ? since : w.start;
  const end = through < w.end ? through : w.end;
  if (end < start) return waiting("ga4", `GA4's sessions are read through ${shortDay(through)}; no day of this window is read yet.`);

  const rows = referrals(start, end).filter((r) => isAi(r.source, r.medium));
  const byAssistant = new Map<string, { source: string; label: string; sessions: number }>();
  const byLanding = new Map<string, { path: string; sessions: number; sources: Set<string> }>();
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const label = aiLabel(r.source);
    const a = byAssistant.get(label) ?? { source: r.source, label, sessions: 0 };
    a.sessions += r.sessions;
    byAssistant.set(label, a);
    const l = byLanding.get(r.landing) ?? { path: r.landing, sessions: 0, sources: new Set<string>() };
    l.sessions += r.sessions;
    l.sources.add(label);
    byLanding.set(r.landing, l);
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.sessions);
  }
  /* Every day of the window that was read is a real count, zero included: the read covers those days whole. */
  const days: AiReferrals["days"] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push({ date: d, sessions: byDay.get(d) ?? 0 });
  /* The window before is as many days as this one counts, ending the day before it begins; compared only when GA4 measured all of it. */
  const n = daysBetween(start, end);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(start, -n);
  const previous = since && since <= prevStart ? referrals(prevStart, prevEnd).filter((r) => isAi(r.source, r.medium)).reduce((s, r) => s + r.sessions, 0) : null;
  const value: AiReferrals = {
    start,
    end,
    sessions: rows.reduce((s, r) => s + r.sessions, 0),
    users: rows.reduce((s, r) => s + r.users, 0),
    previous,
    byAssistant: [...byAssistant.values()].sort((a, b) => b.sessions - a.sessions),
    byLanding: [...byLanding.values()].sort((a, b) => b.sessions - a.sessions).map((l) => ({ path: l.path, sessions: l.sessions, sources: [...l.sources] })),
    days,
    rule: AI_RULE,
  };
  const at = j?.lastOk && j.lastEnd ? j.lastEnd : `${through}T23:00:00.000Z`;
  const sinceNote = since && since > w.start ? ` GA4 measures the site since ${shortDay(since)}.` : "";
  return ok(value, "ga4", at, `GA4 sessions from AI assistants, consenting visitors only, read once a day through ${shortDay(end)}.${sinceNote}`);
}

/* ---------- AI crawlers (Vercel's request records) ----------------------------------------------- */

async function crawlersPanel(range: SeoRange): Promise<Reading<AiCrawlers>> {
  /* Loaded when asked: a drain that fails to load costs this panel, not the page. */
  const d = await import("../../vercel/drain.ts");
  const s = d.drainState();
  if (!s.ready) {
    return off(
      "vercel-drain",
      "Vercel's request records do not reach the desk yet: the log drain is not set up, so no AI crawler's visit can be counted. No other source sees them (GA4 does not run for crawlers).",
      "Set up the log drain on Hosting: run bash deploy/vercel-connect.sh on the workstation.",
    );
  }
  if (!s.last) return waiting("vercel-drain", "The drain's secret is set and no signed delivery from Vercel has arrived yet; crawler visits are counted from the first delivery on.");
  const w = dayWindow(range);
  const c = await aiCrawlers(w.start, w.end);
  if (!c.deliveredDays) return waiting("vercel-drain", "Vercel's request records reached the desk for no day of this window yet.");
  return ok(
    c,
    "vercel-drain",
    s.last,
    "Requests by named AI and search crawlers, read from the user agent each one announces, on the days Vercel's records were delivered. A day without a delivery is unknown, not zero. Aggregates only.",
  );
}

/* ---------- the profile and the name, address and phone: one wording for every panel ------------- */

interface ProfileRead {
  row: ProfileRow | null;
  /** As a readiness row reads it: pass (exists), fail (not found), unknown (seen by the audit and not confirmed since, or not checked). */
  state: ReadinessCheck["state"];
  /** After "Profile ": "exists", "seen by the audit on 2 Oct 2026, not confirmed since". */
  word: string;
  detail: string;
}

/** The Google Business Profile as the desk's profile record has it now: the lever, the site-wide row and the directory table read this one record. */
function businessProfile(): ProfileRead {
  const gbp = profiles().find((p) => p.key === "google-business-profile") ?? null;
  if (!gbp) return { row: null, state: "unknown", word: "not recorded", detail: "The desk has no record of a Google Business Profile yet: the profiles come in with the SEO import." };
  const why = gbp.stateWhy ? ` ${gbp.stateWhy.replace(/\.?$/, ".")}` : "";
  if (gbp.state === "exists") return { row: gbp, state: "pass", word: "exists", detail: `It exists${gbp.checkedAt ? ` (the desk's check on ${shortDay(gbp.checkedAt)})` : ""}.${why}` };
  if (gbp.state === "not-found") return { row: gbp, state: "fail", word: "not found", detail: `Not found by the desk's check${gbp.checkedAt ? ` on ${shortDay(gbp.checkedAt)}` : ""}.${why}` };
  if (gbp.napSeen) {
    const seen = `seen by the audit on ${shortDay(gbp.napSeen.day)}, not confirmed since`;
    return { row: gbp, state: "unknown", word: seen, detail: `Seen by the audit on ${shortDay(gbp.napSeen.day)}; not confirmed since.${why}` };
  }
  return { row: gbp, state: "unknown", word: gbp.state === "unknown" ? "could not be confirmed" : "not checked yet", detail: why.trim() || "The desk's check has not read it." };
}

/** The same comparison presence.ts makes for napMatrix's `consistent`: "Strasse" and "Str." are one address, "+41 44" and "044" one phone. */
const SAME: Record<"name" | "address" | "phone", (s: string) => string> = {
  name: (s) => s.toLowerCase().replace(/[^a-z0-9äöü]/g, ""),
  address: (s) => s.toLowerCase().replace(/strasse/g, "str").replace(/[^a-z0-9äöü]/g, ""),
  phone: (s) => {
    const d = s.replace(/[^\d+]/g, "");
    return d.startsWith("+41") ? `0${d.slice(3)}` : d.startsWith("0041") ? `0${d.slice(4)}` : d;
  },
};

interface NapRead {
  stated: boolean;
  consistent: boolean;
  /** "4 versions of the name, 2 versions of the address", or null when they agree. */
  differ: string | null;
  sources: number;
}

/** Name, address and phone over every source, as the profile records have them now: the lever and the site-wide row read this one. */
function napRead(): NapRead {
  const nap = napMatrix();
  const stated = nap.fields.some((f) => f.values.length);
  const differ = nap.fields
    .filter((f) => !f.consistent)
    .map((f) => `${new Set(f.values.map((v) => SAME[f.field](v.value))).size} versions of the ${f.field}`)
    .join(", ");
  return { stated, consistent: nap.consistent, differ: differ || null, sources: new Set(nap.fields.flatMap((f) => f.values.map((v) => v.source))).size };
}

/* ---------- readiness ------------------------------------------------------------------------------ */

/** The site-wide rows the profile records decide, drawn from them now so they never disagree with the levers beside them. */
function liveSiteRow(c: ReadinessCheck, gbp: ProfileRead, nap: NapRead): ReadinessCheck {
  if (c.key === "profile") {
    const fixing = gbp.state !== "pass";
    return {
      ...c,
      state: gbp.state,
      detail: `${gbp.detail} From the desk's profile record.`,
      fix: fixing ? "Owner: confirm and fix the Google Business Profile (category, services, the one true address); Needs you has the step." : null,
      who: fixing ? "owner" : null,
    };
  }
  if (c.key === "nap") {
    return {
      ...c,
      state: !nap.stated ? "unknown" : nap.consistent ? "pass" : "fail",
      detail: !nap.stated
        ? "No profile states them yet."
        : nap.consistent
          ? `The same over ${plural(nap.sources, "source")}: the website and the profiles, as read or as the audit saw them.`
          : `They differ: ${nap.differ}, over ${plural(nap.sources, "source")} (the website and the profiles, as read or as the audit saw them).`,
      fix: nap.stated && !nap.consistent ? "Owner: decide the one true name, address and phone, then copy it to every profile." : null,
      who: nap.stated && !nap.consistent ? "owner" : null,
    };
  }
  return c;
}

function readinessPanel(): Reading<Readiness> {
  const p = pageReadiness();
  const site = siteReadiness();
  if (!p.pages.length && !site) {
    const j = job("seo-readiness");
    if (j?.running) return waiting("crawl", "The readiness check is reading the site's pages now; its findings appear here when it finishes.");
    return waiting("crawl", "The readiness check has not run yet. It reads every sitemap page once a day (Automations: Check every page for AI search readiness), or now with Run full SEO audit.");
  }
  const judged = p.pages.filter((x) => x.of > 0);
  const order: string[] = [];
  for (const page of p.pages) for (const c of page.checks) if (!order.includes(c.key)) order.push(c.key);
  const byCheck: ReadinessTally[] = order.map((k) => {
    const all = p.pages.map((page) => page.checks.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c);
    const applying = all.filter((c) => c.state !== "n/a");
    const failing = applying.find((c) => c.state === "fail");
    return {
      key: k,
      label: all[0]?.label ?? k,
      applies: applying.length,
      pass: applying.filter((c) => c.state === "pass").length,
      fail: applying.filter((c) => c.state === "fail").length,
      unknown: applying.filter((c) => c.state === "unknown").length,
      fix: failing?.fix ?? null,
      who: failing?.who ?? null,
    };
  });
  const gbp = safe<ProfileRead | null>(null, () => businessProfile());
  const nap = safe<NapRead | null>(null, () => napRead());
  const siteRows = (site?.checks ?? []).map((c) => (gbp && nap ? liveSiteRow(c, gbp, nap) : c));
  return ok(
    {
      checkedAt: p.checkedAt ?? site?.at ?? new Date().toISOString(),
      site: siteRows,
      /* Each check's state only: what a check read on a page comes with GET /page when its row opens. */
      pages: p.pages.map((x) => ({ path: x.path, title: ownTitle(x.title), kind: x.kind, lang: x.lang, states: Object.fromEntries(x.checks.map((c) => [c.key, c.state])), pass: x.pass, of: x.of })),
      ready: judged.filter((x) => x.pass === x.of).length,
      of: judged.length,
      byCheck,
      robots: site?.robots.agents ?? null,
    },
    "crawl",
    p.checkedAt ?? site?.at ?? new Date().toISOString(),
    "The desk's own read of every sitemap page as a crawler gets it (no JavaScript), once a day; the Business Profile and the name, address and phone rows from the desk's profile records as they are now. Each check says what it read; which checks apply depends on the kind of page. Not a score of ours.",
  );
}

/* ---------- where the answers look ---------------------------------------------------------------- */

/** A directory's or platform's name as an answer's source card shows it, from the hosts the engine knows as platforms. */
const PLATFORM_KEYS = new Set([...PLATFORMS].flatMap((d) => [key(d), key(d.split(".")[0]!)]).filter((k) => k.length >= 5));
const DIRECTORY = /clutch|goodfirms|designrush|sortlist|manifest/i;

function listingsPanel(ctx: Ctx): Reading<AiListings> {
  const rows = ctx.rows;
  if (!rows.length) return waiting("desk", "No answers recorded yet, so no source they cite is known.");
  const known = profiles();
  const profileFor = (source: string) => {
    const k = key(source);
    if (k.length < 5) return null;
    return (
      known.find((p) => {
        const keys = [p.key, p.name, p.url ?? ""].map(key).filter((x) => x.length >= 5);
        return keys.some((x) => x === k || x.startsWith(k) || k.startsWith(x));
      }) ?? null
    );
  };

  type Seen = { source: string; answers: Set<number>; engines: Set<string>; questions: Set<string> };
  const dirs = new Map<string, Seen>();
  const sites = new Map<string, Seen>();
  const own = { answers: new Set<number>(), engines: new Set<string>() };
  let withSources = 0;
  for (const r of rows) {
    if (r.sources.length) withSources++;
    for (const s of r.sources) {
      const label = r.engineLabel;
      if (/balkaris/i.test(s)) {
        own.answers.add(r.id);
        own.engines.add(label);
        continue;
      }
      const k = key(s) || s;
      const isDirectory = /business profiles?$/i.test(s) || PLATFORM_KEYS.has(k) || DIRECTORY.test(s) || !!profileFor(s);
      const into = isDirectory ? dirs : sites;
      const had = into.get(k) ?? { source: s, answers: new Set<number>(), engines: new Set<string>(), questions: new Set<string>() };
      had.answers.add(r.id);
      had.engines.add(label);
      had.questions.add(r.question);
      into.set(k, had);
    }
  }

  const directories: CitedListing[] = [...dirs.values()]
    .map((d) => {
      const p = profileFor(d.source);
      const task = taskOf(ctx, p?.ownerTaskId ?? (DIRECTORY.test(d.source) ? "directories" : null));
      return {
        source: d.source,
        answers: d.answers.size,
        engines: [...d.engines],
        questions: [...d.questions],
        profile: p ? { key: p.key, name: p.name, state: p.state, url: p.url, why: p.stateWhy } : null,
        ownerTask: taskRef(task),
      };
    })
    .sort((a, b) => b.answers - a.answers || a.source.localeCompare(b.source));

  const named = new Map<string, { name: string; answers: Set<number>; engines: Set<string>; questions: Set<string> }>();
  for (const r of rows) {
    for (const n of r.competitors) {
      if (/balkaris/i.test(n)) continue;
      const k = key(n) || n;
      const had = named.get(k) ?? { name: n, answers: new Set<number>(), engines: new Set<string>(), questions: new Set<string>() };
      had.answers.add(r.id);
      had.engines.add(r.engineLabel);
      had.questions.add(r.question);
      named.set(k, had);
    }
  }

  return ok(
    {
      answers: rows.length,
      withSources,
      directories,
      sites: [...sites.values()].map((s) => ({ source: s.source, answers: s.answers.size, engines: [...s.engines] })).sort((a, b) => b.answers - a.answers || a.source.localeCompare(b.source)),
      own: { answers: own.answers.size, engines: [...own.engines] },
      named: [...named.values()]
        .map((n) => ({ name: n.name, answers: n.answers.size, engines: [...n.engines], questions: n.questions.size }))
        .sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name)),
    },
    "desk",
    `${rows.map((r) => r.day).sort().at(-1)}T12:00:00.000Z`,
    "The sources and companies each assistant's newest answer to each question showed, as the recorder wrote them down. A directory is a listing or platform site (the engine's list of them, or one where the desk knows a profile of Balkaris); every other source is a company's own site. Whether Balkaris is there is the desk's profile record, checked weekly where an address is known.",
  );
}

/* ---------- the levers ------------------------------------------------------------------------------ */

const shareState = (pass: number, of: number): AiLever["state"] => (!of ? "unknown" : pass === of ? "good" : pass === 0 ? "bad" : "warn");

/** The Opportunities list of one kind. */
const oppsHref = (type: OpportunityType): string => `/seo/opportunities?type=${type}`;

function leversPanel(ctx: Ctx, listings: Reading<AiListings>, readiness: Reading<Readiness>): Reading<AiLever[]> {
  const levers: AiLever[] = [];
  const openOf = (type: OpportunityType) => ctx.open.filter((o) => o.type === type).length;
  /** An opportunity count with the list that shows exactly those, or nothing when none is open. */
  const opps = (type: OpportunityType) => {
    const n = openOf(type);
    return { opportunities: n || null, opportunitiesHref: n ? oppsHref(type) : null };
  };
  const tally = (k: string) => (readiness.state === "ok" ? (readiness.value.byCheck.find((c) => c.key === k) ?? null) : null);
  const readAt = readiness.state === "ok" ? readiness.asOf : null;
  const asked = (f: (r: AiCheckRow) => boolean) => {
    const rows = ctx.rows.filter(f);
    return { asked: rows.length, named: rows.filter((r) => r.mentioned === true).length };
  };

  /* 1. Google's index */
  const ins = latestInspection();
  if (ins && ins.rows.length) {
    const indexed = ins.rows.filter((r) => r.indexed).length;
    const of = ins.of ?? ins.rows.length;
    levers.push({
      key: "indexed",
      title: "Be in Google's index",
      why: "Google's AI Mode and AI Overviews answer from pages in Google's index: a page Google has not indexed cannot be quoted or linked in them.",
      state: indexed >= of ? "good" : indexed / of >= 0.9 ? "warn" : "bad",
      figure: `${fmt(indexed)} of ${fmt(of)} sitemap addresses indexed`,
      detail: `Google's URL Inspection of every sitemap address on ${shortDay(ins.day)}: ${plural(of - indexed, "address", "addresses")} not in the index.`,
      source: "gsc",
      asOf: `${ins.day}T12:00:00.000Z`,
      step: {
        who: "lead-chrome",
        text: "Request indexing for the addresses Google has not indexed, one by one in Search Console's URL Inspection; Technical lists them with Google's reason.",
        href: "/seo/technical",
        ownerTask: taskRef(taskOf(ctx, "gsc-request-indexing")),
        ...opps("not-indexed"),
      },
    });
  } else {
    levers.push({
      key: "indexed",
      title: "Be in Google's index",
      why: "Google's AI Mode and AI Overviews answer from pages in Google's index: a page Google has not indexed cannot be quoted or linked in them.",
      state: "unknown",
      figure: null,
      detail: "Google's daily URL Inspection of the sitemap addresses has not finished a round on this desk yet.",
      source: "gsc",
      asOf: null,
      step: { who: "desk", text: "The desk inspects every sitemap address once a day (Automations: Inspect sitemap addresses in Google).", href: "/seo/technical", ownerTask: null, opportunities: null, opportunitiesHref: null },
    });
  }

  /* 2. Listed where the answers look */
  if (listings.state === "ok") {
    /* The directories a profile of Balkaris belongs in: one the desk records, or one an owner task would create. */
    const dirs = listings.value.directories.filter((d) => d.profile || d.ownerTask);
    const others = listings.value.directories.filter((d) => !d.profile && !d.ownerTask).map((d) => d.source);
    const there = dirs.filter((d) => d.profile?.state === "exists").length;
    const missing = dirs.filter((d) => !d.profile || d.profile.state === "not-found").map((d) => d.source);
    levers.push({
      key: "listed",
      title: "Be listed where the answers look",
      why: "When an assistant answers a question about a service and a place, it names the studios its sources list: the directories and profiles it cited are where it finds names.",
      state: !dirs.length ? "unknown" : there === dirs.length ? "good" : there === 0 ? "bad" : "warn",
      figure: dirs.length ? `${fmt(there)} of ${plural(dirs.length, "cited directory", "cited directories")} list Balkaris` : null,
      detail: dirs.length
        ? `The recorded answers cited ${plural(dirs.length, "directory or listing", "directories and listings")} where a profile of Balkaris belongs.${missing.length ? ` Not listed: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` and ${fmt(missing.length - 5)} more` : ""}.` : ""}${others.length ? ` Also cited, with no profile planned: ${others.slice(0, 4).join(", ")}.` : ""}`
        : "The recorded answers cited no directory or listing where a profile of Balkaris belongs.",
      source: "desk",
      asOf: listings.asOf,
      step: {
        who: "owner",
        text: "Create the directory profiles with the same name, address and phone everywhere, starting with the ones the answers cite most.",
        href: "/seo/backlinks",
        ownerTask: taskRef(taskOf(ctx, "directories")),
        ...opps("entity"),
      },
    });
  } else {
    levers.push({
      key: "listed",
      title: "Be listed where the answers look",
      why: "When an assistant answers a question about a service and a place, it names the studios its sources list: the directories and profiles it cited are where it finds names.",
      state: "unknown",
      figure: null,
      detail: "No answer is recorded yet, so no source the answers cite is known.",
      source: "desk",
      asOf: null,
      step: { who: "owner", text: "Record a round of answers (Answers by assistant) to see which directories they cite.", href: null, ownerTask: null, opportunities: null, opportunitiesHref: null },
    });
  }

  /* 3. A Business Profile, and reviews: the same record the site-wide row and the directory table read. */
  const gbp = businessProfile();
  const reviews = taskOf(ctx, "reviews");
  const gbpCited = listings.state === "ok" ? listings.value.directories.filter((d) => /business profiles?$/i.test(d.source) || d.profile?.key === "google-business-profile").reduce((n, d) => n + d.answers, 0) : 0;
  levers.push({
    key: "profile",
    title: "A Google Business Profile with reviews",
    why: "Google's AI answers name local studios from their Business Profiles, and quote what reviews say about them.",
    state: !gbp.row ? "unknown" : gbp.state === "pass" && reviews?.done ? "good" : gbp.state === "pass" || gbp.row.napSeen ? "warn" : "bad",
    figure: gbp.row ? `Profile ${gbp.word}` : null,
    detail: `${gbp.detail} ${gbpCited ? `The recorded answers cited Business Profiles ${plural(gbpCited, "time")}. ` : ""}Reviews: ${reviews ? (reviews.done ? `marked done by ${reviews.doneBy ?? "a person"}` : "the owner task is open") : "no owner task recorded"}; the desk has no source that counts them.`,
    source: "desk",
    asOf: gbp.row?.checkedAt ?? null,
    step: {
      who: "owner",
      text: "Fix the Business Profile (category, services, the one true address), then ask past clients for a review there.",
      href: "/seo/backlinks",
      ownerTask: taskRef(taskOf(ctx, gbp.row?.ownerTaskId ?? "business-profile") ?? reviews),
      opportunities: null,
      opportunitiesHref: null,
    },
  });

  /* 4. German answer pages */
  const dePages = ctx.view.pages.filter((p) => p.lang === "de" && p.status === 200).length;
  const de = asked((r) => r.lang === "de");
  let kwLine = "";
  try {
    const rel = keywords().filter((k) => k.status === "relevant");
    const deRel = rel.filter((k) => k.lang === "de").length;
    if (rel.length) kwLine = ` German phrases among the relevant search phrases in the keyword table: ${fmt(deRel)} of ${fmt(rel.length)}.`;
  } catch {
    kwLine = "";
  }
  const germanOpen = openOf("german-missing");
  levers.push({
    key: "german",
    title: "German answer pages",
    why: "An assistant answers a German question from German pages: an English-only site is not a source for it.",
    state: !ctx.view.at ? "unknown" : dePages === 0 ? "bad" : germanOpen ? "warn" : "good",
    figure: ctx.view.at ? `${plural(dePages, "German page")} on the site` : null,
    detail: `${de.asked ? `Answers to German questions that named Balkaris: ${fmt(de.named)} of ${fmt(de.asked)}.` : "No German question recorded yet."}${kwLine}`,
    source: "crawl",
    asOf: ctx.view.at,
    step: {
      who: "content",
      text: "Write German (de-CH) pages that answer the questions clients ask, the price questions first, linked to their English pages with hreflang.",
      href: oppsHref("german-missing"),
      ownerTask: null,
      ...opps("german-missing"),
    },
  });

  /* 5. Prices: the owner decides the ranges (Needs you lists the task), the pages then state them. */
  const price = tally("price");
  const priceAsked = asked((r) => r.kind === "price");
  let pricePhrases = "";
  try {
    const rel = keywords().filter((k) => k.status === "relevant");
    const p = rel.filter((k) => k.flags.price).length;
    if (rel.length) pricePhrases = ` Price phrases among the relevant search phrases: ${fmt(p)} of ${fmt(rel.length)}.`;
  } catch {
    pricePhrases = "";
  }
  const priceTask = taskOf(ctx, "price-ranges");
  levers.push({
    key: "prices",
    title: "State prices",
    why: "Asked what a service costs, an assistant quotes pages that state a price; a page without one is passed over for one that has it.",
    state: price ? shareState(price.pass, price.applies) : "unknown",
    figure: price ? `${fmt(price.pass)} of ${plural(price.applies, "page")} state a price` : null,
    detail: `${price ? "A CHF amount stated on the pages where the readiness check looks for one." : "The readiness check has not read the pages yet."} ${priceAsked.asked ? `Price questions recorded: Balkaris named in ${fmt(priceAsked.named)} of ${fmt(priceAsked.asked)} answers.` : ""}${pricePhrases}`.trim(),
    source: "crawl",
    asOf: readAt,
    step: {
      who: "owner",
      text: "Decide the price ranges you are willing to publish (\"from CHF …\") for each service; the pages then state them.",
      href: oppsHref("missing-answer"),
      ownerTask: taskRef(priceTask),
      opportunities: null,
      opportunitiesHref: null,
    },
  });

  /* 6. Direct answers and questions on the pages */
  const ans = tally("answer");
  const faq = tally("faq");
  const schema = tally("faq-schema");
  levers.push({
    key: "answers",
    title: "Direct answers and FAQ on the pages",
    why: "Assistants quote a short paragraph that answers the question outright, and questions answered on the page; pages that open with a slogan give them nothing to quote.",
    state: ans ? shareState(ans.pass, ans.applies) : "unknown",
    figure: ans ? `${fmt(ans.pass)} of ${plural(ans.applies, "page")} open with a direct answer` : null,
    detail: ans
      ? `${faq ? `Questions answered on the page: ${fmt(faq.pass)} of ${fmt(faq.applies)}.` : ""} ${schema ? `FAQ in structured data: ${fmt(schema.pass)} of ${fmt(schema.applies)} pages with questions.` : ""}`.trim() || "Read by the daily readiness check."
      : "The readiness check has not read the pages yet.",
    source: "crawl",
    asOf: readAt,
    step: {
      who: "content",
      text: "Write a 50 to 100 word answer as the first paragraph under each page's heading, and five to eight client questions with short answers.",
      href: oppsHref("missing-answer"),
      ownerTask: null,
      ...opps("missing-answer"),
    },
  });

  /* 7. Bing */
  const bingOn = bing.configured();
  levers.push({
    key: "bing",
    title: "Bing knows the site",
    why: "Copilot and ChatGPT search draw on Bing's index; Bing Webmaster is also where Bing's AI Performance report is.",
    state: bingOn ? "good" : "bad",
    figure: bingOn ? "Bing Webmaster connected" : "Bing Webmaster not set up",
    detail: bingOn ? "The desk reads Bing Webmaster with its key." : "The desk has no Bing Webmaster key, and no record says the site is verified there.",
    source: "bing",
    asOf: null,
    step: { who: "owner", text: bing.step(), href: "/settings", ownerTask: taskRef(taskOf(ctx, "bing-webmaster")), opportunities: null, opportunitiesHref: null },
  });

  /* 8. One name, address and phone: the same comparison as the site-wide row. */
  const nap = napRead();
  levers.push({
    key: "nap",
    title: "One name, address and phone everywhere",
    why: "An assistant that finds two addresses for one studio cannot tell they are the same business, and names neither with confidence.",
    state: !nap.stated ? "unknown" : nap.consistent ? "good" : "bad",
    figure: !nap.stated ? null : nap.consistent ? "The same everywhere" : nap.differ,
    detail: !nap.stated ? "No profile states them yet." : `Compared over ${plural(nap.sources, "source")}: the website and the profiles, as read or as the audit saw them.`,
    source: "desk",
    asOf: null,
    step: { who: "owner", text: "Decide the one true name, address and phone, then copy it to the website and every profile.", href: "/seo/backlinks", ownerTask: taskRef(taskOf(ctx, "nap-decision")), opportunities: null, opportunitiesHref: null },
  });

  return ok(levers, "desk", new Date().toISOString(), "Each lever is read from the desk's own records; the sentence on why it matters is reasoning, not a measurement.");
}

/* ---------- imports ---------------------------------------------------------------------------------- */

/** Rows of an import the page carries: it shows ten. */
const IMPORT_ROWS = 10;

function importPanel(kind: ImportKind): Reading<ManualImport> {
  const got = lastImport(kind);
  const source: SourceId = kind === "bing-ai-performance" ? "bing" : "gsc";
  const what = kind === "bing-ai-performance" ? "Bing's AI Performance report" : "Search Console's Generative AI report";
  if (got) {
    const shown: ManualImport = { ...got, rows: got.rows.slice(0, IMPORT_ROWS), total: got.rows.length };
    return ok(shown, source, got.importedAt, `${what} as exported, imported by ${got.importedBy}. In no API: one CSV a month, imported by the owner.`);
  }
  if (kind === "bing-ai-performance" && !bing.configured()) {
    return off("bing", `${what} is in Bing Webmaster Tools, which is not set up for the site yet, so there is nothing to export.`, "The owner sets up Bing Webmaster first (Needs you), then exports the report once a month and imports it here.");
  }
  return waiting(source, `Nothing imported yet. ${what} is in no API: it is exported as CSV once a month and imported here by the owner.`);
}

function importSteps(ctx: Ctx): SeoAiSearchPayload["importSteps"] {
  const gscTask = taskOf(ctx, "gsc-generative-ai");
  const bingTask = taskOf(ctx, "bing-webmaster");
  const g: ImportStep = {
    kind: "gsc-generative-ai",
    title: "Search Console: Generative AI",
    where: gscTask?.step ?? "Open Search Console's Generative AI report for the site, export one month as CSV, and import it here.",
    needs: null,
    ownerTask: taskRef(gscTask),
  };
  const b: ImportStep = {
    kind: "bing-ai-performance",
    title: "Bing Webmaster: AI Performance",
    where: "Open Bing Webmaster Tools' AI Performance report for the site, export one month as CSV, and import it here.",
    needs: bing.configured() ? null : "Bing Webmaster Tools set up for the site (Needs you).",
    ownerTask: bing.configured() ? null : taskRef(bingTask),
  };
  return { gscGenerativeAi: g, bingAiPerformance: b };
}

/* ---------- opportunities and owner tasks --------------------------------------------------------- */

const OPEN = new Set(["open", "queued", "in-progress"]);
/** The kinds of opportunity that decide whether AI answers can name and quote the site. */
const AI_TYPES: OpportunityType[] = ["missing-answer", "german-missing", "not-indexed", "entity"];
/** The opportunities this page lists: what is changed on the site itself. */
const LISTED: OpportunityType[] = ["missing-answer", "german-missing"];

function openRows(view: SiteView): OpportunityRow[] {
  const names = clusterNames();
  return allOpportunities()
    .filter((o) => o.active && OPEN.has(o.state) && AI_TYPES.includes(o.type))
    .map((o) => toRow(o, view, names))
    .sort(rank);
}

/** The listed kinds side by side: the best of each, then the second of each … (each kind's own order kept). */
function mixed(rows: OpportunityRow[], most: number): OpportunityRow[] {
  const queues = LISTED.map((t) => rows.filter((r) => r.type === t));
  const out: OpportunityRow[] = [];
  while (out.length < most && queues.some((q) => q.length)) for (const q of queues) if (q.length && out.length < most) out.push(q.shift()!);
  return out;
}

/** Owner and browser steps that decide AI visibility. */
const AI_TASKS = new Set([
  "business-profile",
  "reviews",
  "directories",
  "bing-webmaster",
  "nap-decision",
  "gsc-request-indexing",
  "gsc-validate-noindex",
  "gsc-generative-ai",
  "linkedin",
  "bing-places-apple",
  "local-listings",
  "commercial-register",
  "wikidata",
  "off-site-presence",
  "price-ranges",
  "crawl-demand",
]);

/**
 * Tasks the engine files as content or code whose first step is the owner's
 * decision: the price ranges are his to decide before any page can state
 * them, so the prices lever sends him here and Needs you lists it.
 */
const OWNER_DECISIONS = new Set(["price-ranges"]);

function needsYou(tasks: OwnerTask[]): OwnerTaskRow[] {
  return tasks
    .filter((t) => ((t.whoAll === "owner" || t.whoAll === "lead-chrome") && (AI_TASKS.has(t.id) || /\bAI\b|ChatGPT|Perplexity|Gemini|Copilot/i.test(t.title))) || OWNER_DECISIONS.has(t.id))
    .map(({ whoAll: _w, ...t }) => ({ ...t, title: tidyTitle(t) }));
}

/* ---------- the operator's suggestions ----------------------------------------------------------- */

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Suggestions made from what the page read: only for what is actually missing, each a real task kind. */
function suggestions(ctx: Ctx, readiness: Reading<Readiness>): { label: string; task: NewTask }[] {
  const out: { label: string; task: NewTask }[] = [];
  const failing = (k: string) => (readiness.state === "ok" ? readiness.value.pages.filter((p) => p.states[k] === "fail").map((p) => p.path) : []);

  const noAnswer = failing("answer");
  if (noAnswer.length) {
    out.push({
      label: `Brief: direct answers for the ${plural(noAnswer.length, "page")} that open without one`,
      task: {
        kind: "brief",
        prompt: cut(
          `Direct answers for these pages, each 50 to 100 words, written as the first paragraph under the page's heading: ${noAnswer.slice(0, 8).join(", ")}. Each answers the question the page is about in its first sentence, says who does the work and where (Balkaris, Zürich), and leaves any price for the owner to fill in.`,
          2000,
        ),
        depth: "deep",
      },
    });
  }
  const unnamedDe = ctx.rows.find((r) => r.lang === "de" && !PROMPTED.has(r.kind) && r.mentioned === false);
  if (unnamedDe) {
    out.push({
      label: `Brief: a German answer page for “${cut(unnamedDe.question, 60)}”`,
      task: {
        kind: "brief",
        prompt: cut(
          `A German (de-CH) page that answers the question “${unnamedDe.question}” for Swiss clients: a direct answer of 50 to 100 words under the heading, what the answer depends on, how Balkaris works, and five client questions with short answers. Leave every price for the owner to fill in.`,
          2000,
        ),
        depth: "deep",
      },
    });
  }
  const noFaq = failing("faq");
  if (noFaq.length) {
    out.push({
      label: `Brief: client questions for the ${plural(noFaq.length, "page")} without any`,
      task: {
        kind: "brief",
        prompt: cut(`Five to eight questions clients ask, each with a short specific answer, for these pages: ${noFaq.slice(0, 8).join(", ")}. To be shown on the page and marked up as FAQPage.`, 2000),
        depth: "deep",
      },
    });
  }
  const questions = [...new Set(ctx.rows.filter((r) => !PROMPTED.has(r.kind) && r.mentioned === false).map((r) => r.question))];
  if (questions.length) {
    out.push({
      label: "Which pages could an assistant quote for the questions asked?",
      task: {
        kind: "ask",
        prompt: cut(
          `AI assistants were asked these questions and did not name Balkaris: ${questions.map((q) => `“${q}”`).join("; ")}. For each, which page of the website comes closest to answering it, what that page lacks for an assistant to quote it (a direct answer, a price, a German version, questions answered), and which page is missing altogether. Answer from the pages only.`,
          2000,
        ),
        context: "website",
        depth: "deep",
      },
    });
  }
  out.push({ label: "Find SEO opportunities in the crawl and Search Console", task: { kind: "opportunities", depth: "deep" } });
  return out.slice(0, 6);
}

/* ---------- the page ----------------------------------------------------------------------------------- */

export async function aiSearch(range: SeoRange): Promise<SeoAiSearchPayload> {
  const h = head(range);
  const view = siteView();
  const all = safe([], () => checks());
  const byDay = newestOf(all, dayKey);
  const ctx: Ctx = {
    range,
    view,
    all,
    byDay,
    rows: newestOf(byDay, pairKey),
    tasks: safe([], () => ownerTasks(["owner", "lead-chrome", "code", "content"])),
    open: safe([], () => openRows(view)),
  };

  const [checksR, referralsR, crawlersR, readinessR, listingsR, gscImport, bingImport] = await Promise.all([
    reading("desk", () => checksPanel(ctx)),
    reading("ga4", () => referralsPanel(range)),
    reading("vercel-drain", () => crawlersPanel(range)),
    reading("crawl", () => readinessPanel()),
    reading("desk", () => listingsPanel(ctx)),
    reading("gsc", () => importPanel("gsc-generative-ai")),
    reading("bing", () => importPanel("bing-ai-performance")),
  ]);
  const levers = await reading("desk", () => leversPanel(ctx, listingsR, readinessR));

  const counts = new Map<OpportunityType, number>();
  for (const o of ctx.open) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);

  return {
    head: h,
    checks: checksR,
    referrals: referralsR,
    crawlers: crawlersR,
    readiness: readinessR,
    imports: { gscGenerativeAi: gscImport, bingAiPerformance: bingImport },
    opportunities: mixed(ctx.open, 12),
    needsYou: needsYou(ctx.tasks),
    levers,
    listings: listingsR,
    opportunityTypes: AI_TYPES.map((type) => ({ type, label: TYPE_LABEL[type] ?? type, count: counts.get(type) ?? 0, href: oppsHref(type) })),
    operator: operatorPanel(safe([], () => suggestions(ctx, readinessR))),
    importSteps: safe(
      {
        gscGenerativeAi: { kind: "gsc-generative-ai", title: "Search Console: Generative AI", where: "Exported from Search Console once a month.", needs: null, ownerTask: null },
        bingAiPerformance: { kind: "bing-ai-performance", title: "Bing Webmaster: AI Performance", where: "Exported from Bing Webmaster Tools once a month.", needs: null, ownerTask: null },
      },
      () => importSteps(ctx),
    ),
    engines: (Object.keys(ENGINE_LABEL) as AiEngine[]).map((engine) => ({ engine, label: ENGINE_LABEL[engine] })),
  };
}

routes.get("/", async (c) => c.json<SeoAiSearchPayload>(await aiSearch(rangeFrom(c))));

/** One page's readiness checks with what each read: the readiness table opens a row with it. */
routes.get("/page", (c) => {
  const path = c.req.query("path") ?? "";
  if (!path.startsWith("/") || path.length > 500) return c.json<ApiError>({ error: "path must be a page's address on the site, starting with /." }, 400);
  const got = readinessOf(path);
  if (!got) return c.json<PageReadinessAnswer>({ page: null, checkedAt: null });
  const p = siteView().byPath.get(path);
  const applying = got.checks.filter((x) => x.state !== "n/a");
  return c.json<PageReadinessAnswer>({
    page: { path, title: ownTitle(p?.title ?? null), kind: p?.kind ?? null, lang: p?.lang ?? null, checks: got.checks, pass: applying.filter((x) => x.state === "pass").length, of: applying.length },
    checkedAt: got.checkedAt,
  });
});

/**
 * One answer as a person read it in a browser (the owner's). Recorded as
 * "lead-chrome": a person's record, never the audit's. Recording the same
 * question, assistant and day again changes the person's own record; where
 * another recorder (the audit) has one for that day, the person's takes its
 * place in every count and the other is kept. The answer says which happened.
 */
routes.post("/record", requireOwner, async (c) => {
  const b = await body(c);
  const raw = b.check && typeof b.check === "object" && !Array.isArray(b.check) ? (b.check as Partial<NewAiCheck>) : {};
  const check = { ...raw, by: "lead-chrome" } as NewAiCheck;
  const why = checkRefusal(check);
  if (why) return c.json<ApiError>({ error: why }, 400);
  const result = addCheck(check, me(c).name);
  const k = qKey(check.question);
  const same = checks().filter((r) => r.engine === check.engine && r.day === check.day && qKey(r.question) === k);
  const counted = newestOf(same, dayKey)[0] ?? null;
  const mine = same.find((r) => r.by === check.by) ?? null;
  const others = same.filter((r) => r.by !== check.by).sort((a, b) => b.id - a.id);
  const isCounted = !!mine && counted?.id === mine.id;
  return c.json<RecordAnswer>({
    ok: true,
    result,
    replaces: isCounted && others[0] ? { by: others[0].by, id: others[0].id } : null,
    counted: isCounted,
  });
});
