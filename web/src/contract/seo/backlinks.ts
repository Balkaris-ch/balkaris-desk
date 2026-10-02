/**
 * GET /api/v1/seo/backlinks?range=30d&q=&from=&sort= — links and presence.
 * GET /api/v1/seo/backlinks/export.csv?…&list=sites|profiles — the table, or the registry, as CSV.
 *
 * WHAT THERE IS, AND WHAT THERE IS NOT. Google gives no backlink API. Links
 * come from Bing Webmaster (off until its key exists), the sites that send
 * visitors (GA4 referrals, consenting visitors only) and the profiles and
 * listings the desk knows of, checked once a week. There is no "domain
 * rating", no "authority" and no "new/lost links" figure: none has a free,
 * honest source.
 *
 * Types only.
 */
import type { JobStatus, Reading, Stat } from "../common";
import type { OwnerTaskRow, SeoHead } from "./common";

export interface SeoBacklinksPayload {
  head: SeoHead;
  /** The filters of the linking-sites table, as the server understood them. */
  asked: BacklinksQuery;
  /** The whole days GA4, Vercel's records and Bing's daily count are read for: the range, ending yesterday, and the same length before. */
  window: { start: string; end: string; days: number; previousStart: string; previousEnd: string };
  /** The five figures over the page, each the true thing in the board's place (see BacklinksTiles). */
  tiles: BacklinksTiles;
  /** Bing Webmaster's inbound links. */
  bing: Reading<{ total: number; complete: boolean; pages: { path: string; links: number }[]; history: { day: string; links: number }[] }>;
  /** Sites that sent visitors (GA4 sessionMedium "referral") in the window, most sessions first. */
  referrers: Reading<{ start: string; end: string; total: number; rows: Referrer[] }>;
  /** Page views by referring site from Vercel's own request records (every visitor, not only consenting ones), on the days the drain delivered. */
  drain: Reading<{ start: string; end: string; days: number; total: number; rows: { host: string; views: number }[] }>;
  /** The board's table: one row per site that links (Bing) or sent visitors (GA4, Vercel), filtered and sorted as asked. */
  sites: Reading<SitesList>;
  profiles: Reading<{ rows: ProfileLine[]; checkedAt: string | null }>;
  /** Name, address and phone as each source states them, side by side. */
  nap: Reading<NapView>;
  /** The owner tasks about presence (profiles, listings, reviews, the one true address). */
  needsYou: OwnerTaskRow[];
  /** The weekly profile check (job "seo-presence"), for "Check profiles now"; null when the desk has no such job. */
  presenceJob: (Pick<JobStatus, "name" | "title" | "enabled" | "running" | "lastEnd" | "lastOk" | "lastNote" | "nextRun"> & { ready: boolean }) | null;
}

/* ---------- the linking-sites table ----------------------------------------------------------- */

/** Which rows: every site, those Bing knows links from, those that sent visitors (GA4), AI assistants, those in Vercel's records. */
export type SitesFrom = "all" | "links" | "visits" | "ai" | "views";
/** Most GA4 sessions, most Bing links, the newest first seen, or by name. */
export type SitesSort = "visits" | "links" | "newest" | "domain";

/** GET /api/v1/seo/backlinks?range=&q=&from=&sort= (and /export.csv with the same, plus list=sites|profiles). */
export interface BacklinksQuery {
  q: string;
  from: SitesFrom;
  sort: SitesSort;
}

/**
 * The board's five tiles, each replaced by the true thing in its place:
 *
 *   Total backlinks   → links    Bing's count of inbound links (absent until Bing Webmaster is connected)
 *   Referring domains → sites    sites that sent visitors in the window (GA4, consenting visitors only)
 *   Domain rating     → profiles profiles and listings that exist, of those the desk knows (no free source rates a domain honestly)
 *   New backlinks     → nap      name, address and phone: the fields every source states alike, of those stated
 *   Lost backlinks    → needsYou presence steps only the owner can take, still open
 *
 * New and lost links have no source until Bing is connected; then "new" is
 * the links Bing reported for the first time in the window (`links.sub`).
 */
export interface BacklinksTiles {
  links: Reading<Stat>;
  sites: Reading<Stat>;
  profiles: Reading<Stat>;
  nap: Reading<Stat>;
  needsYou: Reading<Stat>;
}

/** One site that links to the website or sent it visitors, with what each source says about it. */
export interface LinkingSite {
  /** "example.org", without www. */
  host: string;
  /** An AI assistant (also counted on AI Search), one of the studio's own profiles, or another site. */
  kind: "ai" | "profile" | "site";
  /** The assistant's name ("ChatGPT") or the profile's name in the registry; null for another site. */
  label: string | null;
  /** The registry's key when the host is one of the studio's profiles. */
  profileKey: string | null;
  /** Bing's links from this site: null while Bing is not read; count 0 when Bing knows none. */
  links: { count: number; pages: number; anchor: string | null; target: string | null; firstSeen: string | null } | null;
  /** GA4 sessions in the window: null while GA4 is not read; 0 when it counted none. `previous` is null when the window before was not measured whole. */
  visits: { sessions: number; previous: number | null; landing: string | null } | null;
  /** Page views it referred in the window by Vercel's records; null while the drain does not deliver. */
  views: number | null;
  /** The first day any source saw it, and which source. */
  firstSeen: { day: string; by: "bing" | "ga4" | "vercel-drain" } | null;
}

export interface SitesList {
  rows: LinkingSite[];
  /** Rows matching the filters, before the cap. */
  total: number;
  /** Rows by source over every site, for the select. */
  counts: Record<SitesFrom, number>;
  /** What the table leaves out and why: search engines, the site itself. */
  leftOut: string;
}

/* ---------- profiles and the one true name, address and phone ------------------------------------ */

/** A field as one profile states it, with the variant it belongs to ("A", "B": same letter, same value). */
export interface NapCell {
  value: string;
  variant: string;
  /** True when the weekly check read it from the profile itself; false when it is what the audit saw on its day. */
  read: boolean;
  day: string;
}

/** A registry row as the page draws it: each field as stated, with its variant, and the owner step that creates or fixes it. */
export interface ProfileLine extends ProfileRow {
  shown: { name: NapCell | null; address: NapCell | null; phone: NapCell | null };
  task: { id: string; title: string; done: boolean } | null;
}

/** NapMatrix with each field's distinct values grouped, and the decision that settles them. */
export interface NapView extends NapMatrix {
  groups: { field: "name" | "address" | "phone"; variants: { variant: string; value: string; sources: string[] }[] }[];
  /** The owner task that decides the one true name, address and phone, when there is one. */
  decision: { id: string; title: string; done: boolean } | null;
  /** How two values are compared, in one sentence. */
  rule: string;
}

export interface Referrer {
  host: string;
  sessions: number;
  /** GA4's active users summed per day and landing page: a person who came on two days counts twice, so it is not a count of people and no screen prints it as one. */
  users: number;
  /** The same in the window before; null when GA4 did not measure it whole. */
  previous: number | null;
  /** The page most of its sessions began on. */
  topLanding: string | null;
  /** Named as an AI assistant (chatgpt.com, perplexity.ai …): also counted on AI Search. */
  ai: boolean;
}

export type ProfileState = "exists" | "not-found" | "unknown" | "not-checked";

export interface ProfileRow {
  /** "google-business-profile", "linkedin", "clutch" … */
  key: string;
  name: string;
  kind: "listing" | "social" | "directory" | "register" | "website";
  /** The profile's address, when one is known. */
  url: string | null;
  /** What the weekly check found: the address answered (exists), answered 404/410 (not found), refused or no address known (unknown). */
  state: ProfileState;
  /** Why the state is what it is: "LinkedIn refuses automated checks (999)", "the audit found no listing on 2 Oct 2026". */
  stateWhy: string;
  checkedAt: string | null;
  /** Name, address and phone the check could read from the profile itself; null when nothing was readable. */
  nap: { name: string | null; address: string | null; phone: string | null } | null;
  /** What the audit saw on the profile on its day, kept apart from what the check reads. */
  napSeen: { name: string | null; address: string | null; phone: string | null; day: string } | null;
  /** The owner task that creates or fixes it, when there is one. */
  ownerTaskId: string | null;
}

export interface NapMatrix {
  /** One row per field, one cell per source that states it. */
  fields: { field: "name" | "address" | "phone"; values: { source: string; value: string; day: string }[]; consistent: boolean }[];
  /** True only when every source that states a field states the same value. */
  consistent: boolean;
}
