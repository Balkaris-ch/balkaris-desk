import type { Platform, Resolved, SourceRecord, TransientMedia } from './types.ts'

/**
 * Link resolution.
 *
 * This is the fragile edge of the system. TikTok and Instagram do not expose
 * saved collections, and neither offers a public metadata API for arbitrary
 * videos, so we expand the share link ourselves and read what we can.
 *
 * Two things this file exists to get right:
 *   1. Return the canonical PAGE url for persistence, and keep the expiring CDN
 *      url in a separate `transient` object (see types.ts).
 *   2. Fail with a reason — as a ResolveError, always. Nothing here is allowed
 *      to escape as a raw TypeError/SyntaxError; the worker switches on
 *      `.reason` to decide retry vs. give-up.
 *
 * PACING (audit 2026-08-29): the free resolver tier allows 1 request/second and
 * answers faster calls with code:-1 "Free Api Limit". That reply is RETRYABLE,
 * never link_dead. Callers draining a batch must keep RESOLVER_MIN_INTERVAL_MS
 * between calls.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Minimum spacing between resolver calls (free tier: 1 req/s, plus margin). */
export const RESOLVER_MIN_INTERVAL_MS = 1100

export type ResolveReason =
  | 'unsupported_host'      // not a tiktok/instagram url at all
  | 'unsupported_platform'  // recognised platform we cannot resolve yet (instagram)
  | 'invalid_url'           // not parseable as a url
  | 'no_video_id'           // page url carries no recognisable video id
  | 'upstream_failed'       // transient: network, rate limit, resolver hiccup — RETRY
  | 'link_dead'             // the video itself is gone — terminal

export class ResolveError extends Error {
  constructor(message: string, readonly reason: ResolveReason) {
    super(message)
    this.name = 'ResolveError'
  }
}

/** Follow shortlink redirects (vm.tiktok.com, share urls) to the real page url. */
export async function expandUrl(input: string): Promise<string> {
  let target: string
  try {
    target = new URL(input.trim()).toString()
  } catch {
    throw new ResolveError(`not a valid url: ${input}`, 'invalid_url')
  }
  try {
    // Some hosts reject HEAD outright at the network level; a failed HEAD falls
    // through to GET. (An HTTP-level 405 still resolves — fetch follows
    // redirects first, and res.url is what we're after.)
    const res = await fetch(target, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'user-agent': UA },
    }).catch(() => null)
    if (res) return res.url || target
    const get = await fetch(target, { redirect: 'follow', headers: { 'user-agent': UA } })
    return get.url || target
  } catch (e) {
    throw new ResolveError(`could not reach ${target}: ${(e as Error).message}`, 'upstream_failed')
  }
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain)
}

export function classify(url: string): { platform: Platform; videoId: string } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new ResolveError(`not a valid url: ${url}`, 'invalid_url')
  }
  const host = u.hostname.replace(/^www\./, '')

  if (hostIs(host, 'tiktok.com')) {
    // /@handle/video/<id>  or  /v/<id>
    const m = u.pathname.match(/\/video\/(\d+)/) ?? u.pathname.match(/\/v\/(\d+)/)
    if (!m?.[1]) throw new ResolveError(`no tiktok video id in ${u.pathname}`, 'no_video_id')
    return { platform: 'tiktok', videoId: m[1] }
  }

  if (hostIs(host, 'instagram.com')) {
    // /reel/<shortcode>/ , /p/<shortcode>/ , /tv/<shortcode>/
    const m = u.pathname.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/)
    if (!m?.[1]) throw new ResolveError(`no instagram shortcode in ${u.pathname}`, 'no_video_id')
    return { platform: 'instagram', videoId: m[1] }
  }

  if (hostIs(host, 'youtube.com') || host === 'youtu.be' || hostIs(host, 'youtube-nocookie.com')) {
    // watch?v=ID | youtu.be/ID | /shorts/ID | /embed/ID | /live/ID
    const v = u.searchParams.get('v')
    const m = v ?? u.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{6,})/)?.[1] ?? (host === 'youtu.be' ? u.pathname.slice(1) : null)
    const id = (m ?? '').split('/')[0] ?? ''
    if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) throw new ResolveError(`no youtube video id in ${url}`, 'no_video_id')
    return { platform: 'youtube', videoId: id }
  }

  throw new ResolveError(`unsupported host: ${host}`, 'unsupported_host')
}

/** Canonical, non-expiring page url -- this is what gets persisted. */
export function canonicalUrl(platform: Platform, videoId: string, handle: string | null): string {
  if (platform === 'tiktok') {
    // The @i fallback is a working URL — verified live: TikTok resolves video
    // pages by id regardless of the handle segment.
    return `https://www.tiktok.com/@${handle ?? 'i'}/video/${videoId}`
  }
  if (platform === 'youtube') return `https://www.youtube.com/watch?v=${videoId}`
  return `https://www.instagram.com/reel/${videoId}/`
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function nonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Resolve a share link into persistable metadata plus a transient media url.
 *
 * The metadata hop currently goes through a third-party resolver (tikwm). That
 * is a known weak point — it is isolated behind this one function specifically
 * so it can be swapped for a first-party path without touching anything
 * downstream. It is also TikTok-only, which is why Instagram is refused
 * explicitly rather than laundered into a false "link dead".
 */
export async function resolve(input: string): Promise<Resolved> {
  const expanded = await expandUrl(input)
  const { platform, videoId } = classify(expanded)

  if (platform === 'instagram') {
    // Wired 2026-08-30 via yt-dlp (see resolve-ytdlp.ts). tikwm stays
    // TikTok-only — feeding it IG urls was the false-link_dead trap the first
    // audit caught.
    const { resolveInstagram } = await import('./resolve-ytdlp.ts')
    return resolveInstagram(expanded, videoId)
  }

  if (platform === 'youtube') {
    // Same extractor, different site. tikwm is TikTok-only and always was.
    const { resolveYouTube } = await import('./resolve-ytdlp.ts')
    return resolveYouTube(expanded, videoId)
  }

  const api = `https://www.tikwm.com/api/?url=${encodeURIComponent(expanded)}&hd=1`
  let res: Response
  try {
    res = await fetch(api, { headers: { 'user-agent': UA } })
  } catch (e) {
    throw new ResolveError(`resolver unreachable: ${(e as Error).message}`, 'upstream_failed')
  }
  if (!res.ok) throw new ResolveError(`resolver http ${res.status}`, 'upstream_failed')

  let body: { code?: number; msg?: string; data?: Record<string, unknown> }
  try {
    body = (await res.json()) as typeof body
  } catch {
    throw new ResolveError('resolver returned non-JSON', 'upstream_failed')
  }

  if (body.code !== 0 || !body.data) {
    const msg = body.msg ?? 'resolver returned no data'
    // Rate limiting and parse hiccups are transient. Only an explicit
    // gone-marker means the video is dead — everything else must stay
    // retryable, or batch ingestion rots the backlog with false link_dead rows
    // (reproduced live in the 2026-08-29 audit).
    if (/free api limit/i.test(msg)) throw new ResolveError(`resolver rate-limited: ${msg}`, 'upstream_failed')
    if (/(not exist|deleted|unavailable|removed|private)/i.test(msg)) throw new ResolveError(msg, 'link_dead')
    throw new ResolveError(msg, 'upstream_failed')
  }

  const d = body.data
  const author = (d.author ?? {}) as Record<string, unknown>
  const handle = nonEmpty(author.unique_id)

  const mediaUrl = nonEmpty(d.hdplay) ?? nonEmpty(d.play)
  if (!mediaUrl) throw new ResolveError('resolver returned no playable url', 'upstream_failed')

  const source: SourceRecord = {
    platform,
    videoId,
    url: canonicalUrl(platform, videoId, handle),
    authorHandle: handle,
    caption: nonEmpty(d.title),
    postedAt: typeof d.create_time === 'number' ? new Date(d.create_time * 1000) : null,
    durationS: num(d.duration),
    width: null, // filled by probe() -- the resolver's numbers are unreliable
    height: null,
    fps: null,
    views: num(d.play_count),
    likes: num(d.digg_count),
    comments: num(d.comment_count),
    shares: num(d.share_count),
    saves: num(d.collect_count),
  }

  const transient: TransientMedia = {
    mediaUrl,
    coverUrl: nonEmpty(d.origin_cover) ?? nonEmpty(d.cover),
    sizeBytes: num(d.hd_size) ?? num(d.size),
  }

  return { source, transient }
}
