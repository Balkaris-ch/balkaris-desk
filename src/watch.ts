import { classify } from "./social/resolve.ts";

/**
 * The video an article was written from, as the site's `Post.watch`.
 *
 * Fini, 24 September 2026: *"can we build like a player where we only show
 * the video, but we don't upload it on the server because then we will have
 * too many videos."*
 *
 * So nothing is copied. This is an id and a platform, derived from what the
 * links table already holds — the canonical url, the handle, the duration —
 * and the site asks the platform for the bytes when a reader presses play
 * (balkaris-web-infrastructure, components/blocks/watch.tsx).
 *
 * DERIVED AT PUBLISH, NOT STORED. It could have been a column on the draft,
 * written by the runner when it ingested. It is not, because then every
 * article published before this existed would have an empty one forever, and
 * toggling "just the text" would mean a second write to a second place. The
 * link row is the source of truth about the source; this reads it.
 *
 * `classify` is safe on the box: social/resolve.ts imports nothing but types,
 * unlike pipeline.ts, which pulls ffmpeg in at module scope and took the
 * server down the first time it was imported here.
 */

export interface Watch {
  platform: "tiktok" | "youtube" | "instagram";
  id: string;
  url: string;
  handle?: string;
  seconds?: number;
}

export interface WatchableLink {
  url: string;
  /** "video", "carousel", "article"… only a video can be played. */
  kind: string | null;
  author: string | null;
  duration_s: number | null;
  /** 0 when the person who shared it asked for just the text. */
  attach: number | null;
}

/**
 * What to attach, or nothing.
 *
 * Nothing, and quietly, for every reason: an article link, a carousel (there
 * is no player for a set of photographs), a url whose id cannot be read, and
 * a link somebody asked to keep as text. A missing video is a piece that
 * reads as prose, which is a perfectly good article and not a failure worth
 * reporting.
 */
export function watchFrom(link: WatchableLink): Watch | undefined {
  if (link.attach === 0) return undefined;
  if (link.kind !== "video") return undefined;

  try {
    const { platform, videoId } = classify(link.url);
    if (platform !== "tiktok" && platform !== "youtube" && platform !== "instagram") return undefined;
    return {
      platform,
      id: videoId,
      url: link.url,
      ...(link.author ? { handle: link.author } : {}),
      /* Rounded: the card prints m:ss and a video is not 56.84 seconds long
         to anybody watching it. */
      ...(link.duration_s ? { seconds: Math.round(link.duration_s) } : {}),
    };
  } catch {
    /* No id in that url. It stays a written piece. */
    return undefined;
  }
}
