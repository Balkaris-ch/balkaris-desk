/**
 * GET /api/v1/seo/competitors — the domains seen beside or instead of
 * Balkaris: where each was seen (which query, which engine, which position or
 * citation, which day) and what its pages for our clusters say, fetched
 * politely once a week.
 *
 *   ?engine=google      google | ai (any assistant) | all
 *   ?cluster=<key>      seen for that cluster's queries
 *   ?q=agentur          words in the domain or name
 *   ?open=<domain>      one competitor in detail (`selected`)
 *
 * NO INVENTED METRICS: no domain rating, no backlink count, no traffic
 * estimate. What is shown is what was observed (where it was seen) and what
 * its own page says (words, language, structured data, whether it states a price).
 *
 * Types only.
 */
import type { Reading } from "../common";
import type { SeoHead } from "./common";

export interface SeoCompetitorsPayload {
  head: SeoHead;
  list: Reading<{ total: number; rows: CompetitorRow[]; engines: { key: string; label: string; count: number }[] }>;
  selected: Reading<CompetitorDetail> | null;
  /** The weekly refresh of their pages. */
  refresh: { lastRun: string | null; lastNote: string | null; nextRun: string | null; pages: number; fetched: number };
}

export interface Sighting {
  /** google (organic), google-local (the map pack), google-aio (AI Overview), ai-mode, chatgpt, perplexity, gemini. */
  engine: string;
  engineLabel: string;
  /** organic | local-pack | named (in an AI answer) | cited (as an AI answer's source). */
  kind: "organic" | "local-pack" | "named" | "cited";
  query: string;
  /** Organic or map-pack position, 1-based; null for an AI answer. */
  position: number | null;
  day: string;
  /** Who observed it: "audit" (2 Oct 2026, the owner's Chrome) or "lead-chrome" or "api". */
  by: string;
  cluster: { key: string; name: string } | null;
}

export interface CompetitorRow {
  /** The site's host ("aretis.ch"); for a company an AI answer or a map pack named without a site, "name:" and its name. */
  domain: string;
  name: string | null;
  sightings: number;
  /** The best organic Google position seen for one of our queries; null when never seen organically. */
  bestPosition: number | null;
  /** Times an AI answer named it, and times one cited its site. */
  named: number;
  cited: number;
  queries: string[];
  /** Its pages the desk has fetched, and how many of them state a price. */
  pages: number;
  pricePages: number;
  lastSeen: string;
}

export interface CompetitorPage {
  url: string;
  /**
   * "ranking": the address the observation captured for the query. "home":
   * the observation named only the domain, so its home page was read instead;
   * it is not necessarily the page that ranks.
   */
  address: "ranking" | "home";
  /** The cluster or query it was captured for. */
  cluster: { key: string; name: string } | null;
  query: string | null;
  status: number | null;
  title: string | null;
  h1: string | null;
  words: number | null;
  lang: string | null;
  schemaTypes: string[];
  /** Whether the page states a price (a CHF or Fr. amount, or "ab CHF"); null when not read. */
  priceStated: boolean | null;
  /** The first price-like phrase found, as written on the page. */
  priceText: string | null;
  fetchedAt: string | null;
  /** Why it was not read: robots.txt disallows the desk, the site refused, a timeout. */
  error: string | null;
}

export interface CompetitorDetail {
  competitor: CompetitorRow;
  sightings: Sighting[];
  pages: CompetitorPage[];
}
