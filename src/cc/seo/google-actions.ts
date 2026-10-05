import { db } from "../../db.ts";
import type { Person } from "../../people.ts";
import { accountEmail, SCOPES, token } from "../gauth.ts";
import * as gsc from "../search/gsc.ts";
import { base, countOn, dayIn, gate, sameAddress, setCount, siteBase } from "../search/shared.ts";
import { abs, get, pathOf as sitePath, UA } from "../site/http.ts";
import * as site from "../site/index.ts";
import { cached, keep, kept, note, off, ok, setState, state, today, waiting } from "../store.ts";
import type { Reading } from "../../../web/src/contract/common.ts";
import type {
  EngineAnswer,
  GoogleAccess,
  GoogleDeed,
  GooglePanel,
  GoogleSitemap,
  IndexNowState,
  IndexQueueRow,
  InspectNow,
  InspectQuota,
  LinkCheck,
  SiteAnswering,
} from "../../../web/src/contract/seo/google.ts";
import { allOpportunities, markSubmitted } from "./engine.ts";
import { latestInspection, meaningOf, type InspectRow, type LatestInspection } from "./indexation.ts";
import { json, now } from "./tables.ts";

/**
 * WHAT THE DESK CAN DO AT GOOGLE AND THE OTHER SEARCH ENGINES, each a thing a
 * person presses and each written to the activity feed with who pressed it
 * and what the engine answered.
 *
 *   SITEMAPS          Search Console's own list (last submitted, last fetched,
 *                     pending, errors, warnings, addresses counted) beside the
 *                     sitemaps the website names, and "Submit to Google"
 *                     (sitemaps.submit). Never deleted from here.
 *   INSPECT NOW       Google's URL Inspection of ONE address on demand (the
 *                     daily job asks all of them): indexed or why not, the
 *                     canonical Google chose, its last crawl, phone usability,
 *                     the rich results it found. Counted against the same
 *                     daily allowance as the job.
 *   REQUEST INDEXING  Google offers NO API for ordinary pages. Its Indexing API
 *                     is for job postings and live streams, and using it for
 *                     anything else is against its terms: this file never
 *                     calls it. So the desk keeps the queue, opens Search
 *                     Console's inspection on exactly that address, takes the
 *                     person's "I pressed it", and does the two things that do
 *                     bring Google sooner: submitting the sitemap again, and
 *                     checking the page is linked from pages Google knows.
 *   INDEXNOW          Bing, Yandex, Seznam, Naver and Yep take a list of
 *                     addresses that changed. The key is the file in the
 *                     website's public/ folder named after its own contents
 *                     (the website's scripts/announce.mjs finds it the same
 *                     way); the desk reads it from its read copy of the
 *                     website's repository.
 *
 * NOTHING IS ANNOUNCED WHILE THE WEBSITE IS NOT ANSWERING. Submitting a
 * sitemap or announcing an address tells an engine "come and fetch this". If
 * the site answers an error at that moment, the engine fetches the error. So
 * both refuse, in one sentence, unless the desk's own probe saw the home page
 * answer 200 in the last ten minutes, or (when that look is older) the
 * website answers 200 when asked just then.
 *
 * EVERYTHING THAT LEAVES THIS MACHINE GOES THROUGH `wire`, so the check script
 * (scripts/check-cc-seo-google.ts) runs every action against a temporary
 * database with no network at all.
 *
 * Endpoints, as read on 5 October 2026:
 *   https://developers.google.com/webmaster-tools/v1/sitemaps/list
 *   https://developers.google.com/webmaster-tools/v1/sitemaps/submit   (scope: webmasters)
 *   https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
 *   https://developers.google.com/search/apis/indexing-api/v3/quickstart  (job postings and live streams only)
 *   https://www.indexnow.org/documentation
 */

/* ---------- what leaves this machine -------------------------------------------------------- */

const API = (): string => base("GSC_API_BASE", "https://www.googleapis.com/webmasters/v3");
const INSPECT = (): string => base("GSC_INSPECT_BASE", "https://searchconsole.googleapis.com/v1");

/** The engines an IndexNow announcement goes to, each at its own door, so the desk can say which accepted. */
export const ENGINES: readonly { name: string; endpoint: string }[] = [
  { name: "Bing", endpoint: "https://www.bing.com/indexnow" },
  { name: "Yandex", endpoint: "https://yandex.com/indexnow" },
  { name: "Seznam", endpoint: "https://search.seznam.cz/indexnow" },
  { name: "Naver", endpoint: "https://searchadvisor.naver.com/indexnow" },
  { name: "Yep", endpoint: "https://indexnow.yep.com/indexnow" },
];

export interface Answered {
  status: number;
  json: unknown;
}

/**
 * Every outbound request of this file. The check script replaces each of
 * these with a function that answers from memory and counts what was asked.
 */
export const wire = {
  /** A Google token: the read-only one, or (write) the one that may submit a sitemap. Null without a key file. */
  bearer: (write: boolean): Promise<string | null> => token(write ? SCOPES.searchConsoleWrite : SCOPES.searchConsole),

  /** One request to Google's API with the token; the status and the parsed body. Throws only when nothing answered. */
  google: (method: "GET" | "POST" | "PUT", url: string, bearerToken: string, body?: unknown): Promise<Answered> =>
    gate(async () => {
      const res = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${bearerToken}`, accept: "application/json", "user-agent": UA, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* an empty 204, or a proxy's HTML: the status says enough */
      }
      return { status: res.status, json: parsed };
    }),

  /** What an address of the website answers right now, redirects followed; 0 when nothing answered. */
  status: async (url: string): Promise<number> => (await get(url, { body: false, timeout: 15_000 })).status,

  /** One IndexNow announcement to one engine; its status, 0 when nothing answered. */
  announce: async (endpoint: string, body: { host: string; key: string; keyLocation: string; urlList: string[] }): Promise<number> => {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", "user-agent": UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      await res.body?.cancel().catch(() => {});
      return res.status;
    } catch {
      return 0;
    }
  },

  /**
   * The website's IndexNow key: the one file in public/ that is named after
   * what it contains (32 hex characters and ".txt"). Null when there is none.
   * Throws when the website's repository cannot be read at all.
   */
  key: async (): Promise<string | null> => {
    if (!site.readCopyExists()) throw new Error("the desk has no read copy of the website's repository yet (the repository job makes it)");
    for (const f of await site.repoFiles("public")) {
      const name = /^public\/([0-9a-f]{32})\.txt$/.exec(f.path)?.[1];
      if (name && f.bytes <= 64 && ((await site.repoRead(f.path)) ?? "").trim() === name) return name;
    }
    return null;
  },

  /** A breath between two requests, so no host is asked twice in a second. The check sets it to nothing. */
  pause: (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms)),
};

/**
 * Why an action was not done, with the status its answer carries: 400 the
 * request itself, 409 it cannot be done now (not connected, the website not
 * answering, the allowance used), 502 Google or an engine refused.
 */
export class Cannot extends Error {
  constructor(
    readonly status: 400 | 409 | 502,
    message: string,
  ) {
    super(message);
    this.name = "Cannot";
  }
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const first = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0]!.slice(0, 160);
const PANEL_HREF = "/seo/technical#google";

/* ---------- may the desk read, and may it change ---------------------------------------------- */

const PERMISSION: Record<string, string> = { siteOwner: "an owner", siteFullUser: "a Full user", siteRestrictedUser: "a Restricted user" };

/** The desk's standing on the Search Console property, from the last time Google was asked. No request. */
export function accessNow(): GoogleAccess {
  const a = gsc.access();
  if (a.state !== "ok" || !a.site) return { connected: false, site: null, permission: null, canWrite: false, reason: gsc.reasonFor(a), step: gsc.stepFor(a) };
  const canWrite = a.permission === "siteOwner" || a.permission === "siteFullUser";
  if (canWrite) return { connected: true, site: a.site, permission: a.permission, canWrite, reason: null, step: null };
  return {
    connected: true,
    site: a.site,
    permission: a.permission,
    canWrite,
    reason: `The desk's Google account is ${PERMISSION[a.permission ?? ""] ?? "a user"} of ${a.site}: it may read the property and inspect addresses, but Google lets only a Full user or an owner submit a sitemap.`,
    step: `In Search Console open ${a.site}, Settings, Users and permissions, and change ${accountEmail() ?? "the desk's service account"} to Full. The desk notices within six hours, or at once after Automations runs "Ask whether Search Console is connected".`,
  };
}

function connected(): { site: string; access: GoogleAccess } {
  const access = accessNow();
  if (!access.connected || !access.site) throw new Cannot(409, `${access.reason ?? "Search Console is not connected."}${access.step ? ` ${access.step}` : ""}`);
  return { site: access.site, access };
}

/** Google's refusal in a sentence a person can act on. The body's own message is quoted only for a request Google did not understand. */
function refusalOf(status: number, body: unknown, doing: string): string {
  const message = String((body as { error?: { message?: string } } | null)?.error?.message ?? "").slice(0, 160);
  if (status === 401) return `Google refused the desk's service-account key (401) when ${doing}.`;
  if (status === 403) return `Google refused (403) when ${doing}: the desk's account is not allowed this on the property.`;
  if (status === 404) return `Search Console does not know that property or address (404) when ${doing}.`;
  if (status === 429) return `Search Console's quota is used up for the moment (429) when ${doing}; it answers again by itself.`;
  if (status >= 500) return `Search Console answered ${status} when ${doing}. Nothing was changed; try again in a few minutes.`;
  return `Search Console did not accept the request (${status}) when ${doing}${message ? `: ${message}` : ""}.`;
}

async function askGoogle(method: "GET" | "POST" | "PUT", url: string, o: { write?: boolean; body?: unknown; doing: string }): Promise<Answered> {
  let bearerToken: string | null;
  try {
    bearerToken = await wire.bearer(!!o.write);
  } catch (e) {
    throw new Cannot(502, `Google refused the desk's service-account key when asked for a token (${first(e)}).`);
  }
  if (!bearerToken) throw new Cannot(409, "The desk has no Google service-account key on this machine, so Google cannot be asked.");
  let res: Answered;
  try {
    res = await wire.google(method, url, bearerToken, o.body);
  } catch (e) {
    throw new Cannot(502, `Search Console ${e instanceof Error && e.name === "TimeoutError" ? "did not answer in time" : "could not be reached"} when ${o.doing}. Nothing was changed.`);
  }
  return res;
}

/* ---------- is the website answering ----------------------------------------------------------- */

const FRESH_MS = 10 * 60_000;

/** The website as the desk's own probe last saw it. No request: the panel draws from this. */
export function siteSeen(): SiteAnswering {
  let s: site.Sample | null = null;
  try {
    s = site.lastHome();
  } catch {
    s = null;
  }
  if (!s) return { ok: false, status: null, at: null, stale: true, line: "The desk's uptime check has not looked at the website yet; a submission asks the website itself first." };
  const stale = Date.now() - Date.parse(s.at) > FRESH_MS;
  const answered = s.status ? `answered ${s.status}` : "did not answer";
  if (stale) return { ok: s.status === 200, status: s.status, at: s.at, stale, line: `The desk's uptime check last looked at ${s.at.slice(0, 16).replace("T", " ")} UTC (the home page ${answered}); that is too old to vouch for now, so a submission asks the website itself first.` };
  return {
    ok: s.status === 200,
    status: s.status,
    at: s.at,
    stale,
    line: s.status === 200 ? "The website answers 200, by the desk's uptime check." : `The website's home page ${answered} at the desk's last uptime check, so nothing is submitted or announced: a search engine would fetch an error page.`,
  };
}

/**
 * Refuses unless the website answers 200: the probe's word when it is fresh,
 * the website's own when it is not. Returns true when the website itself was
 * asked, so the caller leaves a second before it asks the same host again.
 */
async function siteMustAnswer(doing: string): Promise<boolean> {
  const seen = siteSeen();
  let status = seen.status ?? 0;
  let how = "at the desk's last uptime check";
  if (seen.stale) {
    status = await wire.status(`${siteBase()}/`);
    how = "when the desk asked it just now";
  }
  if (status !== 200) {
    throw new Cannot(409, `Not ${doing}: the website ${status ? `answered ${status}` : "did not answer"} ${how}, so a search engine would be sent to an error page. Do it again once the website answers 200.`);
  }
  return seen.stale;
}

/* ---------- sitemaps ---------------------------------------------------------------------------- */

/** The key gsc.ts keeps Search Console's list under; read here as it is, and written after a refresh, so every screen shows one list. */
const SITEMAPS_KEPT = "gsc:sitemaps";

const ownHost = (url: string): boolean => sitePath(url) !== null;

/** The sitemaps the website itself names: /sitemap.xml and every "Sitemap:" line of robots.txt that is on the site. */
function ownSitemaps(): string[] {
  const out = new Set<string>([`${siteBase()}/sitemap.xml`]);
  try {
    for (const s of site.lastSitemap()?.robots.sitemaps ?? []) {
      const u = s.trim();
      if (/^https:\/\//i.test(u) && ownHost(u)) out.add(u);
    }
  } catch {
    /* the sitemap job has not read robots.txt yet: the one address above stands */
  }
  return [...out];
}

const consoleHref = (kind: "sitemaps" | "inspect", siteUrl: string | null, id?: string): string | null =>
  siteUrl ? `https://search.google.com/search-console/${kind}?resource_id=${encodeURIComponent(siteUrl)}${id ? `&id=${encodeURIComponent(id)}` : ""}` : null;

const pathOnSite = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
};

/** Search Console's list as the desk last kept it, beside the site's own sitemaps it has not been given. No request. */
export function sitemapsKept(): GooglePanel["sitemaps"] {
  const access = accessNow();
  if (!access.connected) return off("gsc", access.reason ?? "Search Console is not connected.", access.step ?? undefined);
  const had = kept<gsc.SitemapStatus[]>(SITEMAPS_KEPT);
  if (!had) return waiting("gsc", "Search Console's list of sitemaps has not been read on this desk yet. “Ask Google again” reads it now; the twice-daily Search Console job reads it by itself.");
  const rows: GoogleSitemap[] = had.value.map((s) => ({
    url: s.path,
    path: pathOnSite(s.path),
    known: true,
    lastSubmitted: s.lastSubmitted,
    lastDownloaded: s.lastDownloaded,
    isPending: s.isPending,
    isIndex: s.isIndex,
    warnings: s.warnings,
    errors: s.errors,
    submitted: s.submitted,
    canSubmit: ownHost(s.path),
  }));
  for (const u of ownSitemaps()) {
    if (rows.some((r) => sameAddress(r.url, u))) continue;
    rows.push({ url: u, path: pathOnSite(u), known: false, lastSubmitted: null, lastDownloaded: null, isPending: false, isIndex: false, warnings: 0, errors: 0, submitted: 0, canSubmit: true });
  }
  return ok(
    { rows, consoleHref: consoleHref("sitemaps", access.site) },
    "gsc",
    had.at,
    "Search Console's own record of each sitemap: when it was submitted, when Google last fetched it and how many addresses it counted. Google gives the number of errors and warnings only; what they are is in Search Console's Sitemaps report.",
  );
}

/** Ask Search Console for its list again and keep it where every screen reads it. */
export async function refreshSitemaps(): Promise<number> {
  const { site: property } = connected();
  const res = await askGoogle("GET", `${API()}/sites/${encodeURIComponent(property)}/sitemaps`, { doing: "its list of sitemaps was asked for" });
  if (res.status < 200 || res.status >= 300) throw new Cannot(502, refusalOf(res.status, res.json, "its list of sitemaps was asked for"));
  const got = (res.json ?? {}) as {
    sitemap?: { path?: string; lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean; isSitemapsIndex?: boolean; type?: string; warnings?: string | number; errors?: string | number; contents?: { submitted?: string | number }[] }[];
  };
  const rows: gsc.SitemapStatus[] = (got.sitemap ?? []).map((s) => ({
    path: String(s.path ?? ""),
    lastSubmitted: s.lastSubmitted ?? null,
    lastDownloaded: s.lastDownloaded ?? null,
    isPending: !!s.isPending,
    isIndex: !!s.isSitemapsIndex,
    type: s.type ?? null,
    /* Google sends these counts as strings. */
    warnings: Number(s.warnings ?? 0),
    errors: Number(s.errors ?? 0),
    submitted: (s.contents ?? []).reduce((n, c) => n + Number(c.submitted ?? 0), 0),
  }));
  keep(SITEMAPS_KEPT, rows);
  return rows.length;
}

/**
 * Submit one of the website's own sitemaps to Google, or submit it again.
 * Google then fetches it on its own schedule; "last fetched" shows when it has.
 */
export async function submitSitemap(asked: string, by: Person): Promise<string> {
  const { site: property, access } = connected();
  if (!access.canWrite) throw new Cannot(409, `${access.reason} ${access.step}`);

  /* Only an address the website names, or one Search Console already lists for it: never whatever was typed. */
  const mine = [...ownSitemaps(), ...(kept<gsc.SitemapStatus[]>(SITEMAPS_KEPT)?.value ?? []).map((s) => s.path).filter(ownHost)];
  let wanted: string;
  try {
    wanted = new URL(asked, `${siteBase()}/`).toString();
  } catch {
    throw new Cannot(400, "That is not a sitemap's address.");
  }
  const url = mine.find((u) => sameAddress(u, wanted));
  if (!url) throw new Cannot(400, `The desk submits only the website's own sitemaps (${[...new Set(mine.map(pathOnSite))].join(", ")}).`);
  const name = pathOnSite(url);

  /* And the file itself: a sitemap that answers an error is recorded by Google as one. */
  if (await siteMustAnswer("submitted")) await wire.pause(1_000);
  const fileStatus = await wire.status(url);
  if (fileStatus !== 200) throw new Cannot(409, `Not submitted: ${name} ${fileStatus ? `answered ${fileStatus}` : "did not answer"} when the desk asked it just now. Google would record an error for it.`);

  const doing = `${name} was submitted`;
  const res = await askGoogle("PUT", `${API()}/sites/${encodeURIComponent(property)}/sitemaps/${encodeURIComponent(url)}`, { write: true, doing });
  const at = now();
  if (res.status < 200 || res.status >= 300) {
    const said = refusalOf(res.status, res.json, doing);
    note("seo-action", `Google did not take the sitemap ${name}`, { tone: "warn", actor: by.name, detail: said, href: PANEL_HREF, dedupe: `google:sitemap:${name}:${at}` });
    throw new Cannot(502, res.status === 403 ? `${said} ${accessNow().step ?? `Give ${accountEmail() ?? "the desk's account"} Full permission on ${property} in Search Console.`}` : said);
  }
  /* The list again, so the row shows the new "submitted" time. A list that cannot be read now does not undo the submission. */
  let listed = "";
  try {
    await refreshSitemaps();
  } catch {
    listed = " Search Console's list could not be read again just now; “Ask Google again” shows the new time.";
  }
  const line = `Submitted ${name} to Google (Search Console answered ${res.status}). Google fetches it on its own schedule; “last fetched” shows when it has.${listed}`;
  note("seo-action", `Submitted the sitemap ${name} to Google`, { tone: "good", actor: by.name, detail: `Search Console answered ${res.status}. Google fetches it on its own schedule.`, href: PANEL_HREF, dedupe: `google:sitemap:${name}:${at}` });
  return line;
}

/* ---------- inspect one address now -------------------------------------------------------------- */

const PACIFIC = "America/Los_Angeles";
/** Google's limit for a property, and where the daily check of every address stops (gsc.ts) so some is left for a person. */
const INSPECT_CAP = 2000;
const DAILY_STOPS_AT = 1800;
/** The counter gsc.ts keeps for the daily check: one allowance, counted in one place. */
const INSPECT_USED = "gsc.inspect.used";

export function inspectQuota(): InspectQuota {
  const day = dayIn(PACIFIC);
  const used = countOn(INSPECT_USED, day);
  return {
    used,
    cap: INSPECT_CAP,
    dailyStopsAt: DAILY_STOPS_AT,
    day,
    line: `${used.toLocaleString("en-GB")} of Google's ${INSPECT_CAP.toLocaleString("en-GB")} URL inspections for today are used (the daily check of every address stops at ${DAILY_STOPS_AT.toLocaleString("en-GB")}; Google's day turns at midnight Pacific Time).`,
  };
}

interface RawInspection {
  inspectionResult?: {
    inspectionResultLink?: string;
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
      googleCanonical?: string;
      userCanonical?: string;
      crawledAs?: string;
      sitemap?: string[];
      referringUrls?: string[];
    };
    mobileUsabilityResult?: { verdict?: string; issues?: { issueType?: string; message?: string }[] };
    richResultsResult?: { verdict?: string; detectedItems?: { richResultType?: string; items?: { name?: string; issues?: { issueMessage?: string; severity?: string }[] }[] }[] };
  };
}

const shortDay = (iso: string): string => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Google's answer for one address, in the contract's plain words. Pure: the check feeds it Google's documented shapes. */
export function readInspection(raw: RawInspection, url: string, by: string, at: string, before: InspectRow | null, property: string): InspectNow {
  const r = raw.inspectionResult ?? {};
  const ix = r.indexStatusResult ?? {};
  const indexed = ix.verdict === "PASS";
  const coverage = ix.coverageState ?? null;
  const m = meaningOf(coverage, indexed);
  const google = ix.googleCanonical ?? null;
  const declared = ix.userCanonical ?? null;
  const agrees = google ? sameAddress(google, declared ?? url) : null;

  const mobileVerdict = r.mobileUsabilityResult?.verdict ?? null;
  const mobileIssues = (r.mobileUsabilityResult?.issues ?? []).map((i) => String(i.message ?? i.issueType ?? "")).filter(Boolean);
  const mobileLine =
    mobileVerdict === "PASS"
      ? "Usable on a phone, by Google's last crawl."
      : mobileVerdict === "FAIL"
        ? `Google found ${plural(mobileIssues.length || 1, "problem")} on a phone${mobileIssues.length ? `: ${mobileIssues.slice(0, 3).join("; ")}` : ""}.`
        : "Google gave no verdict on phone usability for this address (it retired that report in 2023 and now answers for few pages).";

  const items = (r.richResultsResult?.detectedItems ?? []).map((d) => ({
    type: String(d.richResultType ?? "Rich result"),
    count: (d.items ?? []).length,
    issues: (d.items ?? []).flatMap((i) => (i.issues ?? []).map((x) => ({ severity: String(x.severity ?? "WARNING"), message: String(x.issueMessage ?? "") }))).filter((x) => x.message),
  }));
  const errors = items.reduce((n, i) => n + i.issues.filter((x) => x.severity === "ERROR").length, 0);
  const warnings = items.reduce((n, i) => n + i.issues.filter((x) => x.severity !== "ERROR").length, 0);
  const richLine = items.length
    ? `Rich results Google found: ${items.map((i) => `${i.type}${i.count > 1 ? ` (${i.count})` : ""}`).join(", ")}. ${errors || warnings ? `${errors ? plural(errors, "error") : ""}${errors && warnings ? " and " : ""}${warnings ? plural(warnings, "warning") : ""}.` : "No errors or warnings."}`
    : indexed
      ? "Google found no rich results on the page."
      : "No rich results: Google reports them only for a page it has indexed.";

  const was = before && (before.indexed !== indexed || (before.coverage ?? "") !== (coverage ?? "")) ? `Was: ${before.coverage ?? (before.indexed ? "indexed" : "not indexed")} (${shortDay(before.day)}).` : null;

  return {
    path: gscPath(url),
    url,
    at,
    by,
    indexed,
    verdict: ix.verdict ?? null,
    coverage,
    line: indexed ? `In Google's index${coverage ? ` (${coverage})` : ""}.` : `Not in Google's index: ${coverage ?? "Google gave no reason"}.`,
    meaning: m.meaning,
    fix: m.fix,
    lastCrawl: ix.lastCrawlTime ?? null,
    crawledAs: ix.crawledAs && ix.crawledAs !== "CRAWLING_USER_AGENT_UNSPECIFIED" ? ix.crawledAs : null,
    canonical: {
      google,
      declared,
      agrees,
      line: !google ? "Google has chosen no canonical yet: it has not crawled the page." : agrees ? "Google uses the canonical the page declares." : `Google chose another canonical than the page declares: ${google}${declared ? ` (the page declares ${declared})` : ""}.`,
    },
    robots: ix.robotsTxtState ?? null,
    fetch: ix.pageFetchState ?? null,
    indexing: ix.indexingState ?? null,
    sitemaps: (ix.sitemap ?? []).map(String).slice(0, 10),
    referring: (ix.referringUrls ?? []).map(String).slice(0, 10),
    mobile: { verdict: mobileVerdict, issues: mobileIssues.slice(0, 10), line: mobileLine },
    rich: { verdict: r.richResultsResult?.verdict ?? null, items, line: richLine },
    consoleHref: r.inspectionResultLink ?? consoleHref("inspect", property, url),
    changed: was,
  };
}

/** A URL as the stored path the index rows use ("/x", "/" for home). */
const gscPath = (url: string): string => sitePath(url) ?? url;

/** One of the website's own addresses as Google is asked about it: the sitemap's spelling when it lists the page. */
function addressOf(asked: string): { url: string; path: string } {
  const path = sitePath(asked);
  if (!path || asked.length > 500) throw new Cannot(400, "Only the website's own addresses can be asked about: a path starting with /, or a full address on the site.");
  let url = abs(path);
  try {
    const listed = site.lastSitemap()?.entries.find((e) => e.path === path);
    if (listed) url = listed.loc;
  } catch {
    /* the sitemap has not been read: the plain address stands */
  }
  return { url, path };
}

const PUT_DAILY = `INSERT INTO cc_inspect (day, url, verdict, coverage, last_crawl, google_canonical, user_canonical, robots_state, fetch_state, indexing_state, is_indexed, canonical_ok, link, checked_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(day, url) DO UPDATE SET verdict = excluded.verdict, coverage = excluded.coverage, last_crawl = excluded.last_crawl,
     google_canonical = excluded.google_canonical, user_canonical = excluded.user_canonical, robots_state = excluded.robots_state,
     fetch_state = excluded.fetch_state, indexing_state = excluded.indexing_state, is_indexed = excluded.is_indexed,
     canonical_ok = excluded.canonical_ok, link = excluded.link, checked_at = excluded.checked_at`;

/**
 * Ask Google about ONE address now. The answer is Google's stored record of
 * the address (its indexed version), not a live test of the page.
 *
 * Kept twice, for two readers: the index state under today in cc_inspect,
 * where the daily check keeps every address's (so every screen and the
 * engine's queue see it at once), and the whole answer in cc_seo_inspect_now
 * for showing it again.
 */
export async function inspectNow(asked: string, by: Person): Promise<{ inspection: InspectNow; quota: InspectQuota; line: string }> {
  const { site: property } = connected();
  const { url, path } = addressOf(asked);

  const day = dayIn(PACIFIC);
  const used = countOn(INSPECT_USED, day);
  if (used >= INSPECT_CAP) throw new Cannot(409, `Today's ${INSPECT_CAP.toLocaleString("en-GB")} URL inspections of this property are used. Google counts a new day from midnight Pacific Time.`);
  /* Counted before it is asked, as the daily check does: a request that fails was still spent. */
  setCount(INSPECT_USED, day, used + 1);

  const before = latestInspection()?.rows.find((r) => r.path === path) ?? null;
  const doing = `it was asked about ${path}`;
  const res = await askGoogle("POST", `${INSPECT()}/urlInspection/index:inspect`, { body: { inspectionUrl: url, siteUrl: property, languageCode: "en" }, doing });
  if (res.status < 200 || res.status >= 300) throw new Cannot(502, refusalOf(res.status, res.json, doing));

  const at = now();
  const inspection = readInspection((res.json ?? {}) as RawInspection, url, by.name, at, before, property);
  db.prepare(PUT_DAILY).run(
    today(),
    url,
    inspection.verdict,
    inspection.coverage,
    inspection.lastCrawl,
    inspection.canonical.google,
    inspection.canonical.declared,
    inspection.robots,
    inspection.fetch,
    inspection.indexing,
    inspection.indexed ? 1 : 0,
    inspection.canonical.agrees === null ? null : inspection.canonical.agrees ? 1 : 0,
    inspection.consoleHref,
    at,
  );
  db.prepare(
    `INSERT INTO cc_seo_inspect_now (url, path, at, by, is_indexed, coverage, answer) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET path = excluded.path, at = excluded.at, by = excluded.by, is_indexed = excluded.is_indexed, coverage = excluded.coverage, answer = excluded.answer`,
  ).run(url, path, at, by.name, inspection.indexed ? 1 : 0, inspection.coverage, JSON.stringify(inspection));

  const quota = inspectQuota();
  const line = `${inspection.line}${inspection.changed ? ` ${inspection.changed}` : ""} Inspection ${quota.used.toLocaleString("en-GB")} of ${INSPECT_CAP.toLocaleString("en-GB")} today.`;
  note("seo-action", `Asked Google about ${path}: ${inspection.indexed ? "indexed" : (inspection.coverage ?? "not indexed")}`, {
    tone: inspection.indexed ? "good" : "info",
    actor: by.name,
    detail: `URL Inspection. ${inspection.changed ? `${inspection.changed} ` : ""}${inspection.canonical.line}`,
    href: inspection.consoleHref ?? PANEL_HREF,
    dedupe: `google:inspect:${path}:${at}`,
  });
  return { inspection, quota, line };
}

/** The last answer a person asked for about an address, as it was kept. */
export function lastAsked(asked: string): Reading<InspectNow> {
  const path = sitePath(asked);
  if (!path) return off("gsc", "Only the website's own addresses can be asked about.");
  const row = db.prepare("SELECT at, answer FROM cc_seo_inspect_now WHERE path = ? ORDER BY at DESC LIMIT 1").get(path) as { at: string; answer: string } | undefined;
  const value = row ? json<InspectNow | null>(row.answer, null) : null;
  if (!row || !value) return waiting("gsc", `Nobody has asked Google about ${path} from the desk yet. “Inspect now” asks; the daily check keeps its index state either way.`);
  return ok(value, "gsc", row.at, "Google's stored record of the address when it was asked: its indexed version, not a live test of the page.");
}

/* ---------- the Request indexing queue ------------------------------------------------------------ */

export const REQUEST_LINE =
  "Google has no API to request indexing of an ordinary page (its Indexing API is for job postings and live streams only), so that one press stays yours in Search Console. The desk opens the right screen, keeps the queue, and does what does bring Google sooner: it submits the sitemap again and checks the page is linked from pages Google already has.";

interface LinkRow {
  source: string;
  target: string;
  text: string;
  place: "main" | "chrome";
}

/**
 * Who links to what, by the last crawl. ONE read of the crawl's link table for
 * the whole queue: the crawl's own `page()` rebuilds every row of the site
 * each time it is called (the same reason src/cc/seo/site.ts reads once).
 */
function linkGraph(): Map<string, LinkRow[]> {
  const by = new Map<string, LinkRow[]>();
  let rows: LinkRow[] = [];
  try {
    rows = db.prepare("SELECT source, target, text, place FROM cc_links WHERE internal = 1 AND source <> target").all() as unknown as LinkRow[];
  } catch {
    rows = [];
  }
  for (const r of rows) by.set(r.target, [...(by.get(r.target) ?? []), r]);
  return by;
}

function linkCheckOf(path: string, graph: Map<string, LinkRow[]>, ins: LatestInspection | null, listed: Set<string> | null): LinkCheck {
  /* One line per page that links here; a link in the page's own text counts before the same page's menu link. */
  const bySource = new Map<string, LinkRow>();
  for (const l of graph.get(path) ?? []) {
    const had = bySource.get(l.source);
    if (!had || (had.place !== "main" && l.place === "main")) bySource.set(l.source, l);
  }
  const indexedPaths = new Set((ins?.rows ?? []).filter((r) => r.indexed).map((r) => r.path));
  const fromIndexed = [...bySource.values()].filter((l) => indexedPaths.has(l.source)).sort((a, b) => Number(b.place === "main") - Number(a.place === "main") || a.source.localeCompare(b.source));
  const fromContent = fromIndexed.filter((l) => l.place === "main").length;
  const total = bySource.size;
  const inSitemap = listed ? listed.has(path) : true;
  const sitemapWord = inSitemap ? "" : " It is not in the sitemap either.";
  let line: string;
  let tone: LinkCheck["tone"];
  if (!ins) {
    tone = "warn";
    line = `${plural(total, "page")} of the site link to it; which of them Google has indexed is not known until the first index check has run.`;
  } else if (fromIndexed.length === 0) {
    tone = "bad";
    line = `No page Google has indexed links to it${total ? ` (the ${plural(total, "page")} that do are not indexed themselves)` : " (nothing on the site links to it)"}. Google finds a new page by following a link from one it already has: link it from an indexed page's own text.${sitemapWord}`;
  } else if (fromContent === 0) {
    tone = "warn";
    line = `Linked from ${plural(fromIndexed.length, "page")} Google has indexed, but only in the menu or the footer. A link in a related page's own text tells Google more about it.${sitemapWord}`;
  } else {
    tone = inSitemap ? "good" : "warn";
    line = `Linked from the text of ${plural(fromContent, "page")} Google has indexed${fromIndexed.length > fromContent ? `, and from ${fromIndexed.length - fromContent} more in the menu or footer` : ""}.${sitemapWord}`;
  }
  return { path, total, fromIndexed: fromIndexed.length, fromContent, examples: fromIndexed.slice(0, 5).map((l) => ({ path: l.source, text: l.text, place: l.place })), inSitemap, line, tone };
}

function listedPaths(): Set<string> | null {
  try {
    const m = site.lastSitemap();
    return m?.entries.length ? new Set(m.entries.map((e) => e.path)) : null;
  } catch {
    return null;
  }
}

/** Is one page linked from pages Google already has. For any page of the site, in the queue or not. */
export function linkCheck(asked: string): Reading<LinkCheck> {
  const path = sitePath(asked);
  if (!path) return off("crawl", "Only the website's own addresses have links the crawl knows.");
  const at = site.crawledAt();
  if (!at) return waiting("crawl", "The first crawl has not finished yet, so the desk does not know which pages link where.");
  return ok(linkCheckOf(path, linkGraph(), latestInspection(), listedPaths()), "crawl", at, "Links by the desk's last crawl; which linking pages Google has indexed by its newest URL Inspection of each.");
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/** The Request indexing queue: every page Google has not indexed, most important first, with what a person needs for each. */
export function queue(): GooglePanel["queue"] {
  const access = accessNow();
  if (!access.connected) return off("gsc", access.reason ?? "Search Console is not connected.", access.step ?? undefined);
  const ins = latestInspection();
  if (!ins || !ins.rows.length) return waiting("gsc", "Google's URL Inspection of every sitemap address runs once a day; it has not finished a first round on this desk yet.");
  const newest = new Map(ins.rows.map((r) => [r.path, r]));
  const askedBy = new Map((db.prepare("SELECT path, at FROM cc_seo_inspect_now").all() as { path: string; at: string }[]).map((r) => [r.path, r.at]));
  const graph = linkGraph();
  const listed = listedPaths();
  const rows: IndexQueueRow[] = [];
  for (const o of allOpportunities()) {
    if (o.type !== "not-indexed" || !o.active || o.state === "dismissed" || o.state === "done") continue;
    const path = o.page ?? o.id.replace(/^not-indexed:/, "");
    const row = newest.get(path) ?? null;
    /* Asked since and found indexed: nothing left to request. The engine clears the opportunity at its next run. */
    if (row?.indexed) continue;
    const url = row?.url ?? abs(path);
    const requested = o.state === "in-progress";
    rows.push({
      path,
      url,
      coverage: row?.coverage ?? null,
      inspectedAt: row?.at ?? row?.day ?? null,
      inspectedBy: row ? (askedBy.get(path) && row.at && askedBy.get(path)! >= row.at ? "person" : "daily") : null,
      priority: o.priority,
      requested,
      requestedBy: requested ? o.state_by : null,
      requestedAt: requested ? o.state_at : null,
      consoleHref: consoleHref("inspect", access.site, url),
      links: linkCheckOf(path, graph, ins, listed),
    });
  }
  rows.sort((a, b) => Number(a.requested) - Number(b.requested) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.path.localeCompare(b.path));
  const requested = rows.filter((r) => r.requested).length;
  return ok(
    { rows, waiting: rows.length - requested, requested },
    "gsc",
    ins.rows.reduce((t, r) => ((r.at ?? "") > t ? (r.at as string) : t), "") || ins.day,
    `Pages Google's newest URL Inspection reports as not indexed${ins.complete ? "" : ` (the check on ${ins.day} reached ${ins.checked} of ${ins.of ?? "the"} addresses; the others keep their last result)`}. Requesting is pressed by hand in Search Console, about ten a day.`,
  );
}

/**
 * A person says they pressed "Request indexing" in Search Console for a page,
 * or takes that back. A page that is not in the queue (Google has it, or it
 * was never inspected) has nothing to mark; the press is still written down.
 */
export function markRequested(asked: string, requested: boolean, by: Person): { line: string; changed: boolean } {
  const path = sitePath(asked);
  if (!path) throw new Cannot(400, "Only the website's own addresses can be marked: a path starting with /.");
  const o = allOpportunities().find((x) => x.id === `not-indexed:${path}` && x.active);
  if (!o) {
    if (!requested) return { line: `${path} is not in the Request indexing queue, so there is no mark to take back.`, changed: false };
    note("seo-action", `Requested indexing: ${path}`, { tone: "info", actor: by.name, detail: "By hand, in Search Console's URL Inspection. The page is not in the desk's queue (Google's last answer has it indexed, or it has not been inspected).", href: PANEL_HREF, dedupe: `google:requested:${path}:${now()}` });
    return { line: `Noted. ${path} is not in the queue (Google's last answer has it indexed, or it has not been inspected yet), so there is nothing to mark.`, changed: true };
  }
  const was = o.state === "in-progress";
  markSubmitted(path, requested, by);
  return { line: requested ? `Marked: indexing of ${path} was requested in Search Console.` : was ? "Mark taken back." : "It was not marked.", changed: requested || was };
}

/* ---------- IndexNow ------------------------------------------------------------------------------ */

const KEY_KEPT = "google:indexnow:key";
const LAST_KEPT = "google:indexnow:last";
const BASELINE_AT = "google:indexnow:baseline";

/** The website's key, looked for at most every six hours (a stale answer stands while the repository cannot be read). */
async function indexNowKey(fresh = false): Promise<{ key: string | null; why: string | null }> {
  try {
    const had = await cached<string | null>(KEY_KEPT, fresh ? 0 : 6 * 3_600_000, () => wire.key());
    return { key: had.value, why: null };
  } catch (e) {
    return { key: null, why: first(e) };
  }
}

const later = (a: string, b: string): boolean => {
  const [x, y] = [Date.parse(a), Date.parse(b)];
  return Number.isNaN(x) || Number.isNaN(y) ? a > b : x > y;
};

/**
 * What changed since the desk's last announcement: sitemap addresses that are
 * new or whose lastmod moved forward, and addresses that left the sitemap.
 *
 * THE FIRST LOOK IS A BASELINE. Until the desk has seen the sitemap once it
 * has nothing to compare with, and the website's own workflow has announced
 * every deployment so far (scripts/announce.mjs). So the first look writes
 * every address down as known and reports nothing as changed.
 */
function changedSince(): { paths: string[]; gone: string[]; since: string | null; entries: site.SitemapEntry[] } {
  const m = site.lastSitemap();
  const entries = m?.entries ?? [];
  const had = new Map((db.prepare("SELECT path, lastmod, at FROM cc_seo_announced").all() as { path: string; lastmod: string | null; at: string | null }[]).map((r) => [r.path, r]));
  if (!had.size) {
    if (entries.length) {
      const put = db.prepare("INSERT OR IGNORE INTO cc_seo_announced (path, lastmod, at, by) VALUES (?, ?, NULL, NULL)");
      for (const e of entries) put.run(e.path, e.lastmod);
      setState(BASELINE_AT, now());
    }
    return { paths: [], gone: [], since: state(BASELINE_AT), entries };
  }
  const lastAt = (db.prepare("SELECT MAX(at) AS a FROM cc_seo_announced").get() as { a: string | null }).a;
  const paths = entries
    .filter((e) => {
      const r = had.get(e.path);
      return !r || (!!e.lastmod && (!r.lastmod || later(e.lastmod, r.lastmod)));
    })
    .map((e) => e.path);
  /* "Gone" only from a sitemap that was really read: a failed read keeps the last good list, and must not report the site as emptied. */
  const listed = new Set(entries.map((e) => e.path));
  const gone = m && m.status === 200 && !m.entriesAt && entries.length ? [...had.keys()].filter((p) => !listed.has(p)) : [];
  return { paths, gone, since: lastAt ?? state(BASELINE_AT), entries };
}

const ENGINE_WORDS: Record<number, string> = {
  200: "accepted",
  202: "accepted; it still has to read the key file",
  400: "did not understand the request",
  403: "refused the key (it could not read the key file on the website)",
  422: "refused: the addresses do not belong to the host, or the key does not match",
  429: "refused for now: too many announcements",
};

const engineAnswer = (engine: string, status: number): EngineAnswer => ({
  engine,
  status,
  accepted: status === 200 || status === 202,
  line: status === 0 ? "did not answer" : (ENGINE_WORDS[status] ?? `answered ${status}`),
});

/** IndexNow as the panel shows it. Reads the kept key and the desk's own tables; the key is looked for in the repository at most every six hours. */
export async function indexNowState(): Promise<Reading<IndexNowState>> {
  const { key, why } = await indexNowKey();
  const engines = ENGINES.map((e) => e.name);
  if (!key) {
    return off(
      "repo",
      why ? `The website's IndexNow key could not be looked for: ${why}.` : "The website has no IndexNow key file: a file in its public/ folder named after its own contents (32 hex characters and .txt).",
      why ? "Automations: run “repo” (the website's repository), then open this page again." : "A change to the website's code: add public/<key>.txt containing the key. The website's scripts/announce.mjs reads the same file.",
    );
  }
  const c = changedSince();
  const last = json<IndexNowState["last"]>(state(LAST_KEPT), null);
  const n = c.paths.length + c.gone.length;
  return ok(
    {
      keyFile: `/${key}.txt`,
      engines,
      changed: { paths: c.paths, gone: c.gone, since: c.since },
      last,
      line: n
        ? `${plural(n, "address", "addresses")} changed since ${c.since ? shortDay(c.since) : "the desk first looked"}: ${c.paths.length} new or re-dated${c.gone.length ? `, ${c.gone.length} gone from the sitemap` : ""}.`
        : `Nothing in the sitemap has changed since ${last ? "the desk's last announcement" : c.since ? `the desk first looked (${shortDay(c.since)})` : "the desk first looked"}.`,
    },
    "repo",
    last?.at ?? c.since ?? now(),
    "IndexNow reaches Bing, Yandex, Seznam, Naver and Yep (Bing's index is also what Copilot, DuckDuckGo and ChatGPT's search read). Google does not take part. The website's own workflow also announces every deployment; announcing an address twice does no harm.",
  );
}

const MAX_BY_HAND = 50;

/**
 * Tell the IndexNow engines about addresses: the ones given, or (with
 * `changed`) everything that changed since the desk's last announcement.
 */
export async function announce(what: { paths?: string[]; changed?: boolean }, by: Person): Promise<{ line: string; addresses: number; answers: EngineAnswer[] }> {
  const { key, why } = await indexNowKey(true);
  if (!key) throw new Cannot(409, why ? `Not announced: the website's IndexNow key could not be looked for (${why}).` : "Not announced: the website has no IndexNow key file in its public/ folder (a file named after its own contents). It is a change to the website's code.");

  const c = changedSince();
  const locOf = new Map(c.entries.map((e) => [e.path, e.loc]));
  let paths: string[];
  let gone: string[] = [];
  if (what.changed) {
    paths = c.paths;
    gone = c.gone;
    if (!paths.length && !gone.length) throw new Cannot(409, "Nothing to announce: no sitemap address is new, re-dated or gone since the desk's last announcement. One address can still be announced by itself.");
  } else {
    const given = [...new Set((what.paths ?? []).map((p) => sitePath(String(p))))];
    if (!given.length || given.some((p) => p === null)) throw new Cannot(400, "Give the website's own addresses: paths starting with /.");
    if (given.length > MAX_BY_HAND) throw new Cannot(400, `At most ${MAX_BY_HAND} addresses at once by hand; “everything changed” has no such limit.`);
    paths = given as string[];
  }

  const askedSite = await siteMustAnswer("announced");
  /* One address by itself is asked first: 200 is a page to fetch, 404 and 410 a page to drop, anything else an error nobody should be sent to. */
  if (!what.changed && paths.length === 1) {
    if (askedSite) await wire.pause(1_000);
    const s = await wire.status(locOf.get(paths[0]!) ?? abs(paths[0]!));
    if (s !== 200 && s !== 404 && s !== 410) throw new Cannot(409, `Not announced: ${paths[0]} ${s ? `answered ${s}` : "did not answer"} when the desk asked it just now. An engine would fetch that error.`);
  }

  const host = new URL(siteBase()).host;
  const urlList = [...paths, ...gone].map((p) => locOf.get(p) ?? abs(p)).slice(0, 10_000);
  const body = { host, key, keyLocation: `${siteBase()}/${key}.txt`, urlList };
  const answers: EngineAnswer[] = [];
  for (const [i, e] of ENGINES.entries()) {
    if (i) await wire.pause(250);
    answers.push(engineAnswer(e.name, await wire.announce(e.endpoint, body)));
  }
  const accepted = answers.filter((a) => a.accepted);
  const at = now();
  const said = answers.map((a) => `${a.engine} ${a.accepted ? "accepted" : a.line}${a.status ? ` (${a.status})` : ""}`).join(", ");
  const whatWord = urlList.length === 1 ? paths[0] ?? gone[0] ?? "one address" : plural(urlList.length, "address", "addresses");
  setState(LAST_KEPT, JSON.stringify({ at, by: by.name, addresses: urlList.length, answers } satisfies NonNullable<IndexNowState["last"]>));

  if (!accepted.length) {
    note("seo-action", `No search engine took the announcement of ${whatWord}`, { tone: "warn", actor: by.name, detail: `IndexNow: ${said}.`, href: PANEL_HREF, dedupe: `google:indexnow:${at}` });
    throw new Cannot(502, `No engine accepted the announcement: ${said}. Nothing was marked as announced.`);
  }
  /* What was announced is now known at this lastmod; what is gone is forgotten. */
  const lastmodOf = new Map(c.entries.map((e) => [e.path, e.lastmod]));
  const put = db.prepare("INSERT INTO cc_seo_announced (path, lastmod, at, by) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET lastmod = excluded.lastmod, at = excluded.at, by = excluded.by");
  for (const p of paths) put.run(p, lastmodOf.get(p) ?? null, at, by.name);
  const drop = db.prepare("DELETE FROM cc_seo_announced WHERE path = ?");
  for (const p of gone) drop.run(p);

  const line = `Told ${accepted.map((a) => a.engine).join(", ")} about ${whatWord}${accepted.length < answers.length ? `. Not taken by: ${answers.filter((a) => !a.accepted).map((a) => `${a.engine} (${a.line})`).join(", ")}` : ""}.`;
  note("seo-action", `Told the search engines about ${whatWord}`, { tone: accepted.length === answers.length ? "good" : "info", actor: by.name, detail: `IndexNow: ${said}.`, href: PANEL_HREF, dedupe: `google:indexnow:${at}` });
  return { line, addresses: urlList.length, answers };
}

/* ---------- the panel ------------------------------------------------------------------------------- */

/** The last few things done here, from the activity feed (every action above writes its line with a dedupe key that begins "google:"). */
function recent(limit = 6): GoogleDeed[] {
  try {
    const rows = db.prepare("SELECT at, actor, text, detail, tone FROM cc_activity WHERE kind = 'seo-action' AND dedupe LIKE 'google:%' ORDER BY at DESC, id DESC LIMIT ?").all(limit) as {
      at: string;
      actor: string | null;
      text: string;
      detail: string | null;
      tone: GoogleDeed["tone"];
    }[];
    return rows.map((r) => ({ at: r.at, by: r.actor, text: r.text, detail: r.detail, tone: r.tone }));
  } catch {
    return [];
  }
}

const failed = <T>(source: Reading<T>["source"], e: unknown): Reading<T> => waiting(source, `The last read failed: ${first(e)}`);

/** Everything the Google panel shows. No request to Google or to any search engine: only the desk's own tables and kept answers. */
export async function panel(): Promise<GooglePanel> {
  const part = <T>(source: Reading<T>["source"], make: () => Reading<T>): Reading<T> => {
    try {
      return make();
    } catch (e) {
      return failed(source, e);
    }
  };
  return {
    access: accessNow(),
    site: siteSeen(),
    sitemaps: part("gsc", sitemapsKept),
    quota: inspectQuota(),
    queue: part("gsc", queue),
    indexNow: await indexNowState().catch((e: unknown) => failed<IndexNowState>("repo", e)),
    requestLine: REQUEST_LINE,
    recent: recent(),
  };
}
