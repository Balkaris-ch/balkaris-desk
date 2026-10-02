import { pathOf, siteHost } from "./http.ts";
import type { PageFacts } from "./parse.ts";

/**
 * What the desk holds against a page, and how much.
 *
 * Pure: facts go in, issues and scores come out. No fetch, no database. The
 * crawl gathers the facts and stores what this file concludes; the check
 * script feeds it small invented pages to prove each rule.
 *
 * EVERY ISSUE SAYS WHAT WAS MEASURED AND WHAT THE LIMIT IS. "Title is 71
 * characters; over 60 is cut in results." A finding without its two numbers
 * is an opinion, and a person cannot act on an opinion.
 *
 * THE LIMITS ARE THE DESK'S YARDSTICKS, not Google's law. Google publishes
 * no maximum title length (it cuts by pixel width, at roughly 60 characters),
 * no minimum word count and no SEO score. The numbers below are the common
 * working values, written once, here, so anyone can see and change them.
 */

export type Severity = "critical" | "warning" | "opportunity";

/**
 * The kinds of page, as the Pages screen filters them.
 *
 * HOW A PAGE GETS ITS KIND, in this order, first match wins. Each line is
 * the website's own structure, not a list kept here:
 *
 *   home      the address "/".
 *   insights  "/insights" and "/insights/topic/…": the journal's front page
 *             and its shelves (content/index.ts `topicHref`).
 *   article   any other "/insights/…": one article (`postHref`).
 *   case      "/case-study-…": content/index.ts gives every case study that
 *             prefix (`WORK_PREFIX`) because they share the flat namespace
 *             with the services.
 *   segment   an address the marketing roster (content/marketing.ts) marks
 *             `of: "segment"`: a page for a kind of business ("Law Firms").
 *             Also "/board-preview/…", a segment's second board held in
 *             reserve. The Pages board calls these "Industries".
 *   landing   an address the roster marks `of: "service"`: a page that
 *             argues one offer to one reader ("AI Commercial").
 *             When the repository cannot be read there is no roster; the
 *             sitemap still gives every roster page the priority 0.85 and
 *             nothing else that value, so such a page is called "landing"
 *             and the segment/landing split is lost until the next fetch.
 *   legal     sitemap priority 0.2: app/sitemap.ts gives that value to the
 *             five legal documents and to nothing else.
 *   service   the page's own structured data holds a Service node. Only the
 *             three pillar pages (/digital-services, /growth-marketing,
 *             /creative-studio) and the services under them emit one
 *             (lib/schema.ts `disciplineSchema`, `capabilitySchema`).
 *   standard  everything else: /about, /team, /work, /contact, /book,
 *             /careers, /partnerships.
 *
 * A page that could not be read this time keeps the kind it had before
 * (`before`): a timeout must not turn a service into "standard".
 */
export type PageKind = "home" | "service" | "segment" | "article" | "insights" | "landing" | "case" | "legal" | "standard";

export const KIND_LABEL: Record<PageKind, string> = {
  home: "Home",
  service: "Service",
  segment: "Industry",
  article: "Insight",
  insights: "Insights index",
  landing: "Landing page",
  case: "Case study",
  legal: "Legal",
  standard: "Standard",
};

export function kindOf(
  path: string,
  hint: { roster?: ReadonlyMap<string, "service" | "segment">; priority?: number | null; schemaTypes?: readonly string[]; before?: PageKind | null } = {},
): PageKind {
  if (path === "/") return "home";
  if (path === "/insights" || path.startsWith("/insights/topic/")) return "insights";
  if (path.startsWith("/insights/")) return "article";
  if (path.startsWith("/case-study-")) return "case";
  const of = hint.roster?.get(path);
  if (of === "segment" || path.startsWith("/board-preview/")) return "segment";
  if (of === "service") return "landing";
  if (!hint.roster?.size && hint.priority === 0.85) return "landing";
  if (hint.priority === 0.2) return "legal";
  if (hint.schemaTypes?.includes("Service")) return "service";
  if (!hint.schemaTypes && hint.before) return hint.before;
  return "standard";
}

/* ---------- the rules, their severity and their weight --------------------- */

/** Where the numbers in the sentences come from. Change one here and every sentence and score follows. */
export const LIMITS = {
  /** Characters of <title> before a search result cuts it. Google cuts by width; 60 is the usual working figure. */
  title: 60,
  /** Characters of the description a result shows before cutting. */
  description: 160,
  /** Words of own content under which a page is called thin. The desk's own yardstick: Google names no number. */
  thinWords: 250,
  /** Hops a redirect may take. One is a redirect; two is a chain. */
  redirectHops: 1,
} as const;

interface Rule {
  severity: Severity;
  /**
   * Points taken from 100. For a page rule: from that page's score, once per
   * page however many times the rule fires there. For a site rule: from the
   * site score, once.
   */
  cost: number;
  /** "page": about one address. "site": about the sitemap, robots.txt or a redirect rule. */
  scope: "page" | "site";
  /** The line the SEO screen's checklist files it under. */
  area: "status" | "indexing" | "canonical" | "title" | "description" | "headings" | "share" | "schema" | "content" | "links" | "images" | "sitemap" | "robots" | "redirects";
  /** What the rule is called in a list. */
  title: string;
}

/**
 * THE ONE TABLE. Why a page scored 79: start at 100, find its issues in
 * `issues({ path })`, subtract each rule's `cost` once. Nothing else moves a
 * score.
 *
 *   page score  = 100 − Σ cost of the page rules that fired on it (floor 0).
 *                 Only pages in the sitemap are scored: a page kept out of
 *                 search on purpose has no SEO score, and says so (null).
 *                 Nor has a page that answered 200 and could not be read
 *                 (too large for the parser, not HTML): the desk did not see
 *                 it, so it gives it no number (null) and files the critical
 *                 finding `page.unreadable`, which says why.
 *   site score  = the mean of the scored pages, rounded, − Σ cost of the site
 *                 rules that fired (floor 0).
 *
 * The weights are judgement, stated: a page that does not answer loses
 * everything; a page search engines are told to ignore, or that points its
 * canonical elsewhere, loses most; a missing title or description costs a
 * tenth to a quarter; a polish item costs a few points.
 */
export const RULES = {
  "page.status": { severity: "critical", cost: 100, scope: "page", area: "status", title: "Page does not answer" },
  /* Costs nothing because the page gets no score at all (null): see above. */
  "page.unreadable": { severity: "critical", cost: 0, scope: "page", area: "status", title: "Page answered but could not be read" },
  "page.redirects": { severity: "critical", cost: 30, scope: "page", area: "status", title: "Sitemap address redirects" },
  "page.noindex-in-sitemap": { severity: "critical", cost: 40, scope: "page", area: "indexing", title: "In the sitemap but says noindex" },
  "page.missing-from-sitemap": { severity: "warning", cost: 0, scope: "page", area: "indexing", title: "Indexable but not in the sitemap" },
  "canonical.missing": { severity: "warning", cost: 10, scope: "page", area: "canonical", title: "No canonical" },
  "canonical.mismatch": { severity: "critical", cost: 25, scope: "page", area: "canonical", title: "Canonical points elsewhere" },
  "title.missing": { severity: "critical", cost: 25, scope: "page", area: "title", title: "No title" },
  "title.long": { severity: "warning", cost: 5, scope: "page", area: "title", title: "Title is cut in results" },
  "title.duplicate": { severity: "warning", cost: 10, scope: "page", area: "title", title: "Title shared with another page" },
  "description.missing": { severity: "warning", cost: 10, scope: "page", area: "description", title: "No description" },
  "description.long": { severity: "opportunity", cost: 3, scope: "page", area: "description", title: "Description is cut in results" },
  "description.duplicate": { severity: "warning", cost: 5, scope: "page", area: "description", title: "Description shared with another page" },
  "h1.missing": { severity: "warning", cost: 10, scope: "page", area: "headings", title: "No main heading" },
  "h1.multiple": { severity: "opportunity", cost: 3, scope: "page", area: "headings", title: "More than one main heading" },
  "lang.missing": { severity: "warning", cost: 5, scope: "page", area: "content", title: "No language declared" },
  "share.missing": { severity: "warning", cost: 5, scope: "page", area: "share", title: "No share title or picture" },
  "share.default-picture": { severity: "opportunity", cost: 3, scope: "page", area: "share", title: "On the default share picture" },
  "share.no-card": { severity: "opportunity", cost: 2, scope: "page", area: "share", title: "No Twitter card" },
  "schema.none": { severity: "warning", cost: 8, scope: "page", area: "schema", title: "No structured data" },
  "schema.site-only": { severity: "opportunity", cost: 3, scope: "page", area: "schema", title: "No structured data of its own" },
  "schema.unreadable": { severity: "critical", cost: 15, scope: "page", area: "schema", title: "Structured data is not valid JSON" },
  "schema.incomplete": { severity: "warning", cost: 8, scope: "page", area: "schema", title: "Structured data misses a required field" },
  "content.thin": { severity: "opportunity", cost: 5, scope: "page", area: "content", title: "Thin page" },
  "links.broken": { severity: "critical", cost: 15, scope: "page", area: "links", title: "Links to a page that does not answer" },
  "links.redirected": { severity: "opportunity", cost: 2, scope: "page", area: "links", title: "Links through a redirect" },
  "links.orphan": { severity: "warning", cost: 10, scope: "page", area: "links", title: "Orphan: no page links here" },
  "links.external-broken": { severity: "warning", cost: 3, scope: "page", area: "links", title: "Links to an outside page that fails" },
  "images.alt-absent": { severity: "warning", cost: 5, scope: "page", area: "images", title: "Picture with no alt attribute" },
  "images.unnamed-link": { severity: "warning", cost: 3, scope: "page", area: "images", title: "Linked picture with no name" },

  "sitemap.unreachable": { severity: "critical", cost: 30, scope: "site", area: "sitemap", title: "Sitemap does not answer" },
  "sitemap.malformed": { severity: "critical", cost: 30, scope: "site", area: "sitemap", title: "Sitemap is not well-formed" },
  "sitemap.off-host": { severity: "critical", cost: 10, scope: "site", area: "sitemap", title: "Sitemap address on another host" },
  "sitemap.duplicate": { severity: "opportunity", cost: 1, scope: "site", area: "sitemap", title: "Address listed twice" },
  "sitemap.blocked": { severity: "critical", cost: 10, scope: "site", area: "robots", title: "robots.txt blocks a sitemap address" },
  "robots.unreachable": { severity: "warning", cost: 5, scope: "site", area: "robots", title: "robots.txt does not answer" },
  "robots.no-sitemap": { severity: "warning", cost: 3, scope: "site", area: "robots", title: "robots.txt does not name the sitemap" },
  "redirect.broken": { severity: "critical", cost: 5, scope: "site", area: "redirects", title: "A promised redirect does not work" },
  "redirect.chain": { severity: "opportunity", cost: 1, scope: "site", area: "redirects", title: "A redirect takes more than one hop" },
} as const satisfies Record<string, Rule>;

export type RuleId = keyof typeof RULES;

export interface Issue {
  /** Stable across crawls: the rule and what it is about. */
  id: string;
  rule: RuleId;
  severity: Severity;
  /** The page it is about, or null when it is about the site as a whole. */
  path: string | null;
  /** One sentence carrying the measured value and the limit. */
  text: string;
  /** The value that was measured: a count, a length, a status, a URL. */
  measured: number | string | null;
  /** What it was held against. */
  limit: number | string | null;
  /** The other things involved: the pages sharing a title, the targets that fail. */
  related?: string[];
}

/** Make an issue. `about` distinguishes two findings of one rule on one page (two redirect rules, say). */
export function issue(rule: RuleId, path: string | null, text: string, measured: Issue["measured"] = null, limit: Issue["limit"] = null, related?: string[], about = ""): Issue {
  return {
    id: `${rule}|${path ?? "site"}${about ? `|${about}` : ""}`,
    rule,
    severity: RULES[rule].severity,
    path,
    text,
    measured,
    limit,
    ...(related?.length ? { related: related.slice(0, 50) } : {}),
  };
}

/* ---------- judging --------------------------------------------------------- */

/** Everything the rules need to know about one address. The crawl fills it. */
export interface PageView {
  path: string;
  /** What the address itself answered: 200, 308, 404…; 0 when nothing answered. */
  status: number;
  /** Where it redirected to, when it did. */
  redirectTo?: string | null;
  inSitemap: boolean;
  kind: PageKind;
  /** The X-Robots-Tag response header, when sent. */
  robotsHeader: string | null;
  /** Null when the page was not read: it did not answer 200, or it did and could not be read (`unread` says why). */
  facts: PageFacts | null;
  /** Why a page that answered 200 was not read ("not HTML: image/png", "too large to parse…"). Absent or null otherwise. */
  unread?: string | null;
  /** How many OTHER pages link here, counting every link anywhere on them. */
  inlinks: number;
  /** Addresses on the site this page links to that do not answer 200 or redirect. */
  broken: { target: string; status: number }[];
  /** Addresses on the site this page links to that answer with a redirect. */
  redirected: { target: string; to: string | null }[];
  /** Links to other sites that were checked and failed. "Could not check" is not in here. */
  externalBroken: { target: string; status: number }[];
}

const chars = (s: string): number => [...s].length;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** True when the page tells search engines to stay away, by tag or by header. */
export function saysNoindex(facts: Pick<PageFacts, "robots"> | null, robotsHeader: string | null): boolean {
  return /\bnoindex\b/i.test(facts?.robots ?? "") || /\bnoindex\b/i.test(robotsHeader ?? "");
}

/** Node types every page carries because the layout prints them: they describe the company, not the page. */
const SITE_WIDE = new Set(["Organization", "ProfessionalService", "LocalBusiness", "WebSite", "BreadcrumbList"]);

/**
 * The issues of one page, taken alone (duplicates across pages are added by
 * `judge`). `defaultShare` is the site's fallback share picture,
 * site-relative, or null when it is not known.
 */
export function judgePage(p: PageView, defaultShare: string | null): Issue[] {
  const out: Issue[] = [];
  const f = p.facts;

  if (p.status !== 200) {
    if (p.status >= 300 && p.status < 400) {
      if (p.inSitemap) out.push(issue("page.redirects", p.path, `Listed in the sitemap but answers ${p.status} and sends readers to ${p.redirectTo ?? "another address"}; a sitemap should list the final address.`, p.status, 200));
    } else {
      out.push(issue("page.status", p.path, p.status === 0 ? "Did not answer at all (no connection or no reply in time); it should answer 200." : `Answers ${p.status}; it should answer 200.`, p.status, 200));
    }
    return out;
  }
  const orphan = (): Issue => issue("links.orphan", p.path, "In the sitemap, but no other page links to it: 0 links in; a page needs at least 1 to be found by following the site.", 0, 1);
  if (!f) {
    /* Answered 200 and was not read. That is a finding of its own, and what
       is known without the HTML still is: the response header, and the
       links other pages make to it. Nothing else is held for or against it. */
    out.push(issue("page.unreadable", p.path, `Answered 200 but could not be read: ${p.unread || "no reason was recorded"}. None of its tags were checked, and it has no score until it can be read.`, p.unread || "unread", "a page the desk can read"));
    if (p.inSitemap && saysNoindex(null, p.robotsHeader)) {
      out.push(issue("page.noindex-in-sitemap", p.path, `Listed in the sitemap but its X-Robots-Tag header says "${p.robotsHeader}"; a page is either offered to search engines or kept from them, not both.`, "noindex", "index"));
    }
    if (p.inSitemap && p.path !== "/" && p.inlinks === 0) out.push(orphan());
    return out;
  }

  const noindex = saysNoindex(f, p.robotsHeader);
  if (p.inSitemap && noindex) {
    out.push(issue("page.noindex-in-sitemap", p.path, `Listed in the sitemap but says "${/\bnoindex\b/i.test(f.robots ?? "") ? f.robots : p.robotsHeader}"; a page is either offered to search engines or kept from them, not both.`, "noindex", "index"));
  }
  if (!p.inSitemap) {
    /* A page kept out of the sitemap is judged on one thing only: that it
       really is kept out. Its title length is nobody's problem. */
    if (!noindex) out.push(issue("page.missing-from-sitemap", p.path, "Answers 200 and does not say noindex, but the sitemap does not list it; either list it or mark it noindex.", "indexable", "listed or noindex"));
    return out;
  }

  /* canonical */
  if (!f.canonical) {
    out.push(issue("canonical.missing", p.path, "Has no canonical link; without one a copy of the page under another address can be indexed instead.", 0, 1));
  } else {
    const target = pathOf(f.canonical);
    let host = "";
    try {
      host = new URL(f.canonical).host;
    } catch {
      /* a relative canonical: pathOf resolved it against the site, and the host is then the site's own */
      host = siteHost();
    }
    if (target === null) {
      out.push(issue("canonical.mismatch", p.path, `Canonical is ${f.canonical}, which is not on this site.`, f.canonical, p.path));
    } else if (host !== siteHost()) {
      out.push(issue("canonical.mismatch", p.path, `Canonical names the host ${host}; the site's canonical host is ${siteHost()}.`, f.canonical, siteHost()));
    } else if (target !== p.path) {
      /* `pathOf` has already dropped a trailing slash from both sides, so the
         home page ("https://www.balkaris.ch" against "/") never lands here. */
      out.push(issue("canonical.mismatch", p.path, `Canonical points to ${target}, not to this page.`, target, p.path));
    }
  }

  /* title and description */
  if (!f.title) {
    out.push(issue("title.missing", p.path, "Has no <title>; a search result would be headed by whatever Google picks.", 0, 1));
  } else if (chars(f.title) > LIMITS.title) {
    out.push(issue("title.long", p.path, `Title is ${chars(f.title)} characters; over ${LIMITS.title} is cut in results.`, chars(f.title), LIMITS.title));
  }
  if (!f.description) {
    out.push(issue("description.missing", p.path, "Has no meta description; a search result would show a fragment Google picks.", 0, 1));
  } else if (chars(f.description) > LIMITS.description) {
    out.push(issue("description.long", p.path, `Description is ${chars(f.description)} characters; over ${LIMITS.description} is cut in results.`, chars(f.description), LIMITS.description));
  }

  /* headings, language */
  if (f.h1.length === 0) out.push(issue("h1.missing", p.path, "Has no <h1>; the page does not say what it is about in its own heading.", 0, 1));
  else if (f.h1.length > 1) out.push(issue("h1.multiple", p.path, `Has ${f.h1.length} <h1> headings; one says what the page is about, more blur it.`, f.h1.length, 1));
  if (!f.lang) out.push(issue("lang.missing", p.path, "The <html> element declares no language.", 0, 1));

  /* sharing */
  if (!f.og.title || !f.og.image) {
    const lacking = [!f.og.title ? "og:title" : "", !f.og.image ? "og:image" : ""].filter(Boolean).join(" and ");
    out.push(issue("share.missing", p.path, `Has no ${lacking}; a shared link would unfurl bare.`, lacking, "og:title and og:image"));
  } else if (defaultShare && pathOf(f.og.image) === defaultShare) {
    out.push(issue("share.default-picture", p.path, `Shares with the site's default picture (${defaultShare}); it has none of its own.`, defaultShare, "a picture of its own"));
  }
  if (!f.twitter.card) out.push(issue("share.no-card", p.path, "Has no twitter:card; X and several chat apps show a smaller preview without one.", 0, 1));

  /* structured data */
  const nodes = f.schema.flatMap((b) => b.nodes);
  const unreadable = f.schema.filter((b) => !b.parses);
  if (unreadable.length) {
    out.push(issue("schema.unreadable", p.path, `${plural(unreadable.length, "structured-data block")} is not valid JSON (${unreadable[0]?.error ?? "parse error"}); search engines discard it whole.`, unreadable.length, 0));
  }
  const incomplete = nodes.filter((n) => n.missing.length);
  if (incomplete.length) {
    const said = incomplete.map((n) => `${n.type}: ${n.missing.slice(0, 3).join(", ")}${n.missing.length > 3 ? "…" : ""}`);
    out.push(issue("schema.incomplete", p.path, `Structured data misses required fields (${said.slice(0, 3).join("; ")}).`, incomplete.length, 0, said));
  }
  if (f.schema.length === 0) {
    out.push(issue("schema.none", p.path, "Carries no structured data at all.", 0, 1));
  } else if (p.kind !== "home" && !unreadable.length && !nodes.some((n) => n.type.split("+").some((t) => !SITE_WIDE.has(t)))) {
    out.push(issue("schema.site-only", p.path, "Its structured data describes the company and the breadcrumb, but nothing describes this page itself.", 0, 1));
  }

  /* content */
  if (!noindex && f.words < LIMITS.thinWords) {
    out.push(issue("content.thin", p.path, `Own content is ${plural(f.words, "word")}; under ${LIMITS.thinWords} is thin by the desk's yardstick (Google names no number).`, f.words, LIMITS.thinWords));
  }

  /* links */
  if (p.broken.length) {
    const said = p.broken.map((b) => `${b.target} (${b.status || "no answer"})`);
    out.push(issue("links.broken", p.path, `Links to ${plural(p.broken.length, "address", "addresses")} on the site that ${p.broken.length === 1 ? "does" : "do"} not answer: ${said.slice(0, 3).join(", ")}${said.length > 3 ? "…" : ""}.`, p.broken.length, 0, said));
  }
  if (p.redirected.length) {
    const said = p.redirected.map((r) => `${r.target} → ${r.to ?? "?"}`);
    out.push(issue("links.redirected", p.path, `Links to ${plural(p.redirected.length, "address", "addresses")} that redirect (${said.slice(0, 2).join(", ")}${said.length > 2 ? "…" : ""}); link the final address and save the reader a hop.`, p.redirected.length, 0, said));
  }
  if (p.path !== "/" && p.inlinks === 0) out.push(orphan());
  if (p.externalBroken.length) {
    const said = p.externalBroken.map((b) => `${b.target} (${b.status || "no answer"})`);
    out.push(issue("links.external-broken", p.path, `Links to ${plural(p.externalBroken.length, "outside page")} that ${p.externalBroken.length === 1 ? "fails" : "fail"}: ${said.slice(0, 2).join(", ")}${said.length > 2 ? "…" : ""}.`, p.externalBroken.length, 0, said));
  }

  /* pictures: alt="" is a statement ("decoration") and is correct; only a
     MISSING attribute is a fault, because then the file name is read out. */
  const absent = f.images.filter((i) => i.alt === "absent" && !i.hidden);
  if (absent.length) {
    const files = [...new Set(absent.map((i) => i.file ?? i.remote ?? "?"))];
    out.push(issue("images.alt-absent", p.path, `${plural(absent.length, "picture")} ${absent.length === 1 ? "has" : "have"} no alt attribute at all (alt="" would say "decoration"; none says nothing): ${files.slice(0, 3).join(", ")}${files.length > 3 ? "…" : ""}.`, absent.length, 0, files));
  }
  const unnamed = f.images.filter((i) => i.unnamedLink);
  if (unnamed.length) {
    out.push(issue("images.unnamed-link", p.path, `${plural(unnamed.length, "link")} ${unnamed.length === 1 ? "holds" : "hold"} only a picture with no alt text, so the link has no name for a screen reader or a crawler.`, unnamed.length, 0, [...new Set(unnamed.map((i) => i.file ?? i.remote ?? "?"))]));
  }

  return out;
}

export interface Verdict {
  issues: Issue[];
  /** Page score by address. Null for a page that is not scored (kept out of the sitemap on purpose, or answered 200 and could not be read). */
  scores: Map<string, number | null>;
  /** Null when no page could be scored. */
  siteScore: number | null;
}

/**
 * Judge the whole site: every page alone, then the things only visible
 * across pages (two pages with one title), then the site's own issues
 * (`siteIssues`: sitemap, robots, redirects, made by their own modules).
 */
export function judge(pages: PageView[], siteIssues: Issue[], defaultShare: string | null): Verdict {
  const issues: Issue[] = [];
  for (const p of pages) issues.push(...judgePage(p, defaultShare));

  /* Duplicates, among the pages offered to search engines only. */
  const offered = pages.filter((p) => p.inSitemap && p.status === 200 && p.facts && !saysNoindex(p.facts, p.robotsHeader));
  const dupes = (field: "title" | "description", rule: "title.duplicate" | "description.duplicate") => {
    const by = new Map<string, string[]>();
    for (const p of offered) {
      const v = p.facts?.[field]?.trim().toLowerCase();
      if (v) by.set(v, [...(by.get(v) ?? []), p.path]);
    }
    for (const group of by.values()) {
      if (group.length < 2) continue;
      for (const path of group) {
        const others = group.filter((g) => g !== path);
        issues.push(issue(rule, path, `Has the same ${field} as ${others.slice(0, 2).join(" and ")}${others.length > 2 ? ` and ${others.length - 2} more` : ""}; search engines show one of them and the pages compete.`, group.length, 1, others));
      }
    }
  };
  dupes("title", "title.duplicate");
  dupes("description", "description.duplicate");

  issues.push(...siteIssues);

  /* Scores: the one table, applied. */
  const scores = new Map<string, number | null>();
  const fired = new Map<string, Set<RuleId>>();
  for (const i of issues) {
    if (i.path === null || RULES[i.rule].scope !== "page") continue;
    fired.set(i.path, (fired.get(i.path) ?? new Set()).add(i.rule));
  }
  for (const p of pages) {
    /* Not scored: kept out of the sitemap on purpose, or answered and not
       read. A number for a page the desk did not see would be invented. */
    if (!p.inSitemap || (p.status === 200 && !p.facts)) {
      scores.set(p.path, null);
      continue;
    }
    let s = 100;
    for (const r of fired.get(p.path) ?? []) s -= RULES[r].cost;
    scores.set(p.path, Math.max(0, s));
  }
  const scored = [...scores.values()].filter((s): s is number => s !== null);
  let siteScore: number | null = null;
  if (scored.length) {
    const siteRules = new Set(issues.filter((i) => RULES[i.rule].scope === "site").map((i) => i.rule));
    let s = Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
    for (const r of siteRules) s -= RULES[r].cost;
    siteScore = Math.max(0, s);
  }
  return { issues, scores, siteScore };
}
