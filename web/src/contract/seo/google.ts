/**
 * /api/v1/seo/google — what the desk can DO at Google and the other search
 * engines, for the pages that draw it (SEO › Technical, Search Console, Pages).
 *
 *   GET  /api/v1/seo/google                    the panel: sitemaps, the indexing queue, IndexNow → GooglePanel
 *   GET  /api/v1/seo/google/inspect?path=      the last answer a person asked for, kept      → Reading<InspectNow>
 *   GET  /api/v1/seo/google/links?path=        is the page linked from pages Google knows    → Reading<LinkCheck>
 *
 * Changes (edit on a page that draws them; each is written to the activity feed with who did it):
 *   POST /api/v1/seo/google/inspect            { path }  Google's URL Inspection of one address, now → InspectAnswer
 *   POST /api/v1/seo/google/sitemaps/submit    { path }  submit (or submit again) one of the site's sitemaps → GoogleAnswer
 *   POST /api/v1/seo/google/sitemaps/refresh   {}        ask Search Console for its list of sitemaps again  → GoogleAnswer
 *   POST /api/v1/seo/google/requested          { path, requested }  a person pressed "Request indexing"
 *                                              in Search Console by hand, or takes the mark back    → GoogleAnswer
 *   POST /api/v1/seo/google/indexnow           { paths: string[] } or { changed: true }  tell Bing, Yandex,
 *                                              Seznam, Naver and Yep                                → IndexNowAnswer
 *
 * A refusal is { error: sentence } with 400 (the request), 409 (it cannot be done now: the website is not
 * answering, the day's allowance is used, Search Console is not connected) or 502 (Google or an engine refused).
 *
 * WHAT GOOGLE DOES NOT OFFER. There is no API to request indexing of an ordinary page: the Indexing API is for
 * job postings and live streams only. So "Request indexing" stays a person's press in Search Console; the desk
 * opens the right screen, keeps the queue, and does the two things that do bring Google sooner.
 *
 * Types only.
 */
import type { Reading } from "../common";

/** One sitemap: Search Console's record of it, or one of the site's own that Google has not been given yet. */
export interface GoogleSitemap {
  /** The sitemap's full address. */
  url: string;
  /** Its address on the site ("/sitemap.xml"). */
  path: string;
  /** False for a sitemap the site names (robots.txt) that Search Console does not list: never submitted. */
  known: boolean;
  lastSubmitted: string | null;
  /** When Google last fetched the file. */
  lastDownloaded: string | null;
  /** Google has it and has not processed it yet. */
  isPending: boolean;
  isIndex: boolean;
  /** Google's counts. It gives the numbers only; what the errors are is in Search Console's Sitemaps report. */
  warnings: number;
  errors: number;
  /** Addresses Google counted in the file. */
  submitted: number;
  /** Whether the desk offers to submit it: only the site's own sitemaps, never another address. */
  canSubmit: boolean;
}

/** May the desk read the property, and may it change it. */
export interface GoogleAccess {
  connected: boolean;
  /** The property: "sc-domain:balkaris.ch". */
  site: string | null;
  /** Google's word for the desk's permission: siteOwner, siteFullUser, siteRestrictedUser. */
  permission: string | null;
  /** True when that permission lets the desk submit a sitemap (Owner or Full). */
  canWrite: boolean;
  /** Why not, and the step a person would take; null when everything is in place. */
  reason: string | null;
  step: string | null;
}

/** Whether the website answers, by the desk's own probe: both submissions refuse while it does not. */
export interface SiteAnswering {
  ok: boolean;
  /** What the home page answered at the probe's last look; 0 nothing, null never looked. */
  status: number | null;
  at: string | null;
  /** True when that look is older than ten minutes: a submission then asks the website itself first. */
  stale: boolean;
  line: string;
}

/** The day's URL Inspection allowance (Google counts its day in Pacific Time). */
export interface InspectQuota {
  used: number;
  /** Google's own limit for a property. */
  cap: number;
  /** Where the daily check of every address stops, leaving the rest for "Inspect now". */
  dailyStopsAt: number;
  /** The Pacific day the count is for. */
  day: string;
  line: string;
}

/** Is a page linked from pages Google already has: the second thing that brings Google to it. */
export interface LinkCheck {
  path: string;
  /** Pages of the site that link to it, by the last crawl. */
  total: number;
  /** Of those, pages Google has indexed. */
  fromIndexed: number;
  /** Of those, links in the page's own content (not the menu or the footer). */
  fromContent: number;
  /** Up to five indexed pages that link to it, content links first. */
  examples: { path: string; text: string; place: "main" | "chrome" }[];
  inSitemap: boolean;
  /** The verdict in one sentence, with what to do when it is weak. */
  line: string;
  tone: "good" | "warn" | "bad";
}

/** One page of the Request indexing queue. */
export interface IndexQueueRow {
  path: string;
  url: string;
  /** Google's words for the address at its newest inspection. */
  coverage: string | null;
  /** When that inspection was, ISO, and whether a person asked for it ("Inspect now") or the daily check made it. */
  inspectedAt: string | null;
  inspectedBy: "daily" | "person" | null;
  priority: "high" | "medium" | "low";
  requested: boolean;
  requestedBy: string | null;
  requestedAt: string | null;
  /** Search Console's URL Inspection opened on exactly this address, where "Request indexing" is pressed. */
  consoleHref: string | null;
  links: LinkCheck | null;
}

/** One search engine's answer to an IndexNow announcement. */
export interface EngineAnswer {
  engine: string;
  /** What it answered; 0 for nothing. */
  status: number;
  accepted: boolean;
  /** The answer in words: "accepted", "accepted, the key is still to be checked", "refused the key"… */
  line: string;
}

export interface IndexNowState {
  /** The key file's address on the website ("/0123….txt"), found in the website's public/ folder; null when there is none. */
  keyFile: string | null;
  /** The engines an announcement goes to. */
  engines: string[];
  /** Sitemap addresses that are new or carry a newer lastmod than the desk last announced, and addresses that left the sitemap. */
  changed: { paths: string[]; gone: string[]; since: string | null };
  /** The desk's last announcement, or null when it has made none. */
  last: { at: string; by: string; addresses: number; answers: EngineAnswer[] } | null;
  line: string;
}

/** Something a person did here, as the activity feed keeps it. */
export interface GoogleDeed {
  at: string;
  by: string | null;
  text: string;
  detail: string | null;
  tone: "good" | "info" | "warn" | "bad";
}

export interface GooglePanel {
  access: GoogleAccess;
  site: SiteAnswering;
  /** Search Console's sitemaps beside the site's own. Read from the desk's kept copy: "Ask Google again" refreshes it. */
  sitemaps: Reading<{ rows: GoogleSitemap[]; consoleHref: string | null }>;
  quota: InspectQuota;
  /** The Request indexing queue: pages Google has not indexed, most important first. */
  queue: Reading<{ rows: IndexQueueRow[]; waiting: number; requested: number }>;
  indexNow: Reading<IndexNowState>;
  /** What Google allows and what the desk does instead, in one sentence. */
  requestLine: string;
  /** The last few things done here. */
  recent: GoogleDeed[];
}

/** Google's URL Inspection of one address, in plain words. Google's stored record, not a live test of the page. */
export interface InspectNow {
  path: string;
  url: string;
  /** When Google answered, ISO, and who asked. */
  at: string;
  by: string;
  indexed: boolean;
  /** PASS, NEUTRAL, FAIL, or null. */
  verdict: string | null;
  /** Google's own words: "Submitted and indexed", "Crawled - currently not indexed". */
  coverage: string | null;
  /** "In Google's index." or "Not in Google's index: …", with what Google means by it. */
  line: string;
  meaning: string;
  fix: string;
  lastCrawl: string | null;
  /** MOBILE or DESKTOP: which Googlebot crawled it. */
  crawledAs: string | null;
  canonical: { google: string | null; declared: string | null; agrees: boolean | null; line: string };
  /** Google's raw states, for the detail line: robots.txt, the fetch, whether indexing is allowed. */
  robots: string | null;
  fetch: string | null;
  indexing: string | null;
  /** The sitemaps Google found the address in, and pages it found links to it on. */
  sitemaps: string[];
  referring: string[];
  mobile: { verdict: string | null; issues: string[]; line: string };
  rich: { verdict: string | null; items: { type: string; count: number; issues: { severity: string; message: string }[] }[]; line: string };
  /** The same result in Search Console. */
  consoleHref: string | null;
  /** What it was at the check before, when that differs: "Was: Discovered - currently not indexed (2 Oct)." */
  changed: string | null;
}

export interface GoogleAnswer {
  ok: true;
  /** What happened, in one sentence, for the line under the button. */
  line: string;
}

export interface InspectAnswer extends GoogleAnswer {
  inspection: InspectNow;
  quota: InspectQuota;
}

export interface IndexNowAnswer extends GoogleAnswer {
  addresses: number;
  answers: EngineAnswer[];
}
