import { db } from "../../../db.ts";
import { registerSource } from "../../sources.ts";
import type { SourceStatus } from "../../../../web/src/contract/common.ts";
import * as dfs from "./dataforseo.ts";
import { laneState, workstation } from "./fetchq.ts";
import { sourcePaused } from "./suggest.ts";
import { whenText } from "./shared.ts";

/**
 * The web layer's lanes among the desk's sources (Settings › Sources and the
 * top bar's light), so a refusal by Google or a workstation that is off is
 * seen where every other source is, not only on Keywords and Competitors.
 * Each reads the web layer's own tables and pauses: drawing the list asks
 * nobody anything.
 *
 *   Google result pages   fetched by the studio workstation (the fetch door),
 *                         or by DataForSEO when that account exists
 *   Search suggestions    Google's and Bing's suggestions, DuckDuckGo's page
 *                         and the lookups of any domain, read by the server
 */

/** The newest time a query of the web layer's tables answered, or null; a table not yet made answers null. */
function newest(sql: string): string | null {
  try {
    return (db.prepare(sql).get() as { at: string | null } | undefined)?.at ?? null;
  } catch {
    return null;
  }
}

export function googlePagesStatus(): SourceStatus {
  const lastOk = newest("SELECT MAX(done_at) AS at FROM cc_seo_serp_checks WHERE engine = 'google' AND state = 'done'");
  const common = { id: "runner" as const, name: "Google result pages", feeds: "Who ranks for a phrase on google.ch (Keywords, Competitors, the weekly rank check)", lastOk };
  if (dfs.configured()) return { ...common, state: lastOk ? "connected" : "waiting" };
  const lane = laneState("google");
  if (lane.paused) return { ...common, state: "waiting", error: `${lane.paused.why}; paused until ${whenText(lane.paused.until)}.` };
  const ws = workstation();
  if (!ws.on) return { ...common, state: "waiting", error: ws.line };
  return { ...common, state: lastOk ? "connected" : "waiting" };
}

export function suggestionsStatus(): SourceStatus {
  const lastOk = newest("SELECT MAX(asked_at) AS at FROM cc_seo_research");
  const common = { id: "desk" as const, name: "Search suggestions and lookups", feeds: "Google's and Bing's suggestions for research, DuckDuckGo's second opinion and the lookup of any domain", lastOk };
  const stops = (["google", "bing"] as const)
    .map((s) => ({ s, p: sourcePaused(s) }))
    .filter((x) => x.p)
    .map((x) => `${x.s === "google" ? "Google" : "Bing"}: ${x.p!.why}, paused until ${whenText(x.p!.until)}`);
  if (stops.length) return { ...common, state: "waiting", error: `${stops.join("; ")}.` };
  return { ...common, state: lastOk ? "connected" : "waiting" };
}

registerSource(googlePagesStatus, suggestionsStatus);
