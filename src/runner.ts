import { readFileSync } from "node:fs";
import { draft, type DraftInput } from "./draft.ts";
import { health, WRITE_MODEL } from "./llm.ts";
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
    `  wrote "${out.post.title}" — ${out.template} (${out.because}), ${out.post.readingTime} min, ${Math.round(out.ms / 1000)}s`,
  );
  return { ok: true, slug: out.post.slug, post: out.post, template: out.template, model: out.model, ms: out.ms };
}

async function once(): Promise<boolean> {
  const got = await post<{ job: Job | null; link?: LinkRow }>("/next", { name: NAME, kinds: ["write"] });
  if (!got.job || !got.link) return false;

  const { job, link } = got;
  console.log(`\n→ job ${job.id} (${job.kind}, attempt ${job.attempt}): ${link.title || link.url}`);

  try {
    const result = await doWrite(link);
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

const h = await health();
if (!h.ok) {
  console.error(`Ollama is not answering (${h.why}). Start it, then start the runner.`);
  process.exit(1);
}
if (!h.models.some((m) => m === WRITE_MODEL)) {
  console.error(`${WRITE_MODEL} is not pulled on this machine. Have: ${h.models.join(", ")}`);
  process.exit(1);
}

console.log(`runner "${NAME}" → ${DESK}, writing with ${WRITE_MODEL}`);

if (process.argv.includes("--once")) {
  const did = await once();
  if (!did) console.log("nothing queued.");
  process.exit(0);
}

for (;;) {
  try {
    const did = await once();
    if (!did) await sleep(IDLE_MS);
  } catch (e) {
    console.error(`desk unreachable: ${e instanceof Error ? e.message : e}`);
    await sleep(DOWN_MS);
  }
}
