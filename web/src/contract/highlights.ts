/**
 * The project highlights: GET and POST /api/v1/content/highlights
 * (src/cc/routes/content.ts, worked out in src/cc/highlights.ts).
 */

export type HighlightMode = "smart" | "latest" | "pick";
export type HighlightPlace = "home" | "digital" | "growth" | "studio";
export type Practice = Exclude<HighlightPlace, "home">;

export interface PlaceSetting {
  mode: HighlightMode;
  /** In "pick": the chosen projects, in order. */
  pick: string[];
}

export interface HighlightSettings {
  places: Record<HighlightPlace, PlaceSetting>;
  /** How many projects each practice puts first. */
  perPractice: number;
}

export interface HighlightProject {
  slug: string;
  title: string;
  client: string;
  practice: Practice;
  /** The case study's address on balkaris.ch. */
  href: string;
  cover: string | null;
  /** ISO, when its case file first reached the website, or null. */
  published: string | null;
  /** GA4 views over the last 30 days, or null when GA4 did not answer. */
  views: number | null;
  featuredInCode: boolean;
}

export interface HighlightResolved {
  home: string | null;
  byPractice: Record<Practice, string[]>;
  featured: string[];
  why: Record<HighlightPlace, string>;
}

export interface HighlightsPayload {
  settings: HighlightSettings;
  projects: HighlightProject[];
  resolved: HighlightResolved;
  /** What the website was last given by the desk, or null before the first time. */
  written: { home: string | null; featured: string[] } | null;
  error: string | null;
}
