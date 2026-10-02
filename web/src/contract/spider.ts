/**
 * /api/v1/spider — what the desk's crawler does beyond its daily read:
 * custom extraction rules, the duplicate-content findings of the last crawl,
 * and an on-demand audit of one page of any public website. Types only.
 *
 *   GET    /extract                 owner   the rules                          ExtractRule[]
 *   POST   /extract                 owner   add one: ExtractRuleInput          ExtractRule (201) | ApiError (400, why it was refused:
 *                                                                              its form, or its time on the desk's test page)
 *   POST   /extract/:id/toggle      owner   { enabled?: boolean } (no body: flip)  ExtractRule
 *   DELETE /extract/:id             owner   remove it and what it found        { ok: true }
 *   GET    /extract/:id/results     owner   what it found, page by page        ExtractResults
 *   GET    /duplicates              anyone signed in                           Reading<SpiderDuplicates>
 *   POST   /audit                   anyone signed in   { url }                 SpiderAudit | ApiError (400 refused, 429 too many
 *                                                                              this hour: 30 for the desk, 10 a person; 504 given up after 90 s)
 *
 * The server's implementation is src/cc/routes/spider.ts, src/cc/site/extract.ts
 * (rules), src/cc/site/rules.ts (duplicates) and src/cc/site/audit.ts (audit).
 */

/* ---------- custom extraction ------------------------------------------------ */

export type ExtractKind = "css" | "regex" | "xpath";

/** A rule as a person sends it. */
export interface ExtractRuleInput {
  /** What it pulls out, in words: "Price", "Nofollow links". 1 to 80 characters. */
  name: string;
  kind: ExtractKind;
  /**
   * css: a selector. regex: a pattern, bare or as /pattern/flags (flags i, m,
   * s, u). xpath: the small subset the desk reads (absolute paths, name or *
   * steps, simple predicates, a last step of @attribute or text()).
   * At most 300 characters.
   */
  expression: string;
  /** css and xpath: the attribute to read instead of the text. regex: the capture group to keep ("1" or a name). Absent or null: the text, or the whole match. */
  attribute?: string | null;
  /** The beginning of the addresses it runs on ("/insights/"); absent or null: every page. */
  scope?: string | null;
}

export interface ExtractRule {
  id: number;
  name: string;
  kind: ExtractKind;
  /** As it runs (an XPath is kept in the tidied form it is evaluated in). */
  expression: string;
  attribute: string | null;
  /** Null: every page. */
  scope: string | null;
  enabled: boolean;
  /** The person who added it. */
  addedBy: string;
  /** ISO. */
  addedAt: string;
  /** Pages it was run on at the last crawl it was on for. */
  pagesRun: number;
  /** Of those, the pages where it found something. */
  pagesMatched: number;
  /** When it last ran (ISO), or null before the first crawl since it was added. */
  lastRun: string | null;
  /** Milliseconds it took on its slowest page among those kept, or null before it ran. A rule that runs past a page's deadline (10 s) is stopped there, and switched off when that happens in two crawls running. */
  slowestMs: number | null;
}

/** What one rule found on one page at the last crawl. */
export interface ExtractResultRow {
  path: string;
  /** The first 20 values, each cut at 300 characters. */
  matches: string[];
  /** Matches in all (counting stops at 10,000). */
  count: number;
  /** Why it could not run there (a regular expression stopped after 50 ms, a selector stopped at the page's 10-second deadline), or null. */
  error: string | null;
  /** ISO, the crawl that ran it. */
  at: string;
  /** Milliseconds it took on this page; null when it was not run there. */
  ms: number | null;
}

export interface ExtractResults {
  rule: ExtractRule;
  /** Every page in its scope at the last crawl, those with matches first. */
  pages: ExtractResultRow[];
}

/* ---------- duplicates across the site -------------------------------------- */

export interface SpiderDuplicates {
  /** Groups of pages with the same own text, word for word (rule content.duplicate). */
  exact: { pages: string[] }[];
  /** Pairs of pages whose own text is nearly the same, each pair once (rule content.near-duplicate). `similarity` 0 to 1. */
  near: { a: string; b: string; similarity: number }[];
  /** Groups of pages with the same main heading (rule h1.duplicate). */
  h1: { heading: string; pages: string[] }[];
  /** Groups of pages with the same set of subheadings, template ones left out (rule h2.duplicate). */
  h2: { pages: string[] }[];
  /** The near-duplicate threshold the last crawl used (0 to 1). */
  threshold: number;
}

/* ---------- auditing one address --------------------------------------------- */

export type AuditSeverity = "critical" | "warning" | "opportunity";

export interface AuditIssue {
  /** The rule id, as the crawl's (src/cc/site/rules.ts): "title.long", "canonical.mismatch"… */
  rule: string;
  severity: AuditSeverity;
  /** What the rule is called in a list. */
  title: string;
  /** One sentence with what was measured and the limit. */
  text: string;
  measured: number | string | null;
  limit: number | string | null;
}

export interface AuditFacts {
  title: string | null;
  description: string | null;
  canonical: string | null;
  /** The robots meta tag, lower-cased. */
  robots: string | null;
  lang: string | null;
  h1: string[];
  /** The <h2> headings, in order (at most 40). */
  h2: string[];
  /** Words inside <main> (or <body>), as the crawl counts them. */
  words: number;
  schema: {
    /** Every structured-data type on the page, once each. */
    types: string[];
    /** Blocks that are not valid JSON. */
    unreadable: number;
    /** Nodes missing a field the desk requires, with what is missing. */
    incomplete: { type: string; missing: string[] }[];
  };
  og: { title: string | null; description: string | null; image: string | null; type: string | null; url: string | null };
  twitter: { card: string | null; image: string | null };
  images: {
    total: number;
    /** alt with words. */
    altWritten: number;
    /** alt="" (decoration: correct). */
    altEmpty: number;
    /** No alt attribute at all, not hidden from assistive technology. */
    altAbsent: number;
    /** Up to 10 of those without alt, by address. */
    withoutAlt: string[];
  };
  /** Distinct addresses linked: on the page's own host (all, and from its <main>), and elsewhere. */
  links: { internal: number; internalFromContent: number; external: number };
  hreflang: { lang: string; href: string }[];
  /** The own-text fingerprint, to compare with the site's pages: md5 of the normalised text, and its words. */
  content: { md5: string; words: number } | null;
}

export interface SpiderAudit {
  /** The address as asked, tidied (no fragment). */
  url: string;
  /** Where it ended after redirects. */
  finalUrl: string;
  /** ISO, when the page was fetched. */
  at: string;
  /** True when this is the answer kept from an earlier audit of the same address (kept for a day). */
  cached: boolean;
  /** The final answer's status; 0 when nothing answered. */
  status: number;
  /** Every redirect on the way, in order. */
  redirects: { url: string; status: number; location: string | null }[];
  /** The redirects went round in a loop (and `redirects` shows it). */
  loop: boolean;
  timing: { ttfbMs: number; totalMs: number };
  /** Bytes of HTML read, after decompression. */
  bytes: number;
  /** The page was larger than the 2 MB the audit reads; the first 2 MB were read. */
  truncated: boolean;
  /** The response headers that matter for search and speed, lower-case names, those present only. */
  headers: Record<string, string>;
  /** What was read from the HTML; null when there was no HTML to read (see `unread`). */
  facts: AuditFacts | null;
  /** Why the page was not read: not HTML, no answer, too large to parse. */
  unread: string | null;
  /** The crawl's page rules applied to this page alone (no sitemap, no inbound links: those need a whole site). */
  issues: AuditIssue[];
  /** 100 minus each fired rule's cost, as the crawl scores a page; null when the page was not read. */
  score: number | null;
  /** Why nothing could be read at all (DNS, TLS, timeout), when that happened. */
  error: string | null;
}
