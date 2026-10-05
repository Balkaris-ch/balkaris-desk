import { HTTPException } from "hono/http-exception";
import type { ResearchMode, ResearchResult, ResearchSourceLine, SuggestSource, WebLang, WebSuggestion } from "../../../../web/src/contract/seo/common.ts";
import { db } from "../../../db.ts";
import { UA } from "../../site/http.ts";
import { upsertKeyword } from "../keywords.ts";
import { json, now } from "../tables.ts";
import { flagsOf, langOf, normal } from "../words.ts";
import { filer } from "./filing.ts";
import { acceptLanguage, allowance, asCountry, asLang, clock, envInt, pace, pause, paused, said, spend, untilTomorrow, whenText, type Allowance } from "./shared.ts";

/**
 * RESEARCH A PHRASE ON THE REAL WEB, when a person asks: what people in
 * Switzerland type around it, from the search engines' own suggestions.
 *
 *   google   www.google.com/complete/search, client=chrome: up to 15
 *            completions, each with Google's ordering strength
 *            (google:suggestrelevance, about 550 to 1300) and type. The
 *            strength orders the list; it is NEVER a search volume, and is
 *            never called one.
 *   bing     api.bing.com/osjson.aspx with the market, cc=CH and setlang: up
 *            to 12 completions, no strength.
 *
 * Not asked: Brave's suggestions refuse Node's own fetch (429 on 5 October
 * 2026, while curl was answered), and DuckDuckGo, Ecosia, Qwant and
 * Swisscows return Bing's list word for word (the keyword research of 5
 * October 2026), so they would add requests and nothing else.
 *
 * MODES, each a list of requests (`requestsFor`):
 *   plain      the phrase itself (Google and Bing)
 *   questions  the phrase behind each question word of its language: de was,
 *              wie, warum, welche, wo, wann, "was kostet"; en how, what, why,
 *              which, where, "how much"; fr comment, combien, pourquoi, quel;
 *              it come, quanto, perché, quale (Google and Bing). The price
 *              question is asked the way people ask it ("was kostet …"),
 *              not as a bare "kosten" in front.
 *   modifiers  the phrase followed by price, place and intent words of its
 *              language (kosten, preis, agentur, zürich, schweiz, beispiele,
 *              vergleich, firma …), a word the phrase already has left out
 *              (Google and Bing)
 *   alphabet   the phrase followed by a to z: 26 Google requests, so only
 *              when asked for
 *   front      what people put IN FRONT of the phrase: Google with cp=0 and
 *              a leading space (" agentur zürich" gives seo, marketing,
 *              branding … agentur zürich)
 *
 * WHAT IT COSTS AND WHAT STOPS IT. One request a second per host. What one
 * source answered for one mode is kept seven days in cc_seo_research, so a
 * second look costs nothing. People's research has its own allowance, 400
 * requests a Zurich day (SEO_RESEARCH_DAILY), apart from the weekly job's 120
 * (keywords.ts); a research that does not fit is cut at a whole mode and says
 * so. A 429 or 403 from a source pauses that source until midnight in Zurich
 * ("Google refused; paused until tomorrow"); a 5xx or no answer costs that
 * source this research only.
 */

const COUNT_KEY = "seo:web:research:day";
const PAUSE_KEY: Record<SuggestSource, string> = { google: "seo:web:suggest:pause:google", bing: "seo:web:suggest:pause:bing" };
export const researchCap = (): number => envInt("SEO_RESEARCH_DAILY", 400, 10, 5000);
const KEEP_MS = 7 * 86_400_000;
const GAP_MS = 1000;

const HOST: Record<SuggestSource, string> = { google: "www.google.com", bing: "api.bing.com" };
export const SOURCE_LABEL: Record<SuggestSource, string> = { google: "Google suggestions", bing: "Bing suggestions" };

export const ALL_MODES: readonly ResearchMode[] = ["plain", "questions", "modifiers", "alphabet", "front"];
/** What a research asks when nobody says: everything but the costly a to z. */
export const DEFAULT_MODES: readonly ResearchMode[] = ["plain", "questions", "modifiers", "front"];

/** The question words of each language, put in front of the phrase. */
export const QUESTION_WORDS: Record<WebLang, readonly string[]> = {
  de: ["was", "wie", "warum", "welche", "wo", "wann", "was kostet"],
  en: ["how", "what", "why", "which", "where", "how much"],
  fr: ["comment", "combien", "pourquoi", "quel"],
  it: ["come", "quanto", "perché", "quale"],
};

/** Price, place and intent words of each language, put behind the phrase. */
export const MODIFIERS: Record<WebLang, readonly string[]> = {
  de: ["kosten", "preis", "agentur", "zürich", "schweiz", "beispiele", "vergleich", "firma"],
  en: ["cost", "price", "agency", "zurich", "switzerland", "examples", "vs", "company"],
  fr: ["prix", "coût", "agence", "genève", "lausanne", "suisse", "exemples", "comparatif"],
  it: ["prezzi", "costo", "agenzia", "lugano", "ticino", "svizzera", "esempi", "confronto"],
};

/** Which sources a mode asks. */
const ASKS: Record<ResearchMode, readonly SuggestSource[]> = { plain: ["google", "bing"], questions: ["google", "bing"], modifiers: ["google", "bing"], alphabet: ["google"], front: ["google"] };

export interface SuggestRequest {
  source: SuggestSource;
  mode: ResearchMode;
  /** What is typed, exactly ("was kostet webdesign zürich", " agentur zürich"). */
  q: string;
  /** Google's cursor at the start: complete what goes in front. */
  front: boolean;
}

/** The requests one mode makes for a phrase, in order, for every source it asks. Pure: the check proves the lists. */
export function requestsFor(seed: string, lang: WebLang, mode: ResearchMode): SuggestRequest[] {
  const s = normal(seed);
  const words = new Set(s.split(" "));
  const typed: { q: string; front: boolean }[] =
    mode === "plain"
      ? [{ q: s, front: false }]
      : mode === "questions"
        ? QUESTION_WORDS[lang].filter((w) => !s.startsWith(`${w} `)).map((w) => ({ q: `${w} ${s}`, front: false }))
        : mode === "modifiers"
          ? MODIFIERS[lang].filter((m) => !words.has(m) && !(m === "zürich" && words.has("zurich")) && !(m === "zurich" && words.has("zürich"))).map((m) => ({ q: `${s} ${m}`, front: false }))
          : mode === "alphabet"
            ? "abcdefghijklmnopqrstuvwxyz".split("").map((l) => ({ q: `${s} ${l}`, front: false }))
            : [{ q: ` ${s}`, front: true }];
  return ASKS[mode].flatMap((source) => typed.map((t) => ({ source, mode, q: t.q, front: source === "google" && t.front })));
}

/* ---------- asking, and reading the answers ------------------------------------------------- */

interface Raw {
  status: number;
  contentType: string | null;
  body: Buffer;
}

async function get(url: string, lang: WebLang, country: string): Promise<Raw> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json,text/javascript;q=0.9,*/*;q=0.5", "accept-language": acceptLanguage(lang, country) }, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, contentType: res.headers.get("content-type"), body: Buffer.from(await res.arrayBuffer()).subarray(0, 200_000) };
}

/** The markets Bing knows for Switzerland's languages; English as Britain's, which Bing answers best for Swiss English. */
const BING_MARKET: Record<WebLang, string> = { de: "de-CH", fr: "fr-CH", it: "it-CH", en: "en-GB" };

/** Where the research asks. The check script replaces both with the fixtures. */
export const wire = {
  google: (q: string, lang: WebLang, country: string, front: boolean): Promise<Raw> =>
    get(`https://www.google.com/complete/search?client=chrome&hl=${lang}&gl=${country}${front ? "&cp=0" : ""}&q=${encodeURIComponent(q)}`, lang, country),
  bing: (q: string, lang: WebLang, country: string): Promise<Raw> =>
    get(`https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}&market=${BING_MARKET[lang]}&cc=${country.toUpperCase()}&setlang=${lang}`, lang, country),
};

/** Bytes as text by the charset the answer names: Google's suggestions come as ISO-8859-1. */
export function decodeAnswer(body: Buffer, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(charset === "iso-8859-1" ? "latin1" : charset).decode(body);
  } catch {
    return body.toString("utf8");
  }
}

export interface SuggestRow {
  phrase: string;
  strength: number | null;
  type: string | null;
}

/** Google's client=chrome answer: [q, [phrases], [descriptions], [], { "google:suggestrelevance": [...], "google:suggesttype": [...] }]. */
export function parseGoogleSuggest(text: string): SuggestRow[] | null {
  try {
    const v = JSON.parse(text) as unknown[];
    if (!Array.isArray(v) || !Array.isArray(v[1])) return null;
    const meta = (v[4] ?? {}) as { "google:suggestrelevance"?: unknown[]; "google:suggesttype"?: unknown[] };
    return (v[1] as unknown[]).map((p, i) => ({
      phrase: String(p),
      strength: typeof meta["google:suggestrelevance"]?.[i] === "number" ? (meta["google:suggestrelevance"][i] as number) : null,
      type: typeof meta["google:suggesttype"]?.[i] === "string" ? (meta["google:suggesttype"][i] as string) : null,
    }));
  } catch {
    return null;
  }
}

/** Bing's OpenSearch answer: [q, [phrases], …]. Its relevance list is only a rank, so it is not kept. */
export function parseBingSuggest(text: string): SuggestRow[] | null {
  try {
    const v = JSON.parse(text) as unknown[];
    if (!Array.isArray(v) || !Array.isArray(v[1])) return null;
    return (v[1] as unknown[]).map((p) => ({ phrase: String(p), strength: null, type: null }));
  } catch {
    return null;
  }
}

/* ---------- the allowance, the pauses, the kept answers ------------------------------------- */

/** Today's person-asked research allowance. */
export const researchAllowance = (): Allowance => allowance(COUNT_KEY, researchCap());

/** A source's pause after a refusal, or null. */
export const sourcePaused = (s: SuggestSource): { until: string; why: string } | null => {
  const p = paused(PAUSE_KEY[s]);
  return p ? { until: p.until, why: p.why } : null;
};

interface KeptRow {
  phrase: string;
  strength: number | null;
  type: string | null;
  /** The request that found it. */
  via: string;
}

function keptAnswer(seed: string, lang: WebLang, country: string, mode: ResearchMode, source: SuggestSource): { rows: KeptRow[]; requests: number; at: string } | null {
  const r = db.prepare("SELECT rows, requests, asked_at FROM cc_seo_research WHERE seed = ? AND lang = ? AND country = ? AND mode = ? AND source = ?").get(seed, lang, country, mode, source) as
    | { rows: string; requests: number; asked_at: string }
    | undefined;
  if (!r || clock.now() - Date.parse(r.asked_at) > KEEP_MS) return null;
  return { rows: json<KeptRow[]>(r.rows, []), requests: r.requests, at: r.asked_at };
}

function keepAnswer(seed: string, lang: WebLang, country: string, mode: ResearchMode, source: SuggestSource, rows: KeptRow[], requests: number, by: string): void {
  db.prepare(
    "INSERT INTO cc_seo_research (seed, lang, country, mode, source, rows, requests, asked_by, asked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(seed, lang, country, mode, source) DO UPDATE SET rows = excluded.rows, requests = excluded.requests, asked_by = excluded.asked_by, asked_at = excluded.asked_at",
  ).run(seed, lang, country, mode, source, JSON.stringify(rows), requests, by, new Date(clock.now()).toISOString());
}

/** How many requests a research would send now, and how many its kept answers save. */
export function researchCost(seed: string, lang: WebLang, country: string, modes: readonly ResearchMode[]): { send: number; kept: number } {
  const s = normal(seed);
  let send = 0;
  let kept = 0;
  for (const mode of modes) {
    for (const source of ASKS[mode]) {
      const n = requestsFor(s, lang, mode).filter((r) => r.source === source).length;
      if (keptAnswer(s, lang, country, mode, source)) kept += n;
      else send += n;
    }
  }
  return { send, kept };
}

/* ---------- the research ------------------------------------------------------------------------ */

export interface ResearchAsk {
  seed: string;
  /** de, en, fr or it; the phrase's own language when it shows, else German. */
  lang?: string;
  country?: string;
  /** Default: plain, questions, modifiers, front. "alphabet" only when named. */
  modes?: readonly string[];
  /** Who asked: a person's name. */
  by: string;
  /** Ask again even when the last seven days' answers are kept. */
  fresh?: boolean;
}

/** fr and it question words, which words.ts (German and English) does not know. */
const QUESTION_MORE = /^(comment|combien|pourquoi|quel|quelle|quels|quelles|qui|où|quand|est-ce|come|quanto|quanta|perché|quale|quali|chi|dove|quando|cosa|che cosa)\b/;

interface Job {
  mode: ResearchMode;
  source: SuggestSource;
  requests: SuggestRequest[];
}

/**
 * Research a phrase: every suggestion once, with the sources that offered
 * it, Google's strength and type, the mode and request that found it, whether
 * it is a question, the keyword table's row when the desk tracks it, and the
 * cluster the desk's rule files it under. Throws 400 for a phrase that is no
 * phrase, 429 when today's allowance is used and nothing is kept.
 */
export async function researchPhrase(a: ResearchAsk): Promise<ResearchResult> {
  const seed = normal(String(a.seed ?? ""));
  if (seed.length < 2 || seed.length > 80) throw new HTTPException(400, { message: "Type the phrase to research: 2 to 80 characters." });
  const lang = asLang(a.lang ?? langOf(seed) ?? "de");
  const country = asCountry(a.country);
  const asked = (a.modes ?? DEFAULT_MODES).filter((m): m is ResearchMode => ALL_MODES.includes(m as ResearchMode));
  const modes = ALL_MODES.filter((m) => asked.includes(m));
  if (!modes.length) throw new HTTPException(400, { message: `Name at least one way to research it: ${ALL_MODES.join(", ")}.` });
  const by = (a.by || "desk").slice(0, 80);

  /* What is kept, and what must be asked. */
  const answers: { mode: ResearchMode; source: SuggestSource; rows: KeptRow[] }[] = [];
  const jobs: Job[] = [];
  const lines = new Map<SuggestSource, ResearchSourceLine>();
  const lineOf = (s: SuggestSource): ResearchSourceLine => {
    let l = lines.get(s);
    if (!l) {
      l = { source: s, label: SOURCE_LABEL[s], state: "skipped", sent: 0, line: "" };
      lines.set(s, l);
    }
    return l;
  };
  let kept = 0;
  let oldest = new Date(clock.now()).toISOString();
  for (const mode of modes) {
    for (const source of ASKS[mode]) {
      lineOf(source);
      const had = a.fresh ? null : keptAnswer(seed, lang, country, mode, source);
      if (had) {
        answers.push({ mode, source, rows: had.rows });
        kept += had.requests;
        if (had.at < oldest) oldest = had.at;
        const l = lineOf(source);
        if (l.state === "skipped") l.state = "kept";
        continue;
      }
      jobs.push({ mode, source, requests: requestsFor(seed, lang, mode).filter((r) => r.source === source) });
    }
  }

  /* A paused source is not asked; the rest is cut at whole modes to what today's allowance holds. */
  const stops: string[] = [];
  for (const s of ["google", "bing"] as const) {
    const p = sourcePaused(s);
    if (p && jobs.some((j) => j.source === s)) {
      const l = lineOf(s);
      l.state = "refused";
      l.line = `${p.why}; paused until ${whenText(p.until)}.`;
    }
  }
  const runnable = jobs.filter((j) => !sourcePaused(j.source));
  const left = researchAllowance().left;
  const fits: Job[] = [];
  let need = 0;
  for (const j of runnable) {
    if (need + j.requests.length > left) continue;
    fits.push(j);
    need += j.requests.length;
  }
  if (fits.length < runnable.length) {
    const cut = runnable.length - fits.length;
    stops.push(`Today's allowance of ${researchCap()} research requests has ${left} left, so ${cut} of the ${runnable.length} parts not kept from the last seven days ${cut === 1 ? "was" : "were"} not asked; they can be asked tomorrow.`);
    if (!fits.length && !answers.length) {
      throw new HTTPException(429, { message: `Today's ${researchCap()} research requests are used. The allowance starts again at midnight; what was researched in the last seven days can still be looked at.` });
    }
  }

  /* Each source in its own lane, one request a second; the two lanes run side by side. */
  const runLane = async (source: SuggestSource): Promise<void> => {
    const l = lineOf(source);
    for (const job of fits.filter((j) => j.source === source)) {
      const rows: KeptRow[] = [];
      let complete = true;
      for (const req of job.requests) {
        if (!spend(COUNT_KEY, researchCap())) {
          complete = false;
          stops.push(`Today's allowance of ${researchCap()} research requests ran out during the research.`);
          break;
        }
        await pace(HOST[source], GAP_MS);
        l.sent++;
        let raw: Raw;
        try {
          raw = source === "google" ? await wire.google(req.q, lang, country, req.front) : await wire.bing(req.q, lang, country);
        } catch (e) {
          complete = false;
          l.state = "refused";
          l.line = `${source === "google" ? "Google" : "Bing"} did not answer (${said(e)}); the rest of its part was not asked.`;
          break;
        }
        if (raw.status === 429 || raw.status === 403) {
          const p = pause(PAUSE_KEY[source], untilTomorrow(), `${source === "google" ? "Google" : "Bing"} refused (${raw.status})`);
          complete = false;
          l.state = "refused";
          l.line = `${p.why}; paused until tomorrow (${whenText(p.until)}).`;
          stops.push(`${p.why} after ${l.sent} request${l.sent === 1 ? "" : "s"}; paused until tomorrow.`);
          break;
        }
        if (raw.status !== 200) {
          complete = false;
          l.state = "refused";
          l.line = `${source === "google" ? "Google" : "Bing"} answered ${raw.status}; the rest of its part was not asked.`;
          break;
        }
        const text = decodeAnswer(raw.body, raw.contentType);
        const got = source === "google" ? parseGoogleSuggest(text) : parseBingSuggest(text);
        if (!got) {
          complete = false;
          l.state = "refused";
          l.line = `${source === "google" ? "Google" : "Bing"} answered with something the desk cannot read; its answer layout may have changed.`;
          break;
        }
        const typed = normal(req.q);
        for (const g of got) {
          const phrase = normal(g.phrase);
          /* Bing repeats what was typed as its first row: an echo, not a suggestion. */
          if (!phrase || (source === "bing" && phrase === typed)) continue;
          rows.push({ phrase, strength: g.strength, type: g.type, via: req.q.trim() });
        }
      }
      answers.push({ mode: job.mode, source, rows });
      if (complete) keepAnswer(seed, lang, country, job.mode, source, rows, job.requests.length, by);
      else break;
      if (l.state !== "refused") l.state = "asked";
    }
  };
  await Promise.all([runLane("google"), runLane("bing")]);

  /* Every suggestion once. */
  const merged = new Map<string, WebSuggestion & { order: number }>();
  let order = 0;
  for (const mode of modes) {
    for (const ans of answers.filter((x) => x.mode === mode)) {
      for (const r of ans.rows) {
        const had = merged.get(r.phrase);
        if (!had) {
          const f = flagsOf(r.phrase);
          merged.set(r.phrase, {
            phrase: r.phrase,
            sources: [ans.source],
            strength: ans.source === "google" ? r.strength : null,
            type: r.type,
            modes: [mode],
            via: r.via,
            question: f.question || QUESTION_MORE.test(r.phrase),
            tracked: null,
            cluster: null,
            order: order++,
          });
          continue;
        }
        if (!had.sources.includes(ans.source)) had.sources.push(ans.source);
        if (!had.modes.includes(mode)) had.modes.push(mode);
        if (ans.source === "google" && r.strength !== null && (had.strength === null || r.strength > had.strength)) had.strength = r.strength;
        if (!had.type && r.type) had.type = r.type;
      }
    }
  }
  const list = [...merged.values()];
  /* What the desk already tracks, and where its rule files the rest. */
  if (list.length) {
    const marks = list.map(() => "?").join(",");
    const tracked = new Map(
      (db.prepare(`SELECT id, phrase, status, cluster FROM cc_seo_keywords WHERE phrase IN (${marks})`).all(...list.map((s) => s.phrase)) as { id: number; phrase: string; status: string; cluster: string | null }[]).map((r) => [r.phrase, r]),
    );
    const file = filer();
    for (const s of list) {
      const t = tracked.get(s.phrase);
      if (t) s.tracked = { id: t.id, status: (["relevant", "weak", "irrelevant", "unjudged"].includes(t.status) ? t.status : "unjudged") as "relevant" | "weak" | "irrelevant" | "unjudged", cluster: t.cluster };
      s.cluster = file(s.phrase, lang);
    }
  }
  list.sort((x, y) => (y.strength ?? -1) - (x.strength ?? -1) || y.sources.length - x.sources.length || x.order - y.order);
  const suggestions: WebSuggestion[] = list.map(({ order: _o, ...s }) => s);

  const sent = [...lines.values()].reduce((n, l) => n + l.sent, 0);
  for (const l of lines.values()) {
    if (l.line) continue;
    l.line =
      l.state === "asked"
        ? `${l.sent} request${l.sent === 1 ? "" : "s"} now${kept ? "; the rest from the last seven days" : ""}.`
        : l.state === "kept"
          ? "Answered from what it said in the last seven days; nothing was asked."
          : "Not asked: the allowance ran out first.";
  }
  const stopped = stops.length ? [...new Set(stops)].join(" ") : null;
  const tracking = suggestions.filter((s) => s.tracked).length;
  const line = `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} for "${seed}" (${lang}, ${country.toUpperCase()}), ${tracking} of them already in the keyword table; ${sent} request${sent === 1 ? "" : "s"} sent now${kept ? `, ${kept} answered from the last seven days` : ""}.${stopped ? ` ${stopped}` : ""}`;
  return {
    seed,
    lang,
    country,
    modes,
    suggestions,
    sources: [...lines.values()],
    sent,
    kept,
    allowance: researchAllowance(),
    asOf: oldest,
    stopped,
    line,
  };
}

/* ---------- keeping what a person chose ------------------------------------------------------ */

/**
 * Put researched phrases into the keyword table, unjudged, with the source
 * "autocomplete" (they came from the engines' suggestions) and the seed they
 * were researched from. A phrase already there gains the source and keeps
 * everything a person decided. Returns how many were new.
 */
export function trackSuggestions(phrases: { phrase: string; cluster?: string | null }[], o: { seed: string; lang: WebLang; by: string }): { added: number; known: number } {
  let added = 0;
  let known = 0;
  const at = now();
  for (const p of phrases.slice(0, 500)) {
    const got = upsertKeyword({ phrase: p.phrase, lang: o.lang, cluster: p.cluster ?? null, source: "autocomplete", seed: normal(o.seed), by: "research" }, at);
    if (got === "added") added++;
    else known++;
  }
  return { added, known };
}
