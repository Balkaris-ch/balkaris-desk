import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Resolved, SourceRecord, TransientMedia } from './types.ts'
import { ResolveError } from './resolve.ts'

const execFileP = promisify(execFile)

/**
 * Instagram and YouTube resolution, via yt-dlp.
 *
 * IG has no public metadata API and its private GraphQL endpoints rotate
 * (probed 2026-08-30: the doc_id endpoint 404s; the embed page still serves).
 * Rather than chase that churn ourselves, we shell out to yt-dlp, whose
 * Instagram extractor is community-maintained against exactly these changes —
 * verified live tonight: it reaches public posts logged-out.
 *
 * Honesty note on stats: IG exposes views, likes and comments, but NOT saves
 * or shares. Those stay null rather than zero — a zero would poison the
 * save-rate maths the dashboard leans on. YouTube is the same story: views
 * and likes are public, comments usually, shares and saves never.
 *
 * YouTube arrived 2026-09-09 and needed no new machinery — the same extractor
 * handles it. It is the one platform here whose videos are usually landscape,
 * which is why nothing downstream assumes an aspect ratio any more: it is
 * read from the probed file, because a Short is still vertical.
 */

const YT_DLP = process.env.YT_DLP ?? 'yt-dlp'

interface YtDlpJson {
  id?: string
  title?: string
  description?: string
  uploader?: string
  uploader_id?: string
  channel?: string
  timestamp?: number
  duration?: number
  width?: number
  height?: number
  fps?: number
  view_count?: number
  like_count?: number
  comment_count?: number
  url?: string
  thumbnail?: string
  formats?: YtDlpFormat[]
}

interface YtDlpFormat {
  url?: string
  format_id?: string
  vcodec?: string
  acodec?: string
  ext?: string
  height?: number
  abr?: number
  protocol?: string
}

function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function s(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Best directly-downloadable mp4 the extractor found, and its sound when it has none. */
function pickMedia(j: YtDlpJson): { mediaUrl: string; audioUrl: string | null } | null {
  const formats = j.formats ?? []
  const viaHttp = (f: YtDlpFormat) => s(f.url) && (!f.protocol || f.protocol.startsWith('http'))
  const http = formats.filter((f) => viaHttp(f) && f.vcodec && f.vcodec !== 'none')
  // Instagram lists video-only DASH streams at the top resolutions. A file
  // without an audio track has nothing for Whisper (2026-09-03: ffmpeg
  // "does not contain any stream"), so prefer a muxed format.
  const muxed = http.filter((f) => f.acodec && f.acodec !== 'none')
  if (muxed.length > 0) {
    const best = muxed.sort((a, b) => (a.height ?? 0) - (b.height ?? 0)).pop()!
    return { mediaUrl: best.url!, audioUrl: null }
  }
  // YouTube stopped offering a muxed format for some Shorts (2026-10-03: 50
  // formats, none with both, so the desk took silent video and ffmpeg found
  // no audio three times). Take the video and the best audio-only stream and
  // let fetchMedia join them. AAC first, so the join is a copy; the "-drc"
  // variants are volume-squashed duplicates.
  const best = http.sort((a, b) => (a.height ?? 0) - (b.height ?? 0)).pop()
  const mediaUrl = best?.url ?? s(j.url)
  if (!mediaUrl) return null
  const audio = formats
    .filter((f) => viaHttp(f) && (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none')
    .sort((a, b) => rank(a) - rank(b))
    .pop()
  return { mediaUrl, audioUrl: audio?.url ?? null }
}

function rank(f: YtDlpFormat): number {
  const aac = f.ext === 'm4a' || /^mp4a/.test(f.acodec ?? '') ? 1_000_000 : 0
  const drc = /drc/.test(f.format_id ?? '') ? 0 : 100_000
  return aac + drc + (f.abr ?? 0)
}

/** Ask yt-dlp about one page. `label` only shapes the error wording. */
async function probeWithYtDlp(pageUrl: string, label: string): Promise<YtDlpJson> {
  let stdout: string
  try {
    const r = await execFileP(YT_DLP, ['-J', '--no-warnings', '--no-playlist', pageUrl], {
      timeout: 90_000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    })
    stdout = r.stdout
  } catch (e) {
    const err = e as { stderr?: string; killed?: boolean; message: string }
    const detail = (err.stderr ?? err.message ?? '').split('\n').find((l) => l.includes('ERROR')) ?? err.message
    if (err.killed) throw new ResolveError(`${label} resolver timed out`, 'upstream_failed')
    // yt-dlp's own wording for gone/private/blocked videos: terminal. Everything else retries.
    if (/not exist|unavailable|private|removed|no video in this post|members.only|age.restricted/i.test(detail)) {
      throw new ResolveError(detail.trim(), 'link_dead')
    }
    if (/login|rate.?limit|429|checkpoint|sign in|confirm you/i.test(detail)) {
      throw new ResolveError(`${label} wall: ${detail.trim()}`, 'upstream_failed')
    }
    throw new ResolveError(detail.trim() || 'yt-dlp failed', 'upstream_failed')
  }

  let j: YtDlpJson
  try {
    j = JSON.parse(stdout) as YtDlpJson
  } catch {
    throw new ResolveError('yt-dlp returned non-JSON', 'upstream_failed')
  }
  if (!j || typeof j !== 'object') throw new ResolveError('yt-dlp returned nothing', 'upstream_failed')
  return j
}

export async function resolveInstagram(pageUrl: string, shortcode: string): Promise<Resolved> {
  const j = await probeWithYtDlp(pageUrl, 'instagram')
  const media = pickMedia(j)
  if (!media) throw new ResolveError('no downloadable video format found', 'upstream_failed')

  const source: SourceRecord = {
    platform: 'instagram',
    videoId: shortcode,
    url: `https://www.instagram.com/reel/${shortcode}/`,
    authorHandle: s(j.uploader_id) ?? s(j.uploader) ?? s(j.channel),
    caption: s(j.description),
    postedAt: typeof j.timestamp === 'number' ? new Date(j.timestamp * 1000) : null,
    durationS: n(j.duration),
    width: null, // probe() fills these from the actual file
    height: null,
    fps: null,
    views: n(j.view_count),
    likes: n(j.like_count),
    comments: n(j.comment_count),
    shares: null, // IG does not expose these publicly, so null, never zero
    saves: null,
  }

  return { source, transient: { ...media, coverUrl: s(j.thumbnail), sizeBytes: null } }
}

/**
 * YouTube. The title carries the meaning here, where a YouTube description is
 * often a wall of links and chapter markers, so the caption is the title with
 * the description behind it rather than the description alone.
 */
export async function resolveYouTube(pageUrl: string, videoId: string): Promise<Resolved> {
  const j = await probeWithYtDlp(pageUrl, 'youtube')
  const media = pickMedia(j)
  if (!media) throw new ResolveError('no downloadable video format found', 'upstream_failed')

  const title = s(j.title)
  const description = s(j.description)
  const caption = title && description ? `${title}\n\n${description}` : (title ?? description)

  const source: SourceRecord = {
    platform: 'youtube',
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    authorHandle: s(j.uploader_id) ?? s(j.channel) ?? s(j.uploader),
    caption,
    postedAt: typeof j.timestamp === 'number' ? new Date(j.timestamp * 1000) : null,
    durationS: n(j.duration),
    width: null, // probe() fills these from the actual file
    height: null,
    fps: null,
    views: n(j.view_count),
    likes: n(j.like_count),
    comments: n(j.comment_count),
    shares: null, // YouTube publishes neither, so null, never zero
    saves: null,
  }

  return { source, transient: { ...media, coverUrl: s(j.thumbnail), sizeBytes: null } }
}
