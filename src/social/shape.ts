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
 * `classify()` is a URL parse. Nothing here touches the network or the disk.
 */
export function isSocial(url: string): boolean {
  try {
    classify(url);
    return true;
  } catch {
    return false;
  }
}
