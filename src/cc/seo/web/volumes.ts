import { HTTPException } from "hono/http-exception";
import type { KeywordVolume, PlannerImport, WebLang } from "../../../../web/src/contract/seo/common.ts";
import { db } from "../../../db.ts";
import { note } from "../../store.ts";
import { upsertKeyword } from "../keywords.ts";
import { now } from "../tables.ts";
import { langOf, normal } from "../words.ts";
import * as dfs from "./dataforseo.ts";
import { asLang, said } from "./shared.ts";

/**
 * DEMAND FIGURES ON KEYWORDS: monthly searches, cost per click, competition
 * and difficulty, each kept on the keyword's row (cc_seo_keywords, columns
 * added by tables.ts) with WHERE it came from and WHEN. A keyword nobody gave
 * a figure for has none: null, never 0.
 *
 *   importPlannerCsv   a Google Keyword Planner export a person downloaded
 *                      ("Download keyword ideas"): UTF-16 tab-separated with
 *                      a two-line preamble as Planner writes it, or UTF-8
 *                      comma-separated as a spreadsheet saves it again.
 *                      Without ad spend Planner gives ranges ("100 – 1K"),
 *                      kept as low and high with no single volume.
 *   refreshVolumes     through DataForSEO when it is configured: Google Ads
 *                      figures for up to 1,000 phrases a call per language
 *                      ($0.09 a call), and Labs' difficulty for German, French
 *                      and Italian (there is no English Labs database for
 *                      Switzerland, so English phrases get no difficulty).
 */

interface VolDb {
  id: number;
  phrase: string;
  lang: string | null;
  volume: number | null;
  volume_low: number | null;
  volume_high: number | null;
  cpc: number | null;
  cpc_currency: string | null;
  competition: string | null;
  competition_index: number | null;
  volume_source: string | null;
  volume_at: string | null;
  difficulty: number | null;
  difficulty_source: string | null;
  difficulty_at: string | null;
}

const toVolume = (r: VolDb): KeywordVolume | null => {
  if (!r.volume_source || !r.volume_at) {
    return r.difficulty !== null && r.difficulty_at
      ? { volume: null, low: null, high: null, cpc: null, currency: null, competition: null, competitionIndex: null, source: "dataforseo", at: r.difficulty_at, difficulty: { value: r.difficulty, at: r.difficulty_at } }
      : null;
  }
  const comp = r.competition === "low" || r.competition === "medium" || r.competition === "high" ? r.competition : null;
  return {
    volume: r.volume,
    low: r.volume_low,
    high: r.volume_high,
    cpc: r.cpc,
    currency: r.cpc_currency,
    competition: comp,
    competitionIndex: r.competition_index,
    source: r.volume_source === "dataforseo" ? "dataforseo" : "planner",
    at: r.volume_at,
    difficulty: r.difficulty !== null && r.difficulty_at ? { value: r.difficulty, at: r.difficulty_at } : null,
  };
};

const COLS = "id, phrase, lang, volume, volume_low, volume_high, cpc, cpc_currency, competition, competition_index, volume_source, volume_at, difficulty, difficulty_source, difficulty_at";

/** The demand figures of these keywords, by id; a keyword with none is absent from the map. */
export function volumesOf(ids: readonly number[]): Map<number, KeywordVolume> {
  const out = new Map<number, KeywordVolume>();
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    if (!part.length) continue;
    for (const r of db.prepare(`SELECT ${COLS} FROM cc_seo_keywords WHERE id IN (${part.map(() => "?").join(",")})`).all(...part) as unknown as VolDb[]) {
      const v = toVolume(r);
      if (v) out.set(r.id, v);
    }
  }
  return out;
}

/** Every keyword's figures, by id (one query for a whole page of keywords). */
export function allVolumes(): Map<number, KeywordVolume> {
  const out = new Map<number, KeywordVolume>();
  for (const r of db.prepare(`SELECT ${COLS} FROM cc_seo_keywords WHERE volume_source IS NOT NULL OR difficulty IS NOT NULL`).all() as unknown as VolDb[]) {
    const v = toVolume(r);
    if (v) out.set(r.id, v);
  }
  return out;
}

/* ---------- Keyword Planner's export ------------------------------------------------------------ */

/** "1K" 1000, "10K" 10000, "1M"; "1,300" or "1'300" or "1.300" 1300. Null when it is not a number. */
export function plannerNumber(s: string): number | null {
  const t = s.replace(/[\s  '’]/g, "").trim();
  if (!t || t === "-" || t === "--") return null;
  const m = /^(\d+(?:[.,]\d+)?)([KkMm])$/.exec(t);
  if (m) return Math.round(Number(m[1]!.replace(",", ".")) * (m[2]!.toLowerCase() === "k" ? 1000 : 1_000_000));
  /* A thousands separator (1,300 / 1.300) when what follows it is three digits; else a decimal point. */
  const n = /^\d{1,3}([.,]\d{3})+$/.test(t) ? Number(t.replace(/[.,]/g, "")) : Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "100 – 1K" as low and high; "1300" as both. */
export function plannerRange(s: string): { volume: number | null; low: number | null; high: number | null } {
  const parts = s.split(/\s*[–—-]\s*/).filter((p) => p.trim());
  if (parts.length === 2) {
    const low = plannerNumber(parts[0]!);
    const high = plannerNumber(parts[1]!);
    return { volume: null, low, high };
  }
  const n = plannerNumber(s);
  return { volume: n, low: n, high: n };
}

/** Planner's text, whatever it was saved as: UTF-16 with its byte-order mark, or UTF-8. */
function textOf(input: string | Buffer | Uint8Array): string {
  if (typeof input === "string") return input.replace(/^﻿/, "");
  const b = Buffer.from(input);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  /* UTF-16 without a mark: every other byte of ASCII text is zero. */
  if (b.length > 4 && b[1] === 0 && b[3] === 0) return new TextDecoder("utf-16le").decode(b);
  return new TextDecoder("utf-8").decode(b).replace(/^﻿/, "");
}

/** One line of a CSV or TSV, quotes understood. */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** The columns Planner writes, in English and German (the UI language decides). */
const COLUMN = {
  keyword: /^(keyword|suchbegriff|keyword-idee|mot clé|mot-clé|parola chiave)$/i,
  currency: /^(currency|währung|devise|valuta)$/i,
  volume: /^(avg\. monthly searches|durchschn\. suchanfragen pro monat|durchschnittl\. suchanfragen pro monat|recherches mensuelles moyennes|ricerche mensili medie)$/i,
  competition: /^(competition|wettbewerb|concurrence|concorrenza)$/i,
  competitionIndex: /^(competition \(indexed value\)|wettbewerb \(indexierter wert\)|concurrence \(valeur indexée\)|concorrenza \(valore indicizzato\))$/i,
  bidLow: /^(top of page bid \(low range\)|gebot für obere positionen \(niedriger bereich\)|enchère en haut de page \(plage basse\)|offerta per la parte superiore della pagina \(intervallo basso\))$/i,
  bidHigh: /^(top of page bid \(high range\)|gebot für obere positionen \(hoher bereich\)|enchère en haut de page \(plage haute\)|offerta per la parte superiore della pagina \(intervallo alto\))$/i,
};

const COMPETITION: Record<string, "low" | "medium" | "high"> = { low: "low", niedrig: "low", faible: "low", bassa: "low", medium: "medium", mittel: "medium", moyenne: "medium", media: "medium", high: "high", hoch: "high", élevée: "high", elevee: "high", alta: "high" };

/**
 * Read a Keyword Planner export into the keyword table's figures. Each phrase
 * is matched to its row by the table's own spelling; a phrase the table does
 * not have is added (unjudged, source manual, by the person) unless
 * `addMissing` is false. The figures replace the row's earlier ones and say
 * "planner" and today. Throws 400 when the file is not a Planner export.
 */
export function importPlannerCsv(input: string | Buffer | Uint8Array, by: string, o: { lang?: WebLang; addMissing?: boolean } = {}): PlannerImport {
  const text = textOf(input);
  const lines = text.split(/\r?\n/);
  /* The header is the first line that names the keyword column; what is above it is Planner's preamble. */
  let head = -1;
  let sep = "\t";
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    for (const s of ["\t", ",", ";"]) {
      if (cells(lines[i]!, s).some((c) => COLUMN.keyword.test(c))) {
        head = i;
        sep = s;
        break;
      }
    }
    if (head >= 0) break;
  }
  if (head < 0) throw new HTTPException(400, { message: "That is not a Keyword Planner export: no column called Keyword in its first lines. Download it from Keyword Planner with Download keyword ideas, as CSV." });
  const names = cells(lines[head]!, sep);
  const col = (re: RegExp): number => names.findIndex((n) => re.test(n));
  const at = {
    keyword: col(COLUMN.keyword),
    currency: col(COLUMN.currency),
    volume: col(COLUMN.volume),
    competition: col(COLUMN.competition),
    competitionIndex: col(COLUMN.competitionIndex),
    bidLow: col(COLUMN.bidLow),
    bidHigh: col(COLUMN.bidHigh),
  };
  if (at.volume < 0) throw new HTTPException(400, { message: "That export has no column of average monthly searches; download the keyword ideas with their search figures." });
  /* The period line ("1. Oktober 2025 - 30. September 2026"), not the title line with its export date ("Keyword Stats 2026-10-05 at 09_14_03"). */
  const period = lines.slice(0, head).map((l) => cells(l, sep)[0] ?? "").find((l) => /\d{4}/.test(l) && /\s[-–]\s/.test(l)) ?? null;

  const out: PlannerImport = { rows: 0, matched: 0, added: 0, skipped: [], currency: null, period, line: "" };
  const day = now();
  const find = db.prepare("SELECT id FROM cc_seo_keywords WHERE phrase = ?");
  const put = db.prepare(
    "UPDATE cc_seo_keywords SET volume = ?, volume_low = ?, volume_high = ?, cpc = ?, cpc_currency = ?, competition = ?, competition_index = ?, volume_source = 'planner', volume_at = ? WHERE id = ?",
  );
  for (let i = head + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;
    const c = cells(raw, sep);
    const phrase = normal(c[at.keyword] ?? "");
    if (phrase.length < 2) {
      out.skipped.push({ line: i + 1, why: "no keyword" });
      continue;
    }
    out.rows++;
    const range = plannerRange(c[at.volume] ?? "");
    if (range.volume === null && range.low === null && range.high === null) {
      out.skipped.push({ line: i + 1, why: `no search figure for "${phrase}"` });
      continue;
    }
    const currency = at.currency >= 0 ? (c[at.currency] || null) : null;
    out.currency ??= currency;
    const low = at.bidLow >= 0 ? plannerNumber(c[at.bidLow] ?? "") : null;
    const high = at.bidHigh >= 0 ? plannerNumber(c[at.bidHigh] ?? "") : null;
    /* Planner gives no single CPC: the middle of its top-of-page bid range stands in, named so in the note. */
    const cpc = low !== null && high !== null ? Math.round(((low + high) / 2) * 100) / 100 : (high ?? low);
    const comp = at.competition >= 0 ? (COMPETITION[(c[at.competition] ?? "").toLowerCase()] ?? null) : null;
    const ci = at.competitionIndex >= 0 ? plannerNumber(c[at.competitionIndex] ?? "") : null;
    let id = (find.get(phrase) as { id: number } | undefined)?.id;
    if (!id && o.addMissing !== false) {
      upsertKeyword({ phrase, lang: o.lang ?? langOf(phrase), source: "manual", by, note: "From a Keyword Planner export" }, day);
      id = (find.get(phrase) as { id: number } | undefined)?.id;
      if (id) out.added++;
    } else if (id) out.matched++;
    if (!id) {
      out.skipped.push({ line: i + 1, why: `"${phrase}" is not in the keyword table` });
      continue;
    }
    put.run(range.volume, range.low, range.high, cpc, currency, comp, ci, day, id);
  }
  out.line = `${out.rows} phrase${out.rows === 1 ? "" : "s"} read from the Keyword Planner export${out.period ? ` (${out.period})` : ""}: ${out.matched} already in the keyword table, ${out.added} added${out.skipped.length ? `, ${out.skipped.length} skipped` : ""}.`;
  if (out.matched + out.added) {
    note("seo-keywords", `Imported Keyword Planner figures for ${out.matched + out.added} phrase${out.matched + out.added === 1 ? "" : "s"}`, { tone: "info", detail: out.line, href: "/seo/keywords", actor: by, dedupe: `seo:planner:${day}` });
  }
  return out;
}

/* ---------- through DataForSEO ------------------------------------------------------------------- */

/**
 * Buy figures for these keywords from DataForSEO: Google Ads volumes, CPC and
 * competition per language, and Labs' difficulty where Labs has the language.
 * Throws 409 with the owner's step when DataForSEO is not connected. Returns a
 * sentence with what was bought and for how much.
 */
export async function refreshVolumes(ids: readonly number[], by: string): Promise<{ updated: number; difficulty: number; cost: number; line: string }> {
  if (!dfs.configured()) throw new HTTPException(409, { message: `Search volumes come from DataForSEO, which is not connected: no account exists. ${dfs.step()}` });
  const rows = ids.length
    ? (db.prepare(`SELECT id, phrase, lang FROM cc_seo_keywords WHERE id IN (${ids.slice(0, 5000).map(() => "?").join(",")})`).all(...ids.slice(0, 5000)) as { id: number; phrase: string; lang: string | null }[])
    : [];
  if (!rows.length) throw new HTTPException(400, { message: "Choose the keywords to look up first." });
  const byLang = new Map<WebLang, { id: number; phrase: string }[]>();
  for (const r of rows) {
    const lang = asLang(r.lang ?? langOf(r.phrase) ?? "de");
    byLang.set(lang, [...(byLang.get(lang) ?? []), r]);
  }
  let updated = 0;
  let difficulty = 0;
  let cost = 0;
  const problems: string[] = [];
  const day = now();
  const putVol = db.prepare("UPDATE cc_seo_keywords SET volume = ?, volume_low = ?, volume_high = ?, cpc = ?, cpc_currency = 'USD', competition = ?, competition_index = ?, volume_source = 'dataforseo', volume_at = ? WHERE id = ?");
  const putDiff = db.prepare("UPDATE cc_seo_keywords SET difficulty = ?, difficulty_source = 'dataforseo', difficulty_at = ? WHERE id = ?");
  for (const [lang, list] of byLang) {
    for (let i = 0; i < list.length; i += 1000) {
      const part = list.slice(i, i + 1000);
      const idOf = new Map(part.map((r) => [r.phrase, r.id]));
      try {
        const v = await dfs.searchVolume(part.map((r) => r.phrase), lang);
        cost += v.cost;
        for (const row of v.rows) {
          const id = idOf.get(normal(row.keyword));
          if (!id) continue;
          putVol.run(row.volume, row.volume, row.volume, row.cpc, row.competition, row.competitionIndex, day, id);
          updated++;
        }
      } catch (e) {
        problems.push(`volumes in ${lang}: ${said(e)}`);
      }
      if (lang === "en") continue;
      try {
        const d = await dfs.keywordDifficulty(part.map((r) => r.phrase), lang);
        cost += d.cost;
        for (const row of d.rows) {
          const id = idOf.get(normal(row.keyword));
          if (!id) continue;
          putDiff.run(row.difficulty, day, id);
          difficulty++;
        }
      } catch (e) {
        problems.push(`difficulty in ${lang}: ${said(e)}`);
      }
    }
  }
  const line = `DataForSEO gave volumes for ${updated} and difficulty for ${difficulty} of ${rows.length} keyword${rows.length === 1 ? "" : "s"} for $${cost.toFixed(3)}${byLang.has("en") ? " (English has no difficulty for Switzerland)" : ""}${problems.length ? `; not answered: ${problems.join("; ")}` : ""}.`;
  if (updated || difficulty) note("seo-keywords", `Bought search volumes for ${updated} keyword${updated === 1 ? "" : "s"} from DataForSEO`, { tone: "info", detail: line, href: "/seo/keywords", actor: by, dedupe: `seo:dfs:volumes:${day}` });
  return { updated, difficulty, cost, line };
}
