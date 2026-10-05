import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { checkTarget, cleanHeaders, FINAL_HOSTS, MAX_BYTES, MAX_HOPS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from "./allow.ts";

/**
 * The workstation's half of the fetch door: one page, if the box wants one.
 *
 * Called by the runner (src/runner.ts) in its loop when it had no article to
 * do. It asks the box for the next fetch task (POST /runner/fetch/next),
 * fetches that one address from the studio's own connection and posts back
 * what answered (POST /runner/fetch/result/:id). The box decides what to ask
 * for, how often, and what the page means; this file keeps no state and
 * never opens the desk's database.
 *
 * WHY THE WORKSTATION AT ALL. Google answers a datacenter with a script shell
 * or a captcha. Its basic result page, asked for from a home line with an
 * Opera Mini User-Agent, carries the organic ten, the map pack and the ads.
 *
 * THE WORKSTATION IS NOT A PROXY. Whatever the box sends, this fetches only
 * https, only hosts on the fixed list in allow.ts, follows a redirect by hand
 * and only onto that list, sends only three harmless request headers, reads
 * at most 1.5 MB and gives up after thirty seconds.
 *
 * A FAULT IN THIS DOOR NEVER COSTS THE ARTICLES. Nothing here throws: a desk
 * that does not answer, a build of the box without these routes (404), a
 * refused secret, a page that will not load are each logged in one line and
 * answered "nothing done" or reported to the box as a failed fetch, and the
 * runner's loop goes on.
 *
 * WIRING, one line in src/runner.ts's forever loop:
 *
 *     const did = (await once()) || (await fetchOnce({ desk: DESK, name: NAME, secret: SECRET })) || (await operatorOnce({ ... }));
 *
 * A fetch takes a second and needs no GPU, so it goes after an article and
 * before a model task.
 */

export interface FetchWork {
  /** The desk's address, as the runner uses it: https://desk.balkaris.ch */
  desk: string;
  /** The runner's name, as it is known to the desk. */
  name: string;
  /** DESK_RUNNER_SECRET. */
  secret: string;
  /** Where to say what happened. console.log unless given. */
  log?: (line: string) => void;
  /** One request, no redirect followed. The check passes a stand-in; otherwise curl when the machine has it, else Node's fetch. */
  hop?: Hop;
}

/** A task as the box hands it out (fetchq.ts `handOutFetch`). */
export interface FetchTask {
  id: number;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}

/** What goes back to the box. `kind` says whether trying again could help. */
export type FetchReturn =
  | { ok: true; status: number; finalUrl: string; body: string; ms: number; client: string }
  | { ok: false; error: string; kind: "blocked" | "failed"; status?: number; finalUrl?: string; client?: string };

/** One answer to one request: the status, where a redirect points, and the body as bytes. */
export interface HopAnswer {
  status: number;
  location: string | null;
  contentType: string | null;
  body: Buffer;
}
export type Hop = (req: { url: string; headers: Record<string, string>; timeoutMs: number; maxBytes: number }) => Promise<HopAnswer>;

/* ---------- two ways to make one request ------------------------------------------------------ */

class TooBig extends Error {}

/**
 * curl, without a shell. Preferred: on 5 October 2026 Google answered curl
 * from the studio's line with the result page and Node (fetch and node:https
 * alike, same headers, same minute) with 403, so the client's TLS signature
 * is part of what Google judges. Windows ships curl.exe; so do macOS and
 * every Linux the runner would live on.
 */
export const curlPath = (): string => {
  const win = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\curl.exe` : "";
  return win && existsSync(win) ? win : "curl";
};

export const curlHop: Hop = (req) =>
  new Promise((resolve, reject) => {
    const args = [
      "--silent",
      "--compressed",
      "--proto",
      "=https",
      "--max-redirs",
      "0",
      "--max-time",
      String(Math.ceil(req.timeoutMs / 1000)),
      "--max-filesize",
      String(req.maxBytes),
      "--output",
      "-",
      /* The status, where a redirect would lead and the content type, on stderr so the page alone is on stdout. */
      "--write-out",
      "%{stderr}%{http_code}\n%{redirect_url}\n%{content_type}",
    ];
    for (const [k, v] of Object.entries(req.headers)) args.push("--header", `${k}: ${v}`);
    args.push("--", req.url);
    execFile(curlPath(), args, { encoding: "buffer", maxBuffer: req.maxBytes, timeout: req.timeoutMs + 2000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return reject(new TooBig());
        /* curl's own exit codes: 63 is "larger than --max-filesize", 28 a timeout; the rest are named by number. */
        const exit = typeof code === "number" ? code : null;
        if (exit === 63) return reject(new TooBig());
        if (code === "ENOENT") return reject(new Error("curl is not on this machine"));
        return reject(new Error(exit === 28 || (err as { killed?: boolean }).killed ? "no answer in time" : exit !== null ? `curl gave up (exit ${exit})` : "curl could not be run"));
      }
      const [status, location, contentType] = stderr.toString("utf8").split("\n");
      const n = Number(status);
      if (!Number.isInteger(n) || n < 100) return reject(new Error("nothing answered"));
      resolve({ status: n, location: location?.trim() || null, contentType: contentType?.trim() || null, body: stdout });
    });
  });

/** Node's own fetch, redirects left alone, the body cut at the limit. The fallback where there is no curl. */
export const nodeHop: Hop = async (req) => {
  const res = await fetch(req.url, { headers: req.headers, redirect: "manual", signal: AbortSignal.timeout(req.timeoutMs) });
  const parts: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > req.maxBytes) {
        await reader.cancel().catch(() => {});
        throw new TooBig();
      }
      parts.push(value);
    }
  }
  return { status: res.status, location: res.headers.get("location"), contentType: res.headers.get("content-type"), body: Buffer.concat(parts) };
};

let chosen: { hop: Hop; name: string } | null = null;

/** curl when it runs here, else Node. DESK_FETCH_CLIENT=node or =curl forces one. Asked once per process. */
async function client(): Promise<{ hop: Hop; name: string }> {
  if (chosen) return chosen;
  const want = (process.env.DESK_FETCH_CLIENT ?? "").trim().toLowerCase();
  if (want === "node") return (chosen = { hop: nodeHop, name: "node" });
  const has = await new Promise<boolean>((done) => execFile(curlPath(), ["--version"], { timeout: 5000, windowsHide: true }, (err) => done(!err)));
  return (chosen = has || want === "curl" ? { hop: curlHop, name: "curl" } : { hop: nodeHop, name: "node" });
}

/** The page's bytes as text, by the charset its content type names (Google's basic page has been both UTF-8 and Latin-1). */
function decodeBody(body: Buffer, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(charset === "iso-8859-1" ? "latin1" : charset).decode(body);
  } catch {
    return body.toString("utf8");
  }
}

/* ---------- one task ---------------------------------------------------------------------------- */

/**
 * Fetch what one task names, by the rules above. Never throws. Exported so
 * the check can prove the refusals without a desk.
 */
export async function fetchTask(t: FetchTask, hop?: Hop): Promise<FetchReturn> {
  const first = checkTarget(t?.url);
  if (!first.ok) return { ok: false, kind: "blocked", error: `The workstation refused: ${first.why}.` };
  const headers = cleanHeaders(t.headers);
  const timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Number(t.timeoutMs) || MAX_TIMEOUT_MS));
  const maxBytes = Math.max(1000, Math.min(MAX_BYTES, Number(t.maxBytes) || MAX_BYTES));
  const started = Date.now();
  let name = "stand-in";
  let go = hop;
  if (!go) {
    const c = await client();
    go = c.hop;
    name = c.name;
  }
  let url = first.url;
  for (let i = 0; ; i++) {
    let got: HopAnswer;
    try {
      got = await go({ url: url.toString(), headers, timeoutMs, maxBytes });
    } catch (e) {
      if (e instanceof TooBig) return { ok: false, kind: "blocked", error: `The workstation refused: the page is larger than ${Math.round(maxBytes / 1000)} KB.`, finalUrl: url.toString(), client: name };
      const why = e instanceof Error ? (e.name === "TimeoutError" ? "no answer in time" : e.message) : String(e);
      return { ok: false, kind: "failed", error: `The workstation could not fetch the page: ${why.slice(0, 160)}.`, finalUrl: url.toString(), client: name };
    }
    if (got.status >= 300 && got.status < 400 && got.location) {
      if (i >= MAX_HOPS) return { ok: false, kind: "blocked", error: `The workstation refused: more than ${MAX_HOPS} redirects.`, status: got.status, finalUrl: url.toString(), client: name };
      let next: URL;
      try {
        next = new URL(got.location, url);
      } catch {
        return { ok: false, kind: "blocked", error: "The workstation refused: the redirect names no address.", status: got.status, finalUrl: url.toString(), client: name };
      }
      const may = checkTarget(next.toString(), true);
      if (!may.ok) return { ok: false, kind: "blocked", error: `The workstation refused to follow a redirect: ${may.why}.`, status: got.status, finalUrl: next.toString().slice(0, 300), client: name };
      url = may.url;
      continue;
    }
    /* A pass-through host that answers with a page of its own (a consent form): that page is never sent anywhere. */
    if (!FINAL_HOSTS.includes(url.hostname.toLowerCase())) {
      return { ok: false, kind: "blocked", error: `The workstation refused: ${url.hostname} answered with its own page instead of leading back to the results.`, status: got.status, finalUrl: url.toString().slice(0, 300), client: name };
    }
    if (got.body.byteLength > maxBytes) return { ok: false, kind: "blocked", error: `The workstation refused: the page is larger than ${Math.round(maxBytes / 1000)} KB.`, status: got.status, finalUrl: url.toString(), client: name };
    return { ok: true, status: got.status, finalUrl: url.toString(), body: decodeBody(got.body, got.contentType), ms: Date.now() - started, client: name };
  }
}

/* ---------- the loop's one call ---------------------------------------------------------------- */

async function post<T>(o: FetchWork, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${o.desk.replace(/\/$/, "")}/runner${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${o.secret}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw new Error("the desk refused the runner secret");
  if (!res.ok) throw new Error(`desk answered ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Take one fetch task, fetch it, send the answer back. True when a task was
 * taken (fetched or refused), false when there was none or the door did not
 * answer. Never throws.
 */
export async function fetchOnce(o: FetchWork): Promise<boolean> {
  const say = o.log ?? ((line: string) => console.log(line));
  let t: FetchTask | null;
  try {
    t = (await post<{ task: FetchTask | null }>(o, "/fetch/next", { name: o.name })).task;
  } catch (e) {
    say(`fetch: no task this time (${e instanceof Error ? e.message : String(e)})`);
    return false;
  }
  if (!t || typeof t.id !== "number") return false;

  let where = "an address that could not be read";
  try {
    const u = new URL(t.url);
    where = `${u.hostname}${u.pathname}`;
  } catch {
    /* fetchTask refuses it and says why */
  }
  say(`\n→ fetch task ${t.id}: ${where}`);
  let back: FetchReturn;
  try {
    back = await fetchTask(t, o.hop);
  } catch (e) {
    back = { ok: false, kind: "failed", error: `The workstation could not fetch the page: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}.` };
  }
  say(back.ok ? `  answered ${back.status}, ${Math.round(back.body.length / 1000)} KB in ${back.ms} ms (${back.client})` : `  ${back.error}`);
  try {
    await post(o, `/fetch/result/${t.id}`, back);
  } catch (e) {
    /* Not delivered: the box hands the task out again after two minutes. */
    say(`fetch: the page for task ${t.id} could not be delivered (${e instanceof Error ? e.message : String(e)})`);
  }
  return true;
}
