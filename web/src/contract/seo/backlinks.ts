/**
 * GET  /api/v1/seo/backlinks?range=30d&q=&from=&sort=&page=&open=   links and presence
 * GET  /api/v1/seo/backlinks/export.csv?…&list=sites|profiles|links  the table, the registry, or every link, as CSV
 * POST /api/v1/seo/backlinks/check              { url, fresh? }        read one page of the web for a link to the website
 * POST /api/v1/seo/backlinks/links              { url, note? }         follow a link (or a page a link is expected on)
 * POST /api/v1/seo/backlinks/links/:id          { tracked?, note? }    stop following, or change the note
 * POST /api/v1/seo/backlinks/links/:id/check                           read that page again now
 * POST /api/v1/seo/backlinks/import      OWNER  { csv }                Search Console's Links export, any of its tables
 * POST /api/v1/seo/backlinks/profiles           { name, kind, url? }   add a profile or listing
 * POST /api/v1/seo/backlinks/profiles/:key      { name?, kind?, url?, stated?, remove? }
 * POST /api/v1/seo/backlinks/profiles/:key/check                       ask that one address now
 * POST /api/v1/seo/backlinks/profiles/:key/found { use }               take or dismiss an address the weekly check found
 * POST /api/v1/seo/backlinks/nap         OWNER  { name, address, phone } the one true name, address and phone
 *
 * WHAT THERE IS, AND WHAT THERE IS NOT. Google gives no backlink API. Links
 * come from four places, each named beside its figure: Bing Webmaster (off
 * until its key exists), Search Console's Links report exported by hand and
 * imported here, the pages the desk reads itself (a page a person had
 * checked, a link being worked on, a referring page GA4 named), and the
 * sites that send visitors (GA4, consenting visitors only; Vercel's records
 * once its drain delivers). "New" and "lost" are the desk's own readings of
 * a linking page: the link was there, and now it is not. There is no "domain
 * rating" and no "authority": none has a free, honest source.
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
  /** Bing Webmaster's inbound links, from the answer the daily job kept: drawing the page never asks Bing. */
  bing: Reading<{ total: number; complete: boolean; pages: { path: string; links: number }[]; history: { day: string; links: number }[] }>;
  /** Search Console's Links report, as last exported by hand and imported. */
  google: Reading<GoogleLinks>;
  /** Sites that sent visitors in the window (GA4, by the session's source and by the referring address), most sessions first. */
  referrers: Reading<{ start: string; end: string; total: number; rows: Referrer[] }>;
  /** Page views by referring site from Vercel's own request records (every visitor, not only consenting ones), on the days the drain delivered. */
  drain: Reading<{ start: string; end: string; days: number; total: number; rows: { host: string; views: number }[] }>;
  /** The board's table: one row per site that links or sent visitors, filtered, sorted and paged as asked. */
  sites: Reading<SitesList>;
  /** The site opened with ?open=: every link and visit behind its row. Null when none is asked for, or the site is not in the table. */
  open: SiteDetail | null;
  /** The links the desk follows itself: added by a person, or kept from a check. */
  tracked: Reading<TrackedList>;
  profiles: Reading<{ rows: ProfileLine[]; checkedAt: string | null }>;
  /** Name, address and phone as each source states them, side by side, against the agreed ones when there are any. */
  nap: Reading<NapView>;
  /** The owner tasks about presence (profiles, listings, reviews, the one true address). */
  needsYou: OwnerTaskRow[];
  /** The weekly profile check (job "seo-presence"), for "Check profiles now"; null when the desk has no such job. */
  presenceJob: JobLine | null;
  /** The daily read of referring pages and re-check of followed links (job "seo-backlinks"); null when the desk has no such job. */
  linksJob: JobLine | null;
  /** Search Console's Links report for this property, where the export is made. */
  gscLinksUrl: string;
  /** Who is looking: the import and the one true name, address and phone are the owner's to change. */
  viewer: { owner: boolean };
}

export type JobLine = Pick<JobStatus, "name" | "title" | "enabled" | "running" | "lastEnd" | "lastOk" | "lastNote" | "nextRun"> & { ready: boolean };

/* ---------- the linking-sites table ----------------------------------------------------------- */

/**
 * Which rows: every site; those a source knows a link from (Bing, Google's
 * export, the desk's own reading); those in Google's export; those that sent
 * visitors (GA4); AI assistants; those in Vercel's records; those first seen
 * inside the period.
 */
export type SitesFrom = "all" | "links" | "google" | "visits" | "ai" | "views" | "new";
/** Most GA4 sessions, most links, the newest first seen, or by name. */
export type SitesSort = "visits" | "links" | "newest" | "domain";

/** GET /api/v1/seo/backlinks?range=&q=&from=&sort=&page=&open= (and /export.csv with the same, plus list=). */
export interface BacklinksQuery {
  /** The search text as typed (lower case). An address or a www. spelling is searched by its host. */
  q: string;
  from: SitesFrom;
  sort: SitesSort;
  /** The page of the table, from 1. */
  page: number;
  /** The site whose detail is open, or "". */
  open: string;
}

/**
 * The board's five tiles, each replaced by the true thing in its place:
 *
 *   Total backlinks   → links    linking pages a source names: Bing's index, Google's export, the desk's own reading
 *   Referring domains → sites    sites that sent visitors in the window (GA4, consenting visitors only)
 *   Domain rating     → profiles profiles and listings that exist, of those the desk knows (no free source rates a domain honestly)
 *   New backlinks     → nap      name, address and phone: the fields every source states alike, of those stated
 *   Lost backlinks    → needsYou presence steps only the owner can take, still open
 *
 * New and lost links are in the links tile's second line: links first found
 * in the window, and links a later reading no longer found.
 */
export interface BacklinksTiles {
  links: Reading<Stat>;
  sites: Reading<Stat>;
  profiles: Reading<Stat>;
  nap: Reading<Stat>;
  needsYou: Reading<Stat>;
}

/** Where a count of links comes from. */
export type LinkSource = "bing" | "google" | "desk";

/** One site that links to the website or sent it visitors, with what each source says about it. */
export interface LinkingSite {
  /** The site: "example.org", without www. and without a sub-domain that is only a doorway (l.instagram.com is instagram.com). */
  host: string;
  /** Every host a source named under this site, when there is more than the site itself. */
  hosts: string[];
  /**
   * An AI assistant (also counted on AI Search), one of the studio's own
   * profiles, or another site. "profile" only when a source named the
   * profile's own address as the page that linked or referred: a visit from
   * instagram.com may be somebody else's post, so the network alone is not
   * the studio's profile.
   */
  kind: "ai" | "profile" | "site";
  /** The assistant's name ("ChatGPT") or the profile's name in the registry; null for another site. */
  label: string | null;
  /** The registry's key when the studio has a profile on this site (whether or not the visits came from it). */
  profileKey: string | null;
  /**
   * Links from this site: null while no source of links is read at all.
   * `count` is the largest count any one source gives (never a sum: two
   * sources see the same links) and `by` names that source; each source's own
   * count is beside it, null where that source is not read.
   */
  links: {
    count: number;
    by: LinkSource | null;
    bing: number | null;
    google: number | null;
    desk: number | null;
    /** Links the desk found once and no longer finds on the page. */
    lost: number;
    anchor: string | null;
    target: string | null;
    /** Read from the linking pages themselves: every link followed, none, some; null when the desk has read none of them. */
    follow: "follow" | "nofollow" | "mixed" | null;
    firstSeen: string | null;
  } | null;
  /** GA4 sessions in the window: null while GA4 is not read; 0 when it counted none. `previous` is null when the window before was not measured whole. */
  visits: { sessions: number; previous: number | null; landing: string | null } | null;
  /** Page views it referred in the window by Vercel's records; null while the drain does not deliver. */
  views: number | null;
  /** The first day any source saw it, and which source. */
  firstSeen: { day: string; by: "bing" | "ga4" | "vercel-drain" | "google" | "desk" } | null;
}

export interface SitesList {
  /** One page of the rows matching the filters. */
  rows: LinkingSite[];
  /** Rows matching the filters, over every page. */
  total: number;
  /** The page shown, from 1, and how many there are. */
  page: number;
  pages: number;
  perPage: number;
  /** Rows by source over every site, for the select. */
  counts: Record<SitesFrom, number>;
  /** What the table leaves out and why: search engines, the site itself. */
  leftOut: string;
}

/** One link to the website, as far as any source knows it. */
export interface KnownLink {
  /** The desk's own row, when it keeps one (a followed link, a checked page, Google's export): what the buttons act on. */
  id: number | null;
  /** The linking page. */
  source: string;
  host: string;
  /** The page of the website it links to, when a source said. */
  target: string | null;
  anchor: string | null;
  /** The link's own rel words ("nofollow", "sponsored", "ugc"), when the desk read the page; null when it did not. */
  rel: string[] | null;
  /** Who says the link exists. */
  origins: ("bing" | "google" | "check" | "manual" | "ga4")[];
  /** What the desk's own reading of the page found: the link is there, was there and is gone, the page could not be read, or it was never read. */
  state: LinkState;
  /** Why, in a sentence, when the state is not "live". */
  stateWhy: string | null;
  /** The day the desk first knew of it; the day its own reading first found the link; when it last read the page; the day a reading no longer found it. */
  firstSeen: string;
  firstLive: string | null;
  checkedAt: string | null;
  lostAt: string | null;
  /** Bing's: the day it last listed the link. Google's: the day its crawler last read the linking page. */
  bingLastSeen: string | null;
  googleCrawled: string | null;
  /** A person follows it ("Links we are working on"). */
  tracked: boolean;
  note: string | null;
  addedBy: string | null;
}

/** live: the page links to the website. lost: it did and no longer does. waiting: the page is read and has no link (yet). unreadable: the page could not be read. not-checked: nothing read it yet. */
export type LinkState = "live" | "lost" | "waiting" | "unreadable" | "not-checked";

/** What ?open=<host> shows: the links and the visits behind one row. */
export interface SiteDetail {
  host: string;
  hosts: string[];
  label: string | null;
  kind: LinkingSite["kind"];
  /** Every link any source knows from this site, the desk's own readings first. At most 200. */
  links: KnownLink[];
  linksTotal: number;
  /** Google's export, for this site: how many of its pages link, to how many pages of the website. Null when the export has no row for it. */
  google: { pages: number; targets: number; day: string } | null;
  /** GA4 sessions from this site per day of the window; null while GA4 is not read. */
  days: { day: string; sessions: number }[] | null;
  /** The pages its visitors landed on, most sessions first. */
  landings: { path: string; sessions: number }[];
  /** The referring addresses GA4 named (often only the site's front door: browsers send no more). */
  referrers: { url: string; sessions: number }[];
}

/** The links the desk follows, with what the window brought. */
export interface TrackedList {
  rows: KnownLink[];
  /** Links first found on their page inside the window, and links a reading inside the window no longer found. */
  fresh: number;
  lost: number;
  /** Every link the desk reads itself, followed or not, by state. */
  counts: Record<LinkState, number>;
}

/** Search Console › Links, as the owner exported it and the desk keeps it. Each table is the newest import of its kind. */
export interface GoogleLinks {
  /** "Top linking sites": site, linking pages, target pages, and the day the desk first had the site from an export (kept across later imports). */
  sites: { host: string; pages: number; targets: number; firstSeen: string | null }[];
  /** "Top linked pages": page of the website, incoming links, linking sites. */
  pages: { path: string; links: number; sites: number }[];
  /** "Top linking text", in Google's order. */
  texts: string[];
  /** Linking pages from "Latest links" and "More sample links" kept so far. */
  samples: number;
  /** When each table was last imported, and by whom; null when it never was. */
  imported: Record<GscLinksKind, { at: string; by: string; rows: number } | null>;
}

export type GscLinksKind = "sites" | "pages" | "texts" | "links";

/** POST /backlinks/import answers this. */
export interface LinksImportAnswer {
  ok: true;
  kind: GscLinksKind;
  rows: number;
  /** "Read as Search Console's Top linking sites: 14 sites." */
  line: string;
}

/** What one reading of a page found. POST /backlinks/check answers `{ ok, line, check }`. */
export interface LinkCheck {
  /** The address as asked, tidied; and where it landed after redirects. */
  url: string;
  final: string;
  host: string;
  status: number;
  checkedAt: string;
  /** True when this is the reading kept from earlier today, not a new request. */
  cached: boolean;
  /** links: the page links to the website. mentions: it names the studio without a link. nothing: neither. unreadable: the page could not be read (and `why` says so). */
  verdict: "links" | "mentions" | "nothing" | "unreadable";
  why: string | null;
  /** Every link on the page that points to the website. */
  links: { href: string; path: string; anchor: string; rel: string[]; follow: boolean; times: number }[];
  /** How often the page names the studio outside those links. */
  mentions: number;
  /** The page tells search engines to follow none of its links (a robots meta tag or header). */
  pageNofollow: boolean;
  /** The page's own title. */
  title: string | null;
  /** The desk's row for this page, when it keeps one. */
  linkId: number | null;
  tracked: boolean;
}

export interface LinkCheckAnswer {
  ok: true;
  line: string;
  check: LinkCheck;
}

/** What the changes on this page answer: a sentence, shown beside the button. */
export interface BacklinksAnswer {
  ok: true;
  line: string;
}

/* ---------- profiles and the one true name, address and phone ------------------------------------ */

/** A field as one profile states it, with the variant it belongs to ("A", "B": same letter, same value). */
export interface NapCell {
  value: string;
  variant: string;
  /** True when the weekly check read it from the profile itself; false when a person saw it there (the audit, or somebody on the desk). */
  read: boolean;
  day: string;
  /** Who saw it, when it was not read: "audit", or a person's name. */
  by: string | null;
  /** Against the agreed value: the same, different, or null when none is agreed for this field. */
  match: boolean | null;
}

/** A registry row as the page draws it: each field as stated, with its variant, and the owner step that creates or fixes it. */
export interface ProfileLine extends ProfileRow {
  shown: { name: NapCell | null; address: NapCell | null; phone: NapCell | null };
  task: { id: string; title: string; done: boolean } | null;
}

/** NapMatrix with each field's distinct values grouped, and the decision that settles them. */
export interface NapView extends NapMatrix {
  groups: { field: NapField; variants: { variant: string; value: string; sources: string[]; match: boolean | null }[] }[];
  /** The owner task that decides the one true name, address and phone, when there is one. */
  decision: { id: string; title: string; done: boolean } | null;
  /** The agreed name, address and phone, as the owner recorded them; null until he has. A field he left open is null. */
  truth: NapTruth | null;
  /** Profiles that state something else than the agreed value, in any field. Null while nothing is agreed. */
  differing: number | null;
  /** How two values are compared, in one sentence. */
  rule: string;
}

export type NapField = "name" | "address" | "phone";

export interface NapTruth {
  name: string | null;
  address: string | null;
  phone: string | null;
  by: string;
  at: string;
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
  /** The status the address last answered with; null when it was not asked or did not answer. */
  http?: number | null;
  /**
   * Name, address and phone the check could read from the profile itself;
   * null when nothing was ever readable. `day` is the day they were read: a
   * later check that could not read the page keeps them, with that day.
   */
  nap: { name: string | null; address: string | null; phone: string | null; day?: string } | null;
  /** What a person saw on the profile on a day (the audit, or somebody on the desk: `by`), kept apart from what the check reads. */
  napSeen: { name: string | null; address: string | null; phone: string | null; day: string; by?: string | null } | null;
  /** The owner task that creates or fixes it, when there is one. */
  ownerTaskId: string | null;
  /** Where the row comes from: "audit", or "person" when somebody added it on the desk. */
  source?: string;
  /** An address the weekly check found for a row that has none, for a person to confirm: never used until somebody says it is the studio's. */
  found?: { url: string; what: string; day: string } | null;
}

export interface NapMatrix {
  /** One row per field, one cell per source that states it. `distinct` is how many different values are in use, by the one rule (presence.ts, sameKey). */
  fields: { field: NapField; values: { source: string; value: string; day: string }[]; consistent: boolean; distinct?: number }[];
  /** True only when every source that states a field states the same value. */
  consistent: boolean;
}
