# From a social link to an article

The desk already takes a link to somebody's written article. This adds the
three places our audience actually is: **YouTube, TikTok and Instagram**, video
posts and carousels alike. Everything needed already works in `sm-fixed` —
copy the modules into this repo, never edit the originals (see the bottom).

## What this deliberately does NOT do

Fini, 23 September 2026: *"It does not necessarily need to give virality and
video explanations — only if it is from the blog perspective. And we do not
need to capture SS."*

- **No Higgsfield.** No virality score, no attention curve, no brain windows.
  That is sm-fixed's connector, sm-fixed's wallet and sm-fixed's question
  ("is this worth shooting?"). A blog post does not need it, and this repo
  holds no paid credential of any kind.
- **No screenshots, stills or filmstrips.** A frame lifted out of someone's
  video is their image. The article's cover is drawn locally by ComfyUI
  (`COMFY_URL`), the way every other cover here is.
- **No shoot plans, fingerprints, storyboards or sessions.** None of it is a
  blog concern.

## Two shapes of source, one pipeline

```
link → classify → resolve → ┬ video    → download → transcribe → delete
                            └ carousel → read the slides → delete
                                             ↓
                   metrics snapshot → match services → draft → a human approves
                                             ↓
                              commit to balkaris-web-infrastructure → live
```

**A video** (YouTube, TikTok, an IG Reel): the transcript is the substance.
`transcribeVideo()` from `sm-fixed/src/personal/transcript.ts` with
`scripts/whisper_json.py` — local faster-whisper, CUDA with a CPU fallback, $0.

**An IG carousel**: there is no video and no transcript. The substance is the
caption plus the slides. Read the slides with the local vision model
(`gemma4:12b-it-qat`, the same pass `sm-fixed/src/personal/explain.ts` uses),
understand what they argue, then delete them. **Never republish someone's
slides** — describe the argument and answer it.

Decide which shape you have from what the extractor returns, never from the
URL: an instagram.com/p/ link can be either.

## The modules to copy

| What | From |
|---|---|
| `classify()`, `expandUrl()`, `canonicalUrl()`, `resolve()` | `sm-fixed/src/ingest/resolve.ts` |
| `resolveInstagram()`, `resolveYouTube()` over `probeWithYtDlp()` | `sm-fixed/src/ingest/resolve-ytdlp.ts` |
| `download()`, `probe()`, `workDir()`, `rmWork()` | `sm-fixed/src/ingest/probe.ts` |
| `transcribeVideo()` → `{full_text, segments, language, model}` | `sm-fixed/src/personal/transcript.ts` |

Four traps those modules already pay for, all of which still apply here:

1. **tikwm is TikTok-only and allows one request a second.**
   `RESOLVER_MIN_INTERVAL_MS` is 1100; a faster call answers code:-1
   "Free Api Limit", which is retryable and is **not** a dead link. Only
   deleted / unavailable / private means dead. Instagram and YouTube go through
   yt-dlp; `pip install -U yt-dlp` is the usual fix when IG starts failing.
2. **`vad_filter=True` reports "nobody speaks" on any video carried by a song.**
   whisper_json.py makes a second pass with the filter off when the first finds
   nothing, and records which pass spoke. Keep it — a sung line is often the
   only line.
3. **Persist the canonical page URL, never the CDN URL** (signed, `x-expires`,
   dead within hours).
4. **Never keep the media.** download → use → delete in a `finally`, everything
   that needs the file in one pass.

## The numbers, and why they are kept

Capture the source's public stats at ingest, the way sm-fixed does: views,
likes, comments, shares, saves, with **`posted_at` and `captured_at` both**,
because a seven-hour-old video reads nothing like a seven-week-old one.
Instagram exposes views, likes and comments but **not** saves or shares — those
stay `null`, never `0`, and a null must never render as a zero.

They exist to answer one question: *did an article built on a video that
performed well, itself perform well?* That needs the source's numbers and the
article's numbers side by side on the desk console — source views at capture,
article views since publish, days live.

## Article views — read what is already there

balkaris.ch already runs **GA4 and Microsoft Clarity**, live since 21 September,
both loading only after the visitor accepts the cookie banner. So do not build a
second tracker.

- **Read views from the GA4 Data API** into the desk console. It needs a Google
  service account with Viewer on the property — a console step for Fini, and a
  row in `E:\Balkaris\secrets\README.md` when it exists. Never the value.
- **Say the caveat in the console, in words.** GA4 only fires after consent, so
  it undercounts by however many visitors decline. It is a fair comparison
  *between* articles, not an audited number, and printing a confident figure
  would be a lie.
- If a consent-free count is wanted alongside it, Cloudflare Web Analytics
  counts at the Worker with no cookie and no personal data. **The option to
  avoid** is a bespoke beacon from balkaris.ch to desk.balkaris.ch: a new
  consent story, a cross-origin request on every article, and a second number
  that will disagree with GA4 and start an argument about which is right.

## The gate that does not move

A transcript or a carousel reworded is someone else's work, and Google calls it
scaled content abuse and demotes the whole domain — balkaris.ch included. The
output is **commentary**: what the source said, in a sentence or two, with a
link and a name; then what Balkaris thinks and what it means for the people we
work for. `src/draft.ts` already rejects a draft that is mostly the source.
Video makes that gate easier to cross, not harder — do not loosen it.

## The article's shape

The site's own type: `PostBlock[]` in
`balkaris-web-infrastructure/content/types.ts` (`Post extends Meta`, line 418) —
`string | {h} | {list} | {quote} | {note} | {code} | {steps} | {table}`. Emit
that JSON straight from Ollama's `format` with the type as the schema. Never
generate markdown and parse it.

## sm-fixed is read-only from here

Copy the module; never edit the original to suit this caller. sm-fixed's worker
runs live against its own Supabase, its own Telegram bot and the studio queue,
and a change made from here breaks a pipeline nobody is watching at the time.
If something in sm-fixed genuinely needs fixing, say so and let a session that
owns sm-fixed make the change.

Its worker also already runs yt-dlp, Whisper and ComfyUI on the same 4090:
**one card, one queue.** This work goes behind the desk's queue, not beside it.
