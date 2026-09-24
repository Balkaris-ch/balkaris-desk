import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { canonicalUrl, classify, expandUrl, ResolveError, resolve } from "./resolve.ts";
import { download, probe, rmWork, workDir } from "./media.ts";
import { makePreview, type Preview } from "./preview.ts";
import { transcribeVideo } from "./transcribe.ts";
import type { Platform, SourceRecord } from "./types.ts";
import { ask, QUICK_MODEL } from "../llm.ts";

/**
 * A social link becomes the same thing an article link becomes: a title, some
 * text, a publication and a date. Everything downstream — the matcher, the
 * templates, the writer, the guard — cannot tell the difference and does not
 * need to.
 *
 * TWO SHAPES, DECIDED BY WHAT COMES BACK, NEVER BY THE URL. An
 * instagram.com/p/ link is a Reel about as often as it is a carousel, so the
 * shape is whatever the extractor actually found.
 *
 *   video     the transcript is the substance. Download, transcribe with
 *             local faster-whisper, delete.
 *   carousel  there is no video and no transcript. The substance is the
 *             caption and what the slides argue. Read them with the local
 *             vision model, then delete them.
 *
 * NOTHING IS KEPT. The delete is in a `finally`, so a crash mid-transcribe
 * still leaves no media on disk. What survives is the canonical page url, the
 * numbers, and words we wrote about it.
 *
 * ONE PASS. Everything that needs the file happens while the file exists,
 * because fetching it twice doubles the only expensive part.
 */

const execFileP = promisify(execFile);
const YT_DLP = process.env.YT_DLP ?? "yt-dlp";

export type SourceShape = "video" | "carousel";

export interface SocialMaterial {
  shape: SourceShape;
  platform: Platform;
  /** The canonical PAGE url. Never the CDN one — that is signed and dies in hours. */
  url: string;
  title: string;
  /** Who posted it, as a handle. The "publication" for the writer's purposes. */
  author: string | null;
  caption: string | null;
  /** The transcript, or the read of the slides. This is what the writer works from. */
  text: string;
  words: number;
  postedAt: string | null;
  /** What the numbers said AT THE MOMENT WE LOOKED. Both timestamps matter. */
  capturedAt: string;
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
  };
  /** For a video: how long it was, and whether anyone spoke. */
  durationS?: number | null;
  spoke?: "voice" | "music" | "silent";
  /** For a carousel: how many slides were read. */
  slides?: number;
  /**
   * A short silent excerpt of the video, ours to serve.
   *
   * Null for a carousel, and null when ffmpeg could not make one — a piece
   * with no clip reads perfectly well as prose with the source credited.
   */
  preview?: Preview | null;
}

const metricsOf = (s: SourceRecord) => ({
  views: s.views,
  likes: s.likes,
  comments: s.comments,
  /* Instagram exposes views, likes and comments but NOT saves or shares.
     They stay null. A null rendered as a zero is a claim we did not measure. */
  shares: s.shares,
  saves: s.saves,
});

/* ---------- the carousel branch ---------------------------------------------

   sm-fixed has never read a carousel — it only ever wanted video — so there is
   no module to vendor and this is written here. Two things its `describeShots`
   learned that transfer directly, and both cost a day to discover:

     · send the images in SMALL BATCHES. A 12b model handed twenty images
       loses track of which is which and starts describing slide 4 as slide 11.
       Five at a time.
     · describe FROM THE IMAGE, never from a list of what you think is in it,
       or the words drift out of step with the pictures.                      */

const SLIDE_BATCH = 5;
const MAX_SLIDES = 20;

async function readSlides(files: string[], caption: string | null): Promise<string> {
  const reads: string[] = [];

  for (let i = 0; i < files.length; i += SLIDE_BATCH) {
    const batch = files.slice(i, i + SLIDE_BATCH);
    const images = await Promise.all(batch.map(async (f) => (await readFile(f)).toString("base64")));

    const res = await ask(
      `These are slides ${i + 1} to ${i + batch.length} of a social media carousel.${
        caption ? `\n\nThe post's own caption: ${caption}` : ""
      }

For each slide IN ORDER, say what it actually shows and what it argues — read
the words that are on the image. One short paragraph per slide, numbered from
${i + 1}. Do not invent a slide that is not here and do not summarise them all
together.`,
      { model: QUICK_MODEL, images, temperature: 0.2, timeoutMs: 180_000 },
    );
    reads.push(res.text.trim());
  }

  return reads.join("\n\n");
}

/**
 * yt-dlp's view of a post, used to tell a carousel from a Reel.
 *
 * A CAROUSEL SLIDE HAS NO `url` AND NO `ext`. Everything on a photo entry is
 * in `thumbnails` — thirteen renditions of the same picture — and the biggest
 * is the one worth reading. The first version of this looked for a `url` with
 * an image extension, found nothing on every slide, and let every carousel
 * fall through to the video path to die on "No video formats found".
 */
interface YtThumb {
  url?: string;
  width?: number;
  height?: number;
}

interface YtEntry {
  url?: string;
  ext?: string;
  vcodec?: string;
  width?: number;
  height?: number;
  thumbnails?: YtThumb[];
  formats?: { vcodec?: string }[];
}

/** The largest rendition of a slide. yt-dlp lists them smallest first. */
function biggestThumb(e: YtEntry): string | null {
  const thumbs = (e.thumbnails ?? []).filter((x) => x.url);
  if (!thumbs.length) return null;
  return thumbs.reduce((a, b) => ((b.width ?? 0) >= (a.width ?? 0) ? b : a)).url ?? null;
}

/** A slide, not a clip: nothing downloadable as video, but a picture to read. */
function isStill(e: YtEntry): boolean {
  const hasVideo =
    (!!e.url && /mp4|m3u8|webm/i.test(e.ext ?? e.url)) ||
    (e.formats ?? []).some((f) => f.vcodec && f.vcodec !== "none");
  return !hasVideo && !!biggestThumb(e);
}

interface YtPost {
  id?: string;
  title?: string;
  description?: string;
  uploader?: string;
  uploader_id?: string;
  timestamp?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  entries?: YtEntry[];
  _type?: string;
}

async function probePost(url: string): Promise<YtPost | null> {
  try {
    const { stdout } = await execFileP(
      YT_DLP,
      /* --ignore-no-formats-error is half the carousel fix: without it yt-dlp
         refuses a photo-only post outright with "No video formats found" and
         emits nothing at all, even though it already has the post. With it,
         the slides come back. */
      ["--dump-single-json", "--no-warnings", "--ignore-no-formats-error", "--no-playlist-reverse", url],
      { maxBuffer: 24 * 1024 * 1024, timeout: 90_000 },
    );
    return JSON.parse(stdout) as YtPost;
  } catch {
    return null;
  }
}

/**
 * The whole thing. Throws `ResolveError` with a `reason` the bot can repeat to
 * a person, so "the video is private" and "the free API is rate-limited" are
 * different sentences and only one of them is worth retrying.
 */
export async function takeSocial(input: string): Promise<SocialMaterial> {
  const expanded = await expandUrl(input);
  const { platform, videoId } = classify(expanded);
  const dir = workDir(videoId);
  const capturedAt = new Date().toISOString();

  try {
    await mkdir(dir, { recursive: true });

    /* ---- is it a carousel? Only Instagram has them, and only the extractor
       knows. A multi-entry post with no video codec in its entries is one. */
    if (platform === "instagram") {
      const post = await probePost(expanded);
      const entries = post?.entries ?? [];
      const stills = entries.filter(isStill);

      if (entries.length > 1 && stills.length === entries.length) {
        const caption = post?.description?.trim() || null;
        const take = stills.slice(0, MAX_SLIDES);
        const files: string[] = [];

        for (const [i, e] of take.entries()) {
          const src = biggestThumb(e);
          if (!src) continue;
          const f = path.join(dir, `slide-${String(i + 1).padStart(2, "0")}.jpg`);
          await download(src, f);
          files.push(f);
        }
        if (!files.length) throw new ResolveError("the slides could not be fetched", "upstream_failed");

        const read = await readSlides(files, caption);
        /* `uploader` is a display name ("Matt Diamante") and `uploader_id` is
           numeric. The handle a reader would recognise is in the title, which
           yt-dlp writes as "Post by <handle>". */
        const handle = post?.title?.match(/^Post by (.+)$/)?.[1]?.trim();
        const author = handle || post?.uploader || post?.uploader_id || null;
        const text = [caption ? `The post's caption: ${caption}` : "", read].filter(Boolean).join("\n\n");

        return {
          shape: "carousel",
          platform,
          url: canonicalUrl(platform, videoId, author).replace("/reel/", "/p/"),
          /* NOT post.title — yt-dlp writes "Post by <handle>", which is a
             label and not a title. The first line of the caption is what the
             post is actually about. */
          title: caption?.split("\n")[0]?.slice(0, 120) || `A carousel by ${author ?? "someone"}`,
          author,
          caption,
          text,
          words: text.split(/\s+/).filter(Boolean).length,
          postedAt: post?.timestamp ? new Date(post.timestamp * 1000).toISOString() : null,
          capturedAt,
          metrics: {
            views: post?.view_count ?? null,
            likes: post?.like_count ?? null,
            comments: post?.comment_count ?? null,
            shares: null,
            saves: null,
          },
          slides: take.length,
        };
      }
    }

    /* ---- otherwise it is a video ---- */
    const { source, transient } = await resolve(expanded);

    const file = path.join(dir, `${videoId}.mp4`);
    await download(transient.mediaUrl, file, 120_000);
    const meta = await probe(file);

    /* Cut it while the file is still here. Everything that needs the media
       happens in this one pass, because the `finally` below deletes it. */
    const preview = await makePreview(file, dir);

    const spoken = await transcribeVideo(file, dir);
    const text = (spoken.full_text ?? "").trim();

    if (!text) {
      throw new ResolveError(
        "nobody speaks in it and there is no sung line either, so there is nothing to write from",
        "upstream_failed",
      );
    }

    const author = source.authorHandle;
    const caption = source.caption;
    /* The caption is part of the substance: a lot of posts make their actual
       argument there and use the video as illustration. */
    const body = [caption ? `The post's caption: ${caption}` : "", `What is said in it:\n${text}`]
      .filter(Boolean)
      .join("\n\n");

    return {
      shape: "video",
      platform,
      url: canonicalUrl(platform, videoId, author),
      title: caption?.split("\n")[0]?.slice(0, 120) || `A ${platform} video by ${author ?? "someone"}`,
      author,
      caption,
      text: body,
      words: body.split(/\s+/).filter(Boolean).length,
      postedAt: source.postedAt ? source.postedAt.toISOString() : null,
      capturedAt,
      metrics: metricsOf(source),
      durationS: meta.durationS ?? source.durationS,
      spoke: spoken.model?.includes("no-vad") ? "music" : "voice",
      preview,
    };
  } finally {
    /* The media never outlives the run. In a `finally` so a crash mid-
       transcribe leaves nothing behind either. */
    await rmWork(videoId).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
