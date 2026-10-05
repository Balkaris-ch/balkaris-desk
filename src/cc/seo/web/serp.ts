import { HTTPException } from "hono/http-exception";
import type { GoogleLane, SerpAsked, SerpCheck, SerpEngine, SerpFetcher, SerpPage, WebLang } from "../../../../web/src/contract/seo/common.ts";
import { db } from "../../../db.ts";
import { siteHost, UA } from "../../site/http.ts";
import { note, setState, state as stateOf, today } from "../../store.ts";
import { addSighting, domainKey } from "../competitors.ts";
import { json } from "../tables.ts";
import { langOf, normal } from "../words.ts";
import * as dfs from "./dataforseo.ts";
import { dropFetch, fetchRow, laneState, onFetched, pauseLane, queueFetch, workstation, type Delivered, type FetchRow } from "./fetchq.ts";
import { readDdgLite, readGoogle } from "./parse.ts";
import { acceptLanguage, asCountry, asLang, bare, clock, pace, pause, paused, said, stamp, whenText } from "./shared.ts";

/**
 * WHO RANKS FOR A PHRASE: one result page, asked for on demand or by the
 * weekly rank check, read into organic results, the map pack, ads, related
 * searches and (paid only) people also ask.
 *
 * THREE WAYS, NEVER MIXED UP. Every check names its engine and who fetched it:
 *
 *   Google, through DataForSEO   when the owner has an account: the server
 *                                asks, the answer is back in seconds.
 *   Google, by the workstation   otherwise, free: Google answers a datacenter
 *                                with a script shell, but its basic result
 *                                page, asked for from the studio's home line
 *                                with an Opera Mini User-Agent, carries the
 *                                organic ten, the map pack and the ads. The
 *                                check waits in the fetch queue (fetchq.ts)
 *                                until the workstation's runner takes it.
 *   DuckDuckGo, by the server    a second opinion, labelled DuckDuckGo and
 *                                never Google: its index is largely Bing's.
 *                                One request every two minutes at most.
 *
 * PROTECTING THE HOME LINE. A block on the studio's address would put
 * captchas in front of the owner's own searches. So Google fetches go one
 * every four seconds, sixty a day, and the first captcha, 429 or script shell
 * stops them for 24 hours with a sentence that says until when (fetchq.ts
 * keeps the lane; this file reads the page and calls the pause). A done check
 * younger than six hours answers a repeated question instead of a new fetch.
 *
 * WHAT A DONE CHECK LEAVES BEHIND. Every organic row becomes a sighting of
 * its domain (competitors.ts addSighting: engine google or duckduckgo, by
 * workstation, server or dataforseo, with the result's title and address),
 * every map-pack row a "google-local" sighting by name, Balkaris's own place
 * is kept on the check (null = not in the first ten), and the activity feed
 * hears about it.
 */

/** The legacy agent Google still serves its basic, script-free result page to. */
export const OPERA_MINI = "Opera/9.80 (J2ME/MIDP; Opera Mini/9.80 (S60; SymbOS; Opera Mobi/23.348; U; en) Presto/2.5.25 Version/10.54";

/** A done check this young answers the same question again without a new fetch. */
const REUSE_MS = 6 * 3600_000;
/** DuckDuckGo from the server: one request every two minutes, and an hour's pause after a challenge. */
const DDG_GAP_MS = 120_000;
const DDG_PAUSE_MS = 3600_000;
const DDG_LAST = "seo:web:ddg:last";
const DDG_PAUSE = "seo:web:ddg:pause";

/** Google's result page for a phrase, as the workstation asks for it. */
export function googleUrl(phrase: string, lang: WebLang, country = "ch"): string {
  return `https://www.google.com/search?q=${encodeURIComponent(phrase)}&gl=${country}&hl=${lang}`;
}

/** DuckDuckGo's lite page; kl is its region (it has ch-de, ch-fr and ch-it, so English is asked in Swiss German's region). */
export function ddgUrl(phrase: string, lang: WebLang, country = "ch"): string {
  const kl = `${country}-${lang === "en" ? "de" : lang}`;
  return `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(phrase)}&kl=${kl}`;
}

/** Where the server's own request goes. The check script replaces it. */
export const wire = {
  ddg: async (url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> => {
    const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: buf.subarray(0, 1_500_000).toString("utf8") };
  },
};

/* ---------- the rows -------------------------------------------------------------------------- */

interface CheckDb {
  id: number;
  phrase: string;
  lang: string;
  country: string;
  engine: string;
  state: string;
  source: string;
  cluster: string | null;
  requested_by: string;
  requested_at: string;
  done_at: string | null;
  error: string | null;
  result: string | null;
  own_position: number | null;
  fetch_id: number | null;
}

const LABEL: Record<`${SerpEngine}:${SerpFetcher}`, string> = {
  "google:workstation": "Google, fetched by the studio workstation",
  "google:dataforseo": "Google, through DataForSEO",
  "google:server": "Google, read by the server",
  "duckduckgo:server": "DuckDuckGo (not Google), read by the server",
  "duckduckgo:workstation": "DuckDuckGo (not Google), fetched by the studio workstation",
  "duckduckgo:dataforseo": "DuckDuckGo (not Google)",
};

/** Balkaris's own place and address among the organic rows. */
function ownOf(page: SerpPage): { position: number | null; url: string | null } {
  const own = bare(siteHost());
  const hit = page.organic.find((o) => bare(o.host) === own);
  return { position: hit?.position ?? null, url: hit?.url ?? null };
}

function lineOf(r: CheckDb, page: SerpPage | null): string {
  if (r.state === "failed") return r.error ?? "It failed, and nobody said why.";
  if (r.state === "done" && page) {
    const own = ownOf(page);
    const where = own.position ? `Balkaris is at ${own.position} of ${page.organic.length}.` : page.organic.length ? `Balkaris is not among the first ${page.organic.length}.` : "The page had no organic results.";
    return `${where}${page.localPack.length ? ` Map pack of ${page.localPack.length}.` : ""}${page.ads ? ` ${page.ads} ad${page.ads === 1 ? "" : "s"}.` : ""}`;
  }
  if (r.source === "workstation") {
    const task = r.fetch_id ? fetchRow(r.fetch_id) : null;
    if (task?.state === "running") return "The studio workstation is fetching the page now.";
    const lane = laneState("google");
    if (lane.paused) return `Waiting: ${lane.paused.why}; paused until ${whenText(lane.paused.until)}.`;
    if (lane.allowance.left <= 0) return `Waiting: today's ${lane.allowance.cap} Google fetches are used; it goes tomorrow.`;
    const ws = workstation();
    const ahead = task ? (db.prepare("SELECT COUNT(*) AS n FROM cc_seo_fetch_tasks WHERE lane = 'google' AND state = 'queued' AND id < ?").get(task.id) as { n: number }).n : 0;
    return `Queued for the studio workstation${ahead ? ` behind ${ahead} other${ahead === 1 ? "" : "s"}` : ""}. ${ws.line}`;
  }
  return r.state === "running" ? "Being read now." : "Queued.";
}

function toCheck(r: CheckDb): SerpCheck {
  const page = r.result ? json<SerpPage | null>(r.result, null) : null;
  const engine: SerpEngine = r.engine === "duckduckgo" ? "duckduckgo" : "google";
  const source: SerpFetcher = r.source === "dataforseo" ? "dataforseo" : r.source === "server" ? "server" : "workstation";
  /* A workstation check is as far along as its fetch task. */
  let stateNow = r.state as SerpCheck["state"];
  if (source === "workstation" && stateNow === "queued" && r.fetch_id && fetchRow(r.fetch_id)?.state === "running") stateNow = "running";
  return {
    id: r.id,
    phrase: r.phrase,
    lang: asLang(r.lang),
    country: r.country,
    engine,
    source,
    state: stateNow,
    cluster: r.cluster,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    doneAt: r.done_at,
    error: r.error,
    page,
    ownPosition: r.own_position,
    ownUrl: page ? ownOf(page).url : null,
    label: LABEL[`${engine}:${source}`],
    line: lineOf({ ...r, state: stateNow }, page),
  };
}

/** One check, or null. */
export function serpCheck(id: number): SerpCheck | null {
  const r = db.prepare("SELECT * FROM cc_seo_serp_checks WHERE id = ?").get(id) as CheckDb | undefined;
  return r ? toCheck(r) : null;
}

/** The checks of one phrase, newest first: what it ranked like over time. */
export function serpHistory(phrase: string, o: { lang?: WebLang; engine?: SerpEngine; limit?: number } = {}): SerpCheck[] {
  const where = ["phrase = ?"];
  const args: (string | number)[] = [normal(phrase)];
  if (o.lang) {
    where.push("lang = ?");
    args.push(o.lang);
  }
  if (o.engine) {
    where.push("engine = ?");
    args.push(o.engine);
  }
  args.push(Math.max(1, Math.min(200, o.limit ?? 30)));
  return (db.prepare(`SELECT * FROM cc_seo_serp_checks WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...args) as unknown as CheckDb[]).map(toCheck);
}

/**
 * The newest DONE check of each engine for a phrase (what to show as "who
 * ranks"), and the newest one still waiting or running (what to show as "a
 * new look is on its way").
 */
export function latestSerp(phrase: string, lang?: WebLang): { google: SerpCheck | null; duckduckgo: SerpCheck | null; pending: SerpCheck | null } {
  const p = normal(phrase);
  const pick = (sql: string, ...args: string[]): SerpCheck | null => {
    const r = db.prepare(sql).get(...args) as CheckDb | undefined;
    return r ? toCheck(r) : null;
  };
  const langSql = lang ? " AND lang = ?" : "";
  const la = lang ? [lang] : [];
  return {
    google: pick(`SELECT * FROM cc_seo_serp_checks WHERE phrase = ?${langSql} AND engine = 'google' AND state = 'done' ORDER BY id DESC LIMIT 1`, p, ...la),
    duckduckgo: pick(`SELECT * FROM cc_seo_serp_checks WHERE phrase = ?${langSql} AND engine = 'duckduckgo' AND state = 'done' ORDER BY id DESC LIMIT 1`, p, ...la),
    pending: pick(`SELECT * FROM cc_seo_serp_checks WHERE phrase = ?${langSql} AND state IN ('queued','running') ORDER BY id DESC LIMIT 1`, p, ...la),
  };
}

/** The newest checks of any phrase, newest first (a screen's "recent checks"). */
export function recentSerps(limit = 30): SerpCheck[] {
  return (db.prepare("SELECT * FROM cc_seo_serp_checks ORDER BY id DESC LIMIT ?").all(Math.max(1, Math.min(200, limit))) as unknown as CheckDb[]).map(toCheck);
}

/* ---------- a page read: done, sightings, the feed --------------------------------------------- */

function insertCheck(c: { phrase: string; lang: WebLang; country: string; engine: SerpEngine; source: SerpFetcher; state: "queued" | "running"; cluster: string | null; by: string }): number {
  const r = db
    .prepare("INSERT INTO cc_seo_serp_checks (phrase, lang, country, engine, state, source, cluster, requested_by, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(c.phrase, c.lang, c.country, c.engine, c.state, c.source, c.cluster, c.by, stamp());
  return Number(r.lastInsertRowid);
}

function failCheck(id: number, error: string): void {
  db.prepare("UPDATE cc_seo_serp_checks SET state = 'failed', done_at = ?, error = ? WHERE id = ? AND state IN ('queued','running')").run(stamp(), error.slice(0, 400), id);
}

const BY: Record<SerpFetcher, string> = { workstation: "workstation", server: "server", dataforseo: "dataforseo" };

/** Keep a page that was read: the check, a sighting per result, a line in the feed. */
export function completeCheck(id: number, page: SerpPage): SerpCheck | null {
  const r = db.prepare("SELECT * FROM cc_seo_serp_checks WHERE id = ?").get(id) as CheckDb | undefined;
  if (!r || (r.state !== "queued" && r.state !== "running")) return r ? toCheck(r) : null;
  const own = ownOf(page);
  db.prepare("UPDATE cc_seo_serp_checks SET state = 'done', done_at = ?, error = NULL, result = ?, own_position = ? WHERE id = ?").run(stamp(), JSON.stringify(page), own.position, id);
  const engine = r.engine === "duckduckgo" ? "duckduckgo" : "google";
  const by = BY[(r.source as SerpFetcher) in BY ? (r.source as SerpFetcher) : "workstation"];
  const day = today();
  const label = LABEL[`${engine}:${r.source as SerpFetcher}`] ?? engine;
  const setResult = db.prepare("UPDATE cc_seo_sightings SET title = COALESCE(title, ?), url = COALESCE(url, ?) WHERE domain = ? AND engine = ? AND kind = ? AND query = ? AND day = ? AND by = ?");
  for (const o of page.organic) {
    const domain = domainKey(o.host);
    if (!domain) continue;
    /* One domain twice on a page keeps its best place: the sighting is unique by domain, engine, query, day and asker. */
    addSighting({ domain, name: null, engine, kind: "organic", query: r.phrase, lang: r.lang, cluster: r.cluster, position: o.position, day, by, note: `${label}, check ${id}` });
    setResult.run(o.title.slice(0, 300), o.url.slice(0, 500), domain, engine, "organic", r.phrase, day, by);
  }
  if (engine === "google") {
    page.localPack.forEach((l, i) => {
      const domain = domainKey(null, l.name);
      if (!domain) return;
      addSighting({ domain, name: l.name, engine: "google-local", kind: "local-pack", query: r.phrase, lang: r.lang, cluster: r.cluster, position: i + 1, day, by, note: [l.category, l.address, l.rating !== null ? `${l.rating} (${l.reviews ?? "?"})` : null].filter(Boolean).join(" · ") || null });
    });
  }
  const done = toCheck({ ...r, state: "done", result: JSON.stringify(page), own_position: own.position, done_at: stamp() });
  note("seo-serp", `Who ranks for "${r.phrase}" on ${engine === "google" ? "Google" : "DuckDuckGo"}: ${own.position ? `Balkaris at ${own.position}` : "Balkaris not in the first ten"}`, {
    tone: own.position ? "good" : "info",
    detail: `${label}. ${done.line}`,
    href: `/seo/competitors?q=${encodeURIComponent(r.phrase)}`,
    actor: r.requested_by,
    dedupe: `seo:serp:${id}`,
  });
  return done;
}

/** What the workstation brought back for a Google check (or a DuckDuckGo one it was asked for). */
async function readFetched(task: FetchRow, got: Delivered): Promise<void> {
  if (task.ref === null) return;
  const r = db.prepare("SELECT * FROM cc_seo_serp_checks WHERE id = ?").get(task.ref) as CheckDb | undefined;
  if (!r || (r.state !== "queued" && r.state !== "running")) return;
  if (!got.ok) {
    failCheck(r.id, got.error);
    return;
  }
  const verdict = task.lane === "duckduckgo" ? readDdgLite(got) : readGoogle(got);
  if (verdict.ok) {
    completeCheck(r.id, verdict.result);
    return;
  }
  if (verdict.refused) {
    const p = pauseLane(task.lane, task.lane === "google" ? "Google refused the workstation" : "DuckDuckGo refused the workstation");
    const sentence = `${verdict.line}. ${task.lane === "google" ? "Google" : "DuckDuckGo"} checks through the workstation are paused until ${whenText(p.until)}.`;
    failCheck(r.id, sentence);
    note("seo-serp", task.lane === "google" ? "Google refused the workstation; Google checks are paused for a day" : "DuckDuckGo refused the workstation", {
      tone: "warn",
      detail: `${sentence} Nothing else is asked of ${task.lane === "google" ? "Google" : "DuckDuckGo"} from the studio's line until then, so the owner's own searches are not put behind a captcha.`,
      href: "/seo/automations",
      dedupe: `seo:serp:pause:${task.lane}:${p.at.slice(0, 13)}`,
    });
    return;
  }
  failCheck(r.id, verdict.line);
}

onFetched("serp", readFetched);

/* ---------- the lanes as a person sees them -------------------------------------------------- */

export function googleLane(): GoogleLane {
  const s = laneState("google");
  const ws = workstation();
  const paid = dfs.configured();
  const line = paid
    ? "Google checks go through DataForSEO (paid), answered in seconds; the workstation is not needed."
    : s.paused
      ? `${s.paused.why}; Google checks through the workstation are paused until ${whenText(s.paused.until)}.`
      : `${s.allowance.left} of today's ${s.allowance.cap} Google checks left${s.queued ? `, ${s.queued} waiting` : ""}. ${ws.line}`;
  return { workstation: ws, allowance: s.allowance, paused: s.paused ? { until: s.paused.until, why: s.paused.why } : null, queued: s.queued, paid, line };
}

/** Whether DuckDuckGo may be asked from the server now, or the sentence why not. */
function ddgClosed(): string | null {
  const p = paused(DDG_PAUSE);
  if (p) return `${p.why}; paused until ${whenText(p.until)}`;
  const last = Date.parse(json<{ at?: string } | null>(stateOf(DDG_LAST), null)?.at ?? "");
  if (Number.isFinite(last) && clock.now() - last < DDG_GAP_MS) return `DuckDuckGo is asked at most every two minutes; the next look can be had at ${whenText(new Date(last + DDG_GAP_MS).toISOString())}`;
  return null;
}

/** DuckDuckGo's second opinion, read by the server now. Returns the check, done or failed. */
async function askDdg(phrase: string, lang: WebLang, country: string, cluster: string | null, by: string): Promise<SerpCheck> {
  const id = insertCheck({ phrase, lang, country, engine: "duckduckgo", source: "server", state: "running", cluster, by });
  setState(DDG_LAST, JSON.stringify({ at: new Date(clock.now()).toISOString() }));
  try {
    await pace("lite.duckduckgo.com", 2000);
    const got = await wire.ddg(ddgUrl(phrase, lang, country), { "user-agent": UA, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "accept-language": acceptLanguage(lang, country) });
    const verdict = readDdgLite(got);
    if (verdict.ok) return completeCheck(id, verdict.result) ?? serpCheck(id)!;
    if (verdict.refused) {
      const p = pause(DDG_PAUSE, DDG_PAUSE_MS, "DuckDuckGo refused the desk");
      failCheck(id, `${verdict.line}. DuckDuckGo is not asked again until ${whenText(p.until)}.`);
    } else failCheck(id, verdict.line);
  } catch (e) {
    failCheck(id, `DuckDuckGo did not answer: ${said(e)}.`);
  }
  return serpCheck(id)!;
}

/* ---------- asking ------------------------------------------------------------------------------ */

export interface SerpAsk {
  phrase: string;
  /** de, en, fr or it; the phrase's own language when it shows, else German. */
  lang?: string;
  /** Two letters; Switzerland unless told otherwise. */
  country?: string;
  /** Who asked: a person's name, or "rank-check". */
  by: string;
  /** The keyword cluster it belongs to, kept on its sightings. */
  clusterKey?: string | null;
  /** Ask DuckDuckGo too (default true for a person, the rank check passes false). */
  second?: boolean;
  /** Fetch again even when a check of the last six hours exists. */
  fresh?: boolean;
}

/**
 * Who ranks for a phrase: Google through DataForSEO when it is configured
 * (answered now), else queued for the studio workstation (answered when it
 * next asks for work); and DuckDuckGo's second opinion from the server when
 * its two-minute rule allows. Throws 400 for a phrase that is no phrase.
 * Never throws for a refusal: the answer's line says it.
 */
export async function requestSerp(a: SerpAsk): Promise<SerpAsked> {
  const phrase = normal(String(a.phrase ?? ""));
  if (phrase.length < 2 || phrase.length > 120) throw new HTTPException(400, { message: "Type the phrase to check: 2 to 120 characters." });
  const lang = asLang(a.lang ?? langOf(phrase) ?? "de");
  const country = asCountry(a.country);
  const cluster = a.clusterKey?.trim() || null;
  const by = (a.by || "desk").slice(0, 80);
  const lines: string[] = [];
  let google: SerpCheck | null = null;
  let duckduckgo: SerpCheck | null = null;

  /* Google. */
  const recent = a.fresh
    ? undefined
    : (db.prepare("SELECT * FROM cc_seo_serp_checks WHERE phrase = ? AND lang = ? AND country = ? AND engine = 'google' AND state = 'done' AND done_at >= ? ORDER BY id DESC LIMIT 1").get(phrase, lang, country, new Date(clock.now() - REUSE_MS).toISOString()) as CheckDb | undefined);
  const open = db.prepare("SELECT * FROM cc_seo_serp_checks WHERE phrase = ? AND lang = ? AND country = ? AND engine = 'google' AND state IN ('queued','running') ORDER BY id DESC LIMIT 1").get(phrase, lang, country) as CheckDb | undefined;
  if (recent) {
    google = toCheck(recent);
    lines.push(`Google was checked for it at ${whenText(recent.done_at!)}; that answer stands (a new look can be asked after six hours).`);
  } else if (open) {
    google = toCheck(open);
    lines.push(`A Google check for it is already on its way: ${google.line}`);
  } else if (dfs.configured()) {
    const id = insertCheck({ phrase, lang, country, engine: "google", source: "dataforseo", state: "running", cluster, by });
    try {
      const got = await dfs.serpLive(phrase, lang, country);
      google = completeCheck(id, got.page);
      lines.push(`Google answered through DataForSEO ($${got.cost.toFixed(4)}). ${google?.line ?? ""}`.trim());
    } catch (e) {
      failCheck(id, `DataForSEO did not answer: ${said(e)}.`);
      google = serpCheck(id);
      lines.push(google!.line);
    }
  } else {
    const lane = laneState("google");
    if (lane.paused) {
      lines.push(`Google refused the workstation; paused until ${whenText(lane.paused.until)}. No Google check was queued.`);
    } else if (lane.allowance.left - lane.queued <= 0) {
      lines.push(`Today's ${lane.allowance.cap} Google checks through the workstation are used or already queued; ask again tomorrow.`);
    } else {
      const id = insertCheck({ phrase, lang, country, engine: "google", source: "workstation", state: "queued", cluster, by });
      try {
        const fetchId = queueFetch({
          purpose: "serp",
          ref: id,
          lane: "google",
          url: googleUrl(phrase, lang, country),
          headers: { "user-agent": OPERA_MINI, accept: "text/html,*/*;q=0.5", "accept-language": acceptLanguage(lang, country) },
          timeoutMs: 20_000,
        });
        db.prepare("UPDATE cc_seo_serp_checks SET fetch_id = ? WHERE id = ?").run(fetchId, id);
      } catch (e) {
        failCheck(id, said(e));
      }
      google = serpCheck(id);
      lines.push(google!.line);
    }
  }

  /* DuckDuckGo, the second opinion. */
  if (a.second !== false) {
    /* Like Google's: a look of the last six hours stands, so asking twice costs DuckDuckGo nothing (it pauses the desk after a refusal). */
    const had = a.fresh
      ? undefined
      : (db.prepare("SELECT * FROM cc_seo_serp_checks WHERE phrase = ? AND lang = ? AND country = ? AND engine = 'duckduckgo' AND state = 'done' AND done_at >= ? ORDER BY id DESC LIMIT 1").get(phrase, lang, country, new Date(clock.now() - REUSE_MS).toISOString()) as CheckDb | undefined);
    const closed = had ? null : ddgClosed();
    if (had) {
      duckduckgo = toCheck(had);
      lines.push(`DuckDuckGo (not Google) was read for it at ${whenText(had.done_at!)}; that answer stands.`);
    } else if (closed) lines.push(`No DuckDuckGo look this time: ${closed}.`);
    else {
      duckduckgo = await askDdg(phrase, lang, country, cluster, by);
      lines.push(`DuckDuckGo (not Google): ${duckduckgo.line}`);
    }
  }
  return { google, duckduckgo, line: lines.join(" ") };
}

/** Withdraw a Google check still waiting for the workstation. True when it was still waiting. */
export function withdrawSerp(id: number, by: string): boolean {
  const r = db.prepare("SELECT * FROM cc_seo_serp_checks WHERE id = ?").get(id) as CheckDb | undefined;
  if (!r || r.state !== "queued") return false;
  if (r.fetch_id && !dropFetch(r.fetch_id, `Withdrawn by ${by}.`)) return false;
  failCheck(id, `Withdrawn by ${by} before the workstation fetched it.`);
  return true;
}

/* ---------- the weekly rank check ---------------------------------------------------------------- */

/** The phrases a person marked as targets (the Keywords page's own table), with their language and cluster. Null when that table does not exist. */
export function targetPhrases(): { phrase: string; lang: WebLang; cluster: string | null }[] | null {
  try {
    return (
      db.prepare("SELECT k.phrase, k.lang, k.cluster FROM cc_seo_kw_targets t JOIN cc_seo_keywords k ON k.id = t.keyword_id ORDER BY t.at, k.id").all() as { phrase: string; lang: string | null; cluster: string | null }[]
    ).map((r) => ({ phrase: r.phrase, lang: asLang(r.lang ?? langOf(r.phrase) ?? "de"), cluster: r.cluster }));
  } catch {
    return null;
  }
}

/** A target not checked on Google in this long is due again. */
const RECHECK_MS = 6 * 86_400_000;
/** Places of the day's Google allowance the weekly check leaves for people. */
const LEAVE_FOR_PEOPLE = 10;

/**
 * The job "seo-rank-check": a Google check for each target phrase not checked
 * in six days, within the day's Google allowance (leaving ten for people),
 * nothing when Google refused the workstation. With DataForSEO every target
 * is asked now; without it they are queued for the workstation.
 */
export async function rankCheck(progress: (done: number, of: number, what?: string) => void = () => {}): Promise<string> {
  const targets = targetPhrases();
  if (targets === null) return "No phrase is marked as a target yet (the Keywords page has never been opened on this desk), so there is nothing to check.";
  if (!targets.length) return "No phrase is marked as a target: mark some on the Keywords page and the weekly check follows them.";
  const since = new Date(clock.now() - RECHECK_MS).toISOString();
  const due = targets.filter((t) => !db.prepare("SELECT 1 AS x FROM cc_seo_serp_checks WHERE phrase = ? AND lang = ? AND engine = 'google' AND (state IN ('queued','running') OR (state = 'done' AND done_at >= ?)) LIMIT 1").get(t.phrase, t.lang, since));
  if (!due.length) return `All ${targets.length} target phrase${targets.length === 1 ? " was" : "s were"} checked on Google in the last six days.`;
  const paid = dfs.configured();
  if (!paid) {
    const lane = laneState("google");
    if (lane.paused) return `Nothing queued: ${lane.paused.why}; paused until ${whenText(lane.paused.until)}. ${due.length} target${due.length === 1 ? " waits" : "s wait"} for the next run.`;
  }
  const room = paid ? due.length : Math.max(0, laneState("google").allowance.left - laneState("google").queued - LEAVE_FOR_PEOPLE);
  const list = due.slice(0, room);
  let queued = 0;
  let done = 0;
  for (const [i, t] of list.entries()) {
    progress(i, list.length, t.phrase);
    const got = await requestSerp({ phrase: t.phrase, lang: t.lang, by: "rank-check", clusterKey: t.cluster, second: false });
    if (got.google?.state === "done") done++;
    else if (got.google && got.google.state !== "failed") queued++;
  }
  progress(list.length, list.length);
  const left = due.length - list.length;
  return paid
    ? `${done} of ${list.length} target phrase${list.length === 1 ? "" : "s"} checked on Google through DataForSEO.`
    : `${queued} target phrase${queued === 1 ? "" : "s"} queued for the studio workstation${left ? `; ${left} more wait for tomorrow's allowance` : ""}. ${workstation().line}`;
}
