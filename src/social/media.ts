import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { TransientMedia } from "./types.ts";

/**
 * Getting a file, measuring it, and getting rid of it.
 *
 * Vendored from `sm-fixed/src/ingest/probe.ts`, and CUT DOWN. THIS IS A
 * PARTIAL COPY ON PURPOSE — it is not an unfinished one, so please do not
 * helpfully restore the missing half.
 *
 * Absent, deliberately: the frame extractors `extractThumb`, `extractStill`
 * and `detectCuts`, and the Higgsfield window helpers `trimWindow`,
 * `windowOffsets`, `WINDOW_S`, `MAX_WINDOWS` and `SCENE_THRESHOLD`. The
 * window constants exist to feed Higgsfield's 15.5-second brain windows,
 * which this repo has no credential for and no use for. The extractors cut
 * stills out of a video, which a blog must never do — covers here are drawn
 * from scratch by ComfyUI.
 *
 *   Fini, 23 September 2026: "we do not need to capture SS."
 *
 * A frame lifted out of somebody's video is their image, and an article
 * illustrated with one is republishing it. The desk's covers are drawn from
 * scratch by ComfyUI. Leaving the extractors in the file would be dead code
 * that quietly invites the next person to break that rule, so they are gone.
 *
 * See src/social/README.md: these are copies and sm-fixed is read-only here.
 */

const execFileP = promisify(execFile);
const require = createRequire(import.meta.url);

/* Vendored binaries — identical behaviour on every machine. Never depend on
   whatever ffmpeg happens to be lying around. */
const ffprobePath: string = require("ffprobe-static").path;
const ffmpegPath: string = require("ffmpeg-static");

export interface ProbeResult {
  durationS: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await execFileP(ffprobePath, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,codec_name",
    "-show_entries", "format=duration",
    "-of", "json",
    file,
  ]);
  const j = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number; r_frame_rate?: string; codec_name?: string }>;
    format?: { duration?: string };
  };
  const s = j.streams?.[0];
  if (!s?.width || !s.height) throw new Error(`ffprobe: no video stream in ${file}`);

  const [n, d] = (s.r_frame_rate ?? "0/1").split("/").map(Number);
  const durationS = Number(j.format?.duration);
  /* ffprobe emits the string "N/A" for some containers — a loud failure, not
     a NaN quietly persisted. */
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`ffprobe: unusable duration "${j.format?.duration}" for ${file}`);
  }
  return {
    durationS,
    width: s.width,
    height: s.height,
    fps: d ? (n ?? 0) / d : 0,
    codec: s.codec_name ?? "unknown",
  };
}

export function aspectOf(width: number | null, height: number | null): "9:16" | "16:9" {
  if (!width || !height) return "9:16";
  return width > height ? "16:9" : "9:16";
}

export async function download(url: string, outFile: string, timeoutMs = 60_000): Promise<number> {
  /* AbortSignal covers connect AND body read — a black-holed CDN connection
     otherwise hangs the single-pass pipeline forever. */
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const m = (e as Error).name === "TimeoutError" ? `timed out after ${timeoutMs}ms` : (e as Error).message;
    throw new Error(`download failed: ${m}`);
  }
  if (!res.ok) throw new Error(`download failed: http ${res.status}`);
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, buf);
    return buf.length;
  } catch (e) {
    const m = (e as Error).name === "TimeoutError" ? `body read timed out after ${timeoutMs}ms` : (e as Error).message;
    throw new Error(`download failed: ${m}`);
  }
}

/**
 * The resolved media as one file with picture and sound. Usually that is one
 * download; when the platform only offered them apart (`audioUrl`), both are
 * fetched and ffmpeg joins them, copying the picture and re-encoding only the
 * sound, so an Opus track fits the mp4 too.
 */
export async function fetchMedia(t: TransientMedia, outFile: string, timeoutMs = 120_000): Promise<void> {
  if (!t.audioUrl) {
    await download(t.mediaUrl, outFile, timeoutMs);
    return;
  }
  const video = `${outFile}.video`;
  const audio = `${outFile}.audio`;
  try {
    await download(t.mediaUrl, video, timeoutMs);
    await download(t.audioUrl, audio, timeoutMs);
    await execFileP(ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", video, "-i", audio,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-c:a", "aac", "-shortest",
      outFile,
    ]);
  } finally {
    await rm(video, { force: true });
    await rm(audio, { force: true });
  }
}

/**
 * Scratch lifecycle. The work dir exists for exactly one pass and `rmWork` is
 * called in a `finally`, so the media never outlives the run. We keep the
 * canonical page url and the transcript; we never keep the video.
 */
export function workDir(videoId: string): string {
  return path.join(process.env.WORK_DIR ?? "./work", videoId);
}

export async function rmWork(videoId: string): Promise<void> {
  await rm(workDir(videoId), { recursive: true, force: true });
}
