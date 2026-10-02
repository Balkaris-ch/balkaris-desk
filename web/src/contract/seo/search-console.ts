/**
 * GET /api/v1/seo/search-console — an explorer over the desk's own Search
 * Console history (daily snapshots kept beyond Google's sixteen months) and,
 * for what the snapshots do not hold, live Search Console.
 *
 *   ?dimension=query     query | page | device | country | date | searchAppearance
 *   ?range=30d           or ?start=YYYY-MM-DD&end=YYYY-MM-DD
 *   ?country=che         che | all (the snapshots keep these two); any other ISO code reads live
 *   ?device=MOBILE       DESKTOP | MOBILE | TABLET | all
 *   ?q=kosten            the query contains these words
 *   ?page=/seo           one page
 *   ?sort=impressions    clicks | impressions | ctr | position | key
 *   ?dir=desc
 *   ?offset=0&limit=50   at most 500
 *   ?source=snapshots    snapshots (default) | live
 *
 * country and searchAppearance as a dimension, or another country, are read
 * live from Search Console (kept six hours); `source` says which it was.
 *
 * Types only.
 */
import type { Reading } from "../common";
import type { Rate, SeoHead } from "./common";

export type ExplorerDimension = "query" | "page" | "device" | "country" | "date" | "searchAppearance";

export interface SeoSearchConsolePayload {
  head: SeoHead;
  asked: ExplorerQuery;
  result: Reading<ExplorerResult>;
  /** The sitemaps Search Console knows for the property, and what it made of each. */
  sitemaps: Reading<{ path: string; lastSubmitted: string | null; lastDownloaded: string | null; isPending: boolean; warnings: number; errors: number; submitted: number }[]>;
  /** What the desk's history holds: first and last day, rows, days snapshotted. */
  history: Reading<{ from: string; to: string; days: number; rows: number; lastSnapshot: string | null }>;
  /** Search Console's own performance report for the property, or null. */
  href: string | null;
}

export interface ExplorerQuery {
  dimension: ExplorerDimension;
  start: string;
  end: string;
  country: string;
  device: string;
  q: string;
  page: string | null;
  sort: "clicks" | "impressions" | "ctr" | "position" | "key";
  dir: "asc" | "desc";
  offset: number;
  limit: number;
  source: "snapshots" | "live";
}

export interface ExplorerResult {
  source: "snapshots" | "live";
  start: string;
  end: string;
  /** The window before, when the history covers it whole; else null and nothing is compared. */
  previous: { start: string; end: string } | null;
  totals: { clicks: number; impressions: number; ctr: Rate; position: number | null };
  previousTotals: { clicks: number; impressions: number; ctr: Rate; position: number | null } | null;
  /** One row per day of the window, for the chart. */
  days: { date: string; clicks: number; impressions: number; position: number | null }[];
  total: number;
  rows: ExplorerRow[];
  /** False when Google's row limit cut a live answer short. */
  complete: boolean;
  /** The caveats that belong to these numbers, in one line (rare queries withheld, final days only…). */
  note: string;
}

export interface ExplorerRow {
  key: string;
  /** What the row shows: the path for a page, "Mobile" for a device, the country's name. */
  label: string;
  clicks: number;
  impressions: number;
  ctr: Rate;
  position: number | null;
  previous: { clicks: number; impressions: number; position: number | null } | null;
}
