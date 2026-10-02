/**
 * GET /api/v1/seo/content-gaps — the topic clusters and which of them the
 * site answers. A cluster with no page of its language is a GAP; every German
 * cluster is a gap while the site is English only.
 *
 *   ?range=30d
 *   ?view=clusters       clusters (default) | keywords | competitors
 *   ?lang=de             de | en | all
 *   ?gap=1               1: only gaps, 0: only covered, all
 *   ?priority=high       high | medium | low | all
 *   ?open=<cluster key>  one cluster in detail (`selected`)
 *
 * Changes (a signed-in person):
 *   POST /api/v1/seo/clusters/:key/page     { path | null }   map the cluster to a page by hand → { ok, cluster }
 *   A cluster's "Create brief" is its opportunity's action: POST /api/v1/seo/opportunities/:id/act
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { OpportunityRow, Priority, SeoHead } from "./common";
import type { Intent } from "./keywords";

export interface SeoContentGapsPayload {
  head: SeoHead;
  tiles: GapTiles;
  view: "clusters" | "keywords" | "competitors";
  clusters: Reading<{ rows: ClusterRow[] }>;
  /** view=keywords: relevant phrases with no page of their language. */
  keywords: Reading<{ total: number; rows: GapKeyword[] }> | null;
  /** view=competitors: competitor pages captured for each cluster. */
  competitors: Reading<{ rows: { cluster: { key: string; name: string }; pages: { domain: string; url: string; title: string | null; words: number | null; lang: string | null; priceStated: boolean | null }[] }[] }> | null;
  selected: Reading<ClusterDetail> | null;
}

export interface GapTiles {
  clusters: Reading<Stat>;
  /** Clusters with no page of their language. */
  gaps: Reading<Stat>;
  germanGaps: Reading<Stat>;
  /** Relevant phrases with a page of their language, of all relevant phrases. */
  mappedPhrases: Reading<Stat>;
}

export interface ClusterRow {
  key: string;
  name: string;
  lang: string;
  intent: Intent | null;
  /** The audit's judgement of whether a young site can win it (2 Oct 2026), or a person's; not a measured figure. */
  priority: Priority;
  /** The audit's order of attack, 1 first; null for a cluster added since. */
  rank: number | null;
  page: string | null;
  mappedBy: "audit" | "rule" | "person" | null;
  gap: boolean;
  /** Why it matters and what to do, as the audit wrote it. */
  why: string | null;
  action: string | null;
  keywords: { total: number; relevant: number; mapped: number };
  /** Search Console impressions of its phrases in the window: real demand the site already meets; null when none. */
  impressions: number | null;
  /** A few of its phrases. */
  examples: string[];
  /** The opportunity that carries its "Create brief" or "Optimise page". */
  opportunityId: string | null;
}

export interface GapKeyword {
  id: number;
  phrase: string;
  lang: string | null;
  cluster: { key: string; name: string } | null;
  intent: Intent | null;
  impressions: number | null;
  flags: { local: boolean; question: boolean; price: boolean };
}

export interface ClusterDetail {
  cluster: ClusterRow;
  phrases: { id: number; phrase: string; status: string; impressions: number | null; position: number | null; page: string | null }[];
  opportunity: OpportunityRow | null;
  competitors: { domain: string; url: string; title: string | null; h1: string | null; words: number | null; lang: string | null; schemaTypes: string[]; priceStated: boolean | null; fetchedAt: string | null }[];
  /** Where the competitors were seen for this cluster's queries. */
  sightings: { domain: string; engine: string; kind: string; query: string; position: number | null; day: string }[];
}
