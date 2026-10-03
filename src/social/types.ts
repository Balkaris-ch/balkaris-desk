/**
 * The four types the vendored resolvers speak.
 *
 * Copied from `sm-fixed/src/types.ts` and trimmed to what the desk uses. That
 * file also carries scenes, curves, brain windows and shoot fingerprints —
 * sm-fixed's questions, none of them a blog's. See src/social/README.md for
 * the provenance rule: these are copies and sm-fixed is read-only from here.
 */

export type Platform = "tiktok" | "instagram" | "youtube" | "file";

/**
 * Fields safe to persist. The canonical PAGE url survives; nothing here
 * expires.
 *
 * `views`, `likes`, `comments`, `shares` and `saves` are the source's public
 * numbers AT THE MOMENT WE LOOKED, which is why `postedAt` is kept beside
 * them: a seven-hour-old video reads nothing like a seven-week-old one.
 * Instagram exposes views, likes and comments but not saves or shares — those
 * stay `null`, never `0`, and a null must never be rendered as a zero.
 */
export interface SourceRecord {
  platform: Platform;
  videoId: string;
  /** Canonical PAGE url, e.g. https://www.tiktok.com/@handle/video/123. Never a CDN url. */
  url: string;
  authorHandle: string | null;
  caption: string | null;
  postedAt: Date | null;
  durationS: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

/**
 * Fields that MUST NOT be persisted.
 *
 * TikTok CDN links are signed and carry `x-expires`; an Instagram one dies in
 * hours. Download now or lose it, and store the page url instead.
 */
export interface TransientMedia {
  /** Direct MP4. Valid for hours. Download it now or lose it. */
  mediaUrl: string;
  /** Separate audio track, set only when `mediaUrl` is video without sound.
   *  Same expiry as `mediaUrl`; `fetchMedia` joins the two into one file. */
  audioUrl?: string | null;
  /** Cover image. Same expiry problem — download, never hot-link. */
  coverUrl: string | null;
  sizeBytes: number | null;
}

export interface Resolved {
  source: SourceRecord;
  transient: TransientMedia;
}
