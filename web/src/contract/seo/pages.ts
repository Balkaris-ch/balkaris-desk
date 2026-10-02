/**
 * GET /api/v1/seo/pages — every page the desk knows, with its search figures,
 * index state, score, issues, AI readiness and open opportunities.
 *
 *   ?range=30d
 *   ?type=service        the crawl's kind (service, segment, article, hub…), or "all"
 *   ?status=indexed      indexed | not-indexed | issues | all
 *   ?score=90-100        90-100 | 70-89 | 50-69 | 0-49 | all
 *   ?traffic=high        high (100+ impressions) | medium (10–99) | low (1–9) | none | all
 *   ?q=law               words in the address or title
 *   ?sort=impressions    impressions (default) | clicks | position | score | issues | opportunities | path | updated
 *   ?dir=desc            asc | desc
 *   ?offset=0&limit=50   at most 200
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { PageRef, Rate, RateStat, SeoHead } from "./common";

export interface SeoPagesPayload {
  head: SeoHead;
  tiles: PagesTiles;
  facets: PageFacets;
  list: Reading<{ total: number; offset: number; limit: number; rows: SeoPageRow[] }>;
}

export interface PagesTiles {
  /** Pages the crawl knows that answer 200 and are in the sitemap; `previous` from the crawl's daily count. */
  pages: Reading<Stat>;
  /** Of those, indexed by Google at the last daily URL Inspection (`of` is the sitemap's count). */
  indexed: Reading<Stat>;
  /** Pages with at least one critical or warning finding of the crawl. */
  withIssues: Reading<Stat>;
  /** Organic clicks from the desk's Search Console history. */
  clicks: Reading<Stat>;
  position: Reading<Stat>;
  ctr: Reading<RateStat>;
}

export interface PageFacets {
  types: { key: string; label: string; count: number }[];
  status: { key: "indexed" | "not-indexed" | "issues"; label: string; count: number }[];
  score: { key: string; label: string; count: number }[];
  traffic: { key: "high" | "medium" | "low" | "none"; label: string; count: number }[];
}

export interface SeoPageRow {
  page: PageRef;
  /** The address on the live site. */
  url: string;
  status: number;
  inSitemap: boolean;
  /** Google's word at the last URL Inspection, and whether that is "indexed". Null before the first check or for a page not in the sitemap. */
  index: { indexed: boolean; coverage: string | null; day: string } | null;
  clicks: number;
  impressions: number;
  ctr: Rate;
  /** Average position over the window; null without impressions. */
  position: number | null;
  /** The crawl's score out of 100 by its stated rules; null for a page it does not score. */
  score: number | null;
  issues: { critical: number; warning: number; opportunity: number };
  /** Open opportunities for this page. */
  opportunities: number;
  /** AI-readiness checks the page passes, of those that apply to it; null before the first readiness check. */
  readiness: { pass: number; of: number } | null;
  words: number | null;
  /** When the desk last saw the page's content change, or the sitemap's own date; null when neither is known. */
  updated: string | null;
}
