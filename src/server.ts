import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { db, log, queueState, reclaim } from "./db.ts";
import { match } from "./match.ts";
import { serviceName, TOPICS } from "./catalogue.ts";

/**
 * desk.balkaris.ch — the part that is always on.
 *
 * It runs on the box beside the engine, behind Caddy, and it holds everything
 * that does not need a GPU: the Telegram webhook, the queue, the drafts, the
 * console and the publisher. See ARCHITECTURE.md for why the writing is
 * somewhere else.
 *
 * Three doors, and they are guarded three different ways:
 *
 *   /tg/<secret>   Telegram only. The secret is in the path because that is
 *                  what setWebhook gives you, and it is checked against the
 *                  header Telegram also sends. Nothing else is accepted.
 *   /runner/*      the workstation. Bearer DESK_RUNNER_SECRET, compared in
 *                  constant time.
 *   everything else the console. Behind Caddy, noindex, and for now read-only
 *                  to anybody who has the address — the box is not on the
 *                  public internet by accident, but this is the door to
 *                  harden first when the desk starts publishing on its own.
 */

const PORT = Number(process.env.DESK_PORT ?? 3400);
const RUNNER_SECRET = process.env.DESK_RUNNER_SECRET ?? "";
const TG_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

const app = new Hono();

/** Timing-safe compare that does not leak length either. */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/* ---------- health ---------------------------------------------------------
   Caddy, uptime checks and a human all ask the same question. It answers
   without touching the queue so it stays true when the queue is wedged.    */

app.get("/health", (c) => c.json({ ok: true, service: "balkaris-desk", at: new Date().toISOString() }));

/* ---------- the console ----------------------------------------------------
   Plain server-rendered HTML for now: what came in, what it was matched to,
   what is waiting for the workstation. The real console follows; this is the
   page that proves the address answers and says something true.            */

app.get("/", (c) => {
  reclaim();
  const q = queueState();
  const links = db
    .prepare("SELECT id, url, title, site, topic, services, state, created_at FROM links ORDER BY id DESC LIMIT 40")
    .all() as {
    id: number;
    url: string;
    title: string | null;
    site: string | null;
    topic: string | null;
    services: string | null;
    state: string;
    created_at: string;
  }[];

  const awake = q.lastSeen && Date.now() - Date.parse(`${q.lastSeen}Z`) < 5 * 60_000;
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

  const rows = links.length
    ? links
        .map((l) => {
          const svc = (l.services ? (JSON.parse(l.services) as string[]) : []).map(serviceName).join(" · ");
          const topic = TOPICS.find((t) => t.id === l.topic)?.name ?? "";
          return `<tr>
            <td class="s">${esc(l.state)}</td>
            <td><a href="${esc(l.url)}" rel="noreferrer noopener">${esc(l.title ?? l.url)}</a>
                <em>${esc(l.site ?? "")}</em></td>
            <td>${esc(topic)}</td>
            <td>${esc(svc)}</td>
            <td class="t">${esc(l.created_at)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="none">Nothing yet. Share a link with the bot.</td></tr>`;

  return c.html(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Balkaris desk</title>
<style>
  :root{color-scheme:dark;--bg:#0b0c0d;--fg:#e9eaeb;--dim:#8b8e91;--line:#1e2022;--ok:#25f716}
  *{box-sizing:border-box}
  body{margin:0;padding:40px 24px;background:var(--bg);color:var(--fg);
       font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  main{max-width:1100px;margin:0 auto}
  h1{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:0 0 4px}
  .sub{color:var(--dim);margin:0 0 28px;font-size:13px}
  .pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:28px}
  .pill{border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:12.5px;color:var(--dim)}
  .pill b{color:var(--fg);font-weight:600}
  .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:1px}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th{text-align:left;font-weight:500;color:var(--dim);font-size:11px;letter-spacing:.14em;
     text-transform:uppercase;padding:0 12px 10px 0;border-bottom:1px solid var(--line)}
  td{padding:13px 12px 13px 0;border-bottom:1px solid var(--line);vertical-align:top}
  td a{color:var(--fg);text-decoration:none}
  td a:hover{text-decoration:underline}
  td em{display:block;color:var(--dim);font-style:normal;font-size:12px;margin-top:2px}
  .s{color:var(--dim);font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
  .t{color:var(--dim);font-size:12px;white-space:nowrap}
  .none{color:var(--dim);padding:28px 0;text-align:center}
</style></head><body><main>
  <h1>Balkaris desk</h1>
  <p class="sub">Share a link with the bot. It is read and matched here, written on the workstation, and published to balkaris.ch when you say so.</p>
  <div class="pills">
    <span class="pill"><span class="dot" style="background:${awake ? "var(--ok)" : "#55585a"}"></span>
      workstation <b>${awake ? "awake" : "asleep"}</b></span>
    <span class="pill">queued <b>${q.queued}</b></span>
    <span class="pill">writing <b>${q.running}</b></span>
    <span class="pill">drafts <b>${q.drafts}</b></span>
    ${q.stuck ? `<span class="pill">stuck <b>${q.stuck}</b></span>` : ""}
  </div>
  <table>
    <thead><tr><th>State</th><th>Link</th><th>Shelf</th><th>Services</th><th>Shared</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</main></body></html>`);
});

/* ---------- the runner's door ----------------------------------------------
   The workstation polls OUT to here, so nothing has to reach in to it: no
   port forward, no tunnel, and it can vanish mid-job without breaking
   anything (db.ts `reclaim`).                                              */

const runner = new Hono();

runner.use("*", async (c, next) => {
  const given = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!sameSecret(given, RUNNER_SECRET)) return c.json({ error: "no" }, 401);
  await next();
});

/** "Anything for me?" — and the answer is the whole job, so one round trip. */
runner.post("/next", async (c) => {
  const { name, kinds } = (await c.req.json().catch(() => ({}))) as { name?: string; kinds?: string[] };
  log("runner.poll", { name: name ?? "?", kinds });
  reclaim();

  const want = kinds?.length ? kinds : ["write", "cover"];
  const marks = want.map(() => "?").join(",");
  const job = db
    .prepare(`SELECT * FROM jobs WHERE state = 'queued' AND kind IN (${marks}) ORDER BY id LIMIT 1`)
    .get(...want) as { id: number; link_id: number; kind: string; attempts: number } | undefined;

  if (!job) return c.json({ job: null });

  db.prepare("UPDATE jobs SET state='running', runner=?, taken_at=datetime('now'), attempts=attempts+1 WHERE id=?").run(
    name ?? "runner",
    job.id,
  );

  const link = db.prepare("SELECT * FROM links WHERE id = ?").get(job.link_id);
  log("job.taken", { job: job.id, kind: job.kind, runner: name }, job.link_id);
  return c.json({ job: { id: job.id, kind: job.kind, attempt: job.attempts + 1 }, link });
});

/** What came back. A failure is a row, not a silence. */
runner.post("/result/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as {
    ok: boolean;
    error?: string;
    slug?: string;
    post?: unknown;
    template?: string;
    model?: string;
    ms?: number;
  };

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as { id: number; link_id: number } | undefined;
  if (!job) return c.json({ error: "no such job" }, 404);

  if (!body.ok) {
    db.prepare("UPDATE jobs SET state='queued', runner=NULL, taken_at=NULL, error=? WHERE id=?").run(
      (body.error ?? "").slice(0, 500),
      id,
    );
    log("job.failed", body.error, job.link_id);
    return c.json({ ok: true });
  }

  db.prepare("UPDATE jobs SET state='done', finished_at=datetime('now'), error=NULL WHERE id=?").run(id);
  if (body.post && body.slug) {
    db.prepare("INSERT INTO drafts (link_id, slug, post, template, model, ms) VALUES (?,?,?,?,?,?)").run(
      job.link_id,
      body.slug,
      JSON.stringify(body.post),
      body.template ?? "?",
      body.model ?? null,
      body.ms ?? null,
    );
    db.prepare("UPDATE links SET state='drafted', updated_at=datetime('now') WHERE id=?").run(job.link_id);
  }
  log("job.done", { job: id, slug: body.slug }, job.link_id);
  return c.json({ ok: true });
});

app.route("/runner", runner);

/* ---------- Telegram -------------------------------------------------------
   A webhook, not long-polling: the box has a public HTTPS name, so Telegram
   can simply post here and a shared link is queued the instant it is sent.
   The handler is deliberately thin — reading the page and matching it happen
   in src/intake.ts, which the next commit brings.                          */

app.post("/tg/:secret", async (c) => {
  const path = c.req.param("secret");
  const header = c.req.header("x-telegram-bot-api-secret-token") ?? "";
  if (!sameSecret(path, TG_SECRET) || !sameSecret(header, TG_SECRET)) return c.json({ ok: true });

  const update = await c.req.json().catch(() => null);
  log("telegram.update", update ? { id: (update as { update_id?: number }).update_id } : "unparsable");
  /* Telegram retries anything that is not a 200, so this always answers 200
     and keeps its problems in `events`. */
  return c.json({ ok: true });
});

/* ---------- a matcher anybody can try --------------------------------------
   The table's working, over HTTP, so a service that looks wrong in an article
   can be argued about without a checkout.                                  */

app.get("/match", (c) => {
  const q = c.req.query("q") ?? "";
  if (!q) return c.json({ error: "pass ?q=" }, 400);
  return c.json(match(q, c.req.query("body") ?? q));
});

serve({ fetch: app.fetch, port: PORT }, (i) => {
  console.log(`balkaris-desk on :${i.port}`);
  if (!RUNNER_SECRET) console.warn("  DESK_RUNNER_SECRET is empty — the runner door is shut until it is set.");
  if (!TG_SECRET) console.warn("  TELEGRAM_WEBHOOK_SECRET is empty — the Telegram door is shut until it is set.");
});
