import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { me, type Vars } from "../access.ts";
import { db, lastBeat } from "../../db.ts";
import { serviceName, TOPICS } from "../../catalogue.ts";
import { CLOSING_JOBS, FORMATS, isFormat, template, type ClosingJob, type TemplateId } from "../../templates.ts";
import { getPerson } from "../../people.ts";
import { clipFacts, clipPath, hasClip, hasCover } from "../../covers.ts";
import { watchFrom } from "../../watch.ts";
import { shownTitle } from "../operator/packs.ts";
import { cached, off, ok, reading, waiting } from "../store.ts";
import { scrub } from "../system.ts";
import type { ActivityItem, DayPoint, Range, Reading, Tone } from "../../../web/src/contract/common.ts";
import type {
  ArticleBlock,
  ArticleJob,
  ArticleMeta,
  ArticleOffers,
  ArticleOnSite,
  ArticlePayload,
  ArticleSource,
  ArticleTraffic,
  ArticleWork,
  LinkPayload,
  MetaLine,
  RepoState,
  SiteState,
  SourceFigures,
} from "../../../web/src/contract/article.ts";

/**
 * /api/v1/article — one article (GET /:id, a draft id) and one shared link
 * that has no article yet (GET /link/:id).
 *
 * The port of the old console's draft page and link page (src/console.ts
 * `draftPage` and `linkPage`) into the new frame: every fact those pages
 * show, read from the same rows, plus what the desk already knows and those
 * pages never said (the link's whole history, the workstation's jobs, the
 * file on the website's branch, the search listing).
 *
 * NOTHING HERE CHANGES ANYTHING. The actions stay the old console's form
 * handlers in src/server.ts (POST /draft/:id/<action>, /link/:id/retry), with
 * their own checks, because they are production code and decide who may
 * publish. This route only says which of them the old page would offer
 * (`offers`), under the old page's own conditions.
 *
 * Three panels have a source outside the desk's database, and each is read
 * on its own, so one that fails costs its panel:
 *
 *   traffic  GA4, the article's own address, from the day it went live
 *   repo     the website's main branch, through the desk's read copy
 *   meta     the live page as the crawl read it, or as the site builds it
 *
 * The collectors are imported when the panel is read rather than at the top
 * of this file, so a collector that fails to load costs its panel and not the
 * article.
 */
export const routes = new Hono<Vars>();

/**
 * A collector, loaded when its panel is read. If it does not load, that panel
 * says so in plain words (the error, which names files on the server, goes to
 * the log) and the rest of the article is drawn.
 */
async function collector<M>(name: string, load: () => Promise<M>): Promise<M | null> {
  try {
    return await load();
  } catch (e) {
    console.error(`article: the ${name} did not load:`, e);
    return null;
  }
}
const NOT_LOADED = (what: string): string => `The desk's ${what} did not load, so this was not read. The reason is in the desk's log.`;

/** Where a published article lives, as src/server.ts says it. */
const SITE_BASE = (process.env.SITE_BASE ?? "https://www.balkaris.ch").replace(/\/$/, "");

/** A workstation that asked for work within this long is awake (the old console's own rule). */
const AWAKE_MS = 5 * 60_000;

/* ---------- rows ----------------------------------------------------------- */

interface DraftRow {
  id: number;
  link_id: number;
  slug: string;
  post: string;
  template: string;
  model: string | null;
  ms: number | null;
  state: string;
  published_sha: string | null;
  created_at: string;
  echo: string | null;
  closing: string | null;
  cover_alt: string | null;
  cover_caption: string | null;
}

interface LinkRow {
  id: number;
  url: string;
  from_user: number | null;
  from_name: string | null;
  note: string | null;
  title: string | null;
  site: string | null;
  author: string | null;
  words: number | null;
  topic: string | null;
  services: string | null;
  state: string;
  error: string | null;
  created_at: string;
  kind: string;
  platform: string | null;
  posted_at: string | null;
  captured_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  duration_s: number | null;
  slides: number | null;
  attach: number | null;
  format: string | null;
}

interface JobRow {
  id: number;
  kind: string;
  state: string;
  attempts: number;
  error: string | null;
  created_at: string;
  taken_at: string | null;
  finished_at: string | null;
  not_before: string | null;
  payload: string | null;
}

interface EventRow {
  id: number;
  what: string;
  detail: string | null;
  at: string;
}

/** What a draft's `post` column holds: the site's Post, before publish adds the rest. */
interface StoredPost {
  slug?: string;
  title?: string;
  standfirst?: string;
  excerpt?: string;
  readingTime?: number;
  topics?: string[];
  services?: string[];
  body?: ArticleBlock[];
  takeaways?: string[];
  faq?: { q: string; a: string }[];
}

/** An id from the address: a whole positive number, or a 404 in words. */
function idOf(raw: string, what: string): number {
  const id = Number(raw);
  if (!/^\d{1,9}$/.test(raw) || !Number.isSafeInteger(id) || id <= 0) throw new HTTPException(404, { message: `There is no ${what} ${raw}.` });
  return id;
}

/**
 * The database's own "YYYY-MM-DD HH:MM:SS" (UTC, from datetime('now')) or an
 * ISO time from the workstation, as ISO. Null for anything else.
 */
function iso(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? Date.parse(`${s.replace(" ", "T")}Z`) : Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** JSON from a column, or null when it is not JSON (older rows hold plain sentences). */
function json<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

const topicOf = (id: string | null | undefined): { id: string; name: string } | null => {
  if (!id) return null;
  const t = TOPICS.find((x) => x.id === id);
  return { id, name: t?.name ?? id };
};

const servicesOf = (slugs: unknown): { slug: string; name: string }[] =>
  (Array.isArray(slugs) ? slugs : []).filter((s): s is string => typeof s === "string").map((slug) => ({ slug, name: serviceName(slug) }));

const draftRow = (id: number): DraftRow | undefined => db.prepare("SELECT * FROM drafts WHERE id = ?").get(id) as DraftRow | undefined;
const linkRow = (id: number): LinkRow | undefined => db.prepare("SELECT * FROM links WHERE id = ?").get(id) as LinkRow | undefined;

/* ---------- who shared it, and from where ---------------------------------- */

/**
 * Why a social post's figures are not there, by the job that reads the post:
 * waiting for the workstation, given up on, never asked for, or read without
 * them. "Try it again" is named only where it is offered: on a link with no
 * article (the link page's own condition, below).
 */
function unread(linkId: number, hasDraft: boolean): string {
  const ingest = db.prepare("SELECT state FROM jobs WHERE link_id = ? AND kind = 'ingest' ORDER BY id DESC LIMIT 1").get(linkId) as { state: string } | undefined;
  const again = hasDraft ? "" : " Try it again queues it once more.";
  if (ingest?.state === "queued" || ingest?.state === "running") return "The post has not been read yet: the workstation reads its figures when it takes the job.";
  if (ingest?.state === "stuck") return `The workstation could not read the post and gave up (see Workstation).${again}`;
  if (!ingest) return `The post has not been read, and nothing is queued to read it.${again}`;
  return "The workstation read the post and sent no figures with it.";
}

function sourceOf(l: LinkRow, hasDraft: boolean): ArticleSource {
  const sharer = l.from_user ? getPerson(l.from_user) : null;
  const social = l.kind !== "article";
  let figures: Reading<SourceFigures> | null = null;
  if (social) {
    const at = iso(l.captured_at);
    figures = at
      ? ok(
          { views: l.views, likes: l.likes, comments: l.comments, shares: l.shares, saves: l.saves },
          "desk",
          at,
          "The source's own public numbers at the moment the desk read it. A dash is a figure the platform does not publish (Instagram gives no shares or saves), never a zero.",
        )
      : waiting("desk", unread(l.id, hasDraft));
  }
  return {
    linkId: l.id,
    url: l.url,
    kind: l.kind,
    platform: l.platform,
    site: l.site,
    author: l.author,
    title: l.title,
    postedAt: iso(l.posted_at),
    capturedAt: iso(l.captured_at),
    sharedAt: iso(l.created_at) ?? l.created_at,
    sharedBy: sharer?.name ?? l.from_name ?? null,
    note: l.note?.trim() || null,
    words: l.words,
    durationS: l.duration_s,
    slides: l.slides,
    topic: topicOf(l.topic),
    services: servicesOf(json<string[]>(l.services)),
    figures,
  };
}

/* ---------- the workstation's jobs ----------------------------------------- */

function workOf(linkId: number): ArticleWork {
  const jobs = (db.prepare("SELECT * FROM jobs WHERE link_id = ? ORDER BY id DESC LIMIT 40").all(linkId) as unknown as JobRow[]).map(
    (j): ArticleJob => ({
      id: j.id,
      kind: j.kind,
      state: j.state,
      attempts: j.attempts,
      error: j.error ? scrub(j.error).slice(0, 600) : null,
      createdAt: iso(j.created_at) ?? j.created_at,
      takenAt: iso(j.taken_at),
      finishedAt: iso(j.finished_at),
      notBefore: iso(j.not_before),
    }),
  );
  const seen = iso(lastBeat());
  return { jobs, workstation: { lastSeen: seen, awake: seen !== null && Date.now() - Date.parse(seen) < AWAKE_MS } };
}

/** The newest job of a kind for one draft that has not finished, as `{ state, error }`. */
function openJob(linkId: number, kind: string, draftId: number): { state: string; error: string | null } | null {
  const rows = db.prepare("SELECT * FROM jobs WHERE link_id = ? AND kind = ? ORDER BY id DESC").all(linkId, kind) as unknown as JobRow[];
  const mine = rows.find((j) => json<{ draft?: number }>(j.payload)?.draft === draftId);
  if (!mine || mine.state === "done") return null;
  return { state: mine.state, error: mine.error ? scrub(mine.error).slice(0, 400) : null };
}

/* ---------- the history ---------------------------------------------------- */

type Detail = Record<string, unknown>;
const PLATFORMS: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", linkedin: "LinkedIn" };
const platformName = (p: string): string => PLATFORMS[p.toLowerCase()] ?? p;
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const kinds: Record<string, string> = { ingest: "read the post", write: "write the article", cover: "draw the cover", clip: "cut the silent clip", reclose: "write a different ending" };
const jobWords = (k: unknown): string => kinds[str(k)] ?? `the ${str(k) || "a"} job`;
const actionWords: Record<string, string> = {
  publish: "Put on the site, unlisted",
  list: "Published: into the menus, the sitemap and search",
  unlist: "Taken out of the menus",
  remove: "Taken off the site",
};

/**
 * One row of the events log, in words. The log is the desk's own: what each
 * name means is read from the code that writes it (src/server.ts, intake.ts,
 * publish.ts). A name this does not know is shown as it is, never dropped.
 */
function said(e: EventRow): Omit<ActivityItem, "id" | "at" | "kind"> {
  const d = json<Detail>(e.detail);
  const plain = d === null && e.detail ? e.detail : "";
  const by = str(d?.by) || undefined;
  const sha = str(d?.sha);
  const why = str(d?.why) || plain;
  switch (e.what) {
    case "link.taken":
      return { tone: "info", text: "Shared with the desk", detail: [d?.words ? `${str(d.words)} words read` : "", d?.format ? `asked for ${str(d.format)}` : ""].filter(Boolean).join(" · ") || undefined };
    case "link.social":
      return { tone: "info", text: "Shared with the desk, as a social post", detail: d?.format ? `asked for ${str(d.format)}` : undefined };
    case "link.duplicate":
      return { tone: "quiet", text: "Shared again: the desk already had it" };
    case "link.unreadable":
      return { tone: "bad", text: "Could not be read", detail: why || undefined };
    case "link.format": {
      const f = d?.format;
      return { tone: "info", text: `Format chosen: ${isFormat(f) ? FORMATS[f].button : str(f)}`, actor: by };
    }
    case "link.ingested": {
      const m = (d?.metrics ?? {}) as Detail;
      const figs = ["views", "likes", "comments", "shares", "saves"].filter((k) => typeof m[k] === "number").map((k) => `${Number(m[k]).toLocaleString("en-GB")} ${k}`);
      return { tone: "good", text: `Read the ${str(d?.kind) || "post"}${d?.platform ? ` on ${platformName(str(d.platform))}` : ""}`, detail: [d?.words ? `${str(d.words)} words` : "", ...figs].filter(Boolean).join(" · ") || undefined };
    }
    case "link.retried":
      return { tone: "info", text: "Asked to try again" };
    case "job.taken":
      return { tone: "quiet", text: `The workstation took the job to ${jobWords(d?.kind)}`, detail: d?.job ? `job ${str(d.job)}` : undefined };
    case "job.done":
      return { tone: "good", text: "Job finished", detail: d?.job ? `job ${str(d.job)}` : undefined };
    case "job.failed":
      return { tone: d?.gaveUp ? "bad" : "warn", text: d?.gaveUp ? "The job failed for the last time and was parked as stuck" : "The job failed", detail: [why, d?.attempt ? `attempt ${str(d.attempt)}` : ""].filter(Boolean).join(" · ") || undefined };
    case "draft.echo":
      return { tone: "warn", text: "Ends like another article", detail: d?.slug ? `like ${str(d.slug)}` : undefined };
    case "cover.drawn":
      return { tone: "good", text: "Cover drawn" };
    case "cover.redraw.queued":
      return { tone: "info", text: "Another cover asked for", detail: str(d?.why) || undefined };
    case "cover.pushed":
      return { tone: "good", text: "The new picture was pushed to the site", detail: sha ? `commit ${sha}` : undefined, actor: by };
    case "cover.push.failed":
      return { tone: "bad", text: "The new picture did not reach the site", detail: why || undefined };
    case "preview.kept":
      return { tone: "good", text: "Silent clip cut", detail: [d?.seconds ? `${str(d.seconds)} seconds` : "", d?.kb ? `${str(d.kb)} KB` : ""].filter(Boolean).join(" · ") || undefined };
    case "clip.queued":
      return { tone: "info", text: "The silent clip asked for again" };
    case "watch.attach":
      return { tone: "info", text: d?.attach === 0 ? "Set to just the text, no video" : "Set to attach the video" };
    case "watch.pushed":
      return { tone: "good", text: "The video choice was pushed to the site", detail: sha ? `commit ${sha}` : undefined };
    case "watch.push.failed":
      return { tone: "bad", text: "The video choice did not reach the site", detail: why || undefined };
    case "auto.published":
      return { tone: "good", text: "Published by itself, as soon as the cover was drawn", detail: sha ? `commit ${sha}` : undefined, actor: by };
    case "auto.nobody":
      return { tone: "warn", text: "Written, with nobody to publish it as: no one has an email on the desk" };
    case "auto.failed":
      return { tone: "bad", text: "Written, and the automatic publish did not go out", detail: why || undefined };
    case "publish.pushed": {
      const pushed: Record<string, string> = { publish: "live, unlisted", list: "listed", unlist: "unlisted", remove: "taken off" };
      return { tone: "quiet", text: `Pushed to the website: ${pushed[str(d?.action)] ?? (str(d?.action) || "a change")}`, detail: sha ? `commit ${sha}` : undefined };
    }
    case "publish.nochange":
      return { tone: "quiet", text: "Nothing to push: the website already said this" };
    case "draft.publish":
    case "draft.list":
    case "draft.unlist":
    case "draft.remove":
      return { tone: e.what === "draft.remove" ? "warn" : "good", text: actionWords[e.what.slice(6)] ?? e.what, detail: sha ? `commit ${sha}` : undefined, actor: by };
    case "draft.publish.failed":
    case "draft.list.failed":
    case "draft.unlist.failed":
    case "draft.remove.failed":
      return { tone: "bad", text: `${actionWords[e.what.slice(6, -7)] ?? e.what}: the push did not go through`, detail: why || undefined };
    case "draft.removed":
      return { tone: "warn", text: "Draft deleted; the link stays", detail: d?.slug ? str(d.slug) : undefined };
    case "draft.reclose.queued":
      return { tone: "info", text: "A different ending asked for", detail: d?.job ? str(d.job) : undefined };
    default:
      return { tone: "quiet", text: e.what, detail: (plain || (e.detail ?? "")).slice(0, 200) || undefined };
  }
}

function historyOf(linkId: number): ActivityItem[] {
  return (db.prepare("SELECT id, what, detail, at FROM events WHERE link_id = ? ORDER BY id DESC LIMIT 120").all(linkId) as unknown as EventRow[]).map((e) => {
    const s = said(e);
    return {
      id: e.id,
      at: iso(e.at) ?? e.at,
      kind: e.what,
      tone: s.tone as Tone,
      text: scrub(s.text),
      ...(s.detail ? { detail: scrub(s.detail).slice(0, 400) } : {}),
      ...(s.actor ? { actor: s.actor } : {}),
    };
  });
}

/* ---------- where it is on the site ----------------------------------------- */

/**
 * The desk's record (drafts.state) and its log of pushes. Every push the
 * publisher makes is logged as `publish.pushed` with the draft's id and the
 * action, the automatic publish included, so the log can say when it first
 * went live and whether the last push for it took it down.
 */
function siteOf(d: DraftRow): Omit<ArticleOnSite, "repo"> {
  const pushes = (db.prepare("SELECT id, what, detail, at FROM events WHERE link_id = ? AND what = 'publish.pushed' ORDER BY id").all(d.link_id) as unknown as EventRow[])
    .map((e) => ({ at: iso(e.at), d: json<Detail>(e.detail) }))
    .filter((p) => p.d && (p.d.draft === d.id || (p.d.draft === undefined && p.d.slug === d.slug)));
  const firstLive = pushes.find((p) => p.d!.action === "publish" || p.d!.action === "list");
  const last = pushes.at(-1);
  const state: SiteState = d.state === "listed" ? "listed" : d.state === "unlisted" ? "unlisted" : last?.d!.action === "remove" ? "down" : "draft";
  return { state, url: `${SITE_BASE}/insights/${d.slug}`, liveSince: firstLive?.at ?? null, publishedSha: d.published_sha };
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,200}$/;

/** The article's file on the website's main branch, through the desk's read copy (src/cc/site/repo.ts). */
async function repoOf(slug: string): Promise<Reading<RepoState>> {
  return reading("repo", async () => {
    if (!SLUG.test(slug)) return off("repo", "This draft's address is not one the website could have a file for.");
    const site = await collector("website reader", () => import("../site/index.ts"));
    if (!site) return waiting("repo", NOT_LOADED("website reader"));
    if (!site.readCopyExists()) {
      return off("repo", "The desk has no read copy of the website's repository yet.", "Nothing to set up: the repository job makes the copy on its next run. If it keeps failing, its reason is under Automations.");
    }
    const file = `content/posts/${slug}.ts`;
    /* Kept for five minutes, the fetch's own interval: a local read, but it
       waits behind a fetch in the repository's one queue. */
    const got = await cached(`article:repo2:${slug}`, 5 * 60_000, async (): Promise<RepoState> => {
      const text = await site.repoRead(file);
      const change = await site.lastChange(file);
      return {
        file: text === null ? "absent" : /^\s*listed:\s*true\s*,/m.test(text) ? "listed" : "unlisted",
        /* The publisher writes `clip: "/insights/<slug>-clip.mp4",` into the
           watch block only when it pushed the clip (src/publish.ts
           articleFile); a JSON key in the body would be quoted. */
        clip: text !== null && /^\s*clip:\s*"\/insights\//m.test(text),
        lastCommit: change ? { ...change, url: site.commitUrl(change.sha) } : null,
      };
    });
    const fetched = site.repoFetchedAt();
    return ok(
      got.value,
      "repo",
      got.at,
      `The website's main branch as the desk last fetched it${fetched ? ` (${fetched.slice(0, 16).replace("T", " ")} UTC)` : ""}.${got.stale ? ` Not refreshed: ${got.error}` : ""}`,
    );
  });
}

/* ---------- the search listing ---------------------------------------------- */


/**
 * The website's own `fitDescription` (lib/seo.tsx), copied: the excerpt ended
 * at the last sentence that fits about 158 characters, or the last whole word
 * with an ellipsis. If the site's rule changes, this copy must follow it.
 */
function fitDescription(text: string, room = 158): string {
  const whole = text.replace(/\s+/g, " ").trim();
  if (whole.length <= room) return whole;
  const within = whole.slice(0, room + 1);
  const sentence = Math.max(within.lastIndexOf(". "), within.lastIndexOf("? "), within.lastIndexOf("! "));
  if (sentence >= room * 0.6) return whole.slice(0, sentence + 1);
  const words = whole.slice(0, room - 1).replace(/\s+\S*$/, "").replace(/[\s,;:–—-]+$/, "");
  return `${words}…`;
}

/** An approved line from content/desk/overrides.json, with the site's own limits (lib/desk.ts). */
const approvedText = (v: unknown, most: number): string | undefined => (typeof v === "string" && v.trim().length > 0 && v.length <= most ? v.trim() : undefined);

/**
 * The title and description a search result shows. A live page that the
 * crawl has read: what it said. Otherwise worked out as the website builds
 * it: the desk writes metaTitle as the title's first 70 characters and
 * metaDescription as the excerpt's first 160, the site reads back the whole
 * title and fits the excerpt (app/(site)/insights/[slug]/page.tsx), and a
 * title or description approved on the desk replaces either.
 */
async function metaOf(d: DraftRow, post: StoredPost, state: SiteState): Promise<Reading<ArticleMeta>> {
  return reading("desk", async () => {
    const site = await collector("website reader", () => import("../site/index.ts"));
    if (!site) return waiting("crawl", NOT_LOADED("website reader"));
    const { title: titleLimit, description: descLimit } = site.LIMITS;
    const line = (text: string, limit: number): MetaLine => ({ text, length: [...text].length, limit });
    const path = `/insights/${d.slug}`;

    if (state === "unlisted" || state === "listed") {
      const live = site.page(path);
      if (live.state === "ok" && live.value.status === 200 && live.value.title) {
        return ok<ArticleMeta>(
          { title: line(live.value.title, titleLimit), description: line(live.value.description ?? "", descLimit), from: "live" },
          "crawl",
          live.asOf,
          "As the live page stated it at the desk's last crawl. The limits are the desk's working yardsticks: Google cuts a title by its width.",
        );
      }
    }

    let approved: { title?: string; description?: string } = {};
    if (site.readCopyExists()) {
      try {
        /* Kept for five minutes like the article's own file (repoOf): a local
           read, but it waits behind a fetch in the repository's one queue. */
        const meta = (
          await cached("article:overrides:meta", 5 * 60_000, async () => json<{ meta?: Record<string, unknown> }>(await site.repoRead("content/desk/overrides.json"))?.meta ?? {})
        ).value;
        const entry = meta[path];
        if (entry && typeof entry === "object") {
          const e = entry as Detail;
          approved = { title: approvedText(e.title, 110), description: approvedText(e.description, 300) };
        }
      } catch {
        /* An unreadable overrides file is read by the site as none, too. */
      }
    }
    const title = approved.title ?? post.title ?? "";
    const description = approved.description ?? fitDescription(post.excerpt ?? "");
    return ok<ArticleMeta>(
      /* As the website shows it: the brand after the title where both fit (operator/packs.ts shownTitle). */
      { title: line(shownTitle(title), titleLimit), description: line(description, descLimit), from: approved.title || approved.description ? "approved" : "built" },
      "desk",
      Date.now(),
      "Worked out the way the website builds it, from the draft and any title or description approved on the desk. The limits are the desk's working yardsticks: Google cuts a title by its width.",
    );
  });
}

/* ---------- readers ----------------------------------------------------------- */

const DAY_MS = 86_400_000;
const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);

/**
 * The article's own readers in GA4, over the range, counted from the day it
 * went live when that is later, and from the day the website's measurement
 * began when that is later still: a day before either is not a zero, it was
 * never counted. The period ends today, so its last two days are provisional.
 */
async function trafficOf(slug: string, site: Omit<ArticleOnSite, "repo">, range: Range): Promise<Reading<ArticleTraffic>> {
  if (site.state === "draft" && !site.liveSince) {
    return off("ga4", "It has never been on the site, so nobody has read it there.", "Putting it on the site, even unlisted, is what lets GA4 count its readers.");
  }
  return reading("ga4", async () => {
    const ga4 = await collector("GA4 reader", () => import("../ga4.ts"));
    if (!ga4) return waiting("ga4", NOT_LOADED("GA4 reader"));
    const dates = ga4.rangeDates(ga4.gaRange(range), "today");
    const path = `/insights/${slug}`;
    const filter = ga4.where.among("pagePath", [path, `${path}/`]);
    const since = await ga4.measuredSince();
    const liveDay = site.liveSince ? new Intl.DateTimeFormat("en-CA", { timeZone: ga4.zone() }).format(new Date(site.liveSince)) : null;

    if (since === null) {
      /* No key, or nothing measured yet: one cheap question says which. */
      const probe = ga4.asReading(await ga4.report({ metrics: ["screenPageViews"], dateRanges: [{ startDate: dates.today, endDate: dates.today }], dimensionFilter: filter }, { screen: true }));
      if (probe.state !== "ok") return probe;
      return waiting("ga4", "GA4 has recorded nothing for the website yet.");
    }

    const floor = since > dates.current.start ? since : dates.current.start;
    const fromLive = liveDay !== null && liveDay > floor;
    const start = fromLive ? liveDay! : floor;
    const end = dates.today;
    if (start > end) return waiting("ga4", "It went live after the last day GA4 has counted.");

    const span = [{ startDate: start, endDate: end }];
    const [perDay, whole] = await Promise.all([
      ga4.report({ dimensions: ["date"], metrics: ["screenPageViews"], dateRanges: span, dimensionFilter: filter, limit: 500 }, { screen: true }),
      ga4.report({ metrics: ["screenPageViews", "activeUsers", "userEngagementDuration"], dateRanges: span, dimensionFilter: filter }, { screen: true }),
    ]);
    for (const r of [perDay, whole]) {
      const said = ga4.asReading(r);
      if (said.state !== "ok") return said;
    }
    if (perDay.data === null || whole.data === null) return waiting("ga4", "GA4 did not answer.");

    const views = new Map<string, number>();
    for (const r of perDay.data.rows) views.set(String(r.date), Number(r.screenPageViews ?? 0));
    const days: DayPoint[] = [];
    for (let day = start; day <= end; day = shift(day, 1)) days.push({ date: day, value: views.get(day) ?? 0 });
    const t = whole.data.rows[0] ?? {};

    return ga4.asReading({
      data: {
        start,
        end,
        fromLive,
        rangeStart: dates.current.start,
        views: Number(t.screenPageViews ?? 0),
        people: Number(t.activeUsers ?? 0),
        engagementSeconds: Number(t.userEngagementDuration ?? 0),
        days,
        provisionalFrom: shift(dates.today, -1),
      } satisfies ArticleTraffic,
      at: Math.min(perDay.at ?? Date.now(), whole.at ?? Date.now()),
      source: "ga4",
      ...(perDay.stale || whole.stale ? { stale: true, error: perDay.error ?? whole.error } : {}),
    });
  });
}

/* ---------- the two answers -------------------------------------------------------- */

const RANGES: Range[] = ["7d", "30d", "90d", "1y"];
const rangeOf = (raw: string | undefined): Range => (RANGES.includes(raw as Range) ? (raw as Range) : "30d");

const stateOf = (s: string): SiteState => (s === "listed" ? "listed" : s === "unlisted" ? "unlisted" : "draft");

routes.get("/:id", async (c) => {
  const id = idOf(c.req.param("id"), "draft");
  const d = draftRow(id);
  if (!d) throw new HTTPException(404, { message: `There is no draft ${id}. It may have been deleted; its link stays on the desk.` });
  const l = linkRow(d.link_id);
  if (!l) throw new HTTPException(404, { message: `Draft ${id} has lost its link.` });

  const range = rangeOf(c.req.query("range"));
  const who = me(c);
  const post = json<StoredPost>(d.post) ?? {};
  const where = siteOf(d);

  /* The old page's own conditions (src/console.ts draftPage). `onSite` is
     its three states: a taken-down article is a draft again there. */
  const onSite = stateOf(d.state);
  const offers: ArticleOffers = {
    canPublish: who.canPublish,
    site: !who.canPublish ? [] : onSite === "draft" ? ["publish"] : onSite === "unlisted" ? ["list", "takedown"] : ["unlist", "takedown"],
    redraw: Boolean(d.cover_alt),
    video: l.kind === "video",
    remove: onSite === "draft",
  };

  const [repo, traffic, meta] = await Promise.all([repoOf(d.slug), trafficOf(d.slug, where, range), metaOf(d, post, where.state)]);

  const tpl = (() => {
    try {
      return template(d.template as TemplateId)?.name ?? null;
    } catch {
      return null;
    }
  })();
  const closing = d.closing && d.closing in CLOSING_JOBS ? { id: d.closing, name: CLOSING_JOBS[d.closing as ClosingJob].name } : d.closing ? { id: d.closing, name: d.closing } : null;

  const siblings = (db.prepare("SELECT id, post, state, created_at FROM drafts WHERE link_id = ? AND id <> ? ORDER BY id DESC").all(d.link_id, d.id) as unknown as Pick<DraftRow, "id" | "post" | "state" | "created_at">[]).map((s) => ({
    id: s.id,
    title: json<StoredPost>(s.post)?.title ?? `Draft ${s.id}`,
    state: stateOf(s.state),
    writtenAt: iso(s.created_at) ?? s.created_at,
  }));

  const payload: ArticlePayload = {
    draftId: d.id,
    range,
    article: {
      slug: d.slug,
      title: post.title ?? d.slug,
      standfirst: post.standfirst ?? "",
      excerpt: post.excerpt ?? "",
      readingTime: typeof post.readingTime === "number" ? post.readingTime : null,
      topics: (post.topics ?? []).map((t) => topicOf(t)!).filter(Boolean),
      services: servicesOf(post.services),
      body: Array.isArray(post.body) ? post.body : [],
      takeaways: Array.isArray(post.takeaways) ? post.takeaways : [],
      faq: Array.isArray(post.faq) ? post.faq : [],
    },
    cover: d.cover_alt && hasCover(d.slug) ? { src: `/cover/${d.slug}.webp`, alt: d.cover_alt, caption: d.cover_caption } : null,
    coverJob: openJob(l.id, "cover", d.id),
    video:
      l.kind === "video"
        ? {
            attached: l.attach !== 0,
            plays: Boolean(watchFrom({ ...l, attach: l.attach ?? 1 })),
            platform: l.platform,
            /* As the publisher decides it: all three files, or none ships. */
            held: hasClip(d.slug) && clipPath(d.slug) !== null,
            clip: clipFacts(d.slug),
            clipJob: openJob(l.id, "clip", d.id),
          }
        : null,
    site: { ...where, repo },
    source: sourceOf(l, true),
    writing: {
      format: isFormat(l.format) ? { id: l.format, name: FORMATS[l.format].button } : null,
      template: { id: d.template, name: tpl },
      model: d.model,
      ms: d.ms,
      closing,
      echo: d.echo,
      writtenAt: iso(d.created_at) ?? d.created_at,
    },
    traffic,
    meta,
    work: workOf(l.id),
    history: historyOf(l.id),
    siblings,
    offers,
  };
  return c.json(payload);
});

routes.get("/link/:id", (c) => {
  const id = idOf(c.req.param("id"), "link");
  const l = linkRow(id);
  if (!l) throw new HTTPException(404, { message: `There is no link ${id}.` });

  const newest = db.prepare("SELECT id, post, state FROM drafts WHERE link_id = ? ORDER BY id DESC LIMIT 1").get(id) as Pick<DraftRow, "id" | "post" | "state"> | undefined;
  const payload: LinkPayload = {
    linkId: l.id,
    state: l.state,
    error: l.error ? scrub(l.error) : null,
    source: sourceOf(l, Boolean(newest)),
    draft: newest ? { id: newest.id, title: json<StoredPost>(newest.post)?.title ?? `Draft ${newest.id}`, state: stateOf(newest.state) } : null,
    work: workOf(l.id),
    history: historyOf(l.id),
    /* The old link page always offers it, and the old list only ever leads
       there for a link with no draft. Offered here on that same condition:
       on a link that has an article, "try again" would write a second one. */
    offers: { retry: !newest },
  };
  return c.json(payload);
});
