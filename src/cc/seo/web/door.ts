import type { Context } from "hono";
import { beat } from "../../../db.ts";
import { handOutFetch, takeFetchResult } from "./fetchq.ts";
/* The readers of fetched pages register themselves when they load: a result that arrives must find its reader. */
import "./serp.ts";

/**
 * The fetch door: POST /runner/fetch/next and POST /runner/fetch/result/:id,
 * beside the operator's door, behind the same runner secret (src/server.ts
 * checks it for every /runner address before this is reached).
 *
 * Mounted in src/server.ts by one line that loads this file with import()
 * when first asked, like the operator's door: a fault here costs these two
 * addresses and never the article runner's. The same tolerance as the
 * operator's: anything that goes wrong while handing out is a 503 with a
 * sentence (the workstation's fetchOnce logs it and carries on), a result for
 * a task that does not exist is a 404, a malformed one a 400.
 */
export async function fetchDoor(c: Context): Promise<Response> {
  const path = c.req.path.replace(/\/+$/, "");
  if (c.req.method !== "POST") return c.json({ error: "Only POST is answered here." }, 405);

  if (path.endsWith("/fetch/next")) {
    const { name } = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const runner = typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : "runner";
    try {
      beat(runner);
      return c.json(await handOutFetch(runner));
    } catch (e) {
      console.error("fetch door: handing out a task failed:", e);
      return c.json({ task: null, error: "The fetch queue could not be read. The reason is in the desk's log." }, 503);
    }
  }

  const m = /\/fetch\/result\/(\d+)$/.exec(path);
  if (m) {
    const id = Number(m[1]);
    const body = (await c.req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return c.json({ error: "Send { ok: true, status, finalUrl, body } or { ok: false, error }." }, 400);
    try {
      return c.json(await takeFetchResult(id, body));
    } catch (e) {
      /* "no such fetch task", a malformed answer: an HTTPException carrying its own status. */
      if (e && typeof e === "object" && "getResponse" in e && "status" in e) {
        return c.json({ error: (e as unknown as Error).message }, (e as unknown as { status: 400 | 404 }).status);
      }
      console.error("fetch door: taking a result failed:", e);
      return c.json({ error: "The desk could not keep that page. The reason is in the desk's log." }, 500);
    }
  }

  return c.json({ error: `There is nothing at ${c.req.path}.` }, 404);
}
