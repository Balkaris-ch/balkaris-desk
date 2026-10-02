import { runNow } from "../scheduler.ts";
import { setState, state } from "../store.ts";

/**
 * Ask the scheduler for a job because something it depends on moved, in a way
 * that survives a restart.
 *
 * `runNow` only queues in memory: a desk that restarts before the queued job
 * starts (every deploy, every save on the workstation) forgets the request.
 * So the caller does not ask once and remember that it asked. It compares
 * what the job last WORKED ON (the sitemap's addresses the crawl read, the
 * public/ folder the assets were measured at) with what is there now, and
 * calls this whenever the two differ, on every run of its own.
 *
 * This keeps that from becoming a stampede: the same `wanted` is asked for at
 * most once an hour, so a job that keeps failing is tried hourly, not every
 * five minutes. A new `wanted` (the sitemap changed again) is asked for at
 * once. Returns whether the job was asked for now.
 */
export function askFor(job: string, wanted: string, everyMs = 3_600_000): boolean {
  const key = `site:asked:${job}`;
  const had = state(key) ?? "";
  const cut = had.lastIndexOf("|");
  const was = cut < 0 ? "" : had.slice(0, cut);
  const at = cut < 0 ? 0 : Number(had.slice(cut + 1)) || 0;
  if (was === wanted && Date.now() - at < everyMs) return false;
  if (!runNow(job)) return false;
  setState(key, `${wanted}|${Date.now()}`);
  return true;
}
