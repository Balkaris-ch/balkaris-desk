# src/social — copies, and where they came from

Everything in this folder except `pipeline.ts` and `types.ts` is a **copy of a
module from `sm-fixed`**, taken on 23 September 2026.

| Here | From | Changed |
|---|---|---|
| `resolve.ts` | `sm-fixed/src/ingest/resolve.ts` | import path only |
| `resolve-ytdlp.ts` | `sm-fixed/src/ingest/resolve-ytdlp.ts` | import path only |
| `media.ts` | `sm-fixed/src/ingest/probe.ts` | **cut down** — see below |
| `transcribe.ts` | `sm-fixed/src/analyze/transcribe.ts` | import path only |
| `../../scripts/whisper_json.py` | `sm-fixed/scripts/whisper_json.py` | unchanged |
| `types.ts` | `sm-fixed/src/types.ts` | trimmed to four types |

## sm-fixed is read-only from here

Copy the module; never edit the original to suit this caller. sm-fixed's
worker runs live against its own Supabase, its own Telegram bot and the studio
queue, and a change made from this repo breaks a pipeline nobody is watching
at the time. If something in sm-fixed genuinely needs fixing, say so and let a
session that owns sm-fixed make the change.

## What was cut out of `media.ts`, and why

`trimWindow`, `extractThumb`, `extractStill`, `detectCuts`, `windowOffsets`,
`WINDOW_S`, `MAX_WINDOWS`, `SCENE_THRESHOLD`. All of it serves sm-fixed's
virality windows and filmstrips, and none of it belongs to a blog.

> Fini, 23 September 2026: *"we do not need to capture SS."*

A frame lifted out of somebody's video is their image. The desk's covers are
drawn from scratch by ComfyUI. The extractors are not left in as unused
exports because dead code is an invitation.

Also deliberately absent: Higgsfield, in any form. No virality score, no
attention curve, no brain windows. This repo holds no paid credential and is
not going to start.

## Four traps the originals already pay for — keep all four

1. **tikwm is TikTok-only and allows one request a second.**
   `RESOLVER_MIN_INTERVAL_MS` is 1100 and the pacing state lives in
   `resolve.ts` alone, because it is a floor on the resolver as a whole and
   not per call site. `code:-1 "Free Api Limit"` is **retryable** and is not a
   dead link — only deleted / unavailable / private is dead. Instagram and
   YouTube go through yt-dlp; `pip install -U yt-dlp` is the usual fix when
   Instagram starts failing.
2. **`vad_filter=True` reports "nobody speaks" on any video carried by a
   song.** `whisper_json.py` makes a second pass with the filter off when the
   first finds nothing, and records which pass spoke. Keep it — half the
   videos worth writing about are scored with music, and a sung line is often
   the only line.
3. **Persist the canonical PAGE url, never the CDN url.** The CDN one is
   signed, carries `x-expires` and is dead within hours. `canonicalUrl()` is
   what goes in the `links` row. If a resolved media url is ever held, it is
   held for the length of one pass and never rendered.
4. **Never keep the media.** download → use → delete, with the delete in a
   `finally`, and everything that needs the file done in that one pass.

## One card, one queue

sm-fixed's worker already runs yt-dlp, Whisper and ComfyUI on the same 4090.
Polling out solves availability, not contention, and ComfyUI died outright on
2026-09-06 when two processes drew at once.

So the desk does not draw and write at the same time as itself, and treats a
ComfyUI failure as retryable with backoff rather than as a lost article: a
cover that cannot be drawn is a missing picture, and the journal already draws
a plate for an article that has none. There is no cross-repo lock today. If
the collision turns out to bite in practice, a shared lock file that both
repos take before calling ComfyUI is the answer, and it needs a session that
owns sm-fixed to write the other half.
