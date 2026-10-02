/**
 * GET /api/v1/seo/keywords — the keyword table: every phrase the desk knows
 * (from Search Console, Google Autocomplete research, the audit and people),
 * with its cluster, intent, the page it maps to and what Google shows.
 *
 *   ?range=30d
 *   ?lang=de             de | en | all
 *   ?cluster=<key>       one cluster, or "none"
 *   ?intent=commercial   commercial | transactional | informational | local | navigational | all
 *   ?source=gsc          gsc | autocomplete | audit | manual | all
 *   ?status=relevant     relevant | weak | irrelevant | unjudged | all (default: relevant, weak, unjudged)
 *   ?shown=1             1: only phrases Google showed the site for in the window
 *   ?page=/seo           mapped to this page, or "none" for unmapped
 *   ?q=kosten            words in the phrase
 *   ?sort=impressions    impressions (default) | position | clicks | phrase | first-seen | cluster
 *   ?dir=desc
 *   ?offset=0&limit=50   at most 500
 *
 * Changes (a signed-in person):
 *   POST /api/v1/seo/keywords                  { phrase, lang?, cluster? }    → { ok, keyword }   source "manual"
 *   POST /api/v1/seo/keywords/:id/status       { status }                     → { ok, keyword }
 *
 * NO SEARCH VOLUME. No free source gives it (Google Ads Keyword Planner ranges
 * may be added by hand later). The column is Search Console's impressions for
 * the site, named as such.
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { SeoHead } from "./common";

export type KeywordSource = "gsc" | "autocomplete" | "audit" | "manual";
export type KeywordStatus = "relevant" | "weak" | "irrelevant" | "unjudged";
export type Intent = "commercial" | "transactional" | "informational" | "local" | "navigational";

export interface SeoKeywordsPayload {
  head: SeoHead;
  tiles: KeywordTiles;
  facets: KeywordFacets;
  list: Reading<{ total: number; offset: number; limit: number; rows: KeywordRow[] }>;
  /** The weekly Google Autocomplete research and its request budget. */
  research: ResearchState;
}

export interface KeywordTiles {
  /** Phrases in the table that are relevant or not yet judged. */
  total: Reading<Stat>;
  /** Of all phrases, those Google showed the site for in the window (Search Console). */
  shown: Reading<Stat>;
  /** Queries Google showed the site for in the window and not in the window before (only when the window before is covered). */
  newQueries: Reading<Stat>;
  /** Queries shown in the window before and not in this one (only when covered). */
  lostQueries: Reading<Stat>;
  /** Phrases at average position 1 to 10 in the window. */
  topTen: Reading<Stat>;
}

export interface KeywordFacets {
  langs: { key: string; count: number }[];
  intents: { key: Intent; count: number }[];
  sources: { key: KeywordSource; count: number }[];
  statuses: { key: KeywordStatus; count: number }[];
  clusters: { key: string; name: string; lang: string; count: number }[];
}

export interface KeywordRow {
  id: number;
  phrase: string;
  lang: string | null;
  cluster: { key: string; name: string } | null;
  intent: Intent | null;
  sources: KeywordSource[];
  status: KeywordStatus;
  /** The page that answers it (by the audit, the desk's rule, or a person), or null: a gap. */
  page: string | null;
  mappedBy: "audit" | "rule" | "person" | null;
  /** The page Google showed most for it in the window, when it showed one. */
  shownPage: string | null;
  /** Search Console, over the window; null when Google did not show the site for it. */
  impressions: number | null;
  clicks: number | null;
  position: number | null;
  /** Position in the window before; null when not compared or not shown then. */
  previousPosition: number | null;
  /** Average position per day over the window (null on days it was not shown), oldest first. */
  trend: (number | null)[];
  flags: { local: boolean; question: boolean; price: boolean };
  firstSeen: string;
}

export interface ResearchState {
  /** Requests to Google Autocomplete this week and the cap the desk refuses beyond. */
  used: number;
  cap: number;
  /** The ISO week the count belongs to: "2026-W40". */
  week: string;
  lastRun: string | null;
  lastNote: string | null;
  nextRun: string | null;
  /** Phrases the research added in all, and in its last run. */
  found: number;
  foundLast: number;
  line: string;
}
