import type { ActionKind, OpportunityState, OpportunityType, Priority } from "../../../web/src/contract/seo/common.ts";

/**
 * THE OPPORTUNITY RULES, STATED IN ONE PLACE.
 *
 * What each type of opportunity is, what makes one, and how its priority is
 * set. engine.ts applies them; every row carries the sentence of the rule that
 * placed it (`priorityWhy`), so a person can check any row against this file.
 * The floors and windows are ours, and say so.
 */

export const TYPE_LABEL: Record<OpportunityType, string> = {
  "not-indexed": "Not indexed",
  "near-page-one": "Near page one",
  "low-ctr": "Low CTR",
  "ranking-drop": "Ranking drop",
  "keyword-gap": "Keyword gap",
  "german-missing": "German page missing",
  "thin-content": "Thin content",
  "missing-answer": "AI readiness",
  technical: "Technical",
  "internal-links": "Internal links",
  entity: "Off-site presence",
};

export const ACTION_LABEL: Record<ActionKind, string> = {
  proposal: "Proposal for approval",
  brief: "Operator brief",
  owner: "Owner task",
  chrome: "By hand in the owner's browser",
  code: "Website code",
};

export const STATES: OpportunityState[] = ["open", "queued", "in-progress", "done", "dismissed"];

/** The window search figures are read over: the last 28 days the desk's history holds. */
export const WINDOW_DAYS = 28;
/** Ranking drops compare two windows of this many days. */
export const DROP_DAYS = 14;

/**
 * Floors. A query shown to a handful of people moves for no reason; the
 * standard floors keep noise out. While Search Console's figures are early
 * (src/cc/search/gsc.ts, EARLY), "near page one" lists from one impression up
 * and marks every row under its floor `early`, so a young site sees its first
 * signals; comparisons (drops) and the CTR rule never do.
 */
export const FLOOR = {
  /** Impressions over the window for "near page one". */
  nearPageOne: 30,
  /** Impressions in both windows for a ranking drop. */
  drop: 30,
  /** Positions lost for a ranking drop. */
  dropBy: 3,
  /** Clicks our curve expects before a CTR shortfall means anything. */
  ctrExpected: 3,
} as const;

/** The kinds of page that carry the studio's offer. */
export const MONEY = new Set(["home", "service", "segment", "landing"]);

/** Every rule, in one sentence, as the screens print it beside the list. */
export const RULES: Record<OpportunityType, string> = {
  "not-indexed":
    "A sitemap address Google's URL Inspection reports as not indexed. High when the page carries the offer (home, service, industry or landing page) or Google last saw a noindex the live page no longer says; medium for an article, case study or other page; low for a legal or listing page.",
  "near-page-one": `A query at Google average position 4 to 20 over the last ${WINDOW_DAYS} days, shown at least ${FLOOR.nearPageOne} times (early signals: from one impression, marked). High when the phrase is judged relevant and its cluster's intent is commercial, transactional or local; medium when relevant; low when not yet judged; a phrase judged irrelevant is left out. An early row is at most medium. Its action proposes a new title only for a page that carries the offer (not the home page) whose title lacks the phrase; otherwise it asks for a brief.`,
  "low-ctr": `A page at average position 20 or better whose clicks over the last ${WINDOW_DAYS} days are under half of what our CTR curve expects at its position, where the curve expects at least ${FLOOR.ctrExpected}. High for a page that carries the offer, medium otherwise.`,
  "ranking-drop": `A query or page whose average position fell by ${FLOOR.dropBy} or more between the last ${DROP_DAYS} days and the ${DROP_DAYS} before, shown at least ${FLOOR.drop} times in both. High for a relevant commercial phrase or a page that carries the offer, medium otherwise.`,
  "keyword-gap":
    "An English cluster of searches, with at least one phrase judged relevant, that no page of the site answers (no page in the cluster's language carries its words). It takes the cluster's priority: the audit's judgement of whether a young site can win it.",
  "german-missing": "A German cluster with at least one phrase judged relevant: the site has no German page, so every such cluster is a gap. It takes the cluster's priority, as above.",
  "thin-content": "A page in the sitemap under the crawl's word yardstick (src/cc/site/rules.ts, thinWords). Medium for a page that carries the offer, low otherwise.",
  "missing-answer":
    "A service, industry or landing page whose AI-readiness check fails the direct answer under the heading or the questions on the page (src/cc/seo/readiness.ts). Medium; high when Google already shows the page.",
  technical:
    "A critical or warning finding of the crawl's rules on a page or the site, or a failed site-wide check (sitemap lastmod, robots.txt, llms.txt), or a website change the audit named. Critical is high, warning is medium; a site-wide check or an audit change takes its stated weight.",
  "internal-links": "A page that carries the offer which no other page links to from its own content (menus and footers do not count). High when nothing links to it at all, medium otherwise.",
  entity: "Something only the owner can do off the site (a profile, a listing, reviews, a decision), from the audit's owner tasks. It takes the audit's impact judgement.",
};

export const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** At most `cap`: an early row never outranks it. */
export const capAt = (p: Priority, cap: Priority): Priority => (PRIORITY_RANK[p] < PRIORITY_RANK[cap] ? cap : p);
