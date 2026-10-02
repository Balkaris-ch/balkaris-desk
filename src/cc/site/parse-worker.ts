import { parentPort } from "node:worker_threads";
import { parsePage } from "./parse.ts";

/**
 * The thread jsdom lives in during a crawl (see parser.ts for why).
 *
 * One message is one page: { id, html, url } in, { id, parsed } or
 * { id, error } out. Messages are handled one at a time, so one document is
 * alive at once, and the thread's own event loop turns between them, which is
 * what lets jsdom let go of a closed window.
 */
parentPort?.on("message", (m: { id: number; html: string; url: string }) => {
  try {
    parentPort?.postMessage({ id: m.id, parsed: parsePage(m.html, m.url) });
  } catch (e) {
    parentPort?.postMessage({ id: m.id, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
  }
});
