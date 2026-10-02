import type { Job } from "../scheduler.ts";
import { registerSource } from "../sources.ts";
import { cached, kept, note, setState, state } from "../store.ts";
import type { AttackStatus, BuildLog, BuildRow, BuildState, DomainRow, ProductionNow } from "../../../web/src/contract/hosting.ts";

/**
 * What only Vercel knows about the website's hosting, read from the Vercel
 * REST API with a DESK-ONLY token (DESK_VERCEL_TOKEN), scoped by its owner to
 * the one project. Never the team-wide token of balkaris-cms.
 *
 * Every endpoint is the documented one (https://vercel.com/openapi.json, read
 * 2 Oct 2026):
 *
 *   GET /v7/deployments?projectId&target=production&limit=20   the builds
 *   GET /v13/deployments/{id}?withGitRepoInfo=true              a build's commit,
 *                                                                its errorStep
 *   GET /v3/deployments/{id}/events?direction=backward&limit=N  a failed build's
 *                                                                log, on demand
 *   GET /v9/projects/{id}                                       production, its
 *                                                                aliases, firewall
 *   GET /v9/projects/{id}/domains                               the domains
 *   GET /v1/security/firewall/attack-status?projectId&since=1   anomalies, 1 day
 *
 * One job reads them every ten minutes (about six calls), so a screen never
 * waits on Vercel; the build log is the one read made when a person asks.
 *
 * RATE LIMITS. A 429 carries `error.limit.resetMs`; the endpoint is then not
 * asked again before that moment, whoever asks. The firewall's attack status
 * allows 20 calls a minute per user, shared with the owner's CLI: this asks
 * once in ten minutes.
 *
 * WHAT A REFUSAL MEANS. 401: the token is wrong, revoked or expired, and the
 * source is failing. 403 on one endpoint: this token may not read that, and
 * only that panel is off.
 *
 * The token is sent in a header and nowhere else: never in an address, a log
 * line or an error message.
 */

const API = "https://api.vercel.com";
const token = (): string => (process.env.DESK_VERCEL_TOKEN ?? "").trim();
export const projectId = (): string => (process.env.VERCEL_PROJECT_ID ?? "").trim() || "prj_WTjPcDZitjDlW32Cp5920AVLkAj4";
export const teamId = (): string => (process.env.VERCEL_TEAM_ID ?? "").trim() || "team_5UuOgxnAJbCKU9YpCk22o5aV";
export const configured = (): boolean => !!token();

export const NO_TOKEN = "The desk has no Vercel token: builds, domains and the firewall are read with a desk-only token scoped to the website's project.";
export const TOKEN_STEP =
  "At https://vercel.com/account/tokens create a token named desk-hosting, Scope: team balkaris, then the project balkaris-web-infrastructure (not All Projects), expiry 1 year; then run bash deploy/env-put.sh --ask DESK_VERCEL_TOKEN.";

export class VercelError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "VercelError";
  }
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** One GET to the API. `bucket` names the rate limit it counts against. Throws a VercelError, whose message never holds the token. */
async function get<T>(bucket: string, path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  if (!token()) throw new VercelError(0, NO_TOKEN);
  const until = Number(state(`vercel:wait:${bucket}`) ?? "0");
  if (until > Date.now()) throw new VercelError(429, `Vercel asked the desk to wait until ${iso(until).slice(11, 16)} UTC before asking this again (rate limit).`);

  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set("teamId", teamId());
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token()}`, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new VercelError(0, `Vercel's API did not answer: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const err = (json as { error?: { code?: string; message?: string; limit?: { resetMs?: number; reset?: number } } } | null)?.error;
  if (res.status === 429) {
    /* resetMs is a moment in ms; reset, in seconds, is the fallback. Never less than a minute, never more than an hour. */
    const said = Number(err?.limit?.resetMs ?? (err?.limit?.reset ? err.limit.reset * 1000 : NaN));
    const wait = Math.min(Date.now() + 3_600_000, Math.max(Date.now() + 60_000, Number.isFinite(said) ? said : 0));
    setState(`vercel:wait:${bucket}`, String(wait));
    throw new VercelError(429, `Vercel's rate limit for this endpoint is reached; the desk asks again after ${iso(wait).slice(11, 16)} UTC.`);
  }
  if (res.status === 401) {
    setState("vercel:refused", iso(Date.now()));
    throw new VercelError(401, "Vercel refused the desk's token (401): it is wrong, revoked or expired.");
  }
  if (res.status === 403) throw new VercelError(403, `Vercel says this token may not read ${path.replace(/\/(?:dpl|prj)_\w+/g, "/…")} (403${err?.code ? `, ${err.code}` : ""}).`);
  if (!res.ok) throw new VercelError(res.status, `Vercel answered ${res.status}${err?.message ? `: ${err.message.slice(0, 160)}` : ""}.`);
  setState("vercel:ok", iso(Date.now()));
  setState("vercel:refused", "");
  return json as T;
}

/* ---------- the shapes Vercel answers in (only what is read) ------------------------------------ */

interface V7Deployment {
  uid: string;
  url?: string;
  created?: number;
  createdAt?: number;
  state?: string;
  readyState?: string;
  buildingAt?: number;
  ready?: number;
  target?: string | null;
  creator?: { uid?: string; username?: string; githubLogin?: string; gitlabLogin?: string };
  errorCode?: string;
  errorMessage?: string;
  inspectorUrl?: string | null;
}

interface V13Deployment extends V7Deployment {
  id?: string;
  errorStep?: string;
  gitSource?: { sha?: string; ref?: string; type?: string };
}

interface V9Project {
  targets?: Record<string, { id?: string; url?: string; readyState?: string; alias?: string[] } | null>;
  alias?: { domain?: string; environment?: string; target?: string }[];
  paused?: boolean;
  security?: { attackModeEnabled?: boolean; attackModeActiveUntil?: number | null; firewallEnabled?: boolean; botIdEnabled?: boolean };
}

interface V9Domain {
  name: string;
  verified?: boolean;
  redirect?: string | null;
  redirectStatusCode?: number | null;
}

interface Anomaly {
  startTime?: number;
  endTime?: number | null;
  state?: string;
}

interface BuildEvent {
  type?: string;
  created?: number;
  date?: number;
  text?: string;
  level?: string;
  payload?: { text?: string; date?: number };
}

const STATES: BuildState[] = ["READY", "ERROR", "BUILDING", "QUEUED", "INITIALIZING", "CANCELED", "BLOCKED", "DELETED"];
const FINAL = new Set<BuildState>(["READY", "ERROR", "CANCELED", "DELETED"]);

function stateOf(d: V7Deployment): BuildState {
  const s = String(d.readyState ?? d.state ?? "").toUpperCase() as BuildState;
  return STATES.includes(s) ? s : "QUEUED";
}

function rowOf(d: V7Deployment, detail: V13Deployment | null, currentId: string | null): BuildRow {
  const st = stateOf(detail ?? d);
  const building = detail?.buildingAt ?? d.buildingAt;
  const ready = detail?.ready ?? d.ready;
  const failed = st === "ERROR" || st === "CANCELED";
  const who = detail?.creator ?? d.creator;
  return {
    uid: d.uid,
    state: st,
    createdAt: iso(Number(d.created ?? d.createdAt ?? detail?.createdAt ?? 0)),
    durationMs: building && ready && ready >= building ? ready - building : null,
    sha: detail?.gitSource?.sha ?? null,
    ref: detail?.gitSource?.ref ?? null,
    creator: who?.githubLogin ?? who?.gitlabLogin ?? who?.username ?? null,
    error: failed ? { code: detail?.errorCode ?? d.errorCode ?? null, message: detail?.errorMessage ?? d.errorMessage ?? null, step: detail?.errorStep ?? null } : null,
    inspectorUrl: detail?.inspectorUrl ?? d.inspectorUrl ?? null,
    current: !!currentId && (currentId === d.uid || currentId === detail?.id),
  };
}

/* ---------- the reads, each kept for the screen ----------------------------------------------- */

/** What one part of the job last did: its error and status when it failed. */
function failure(part: string): { status: number; message: string } | null {
  try {
    const f = JSON.parse(state(`vercel:err:${part}`) || "null") as { status: number; message: string } | null;
    return f && typeof f.message === "string" ? f : null;
  } catch {
    return null;
  }
}

/**
 * One part of the read, through cached(): asked at most once per `ttl`, kept
 * for the screen, and when Vercel fails, the older answer stays with the
 * failure written beside it (its status decides what the panel says).
 */
async function part<T>(name: string, ttl: number, read: () => Promise<T>): Promise<T | null> {
  let thrown: unknown = null;
  const fail = (e: unknown) => {
    const status = e instanceof VercelError ? e.status : 0;
    setState(`vercel:err:${name}`, JSON.stringify({ status, message: (e instanceof Error ? e.message : String(e)).slice(0, 300) }));
  };
  try {
    const got = await cached(`vercel:${name}`, ttl, async () => {
      try {
        return await read();
      } catch (e) {
        thrown = e;
        throw e;
      }
    });
    if (got.stale) fail(thrown ?? new Error(got.error ?? "not refreshed"));
    else setState(`vercel:err:${name}`, "");
    return got.value;
  } catch (e) {
    fail(e);
    return null;
  }
}

/** The production deployment the project serves now, from the kept project. */
function currentId(): string | null {
  return kept<ProductionNow & { deploymentId: string | null }>("vercel:project")?.value.deploymentId ?? null;
}

async function readBuilds(): Promise<BuildRow[]> {
  const list = await get<{ deployments?: V7Deployment[] }>("deployments", "/v7/deployments", { projectId: projectId(), target: "production", limit: 20 });
  const rows: BuildRow[] = [];
  const now = currentId();
  for (const [i, d] of (list.deployments ?? []).entries()) {
    /* The commit and the error step come from the single read; the newest ten are read, each kept for good once its state is final. */
    let detail: V13Deployment | null = null;
    if (i < 10) {
      const was = kept<V13Deployment>(`vercel:dpl:${d.uid}`)?.value ?? null;
      const final = was && FINAL.has(stateOf(was));
      detail = final ? was : await cached(`vercel:dpl:${d.uid}`, 60_000, () => get<V13Deployment>("deployment", `/v13/deployments/${encodeURIComponent(d.uid)}`, { withGitRepoInfo: "true" })).then((k) => k.value).catch(() => was);
    }
    rows.push(rowOf(d, detail, now));
  }
  /* A failed production build is an incident: once per build, in Site Health's log as well. */
  for (const b of rows.filter((r) => r.state === "ERROR").slice(0, 3)) {
    note("deploy", "Vercel's production build failed", {
      tone: "bad",
      at: b.createdAt,
      detail: `${b.sha ? `${b.sha.slice(0, 7)}: ` : ""}${b.error?.message ?? b.error?.code ?? "no reason given"}${b.error?.step ? ` (step: ${b.error.step})` : ""}`,
      href: `/hosting/builds/${b.uid}`,
      dedupe: `vercel:build:${b.uid}:error`,
    });
  }
  return rows;
}

async function readProject(): Promise<ProductionNow & { deploymentId: string | null }> {
  const p = await get<V9Project>("project", `/v9/projects/${encodeURIComponent(projectId())}`);
  const prod = p.targets?.production ?? null;
  const aliases = [...new Set([...(prod?.alias ?? []), ...(p.alias ?? []).filter((a) => a.environment === "production").map((a) => a.domain ?? "")])].filter(Boolean);
  return {
    deploymentId: prod?.id ?? null,
    deploymentUrl: prod?.url ?? null,
    readyState: prod?.readyState ?? null,
    aliases,
    paused: typeof p.paused === "boolean" ? p.paused : null,
    firewall: {
      enabled: p.security?.firewallEnabled ?? null,
      attackMode: p.security?.attackModeEnabled ?? null,
      attackModeUntil: p.security?.attackModeActiveUntil ? iso(p.security.attackModeActiveUntil) : null,
      botId: p.security?.botIdEnabled ?? null,
    },
  };
}

async function readDomains(): Promise<DomainRow[]> {
  const d = await get<{ domains?: V9Domain[] }>("domains", `/v9/projects/${encodeURIComponent(projectId())}/domains`);
  return (d.domains ?? []).map((x) => ({ name: x.name, verified: !!x.verified, redirect: x.redirect ?? null, redirectStatus: x.redirectStatusCode ?? null }));
}

async function readAttacks(): Promise<AttackStatus> {
  const a = await get<{ anomalies?: Anomaly[] }>("attack-status", "/v1/security/firewall/attack-status", { projectId: projectId(), since: 1 });
  const list = a.anomalies ?? [];
  const starts = list.map((x) => Number(x.startTime)).filter((n) => Number.isFinite(n) && n > 0);
  return { total: list.length, active: list.filter((x) => x.endTime == null).length, newest: starts.length ? iso(Math.max(...starts)) : null };
}

/** Read everything the screen shows. The project first: the builds use it to mark the one production serves. */
export async function refresh(): Promise<string> {
  /* A little under the job's ten minutes, so each run reads afresh and a second run asked for straight after does not. */
  const TTL = 9 * 60_000;
  const project = await part("project", TTL, readProject);
  const builds = await part("builds", TTL, readBuilds);
  const domains = await part("domains", TTL, readDomains);
  /* Twenty a minute per user, shared with the CLI: never more than once a minute from here, whatever the TTL. */
  const lastAttack = Number(state("vercel:attack:asked") ?? "0");
  let attacks: AttackStatus | null = kept<AttackStatus>("vercel:attacks")?.value ?? null;
  if (Date.now() - lastAttack > 60_000) {
    setState("vercel:attack:asked", String(Date.now()));
    attacks = await part("attacks", TTL, readAttacks);
  }
  const refusedAll = ["project", "builds", "domains"].every((p) => failure(p)?.status === 401);
  if (refusedAll) throw new Error("Vercel refused the desk's token (401): it is wrong, revoked or expired.");
  const said = [
    builds ? `${builds.length} production builds, newest ${builds[0]?.state ?? "none"}` : `builds: ${failure("builds")?.message ?? "not read"}`,
    project ? `production ${project.readyState ?? "?"}` : `project: ${failure("project")?.message ?? "not read"}`,
    domains ? `${domains.length} domains` : `domains: ${failure("domains")?.message ?? "not read"}`,
    attacks ? `${attacks.total} anomalies in a day` : `firewall: ${failure("attacks")?.message ?? "not read"}`,
  ];
  return said.join("; ");
}

/** What the screen reads: the kept value with its time, or why there is none. */
export interface Part<T> {
  value: T | null;
  at: number | null;
  error: { status: number; message: string } | null;
}

export function partOf<T>(name: "builds" | "project" | "domains" | "attacks"): Part<T> {
  const k = kept<T>(`vercel:${name}`);
  return { value: k?.value ?? null, at: k?.at ?? null, error: failure(name) };
}

/**
 * A failed build's last log lines, read when somebody opens it. Kept a day:
 * a finished build's log does not change. The lines are scrubbed by the
 * route before a browser sees them.
 */
export async function buildLog(uid: string, lines = 80): Promise<BuildLog> {
  if (!/^dpl_[A-Za-z0-9]{6,40}$/.test(uid)) throw new VercelError(400, "That is not a deployment id.");
  const got = await cached(`vercel:log:${uid}`, 24 * 3_600_000, async () => {
    const events = await get<BuildEvent[]>("events", `/v3/deployments/${encodeURIComponent(uid)}/events`, { direction: "backward", limit: 400, builds: 1 });
    return Array.isArray(events) ? events : [];
  });
  const all = got.value
    .map((e) => {
      const text = (e.text ?? e.payload?.text ?? "").replace(/\s+$/, "");
      const at = Number(e.created ?? e.date ?? e.payload?.date);
      const type = String(e.type ?? "");
      return { at: Number.isFinite(at) && at > 0 ? iso(at) : null, type, error: type === "stderr" || type === "fatal" || e.level === "error", text };
    })
    .filter((e) => e.text && ["command", "stdout", "stderr", "fatal", "exit"].includes(e.type))
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const kept_ = partOf<BuildRow[]>("builds").value?.find((b) => b.uid === uid) ?? null;
  return { build: kept_, lines: all.slice(-lines), total: all.length };
}

/* ---------- the job and the source ---------------------------------------------------------- */

export const vercelJob: Job = {
  name: "vercel",
  title: "Read Vercel's builds, domains and firewall",
  every: 10 * 60,
  delay: 45,
  ready: configured,
  run: async () => refresh(),
};

registerSource(() => {
  const base = { id: "vercel-api" as const, name: "Vercel API (desk-only token)", feeds: "Hosting: production builds and their logs, the production domain, the firewall" };
  if (!configured()) return { ...base, state: "off", lastOk: null, step: TOKEN_STEP };
  const lastOk = state("vercel:ok") || null;
  const refusedAt = state("vercel:refused") || "";
  if (refusedAt) return { ...base, state: "failing", lastOk, error: "Vercel refused the desk's token (401): it is wrong, revoked or expired.", step: TOKEN_STEP };
  const errors = ["builds", "project", "domains", "attacks"].map(failure).filter((f): f is { status: number; message: string } => !!f && f.status !== 403);
  if (errors.length && !lastOk) return { ...base, state: "failing", lastOk, error: errors[0]!.message };
  return { ...base, state: lastOk ? "connected" : "waiting", lastOk, ...(errors.length ? { error: errors[0]!.message } : {}) };
});
