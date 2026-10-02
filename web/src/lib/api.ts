import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ApiError, Me, SystemStatus } from "@/contract/common";
import { DIGEST, type Failure, type ShownFailure } from "./failure";

/**
 * How a screen asks the desk server for something.
 *
 * The interface holds no data and no credentials. Every figure comes from the
 * Hono server beside it (src/server.ts, port 3400), and what this app adds to
 * a request is the visitor's own cookie, so the server answers as that person
 * and decides what they may see (and, for a change, where it came from).
 *
 * Nothing is cached here. The server keeps the slow sources fresh on its own
 * schedule (src/cc/store.ts); asking it again is cheap and is always current.
 *
 * Server only: this file reads the incoming request. A client component polls
 * through `useLive` (lib/live.ts) instead.
 */

const DESK = (process.env.DESK_API ?? "http://127.0.0.1:3400").replace(/\/$/, "");
/* The server answers from its own cache, so anything slower than this is not
   slow, it is stuck, and a stuck page is worse than a page that says so. */
const PATIENCE = 20_000;

export type Params = Record<string, string | number | boolean | null | undefined>;

/** What `ask` returns: the answer, or the reason there is none. Never thrown. */
export type Answer<T> = { ok: true; value: T } | { ok: false; kind: Failure; status: number; message: string };

/**
 * Thrown by `api` and `apiPost`. The `digest` is read by the error screens
 * (app/error.tsx, app/(frame)/error.tsx): in production Next strips an error's
 * message on its way to the browser but keeps a digest that was already set,
 * so this is how "the server is down" stays distinguishable from a bug.
 */
export class DeskError extends Error {
  readonly kind: ShownFailure;
  readonly status: number;
  readonly digest: string;

  constructor(kind: ShownFailure, status: number, message: string) {
    super(message);
    this.name = "DeskError";
    this.kind = kind;
    this.status = status;
    this.digest = DIGEST[kind];
  }
}

/**
 * GET a desk API path and return its JSON, typed.
 *
 *   const data = await api<Overview>("/api/v1/overview", { range });
 *
 * 401 sends the visitor to sign in. Everything else that is not an answer is
 * thrown as a `DeskError`, which the nearest error screen turns into a calm
 * sentence: a switched-off account, a server that is not answering.
 */
export async function api<T>(path: string, params?: Params): Promise<T> {
  return settle(await ask<T>(path, params));
}

/**
 * POST JSON to a desk API path, from a server action or a route handler.
 * The same failures as `api`. A 204 returns `undefined`.
 *
 * The desk server takes a change under /api only from its own pages: it reads
 * the request's Origin (src/server.ts, `fromOurPages`). A browser sets that
 * header itself, but this request is made by this server, so it carries the
 * visitor's Origin on their behalf (see `sentFrom`). Call it from a server
 * action, which Next only runs for a same-origin POST, or from a route
 * handler's POST; never while a page renders, where nothing changes.
 */
export async function apiPost<T = void>(path: string, body?: unknown): Promise<T> {
  return settle(await call<T>("POST", path, undefined, body));
}

/**
 * The same POST as `apiPost`, but nothing is thrown and nobody is redirected:
 * the caller gets the answer or the reason. For a form that shows the
 * server's refusal beside the button instead of replacing the screen.
 */
export function askPost<T = void>(path: string, body?: unknown): Promise<Answer<T>> {
  return call<T>("POST", path, undefined, body);
}

/**
 * The same GET as `api`, but nothing is thrown and nobody is redirected: the
 * caller gets the answer or the reason. For the frame, which must draw
 * something whatever happens, and for a screen that wants to turn a 404 into
 * `notFound()` itself.
 */
export function ask<T>(path: string, params?: Params): Promise<Answer<T>> {
  return call<T>("GET", path, params);
}

/**
 * Who is looking, or why the server would not say. Asked once per request
 * however many components call it: the frame asks first, and a screen that
 * asks again gets the same answer without a second round trip.
 */
export const askMe = cache((): Promise<Answer<Me>> => ask<Me>("/api/v1/me"));

/**
 * Who is looking. The same single request as `askMe`, with the failures
 * handled as `api` handles them. For a screen that needs the person's name
 * or rights.
 */
export async function me(): Promise<Me> {
  return settle(await askMe());
}

/** The top bar's light, as the server last judged it. Once per request. */
export const system = cache((): Promise<Answer<SystemStatus>> => ask<SystemStatus>("/api/v1/system"));

function settle<T>(a: Answer<T>): T {
  if (a.ok) return a.value;
  /* redirect() works by throwing, so it stays outside any try block. */
  if (a.kind === "signed-out") redirect("/auth/google");
  throw new DeskError(a.kind, a.status, a.message);
}

async function call<T>(method: "GET" | "POST", path: string, params?: Params, body?: unknown): Promise<Answer<T>> {
  if (!path.startsWith("/")) return { ok: false, kind: "error", status: 0, message: `Not a desk path: ${path}` };

  const url = new URL(DESK + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  /* The cookie travels, because the server knows the person by it. Every
     request, a page's GET as much as a change, carries the hosts the visitor
     addressed (see `sentTo`), and a change also carries where it came from
     (see `sentFrom`); nothing else of the visitor's is this app's to pass on. */
  const incoming = await headers();
  const cookie = incoming.get("cookie");
  const send: Record<string, string> = { accept: "application/json" };
  if (cookie) send.cookie = cookie;
  if (body !== undefined) send["content-type"] = "application/json";
  const hosts = sentTo(incoming);
  if (hosts.length) send["x-forwarded-host"] = hosts.join(", ");
  if (method !== "GET") Object.assign(send, sentFrom(incoming, hosts));

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: send,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(PATIENCE),
    });
  } catch (e) {
    const slow = e instanceof Error && e.name === "TimeoutError";
    return { ok: false, kind: "down", status: 0, message: slow ? "The desk server took too long to answer." : "The desk server is not answering." };
  }

  if (res.status === 204) return { ok: true, value: undefined as T };

  const text = await res.text().catch(() => "");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (res.ok && json !== undefined) return { ok: true, value: json as T };

  /* What the server said went wrong, when it said it the agreed way. */
  const said = isApiError(json) ? json.error : "";
  const s = res.status;
  if (s === 401) return { ok: false, kind: "signed-out", status: s, message: said || "Nobody is signed in." };
  if (s === 403) {
    /* The server's gate refuses a switched-off account on every path, and
       /me is asked first on every page; any other 403 is one part withheld. */
    const off = path === "/api/v1/me" || /switched off/i.test(said);
    return { ok: false, kind: off ? "off" : "forbidden", status: s, message: said || "This account may not see this." };
  }
  if (s === 404) return { ok: false, kind: "missing", status: s, message: said || `The desk server has nothing at ${path}.` };
  if (s === 502 || s === 503 || s === 504) return { ok: false, kind: "down", status: s, message: "The desk server is not answering." };
  if (res.ok) return { ok: false, kind: "error", status: s, message: `The desk server answered ${path} with something that is not JSON.` };
  return { ok: false, kind: "error", status: s, message: said || `The desk server answered ${path} with ${s}.` };
}

/**
 * Every host the visitor's request was addressed to on its way here: the Host
 * this app received, and each X-Forwarded-Host beside it. Sent on as this
 * request's X-Forwarded-Host, because this request itself goes to 127.0.0.1.
 *
 * The server reads them twice. For a change, the Origin must name one of them
 * (src/server.ts, `fromOurPages`). And on a development copy, the sign-in that
 * needs no cookie opens only when every one of them is a loopback name
 * (src/session.ts, `addressedToLoopback`): that is what keeps a page that
 * re-points its own name at this machine (DNS rebinding) from being drawn as
 * the owner. So a page render must send them as much as a change does, and it
 * must send all of them: X-Forwarded-Host is a header a page's own script may
 * set, so passing on that one alone would let such a page claim "localhost".
 * The Host is the one header the browser writes itself.
 */
function sentTo(h: Headers): string[] {
  const all = [h.get("host") ?? "", ...(h.get("x-forwarded-host") ?? "").split(",")].map((s) => s.trim()).filter(Boolean);
  return [...new Set(all)];
}

/**
 * The headers that tell the desk server where a change came from.
 *
 * The visitor's own Origin (or Referer, which is what an older browser sends
 * instead) is passed on exactly as the browser wrote it, never replaced: a
 * page on another site that gets this app to post still names that site, and
 * the server still refuses it. The server compares it with the hosts the
 * visitor addressed (`sentTo`, already on the request).
 *
 * Only when the browser named no origin at all does this app state the desk's
 * own: DESK_URL when it is set, else the address the request arrived at. And
 * not even then if the browser said the request was made by another site
 * (Sec-Fetch-Site): that is passed through as "null", which the server refuses.
 */
function sentFrom(h: Headers, hosts: string[]): Record<string, string> {
  const host = hosts[0] ?? "";
  const out: Record<string, string> = {};

  const origin = h.get("origin");
  const referer = h.get("referer");
  if (origin) out.origin = origin;
  else if (referer) out.referer = referer;
  else {
    const site = h.get("sec-fetch-site");
    if (site === "cross-site" || site === "same-site") out.origin = "null";
    else {
      const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0]!.trim();
      const own = process.env.DESK_URL ?? (host ? `${proto}://${host}` : "");
      try {
        if (own) out.origin = new URL(own).origin;
      } catch {
        /* A DESK_URL that is not an address: say nothing, and the server refuses. */
      }
    }
  }
  return out;
}

function isApiError(v: unknown): v is ApiError {
  return typeof v === "object" && v !== null && typeof (v as { error?: unknown }).error === "string";
}
