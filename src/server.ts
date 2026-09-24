import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { beat, db, log, queueState, reclaim } from "./db.ts";
import { match } from "./match.ts";
import { takeLink } from "./intake.ts";
import { firstUrl } from "./extract.ts";
import { isSocial } from "./social/shape.ts";
import { esc, send } from "./telegram.ts";
import { closingEcho, echoWords } from "./echo.ts";
import { draftPage, linkPage, listPage, page, peoplePage } from "./console.ts";
import { publish, type PublishAction } from "./publish.ts";
import { everyone, getPerson, link, remember, rememberGoogle, setAuthor, setEmail, setRevoked, type Person } from "./people.ts";
import { configured as ga4On, pages as ga4Pages } from "./ga4.ts";
import { coverPath, saveClip, saveCover } from "./covers.ts";
import { allowed, authUrl, checkState, client, DOMAIN, exchange, mintState } from "./google.ts";
import { clear, issue, whoIs } from "./session.ts";

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

/** What travels on a request: the signed-in person, set by the gate below. */
type Vars = { Variables: { who: Person } };

const app = new Hono<Vars>();

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

/**
 * WHO IS LOOKING.
 *
 * Everything past the login routes needs a person, because publishing commits
 * under their own email now and "who did this" has to be a real answer rather
 * than "the desk". The identity is the Telegram account — the only one this
 * thing can actually prove — so the login is: ask the bot, get a link in a
 * chat only you can read, open it. No passwords anywhere.
 */
/**
 * Signing in with Google, at balkaris.ch and nowhere else.
 *
 * Fini, 23 September 2026: "I need login with Gmail, and only domain level
 * can have access to this desk."
 *
 * The domain check is on the claim Google signed, not on the button — a
 * consent screen with `hd` only puts the right domain in front of somebody,
 * and the account picker still lists every account they have. See
 * src/google.ts.
 *
 * It also settles a thing the Telegram login left awkward: the email IS the
 * identity now, and the email is exactly what publishing needs, so being
 * signed in and being able to publish stopped being two separate facts.
 */
app.get("/auth/google", (c) => {
  const g = client();
  if (!g) return c.html(NO_CLIENT, 500);
  return c.redirect(authUrl(g, mintState()), 302);
});

app.get("/auth/google/callback", async (c) => {
  const g = client();
  if (!g) return c.html(NO_CLIENT, 500);

  const code = c.req.query("code") ?? "";
  const state = c.req.query("state") ?? "";
  const denied = c.req.query("error");

  if (denied) return c.html(refused(`Google said: ${denied}`), 401);
  if (!checkState(state)) return c.html(refused("That sign-in did not start here, or it took too long."), 401);
  if (!code) return c.html(refused("Google sent no code back."), 401);

  let who;
  try {
    who = await exchange(g, code);
  } catch (e) {
    return c.html(refused(e instanceof Error ? e.message : String(e)), 401);
  }

  const may = allowed(who);
  if (!may.ok) {
    log("auth.refused", { email: who.email, hd: who.hd });
    return c.html(refused(may.why), 403);
  }

  const person = rememberGoogle(who.email, who.name);
  log("auth.in", { email: who.email });
  issue(c, person.telegram);
  return c.redirect("/", 303);
});

app.post("/logout", (c) => {
  clear(c);
  return c.html(SIGN_IN, 401);
});

const SIGN_IN = page(
  "Sign in",
  `<h1>Balkaris desk</h1>
   <p class="sub">Sign in with your <b>@${DOMAIN}</b> Google account. Nothing else gets in.</p>
   <p style="margin:26px 0"><a class="btn go" href="/auth/google" style="padding:12px 22px">Sign in with Google</a></p>`,
);

const NO_CLIENT = page(
  "Not configured",
  `<h1>Google sign-in is not configured</h1>
   <p class="sub">The desk has no OAuth client. Point <code>GOOGLE_OAUTH_FILE</code> at the JSON Google
   gives you when you create a Web application client, with
   <code>https://desk.balkaris.ch/auth/google/callback</code> as its redirect.</p>`,
);

const refused = (why: string) =>
  page(
    "Not allowed",
    `<h1>That account cannot use the desk</h1>
     <p class="flag">${why.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!)}</p>
     <p style="margin:24px 0"><a class="btn" href="/auth/google">Try another account</a></p>`,
  );

app.use("*", async (c, next) => {
  const p = c.req.path;
  if (p === "/health" || p.startsWith("/runner/") || p.startsWith("/tg/") || p.startsWith("/auth/")) return next();

  const who = whoIs(c);
  if (!who) return c.html(SIGN_IN, 401);
  c.set("who", who);
  await next();
});

const me = (c: { get: (k: "who") => Person }) => c.get("who");

app.get("/", (c) => c.html(listPage(me(c))));

/* The people the desk knows, and the one field that decides whether somebody
   can publish: an email, which must be the one on their Vercel account. */
app.get("/people", (c) => c.html(peoplePage(everyone(), me(c))));

/**
 * Only the owner changes other people.
 *
 * Fini: "people cannot change other one's emails — they might see the team but
 * they cannot change the emails, and only me I can change, revoke or stuff
 * like that." The people page hides the fields from everybody else; this
 * refuses the POST, because hiding a form is courtesy and the check is the
 * rule.
 */
const ownerOnly = (c: { get: (k: "who") => Person }) => me(c).owner;

app.post("/people/:telegram", async (c) => {
  if (!ownerOnly(c)) return c.text("Only the owner changes people.", 403);
  const id = Number(c.req.param("telegram"));
  const form = await c.req.parseBody();
  if (!getPerson(id)) return c.notFound();
  setEmail(id, String(form.email ?? "").trim() || null);
  setAuthor(id, String(form.author ?? "balkaris").trim() || "balkaris");
  return c.redirect("/people", 303);
});

/* Join a Google account to the Telegram account that is the same person. */
app.post("/people/:telegram/link", async (c) => {
  if (!ownerOnly(c)) return c.text("Only the owner changes people.", 403);
  const acct = getPerson(Number(c.req.param("telegram")));
  const form = await c.req.parseBody();
  const tg = Number(String(form.telegram ?? "").trim());
  if (!acct?.email || !tg) return c.redirect("/people", 303);
  link(tg, acct.email);
  return c.redirect("/people", 303);
});

/* Switched off: they can still sign in, and can do nothing. */
app.post("/people/:telegram/revoke", (c) => {
  if (!ownerOnly(c)) return c.text("Only the owner changes people.", 403);
  const id = Number(c.req.param("telegram"));
  const p = getPerson(id);
  if (!p || p.owner) return c.redirect("/people", 303);
  setRevoked(id, !p.revoked);
  return c.redirect("/people", 303);
});

app.get("/draft/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const d = db.prepare("SELECT slug FROM drafts WHERE id = ?").get(id) as { slug: string } | undefined;

  /* The article's OWN numbers, read from GA4 and cached for ten minutes. A
     failure here is shown and never fatal: the page is the article, and the
     views are a column on it. */
  let ours: { stats: ReturnType<typeof Object> | null; error: string | null; on: boolean } = {
    stats: null,
    error: null,
    on: ga4On(),
  };
  if (d && ga4On()) {
    const got = await ga4Pages();
    ours = { stats: got.pages.get(`/insights/${d.slug}`) ?? null, error: got.error, on: true };
  }

  const html = draftPage(id, SITE_BASE, me(c), ours as never);
  return html ? c.html(html) : c.notFound();
});

/* The desk serves the cover it drew, so the preview shows the real picture
   rather than describing one. */
app.get("/cover/:slug", (c) => {
  const file = coverPath(c.req.param("slug").replace(/\.webp$/, ""));
  if (!file) return c.notFound();
  return new Response(new Uint8Array(file), {
    headers: { "content-type": "image/webp", "cache-control": "no-store" },
  });
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
  const link = db.prepare("SELECT * FROM links WHERE id = ?").get(id) as { kind: string; url: string } | undefined;
  if (!link) return c.notFound();

  db.prepare("UPDATE jobs SET state='queued', attempts=0, error=NULL, runner=NULL, taken_at=NULL WHERE link_id=? AND state IN ('stuck','queued')").run(id);

  /* Decide AGAIN what kind of link this is rather than trusting the stored
     guess. A share link that was misread as an article is exactly the row
     somebody presses Try again on, and re-queueing it as an article would
     fail the same way forever. */
  const social = isSocial(link.url);
  if (social && link.kind === "article") {
    db.prepare("UPDATE links SET kind='social' WHERE id=?").run(id);
  }
  const open = db.prepare("SELECT COUNT(*) c FROM jobs WHERE link_id=? AND state='queued'").get(id) as { c: number };
  if (!open.c) {
    db.prepare("INSERT INTO jobs (link_id, kind) VALUES (?, ?)").run(id, social ? "ingest" : "write");
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
 * SEND A LINK, GET A PUBLISHED ARTICLE.
 *
 * Fini, 23 September 2026: *"I want when I have a link, from a Telegram, to
 * fucking post it. And have everything set up."*
 *
 * So the desk finishes the job itself. When the cover lands — or when the
 * cover has given up — the article is written into the site, pushed, listed,
 * and the person who shared the link gets the live URL in the chat. Nobody
 * opens the console unless they want to.
 *
 * WHO IT PUBLISHES AS. The commit is authored by whoever SHARED the link if
 * the desk knows their address, and by the owner otherwise. It has to be a
 * real person either way: Vercel refuses a commit from somebody who is not on
 * the team, which is the whole reason the desk has no identity of its own.
 *
 * WHAT STILL STOPS IT. Everything that stopped it before. guard() in draft.ts
 * throws away a draft that leans on its source, never names it, or came out
 * too short — and a thrown draft never reaches this function. The echo flag
 * does NOT stop it, by design: two articles ending alike is a thing for a
 * person to notice, not a reason to hold a piece back.
 *
 * DESK_AUTOPUBLISH=0 turns it off and the buttons work as before.
 */
async function autoPublish(draftId: number, linkId: number): Promise<void> {
  if ((process.env.DESK_AUTOPUBLISH ?? "1") === "0") return;

  const d = db.prepare("SELECT id, slug, state FROM drafts WHERE id = ?").get(draftId) as
    | { id: number; slug: string; state: string }
    | undefined;
  if (!d || d.state !== "draft") return;

  /* The sharer publishes it if we know their address; the owner otherwise. */
  const l = db.prepare("SELECT from_user, from_chat FROM links WHERE id = ?").get(linkId) as {
    from_user: number | null;
    from_chat: number | null;
  };
  const sharer = l.from_user ? getPerson(l.from_user) : null;
  const by = sharer?.canPublish ? sharer : everyone().find((p) => p.owner && p.canPublish);

  if (!by) {
    log("auto.nobody", { draft: draftId }, linkId);
    if (l.from_chat) {
      await send(
        l.from_chat,
        "It is written, and I have nobody to publish it as — add a Vercel email on the desk's people page.",
      );
    }
    return;
  }

  try {
    await publish(draftId, "publish", by);
    const out = await publish(draftId, "list", by);
    db.prepare("UPDATE drafts SET state = 'listed', published_sha = ? WHERE id = ?").run(out.sha, draftId);
    db.prepare("UPDATE links SET state = 'listed', updated_at = datetime('now') WHERE id = ?").run(linkId);
    log("auto.published", { draft: draftId, sha: out.sha, by: by.name }, linkId);

    if (l.from_chat) {
      const url = `${SITE_BASE}/insights/${d.slug}`;
      await send(
        l.from_chat,
        `Published.\n\n${esc(url)}\n\n<i>The site takes about two minutes to build, so give it a moment. ` +
          `It is on the journal, in the menu and in the sitemap.</i>`,
      );
    }
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0].slice(0, 300);
    log("auto.failed", why, linkId);
    if (l.from_chat) {
      await send(l.from_chat, `It is written but it did not go out: ${esc(why)}\n\nIt is on the desk, ready to retry.`);
    }
  }
}

/**
 * A new picture for an article that is already out.
 *
 * `autoPublish` deliberately refuses anything that is not still a draft, so a
 * redraw of a published piece stopped in the database and the site kept the
 * old cover. This is the other half: rewrite the article file and the webp at
 * whatever visibility the piece already has, and let the commit be empty if
 * the bytes happen to match.
 */
async function pushCover(draftId: number, linkId: number): Promise<void> {
  const d = db.prepare("SELECT state FROM drafts WHERE id = ?").get(draftId) as { state: string } | undefined;
  if (!d || (d.state !== "published" && d.state !== "listed")) return;

  const l = db.prepare("SELECT from_user FROM links WHERE id = ?").get(linkId) as { from_user: number | null };
  const sharer = l.from_user ? getPerson(l.from_user) : null;
  const by = sharer?.canPublish ? sharer : everyone().find((p) => p.owner && p.canPublish);
  if (!by) return;

  try {
    const out = await publish(draftId, d.state === "listed" ? "list" : "publish", by);
    db.prepare("UPDATE drafts SET published_sha = ? WHERE id = ?").run(out.sha, draftId);
    log("cover.pushed", { draft: draftId, sha: out.sha, by: by.name }, linkId);
  } catch (e) {
    log("cover.push.failed", (e instanceof Error ? e.message : String(e)).slice(0, 300), linkId);
  }
}

/**
 * Attach the video, or just the text — after the fact.
 *
 * The word in the Telegram message decides it at the moment a link is shared,
 * which is where the choice belongs on a phone. This is the other half: the
 * piece is written, you are looking at it, and now you can see whether the
 * video earns its place.
 *
 * It flips one flag and republishes. Nothing is re-read, re-transcribed or
 * re-drawn — `watchFrom` derives the player from the link row every time
 * publish runs, which is the whole reason it was not stored on the draft.
 */
app.post("/draft/:id/attach", async (c) => {
  const id = Number(c.req.param("id"));
  const d = db.prepare("SELECT link_id, state FROM drafts WHERE id = ?").get(id) as
    | { link_id: number; state: string }
    | undefined;
  if (!d) return c.notFound();

  const now = (db.prepare("SELECT attach FROM links WHERE id = ?").get(d.link_id) as { attach: number | null }).attach;
  const next = now === 0 ? 1 : 0;
  db.prepare("UPDATE links SET attach = ?, updated_at = datetime('now') WHERE id = ?").run(next, d.link_id);
  log("watch.attach", { draft: id, attach: next }, d.link_id);

  /* Already out? Then the change has to reach the site, or the toggle is a
     button that agrees with you and does nothing. */
  if (d.state === "published" || d.state === "listed") {
    const by = me(c);
    if (by?.canPublish) {
      try {
        const out = await publish(id, d.state === "listed" ? "list" : "publish", by);
        db.prepare("UPDATE drafts SET published_sha = ? WHERE id = ?").run(out.sha, id);
        log("watch.pushed", { draft: id, sha: out.sha, attach: next }, d.link_id);
      } catch (e) {
        log("watch.push.failed", (e instanceof Error ? e.message : String(e)).slice(0, 300), d.link_id);
      }
    }
  }
  return c.redirect(`/draft/${id}`, 303);
});

/**
 * Cut the video's silent excerpt, or cut it again.
 *
 * For an article written before previews existed, and for one whose clip
 * ffmpeg could not make the first time. It does NOT re-ingest: the words are
 * already written and a picture is not worth rewriting them over.
 */
app.post("/draft/:id/clip", (c) => {
  const id = Number(c.req.param("id"));
  const d = db.prepare("SELECT link_id, slug FROM drafts WHERE id = ?").get(id) as
    | { link_id: number; slug: string }
    | undefined;
  if (!d) return c.notFound();

  db.prepare("INSERT INTO jobs (link_id, kind, payload) VALUES (?, 'clip', ?)").run(
    d.link_id,
    JSON.stringify({ draft: id }),
  );
  log("clip.queued", { draft: id, slug: d.slug }, d.link_id);
  return c.redirect(`/draft/${id}`, 303);
});

/**
 * Draw another one.
 *
 * The cover system reads the article and then picks from a fixed set, so a
 * redraw of the same piece lands on the same composition and the same palette
 * on purpose -- what changes is the seed, and the seed is most of what makes
 * one printing of a poster differ from the next. Press it twice and you get
 * two takes on one idea, which is the useful kind of variation. To get a
 * different IDEA, change the words in src/look.ts.
 *
 * Nothing else about the article is touched. The words are already written
 * and a picture is not worth rewriting them over.
 */
app.post("/draft/:id/redraw", (c) => {
  const id = Number(c.req.param("id"));
  const d = db.prepare("SELECT link_id, slug FROM drafts WHERE id = ?").get(id) as
    | { link_id: number; slug: string }
    | undefined;
  if (!d) return c.notFound();

  db.prepare("INSERT INTO jobs (link_id, kind, payload) VALUES (?, 'cover', ?)").run(
    d.link_id,
    JSON.stringify({ draft: id }),
  );
  log("cover.redraw.queued", { draft: id, slug: d.slug }, d.link_id);
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
async function act(
  c: { req: { param: (k: string) => string }; get: (k: "who") => Person },
  action: PublishAction,
  nextState: string,
) {
  const id = Number(c.req.param("id"));
  const by = me(c);
  if (by.revoked) return { ok: false as const, id, html: page("No", `<h1>Your access has been switched off</h1>`) };
  const d = db.prepare("SELECT id, link_id, slug FROM drafts WHERE id = ?").get(id) as
    | { id: number; link_id: number; slug: string }
    | undefined;
  if (!d) return { ok: false as const, id, html: null };

  try {
    const out = await publish(id, action, by);
    db.prepare("UPDATE drafts SET state = ?, published_sha = ? WHERE id = ?").run(nextState, out.sha, id);
    db.prepare("UPDATE links SET state = ?, updated_at = datetime('now') WHERE id = ?").run(
      nextState === "removed" ? "drafted" : nextState,
      d.link_id,
    );
    log(`draft.${action}`, { sha: out.sha, slug: d.slug, by: by.name }, d.link_id);
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

const runner = new Hono<Vars>();

runner.use("*", async (c, next) => {
  const given = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!sameSecret(given, RUNNER_SECRET)) return c.json({ error: "no" }, 401);
  await next();
});

/** "Anything for me?" — and the answer is the whole job, so one round trip. */
runner.post("/next", async (c) => {
  const { name, kinds } = (await c.req.json().catch(() => ({}))) as { name?: string; kinds?: string[] };
  beat(name ?? "?");
  reclaim();

  const want = kinds?.length ? kinds : ["write", "cover"];
  const marks = want.map(() => "?").join(",");
  const job = db
    .prepare(`SELECT * FROM jobs WHERE state = 'queued' AND kind IN (${marks}) ORDER BY id LIMIT 1`)
    .get(...want) as
    | { id: number; link_id: number; kind: string; attempts: number; payload: string | null }
    | undefined;

  if (!job) return c.json({ job: null });

  db.prepare("UPDATE jobs SET state='running', runner=?, taken_at=datetime('now'), attempts=attempts+1 WHERE id=?").run(
    name ?? "runner",
    job.id,
  );

  const link = db.prepare("SELECT * FROM links WHERE id = ?").get(job.link_id);

  /* A cover job needs the ARTICLE, not the source: its title and what it
     argues are what the picture stands for. */
  const payload = job.payload ? (JSON.parse(job.payload) as { draft?: number; job?: string }) : {};
  const draft = payload.draft
    ? db.prepare("SELECT id, slug, post FROM drafts WHERE id = ?").get(payload.draft)
    : null;

  log("job.taken", { job: job.id, kind: job.kind, runner: name }, job.link_id);
  return c.json({
    job: { id: job.id, kind: job.kind, attempt: job.attempts + 1, payload },
    link,
    draft,
  });
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
    /** A drawn cover, as base64 webp. */
    cover?: { draft: number; slug: string; webp: string; alt: string; caption: string };
    /** A silent excerpt of the video and its first frame, both base64. */
    preview?: { loop: string; clip: string; poster: string; seconds: number; whole: boolean };
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
    const tries = (db.prepare("SELECT attempts FROM jobs WHERE id = ?").get(id) as { attempts: number }).attempts;
    const done = tries >= 3;
    db.prepare("UPDATE jobs SET state=?, runner=NULL, taken_at=NULL, error=? WHERE id=?").run(
      done ? "stuck" : "queued",
      (body.error ?? "").slice(0, 500),
      id,
    );
    log("job.failed", { why: body.error, attempt: tries, gaveUp: done }, job.link_id);

    /* A cover that will not draw must not hold the article. The journal draws
       its own plate for a piece with no picture, and a written article sitting
       unpublished because of a failed image is the worse outcome. */
    const kind = (db.prepare("SELECT kind, payload FROM jobs WHERE id = ?").get(id) as {
      kind: string;
      payload: string | null;
    });
    if (done && kind.kind === "cover" && kind.payload) {
      const draft = (JSON.parse(kind.payload) as { draft?: number }).draft;
      if (draft) void autoPublish(draft, job.link_id);
    }
    return c.json({ ok: true });
  }

  db.prepare("UPDATE jobs SET state='done', finished_at=datetime('now'), error=NULL WHERE id=?").run(id);

  /* A drawn cover: bytes, and the two lines that go with it. */
  if (body.cover) {
    saveCover(body.cover.slug, Buffer.from(body.cover.webp, "base64"));
    db.prepare("UPDATE drafts SET cover_alt = ?, cover_caption = ? WHERE id = ?").run(
      body.cover.alt,
      body.cover.caption,
      body.cover.draft,
    );
    log("cover.drawn", { slug: body.cover.slug, bytes: body.cover.webp.length }, job.link_id);

    /* The picture was the last thing missing. Finish the job. */
    void autoPublish(body.cover.draft, job.link_id);
    /* Unless the article is already out, in which case the new picture has to
       be walked over to the site itself — a redraw that only lands in the
       desk's database is a redraw nobody can see. */
    void pushCover(body.cover.draft, job.link_id);
  }

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
  /* The silent excerpt, kept under the SLUG so it is found the same way the
     cover is. It arrives with the ingest result, before the draft row exists,
     which is why this sits above the insert rather than beside `source`. */
  if (body.preview && body.slug) {
    saveClip(
      body.slug,
      {
        loop: Buffer.from(body.preview.loop, "base64"),
        clip: Buffer.from(body.preview.clip, "base64"),
        poster: Buffer.from(body.preview.poster, "base64"),
      },
      { seconds: body.preview.seconds, whole: body.preview.whole },
    );
    log(
      "preview.kept",
      { slug: body.slug, kb: Math.round(body.preview.clip.length / 1365), seconds: body.preview.seconds },
      job.link_id,
    );

    /* A clip cut for an article that is already out has to be walked to the
       site, exactly as a redrawn cover is. On an INGEST the draft does not
       exist yet and publish happens on its own a minute later, so there is
       nothing to push and `payload.draft` is empty. */
    const payload = (db.prepare("SELECT payload FROM jobs WHERE id = ?").get(id) as { payload: string | null })
      .payload;
    const forDraft = payload ? (JSON.parse(payload) as { draft?: number }).draft : undefined;
    if (forDraft) void pushCover(forDraft, job.link_id);
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

    /* And draw it a cover, unasked. Fini: "remember I need this to be
       automated." A cover job is queued the moment an article exists, so the
       workstation picks it up on its next poll and nobody has to think about
       it. It is deliberately a SEPARATE job: drawing needs ComfyUI, writing
       needs Ollama, and the two must not run at once on one card. */
    const draftId = Number(
      (db.prepare("SELECT MAX(id) id FROM drafts WHERE link_id = ?").get(job.link_id) as { id: number }).id,
    );
    db.prepare("INSERT INTO jobs (link_id, kind, payload) VALUES (?, 'cover', ?)").run(
      job.link_id,
      JSON.stringify({ draft: draftId }),
    );
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

      if (msg.from?.id) remember(msg.from.id, name);

      /* The bot no longer hands out a way in. Signing in is a Google account
         on the company's own domain; Telegram's job is sharing links and
         whose name goes on the article. */
      if (/^\/login\b/.test(text)) {
        await send(
          chat,
          `The desk is at ${process.env.DESK_URL ?? "https://desk.balkaris.ch"} — sign in there with your ` +
            `<b>@${DOMAIN}</b> Google account. Telegram is for sharing links, and for whose name goes on the article.`,
        );
        return;
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
