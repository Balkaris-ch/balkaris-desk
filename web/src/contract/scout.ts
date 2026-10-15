/** The Scout: GET /api/v1/insights/scout (src/scout/index.ts `overview`). */

export type ScoutMode = "auto" | "mix" | "select" | "off";
export type FindState = "found" | "offered" | "queued" | "skipped" | "failed";

export interface ScoutSettings {
  mode: ScoutMode;
  perDay: number;
  autoNews: number;
  autoMin: number;
  chat: number | null;
}

export interface ScoutFind {
  id: number;
  source: string;
  url: string;
  title: string;
  summary: string | null;
  published_at: string | null;
  found_at: string;
  score: number;
  kind: "news" | "standard";
  why: string | null;
  state: FindState;
  link_id: number | null;
  decided_by?: string | null;
  published: boolean;
  liveSlug: string | null;
}

export interface ScoutSource {
  id: number;
  kind: "rss" | "youtube" | "hn" | "reddit" | "gnews";
  url: string;
  name: string;
  status: "active" | "trial" | "paused";
  origin: "seed" | "found" | "person";
  score: number;
  finds: number;
  kept: number;
  published: number;
  views: number;
  last_checked: string | null;
  last_ok: string | null;
  last_error: string | null;
  /** Minutes between visits, from its score. */
  every: number;
}

export interface ScoutPayload {
  settings: ScoutSettings;
  today: { all: number; auto: number };
  finds: ScoutFind[];
  sources: ScoutSource[];
}
