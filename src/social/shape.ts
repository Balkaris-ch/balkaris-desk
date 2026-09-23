import { classify } from "./resolve.ts";

/**
 * "Is this a social link?" — and nothing else.
 *
 * Its own file because THE BOX ASKS THIS QUESTION AND THE BOX MUST NOT LOAD
 * THE ANSWER'S MACHINERY. `pipeline.ts` pulls in `transcribe.ts` and
 * `media.ts`, which `require()` the ffmpeg and ffprobe binaries at module
 * scope. Importing it from `intake.ts` took the server down on the first
 * deploy with MODULE_NOT_FOUND, and installing ffmpeg on the box to fix that
 * would have been curing the symptom: the box has no GPU, does no
 * transcribing and should never have those code paths in memory at all.
 *
 * Nothing here touches the network or the disk.
 */

/**
 * Hosts that are social even when the path says nothing yet.
 *
 * THIS IS THE SHARE-LINK FIX. `classify()` wants a video id and a share link
 * does not carry one — `vm.tiktok.com/ZN8M4dqgf/` is a redirect and nothing
 * more. So the first TikTok Fini shared from his phone fell straight past the
 * social branch, was read as an article, and came back "there is no article on
 * that page that I can find", which is true and useless.
 *
 * The share domains are exactly what a person gets when they press Share, so
 * they are the common case rather than an edge one. The runner expands the
 * link before it classifies (pipeline.ts calls `expandUrl` first), so all the
 * box has to know is where it is going.
 */
const SOCIAL_HOSTS = [
  "tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "instagram.com",
  "instagr.am",
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
];

function host(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isSocial(url: string): boolean {
  /* A link that already parses is certainly social. */
  try {
    classify(url);
    return true;
  } catch {
    /* and one that does not may still be, if it points somewhere we know. */
  }

  const h = host(url);
  if (!h) return false;
  return SOCIAL_HOSTS.some((s) => h === s || h.endsWith(`.${s}`));
}

/**
 * What to call it before anything has been fetched.
 *
 * A share link tells us the platform and nothing else, so the bot can say
 * "that is a TikTok" while the workstation finds out whether it is a video or
 * a carousel.
 */
export function platformOf(url: string): string | null {
  const h = host(url);
  if (!h) return null;
  if (h === "youtu.be" || h.endsWith("youtube.com") || h.endsWith("youtube-nocookie.com")) return "YouTube";
  if (h.endsWith("tiktok.com")) return "TikTok";
  if (h.endsWith("instagram.com") || h === "instagr.am") return "Instagram";
  return null;
}
