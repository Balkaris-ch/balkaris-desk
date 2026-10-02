import { Hono } from "hono";
import type { Vars } from "./access.ts";
import { buildApi } from "./api.ts";
import { SECTIONS } from "./find.ts";
import { register, start, type Job } from "./scheduler.ts";
import { registerCheck } from "./sources.ts";
import type { ApiError } from "../../web/src/contract/common.ts";

/**
 * The command center, bolted onto the desk in one call.
 *
 *   const { mountCommandCenter } = await import("./cc/index.ts");
 *   await mountCommandCenter(app);    once, in src/server.ts, before it listens
 *
 * It loads the collectors and registers their jobs, loads the fifteen screen
 * routers and mounts the API at /api/v1, mounts the Vercel drain's door at
 * /drain (public, proven by its signature), then starts the scheduler.
 *
 * WHY THE COLLECTORS AND SCREENS ARE LOADED WITH `import()` AND NOT `import`.
 * The desk publishes articles, and that must survive anything that goes wrong
 * in here. A static import cannot give that: the whole graph is evaluated
 * before one line of the importing file runs, so a collector that throws
 * while loading (a typo, a table it cannot create, a file it expects) would
 * stop src/server.ts from starting at all, and there is no line on which to
 * catch it. A dynamic import is a promise, and a promise can be caught. So
 * each part is loaded on its own, and one that fails is:
 *
 *   - written to the log, loudly, with what it threw;
 *   - a failing check on the top bar's light, by name, so it is not silent;
 *   - for a screen, an address that answers 503 `{ error }` instead of 404;
 *
 * and every other screen and collector carries on.
 *
 * The shared modules this file imports statically (scheduler, store, sources,
 * access, api, find, system) are the foundation: if one of THEM throws while
 * loading there is no command center to mount. That still does not stop the
 * desk. src/server.ts loads this file the same way, with `import()` inside a
 * try, so Telegram, the runner and the console start regardless and /api
 * answers 503 with the reason in the log.
 *
 * It has to be awaited BEFORE the server listens: Hono fixes its routes on
 * the first request and refuses any added afterwards.
 */

/** The first line of whatever was thrown, short enough to show. */
const said = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0].slice(0, 160);

/**
 * Load one part of the command center, or say why it could not be.
 *
 * Returns what `use` made of the module, or null after logging the failure
 * and registering it as a failing check called "<what> loads". Exported so the
 * check script can prove a broken module is survived.
 */
export async function loadPart<M, T>(what: string, load: () => Promise<M>, use: (mod: M) => T): Promise<T | null> {
  try {
    return use(await load());
  } catch (e) {
    console.error(`cc: ${what} did not load and is switched off until the desk is fixed and restarted:`, e);
    const detail = said(e);
    registerCheck(() => ({ name: `${what} loads`, ok: false, detail }));
    return null;
  }
}

const collectors: [string, () => Promise<{ jobs: Job[] }>][] = [
  ["The GA4 collector", () => import("./ga4.ts")],
  ["The website collector", () => import("./site/index.ts")],
  ["The search collector", () => import("./search/index.ts")],
  ["The Vercel collector", () => import("./vercel/index.ts")],
  ["The SEO engine", () => import("./seo/index.ts")],
];

/* Written out one by one, not built from a name, so the typechecker follows
   each import and a missing file is found before the box finds it. */
const screens: Record<string, () => Promise<{ routes: Hono<Vars> }>> = {
  overview: () => import("./routes/overview.ts"),
  insights: () => import("./routes/insights.ts"),
  traffic: () => import("./routes/traffic.ts"),
  seo: () => import("./routes/seo.ts"),
  pages: () => import("./routes/pages.ts"),
  content: () => import("./routes/content.ts"),
  conversions: () => import("./routes/conversions.ts"),
  leads: () => import("./routes/leads.ts"),
  experiments: () => import("./routes/experiments.ts"),
  health: () => import("./routes/health.ts"),
  hosting: () => import("./routes/hosting.ts"),
  automations: () => import("./routes/automations.ts"),
  assets: () => import("./routes/assets.ts"),
  operator: () => import("./routes/operator.ts"),
  settings: () => import("./routes/settings.ts"),
};

/**
 * The job as given, with a `ready()` that cannot throw.
 *
 * The scheduler asks every job's ready() from a timer, with nothing around it
 * to catch a throw, and Node stops the whole process on a rejection nobody
 * handles: one collector's bad ready() would take Telegram's door down with
 * it, at every boot. So a ready() that throws counts as "not ready" (listed,
 * never run, never a failing check) and says why in the log, once per job.
 * run() needs no such wrapper: the scheduler already turns its throw into a
 * failed run.
 */
export function guarded(job: Job): Job {
  const ready = job.ready;
  if (!ready) return job;
  let told = false;
  return {
    ...job,
    ready: () => {
      try {
        return ready();
      } catch (e) {
        if (!told) console.error(`cc: job ${job.name}'s ready() threw, so it counts as not ready:`, e);
        told = true;
        return false;
      }
    },
  };
}

const extra: [string, string, () => Promise<{ routes: Hono<Vars> }>][] = [
  ["article", "Article", () => import("./routes/article.ts")],
  ["spider", "Spider", () => import("./routes/spider.ts")],
];

/** What a screen answers when its own code could not be loaded. */
function unavailable(title: string): Hono<Vars> {
  const stub = new Hono<Vars>();
  stub.all("*", (c) =>
    c.json<ApiError>({ error: `${title} is unavailable: its server code did not load. The reason is under the top bar's light.` }, 503),
  );
  return stub;
}

/** Load the collectors and screens, mount /api/v1 on `app`, start the scheduler. Await it before listening. */
export async function mountCommandCenter(app: Hono<Vars>): Promise<void> {
  for (const [what, load] of collectors) {
    await loadPart(what, load, (mod) => {
      if (!Array.isArray(mod.jobs)) throw new Error("it does not export `jobs` as a list");
      register(...mod.jobs.map(guarded));
    });
  }

  const routers: Record<string, Hono<Vars>> = {};
  for (const { name, title } of SECTIONS) {
    const loaded = await loadPart(`The ${title} screen`, screens[name], (mod) => {
      if (!(mod.routes instanceof Hono)) throw new Error("it does not export `routes` as a Hono router");
      return mod.routes;
    });
    routers[name] = loaded ?? unavailable(title);
  }

  /* Routers that are not sections of the sidebar: one article, opened from
     the Insights screen. Kept out of SECTIONS so search never offers them. */
  for (const [name, title, load] of extra) {
    const loaded = await loadPart(`The ${title} screen`, load, (mod) => {
      if (!(mod.routes instanceof Hono)) throw new Error("it does not export `routes` as a Hono router");
      return mod.routes;
    });
    routers[name] = loaded ?? unavailable(title);
  }

  app.route("/api/v1", buildApi(routers));

  /* Vercel's log drain delivers here. Outside /api: it is a machine door,
     let past sign-in by src/server.ts and proven by its signature alone. A
     door whose code did not load answers 503, which Vercel reports as an
     errored drain, rather than 404. */
  const door = await loadPart("The Vercel drain's door", () => import("./vercel/drain.ts"), (mod) => {
    if (!(mod.door instanceof Hono)) throw new Error("it does not export `door` as a Hono router");
    return mod.door;
  });
  app.route("/drain", door ?? unavailable("The Vercel drain's door"));

  start();
}
