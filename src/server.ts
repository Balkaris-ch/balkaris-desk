import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { db, log, queueState, reclaim } from "./db.ts";
import { match } from "./match.ts";
import { takeLink } from "./intake.ts";
import { firstUrl } from "./extract.ts";
import { esc, send } from "./telegram.ts";
import { closingEcho, echoWords } from "./echo.ts";
import { draftPage, linkPage, listPage, page } from "./console.ts";
import { publish, type PublishAction } from "./publish.ts";

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
/** Where a published article actually lives, for the "see it live" link. */
const SITE_BASE = (process.env.SITE_BASE ?? "https://www.balkaris.ch").replace(/\/$/, "");

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

app.get("/", (c) => c.html(listPage()));

app.get("/draft/:id", (c) => {
  const html = draftPage(Number(c.req.param("id")), SITE_BASE);
  return html ? c.html(html) : c.notFound();
});

app.get("/link/:id", (c) => {
  const html = linkPage(Number(c.req.param("id")));
  return html ? c.html(html) : c.notFound();
});

/* Re-queue a link the workstation could not finish. A paywall that lifts, a
   rate limit that passes, a model that fell over: none of them is permanent,
   and a person should not have to re-share the link to try again. */
app.post("/link/:id/retry", (c) => {
  const id = Number(c.req.param("id"));
  const link = db.prepare("SELECT * FROM links WHERE id = ?").get(id) as { kind: string } | undefined;
  if (!link) return c.notFound();

  db.prepare("UPDATE jobs SET state='queued', attempts=0, error=NULL, runner=NULL, taken_at=NULL WHERE link_id=? AND state IN ('stuck','queued')").run(id);
  const open = db.prepare("SELECT COUNT(*) c FROM jobs WHERE link_id=? AND state='queued'").get(id) as { c: number };
  if (!open.c) {
    db.prepare("INSERT INTO jobs (link_id, kind) VALUES (?, ?)").run(id, link.kind === "article" ? "write" : "ingest");
  }
  db.prepare("UPDATE links SET state='queued', error=NULL, updated_at=datetime('now') WHERE id=?").run(id);
  log("link.retried", null, id);
  return c.redirect(`/link/${id}`, 303);
});

/* Ask the workstation to write a different ENDING, leaving the article alone.
   This is what the echo flag is for: the escape from two closings that share a
   skeleton is picking another job, not rewriting a paragraph by hand. */
app.post("/draft/:id/reclose", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const job = String(form.job ?? "");
  const d = db.prepare("SELECT link_id FROM drafts WHERE id = ?").get(id) as { link_id: number } | undefined;
  if (!d) return c.notFound();

  db.prepare("INSERT INTO jobs (link_id, kind, payload) VALUES (?, 'reclose', ?)").run(
    d.link_id,
    JSON.stringify({ draft: id, job }),
  );
  log("draft.reclose.queued", { draft: id, job }, d.link_id);
  return c.redirect(`/draft/${id}`, 303);
});

/**
 * Publish, list, unlist, take down.
 *
 * Every one of them is the same shape: write the file, commit, push, and only
 * then move the draft's state. If git throws, the draft stays exactly where it
 * was and the page says what went wrong — a failed push must never leave
 * something marked published that is not, and the fix must never be to write
 * the article again.
 */
async function act(c: { req: { param: (k: string) => string } }, action: PublishAction, nextState: string) {
  const id = Number(c.req.param("id"));
  const d = db.prepare("SELECT id, link_id, slug FROM drafts WHERE id = ?").get(id) as
    | { id: number; link_id: number; slug: string }
    | undefined;
  if (!d) return { ok: false as const, id, html: null };

  try {
    const out = await publish(id, action);
    db.prepare("UPDATE drafts SET state = ?, published_sha = ? WHERE id = ?").run(nextState, out.sha, id);
    db.prepare("UPDATE links SET state = ?, updated_at = datetime('now') WHERE id = ?").run(
      nextState === "removed" ? "drafted" : nextState,
      d.link_id,
    );
    log(`draft.${action}`, { sha: out.sha, slug: d.slug }, d.link_id);
    return { ok: true as const, id, html: null };
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).split(/\r?\n/).slice(0, 3).join(" ").slice(0, 400);
    log(`draft.${action}.failed`, why, d.link_id);
    return {
      ok: false as const,
      id,
      html: page(
        "It did not go out",
        `<a class="back" href="/draft/${id}">← back to the article</a>
         <h1>The push did not go through</h1>
         <p class="sub">Nothing changed. The article is exactly where it was and nothing reached the site.</p>
         <p class="flag">${escHtml(why)}</p>
         <form method="post" action="/draft/${id}/${action === "list" ? "list" : action}"><button class="go">Try again</button></form>`,
      ),
    };
  }
}

const escHtml = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);

/* Live at its own url, in none of the menus. */
app.post("/draft/:id/publish", async (c) => {
  const r = await act(c, "publish", "unlisted");
  return r.html ? c.html(r.html) : c.redirect(`/draft/${r.id}`, 303);
});

/* Into the menus, the shelves, the sitemap and search. */
app.post("/draft/:id/list", async (c) => {
  const r = await act(c, "list", "listed");
  return r.html ? c.html(r.html) : c.redirect(`/draft/${r.id}`, 303);
});

/* Out of them again. The url keeps working; noindex comes back. */
app.post("/draft/:id/unlist", async (c) => {
  const r = await act(c, "unlist", "unlisted");
  return r.html ? c.html(r.html) : c.redirect(`/draft/${r.id}`, 303);
});

/* Off the site entirely. The url 404s afterwards. */
app.post("/draft/:id/takedown", async (c) => {
  const r = await act(c, "remove", "draft");
  return r.html ? c.html(r.html) : c.redirect(`/draft/${r.id}`, 303);
});

app.post("/draft/:id/remove", (c) => {
  const id = Number(c.req.param("id"));
  const d = db.prepare("SELECT link_id, slug, state FROM drafts WHERE id = ?").get(id) as
    | { link_id: number; slug: string; state: string }
    | undefined;
  if (!d) return c.notFound();
  if (d.state === "listed") return c.text("Take it off the site before deleting the draft.", 409);

  db.prepare("DELETE FROM drafts WHERE id = ?").run(id);
  /* The LINK stays. The point of a collector is that nothing shared is lost,
     and a bad draft is a reason to write it again, not to forget the link. */
  db.prepare("UPDATE links SET state='queued', updated_at=datetime('now') WHERE id=?").run(d.link_id);
  log("draft.removed", { slug: d.slug }, d.link_id);
  return c.redirect("/", 303);
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
    /** Which of the five jobs the last paragraph was given. */
    closing?: string;
    /* Only an 'ingest' sends this: everything the box could not know until
       the media was in hand on the workstation. */
    source?: {
      kind: string;
      platform: string;
      url: string;
      title: string;
      author: string | null;
      words: number;
      topic: string;
      services: string[];
      text: string;
      postedAt: string | null;
      capturedAt: string;
      metrics: { views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null };
      durationS: number | null;
      slides: number | null;
      spoke: string | null;
    };
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

  /* An ingest fills in the row the box could only stub. The canonical PAGE
     url replaces whatever was shared — a share link, a redirect, a url with
     six tracking parameters on it — so a second share of the same post finds
     this row. The CDN url is never stored at all. */
  if (body.source) {
    const s = body.source;
    db.prepare(
      `UPDATE links SET url=?, kind=?, platform=?, title=?, author=?, site=?, words=?, topic=?, services=?, body=?,
                        published=?, posted_at=?, captured_at=?, views=?, likes=?, comments=?, shares=?, saves=?,
                        duration_s=?, slides=?, spoke=?, updated_at=datetime('now')
       WHERE id=?`,
    ).run(
      s.url,
      s.kind,
      s.platform,
      s.title,
      s.author,
      s.author ? `${s.author} on ${s.platform}` : s.platform,
      s.words,
      s.topic,
      JSON.stringify(s.services),
      s.text,
      s.postedAt,
      s.postedAt,
      s.capturedAt,
      s.metrics.views,
      s.metrics.likes,
      s.metrics.comments,
      s.metrics.shares,
      s.metrics.saves,
      s.durationS,
      s.slides,
      s.spoke,
      job.link_id,
    );
    log("link.ingested", { kind: s.kind, platform: s.platform, words: s.words, metrics: s.metrics }, job.link_id);
  }
  if (body.post && body.slug) {
    /* Does it end the way the last twenty ended? A flag for whoever approves
       it — never a rejection. See src/echo.ts. */
    const paras = ((body.post as { body?: unknown[] }).body ?? []).filter(
      (b): b is string => typeof b === "string",
    );
    const flag = closingEcho(job.link_id, paras.at(-1) ?? "", body.closing ?? null);
    if (flag) log("draft.echo", flag, job.link_id);

    db.prepare(
      "INSERT INTO drafts (link_id, slug, post, template, model, ms, echo, closing) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      job.link_id,
      body.slug,
      JSON.stringify(body.post),
      body.template ?? "?",
      body.model ?? null,
      body.ms ?? null,
      flag ? echoWords(flag) : null,
      body.closing ?? null,
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

interface TgMessage {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; first_name?: string; username?: string };
  text?: string;
  caption?: string;
}

/**
 * Who may use it.
 *
 * `TELEGRAM_OWNER_ID` in the env is the answer when it is set. When it is not
 * — a bot minutes old, nobody's id known yet — the FIRST chat to write claims
 * it, and that claim is written to the events log so the console can show who
 * it was. The alternative was asking Fini to read a numeric id out of an API
 * response before the thing could be used once, and a brand-new bot with an
 * unlisted username is not something a stranger finds in the minutes between
 * deploy and first message. Everyone after the owner is let in by `desk_allow`
 * rows, which the owner adds with /allow.
 */
function mayUse(chatId: number): { ok: boolean; claimed?: boolean } {
  const env = Number(process.env.TELEGRAM_OWNER_ID ?? 0);
  if (env && chatId === env) return { ok: true };

  const owner = db.prepare("SELECT detail FROM events WHERE what = 'owner.claimed' ORDER BY id LIMIT 1").get() as
    | { detail: string }
    | undefined;

  if (!owner && !env) {
    log("owner.claimed", { chat: chatId });
    return { ok: true, claimed: true };
  }
  if (owner && (JSON.parse(owner.detail) as { chat: number }).chat === chatId) return { ok: true };

  const allowed = db.prepare("SELECT 1 FROM events WHERE what = 'chat.allowed' AND detail = ?").get(
    JSON.stringify({ chat: chatId }),
  );
  return { ok: !!allowed };
}

app.post("/tg/:secret", async (c) => {
  const path = c.req.param("secret");
  const header = c.req.header("x-telegram-bot-api-secret-token") ?? "";
  if (!sameSecret(path, TG_SECRET) || !sameSecret(header, TG_SECRET)) return c.json({ ok: true });

  const update = (await c.req.json().catch(() => null)) as { message?: TgMessage; edited_message?: TgMessage } | null;
  const msg = update?.message ?? update?.edited_message;
  if (!msg) return c.json({ ok: true });

  const chat = msg.chat.id;
  const text = (msg.text ?? msg.caption ?? "").trim();
  const name = msg.from?.first_name ?? msg.from?.username ?? "someone";

  const may = mayUse(chat);
  if (!may.ok) {
    log("telegram.refused", { chat, name });
    await send(chat, "This bot belongs to Balkaris and is not open. Ask Fini to add you.");
    return c.json({ ok: true });
  }

  /* Telegram retries anything that is not a 200 — including a handler that
     threw — so the work happens after the response and its problems go to
     `events` rather than becoming an infinite redelivery loop. */
  void (async () => {
    try {
      if (may.claimed) {
        await send(chat, `Hello ${esc(name)} — you are the owner of this desk now.`);
      }

      if (/^\/start\b/.test(text)) {
        await send(
          chat,
          `<b>Balkaris desk</b>\n\nSend me a link to an article. I read it, work out which of our services it is about, ` +
            `and write it up as a piece for the journal. You approve it before anything is published.\n\n` +
            `The desk is at ${esc(process.env.DESK_URL ?? "https://desk.balkaris.ch")}.`,
        );
        return;
      }

      if (/^\/status\b/.test(text)) {
        const q = queueState();
        const awake = q.lastSeen && Date.now() - Date.parse(`${q.lastSeen}Z`) < 5 * 60_000;
        await send(
          chat,
          `Workstation: <b>${awake ? "awake" : "asleep"}</b>\nQueued: ${q.queued}\nWriting: ${q.running}\n` +
            `Drafts waiting for you: ${q.drafts}${q.stuck ? `\nStuck: ${q.stuck}` : ""}`,
        );
        return;
      }

      if (!firstUrl(text)) {
        await send(chat, "Send me a link to an article and I will take it from there. /status tells you what is in the queue.");
        return;
      }

      await takeLink(text, {
        chat,
        user: msg.from?.id,
        name,
        note: text.replace(firstUrl(text) ?? "", "").trim() || undefined,
        replyTo: msg.message_id,
      });
    } catch (e) {
      log("telegram.handler.failed", e instanceof Error ? e.message : String(e));
      await send(chat, "Something went wrong on my side. It is in the log on the desk.");
    }
  })();

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
