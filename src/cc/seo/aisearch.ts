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

/** A question as one key, whatever its spacing or capitals: the page groups answers by it, and a record is found again by it. */
export const qKey = (q: string): string => q.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The name an assistant goes by among the sightings. Competitors and the
 * audit's import know Google's AI Overview as "google-aio"; a record filed
 * under the check's own key would show there without a label.
 */
export const sightingEngine = (e: AiEngine): string => (e === "google-ai-overview" ? "google-aio" : e);

/* Sightings filed under the check's own key before this rule: moved once, and a row that is already there under the right key is dropped. */
try {
  db.exec("UPDATE OR IGNORE cc_seo_sightings SET engine = 'google-aio' WHERE engine = 'google-ai-overview'; DELETE FROM cc_seo_sightings WHERE engine = 'google-ai-overview';");
} catch {
  /* no such table yet: nothing to move */
}

/** What makes a check valid, in words a person can act on; null when it is. */
export function checkRefusal(c: Partial<NewAiCheck>): string | null {
  if (!c.engine || !ENGINES.includes(c.engine)) return `engine must be one of ${ENGINES.join(", ")}.`;
  if (typeof c.question !== "string" || c.question.trim().length < 3 || c.question.length > 300) return "question must be 3 to 300 characters.";
  if (c.lang !== "de" && c.lang !== "en") return 'lang must be "de" or "en".';
  if (typeof c.day !== "string" || !/^\d{4}-\d\d-\d\d$/.test(c.day) || c.day > today()) return "day must be a date (YYYY-MM-DD), not in the future.";
  if (!c.kind || !(KINDS as readonly string[]).includes(c.kind)) return `kind must be one of ${KINDS.join(", ")}.`;
  if (!(c.mentioned === true || c.mentioned === false || c.mentioned === null)) return "mentioned must be true, false or null (the answer could not be read whole).";
  if (c.by !== "audit" && c.by !== "lead-chrome" && c.by !== "api") return 'by must be "audit", "lead-chrome" or "api".';
  if (c.position != null && (!Number.isInteger(c.position) || c.position < 1 || c.position > 50)) return "position must be a whole number from 1 to 50, or null.";
  for (const list of [c.competitors, c.sources]) if (list && (!Array.isArray(list) || list.length > 40 || list.some((s) => typeof s !== "string" || s.length > 120))) return "competitors and sources are lists of at most 40 short names.";
  if (c.excerpt != null && (typeof c.excerpt !== "string" || c.excerpt.length > 600)) return "excerpt is at most 600 characters.";
  /* The form caps a note at 300; without the same rule here an API caller could store any size, and a note that is not text failed in the database instead of with a sentence. */
  if (c.note != null && (typeof c.note !== "string" || c.note.length > 300)) return "note is at most 300 characters.";
  return null;
}

interface CheckDb {
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
}

const toCheck = (r: CheckDb): AiCheckRow => ({
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
});

const tidy = (list: string[] | undefined): string[] => (list ?? []).map((s) => s.trim()).filter(Boolean);

interface Seen {
  domain: string;
  name: string | null;
  kind: "named" | "cited";
}

/** The sightings one record stands for: the companies it named and the sources it cited (never Balkaris itself, never a "Business profiles" card). */
function sightingsOf(c: { competitors?: string[]; sources?: string[] }): Seen[] {
  const out: Seen[] = [];
  for (const name of tidy(c.competitors)) {
    const domain = domainKey(null, name);
    if (domain) out.push({ domain, name, kind: "named" });
  }
  for (const s of tidy(c.sources)) {
    if (/balkaris/i.test(s) || /business profiles?$/i.test(s)) continue;
    const domain = domainKey(s, s);
    if (domain) out.push({ domain, name: domain.startsWith("name:") ? s : null, kind: "cited" });
  }
  return out;
}

type SightKey = { engine: AiEngine; question: string; lang: string; day: string; by: string };

function putSightings(c: SightKey, list: Seen[]): void {
  for (const s of list) addSighting({ domain: s.domain, name: s.name, engine: sightingEngine(c.engine), kind: s.kind, query: c.question, lang: c.lang, cluster: null, position: null, day: c.day, by: c.by });
}

/** Take away the sightings a record no longer stands for: a name or a source corrected out of it, or the record itself removed. */
function dropSightings(c: SightKey, gone: Seen[]): void {
  const del = db.prepare("DELETE FROM cc_seo_sightings WHERE domain = ? AND engine = ? AND kind = ? AND query = ? AND day = ? AND by = ?");
  for (const g of gone) del.run(g.domain, sightingEngine(c.engine), g.kind, c.question, c.day, c.by);
}

/** The record of a recorder for one assistant, question and day, found by the question's key (its spacing and capitals do not matter). */
function recordOf(engine: AiEngine, question: string, day: string, by: string, not?: number): CheckDb | undefined {
  const k = qKey(question);
  return (db.prepare("SELECT * FROM cc_seo_ai_checks WHERE engine = ? AND day = ? AND by = ?").all(engine, day, by) as unknown as CheckDb[]).find((r) => r.id !== not && qKey(r.question) === k);
}

/**
 * Record a check (idempotent per engine, question, day and recorder; the
 * question is matched by its key, so "Best agency?" and "best  agency?" are
 * one). Its named companies and cited sources become sightings, and a name
 * or source corrected out of the record takes its sighting with it.
 *
 * A record a person removed stays removed when the audit's files are
 * imported again; a person or an API recording it again brings it back.
 */
export function addCheck(c: NewAiCheck, addedBy: string): "added" | "changed" | "unchanged" {
  const asked = c.question.trim();
  const k = qKey(asked);
  if (db.prepare("SELECT 1 AS x FROM cc_seo_ai_removed WHERE engine = ? AND question = ? AND day = ? AND by = ?").get(c.engine, k, c.day, c.by)) {
    if (c.by === "audit") return "unchanged";
    db.prepare("DELETE FROM cc_seo_ai_removed WHERE engine = ? AND question = ? AND day = ? AND by = ?").run(c.engine, k, c.day, c.by);
  }
  const names = tidy(c.competitors);
  const cited = tidy(c.sources);
  const competitors = JSON.stringify(names);
  const sources = JSON.stringify(cited);
  const had = recordOf(c.engine, asked, c.day, c.by);
  const mentioned = c.mentioned === null ? null : c.mentioned ? 1 : 0;
  /* An earlier record keeps the question as it was first written, so its sightings stay under one query. */
  const key: SightKey = { engine: c.engine, question: had?.question ?? asked, lang: c.lang, day: c.day, by: c.by };
  const seen = sightingsOf({ competitors: names, sources: cited });
  let result: "added" | "changed" | "unchanged";
  if (!had) {
    db.prepare(
      "INSERT INTO cc_seo_ai_checks (engine, question, lang, day, kind, mentioned, position, competitors, sources, excerpt, by, note, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(c.engine, asked, c.lang, c.day, c.kind, mentioned, c.position ?? null, competitors, sources, c.excerpt ?? null, c.by, c.note ?? null, addedBy, now());
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
    const before = sightingsOf({ competitors: json<string[]>(had.competitors, []), sources: json<string[]>(had.sources, []) });
    dropSightings(key, before.filter((b) => !seen.some((s) => s.domain === b.domain && s.kind === b.kind)));
    result = "changed";
  }
  putSightings(key, seen);
  return result;
}

export function checks(): AiCheckRow[] {
  return (db.prepare("SELECT * FROM cc_seo_ai_checks ORDER BY day DESC, engine, id").all() as unknown as CheckDb[]).map(toCheck);
}

/** One record by its id, or null. */
export function checkById(id: number): AiCheckRow | null {
  const r = db.prepare("SELECT * FROM cc_seo_ai_checks WHERE id = ?").get(id) as unknown as CheckDb | undefined;
  return r ? toCheck(r) : null;
}

const RECORDER: Record<string, string> = { audit: "the SEO audit", "lead-chrome": "a person in a browser", api: "an API" };
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Remove one record: a wrong assistant, a wrong day, a mistyped question. Its
 * sightings go with it, and a mark is kept so the audit's files imported
 * again do not bring it back. Null when there is no such record.
 */
export function removeCheck(id: number, by: string): AiCheckRow | null {
  const had = checkById(id);
  if (!had) return null;
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM cc_seo_ai_checks WHERE id = ?").run(id);
    db.prepare("INSERT OR REPLACE INTO cc_seo_ai_removed (engine, question, day, by, removed_by, removed_at) VALUES (?, ?, ?, ?, ?, ?)").run(had.engine, qKey(had.question), had.day, had.by, by, now());
    dropSightings(had, sightingsOf(had));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  note("seo-ai", `Removed a recorded answer: ${had.engineLabel}, “${clip(had.question, 80)}”`, {
    tone: "quiet",
    actor: by,
    detail: `It was recorded for ${had.day} by ${RECORDER[had.by] ?? had.by}. It no longer counts.`,
    href: "/seo/ai-search",
    dedupe: `seo:ai-removed:${id}`,
  });
  return had;
}

/**
 * Correct one record in place. The assistant, the day and the question may
 * change too (a record filed under the wrong one). A record of the audit that
 * a person corrects becomes the person's: the audit's files imported again
 * would otherwise put the old answer back.
 *
 * Throws with a sentence when there is no such record, or when the same
 * recorder already holds another record of that question, assistant and day.
 */
export function editCheck(id: number, c: NewAiCheck): "changed" | "unchanged" {
  const had = checkById(id);
  if (!had) throw new Error(`There is no recorded answer ${id}.`);
  const by = had.by === "audit" ? "lead-chrome" : had.by;
  const asked = c.question.trim();
  if (recordOf(c.engine, asked, c.day, by, id)) throw new Error("There is already a record of that question, assistant and day. Change that one, or remove it first.");
  const names = tidy(c.competitors);
  const cited = tidy(c.sources);
  const same =
    had.engine === c.engine &&
    had.question === asked &&
    had.day === c.day &&
    had.lang === c.lang &&
    had.kind === c.kind &&
    had.mentioned === c.mentioned &&
    had.position === (c.position ?? null) &&
    JSON.stringify(had.competitors) === JSON.stringify(names) &&
    JSON.stringify(had.sources) === JSON.stringify(cited) &&
    had.excerpt === (c.excerpt ?? null) &&
    had.note === (c.note ?? null);
  if (same) return "unchanged";
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE cc_seo_ai_checks SET engine = ?, question = ?, lang = ?, day = ?, kind = ?, mentioned = ?, position = ?, competitors = ?, sources = ?, excerpt = ?, note = ?, by = ? WHERE id = ?").run(
      c.engine,
      asked,
      c.lang,
      c.day,
      c.kind,
      c.mentioned === null ? null : c.mentioned ? 1 : 0,
      c.position ?? null,
      JSON.stringify(names),
      JSON.stringify(cited),
      c.excerpt ?? null,
      c.note ?? null,
      by,
      id,
    );
    if (by !== had.by) db.prepare("INSERT OR REPLACE INTO cc_seo_ai_removed (engine, question, day, by, removed_by, removed_at) VALUES (?, ?, ?, ?, ?, ?)").run(had.engine, qKey(had.question), had.day, had.by, "a correction", now());
    /* The record may have moved to another assistant, day or question: every sighting under the old one goes, and the new ones are written. */
    dropSightings(had, sightingsOf(had));
    putSightings({ engine: c.engine, question: asked, lang: c.lang, day: c.day, by }, sightingsOf({ competitors: names, sources: cited }));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return "changed";
}

/* ---------- the questions tracked ------------------------------------------------------------ */

export interface TrackedQuestion {
  key: string;
  question: string;
  lang: "de" | "en";
  kind: AiCheckRow["kind"];
  /** False when a person retired it: its answers are kept, it is left out of the round. */
  active: boolean;
  addedBy: string | null;
  addedAt: string;
}

/** What makes a question fit for the list, in words; null when it is. */
export function questionRefusal(q: { question?: unknown; lang?: unknown; kind?: unknown }): string | null {
  if (typeof q.question !== "string" || q.question.trim().length < 3 || q.question.length > 300) return "question must be 3 to 300 characters.";
  if (q.lang !== "de" && q.lang !== "en") return 'lang must be "de" or "en".';
  if (typeof q.kind !== "string" || !(KINDS as readonly string[]).includes(q.kind)) return `kind must be one of ${KINDS.join(", ")}.`;
  return null;
}

/** The list as a person keeps it: the questions added by hand and the ones retired. A question that was only ever recorded has no row here. */
export function trackedQuestions(): TrackedQuestion[] {
  return (
    db.prepare("SELECT key, question, lang, kind, active, added_by, added_at FROM cc_seo_ai_questions ORDER BY added_at, key").all() as {
      key: string;
      question: string;
      lang: "de" | "en";
      kind: AiCheckRow["kind"];
      active: number;
      added_by: string | null;
      added_at: string;
    }[]
  ).map((r) => ({ key: r.key, question: r.question, lang: r.lang, kind: r.kind, active: !!r.active, addedBy: r.added_by, addedAt: r.added_at }));
}

/**
 * Put a question on the list (active) or retire it (not active). Retiring
 * removes nothing: the answers recorded for it stay and are shown apart.
 */
export function setQuestion(q: { question: string; lang: "de" | "en"; kind: AiCheckRow["kind"] }, active: boolean, by: string): "added" | "changed" | "unchanged" {
  const question = q.question.trim().replace(/\s+/g, " ");
  const k = qKey(question);
  const had = db.prepare("SELECT question, lang, kind, active FROM cc_seo_ai_questions WHERE key = ?").get(k) as { question: string; lang: string; kind: string; active: number } | undefined;
  if (!had) {
    db.prepare("INSERT INTO cc_seo_ai_questions (key, question, lang, kind, active, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(k, question, q.lang, q.kind, active ? 1 : 0, by, now());
    return "added";
  }
  if (!!had.active === active && had.lang === q.lang && had.kind === q.kind && had.question === question) return "unchanged";
  db.prepare("UPDATE cc_seo_ai_questions SET question = ?, lang = ?, kind = ?, active = ?, changed_by = ?, changed_at = ? WHERE key = ?").run(question, q.lang, q.kind, active ? 1 : 0, by, now(), k);
  return "changed";
}

/* ---------- a round pasted as text ----------------------------------------------------------- */

const GERMAN = /[äöüß]|\b(wie|was|wer|wo|welche[rsn]?|warum|für|und|oder|kostet|kosten|eine[rnms]?|der|die|das|macht|gibt|beste[rn]?)\b/i;
/** German or English, from the question's own words: only used when neither the file nor an earlier record says. */
export const guessLang = (q: string): "de" | "en" => (GERMAN.test(q) ? "de" : "en");

const ENGINE_BY_NAME = new Map<string, AiEngine>(ENGINES.flatMap((e) => [[e, e], [ENGINE_LABEL[e].toLowerCase(), e], [ENGINE_LABEL[e].toLowerCase().replace(/[^a-z]/g, ""), e]] as [string, AiEngine][]));
const engineOf = (s: unknown): AiEngine | undefined => (typeof s === "string" ? (ENGINE_BY_NAME.get(s.trim().toLowerCase()) ?? ENGINE_BY_NAME.get(s.trim().toLowerCase().replace(/[^a-z]/g, ""))) : undefined);

/** "yes", "no" and "unread" as people write them in a sheet. Undefined when the cell says none of them. */
function namedOf(v: unknown): boolean | null | undefined {
  if (v === true || v === false || v === null) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["yes", "y", "true", "1", "ja", "named"].includes(s)) return true;
  if (["no", "n", "false", "0", "nein", "not named"].includes(s)) return false;
  if (["unread", "?", "null", "unknown", "could not be read"].includes(s)) return null;
  return undefined;
}

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[;|\n]/) : []).map((s) => s.trim()).filter(Boolean);

/** The columns of a pasted sheet, by the names people give them. */
const COLUMN: [RegExp, string][] = [
  [/^(engine|assistant)$/, "engine"],
  [/^(question|prompt|query)$/, "question"],
  [/^(lang|language)$/, "lang"],
  [/^(day|date)$/, "day"],
  [/^kind$/, "kind"],
  [/^(named|mentioned|balkaris)$/, "mentioned"],
  [/^(position|place|rank)$/, "position"],
  [/^(companies|competitors|named companies)$/, "competitors"],
  [/^(sources|cited|citations)$/, "sources"],
  [/^(excerpt|said|summary)$/, "excerpt"],
  [/^notes?$/, "note"],
];

export interface RoundDefaults {
  /** The assistant and the day chosen in the form, for lines that do not say. */
  engine?: AiEngine;
  day?: string;
  /** The language and kind of questions asked before, by key. */
  known?: Map<string, { lang: "de" | "en"; kind: AiCheckRow["kind"] }>;
}

/**
 * A round of answers pasted as text: JSON (a list of checks, or { checks }),
 * or a sheet as CSV with a header row (assistant, question, named, place,
 * companies, sources, said, note …; lists split by ";" or "|"). What a line
 * leaves out is taken from the form's assistant and day, then from the same
 * question's earlier record (language, kind), then guessed from its words
 * (language) or set to "category" (kind). Nothing is recorded here: the
 * checks still go through checkRefusal. A line that cannot be read is said.
 */
export function parseRound(text: string, d: RoundDefaults = {}): { checks: Partial<NewAiCheck>[]; problems: string[] } {
  const t = text.replace(/^﻿/, "").trim();
  const problems: string[] = [];
  let raw: Record<string, unknown>[] = [];
  if (!t) return { checks: [], problems: ["Nothing was pasted."] };
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as unknown;
      const list = Array.isArray(j) ? j : j && typeof j === "object" && Array.isArray((j as { checks?: unknown }).checks) ? (j as { checks: unknown[] }).checks : null;
      if (!list) return { checks: [], problems: ["The JSON is neither a list of answers nor { checks: [...] }."] };
      raw = list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
      if (raw.length < list.length) problems.push(`${list.length - raw.length} entries are not objects and were left out.`);
    } catch (e) {
      return { checks: [], problems: [`The text starts like JSON and cannot be read as JSON: ${e instanceof Error ? e.message : String(e)}`] };
    }
  } else {
    const cells = parseCsv(t);
    const header = (cells[0] ?? []).map((c) => c.trim().toLowerCase());
    const names = header.map((h) => COLUMN.find(([re]) => re.test(h))?.[1] ?? null);
    if (!names.includes("question")) return { checks: [], problems: ['The first line must name the columns, and one of them must be "question". Others: assistant, day, lang, kind, named, place, companies, sources, said, note.'] };
    raw = cells.slice(1).map((r) => Object.fromEntries(names.flatMap((n, i): [string, string][] => (n && (r[i] ?? "").trim() ? [[n, (r[i] ?? "").trim()]] : []))));
  }
  const out: Partial<NewAiCheck>[] = [];
  for (const [i, r] of raw.entries()) {
    const question = typeof r.question === "string" ? r.question.trim() : "";
    if (!question) {
      problems.push(`line ${i + 1}: no question.`);
      continue;
    }
    const known = d.known?.get(qKey(question));
    const named = namedOf(r.mentioned ?? r.named);
    if (named === undefined) {
      problems.push(`line ${i + 1}: whether the answer named Balkaris must be yes, no or unread.`);
      continue;
    }
    const engine = r.engine === undefined || r.engine === "" ? d.engine : engineOf(r.engine);
    if (!engine) {
      problems.push(`line ${i + 1}: ${r.engine ? `“${String(r.engine).slice(0, 40)}” is not an assistant the desk knows` : "no assistant"}.`);
      continue;
    }
    const position = r.position === undefined || r.position === null || r.position === "" ? null : Number(r.position);
    out.push({
      engine,
      question,
      lang: r.lang === "de" || r.lang === "en" ? r.lang : (known?.lang ?? guessLang(question)),
      day: typeof r.day === "string" && r.day ? r.day : d.day,
      kind: typeof r.kind === "string" && (KINDS as readonly string[]).includes(r.kind) ? (r.kind as AiCheckRow["kind"]) : (known?.kind ?? "category"),
      mentioned: named,
      position,
      competitors: listOf(r.competitors),
      sources: listOf(r.sources),
      excerpt: typeof r.excerpt === "string" && r.excerpt.trim() ? r.excerpt.trim() : null,
      note: typeof r.note === "string" && r.note.trim() ? r.note.trim() : null,
    });
  }
  return { checks: out, problems };
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
