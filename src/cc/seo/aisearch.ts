import { createHash } from "node:crypto";
import { db } from "../../db.ts";
import * as ga4 from "../ga4.ts";
import { addDays } from "../search/shared.ts";
import { note, today } from "../store.ts";
import type { AiCheckRow, AiCrawlers, AiEngine, AiReferrals, ManualImport, NewAiCheck } from "../../../web/src/contract/seo/ai-search.ts";
import { addSighting, domainKey } from "./competitors.ts";
import { json, now } from "./tables.ts";

/**
 * AI SEARCH VISIBILITY, from four kinds of evidence, each kept apart:
 *
 *   checks     a question asked of an assistant and whether its answer named
 *              Balkaris, recorded by whoever asked: the audit, the lead in the
 *              owner's Chrome, an API. Never guessed. The companies an answer
 *              named and the sources it cited also become sightings
 *              (competitors.ts).
 *   referrals  GA4 sessions whose source is an AI assistant (AI_SOURCES), by
 *              day and landing page, read daily into cc_seo_referrals with
 *              the site's other referrals (consenting visitors only).
 *   crawlers   requests from named AI and search crawlers, per day and page,
 *              from Vercel's request records (src/cc/vercel/drain.ts, AI_AGENTS).
 *              Aggregates only; nothing until the drain delivers.
 *   imports    Search Console's "Generative AI" report and Bing's "AI
 *              Performance" report: in no API, so the CSV the owner or the
 *              lead exports each month, imported by the owner.
 */

export const ENGINE_LABEL: Record<AiEngine, string> = {
  "google-ai-mode": "Google AI Mode",
  "google-ai-overview": "Google AI Overview",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  copilot: "Copilot",
  claude: "Claude",
};
const ENGINES = Object.keys(ENGINE_LABEL) as AiEngine[];
const KINDS = ["brand", "domain", "category", "price", "advice"] as const;

/* ---------- checks ------------------------------------------------------------------------- */

/** What makes a check valid, in words a person can act on; null when it is. */
export function checkRefusal(c: Partial<NewAiCheck>): string | null {
  if (!c.engine || !ENGINES.includes(c.engine)) return `engine must be one of ${ENGINES.join(", ")}.`;
  if (typeof c.question !== "string" || c.question.trim().length < 3 || c.question.length > 300) return "question must be 3 to 300 characters.";
  if (c.lang !== "de" && c.lang !== "en") return 'lang must be "de" or "en".';
  if (typeof c.day !== "string" || !/^\d{4}-\d\d-\d\d$/.test(c.day) || c.day > today()) return "day must be a date (YYYY-MM-DD), not in the future.";
  if (!c.kind || !(KINDS as readonly string[]).includes(c.kind)) return `kind must be one of ${KINDS.join(", ")}.`;
  if (!(c.mentioned === true || c.mentioned === false || c.mentioned === null)) return "mentioned must be true, false or null (the answer could not be read whole).";
  if (c.by !== "audit" && c.by !== "lead-chrome" && c.by !== "api") return 'by must be "audit", "lead-chrome" or "api".';
  if (c.position != null && (!Number.isInteger(c.position) || c.position < 1 || c.position > 50)) return "position must be a whole number from 1, or null.";
  for (const list of [c.competitors, c.sources]) if (list && (!Array.isArray(list) || list.length > 40 || list.some((s) => typeof s !== "string" || s.length > 120))) return "competitors and sources are lists of at most 40 short names.";
  if (c.excerpt != null && (typeof c.excerpt !== "string" || c.excerpt.length > 600)) return "excerpt is at most 600 characters.";
  return null;
}

/** Record a check (idempotent per engine, question, day and recorder). Its named companies and cited sources become sightings. */
export function addCheck(c: NewAiCheck, addedBy: string): "added" | "changed" | "unchanged" {
  const competitors = JSON.stringify((c.competitors ?? []).map((s) => s.trim()).filter(Boolean));
  const sources = JSON.stringify((c.sources ?? []).map((s) => s.trim()).filter(Boolean));
  const had = db.prepare("SELECT id, mentioned, position, competitors, sources, excerpt, note, kind, lang FROM cc_seo_ai_checks WHERE engine = ? AND question = ? AND day = ? AND by = ?").get(c.engine, c.question.trim(), c.day, c.by) as
    | { id: number; mentioned: number | null; position: number | null; competitors: string; sources: string; excerpt: string | null; note: string | null; kind: string; lang: string }
    | undefined;
  const mentioned = c.mentioned === null ? null : c.mentioned ? 1 : 0;
  let result: "added" | "changed" | "unchanged";
  if (!had) {
    db.prepare(
      "INSERT INTO cc_seo_ai_checks (engine, question, lang, day, kind, mentioned, position, competitors, sources, excerpt, by, note, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(c.engine, c.question.trim(), c.lang, c.day, c.kind, mentioned, c.position ?? null, competitors, sources, c.excerpt ?? null, c.by, c.note ?? null, addedBy, now());
    result = "added";
  } else if (
    had.mentioned === mentioned &&
    had.position === (c.position ?? null) &&
    had.competitors === competitors &&
    had.sources === sources &&
    had.excerpt === (c.excerpt ?? null) &&
    had.note === (c.note ?? null) &&
    had.kind === c.kind &&
    had.lang === c.lang
  ) {
    result = "unchanged";
  } else {
    db.prepare("UPDATE cc_seo_ai_checks SET lang = ?, kind = ?, mentioned = ?, position = ?, competitors = ?, sources = ?, excerpt = ?, note = ? WHERE id = ?").run(
      c.lang,
      c.kind,
      mentioned,
      c.position ?? null,
      competitors,
      sources,
      c.excerpt ?? null,
      c.note ?? null,
      had.id,
    );
    result = "changed";
  }
  for (const name of c.competitors ?? []) {
    const domain = domainKey(null, name);
    if (domain) addSighting({ domain, name, engine: c.engine, kind: "named", query: c.question.trim(), lang: c.lang, cluster: null, position: null, day: c.day, by: c.by });
  }
  for (const s of c.sources ?? []) {
    if (/balkaris/i.test(s) || /business profiles?$/i.test(s)) continue;
    const domain = domainKey(s, s);
    if (domain) addSighting({ domain, name: domain.startsWith("name:") ? s : null, engine: c.engine, kind: "cited", query: c.question.trim(), lang: c.lang, cluster: null, position: null, day: c.day, by: c.by });
  }
  return result;
}

export function checks(): AiCheckRow[] {
  return (
    db.prepare("SELECT * FROM cc_seo_ai_checks ORDER BY day DESC, engine, id").all() as {
      id: number;
      engine: AiEngine;
      question: string;
      lang: "de" | "en";
      day: string;
      kind: AiCheckRow["kind"];
      mentioned: number | null;
      position: number | null;
      competitors: string;
      sources: string;
      excerpt: string | null;
      by: string;
      note: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    engine: r.engine,
    engineLabel: ENGINE_LABEL[r.engine] ?? r.engine,
    question: r.question,
    lang: r.lang,
    day: r.day,
    kind: r.kind,
    mentioned: r.mentioned === null ? null : !!r.mentioned,
    position: r.position,
    competitors: json<string[]>(r.competitors, []),
    sources: json<string[]>(r.sources, []),
    excerpt: r.excerpt,
    by: r.by,
    note: r.note,
  }));
}

/** Per engine, its newest day's round: asked and named, and the same for the questions that do not name Balkaris themselves. */
export function tally(rows: AiCheckRow[] = checks()): { engine: AiEngine; label: string; day: string; asked: number; mentioned: number; unprompted: { asked: number; mentioned: number } }[] {
  const out: ReturnType<typeof tally> = [];
  for (const engine of ENGINES) {
    const mine = rows.filter((r) => r.engine === engine);
    if (!mine.length) continue;
    const day = mine.map((r) => r.day).sort().at(-1)!;
    const round = mine.filter((r) => r.day === day);
    const unprompted = round.filter((r) => r.kind !== "brand" && r.kind !== "domain");
    out.push({
      engine,
      label: ENGINE_LABEL[engine],
      day,
      asked: round.length,
      mentioned: round.filter((r) => r.mentioned === true).length,
      unprompted: { asked: unprompted.length, mentioned: unprompted.filter((r) => r.mentioned === true).length },
    });
  }
  return out;
}

/* ---------- referrals from GA4 --------------------------------------------------------------- */

/** The sources GA4 records for AI assistants, and the medium some of them set. */
export const AI_SOURCES = /chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|claude\.ai|you\.com/i;
export const AI_MEDIUM = "ai-assistant";
export const AI_RULE = "A GA4 session counts as from an AI assistant when its source is chatgpt.com, chat.openai.com, perplexity.ai, gemini.google.com, copilot.microsoft.com, claude.ai or you.com, or its medium is \"ai-assistant\".";

const AI_LABEL: [RegExp, string][] = [
  [/chatgpt|openai/i, "ChatGPT"],
  [/perplexity/i, "Perplexity"],
  [/gemini|bard/i, "Gemini"],
  [/copilot/i, "Copilot"],
  [/claude/i, "Claude"],
  [/you\.com/i, "You.com"],
];
export const aiLabel = (source: string): string => AI_LABEL.find(([re]) => re.test(source))?.[1] ?? source;
export const isAi = (source: string, medium: string): boolean => AI_SOURCES.test(source) || medium === AI_MEDIUM;

/**
 * Read GA4's referral and AI-assistant sessions by day, source, medium and
 * landing page, from the day after the last one kept (re-reading the last two,
 * which GA4 may still change) up to yesterday. The first run reads from the
 * day GA4's measurement began. One report a run.
 */
export async function readReferrals(): Promise<string> {
  const since = await ga4.measuredSince();
  if (!since) throw new Error("GA4 has recorded nothing for the website yet, or cannot be asked.");
  const yesterday = addDays(today(), -1);
  const last = (db.prepare("SELECT MAX(day) AS d FROM cc_seo_referrals").get() as { d: string | null }).d;
  const start = last ? (addDays(last, -2) > since ? addDays(last, -2) : since) : since;
  if (start > yesterday) return "Up to date.";
  const r = await ga4.report(
    {
      dimensions: ["date", "sessionSource", "sessionMedium", "landingPage"],
      metrics: ["sessions", "activeUsers"],
      dateRanges: [{ startDate: start, endDate: yesterday }],
      dimensionFilter: ga4.where.any(ga4.where.is("sessionMedium", "referral"), ga4.where.is("sessionMedium", AI_MEDIUM), ga4.where.matches("sessionSource", AI_SOURCES.source)),
      limit: 10_000,
    },
    { wait: true, ttl: 60_000 },
  );
  if (!r.data) throw new Error(r.error ?? "GA4 did not answer.");
  const put = db.prepare("INSERT OR REPLACE INTO cc_seo_referrals (day, source, medium, landing, sessions, users) VALUES (?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM cc_seo_referrals WHERE day >= ? AND day <= ?").run(start, yesterday);
    for (const row of r.data.rows) {
      put.run(String(row.date), String(row.sessionSource), String(row.sessionMedium), ga4.normalPath(String(row.landingPage)), Number(row.sessions) || 0, Number(row.activeUsers) || 0);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const ai = r.data.rows.filter((row) => isAi(String(row.sessionSource), String(row.sessionMedium))).reduce((n, row) => n + (Number(row.sessions) || 0), 0);
  if (ai) note("seo-ai", `${ai} session${ai === 1 ? "" : "s"} from AI assistants since ${start}`, { tone: "good", detail: "GA4, consenting visitors only.", href: "/seo/ai-search", dedupe: `seo:ai-ref:${start}:${ai}` });
  return `${r.data.rows.length} rows for ${start} to ${yesterday}; ${ai} AI-assistant session${ai === 1 ? "" : "s"}`;
}

export interface ReferralRow {
  day: string;
  source: string;
  medium: string;
  landing: string;
  sessions: number;
  users: number;
}

export function referrals(start: string, end: string): ReferralRow[] {
  return db.prepare("SELECT day, source, medium, landing, sessions, users FROM cc_seo_referrals WHERE day >= ? AND day <= ? ORDER BY day").all(start, end) as unknown as ReferralRow[];
}

/** When the kept referrals begin and end. */
export function referralSpan(): { from: string; to: string } | null {
  const r = db.prepare("SELECT MIN(day) AS f, MAX(day) AS t FROM cc_seo_referrals").get() as { f: string | null; t: string | null };
  return r.f && r.t ? { from: r.f, to: r.t } : null;
}

export function aiReferrals(start: string, end: string, previous: { start: string; end: string } | null): AiReferrals {
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
  const span = referralSpan();
  const days: { date: string; sessions: number }[] = [];
  if (span) for (let d = start > span.from ? start : span.from; d <= end && d <= span.to; d = addDays(d, 1)) days.push({ date: d, sessions: byDay.get(d) ?? 0 });
  const prev = previous && span && span.from <= previous.start ? referrals(previous.start, previous.end).filter((r) => isAi(r.source, r.medium)).reduce((n, r) => n + r.sessions, 0) : null;
  return {
    start,
    end,
    sessions: rows.reduce((n, r) => n + r.sessions, 0),
    users: rows.reduce((n, r) => n + r.users, 0),
    previous: prev,
    byAssistant: [...byAssistant.values()].sort((a, b) => b.sessions - a.sessions),
    byLanding: [...byLanding.values()].sort((a, b) => b.sessions - a.sessions).map((l) => ({ path: l.path, sessions: l.sessions, sources: [...l.sources] })),
    days,
    rule: AI_RULE,
  };
}

/* ---------- crawlers, from the drain --------------------------------------------------------- */

/* Loaded when asked, so a drain that fails to load costs this panel and not the SEO section. */
const drain = () => import("../vercel/drain.ts");

export async function aiCrawlers(start: string, end: string): Promise<AiCrawlers> {
  const { AI_AGENTS, deliveredDays } = await drain();
  const AGENT = new Map(AI_AGENTS.map((a) => [a.agent, a]));
  const agents = db.prepare("SELECT day, key, SUM(n) AS n FROM cc_drain_days WHERE dim = 'agent' AND day >= ? AND day <= ? GROUP BY day, key").all(start, end) as { day: string; key: string; n: number }[];
  const pages = db.prepare("SELECT key, SUM(n) AS n FROM cc_drain_days WHERE dim = 'agent-path' AND day >= ? AND day <= ? GROUP BY key").all(start, end) as { key: string; n: number }[];
  const delivered = deliveredDays(start, end);
  const byAgent = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (const r of agents) {
    byAgent.set(r.key, (byAgent.get(r.key) ?? 0) + r.n);
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.n);
  }
  const byPage = new Map<string, { path: string; hits: number; agents: Set<string> }>();
  for (const r of pages) {
    const at = r.key.indexOf(" ");
    const agent = at === -1 ? r.key : r.key.slice(0, at);
    const path = at === -1 ? "(other)" : r.key.slice(at + 1);
    const p = byPage.get(path) ?? { path, hits: 0, agents: new Set<string>() };
    p.hits += r.n;
    p.agents.add(agent);
    byPage.set(path, p);
  }
  const days = [...delivered].sort().map((date) => ({ date, hits: byDay.get(date) ?? 0 }));
  return {
    start,
    end,
    hits: [...byAgent.values()].reduce((a, b) => a + b, 0),
    byAgent: [...byAgent.entries()]
      .map(([agent, hits]) => ({ agent, company: AGENT.get(agent)?.company ?? "", purpose: AGENT.get(agent)?.purpose ?? "other", hits }))
      .sort((a, b) => b.hits - a.hits),
    byPage: [...byPage.values()].sort((a, b) => b.hits - a.hits).slice(0, 50).map((p) => ({ path: p.path, hits: p.hits, agents: [...p.agents] })),
    days,
    deliveredDays: delivered.size,
  };
}

/* ---------- the monthly CSV imports ---------------------------------------------------------- */

export type ImportKind = ManualImport["kind"];
export const IMPORT_KINDS: ImportKind[] = ["gsc-generative-ai", "bing-ai-performance"];

/** A CSV as rows of cells: quotes, doubled quotes, commas, semicolons or tabs inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/**
 * Keep one month's export. The same file twice changes nothing; a new export
 * of the same month replaces the earlier one.
 */
export function importManual(kind: ImportKind, month: string, csv: string, by: string): { result: "added" | "replaced" | "unchanged"; rows: number } {
  if (!IMPORT_KINDS.includes(kind)) throw new Error(`There is no import called ${kind}.`);
  if (!/^\d{4}-\d\d$/.test(month)) throw new Error('month must be "YYYY-MM".');
  const cells = parseCsv(csv);
  if (cells.length < 1) throw new Error("The CSV is empty.");
  if (cells.length > 20_001) throw new Error("The CSV has more than 20,000 rows.");
  const columns = cells[0]!.map((c) => c.trim());
  const rows = cells.slice(1).map((r) => columns.map((_, i) => (r[i] ?? "").trim()));
  const hash = createHash("sha1").update(JSON.stringify([columns, rows])).digest("hex");
  const had = db.prepare("SELECT hash FROM cc_seo_imports WHERE kind = ? AND month = ?").get(kind, month) as { hash: string } | undefined;
  if (had?.hash === hash) return { result: "unchanged", rows: rows.length };
  db.prepare(
    "INSERT INTO cc_seo_imports (kind, month, columns, rows, hash, imported_by, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(kind, month) DO UPDATE SET columns = excluded.columns, rows = excluded.rows, hash = excluded.hash, imported_by = excluded.imported_by, imported_at = excluded.imported_at",
  ).run(kind, month, JSON.stringify(columns), JSON.stringify(rows), hash, by, now());
  note("seo-import", `Imported ${kind === "gsc-generative-ai" ? "Search Console's Generative AI report" : "Bing's AI Performance report"} for ${month}`, {
    tone: "info",
    actor: by,
    detail: `${rows.length} row${rows.length === 1 ? "" : "s"}`,
    href: "/seo/ai-search",
    dedupe: `seo:import:${kind}:${month}:${hash.slice(0, 8)}`,
  });
  return { result: had ? "replaced" : "added", rows: rows.length };
}

/** The newest import of a kind, with the months before it. */
export function lastImport(kind: ImportKind): ManualImport | null {
  const all = db.prepare("SELECT month, columns, rows, imported_by, imported_at FROM cc_seo_imports WHERE kind = ? ORDER BY month DESC").all(kind) as {
    month: string;
    columns: string;
    rows: string;
    imported_by: string;
    imported_at: string;
  }[];
  const top = all[0];
  if (!top) return null;
  return {
    kind,
    month: top.month,
    importedAt: top.imported_at,
    importedBy: top.imported_by,
    columns: json<string[]>(top.columns, []),
    rows: json<string[][]>(top.rows, []),
    earlier: all.slice(1).map((r) => ({ month: r.month, importedAt: r.imported_at, rows: json<string[][]>(r.rows, []).length })),
  };
}
