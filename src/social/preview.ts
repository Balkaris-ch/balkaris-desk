import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/**
 * A short, silent, looping excerpt of the video — ours, so it has no player
 * on it at all.
 *
 * Fini, 24 September 2026, twice. First: *"I need the video to play - like
 * muted - not as a placeholder."* Then: *"can we make it so it is not with
 * all the tiktok or yt players or something that removes those
 * recommendations at the end of it?"*
 *
 * Together those rule out the thing we had. TikTok's and YouTube's embeds are
 * the only way to play their file, and they arrive with their own chrome,
 * their own branding, their own cookies and a grid of somebody else's videos
 * at the end — which on an article page is a door out of the article. There
 * is no parameter that removes it; `rel=0` on YouTube stopped meaning "no
 * related videos" years ago and now only means "related videos from this
 * channel".
 *
 * So the clip is ours. A bare <video> tag, muted, looping, no controls, no
 * logo, nothing after it.
 *
 * AN EXCERPT, NOT A COPY, and that is a rule rather than a size limit.
 * media.ts already says it for pictures: illustrating an article with
 * somebody else's image is republishing it. Ten seconds, silent, credited, at
 * a third of the resolution, next to a link to the original is a quotation.
 * The whole thing re-hosted, with the sound, is their video on our server. It
 * also happens to answer the other half of what he asked for in the first
 * place — *"we don't upload it on the server because then we will have too
 * many videos"* — because this is about 300 KB, not 20 MB.
 */

const execFileP = promisify(execFile);
const require = createRequire(import.meta.url);
const ffmpegPath: string = require("ffmpeg-static");

/** Ten seconds is enough to see what a video is and not enough to be it. */
const SECONDS = 10;
/**
 * The long side. The article draws the upright ones at 340 CSS pixels, so 720
 * is a clean 2x for a retina screen and nothing above it is ever seen.
 */
const LONG = 720;

export interface Preview {
  /** Silent mp4, looping, ready to be written into the site. */
  clip: Buffer;
  /** The first frame, so the box is never empty while the clip loads. */
  poster: Buffer;
  seconds: number;
}

/**
 * `scale` that caps the LONG side, whichever it is.
 *
 * `a` is the aspect ratio. Landscape (a > 1) caps the width; a phone video
 * caps the height. `-2` keeps the other side even, which H.264 requires and
 * which is the usual cause of "height not divisible by 2" halfway through an
 * encode.
 */
const FIT = `scale='if(gt(a,1),${LONG},-2)':'if(gt(a,1),-2,${LONG})'`;

export async function makePreview(file: string, dir: string): Promise<Preview | null> {
  const clipPath = path.join(dir, "preview.mp4");
  const posterPath = path.join(dir, "poster.webp");

  try {
    await execFileP(
      ffmpegPath,
      [
        "-y",
        "-i", file,
        "-t", String(SECONDS),
        /* No audio at all, rather than silent audio: a track of zeroes still
           costs bytes and still makes a phone show a mute control. */
        "-an",
        "-vf", `${FIT},fps=24`,
        "-c:v", "libx264",
        "-profile:v", "main",
        "-pix_fmt", "yuv420p",
        "-crf", "31",
        "-preset", "veryfast",
        /* The index goes at the front so the browser can start drawing before
           the file has finished arriving. Without it a 300 KB clip waits for
           its last byte. */
        "-movflags", "+faststart",
        clipPath,
      ],
      { timeout: 120_000, windowsHide: true },
    );

    /* One frame, a second in — frame zero is very often black or a fade. */
    await execFileP(
      ffmpegPath,
      ["-y", "-ss", "1", "-i", file, "-frames:v", "1", "-vf", FIT, "-quality", "72", posterPath],
      { timeout: 60_000, windowsHide: true },
    );

    const [clip, poster] = await Promise.all([readFile(clipPath), readFile(posterPath)]);
    return { clip, poster, seconds: SECONDS };
  } catch {
    /* No preview is not a failed article. The piece is written either way and
       reads perfectly well as prose with the source credited. */
    return null;
  } finally {
    await rm(clipPath, { force: true }).catch(() => {});
    await rm(posterPath, { force: true }).catch(() => {});
  }
}
