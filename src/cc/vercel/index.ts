import type { Job } from "../scheduler.ts";
import { vercelJob } from "./api.ts";
import { engineJob } from "./engine.ts";
import { statusJob } from "./status.ts";
import "./drain.ts";

/**
 * The Hosting screen's collector: what only Vercel knows, and the engine.
 *
 *   drain.ts    Vercel's request records, delivered to POST /drain/vercel and
 *               turned into page views by stated rules. No job: Vercel sends.
 *               The door itself is mounted by src/cc/index.ts.
 *   api.ts      the Vercel REST API, with a desk-only project token          every 10 min
 *   status.ts   Vercel's public status page                                  every 5 min
 *   engine.ts   the engine's /health, over loopback; the public one hourly   every 2 min
 *
 * Each registers its own source (Settings) and, where it vouches for
 * something, its own check (the top bar's light). Everything a screen reads
 * is re-exported here, so src/cc/routes/hosting.ts imports from this file only
 * (with `import()`, so a collector that fails to load costs panels, not the screen).
 */

export const jobs: Job[] = [engineJob, statusJob, vercelJob];

export { classify, deliveredDays, deliveriesOn, drainState, kindsBetween, MARKER_MIN_VIEWS, markerGaps, QUIET_MS, RULES, topBetween, viewsPerDay, VIEW_KINDS } from "./drain.ts";
export type { Decided, DrainState } from "./drain.ts";
export { buildLog, configured as vercelConfigured, NO_TOKEN, partOf, TOKEN_STEP, VercelError } from "./api.ts";
export type { Part } from "./api.ts";
export { platform, statusError } from "./status.ts";
export { engineLocal, enginePublic, engineUrls } from "./engine.ts";
