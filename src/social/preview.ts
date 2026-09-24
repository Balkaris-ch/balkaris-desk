import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Our own copy of the video, re-encoded small — so it has no player on it at
 * all, and a reader can turn the sound on without leaving the page.
 *
 * Fini, 24 September 2026, three times, each one removing an option. First:
 * *"I need the video to play - like muted - not as a placeholder."* Then:
 * *"can we make it so it is not with all the tiktok or yt players or
 * something that removes those recommendations at the end of it?"* And then:
 * *"I need to be able to click a button and hear it on the website."*
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
 * AND IT HAS SOUND, because he asked for that too: *"I need to be able to
 * click a button and hear it on the website."* It starts muted, because a
 * page that makes noise on load is a page people close, and a button unmutes
 * it. Muted autoplay is allowed everywhere; unmuting on a click is a user
 * gesture, which is exactly what the browsers want.
 *
 * SO HOW LONG, AND HOW BIG? Measured on the BBC TikTok rather than guessed,
 * because the whole design started from *"we don't upload it on the server
 * because then we will have too many videos"*:
 *
 *     10s silent                131 KB
 *     10s with audio            215 KB
 *     30s with audio            622 KB
 *     the whole 31s, good audio 777 KB   <- and the original was 1.1 MB
 *
 * A ten-second excerpt made sense while it was silent and decorative. Once a
 * reader can hear it, cutting it off mid-sentence is worse than useless, and
 * the whole thing costs a third of a megabyte more than the fragment did —
 * less, in fact, than the file we already downloaded to transcribe. So: the
 * whole video, re-encoded smaller, up to `MAX_SECONDS`.
 *
 * Past that it is an excerpt again and the caption says so. Ninety seconds
 * covers essentially every TikTok, Reel and Short; a fifteen-minute YouTube
 * explainer is a link, not an element on a page.
 */

const execFileP = promisify(execFile);
const require = createRequire(import.meta.url);
const ffmpegPath: string = require("ffmpeg-static");

/**
 * The cap. Long enough to be the whole of almost anything shared to the desk,
 * short enough that nothing on the site is ever measured in megabytes.
 */
const MAX_SECONDS = 90;
/**
 * The long side. The article draws the upright ones at 340 CSS pixels, so 720
 * is a clean 2x for a retina screen and nothing above it is ever seen.
 */
const LONG = 720;

export interface Preview {
  /** mp4 with sound, ready to be written into the site. It starts muted. */
  clip: Buffer;
  /** The first frame, so the box is never empty while the clip loads. */
  poster: Buffer;
  /** How much of the video is in it. */
  seconds: number;
  /** Is that all of it, or did the cap cut it short? The caption says which. */
  whole: boolean;
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

export async function makePreview(file: string, dir: string, sourceSeconds?: number | null): Promise<Preview | null> {
  const clipPath = path.join(dir, "preview.mp4");
  const posterPath = path.join(dir, "poster.webp");

  try {
    await execFileP(
      ffmpegPath,
      [
        "-y",
        "-i", file,
        "-t", String(MAX_SECONDS),
        /* 96k stereo. 64k mono saves about 120 KB over a minute and audibly
           flattens a voice recorded on a phone, which is most of what gets
           shared here. */
        "-c:a", "aac",
        "-b:a", "96k",
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
    const whole = !sourceSeconds || sourceSeconds <= MAX_SECONDS;
    return {
      clip,
      poster,
      seconds: Math.round(whole && sourceSeconds ? sourceSeconds : MAX_SECONDS),
      whole,
    };
  } catch {
    /* No preview is not a failed article. The piece is written either way and
       reads perfectly well as prose with the source credited. */
    return null;
  } finally {
    await rm(clipPath, { force: true }).catch(() => {});
    await rm(posterPath, { force: true }).catch(() => {});
  }
}
