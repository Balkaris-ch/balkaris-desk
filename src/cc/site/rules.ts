import { normalPath, pathOf, siteHost } from "./http.ts";
import { normaliseText, type ContentPrint, type PageFacts } from "./parse.ts";

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
  /**
   * Similarity of two pages' own text at and above which they are called
   * near duplicates: the share of their distinct five-word runs (template
   * left out, see `templatePages`) that the two have in common (Jaccard).
   * 0.75: three runs in four the same. Measured on the site on 2 October
   * 2026, the most alike pair offered to search engines (/book and
   * /contact) shares 0.44, the next 0.32, and the three noindex placeholder
   * pages, which are one text with the nouns swapped, share 0.78 to 0.80
   * with each other: the line sits between what the site writes on purpose
   * and what is a copy. Google publishes no figure.
   */
  nearDuplicate: 0.75,
  /** Words of own text, template left out, under which a page is not compared for duplicates at all: too little text to call two pages copies (it is thin, which content.thin says). */
  duplicateMinWords: 50,
  /**
   * A block of text found on at least this share of the pages read, beyond
   * the pages being compared, is template (the box beside every article, the
   * list of capabilities under every service) and is left out of the
   * comparison, unless the pages it stands on are a family of near copies
   * (see `sameText`). 5 %: 6 of the site's 103 addresses. At least
   * `templateFloor` pages.
   */
  templateShare: 0.05,
  templateFloor: 3,
  /** Distinct subheadings, template ones left out, two pages must share exactly to be called the same set. Fewer is a format, not a copy. */
  h2SetMin: 3,
} as const;

/**
 * How many OTHER pages a block of text must stand on to be template, when
 * `read` pages were read: 5 % of them, at least 3. For the site's 103: 6.
 */
export const templatePages = (read: number): number => Math.max(LIMITS.templateFloor, Math.ceil(read * LIMITS.templateShare));

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
  "content.duplicate": { severity: "warning", cost: 15, scope: "page", area: "content", title: "Same text as another page" },
  "content.near-duplicate": { severity: "warning", cost: 8, scope: "page", area: "content", title: "Nearly the same text as another page" },
  "h1.duplicate": { severity: "opportunity", cost: 3, scope: "page", area: "headings", title: "Main heading shared with another page" },
  "h2.duplicate": { severity: "opportunity", cost: 2, scope: "page", area: "headings", title: "Same subheadings as another page" },
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
  /* An address that redirects back to where it has been: no browser ever
     lands. Distinct from a chain (which lands, late) and from a broken
     redirect (which lands on the wrong thing). */
  "redirect.loop": { severity: "critical", cost: 10, scope: "site", area: "redirects", title: "A redirect loops and never lands" },
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
 *
 * `o` is for one page of ANOTHER site, audited on its own (audit.ts):
 * `host` is that page's host and `url` its address, so its canonical is
 * held against its own host instead of the website's; `alone` leaves out
 * what only a whole crawl can know (whether it is in a sitemap, whether
 * another page links to it). Give such a page `inSitemap: true` so every
 * other rule applies.
 */
export function judgePage(p: PageView, defaultShare: string | null, o: { host?: string; url?: string; alone?: boolean } = {}): Issue[] {
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
    if (p.inSitemap && !o.alone && saysNoindex(null, p.robotsHeader)) {
      out.push(issue("page.noindex-in-sitemap", p.path, `Listed in the sitemap but its X-Robots-Tag header says "${p.robotsHeader}"; a page is either offered to search engines or kept from them, not both.`, "noindex", "index"));
    }
    if (p.inSitemap && !o.alone && p.path !== "/" && p.inlinks === 0) out.push(orphan());
    return out;
  }

  const noindex = saysNoindex(f, p.robotsHeader);
  if (p.inSitemap && !o.alone && noindex) {
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
  } else if (o.host) {
    /* A page of another site: its canonical is held against its own host and address. */
    let to: URL | null = null;
    try {
      to = new URL(f.canonical, o.url ?? `https://${o.host}/`);
    } catch {
      to = null;
    }
    if (!to || (to.protocol !== "http:" && to.protocol !== "https:")) {
      out.push(issue("canonical.mismatch", p.path, `Canonical is ${f.canonical}, which is not a web address.`, f.canonical, p.path));
    } else if (to.host !== o.host) {
      out.push(issue("canonical.mismatch", p.path, `Canonical names the host ${to.host}; this page is on ${o.host}.`, f.canonical, o.host));
    } else if (normalPath(to.pathname) !== p.path) {
      out.push(issue("canonical.mismatch", p.path, `Canonical points to ${normalPath(to.pathname)}, not to this page.`, normalPath(to.pathname), p.path));
    }
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
  if (!o.alone && p.path !== "/" && p.inlinks === 0) out.push(orphan());
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
 * across pages (two pages with one title, one description, one text, one
 * main heading or one set of subheadings), then the site's own issues
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
  issues.push(...sameText(pages, offered), ...sameHeadings(pages, offered));

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

/* ---------- the same text, the same headings, on two pages ------------------- */

/**
 * DUPLICATE CONTENT, compared among the pages offered to search engines (in
 * the sitemap, answering 200, read, not noindex: the same pages the title
 * and description duplicates are held among), on each page's own text as
 * parse.ts fingerprints it (ContentPrint), with template left out:
 *
 *   template   a block of text that stands on at least `templatePages(n)`
 *              pages read in this crawl besides the ones being compared
 *              (n: every page read, noindex or not: the templates are the
 *              site's). On the site: the capabilities listed under every
 *              service, the "Work with us" box beside every article, the
 *              proof cards. Leaving it out is what keeps every page of one
 *              template from reading as a copy of every other.
 *   family     ...UNLESS the pages the block stands on are themselves near
 *              copies of each other. Frequency alone cannot tell the two
 *              apart: a set of location or landing pages made from one set
 *              of paragraphs repeats those paragraphs on as many pages as a
 *              template does, and leaving them out would compare such pages
 *              on their few own words and miss exactly the copies this rule
 *              is for. So the blocks are grouped by the set of pages they
 *              stand on, and for each set up to `FAMILY_PAIRS` pairs of its
 *              pages are compared, with only the WIDER template left out
 *              (blocks that also stand on pages outside the set). When more
 *              than half of those pairs reach `LIMITS.nearDuplicate`, the
 *              set is a family and its blocks are the pages' own text. The
 *              site's real template stands on pages that are otherwise
 *              unalike, so it stays template.
 *   exact      pages whose own text has one md5 (`content.duplicate`),
 *              when what they share is not only template and comes to at
 *              least `LIMITS.duplicateMinWords` words.
 *   near       two pages whose own text, template left out, shares at least
 *              `LIMITS.nearDuplicate` of its distinct five-word runs, as the
 *              bottom-k MinHash sketches estimate it (`content.near-duplicate`,
 *              one finding on each page per pair, with the similarity). Each
 *              page needs `duplicateMinWords` own words to be compared. At
 *              most `NEAR_PER_PAGE` pairs per page, the closest first.
 *
 * NEVER A PAGE AGAINST ITSELF, nor against a twin that names it as its
 * canonical: a copy that says "the original is over there" is how a copy is
 * meant to be kept (and a noindex twin is not among the offered pages at all).
 *
 * EVERY PAIR IS COMPARED, so the cost grows with the square of the pages.
 * Each page is therefore prepared once (`prepare`: which of its blocks and
 * sketch entries are template whatever the other page, which only when the
 * other page lacks the block too) and a pair is then one merge of two
 * sorted lists of at most 128 numbers, with no allocation: about a second
 * for a thousand pages on the desk's thread.
 */
const NEAR_PER_PAGE = 20;
/** Pairs of a block's pages compared to decide whether those pages are a family. */
const FAMILY_PAIRS = 24;

interface Entry {
  /** The shingle's 32-bit hash. */
  h: number;
  /** The block it was first found in; 0xffff when past the kept list. */
  b: number;
}

interface Unpacked {
  entries: Entry[];
  /** The largest hash the sketch is complete up to; Infinity when it holds every shingle of the page. */
  tau: number;
}

function unpack(c: ContentPrint): Unpacked {
  const buf = Buffer.from(c.sketch, "base64");
  const entries: Entry[] = [];
  for (let i = 0; i + 6 <= buf.length; i += 6) entries.push({ h: buf.readUInt32LE(i), b: buf.readUInt16LE(i + 4) });
  const complete = c.shingles <= entries.length;
  return { entries, tau: complete ? Infinity : (entries[entries.length - 1]?.h ?? Infinity) };
}

/**
 * How alike two pages' own texts are: the share of their distinct shingles
 * they have in common (Jaccard), estimated from the two bottom-k sketches.
 *
 * Both sketches hold every hash of their page up to their own k-th
 * smallest; below the lower of the two they are both complete, so the hashes
 * there are a fair random sample of the two sets, and the share they have in
 * common estimates the share the whole sets have. Shingles from template
 * blocks (`template` says which, by block fingerprint) are left out of both
 * sides first. Two pages short enough to be kept whole are compared exactly.
 * `sample` is how many distinct hashes the estimate rests on.
 */
export function similarity(a: ContentPrint, b: ContentPrint, template: (block: string) => boolean = () => false): { value: number; sample: number } {
  return compareSketches(a, unpack(a), b, unpack(b), template);
}

function compareSketches(a: ContentPrint, ua: Unpacked, b: ContentPrint, ub: Unpacked, template: (block: string) => boolean): { value: number; sample: number } {
  const tau = Math.min(ua.tau, ub.tau);
  const own = (c: ContentPrint, e: Entry): boolean => {
    const block = c.blocks[e.b];
    return !block || !template(block[0]);
  };
  const sa = new Set(ua.entries.filter((e) => e.h <= tau && own(a, e)).map((e) => e.h));
  let both = 0;
  let onlyB = 0;
  for (const e of ub.entries) {
    if (e.h > tau || !own(b, e)) continue;
    if (sa.has(e.h)) both++;
    else onlyB++;
  }
  const union = sa.size + onlyB;
  return { value: union ? both / union : 0, sample: union };
}

/** Words of a page's own text that are not template. Blocks past the kept list count as its own. */
const ownWords = (c: ContentPrint, template: (block: string) => boolean): number => c.words - c.blocks.reduce((s, [h, w]) => s + (template(h) ? w : 0), 0);

/** The page a page names as its canonical, as a stored address: a pair where one names the other is a twin, not a copy. Worked out once per page (it parses a URL, and every pair asks). */
const canonicals = new WeakMap<PageView, string | null>();
const canonicalOf = (p: PageView): string | null => {
  let c = canonicals.get(p);
  if (c === undefined) {
    c = p.facts?.canonical ? pathOf(p.facts.canonical) : null;
    canonicals.set(p, c);
  }
  return c;
};
const twins = (a: PageView, b: PageView): boolean => canonicalOf(a) === b.path || canonicalOf(b) === a.path;

const printOf = (p: PageView): ContentPrint | null => p.facts?.content ?? null;
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const names = (others: string[]): string => `${others.slice(0, 2).join(" and ")}${others.length > 2 ? ` and ${others.length - 2} more` : ""}`;

/** Up to `most` distinct pairs of `pages`: every pair when there are no more, otherwise a fixed spread (the same pages always give the same pairs). */
function pairsOf(pages: readonly string[], most: number): [string, string][] {
  const m = pages.length;
  const out: [string, string][] = [];
  if ((m * (m - 1)) / 2 <= most) {
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) out.push([pages[i] as string, pages[j] as string]);
    return out;
  }
  const seen = new Set<number>();
  let s = Math.imul(m, 2654435761) >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) % m;
  };
  while (out.length < most) {
    const i = next();
    const j = next();
    const key = Math.min(i, j) * m + Math.max(i, j);
    if (i === j || seen.has(key)) continue;
    seen.add(key);
    out.push([pages[i] as string, pages[j] as string]);
  }
  return out;
}

/**
 * The blocks that are NOT template although they stand on enough pages to
 * be, because those pages are a family of near copies (see `sameText`).
 * Blocks are grouped by the set of pages they stand on; each set is judged
 * once, on at most FAMILY_PAIRS of its pairs.
 */
function familyBlocks(on: ReadonlyMap<string, ReadonlySet<string>>, need: number, prints: ReadonlyMap<string, ContentPrint>, unpacked: ReadonlyMap<string, Unpacked>): Set<string> {
  const bySet = new Map<string, { pages: string[]; blocks: string[] }>();
  for (const [h, s] of on) {
    /* On fewer pages than that a block is never template: nothing to decide. */
    if (s.size < need) continue;
    const pages = [...s].sort();
    const key = pages.join("\n");
    const had = bySet.get(key);
    if (had) had.blocks.push(h);
    else bySet.set(key, { pages, blocks: [h] });
  }
  const out = new Set<string>();
  for (const { pages, blocks } of bySet.values()) {
    const members = new Set(pages);
    const memo = new Map<string, boolean>();
    /* While this set is judged, template is what would be template and also stands on a page outside the set. */
    const wider = (h: string): boolean => {
      let w = memo.get(h);
      if (w === undefined) {
        w = false;
        const s = on.get(h);
        if (s && s.size >= need) {
          for (const x of s) {
            if (!members.has(x)) {
              w = true;
              break;
            }
          }
        }
        memo.set(h, w);
      }
      return w;
    };
    const tried = pairsOf(pages, FAMILY_PAIRS);
    let alike = 0;
    for (const [x, y] of tried) {
      const px = prints.get(x) as ContentPrint;
      const py = prints.get(y) as ContentPrint;
      if (ownWords(px, wider) < LIMITS.duplicateMinWords || ownWords(py, wider) < LIMITS.duplicateMinWords) continue;
      if (px.md5 === py.md5 || compareSketches(px, unpacked.get(x) as Unpacked, py, unpacked.get(y) as Unpacked, wider).value >= LIMITS.nearDuplicate) alike++;
    }
    if (alike * 2 > tried.length) for (const h of blocks) out.add(h);
  }
  return out;
}

/** One page made ready to be compared with every other at the cost of a merge (see sameText). */
interface Prepared {
  /** The sketch's hashes, ascending. */
  hashes: number[];
  /** For each hash: 0 own text; 1 template whatever the other page; 2 template unless the other page carries its block too. */
  status: Uint8Array;
  /** For each hash of status 2: its block. */
  border: (string | undefined)[];
  tau: number;
  /** Every block the page lists. */
  blocks: Set<string>;
  /** Its words less those of the blocks that are template whatever the other page. */
  sureOwn: number;
  /** Its blocks of status 2, with their words, once per time they stand on the page. */
  borderWords: [string, number][];
}

/**
 * How one page's block stands, for every pair it is in: on `c` pages read,
 * this one among them, a block is template for a pair when the pages
 * besides the two number `need` or more (and it is not a family's). So:
 * with `need` + 2 or more pages, always; with `need` + 1, unless the other
 * page carries it too; with fewer, never.
 */
function standingOf(h: string, on: ReadonlyMap<string, ReadonlySet<string>>, need: number, family: ReadonlySet<string>): 0 | 1 | 2 {
  if (family.has(h)) return 0;
  const besides = (on.get(h)?.size ?? 1) - 1;
  return besides >= need + 1 ? 1 : besides === need ? 2 : 0;
}

function prepare(c: ContentPrint, u: Unpacked, standing: (h: string) => 0 | 1 | 2): Prepared {
  let sureOwn = c.words;
  const borderWords: [string, number][] = [];
  for (const [h, w] of c.blocks) {
    const st = standing(h);
    if (st === 1) sureOwn -= w;
    else if (st === 2) borderWords.push([h, w]);
  }
  const status = new Uint8Array(u.entries.length);
  const border: (string | undefined)[] = new Array(u.entries.length);
  u.entries.forEach((e, i) => {
    const block = c.blocks[e.b];
    /* A hash from past the kept list of blocks is the page's own. */
    if (!block) return;
    const st = standing(block[0]);
    status[i] = st;
    if (st === 2) border[i] = block[0];
  });
  return { hashes: u.entries.map((e) => e.h), status, border, tau: u.tau, blocks: new Set(c.blocks.map(([h]) => h)), sureOwn, borderWords };
}

/** `ownWords` for page A in the pair (A, B), from what `prepare` worked out. */
function ownIn(a: Prepared, b: Prepared): number {
  let n = a.sureOwn;
  for (const [h, w] of a.borderWords) if (!b.blocks.has(h)) n -= w;
  return n;
}

/**
 * `compareSketches` for a pair of prepared pages, as one merge of their two
 * ascending hash lists: the same shared and distinct counts below the lower
 * of the two sketches' limits, own hashes only.
 */
function shareOf(a: Prepared, b: Prepared): number {
  const tau = Math.min(a.tau, b.tau);
  const ownA = (i: number): boolean => a.status[i] === 0 || (a.status[i] === 2 && b.blocks.has(a.border[i] as string));
  const ownB = (j: number): boolean => b.status[j] === 0 || (b.status[j] === 2 && a.blocks.has(b.border[j] as string));
  const na = a.hashes.length;
  const nb = b.hashes.length;
  let i = 0;
  let j = 0;
  let both = 0;
  let union = 0;
  for (;;) {
    while (i < na && (a.hashes[i] as number) <= tau && !ownA(i)) i++;
    while (j < nb && (b.hashes[j] as number) <= tau && !ownB(j)) j++;
    const ha = i < na && (a.hashes[i] as number) <= tau ? (a.hashes[i] as number) : -1;
    const hb = j < nb && (b.hashes[j] as number) <= tau ? (b.hashes[j] as number) : -1;
    if (ha < 0 && hb < 0) break;
    union++;
    if (hb < 0 || (ha >= 0 && ha < hb)) i++;
    else if (ha < 0 || hb < ha) j++;
    else {
      both++;
      i++;
      j++;
    }
  }
  return union ? both / union : 0;
}

function sameText(pages: PageView[], offered: PageView[]): Issue[] {
  const out: Issue[] = [];
  const read = pages.filter((p) => p.status === 200 && printOf(p));
  const need = templatePages(read.length);
  /* Which pages each block of text stands on. */
  const on = new Map<string, Set<string>>();
  for (const p of read) {
    for (const [h] of (printOf(p) as ContentPrint).blocks) {
      const s = on.get(h) ?? new Set<string>();
      s.add(p.path);
      on.set(h, s);
    }
  }
  const prints = new Map(read.map((p) => [p.path, printOf(p) as ContentPrint] as const));
  const unpacked = new Map(read.map((p) => [p.path, unpack(printOf(p) as ContentPrint)] as const));
  /* Blocks that stand on many pages because those pages are near copies: not template. */
  const family = familyBlocks(on, need, prints, unpacked);
  /** Template, when the pages in `besides` are left out of the count. */
  const templateBesides =
    (besides: readonly string[]) =>
    (h: string): boolean => {
      const s = on.get(h);
      if (!s || family.has(h)) return false;
      let n = s.size;
      for (const x of besides) if (s.has(x)) n--;
      return n >= need;
    };

  const cands = offered.filter((p) => printOf(p));

  /* Exact: one md5. */
  const byMd5 = new Map<string, PageView[]>();
  for (const p of cands) {
    const key = (printOf(p) as ContentPrint).md5;
    byMd5.set(key, [...(byMd5.get(key) ?? []), p]);
  }
  for (const group of byMd5.values()) {
    if (group.length < 2) continue;
    const own = ownWords(printOf(group[0] as PageView) as ContentPrint, templateBesides(group.map((g) => g.path)));
    if (own < LIMITS.duplicateMinWords) continue;
    for (const p of group) {
      const others = group.filter((g) => g !== p && !twins(p, g)).map((g) => g.path);
      if (!others.length) continue;
      out.push(issue("content.duplicate", p.path, `Has the same own text as ${names(others)}, word for word (${plural(own, "word")}, the site's template left out); search engines index one of them and the others compete with it.`, group.length, 1, others));
    }
  }

  /* Near: every other pair, by their sketches, each page prepared once. */
  const standings = new Map<string, 0 | 1 | 2>();
  const standing = (h: string): 0 | 1 | 2 => {
    let s = standings.get(h);
    if (s === undefined) {
      s = standingOf(h, on, need, family);
      standings.set(h, s);
    }
    return s;
  };
  const ready = cands.map((p) => prepare(printOf(p) as ContentPrint, unpacked.get(p.path) as Unpacked, standing));
  const near = new Map<string, { other: string; value: number }[]>();
  const pair = (path: string, other: string, value: number): void => {
    const list = near.get(path);
    if (list) list.push({ other, value });
    else near.set(path, [{ other, value }]);
  };
  for (let i = 0; i < cands.length; i++) {
    const a = cands[i] as PageView;
    const pa = printOf(a) as ContentPrint;
    const ra = ready[i] as Prepared;
    for (let j = i + 1; j < cands.length; j++) {
      const b = cands[j] as PageView;
      const pb = printOf(b) as ContentPrint;
      const rb = ready[j] as Prepared;
      if (pa.md5 === pb.md5 || twins(a, b)) continue;
      if (ownIn(ra, rb) < LIMITS.duplicateMinWords || ownIn(rb, ra) < LIMITS.duplicateMinWords) continue;
      const value = shareOf(ra, rb);
      if (value < LIMITS.nearDuplicate) continue;
      pair(a.path, b.path, value);
      pair(b.path, a.path, value);
    }
  }
  for (const [path, list] of near) {
    for (const n of list.sort((x, y) => y.value - x.value).slice(0, NEAR_PER_PAGE)) {
      out.push(
        issue(
          "content.near-duplicate",
          path,
          `Shares ${pct(n.value)} of its own text with ${n.other} (distinct five-word runs, the site's template left out); from ${pct(LIMITS.nearDuplicate)} two pages read as one and compete for the same searches.`,
          Math.round(n.value * 100) / 100,
          LIMITS.nearDuplicate,
          [n.other],
          n.other,
        ),
      );
    }
  }
  return out;
}

/**
 * THE SAME HEADINGS, among the same offered pages.
 *
 *   h1.duplicate   pages whose first <h1> reads the same once case,
 *                  punctuation and spacing are set aside.
 *   h2.duplicate   pages with the same SET of subheadings, once template
 *                  subheadings are left out (one that stands on at least
 *                  `templatePages(n)` other pages read: "Asked before
 *                  deciding.", "Key takeaways"), and only when at least
 *                  `LIMITS.h2SetMin` remain. Fewer than that, or a set many
 *                  pages share, is a format (the desk's article formats give
 *                  every article of a kind the same subheadings), not a copy.
 */
function sameHeadings(pages: PageView[], offered: PageView[]): Issue[] {
  const out: Issue[] = [];
  const flag = (rule: "h1.duplicate" | "h2.duplicate", groups: Iterable<PageView[]>, say: (p: PageView, others: string[]) => string) => {
    for (const group of groups) {
      if (group.length < 2) continue;
      for (const p of group) {
        const others = group.filter((g) => g !== p && !twins(p, g)).map((g) => g.path);
        if (others.length) out.push(issue(rule, p.path, say(p, others), group.length, 1, others));
      }
    }
  };

  const byH1 = new Map<string, PageView[]>();
  for (const p of offered) {
    const h = normaliseText(p.facts?.h1[0] ?? "");
    if (h) byH1.set(h, [...(byH1.get(h) ?? []), p]);
  }
  flag("h1.duplicate", byH1.values(), (p, others) => `Has the same main heading (“${p.facts?.h1[0] ?? ""}”) as ${names(others)}; each page's <h1> should say what that page alone is about.`);

  const read = pages.filter((p) => p.status === 200 && p.facts?.h2s);
  const need = templatePages(read.length);
  const on = new Map<string, number>();
  for (const p of read) {
    for (const h of new Set((p.facts?.h2s ?? []).map(normaliseText))) if (h) on.set(h, (on.get(h) ?? 0) + 1);
  }
  const bySet = new Map<string, PageView[]>();
  for (const p of offered) {
    if (!p.facts?.h2s) continue;
    /* Its own subheadings: on fewer than `need` pages besides this one. */
    const own = [...new Set(p.facts.h2s.map(normaliseText))].filter((h) => h && (on.get(h) ?? 1) - 1 < need).sort();
    if (own.length < LIMITS.h2SetMin) continue;
    const key = own.join("\n");
    bySet.set(key, [...(bySet.get(key) ?? []), p]);
  }
  flag("h2.duplicate", bySet.values(), (_p, others) => `Has the same subheadings as ${names(others)}, the site's template ones left out; two pages built on one outline usually say one thing twice.`);
  return out;
}

/* ---------- redirect loops ------------------------------------------------------ */

/**
 * The loop in a chain of redirects, or null.
 *
 * `hops` as http.ts's `get` records them (each address that answered with a
 * redirect), `final` the address it stopped at and `status` what that
 * answered. A chain that comes back to an address it has already passed
 * through, and is still being redirected there, never lands: that is a loop.
 * `get` stops after five hops, so a loop shows as a repeated address within
 * them. Returns the addresses from the first visit of the repeated one to
 * its return: ["…/a", "…/b", "…/a"].
 */
export function redirectLoop(hops: readonly { url: string }[], final: string, status: number): string[] | null {
  if (!hops.length) return null;
  const all = [...hops.map((h) => h.url), final];
  for (let i = 1; i < all.length; i++) {
    const first = all.indexOf(all[i] as string);
    if (first === i) continue;
    /* The chain ended at an address it had passed, and that address now answered something else: it landed. */
    if (i === all.length - 1 && !(status >= 300 && status < 400)) continue;
    return all.slice(first, i + 1);
  }
  return null;
}
