import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { me, requireOwner, toMe, type Vars } from "./access.ts";
import { find } from "./find.ts";
import { runNow, setEnabled, status } from "./scheduler.ts";
import { activity, note } from "./store.ts";
import { scrub, scrubItem, systemStatus } from "./system.ts";
import type { ActivityItem, ApiError, JobAnswer, JobListed, Me, SearchHit, SystemStatus } from "../../web/src/contract/common.ts";

/**
 * /api/v1 — what the interface asks the desk.
 *
 * JSON in, JSON out, and nothing else: no page is ever rendered here. The
 * server's gate (src/server.ts) stands in front of all of it, so every handler
 * below can assume a signed-in person who is not revoked, and that a request
 * which changes something came from the desk's own pages.
 *
 * The routes in this file are the ones no screen owns: who am I, is everything
 * up, what happened, the scheduled jobs, the search box. Each screen then has
 * a router of its own under its name (src/cc/routes/<name>.ts), mounted by
 * `buildApi` at /api/v1/<name>.
 *
 * AN ERROR IS ALWAYS `{ error }`. A handler that throws, a path that does not
 * exist, a screen whose code failed to load: each answers with one sentence
 * and a status that fits. Never an HTML page, never a stack trace.
 */

/**
 * Turn anything a handler threw into `{ error }`.
 *
 * What was thrown is written to the server's log in full. The answer carries
 * its first line on a workstation, where the person reading it is the one who
 * wrote the handler, and one fixed sentence on the box: a thrown message can
 * hold a request address with a key in it, and that must not reach a browser.
 * Throw an `HTTPException` to choose the status and the sentence yourself.
 */
export function apiError(err: unknown, c: Context): Response {
  if (err instanceof HTTPException) {
    return c.json<ApiError>({ error: err.message || "The desk refused that." }, err.status);
  }
  /* zod, if a route validates with it: the first thing wrong, in its words. */
  const issues = (err as { name?: string; issues?: { path?: unknown[]; message?: string }[] } | null)?.issues;
  if ((err as { name?: string } | null)?.name === "ZodError" && Array.isArray(issues) && issues[0]) {
    const at = (issues[0].path ?? []).join(".");
    return c.json<ApiError>({ error: `That request is not right${at ? ` at "${at}"` : ""}: ${issues[0].message ?? "invalid"}` }, 400);
  }

  console.error(`api ${c.req.method} ${c.req.path} failed:`, err);
  const said = (err instanceof Error ? err.message : String(err)).split(/\r?\n/)[0].slice(0, 200);
  return c.json<ApiError>(
    { error: process.env.NODE_ENV === "production" ? "The desk could not answer that. The reason is in its log." : said || "The handler threw." },
    500,
  );
}

/** A job as a browser is shown it: what its last run said, and what it is doing, through `scrub`. */
const shown = (j: JobListed): JobListed => ({
  ...j,
  lastNote: j.lastNote === null ? null : scrub(j.lastNote),
  progress: j.progress?.what ? { ...j.progress, what: scrub(j.progress.what) } : j.progress,
});

/** One job by name, as shown, or undefined. */
const oneJob = (name: string): JobListed | undefined => {
  const j = status().find((x) => x.name === name);
  return j && shown(j);
};

/**
 * The shortest gap between two runs of one job that a person can ask for:
 * its own interval, and never more than ten minutes. The crawler, the
 * PageSpeed sweep and the asset reader have no budget of their own, so a
 * refresh button pressed twenty times must not read the website twenty times.
 */
const floorMs = (j: JobListed): number => Math.min(j.every, 600) * 1000;

/** When somebody last asked for each job through the API, in ms. Lost on restart, which only shortens one wait. */
const askedAt = new Map<string, number>();

/** "4 minutes", "40 seconds": a wait, for a sentence. */
const inWords = (s: number): string => (s >= 90 ? `${Math.round(s / 60)} minutes` : `${s} seconds`);

/** A whole number from a query string, kept inside a range; `fallback` when it is absent or not a number. */
const within = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(raw);
  return raw && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/**
 * The API, with each screen's router mounted under its name.
 *
 * `screens` is handed in by src/cc/index.ts rather than imported here, so a
 * screen whose module fails to load costs that one screen and not the desk.
 */
export function buildApi(screens: Record<string, Hono<Vars>>): Hono<Vars> {
  const api = new Hono<Vars>();
  api.onError(apiError);

  /* Nothing here may be kept by a browser or a proxy: it is figures that are
     stale in minutes and, under /leads, people's names. */
  api.use("*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
  });

  /* Who is looking. The interface asks this first on every page. */
  api.get("/me", (c) => c.json<Me>(toMe(me(c))));

  /* The top bar's light, the sources behind Settings, and the bell. */
  api.get("/system", (c) => c.json<SystemStatus>(systemStatus()));

  /* Things that happened, newest first. ?limit=20 (1-100) ?kinds=a,b */
  api.get("/activity", (c) => {
    const kinds = (c.req.query("kinds") ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter((k) => /^[\w.-]{1,40}$/.test(k))
      .slice(0, 12);
    return c.json<ActivityItem[]>(activity(within(c.req.query("limit"), 20, 1, 100), kinds.length ? kinds : undefined).map(scrubItem));
  });

  /* Every scheduled job: JobStatus, plus `ready` (false while its credential
     does not exist) and `progress` while it runs. */
  api.get("/jobs", (c) => c.json<JobListed[]>(status().map(shown)));

  /* Run one now, ahead of the queue. Anybody signed in may: it is the
     "refresh" behind a screen, and the scheduler still runs one job at a
     time. What it may not do is overrule the owner or hammer a source:

       409  not ready (what it reads is not connected), or switched off by
            the owner, which a refresh button does not undo;
       429  running now, or started or asked for less than `floorMs` ago;
            Retry-After says how many seconds until it may be asked again. */
  api.post("/jobs/:name/run", (c) => {
    const name = c.req.param("name");
    const job = oneJob(name);
    if (!job) return c.json<ApiError>({ error: `There is no job called "${name}".` }, 404);
    if (!job.ready) return c.json<ApiError>({ error: `"${job.title}" cannot run yet: what it reads is not connected.` }, 409);
    if (!job.enabled) {
      return c.json<ApiError>({ error: `"${job.title}" is switched off. The owner can switch it back on in Automations.` }, 409);
    }

    const now = Date.now();
    if (job.running) {
      c.header("retry-after", "30");
      return c.json<ApiError>({ error: `"${job.title}" is running now.` }, 429);
    }
    const last = Math.max(job.lastStart ? Date.parse(job.lastStart) : 0, askedAt.get(name) ?? 0);
    const wait = Math.ceil((last + floorMs(job) - now) / 1000);
    if (wait > 0) {
      c.header("retry-after", String(wait));
      return c.json<ApiError>({ error: `"${job.title}" was asked for or ran a moment ago. It can be asked for again in ${inWords(wait)}.` }, 429);
    }

    if (!runNow(name)) return c.json<ApiError>({ error: `"${job.title}" cannot run yet: what it reads is not connected.` }, 409);
    askedAt.set(name, now);
    /* 202: it has been asked for, not done. GET /jobs says when it is. */
    return c.json<JobAnswer>({ ok: true, job: oneJob(name) ?? job }, 202);
  });

  /* Switch a job off or back on. Body: { "enabled": boolean }. The owner
     only: a job that is off stops a part of the desk from being true. */
  api.post("/jobs/:name/enabled", requireOwner, async (c) => {
    const name = c.req.param("name");
    const body = (await c.req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== "boolean") {
      return c.json<ApiError>({ error: 'Send { "enabled": true } or { "enabled": false }.' }, 400);
    }
    const job = oneJob(name);
    if (!job) return c.json<ApiError>({ error: `There is no job called "${name}".` }, 404);

    setEnabled(name, body.enabled);
    if (job.enabled !== body.enabled) {
      note("automation", `"${job.title}" was switched ${body.enabled ? "on" : "off"}`, {
        tone: body.enabled ? "info" : "warn",
        actor: me(c).name,
        href: "/automations",
      });
    }
    return c.json<JobAnswer>({ ok: true, job: oneJob(name) ?? job });
  });

  /* The search box. ?q= of two characters or more; fewer finds nothing. */
  api.get("/search", async (c) => c.json<SearchHit[]>(await find(c.req.query("q") ?? "", me(c))));

  for (const [name, routes] of Object.entries(screens)) api.route(`/${name}`, routes);

  /* Last, so it only answers what nothing above did. */
  api.all("*", (c) => c.json<ApiError>({ error: `There is nothing at ${c.req.method} ${c.req.path}.` }, 404));

  return api;
}
