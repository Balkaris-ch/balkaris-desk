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
 * TWO FILES, AND THAT IS THE WHOLE TRICK. Measured rather than guessed,
 * because the design started from *"we don't upload it on the server because
 * then we will have too many videos"*:
 *
 *     10s silent, 720           131 KB     <- the BBC TikTok, 31s
 *     the whole 31s with audio  777 KB
 *     90s with audio          2 993 KB     <- the Neuralink one, 91s
 *
 * One file cannot be both. A three-megabyte video downloading on every page
 * view, for every reader, most of whom will scroll past it, is not something
 * to do to people — and a ten-second silent fragment is not something a
 * reader can listen to.
 *
 * So the LOOP is what the page costs: ten silent seconds, about 130 KB,
 * playing the moment the article opens. The FULL clip — the whole video with
 * its sound, up to `MAX_SECONDS` — is fetched only when somebody presses the
 * sound button. Nobody pays for audio they did not ask to hear.
 *
 * Ninety seconds covers essentially every TikTok, Reel and Short. Past it the
 * clip is an excerpt again and the caption says so; a fifteen-minute YouTube
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
  /**
   * Ten silent seconds, looping. This is what the page loads and plays, and
   * the only one most readers will ever fetch.
   */
  loop: Buffer;
  /** The whole video with its sound, fetched when the sound button is pressed. */
  clip: Buffer;
  /** The first frame, so the box is never empty while the loop arrives. */
  poster: Buffer;
  /** How much of the video is in `clip`. */
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

/** Ten seconds, no audio: the one that plays on arrival. */
const LOOP_SECONDS = 10;

export async function makePreview(file: string, dir: string, sourceSeconds?: number | null): Promise<Preview | null> {
  const clipPath = path.join(dir, "preview.mp4");
  const loopPath = path.join(dir, "loop.mp4");
  const posterPath = path.join(dir, "poster.webp");

  try {
    /* The loop first: it is the one the page cannot do without. */
    await execFileP(
      ffmpegPath,
      [
        "-y",
        "-i", file,
        "-t", String(LOOP_SECONDS),
        /* No audio at all rather than a silent track: a stream of zeroes
           still costs bytes and still makes a phone offer a mute control on
           something that has nothing to mute. */
        "-an",
        "-vf", `${FIT},fps=24`,
        "-c:v", "libx264",
        "-profile:v", "main",
        "-pix_fmt", "yuv420p",
        "-crf", "31",
        "-preset", "veryfast",
        "-movflags", "+faststart",
        loopPath,
      ],
      { timeout: 120_000, windowsHide: true },
    );

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

    const [loop, clip, poster] = await Promise.all([readFile(loopPath), readFile(clipPath), readFile(posterPath)]);
    const whole = !sourceSeconds || sourceSeconds <= MAX_SECONDS;
    return {
      loop,
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
    await rm(loopPath, { force: true }).catch(() => {});
    await rm(posterPath, { force: true }).catch(() => {});
  }
}
