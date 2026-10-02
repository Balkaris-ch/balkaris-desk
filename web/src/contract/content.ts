/**
 * The Content screen: the quality and the coverage of what is written on
 * balkaris.ch. Pages is the inventory, SEO is how search sees it; this is the
 * writing itself: how much there is, where it is thin, which titles and
 * descriptions need work, what is old, what nobody reads.
 *
 * One payload for the whole screen (GET /api/v1/content?range=30d). Every
 * panel is its own `Reading`, so one source that fails costs one panel.
 *
 * Sources: the desk's crawl of the served pages, the website's repository
 * (article dates, page files), the desk's own drafts, GA4 (consenting visitors
 * only), and Search Console and Bing once they are connected.
 *
 * Types only. The server imports this file with `import type`.
 */
import type { Range, Reading, Stat } from "./common";

/** A page's kind, as the crawl decides it (src/cc/site/rules.ts `kindOf`). */
export type ContentKind = "home" | "service" | "segment" | "article" | "insights" | "landing" | "case" | "legal" | "standard";

/** The yardsticks behind the screen's rules, printed beside the figures they decide. */
export interface ContentLimits {
  /** Characters of a title before a result cuts it (the crawl's own limit). */
  title: number;
  /** Characters under which a title says too little (this screen's yardstick). */
  titleShort: number;
  /** Characters of a description before a result cuts it (the crawl's own limit). */
  description: number;
  /** Characters under which a description says too little (this screen's yardstick). */
  descriptionShort: number;
  /** Words of own content under which a page is called thin (the crawl's own limit). */
  thinWords: number;
  /** Words a minute, for "reading time" in Engagement. */
  readingWpm: number;
}

/** One kind of page in Coverage by section. */
export interface CoverageRow {
  kind: ContentKind;
  /** "Service", "Industry", "Insight"… */
  label: string;
  /** Pages of this kind in the sitemap that answered and were read. */
  pages: number;
  /** Median words of own content, over the pages the crawl could read; null when it read none of them. */
  medianWords: number | null;
  /** Pages with a title, a description, a share picture and structured data: present, not judged for quality. */
  complete: number;
  /**
   * Pages whose structured data describes the page itself, not only the
   * company. On the home page the company's own types are its own (the
   * crawl's rule), so they count there; the same rule as `SchemaCoverage`.
   */
  ownSchema: number;
}

export type MetaField = "title" | "description";
export type MetaProblem = "missing" | "long" | "short" | "duplicate";

/** One title or description that needs work. A page can have two rows. */
export interface MetaRow {
  path: string;
  kind: ContentKind;
  kindLabel: string;
  field: MetaField;
  /** Every problem it has, worst first: a long title can also be shared. */
  problems: MetaProblem[];
  /** The text as served, or null when there is none. */
  text: string | null;
  /** Characters, counted as a reader sees them. */
  length: number;
  /** The pages that carry the same text, for a duplicate. */
  sharedWith: string[];
}

/** One page under the thin-page yardstick. */
export interface ThinRow {
  path: string;
  title: string | null;
  kind: ContentKind;
  kindLabel: string;
  words: number;
  /** GA4 visitors in the range; null when GA4 did not answer (see `visits`). */
  visitors: number | null;
}

/** What GA4's per-page read covered. Shared by Thin pages and Engagement. */
export interface VisitSpan {
  /** YYYY-MM-DD, both ends included: the days actually measured. */
  start: string;
  end: string;
  /** The range starts before GA4's measurement began (about 21 September 2026). */
  partial: boolean;
  /** The first day GA4 measured the website. */
  since: string;
}

/** One article on the site, by its publish date. */
export interface ArticleRow {
  path: string;
  title: string;
  /** YYYY-MM-DD as the article's own file states it, or the sitemap's date when the file could not be read. Null when neither says. */
  date: string | null;
  /** Where `date` came from: the article's file in the repository, or the sitemap (which gives the update date when there is one). */
  dateFrom: "repo" | "sitemap" | null;
  /** The file's own "updated" date, when it has one. */
  updated: string | null;
  /** Whole days since `date`, in Zurich. */
  ageDays: number | null;
  /** In the menus, the sitemap and search; false for an article live at its address but not listed yet. */
  listed: boolean;
  /** Written at the desk (content/posts) rather than by hand (content/journal.ts). */
  byDesk: boolean;
}

/** One page by when it last changed. */
export interface ChangeRow {
  path: string;
  title: string | null;
  kind: ContentKind;
  kindLabel: string;
  /**
   * ISO. From the website's git history when the page has a file of its own
   * ("repo"); otherwise when the desk's crawl last saw its words or status
   * change ("crawl"), or null when the crawl has never seen it change.
   */
  changed: string | null;
  changedFrom: "repo" | "crawl" | null;
  /** The commit's subject and author, when `changedFrom` is "repo". */
  subject?: string;
  author?: string;
  /** Since when the crawl has been reading the page, for "unchanged since". */
  firstSeen: string;
  ageDays: number | null;
}

/** Structured data by kind of page. */
export interface SchemaCoverage {
  /**
   * The types the site's layout prints on its pages, which describe the
   * company and the breadcrumb rather than the page (the crawl's own list,
   * src/cc/site/rules.ts SITE_WIDE), with how many pages carry each.
   */
  layout: { type: string; pages: number }[];
  /** Pages in the sitemap that answered: what the counts are out of. */
  pages: number;
  /**
   * Per kind: the types that describe the page itself, with how many pages
   * carry each. `companyIsOwn` is true for the home page, where the company's
   * types (Organization, WebSite…) describe the page itself and so are listed
   * as its own, as the crawl's rule has it; the breadcrumb never is.
   */
  kinds: { kind: ContentKind; label: string; pages: number; types: { type: string; pages: number }[]; none: number; siteOnly: number; companyIsOwn: boolean }[];
  /** Pages with no structured data at all. */
  none: string[];
  /** Blocks that do not parse, or nodes missing a required field, with the reason. */
  invalid: { path: string; problem: "unreadable" | "incomplete"; reason: string }[];
}

/** Pictures and their alt text, by page, by the asset collector's rule. */
export interface ImageCoverage {
  /** Over every <img> use of a file in public/ on every crawled page. */
  totals: { uses: number; written: number; empty: number; absent: number };
  /** Pages with pictures, the ones missing an alt attribute first. */
  rows: { path: string; uses: number; written: number; empty: number; absent: number }[];
}

/** A page with too few links in, or none out. */
export interface LinkingRow {
  path: string;
  title: string | null;
  kind: ContentKind;
  kindLabel: string;
  /** Other pages linking here, from anywhere on them (menus included). */
  inlinks: number;
  /** Of those, from their own content. */
  inlinksFromContent: number;
  /** Distinct addresses on the site this page links to; null when the crawl could not read the page. */
  outlinks: number | null;
  /** Why it is listed, worst first. Empty for a row of `fewest` that breaks no rule. */
  reasons: ("no-inlinks" | "one-inlink" | "no-outlinks")[];
}

/** Internal linking: the rule's rows, and the pages other pages' content links to least. */
export interface Linking {
  /** Pages in the sitemap that answered: what the rule looked at. */
  pages: number;
  /** Pages with no link in, one link in, or no link out. */
  flagged: LinkingRow[];
  /**
   * Every page, the home page aside, that no other page's own content links
   * to (menus and footer left out): reached only through the menu. When there
   * is none, the eight with the fewest such links.
   */
  fewest: LinkingRow[];
}

/** Time spent on a page against how long it is. */
export interface EngagementRow {
  path: string;
  title: string | null;
  kindLabel: string;
  words: number;
  /** Seconds to read the words at `limits.readingWpm`. */
  readingSeconds: number;
  /** GA4 visitors in the range. */
  visitors: number;
  /** GA4 engagement time in the range, all visitors together, in seconds. */
  engagementSeconds: number;
}

/** A query people saw the site for that no page is about (Search Console). */
export interface GapRow {
  query: string;
  impressions: number;
  clicks: number;
  /** Google's average position, not a tracked rank. */
  position: number;
  /** The page Google showed for it, when known: the nearest thing the site has. */
  path: string | null;
}

/** One query from Bing's search statistics. */
export interface BingKeywordRow {
  query: string;
  clicks: number;
  impressions: number;
  /** Bing's average position when shown. */
  position: number | null;
}

/** Everything the Content screen draws. */
export interface ContentPayload {
  range: Range;
  /** True when the route answered `?specimen=1` with artificial rows (development only). */
  specimen: boolean;
  limits: ContentLimits;
  tiles: {
    /** Words of own content on the pages in the sitemap; `sub` carries the median. */
    words: Reading<Stat>;
    thin: Reading<Stat>;
    titles: Reading<Stat>;
    descriptions: Reading<Stat>;
    /** Pages carrying FAQ structured data, of the pages in the sitemap. */
    questions: Reading<Stat>;
    /** Articles dated this month; `series` is the last six months, oldest first. */
    articles: Reading<Stat>;
  };
  coverage: Reading<CoverageRow[]>;
  metadata: Reading<MetaRow[]>;
  thin: Reading<ThinRow[]>;
  visits: Reading<VisitSpan>;
  articles: Reading<ArticleRow[]>;
  changes: Reading<ChangeRow[]>;
  schema: Reading<SchemaCoverage>;
  images: Reading<ImageCoverage>;
  linking: Reading<Linking>;
  engagement: Reading<EngagementRow[]>;
  gaps: Reading<GapRow[]>;
  bing: Reading<BingKeywordRow[]>;
  /** The crawl job, for "Run the crawl now". */
  crawl: { finished: string | null; running: boolean };
  /**
   * Whether this person may start an insight (may publish and is not
   * revoked): the Insights screen opens its create dialog only for them, so
   * "Create new insight" is offered only to them.
   */
  canCreate: boolean;
}
