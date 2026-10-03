import type { ActivityItem, DayPoint, Range, Reading } from "./common";

/**
 * One article, and one shared link that has none yet: what GET
 * /api/v1/article/:id and GET /api/v1/article/link/:id answer.
 *
 * The port of the old console's draft page and link page (src/console.ts
 * `draftPage`, `linkPage`) into the new frame. Everything here is read from
 * the desk's own database (links, drafts, jobs, events, people), except three
 * panels with an outside source of their own: the readers (GA4), the file on
 * the website's branch (the repository's read copy) and the search listing
 * as the live page states it (the crawl). Each of those is a `Reading`, so one
 * that cannot be read costs that panel and nothing else.
 *
 * The actions are NOT here: they stay the old console's form handlers
 * (src/server.ts, POST /draft/:id/<action> and /link/:id/retry), which keep
 * their own checks. `offers` only says which of them the old page would show.
 *
 * Types only. The server imports this file with `import type`.
 */

/** One block of an article, in the website's own shapes (its content/types.ts `PostBlock`, copied in src/blocks.ts). */
export type ArticleBlock =
  | string
  | { h: string }
  | { list: string[]; ordered?: boolean }
  | { quote: string; who?: string; role?: string }
  | { note: string }
  | { code: string; lang?: string }
  | { steps: { term: string; text: string }[] }
  | { table: { head: string[]; rows: string[][] } };

/**
 * Where the article is on the website.
 *
 *   draft     not on the site at all
 *   unlisted  live at its own address, in no menu, noindex
 *   listed    in the menus, the shelves, the sitemap and search
 *   down      it was live, and was taken off the site: its address 404s
 *
 * The desk's record of what the last successful push did (drafts.state),
 * never a guess: a failed push leaves it where it was. "down" is a draft
 * whose last push for it removed the file.
 */
export type SiteState = "draft" | "unlisted" | "listed" | "down";

/** The words, as the website will set them. */
export interface ArticleText {
  slug: string;
  title: string;
  standfirst: string;
  excerpt: string;
  /** Minutes, as the model estimated them; null when the draft carries none. */
  readingTime: number | null;
  /** The journal's shelves it goes on. */
  topics: { id: string; name: string }[];
  /** The studio's services it is about. */
  services: { slug: string; name: string }[];
  body: ArticleBlock[];
  takeaways: string[];
  /** "Asked before deciding." Empty when the draft has none, which the site's template expects. */
  faq: { q: string; a: string }[];
}

/** The picture the desk drew, served by the desk itself (GET /cover/:slug). */
export interface ArticleCover {
  src: string;
  alt: string;
  caption: string | null;
}

/** A job of the workstation's, for this link. */
export interface ArticleJob {
  id: number;
  /** "ingest", "write", "cover", "clip", "reclose". */
  kind: string;
  /** "queued", "running", "done", "stuck". */
  state: string;
  attempts: number;
  /** The last failure, in the workstation's words, with any key hidden. */
  error: string | null;
  /** ISO times. */
  createdAt: string;
  takenAt: string | null;
  finishedAt: string | null;
  /** A job held back while the bot waits for an answer, until this time (ISO). */
  notBefore: string | null;
}

/** The workstation's queue as it concerns this link. */
export interface ArticleWork {
  jobs: ArticleJob[];
  /** When a workstation last asked for work (ISO), and whether that was within five minutes. */
  workstation: { lastSeen: string | null; awake: boolean };
}

/** The source's own public figures when the desk read it. A null is a figure the platform does not publish, never a zero. */
export interface SourceFigures {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

/** What was shared, by whom, and from where. */
export interface ArticleSource {
  linkId: number;
  /** The address as the desk keeps it: the post's own page once it was read, else what was shared. */
  url: string;
  /** "article", "video", "carousel", or "social" while a social link is not read yet. */
  kind: string;
  platform: string | null;
  /** "nomadatoast on tiktok", or a site's name. */
  site: string | null;
  /** The source's own handle or author. */
  author: string | null;
  title: string | null;
  /** When the source was published, and when the desk read it (ISO). */
  postedAt: string | null;
  capturedAt: string | null;
  /** When it was shared with the desk (ISO). */
  sharedAt: string;
  /** The person who shared it, by the desk's people, or the name the bot was given; null when nobody is recorded. */
  sharedBy: string | null;
  /** What was typed beside the link, if anything. */
  note: string | null;
  words: number | null;
  durationS: number | null;
  slides: number | null;
  topic: { id: string; name: string } | null;
  services: { slug: string; name: string }[];
  /** Null for an article link, which has no such figures; a Reading for a social post. */
  figures: Reading<SourceFigures> | null;
}

/** How it was written. */
export interface ArticleWriting {
  /** The format asked for when it was shared; null when nobody chose, and it was written the standard way. */
  format: { id: string; name: string } | null;
  /** The template id and its name. */
  template: { id: string; name: string | null };
  model: string | null;
  /** How long the writing took, in milliseconds. */
  ms: number | null;
  /** Which of the five ways to end it the last paragraph was given. */
  closing: { id: string; name: string } | null;
  /** "Ends like another article": the echo flag's words, or null. */
  echo: string | null;
  /** When the draft was written (ISO). */
  writtenAt: string;
}

/** The article's file on the website's main branch, read from the desk's read copy of the repository. */
export interface RepoState {
  file: "absent" | "unlisted" | "listed";
  /**
   * The file names a silent clip for its video block (`watch.clip`), which is
   * what makes the live page play one: without it the site's block draws
   * nothing. False when there is no file.
   */
  clip: boolean;
  /** The last commit that touched the file. */
  lastCommit: { sha: string; at: string; author: string; subject: string; url: string | null } | null;
}

/** Where it lives on the site. */
export interface ArticleOnSite {
  state: SiteState;
  /** Its address on balkaris.ch, whether or not it is there now. */
  url: string;
  /** The first time it went live (ISO), from the desk's own log; null when it never did, or the log does not say. */
  liveSince: string | null;
  /** The commit the desk's last successful push made. */
  publishedSha: string | null;
  /** What the website's branch holds, which can differ from the desk's record when somebody edited the site by hand. */
  repo: Reading<RepoState>;
}

/** The article's own readers, from GA4. */
export interface ArticleTraffic {
  /** The days counted, both included (YYYY-MM-DD, the property's time zone). */
  start: string;
  end: string;
  /** True when the count starts the day it went live, later than the range would. */
  fromLive: boolean;
  /**
   * The range's own first day. When `start` is later and `fromLive` is false,
   * the count begins the day GA4 began measuring the website: the days before
   * it were never counted.
   */
  rangeStart: string;
  views: number;
  /** People who viewed it at least once in the period, counted once. */
  people: number;
  /** Engaged seconds over all its views (GA4 userEngagementDuration). */
  engagementSeconds: number;
  /** Views per day, oldest first; a day with no row is a real zero. */
  days: DayPoint[];
  /** From this day on GA4 may still change the figures. */
  provisionalFrom: string;
}

/** One line of the search listing, with its length against the desk's yardstick. */
export interface MetaLine {
  text: string;
  length: number;
  /** The desk's working limit (src/cc/site/rules.ts LIMITS), not Google's law. */
  limit: number;
}

/** The title and description a search result shows. */
export interface ArticleMeta {
  title: MetaLine;
  description: MetaLine;
  /**
   * live      read from the live page by the crawl
   * approved  a title or description approved on the desk replaces the article's own
   * built     worked out the way the website builds it (lib/seo.tsx), for a page that is not live
   */
  from: "live" | "approved" | "built";
}

/**
 * Which of the old console's actions the old page would offer, with its
 * conditions. Every one of them is a change in Insights, which the server's
 * gate takes only from somebody with edit there: an action is offered only
 * when `edit` is true.
 */
export interface ArticleOffers {
  /** The person has edit on Insights. Without it nothing below is offered, and no form of the page is drawn. */
  edit: boolean;
  /** Both conditions hold: edit on Insights, and an email, so a commit under their name is accepted. Without it no site action is offered. */
  canPublish: boolean;
  /**
   * Why not, for the sentence that says so; null when they can publish.
   * "access": Insights is read-only for them, and the owner changes that under
   * Team › Access & Roles (an email would not help). "address": they have
   * edit and no email yet.
   */
  why: "access" | "address" | null;
  /** The site actions, in the order offered: publish (from draft), list (from unlisted), unlist (from listed), takedown. */
  site: ("publish" | "list" | "unlist" | "takedown")[];
  /** Draw another cover: offered once there is one, to somebody with `edit`. */
  redraw: boolean;
  /** A video link: attach the video or just the text, and cut the silent clip again. Its forms are for somebody with `edit`. */
  video: boolean;
  /** Delete the draft: only while it is not on the site, and only with `edit`. */
  remove: boolean;
}

/** GET /api/v1/article/:id */
export interface ArticlePayload {
  draftId: number;
  /** The range the readers panel counts, from ?range=. */
  range: Range;
  article: ArticleText;
  /** Null until a cover is drawn. */
  cover: ArticleCover | null;
  /** The workstation's newest cover job for this draft, when it has not finished. */
  coverJob: { state: string; error: string | null } | null;
  /**
   * For a video link. `attached` is the person's choice (links.attach);
   * `plays` is whether the site will actually show a video, which also needs
   * a platform and an id the publisher recognises (src/watch.ts `watchFrom`).
   * `held` is whether the desk holds the silent excerpt the way the publisher
   * needs it (src/publish.ts ships it only when the loop, the clip and its
   * first frame are all there); `clip` is its length, when the desk recorded
   * that. Whether the LIVE page plays one is on the website's branch
   * (`site.repo`, `clip`), not here.
   */
  video: {
    attached: boolean;
    plays: boolean;
    platform: string | null;
    held: boolean;
    clip: { seconds: number; whole: boolean } | null;
    clipJob: { state: string; error: string | null } | null;
  } | null;
  site: ArticleOnSite;
  source: ArticleSource;
  writing: ArticleWriting;
  /** Off while it has never been on the site. */
  traffic: Reading<ArticleTraffic>;
  meta: Reading<ArticleMeta>;
  work: ArticleWork;
  /** The link's history from the events log, newest first. */
  history: ActivityItem[];
  /** Other drafts written from the same link, newest first. */
  siblings: { id: number; title: string; state: SiteState; writtenAt: string }[];
  offers: ArticleOffers;
}

/** GET /api/v1/article/link/:id */
export interface LinkPayload {
  linkId: number;
  /** "new", "queued", "social", "drafted", "failed", "listed", "unlisted". */
  state: string;
  /** Why it could not be read or written, in the desk's words. */
  error: string | null;
  source: ArticleSource;
  /** The newest draft written from it, when there is one: its page is the article page. */
  draft: { id: number; title: string; state: SiteState } | null;
  work: ArticleWork;
  history: ActivityItem[];
  /** "Try it again": offered while the link has no draft, to somebody with edit on Insights. */
  offers: { retry: boolean };
}
