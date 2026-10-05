import type { SourceStatus } from "../../../../web/src/contract/common.ts";
import type { DomainFact, PaidDomainFacts, SerpPage, WebLang } from "../../../../web/src/contract/seo/common.ts";
import { db } from "../../../db.ts";
import { answered, ask, base, failed, health, placeOnBox, SourceError, statusOf } from "../../search/shared.ts";
import { registerSource } from "../../sources.ts";
import { off, ok, setState, state, waiting } from "../../store.ts";
import { now } from "../tables.ts";
import { bare, said } from "./shared.ts";

/**
 * DataForSEO: the one paid source the web layer knows, used only when the
 * owner has opened an account. One prepaid balance (pay as you go, 50 dollars
 * at least, no subscription) answers what nothing free does:
 *
 *   serpLive            Google's live result page for any phrase and language
 *                       in Switzerland, with "people also ask" and related
 *                       searches ($0.002 a page)
 *   searchVolume        Google Ads (Keyword Planner) monthly searches, CPC and
 *                       competition, up to 1,000 phrases a call ($0.09 a call)
 *   keywordDifficulty   DataForSEO Labs' difficulty 0 to 100, up to 1,000 a call
 *   rankedKeywords, competitorsDomain, domainRankOverview
 *                       what a domain ranks for on google.ch, who shares its
 *                       rankings, and how many it has by position
 *   backlinksSummary    a domain's links: referring domains, rank, spam score
 *
 * NOT TRIED AGAINST A LIVE ACCOUNT. None exists (E:\Balkaris\secrets\README.md
 * lists none). Everything here is written from docs.dataforseo.com (request
 * shapes, field names, the status codes of its errors appendix, read 5
 * October 2026) and proven against the documented sample answers in
 * scripts/fixtures/seo-web/dataforseo-*.json. The source's line in Settings
 * says so until a first answer arrives.
 *
 * Switzerland is location 2756 everywhere. Labs (difficulty, a domain's
 * rankings) has German, French and Italian databases for Switzerland and NO
 * English one: an English question to Labs is refused here with that sentence
 * rather than sent. Every answer carries its cost; the month's spend is kept
 * in cc_state so the screens can say what was bought.
 *
 *   https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/
 *   https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/
 *   https://docs.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live/
 *   https://docs.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live/
 *   https://docs.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live/
 *   https://docs.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live/
 *   https://docs.dataforseo.com/v3/backlinks/summary/live/
 *   https://docs.dataforseo.com/v3/appendix/errors/
 */

const API = (): string => base("DATAFORSEO_API_BASE", "https://api.dataforseo.com/v3");
const login = (): string => (process.env.DATAFORSEO_LOGIN ?? "").trim();
const password = (): string => (process.env.DATAFORSEO_PASSWORD ?? "").trim();

export const configured = (): boolean => !!login() && !!password();

/** Google's geo-target numbers, which DataForSEO uses: Switzerland and its neighbours. */
export const LOCATION: Record<string, number> = { ch: 2756, de: 2276, at: 2040, fr: 2250, it: 2380, li: 2438, gb: 2826, us: 2840 };
export const locationOf = (country: string): number => LOCATION[country.toLowerCase()] ?? LOCATION.ch!;

/** Labs has no English database for Switzerland (its list of 1 September 2026). */
const LABS_LANGS: readonly WebLang[] = ["de", "fr", "it"];

export const UNTESTED = "Written from DataForSEO's documentation and its documented sample answers; not yet tried against a live account, because none exists.";
const REASON = "DataForSEO is not connected: no account exists.";

/** The owner's step: open the account, pay, put the two values on the box. */
export function step(): string {
  return `Create an account at app.dataforseo.com, top up its balance (pay as you go, at least 50 dollars, no subscription), and copy the API login and API password from its API Access page; ${placeOnBox("DATAFORSEO_LOGIN")}; then the same for the password: ${placeOnBox("DATAFORSEO_PASSWORD")}.`;
}

export function status(): SourceStatus {
  const s = statusOf({
    id: "desk",
    key: "dataforseo",
    name: "DataForSEO (paid)",
    feeds: "Google's result page for any phrase with people also ask, Keyword Planner volumes and keyword difficulty, a domain's rankings on google.ch, its competitors and its backlinks",
    connected: configured(),
    offReason: `${REASON} ${UNTESTED}`,
    step: step(),
  });
  /* Until a first real answer, say plainly that it was never tried against a live account. */
  return s.state === "waiting" && !s.error ? { ...s, error: UNTESTED } : s;
}

registerSource(status);

/* ---------- spend ------------------------------------------------------------------------ */

const SPENT_KEY = "seo:web:dataforseo:spent";

/** What the desk bought this month, in US dollars, from the cost each answer states. */
export function spent(): { month: string; dollars: number; calls: number } {
  const month = new Date().toISOString().slice(0, 7);
  try {
    const v = JSON.parse(state(SPENT_KEY) ?? "null") as { month?: string; dollars?: number; calls?: number } | null;
    if (v?.month === month) return { month, dollars: Number(v.dollars ?? 0), calls: Number(v.calls ?? 0) };
  } catch {
    /* counted from zero */
  }
  return { month, dollars: 0, calls: 0 };
}

function addSpend(cost: number): void {
  const s = spent();
  setState(SPENT_KEY, JSON.stringify({ month: s.month, dollars: Math.round((s.dollars + (Number.isFinite(cost) ? cost : 0)) * 100_000) / 100_000, calls: s.calls + 1 }));
}

/* ---------- asking ------------------------------------------------------------------------- */

/** The one request DataForSEO takes. The check script replaces it with the documented samples. */
export const wire = {
  post: (url: string, body: unknown, authorization: string): Promise<{ status: number; json: unknown }> =>
    ask("DataForSEO", url, { method: "POST", body, headers: { authorization }, timeout: 90_000 }),
};

interface Envelope<R> {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: { status_code?: number; status_message?: string; cost?: number; result?: R[] | null }[];
}

/** DataForSEO's own codes (errors appendix), as what a person would do about them. */
function refusal(http: number, code: number, message: string): SourceError {
  const m = message.slice(0, 160);
  if (code === 40100 || code === 40104 || http === 401) return new SourceError(http || 401, "auth", `DataForSEO refused the login (${code}: ${m}): check DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD, and that the account is verified`, String(code));
  if (code === 40200 || code === 40210) return new SourceError(402, "forbidden", "DataForSEO's balance is empty: top it up at app.dataforseo.com", String(code));
  if (code === 40201 || code === 40204 || code === 40207) return new SourceError(403, "forbidden", `DataForSEO refused the account (${code}: ${m})`, String(code));
  if (code === 40202 || code === 40203 || code === 40205 || code === 40206 || code === 40209 || http === 429) return new SourceError(429, "quota", `DataForSEO says it was asked too often or the day's cost limit is reached (${code}); it answers again later`, String(code));
  if (code === 40102) return new SourceError(404, "absent", "DataForSEO found no results for that request", String(code));
  if (code >= 40400 && code < 40500) return new SourceError(404, "absent", `DataForSEO has nothing for that (${code}: ${m})`, String(code));
  if (code >= 40500 && code < 40600) return new SourceError(400, "request", `DataForSEO did not accept the request (${code}: ${m})`, String(code));
  if (http >= 500 || code >= 50000 || code === 40101 || code === 40103) return new SourceError(http >= 500 ? http : 503, "down", `DataForSEO could not answer (${code || http}: ${m})`, String(code));
  return new SourceError(http || 400, "request", `DataForSEO did not accept the request (${code || http}: ${m})`, String(code));
}

/** One live task. Returns its result array and its cost. Throws a SourceError with a sentence. */
export async function call<R>(path: string, task: Record<string, unknown>): Promise<{ result: R[]; cost: number }> {
  try {
    if (!configured()) throw new SourceError(0, "auth", REASON, "NO_ACCOUNT");
    const auth = `Basic ${Buffer.from(`${login()}:${password()}`).toString("base64")}`;
    const res = await wire.post(`${API()}/${path}`, [task], auth);
    const env = (res.json ?? {}) as Envelope<R>;
    const top = Number(env.status_code ?? 0);
    if (res.status !== 200 || (top && top !== 20000)) throw refusal(res.status, top, String(env.status_message ?? ""));
    const t = env.tasks?.[0];
    const code = Number(t?.status_code ?? 0);
    const cost = Number(t?.cost ?? env.cost ?? 0);
    if (Number.isFinite(cost) && cost > 0) addSpend(cost);
    /* 40106: some pages could not be read and were not charged; the rest is a result. */
    if (!t || (code !== 20000 && code !== 40106)) throw refusal(res.status, code, String(t?.status_message ?? "no task in the answer"));
    answered("dataforseo");
    return { result: (t.result ?? []) as R[], cost };
  } catch (e) {
    failed("dataforseo", e);
    throw e;
  }
}

/* ---------- reading the answers (pure, proven against the documented samples) -------------- */

interface SerpItem {
  type?: string;
  rank_group?: number;
  title?: string | null;
  url?: string | null;
  domain?: string | null;
  description?: string | null;
  rating?: { value?: number | null; votes_count?: number | null } | null;
  items?: unknown[] | null;
}

/** serp/google/organic/live/advanced result[0] as the contract's page. */
export function parseSerp(result: { items?: SerpItem[] | null } | undefined): SerpPage {
  const page: SerpPage = { organic: [], localPack: [], ads: 0, adHosts: [], related: [], questions: [] };
  for (const it of result?.items ?? []) {
    switch (it.type) {
      case "organic": {
        if (!it.url) break;
        let host = (it.domain ?? "").toLowerCase();
        try {
          host = host || new URL(it.url).hostname.toLowerCase();
        } catch {
          break;
        }
        page.organic.push({ position: Number(it.rank_group) || page.organic.length + 1, title: String(it.title ?? ""), url: it.url, host, snippet: String(it.description ?? "").slice(0, 300) });
        break;
      }
      case "local_pack":
        page.localPack.push({
          name: String(it.title ?? ""),
          rating: typeof it.rating?.value === "number" ? it.rating.value : null,
          reviews: typeof it.rating?.votes_count === "number" ? it.rating.votes_count : null,
          category: null,
          address: it.description ? String(it.description).replace(/\s+/g, " ").trim().slice(0, 160) : null,
        });
        break;
      case "paid":
        page.ads++;
        if (it.domain && !page.adHosts.includes(bare(it.domain))) page.adHosts.push(bare(it.domain));
        break;
      case "people_also_ask":
        for (const q of (it.items ?? []) as { title?: string }[]) if (q?.title) page.questions.push(q.title);
        break;
      case "related_searches":
        for (const q of (it.items ?? []) as unknown[]) if (typeof q === "string") page.related.push(q);
        break;
    }
  }
  page.organic.sort((a, b) => a.position - b.position);
  return page;
}

export interface VolumeRow {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competition: "low" | "medium" | "high" | null;
  competitionIndex: number | null;
  monthly: { year: number; month: number; volume: number }[];
}

/** keywords_data/google_ads/search_volume/live result[] as rows. A phrase Google has no figure for comes back null, not 0. */
export function parseVolumes(result: unknown[]): VolumeRow[] {
  return (result as Record<string, unknown>[]).flatMap((r) => {
    if (!r || typeof r.keyword !== "string") return [];
    const comp = typeof r.competition === "string" ? r.competition.toLowerCase() : null;
    return [
      {
        keyword: r.keyword,
        volume: typeof r.search_volume === "number" ? r.search_volume : null,
        cpc: typeof r.cpc === "number" ? r.cpc : null,
        competition: comp === "low" || comp === "medium" || comp === "high" ? comp : null,
        competitionIndex: typeof r.competition_index === "number" ? r.competition_index : null,
        monthly: Array.isArray(r.monthly_searches)
          ? (r.monthly_searches as { year?: number; month?: number; search_volume?: number }[]).filter((m) => typeof m?.search_volume === "number").map((m) => ({ year: Number(m.year), month: Number(m.month), volume: Number(m.search_volume) }))
          : [],
      },
    ];
  });
}

/** dataforseo_labs/google/bulk_keyword_difficulty/live result[0].items. */
export function parseDifficulty(result: unknown[]): { keyword: string; difficulty: number }[] {
  const items = ((result[0] as { items?: unknown[] } | undefined)?.items ?? []) as { keyword?: unknown; keyword_difficulty?: unknown }[];
  return items.flatMap((i) => (typeof i?.keyword === "string" && typeof i.keyword_difficulty === "number" ? [{ keyword: i.keyword, difficulty: i.keyword_difficulty }] : []));
}

/** dataforseo_labs/google/ranked_keywords/live result[0]. */
export function parseRanked(result: unknown[]): { total: number; rows: { keyword: string; position: number; url: string; volume: number | null; etv: number | null }[] } {
  const r = (result[0] ?? {}) as { total_count?: number; items?: unknown[] };
  const rows = ((r.items ?? []) as { keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number } }; ranked_serp_element?: { serp_item?: { rank_group?: number; url?: string; etv?: number } } }[]).flatMap((i) => {
    const k = i?.keyword_data?.keyword;
    const s = i?.ranked_serp_element?.serp_item;
    if (typeof k !== "string" || !s || typeof s.rank_group !== "number") return [];
    return [{ keyword: k, position: s.rank_group, url: String(s.url ?? ""), volume: typeof i.keyword_data?.keyword_info?.search_volume === "number" ? i.keyword_data.keyword_info.search_volume : null, etv: typeof s.etv === "number" ? s.etv : null }];
  });
  return { total: Number(r.total_count ?? rows.length), rows };
}

/** dataforseo_labs/google/competitors_domain/live result[0].items. `shared` is DataForSEO's "intersections": phrases both rank for. */
export function parseCompetitors(result: unknown[]): { domain: string; avgPosition: number | null; shared: number; etv: number | null }[] {
  const items = ((result[0] as { items?: unknown[] } | undefined)?.items ?? []) as { domain?: string; avg_position?: number; intersections?: number; metrics?: { organic?: { etv?: number } } }[];
  return items.flatMap((i) =>
    typeof i?.domain === "string"
      ? [{ domain: i.domain, avgPosition: typeof i.avg_position === "number" ? Math.round(i.avg_position * 10) / 10 : null, shared: Number(i.intersections ?? 0), etv: typeof i.metrics?.organic?.etv === "number" ? Math.round(i.metrics.organic.etv) : null }]
      : [],
  );
}

/** dataforseo_labs/google/domain_rank_overview/live result[0].items[0].metrics.organic. */
export function parseOverview(result: unknown[]): { count: number; top3: number; top10: number; etv: number | null } | null {
  const o = ((result[0] as { items?: { metrics?: { organic?: Record<string, number> } }[] } | undefined)?.items?.[0]?.metrics?.organic ?? null) as Record<string, number> | null;
  if (!o) return null;
  const n = (k: string): number => (typeof o[k] === "number" ? o[k]! : 0);
  return { count: n("count"), top3: n("pos_1") + n("pos_2_3"), top10: n("pos_1") + n("pos_2_3") + n("pos_4_10"), etv: typeof o.etv === "number" ? Math.round(o.etv) : null };
}

/** backlinks/summary/live result[0]. */
export function parseBacklinks(result: unknown[]): { rank: number | null; backlinks: number | null; referringDomains: number | null; referringMainDomains: number | null; firstSeen: string | null; spamScore: number | null } | null {
  const r = result[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const num = (k: string): number | null => (typeof r[k] === "number" ? (r[k] as number) : null);
  return {
    rank: num("rank"),
    backlinks: num("backlinks"),
    referringDomains: num("referring_domains"),
    referringMainDomains: num("referring_main_domains"),
    firstSeen: typeof r.first_seen === "string" ? r.first_seen.slice(0, 10) : null,
    spamScore: num("backlinks_spam_score"),
  };
}

/* ---------- the calls ---------------------------------------------------------------------- */

/** Google's live result page in Switzerland (or another country), ten results, people also ask opened once. */
export async function serpLive(phrase: string, lang: WebLang, country = "ch"): Promise<{ page: SerpPage; cost: number }> {
  const got = await call<{ items?: SerpItem[] }>("serp/google/organic/live/advanced", {
    keyword: phrase,
    location_code: locationOf(country),
    language_code: lang,
    device: "desktop",
    depth: 10,
    people_also_ask_click_depth: 1,
  });
  return { page: parseSerp(got.result[0]), cost: got.cost };
}

/** Keyword Planner's figures for up to 1,000 phrases of one language. */
export async function searchVolume(keywords: string[], lang: WebLang, country = "ch"): Promise<{ rows: VolumeRow[]; cost: number }> {
  if (!keywords.length) return { rows: [], cost: 0 };
  if (keywords.length > 1000) throw new SourceError(400, "request", "DataForSEO takes at most 1,000 phrases a call");
  const got = await call<unknown>("keywords_data/google_ads/search_volume/live", { keywords, location_code: locationOf(country), language_code: lang });
  return { rows: parseVolumes(got.result), cost: got.cost };
}

const noLabs = (lang: WebLang): SourceError => new SourceError(400, "request", `DataForSEO Labs has no ${lang === "en" ? "English" : lang} database for Switzerland (it has German, French and Italian), so this was not asked`, "NO_LABS_DB");

/** Labs' keyword difficulty, 0 to 100, for up to 1,000 phrases of one language (not English: Labs has no English database for Switzerland). */
export async function keywordDifficulty(keywords: string[], lang: WebLang, country = "ch"): Promise<{ rows: { keyword: string; difficulty: number }[]; cost: number }> {
  if (!keywords.length) return { rows: [], cost: 0 };
  if (country === "ch" && !LABS_LANGS.includes(lang)) throw noLabs(lang);
  const got = await call<unknown>("dataforseo_labs/google/bulk_keyword_difficulty/live", { keywords: keywords.slice(0, 1000), location_code: locationOf(country), language_code: lang });
  return { rows: parseDifficulty(got.result), cost: got.cost };
}

export async function rankedKeywords(domain: string, lang: WebLang, limit = 100): Promise<{ value: ReturnType<typeof parseRanked>; cost: number }> {
  if (!LABS_LANGS.includes(lang)) throw noLabs(lang);
  const got = await call<unknown>("dataforseo_labs/google/ranked_keywords/live", {
    target: domain,
    location_code: LOCATION.ch,
    language_code: lang,
    limit: Math.max(1, Math.min(1000, limit)),
    item_types: ["organic"],
    order_by: ["ranked_serp_element.serp_item.rank_group,asc"],
  });
  return { value: parseRanked(got.result), cost: got.cost };
}

export async function competitorsDomain(domain: string, lang: WebLang, limit = 50): Promise<{ value: ReturnType<typeof parseCompetitors>; cost: number }> {
  if (!LABS_LANGS.includes(lang)) throw noLabs(lang);
  const got = await call<unknown>("dataforseo_labs/google/competitors_domain/live", { target: domain, location_code: LOCATION.ch, language_code: lang, limit: Math.max(1, Math.min(1000, limit)), exclude_top_domains: true });
  return { value: parseCompetitors(got.result), cost: got.cost };
}

export async function domainRankOverview(domain: string, lang: WebLang): Promise<{ value: ReturnType<typeof parseOverview>; cost: number }> {
  if (!LABS_LANGS.includes(lang)) throw noLabs(lang);
  const got = await call<unknown>("dataforseo_labs/google/domain_rank_overview/live", { target: domain, location_code: LOCATION.ch, language_code: lang });
  return { value: parseOverview(got.result), cost: got.cost };
}

export async function backlinksSummary(domain: string): Promise<{ value: ReturnType<typeof parseBacklinks>; cost: number }> {
  const got = await call<unknown>("backlinks/summary/live", { target: domain, include_subdomains: true, backlinks_status_type: "live", rank_scale: "one_hundred" });
  return { value: parseBacklinks(got.result), cost: got.cost };
}

/* ---------- a domain's paid facts, kept seven days ------------------------------------------- */

const KEEP_MS = 7 * 86_400_000;
const FROM = "DataForSEO";

type PaidKey = keyof PaidDomainFacts;

function keptFact<T>(domain: string, key: string): { fact: DomainFact<T>; at: string } | null {
  const r = db.prepare("SELECT reading, at FROM cc_seo_domain_facts WHERE domain = ? AND fact = ?").get(domain, key) as { reading: string; at: string } | undefined;
  if (!r || Date.now() - Date.parse(r.at) > KEEP_MS) return null;
  try {
    return { fact: JSON.parse(r.reading) as DomainFact<T>, at: r.at };
  } catch {
    return null;
  }
}

function keepFact(domain: string, key: string, fact: DomainFact<unknown>, by: string): void {
  db.prepare("INSERT INTO cc_seo_domain_facts (domain, fact, reading, at, asked_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(domain, fact) DO UPDATE SET reading = excluded.reading, at = excluded.at, asked_by = excluded.asked_by").run(
    domain,
    key,
    JSON.stringify(fact),
    now(),
    by,
  );
}

/**
 * What DataForSEO says about a domain: its rankings on google.ch in one
 * language (overview, the phrases, who shares them) and its links. Each is
 * off with the owner's step while there is no account; an answer is kept
 * seven days, so a second look costs nothing (about $0.07 for all four).
 */
export async function paidDomainFacts(domainInput: string, lang: WebLang, by: string, o: { fresh?: boolean } = {}): Promise<PaidDomainFacts> {
  const domain = bare(domainInput.trim().toLowerCase());
  if (!configured()) {
    const f = { ...off<never>("desk", `${REASON} ${UNTESTED}`, step()), from: FROM };
    return { overview: f, ranked: f, competitors: f, backlinks: f };
  }
  const one = async <T>(key: PaidKey, factKey: string, get: () => Promise<{ value: T | null; cost: number }>, empty: string): Promise<DomainFact<T>> => {
    if (!o.fresh) {
      const had = keptFact<T>(domain, factKey);
      if (had) return had.fact;
    }
    let fact: DomainFact<T>;
    try {
      const got = await get();
      fact =
        got.value === null
          ? { ...off<T>("desk", empty), from: FROM }
          : { ...ok(got.value, "desk", now(), `Bought from DataForSEO for $${got.cost.toFixed(4)}. ${key === "backlinks" ? "DataForSEO's own link index." : "DataForSEO Labs' stored google.ch results, refreshed over weeks; a new site may be missing."}`), from: FROM };
    } catch (e) {
      const err = e instanceof SourceError ? e : null;
      fact = err?.kind === "absent" || err?.reason === "NO_LABS_DB" ? { ...off<T>("desk", said(e)), from: FROM } : { ...waiting<T>("desk", `DataForSEO did not answer: ${said(e)}`), from: FROM };
      if (err?.reason === "NO_LABS_DB") return fact;
    }
    keepFact(domain, factKey, fact, by);
    return fact;
  };
  const [overview, ranked, competitors, backlinks] = await Promise.all([
    one("overview", `dfs-overview:${lang}`, async () => {
      const r = await domainRankOverview(domain, lang);
      return { value: r.value ? { lang, ...r.value } : null, cost: r.cost };
    }, `DataForSEO Labs has no stored google.ch rankings for ${domain} in ${lang}.`),
    one("ranked", `dfs-ranked:${lang}`, async () => {
      const r = await rankedKeywords(domain, lang);
      return { value: { lang, ...r.value }, cost: r.cost };
    }, `DataForSEO Labs has no stored google.ch rankings for ${domain} in ${lang}.`),
    one("competitors", `dfs-competitors:${lang}`, async () => {
      const r = await competitorsDomain(domain, lang);
      return { value: { lang, rows: r.value }, cost: r.cost };
    }, `DataForSEO Labs knows no domain that shares google.ch rankings with ${domain}.`),
    one("backlinks", "dfs-backlinks", backlinksSummary.bind(null, domain), `DataForSEO knows no links to ${domain}.`),
  ]);
  return { overview, ranked, competitors, backlinks } as PaidDomainFacts;
}

/** When DataForSEO last answered and what went wrong last, for a screen's line. */
export const lastHealth = (): ReturnType<typeof health> => health("dataforseo");
