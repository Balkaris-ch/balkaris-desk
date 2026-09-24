import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { classify, expandUrl, resolve } from "./social/resolve.ts";
import { download, probe } from "./social/media.ts";
import { makePreview } from "./social/preview.ts";
import { draft, type DraftInput } from "./draft.ts";
import { health, WRITE_MODEL } from "./llm.ts";
import { match } from "./match.ts";
import { takeSocial } from "./social/pipeline.ts";
import { proseOf } from "./blocks.ts";
import { cover } from "./cover.ts";
import { ensureFor, ensureOllama, release } from "./ensure.ts";
import type { TopicId } from "./catalogue.ts";

/**
 * The workstation's half. Run this on the machine with the 4090.
 *
 * It POLLS OUT to desk.balkaris.ch and nothing ever reaches in: no port
 * forward, no tunnel, no inbound anything. Close the lid and the desk carries
 * on taking links; open it and the queue drains. That is the whole
 * arrangement, and it is why the box can be a 3.7 GB VM with no GPU.
 *
 * It is deliberately stupid. It asks for a job, does it, posts the result,
 * asks again. No state of its own, no database, nothing to back up. If it
 * dies mid-job the box hands that job to the next runner after thirty
 * minutes (db.ts `reclaim`), so the worst case is one article written twice.
 *
 *   npm run runner            poll forever
 *   npm run runner -- --once  take one job and stop, which is how it is tested
 */

const DESK = (process.env.DESK_URL ?? "https://desk.balkaris.ch").replace(/\/$/, "");
const NAME = process.env.RUNNER_NAME ?? "workstation";

/* The secret lives in the secrets folder, not in this repo's .env, so the
   same file serves the runner and deploy/mint-secrets.sh. */
function secret(): string {
  const inline = process.env.DESK_RUNNER_SECRET;
  if (inline) return inline.trim();
  const path = process.env.DESK_RUNNER_SECRET_FILE ?? "E:/Balkaris/secrets/desk-runner-secret.txt";
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(`no runner secret: set DESK_RUNNER_SECRET or put it at ${path}`);
  }
}

const SECRET = secret();

/** Quiet when there is nothing, patient when the box is down. */
const IDLE_MS = 20_000;
const DOWN_MS = 60_000;

interface Job {
  id: number;
  kind: string;
  attempt: number;
  payload?: { draft?: number; job?: string };
}

interface LinkRow {
  id: number;
  url: string;
  title: string;
  site: string;
  author: string | null;
  published: string | null;
  words: number;
  topic: string;
  services: string;
  body: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${DESK}/runner${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw new Error("the desk refused the runner secret — re-run deploy/mint-secrets.sh");
  if (!res.ok) throw new Error(`desk answered ${res.status}`);
  return (await res.json()) as T;
}

async function doWrite(link: LinkRow): Promise<Record<string, unknown>> {
  const input: DraftInput = {
    url: link.url,
    title: link.title,
    site: link.site,
    author: link.author,
    published: link.published,
    words: link.words,
    text: link.body,
    topic: link.topic as TopicId,
    services: JSON.parse(link.services || "[]") as string[],
  };

  const out = await draft(input);
  console.log(
    `  wrote "${out.post.title}" — ${out.template} (${out.because}), ends on ${out.closing.job} (${out.closing.because}), ${out.post.readingTime} min, ${Math.round(out.ms / 1000)}s`,
  );
  return {
    ok: true,
    slug: out.post.slug,
    post: out.post,
    template: out.template,
    model: out.model,
    ms: out.ms,
    closing: out.closing.job,
  };
}

/**
 * A social link: resolve it, get the substance out of it, and write it — all
 * in one pass, because the expensive half is fetching the media and doing it
 * twice doubles that.
 *
 * The matcher runs HERE rather than on the box for these, because there is
 * nothing to match until there is a transcript. It is the same hard-coded
 * table either way; only the moment differs.
 */
async function doIngest(link: LinkRow): Promise<Record<string, unknown>> {
  const got = await takeSocial(link.url);
  console.log(
    `  ${got.shape} on ${got.platform}${got.author ? ` by ${got.author}` : ""} — ${got.words} words` +
      (got.slides ? `, ${got.slides} slides` : "") +
      (got.preview
        ? `, ${Math.round(got.preview.clip.length / 1024)}KB clip (${got.preview.whole ? "all of it" : `first ${got.preview.seconds}s`})`
        : "") +
      (got.spoke === "music" ? ", found only on the second Whisper pass (it is carried by a song)" : ""),
  );

  const m = match(got.title, got.text);
  const services = m.services.map((s) => s.slug);

  /* A social post is credited by its handle and its platform, not by a
     hostname. The guard is told to look for the handle, because that is what
     the model will actually write. */
  const PLATFORM = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", file: "a file" } as const;
  const where = PLATFORM[got.platform];

  const out = await draft({
    url: got.url,
    title: got.title,
    site: got.author ? `${got.author} on ${got.platform}` : got.platform,
    author: got.author,
    published: got.postedAt,
    words: got.words,
    text: got.text,
    topic: m.topic,
    services,
    publication: got.author ? `@${got.author} on ${where}` : where,
    credit: got.author ?? where,
  });

  console.log(
    `  wrote "${out.post.title}" — ${out.template} (${out.because}), ends on ${out.closing.job} (${out.closing.because}), ${out.post.readingTime} min, ${Math.round(out.ms / 1000)}s`,
  );

  return {
    ok: true,
    slug: out.post.slug,
    post: out.post,
    template: out.template,
    model: out.model,
    ms: out.ms,
    closing: out.closing.job,
    /* Everything the box could not know until the media was in hand. */
    source: {
      kind: got.shape,
      platform: got.platform,
      url: got.url,
      title: got.title,
      author: got.author,
      words: got.words,
      topic: m.topic,
      services,
      text: got.text,
      postedAt: got.postedAt,
      capturedAt: got.capturedAt,
      metrics: got.metrics,
      durationS: got.durationS ?? null,
      slides: got.slides ?? null,
      spoke: got.spoke ?? null,
    },
    /* The clip travels beside the source, base64 like the cover does. It is
       about 130 KB, which is a fifth of a cover's worth of request and the
       only copy that will ever exist — the media itself is deleted before
       takeSocial returns. */
    ...(got.preview
      ? {
          preview: {
            clip: got.preview.clip.toString("base64"),
            poster: got.preview.poster.toString("base64"),
            seconds: got.preview.seconds,
            whole: got.preview.whole,
          },
        }
      : {}),
  };
}

/**
 * Draw the article's cover.
 *
 * Its own job kind, and never in the same one as the writing: Ollama and
 * ComfyUI both want this card, and ComfyUI is the one that dies rather than
 * queues when two processes draw at once (sm-fixed, 2026-09-06). The runner's
 * single sequential loop is what keeps them apart.
 *
 * A failure here is NOT fatal to the article. A missing picture is a missing
 * picture; the piece is already written and already publishable.
 */
async function doCover(draft: { id: number; slug: string; post: string }, topic: string) {
  const post = JSON.parse(draft.post) as {
    title: string;
    standfirst: string;
    excerpt: string;
    services?: string[];
    body?: never[];
  };

  /* The WHOLE piece, not the headline. look.ts is reading for the shape of an
     argument, and an argument is not in its title — the fourth pass proved
     what happens when the cover only knows six words. */
  const out = await cover({
    title: post.title,
    text: [post.standfirst, post.excerpt, proseOf((post.body ?? []) as never)].filter(Boolean).join("\n\n"),
    topic: topic as never,
    services: post.services ?? [],
    slug: draft.slug,
  });

  console.log(
    `  read it as ${out.read.motion}/${out.read.mood} (${out.read.because.motion.join(", ") || "nothing fired"})`,
  );
  console.log(
    `  drew a cover — ${out.layout} in ${out.palette}, ${Math.round(out.webp.length / 1024)}KB in ${Math.round(out.ms / 1000)}s`,
  );
  return {
    ok: true,
    cover: {
      draft: draft.id,
      slug: draft.slug,
      webp: out.webp.toString("base64"),
      alt: out.alt,
      caption: out.caption,
    },
  };
}

/**
 * Cut a preview for an article that already exists.
 *
 * The clip is normally made during ingest, while the media is still on disk
 * — everything that needs the file happens in that one pass, because the
 * file is deleted the moment it ends. This is the other route: an article
 * written before previews existed, or one whose video ffmpeg choked on, and
 * re-running the whole ingest would rewrite the article to get a picture.
 *
 * So it does the smallest thing that produces a clip: resolve, download,
 * cut, throw the media away. It never touches the words.
 */
async function doClip(draft: { id: number; slug: string }, url: string): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(path.join(tmpdir(), "bk-clip-"));
  try {
    const expanded = await expandUrl(url);
    const { videoId } = classify(expanded);
    const { transient } = await resolve(expanded);

    const file = path.join(dir, `${videoId}.mp4`);
    await download(transient.mediaUrl, file, 120_000);
    const meta = await probe(file);

    const out = await makePreview(file, dir, meta.durationS);
    if (!out) throw new Error("ffmpeg could not cut a clip from that file");

    console.log(
      `  cut a ${out.seconds}s clip (${out.whole ? "all of it" : "capped"}) — ${Math.round(out.clip.length / 1024)}KB`,
    );
    return {
      ok: true,
      slug: draft.slug,
      preview: {
        clip: out.clip.toString("base64"),
        poster: out.poster.toString("base64"),
        seconds: out.seconds,
        whole: out.whole,
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function once(): Promise<boolean> {
  /* One job at a time, in one sequential loop, ON PURPOSE. sm-fixed's worker
     already drives yt-dlp, Whisper and ComfyUI on this same 4090, and ComfyUI
     died outright on 2026-09-06 when two processes drew at once. Polling out
     solves availability; it does nothing about contention. The desk at least
     cannot collide with ITSELF. */
  const got = await post<{ job: Job | null; link?: LinkRow; draft?: { id: number; slug: string; post: string } }>(
    "/next",
    { name: NAME, kinds: ["ingest", "write", "cover", "clip"] },
  );
  if (!got.job || !got.link) return false;

  const { job, link } = got;
  console.log(`\n→ job ${job.id} (${job.kind}, attempt ${job.attempt}): ${link.title || link.url}`);

  /* Start whatever this job needs. A link shared from a phone should end
     in an article without anybody opening a terminal. */
  const ready = await ensureFor(job.kind);
  if (!ready.ok) {
    console.error(`  ${ready.why}`);
    await post(`/result/${job.id}`, { ok: false, error: ready.why });
    return true;
  }

  try {
    const result =
      job.kind === "cover"
        ? got.draft
          ? await doCover(got.draft, link.topic)
          : { ok: false, error: "the draft that cover belongs to is gone" }
        : job.kind === "clip"
          ? got.draft
            ? await doClip(got.draft, link.url)
            : { ok: false, error: "the draft that clip belongs to is gone" }
          : job.kind === "ingest"
            ? await doIngest(link)
            : await doWrite(link);
    await post(`/result/${job.id}`, result);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`  failed: ${why}`);
    /* Back to the queue with the reason recorded. A draft the guard threw out
       is a real failure and should be visible, not retried silently forever —
       the box gives up after three attempts. */
    await post(`/result/${job.id}`, { ok: false, error: why });
  }
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Start Ollama rather than complain about it. The runner is a service now
   and a service that exits because another service was not running yet is
   a service that never comes back after a reboot. */
await ensureOllama();

const h = await health();
if (h.ok && !h.models.some((m) => m === WRITE_MODEL)) {
  console.error(`${WRITE_MODEL} is not pulled on this machine. Have: ${h.models.join(", ")}`);
}

console.log(`runner "${NAME}" → ${DESK}, writing with ${WRITE_MODEL}`);

if (process.argv.includes("--once")) {
  const did = await once();
  if (!did) console.log("nothing queued.");
  process.exit(0);
}

/*
 * Wake for a job, and go back to sleep after it.
 *
 * Fini, 24 September 2026: *"when I send a message it wakes up anything it
 * needs and then when job finish it turn it off."*
 *
 * Not the instant the job ends — an article is a WRITE job and then a COVER
 * job, and closing ComfyUI between the two would pay nine seconds to save
 * twelve. It waits until the queue has actually been quiet, which is what
 * "finished" means when the work arrives in pieces.
 *
 * QUIET_POLLS idle polls at IDLE_MS each, so about a minute after the last
 * job. Then once, and not again until something new comes in.
 */
const QUIET_POLLS = 3;
let quiet = 0;
let asleep = false;

for (;;) {
  try {
    const did = await once();
    if (did) {
      quiet = 0;
      asleep = false;
      continue;
    }

    if (!asleep && ++quiet >= QUIET_POLLS) {
      const freed = await release();
      if (freed.length) console.log(`  queue is empty — ${freed.join(", ")}`);
      asleep = true;
    }
    await sleep(IDLE_MS);
  } catch (e) {
    console.error(`desk unreachable: ${e instanceof Error ? e.message : e}`);
    await sleep(DOWN_MS);
  }
}
