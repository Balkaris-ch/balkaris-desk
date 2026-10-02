import { db } from "../../db.ts";
import type { Job } from "../scheduler.ts";
import { registerSource } from "../sources.ts";
import { keep, kept, note, setState, state } from "../store.ts";
import type { PlatformComponent, PlatformIncident, PlatformStatus } from "../../../web/src/contract/hosting.ts";

/**
 * Vercel's own status page, for the parts of Vercel this website stands on.
 *
 * https://www.vercel-status.com/api/v2/summary.json is public (Atlassian
 * Statuspage, no key) and says max-age=10. Read every five minutes.
 *
 * FILTERED BY COMPONENT ID, NEVER BY NAME: the page has 67 components and
 * names repeat ("Builds" twice, "Dashboard" three times). The ones watched:
 *
 *   CDN in the region that serves the site: the edge region the desk's own
 *        probes record (x-vercel-id, "fra1"), looked up in the CDN group by
 *        its code; and the region the site's functions run in, when the
 *        probes have seen one ("iad1"). FRA1's id is the fallback.
 *   Builds (in Build & Deploy), Functions, API: fixed ids, read 2 Oct 2026.
 *
 * An unresolved incident that touches one of them, or names no component at
 * all, becomes one line in the activity feed; its end becomes another.
 */

const SUMMARY = "https://www.vercel-status.com/api/v2/summary.json";
const PAGE = "https://www.vercel-status.com";

const CDN_GROUP = "j7g76bfzc8hw";
const FRA1 = "zwrthypbz06f";
const FIXED: { id: string; why: string }[] = [
  { id: "7ckq6xr6nsbv", why: "Builds: every push to main is a production build" },
  { id: "kgcsn9c73xzf", why: "Functions: the site's /api routes (enquiries, booking, the AI)" },
  { id: "rxynwj392p81", why: "API: what the desk reads builds and domains from" },
];

interface SpComponent {
  id: string;
  name: string;
  status: string;
  group_id: string | null;
  group?: boolean;
}

interface SpIncident {
  id: string;
  name: string;
  status: string;
  impact: string;
  created_at: string;
  started_at?: string;
  shortlink?: string;
  components?: { id: string; name: string }[];
}

interface Summary {
  page?: { updated_at?: string };
  status?: { indicator?: string; description?: string };
  components?: SpComponent[];
  incidents?: SpIncident[];
}

/** The regions the desk's probes saw serving the site: the edge first, then where its functions ran. */
function regionsSeen(): { region: string; role: "edge" | "functions" }[] {
  try {
    const edge = db.prepare("SELECT region AS r FROM cc_probes WHERE target = 'home' AND region IS NOT NULL ORDER BY id DESC LIMIT 1").get() as { r: string } | undefined;
    const fn = db.prepare("SELECT fn_region AS r FROM cc_probes WHERE fn_region IS NOT NULL ORDER BY id DESC LIMIT 1").get() as { r: string } | undefined;
    const out: { region: string; role: "edge" | "functions" }[] = [];
    if (edge?.r) out.push({ region: edge.r.toLowerCase(), role: "edge" });
    if (fn?.r && fn.r.toLowerCase() !== edge?.r?.toLowerCase()) out.push({ region: fn.r.toLowerCase(), role: "functions" });
    return out;
  } catch {
    /* the probes' table does not exist yet: the site collector has not loaded */
    return [];
  }
}

/** The watched components, with why each is watched. */
function watched(all: SpComponent[]): { id: string; why: string }[] {
  const cdn = all.filter((c) => c.group_id === CDN_GROUP);
  const regions = regionsSeen();
  const out: { id: string; why: string }[] = [];
  for (const { region, role } of regions) {
    const hit = cdn.find((c) => c.name.toUpperCase().startsWith(`${region.toUpperCase()} `));
    if (hit) out.push({ id: hit.id, why: role === "edge" ? `CDN: the edge that answers the desk's checks (${region})` : `CDN: the region the site's functions run in (${region})` });
  }
  if (!out.length) out.push({ id: FRA1, why: "CDN: Frankfurt, the edge that served the site when the desk last looked (fra1)" });
  return [...out, ...FIXED];
}

export function parse(s: Summary, at: string): PlatformStatus {
  const all = s.components ?? [];
  const byId = new Map(all.map((c) => [c.id, c]));
  const watch = watched(all);
  const ids = new Set(watch.map((w) => w.id));
  const components: PlatformComponent[] = watch.map((w) => {
    const c = byId.get(w.id);
    return { id: w.id, name: c?.name ?? w.id, why: w.why, status: c?.status ?? "not on the status page" };
  });
  const incidents: PlatformIncident[] = (s.incidents ?? [])
    .map((i) => ({
      id: i.id,
      name: i.name,
      status: i.status,
      impact: i.impact,
      startedAt: i.started_at ?? i.created_at ?? at,
      link: i.shortlink ?? `${PAGE}/incidents/${i.id}`,
      touches: (i.components ?? []).filter((c) => ids.has(c.id)).map((c) => c.name),
      names: (i.components ?? []).length,
    }))
    .sort((a, b) => b.touches.length - a.touches.length || b.startedAt.localeCompare(a.startedAt))
    .map(({ names: _names, ...i }) => i);
  return { indicator: s.status?.indicator ?? "unknown", description: s.status?.description ?? "No summary on the page.", components, incidents };
}

/** Read the page, keep what is watched, and write an incident's start and end into the feed. */
export async function readStatus(): Promise<PlatformStatus> {
  const res = await fetch(SUMMARY, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Vercel's status page answered ${res.status}.`);
  const s = (await res.json()) as Summary;
  const now = new Date().toISOString();
  const status = parse(s, now);
  keep("vercel:status", status);
  setState("vercel-status:ok", now);
  setState("vercel-status:err", "");

  /* An incident that touches a watched part, or names none: one line when it opens, one when it is gone. */
  const relevant = (s.incidents ?? []).filter((i) => !(i.components ?? []).length || status.incidents.find((x) => x.id === i.id)?.touches.length);
  for (const i of relevant) {
    note("vercel", `Vercel reports: ${i.name}`, {
      tone: i.impact === "critical" || i.impact === "major" ? "bad" : "warn",
      at: i.started_at ?? i.created_at,
      detail: `${i.status}, impact ${i.impact}. ${(i.components ?? []).map((c) => c.name).join(", ") || "No component named."}`,
      href: i.shortlink ?? `${PAGE}/incidents/${i.id}`,
      dedupe: `vercel-status:${i.id}:open`,
    });
  }
  let open: string[] = [];
  try {
    open = JSON.parse(state("vercel-status:open") ?? "[]") as string[];
  } catch {
    open = [];
  }
  const nowOpen = relevant.map((i) => i.id);
  for (const id of open.filter((x) => !nowOpen.includes(x))) {
    note("vercel", "Vercel's incident is no longer listed as unresolved", { tone: "good", href: `${PAGE}/incidents/${id}`, dedupe: `vercel-status:${id}:closed` });
  }
  setState("vercel-status:open", JSON.stringify(nowOpen));
  return status;
}

export const statusJob: Job = {
  name: "vercel-status",
  title: "Read Vercel's status page",
  every: 5 * 60,
  delay: 30,
  run: async () => {
    try {
      const s = await readStatus();
      const down = s.components.filter((c) => c.status !== "operational");
      return down.length ? `${down.map((c) => `${c.name}: ${c.status}`).join("; ")}` : `${s.components.length} watched parts operational; ${s.incidents.length} unresolved incidents on the page`;
    } catch (e) {
      setState("vercel-status:err", (e instanceof Error ? e.message : String(e)).slice(0, 200));
      throw e;
    }
  },
};

/** The kept page, with when it was read. */
export function platform(): { value: PlatformStatus; at: number } | null {
  const k = kept<PlatformStatus>("vercel:status");
  return k ? { value: k.value, at: k.at } : null;
}

export const statusError = (): string => state("vercel-status:err") || "";

registerSource(() => {
  const lastOk = state("vercel-status:ok") || null;
  const error = statusError();
  /* One missed read of somebody else's page is not a failure of the desk: failing only when nothing was read for half an hour. */
  const stale = !lastOk || Date.now() - Date.parse(lastOk) > 30 * 60_000;
  return {
    id: "vercel-status",
    name: "Vercel's status page",
    feeds: "Hosting: the state of the CDN region, builds, functions and the API",
    lastOk,
    state: error && stale ? "failing" : lastOk ? "connected" : "waiting",
    ...(error ? { error } : {}),
  };
});
