import { Worker } from "node:worker_threads";
import { parsePage, type Parsed } from "./parse.ts";

/**
 * jsdom in a thread of its own, with a ceiling on its memory.
 *
 * WHY. A served page of about 200 kB becomes some six or seven megabytes of
 * jsdom objects, and a closed window is only let go of once the event loop
 * has turned. V8 then collects when it sees fit, and on a machine with room
 * it sees fit late: measured on the workstation, a crawl of a hundred pages in
 * the desk's own thread took the process from 220 MB to 640 MB, almost all of
 * it garbage nobody had swept yet. The box gives the desk 768 MB in all, and
 * V8 does not know that number (it sizes its heap from the machine's memory),
 * so "it would have been collected eventually" is how the kernel ends up
 * killing the desk, publisher and all.
 *
 * So the crawl hands each page to a worker thread whose heap is capped
 * (`resourceLimits`). Inside a small heap V8 sweeps early and often; the
 * desk's own heap never holds a document; and when the crawl is over the
 * thread is ended and its memory goes back to the system at once. A page so
 * large that it breaks the ceiling costs that one page ("could not be
 * parsed"); the pages queued behind it go to a fresh thread.
 *
 * Should the thread not start at all (a runtime without worker support for
 * the loader the desk runs under), pages are parsed in the desk's own thread
 * as before, with a turn of the event loop after each so the closed windows
 * can go, and the log says so once.
 */

/* Room for one document and its garbage, with margin: a page of the site
   measured about 7 MB of live jsdom objects. A hundred pages through this
   ceiling kept the whole process at about 230 MB on the workstation; 96 MB
   cost 60 MB more for no gain in speed worth having. */
const LIMITS = { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 };

interface Pending {
  html: string;
  url: string;
  thread: Worker | null;
  resolve: (p: Parsed) => void;
  reject: (e: Error) => void;
}

let current: Worker | null = null;
/** No thread can be started in this process: parse in place. */
let inPlace = false;
let seq = 0;
const pending = new Map<number, Pending>();

/** The pages a thread was holding, oldest first. Messages are handled in order, so the first is the one it was working on. */
const heldBy = (w: Worker): [number, Pending][] => [...pending].filter(([, p]) => p.thread === w).sort((a, b) => a[0] - b[0]);

/* A thread with work in hand keeps the process alive until it answers; an
   idle one does not, so a crawl's thread never holds the desk (or a check
   script) open by itself. */
function send(id: number, p: Pending): void {
  const w = thread();
  p.thread = w;
  pending.set(id, p);
  w.ref();
  w.postMessage({ id, html: p.html, url: p.url });
}

function idleCheck(w: Worker): void {
  if (!heldBy(w).length) w.unref();
}

function thread(): Worker {
  if (current) return current;
  let w: Worker;
  try {
    w = new Worker(new URL("./parse-worker.ts", import.meta.url), { resourceLimits: LIMITS });
  } catch (e) {
    inPlace = true;
    console.warn(`cc crawl: the parsing thread could not be made (${e instanceof Error ? e.message : String(e)}); pages are parsed in the desk's own thread instead.`);
    throw new Error("in place");
  }
  let answered = false;
  w.on("message", (m: { id: number; parsed?: Parsed; error?: string }) => {
    answered = true;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    idleCheck(w);
    if (m.parsed) p.resolve(m.parsed);
    else p.reject(new Error(m.error ?? "the parser gave no answer"));
  });
  w.on("error", (e) => {
    if (current === w) current = null;
    const held = heldBy(w);
    for (const [id] of held) pending.delete(id);
    const outOfMemory = (e as NodeJS.ErrnoException).code === "ERR_WORKER_OUT_OF_MEMORY";
    if (!answered && !outOfMemory) {
      /* It never started: everything it held is parsed in place by the caller. */
      inPlace = true;
      console.warn(`cc crawl: the parsing thread would not start (${e.message}); pages are parsed in the desk's own thread instead.`);
      for (const [, p] of held) p.reject(new Error("in place"));
      return;
    }
    const [first, ...rest] = held;
    first?.[1].reject(new Error(outOfMemory ? "the page is too large to parse inside the parser's memory ceiling" : `the parser stopped: ${e.message}`));
    for (const [id, p] of rest) send(id, p);
  });
  w.on("exit", () => {
    if (current === w) current = null;
    for (const [id, p] of heldBy(w)) {
      pending.delete(id);
      p.reject(new Error("the parser stopped"));
    }
  });
  w.unref();
  current = w;
  return w;
}

/**
 * `parsePage`, in the capped thread. Pages sent at once are parsed one after
 * the other, in the order sent.
 */
export async function parseIsolated(html: string, url: string): Promise<Parsed> {
  if (!inPlace) {
    const id = ++seq;
    const answer = new Promise<Parsed>((resolve, reject) => send(id, { html, url, thread: null, resolve, reject }));
    try {
      return await answer;
    } catch (e) {
      if (!inPlace) throw e;
      /* The thread would not start: this page, and every later one, in place. */
    }
  }
  const parsed = parsePage(html, url);
  await new Promise((r) => setImmediate(r));
  return parsed;
}

/** End the thread and give its memory back. The next `parseIsolated` starts a new one. */
export async function closeParser(): Promise<void> {
  const w = current;
  current = null;
  if (w) await w.terminate();
}
