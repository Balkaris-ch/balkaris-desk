import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { OLLAMA_URL } from "./llm.ts";

/**
 * Turn the machine on.
 *
 * Fini, 23 September 2026: *"make it work when I give it. It needs to start
 * its local machines. It needs to start everything we build."*
 *
 * Before this, the runner checked whether Ollama was up and EXITED if it was
 * not, and a cover job failed with "ComfyUI is not answering — start it and
 * the cover will retry". Both are the software telling a person to go and do
 * its job for it. A link shared from a phone should end in an article without
 * anybody opening a terminal.
 *
 * So the runner starts what it needs. Both of these are idempotent and safe to
 * call on every job: if the thing is already answering, they return in a
 * couple of milliseconds and touch nothing.
 *
 * ONE CARD, ONE QUEUE still holds. Starting ComfyUI is not the same as drawing
 * with it — the runner's single sequential loop is what keeps the drawing and
 * the writing apart, and that has not changed.
 */

const OLLAMA_EXE =
  process.env.OLLAMA_EXE ?? `${process.env.LOCALAPPDATA ?? "C:/Users/finim/AppData/Local"}/Programs/Ollama/ollama.exe`;

const COMFY_URL = (process.env.COMFY_URL ?? "http://127.0.0.1:8189").replace(/\/$/, "");
const COMFY_PORT = new URL(COMFY_URL).port || "8189";
const COMFY_DIR = process.env.COMFY_DIR ?? "D:/ComfyUI";
/*
 * pythonw, not python, and it matters more than it looks.
 *
 * Fini, 24 September 2026, with a screenshot of a black terminal sitting on
 * top of the site he was reviewing: *"THE FUCK YOU KEEP DOING WITH THIS??? it
 * distrpts my flow."*
 *
 * `launch` below passes `detached: true` so ComfyUI outlives the runner, and
 * on Windows a detached CONSOLE application gets its own console window —
 * `windowsHide` does not save you, because the window belongs to the new
 * console, not to the process. python.exe is a console application.
 * pythonw.exe is the same interpreter built as a GUI application: no console,
 * nothing to pop up, nothing to click away.
 *
 * Something that starts itself has to start itself INVISIBLY. A background
 * service that steals focus is not a background service.
 */
const COMFY_PY =
  process.env.COMFY_PYTHON ??
  (existsSync(`${COMFY_DIR}/venv/Scripts/pythonw.exe`)
    ? `${COMFY_DIR}/venv/Scripts/pythonw.exe`
    : `${COMFY_DIR}/venv/Scripts/python.exe`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function answering(url: string, ms = 2500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start something and let go of it.
 *
 * `detached` plus `unref` so the child outlives this process: the runner
 * restarts, Ollama does not need to. stdio is ignored rather than piped
 * because nothing here reads it and a full pipe buffer would wedge the child.
 */
function launch(exe: string, args: string[], cwd?: string): number | null {
  const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true, cwd });
  child.unref();
  return child.pid ?? null;
}

/**
 * The pid of the ComfyUI WE started, or null.
 *
 * It matters which one it is. Cinema Studio drives the same ComfyUI on the
 * same card (sm-fixed), and a runner that shuts down a ComfyUI somebody
 * else is drawing with is worse than one that leaves 19 GB held. So the
 * runner only ever closes its own.
 */
const OURS = process.env.DESK_COMFY_PID ?? "E:/Balkaris/Code/balkaris-desk/logs/comfy.pid";

function remember(pid: number | null): void {
  try {
    if (pid === null) {
      rmSync(OURS, { force: true });
      return;
    }
    mkdirSync(dirname(OURS), { recursive: true });
    writeFileSync(OURS, String(pid), "utf8");
  } catch {
    /* Cannot write it: we simply will not close that ComfyUI. Leaving one
       running is the safe failure, and the noisy one — he will see it. */
  }
}

function ourComfy(): number | null {
  try {
    const pid = Number(readFileSync(OURS, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Is that pid really the ComfyUI we started?
 *
 * Pids are reused, the note on disk outlives the process it names, and the
 * next thing this function does is kill something. Windows has no cheap
 * per-pid identity, so it asks wmic for the command line and insists on
 * seeing main.py in it. Anything unexpected — no answer, a different
 * program, wmic missing — means no.
 */
function isComfy(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "wmic",
      ["process", "where", `processid=${pid}`, "get", "commandline", "/format:list"],
      { timeout: 10_000, windowsHide: true },
      /* Both separators. We spawn it with forward slashes, Windows reports
         command lines with whichever it was given, and a character class that
         lost its backslash would simply never match — which fails quietly as
         "ComfyUI was never ours", i.e. never closed. */
      (err, stdout) => resolve(!err && /comfyui[\\/]+main\.py/i.test(stdout)),
    );
  });
}

async function waitFor(label: string, url: string, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    if (await answering(url)) {
      console.log(`  ${label} is up (${i + 1}s)`);
      return true;
    }
  }
  return false;
}

/** The writer's engine. Quick to start; a cold model load is the slow part. */
export async function ensureOllama(): Promise<boolean> {
  if (await answering(`${OLLAMA_URL}/api/tags`)) return true;

  if (!existsSync(OLLAMA_EXE)) {
    console.error(`  Ollama is not running and I cannot find it at ${OLLAMA_EXE}`);
    return false;
  }
  console.log("  Ollama is not running — starting it");
  launch(OLLAMA_EXE, ["serve"]);
  return waitFor("Ollama", `${OLLAMA_URL}/api/tags`, 45);
}

/**
 * The cover's engine.
 *
 * Slower: it loads torch and scans the model folders, which is tens of seconds
 * on a good day. Worth noting that Cinema Studio also manages ComfyUI's
 * lifecycle and sleeps it when idle, which is exactly why the desk has to be
 * able to wake it rather than assume it.
 */
export async function ensureComfy(): Promise<boolean> {
  if (await answering(`${COMFY_URL}/system_stats`)) return true;

  if (!existsSync(COMFY_PY)) {
    console.error(`  ComfyUI is not running and I cannot find its python at ${COMFY_PY}`);
    return false;
  }
  console.log("  ComfyUI is not running — starting it");
  remember(launch(COMFY_PY, [`${COMFY_DIR}/main.py`, "--listen", "127.0.0.1", "--port", COMFY_PORT], COMFY_DIR));
  return waitFor("ComfyUI", `${COMFY_URL}/system_stats`, 180);
}

/**
 * Hand the card over.
 *
 * ONE CARD, ONE QUEUE was always the rule and starting both services made it
 * bite: ComfyUI sits on about 19 GB once it has drawn something, and
 * gemma4:26b then cannot load at all — "failed to initialize the context...
 * this warning is normal during memory fitting", three attempts, job stuck.
 * The desk had stopped colliding with itself in TIME and started colliding in
 * MEMORY.
 *
 * So each engine is asked to let go before the other is used. Both are polite
 * requests to free weights, not shutdowns: the process stays up and reloads in
 * seconds, which is far cheaper than starting it again.
 */
async function freeComfy(): Promise<void> {
  if (!(await answering(`${COMFY_URL}/system_stats`, 1500))) return;
  try {
    await fetch(`${COMFY_URL}/free`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(20_000),
    });
    console.log("  asked ComfyUI for the card back");
    /* Freeing is not instant and the next thing we do is load 19 GB. */
    await sleep(3000);
  } catch {
    /* It did not answer; the load below will say so far more clearly. */
  }
}

async function freeOllama(): Promise<void> {
  if (!(await answering(`${OLLAMA_URL}/api/tags`, 1500))) return;
  try {
    /* keep_alive 0 unloads the model immediately. An empty prompt does no
       work and costs nothing. */
    const { WRITE_MODEL } = await import("./llm.ts");
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: WRITE_MODEL, prompt: "", keep_alive: 0 }),
      signal: AbortSignal.timeout(20_000),
    });
    console.log("  asked Ollama for the card back");
    await sleep(2000);
  } catch {
    /* same */
  }
}


/**
 * GIVE THE MACHINE BACK.
 *
 * Fini, 24 September 2026: *"why can when I send a message it wakes up
 * anything it needs and then when job finish it turn it off."*
 *
 * The runner learned to start things and never learned to stop them, so one
 * shared TikTok left ComfyUI sitting on about 19 GB of the card for the rest
 * of the day, on the machine he actually works on. Waking up for a job is
 * only half of the behaviour; the other half is going back to sleep.
 *
 * What it does, in order of how much it frees:
 *
 *   · ComfyUI is CLOSED, not just asked to unload — it holds a couple of
 *     gigabytes of system memory even with no model resident, and it costs
 *     about nine seconds to start again. Nine seconds once per idle spell is
 *     a fair price for a card that is free the rest of the time.
 *     Only ever the one this runner started: see `ours`.
 *   · Ollama keeps its server and drops its MODEL. The server idle is
 *     nothing, other tools on this machine use it, and a cold start is
 *     forty-five seconds — all cost, no saving.
 */
export async function release(): Promise<string[]> {
  const freed: string[] = [];

  if (await answering(`${OLLAMA_URL}/api/tags`, 1500)) {
    try {
      const { WRITE_MODEL } = await import("./llm.ts");
      for (const model of new Set([WRITE_MODEL, process.env.QUICK_MODEL ?? "gemma4:12b-it-qat"])) {
        await fetch(`${OLLAMA_URL}/api/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, prompt: "", keep_alive: 0 }),
          signal: AbortSignal.timeout(20_000),
        });
      }
      freed.push("let the writing model go");
    } catch {
      /* Not answering is the same as not holding anything. */
    }
  }

  const pid = ourComfy();
  if (pid !== null && (await isComfy(pid))) {
    await freeComfy();
    try {
      process.kill(pid);
      freed.push("closed ComfyUI");
    } catch {
      /* Already gone, which is the outcome we wanted. */
    }
    remember(null);
  } else if (pid !== null) {
    /* The note is stale: that pid is something else now, or nothing. */
    remember(null);
  }

  return freed;
}

/** What a job needs before it can run, and what has to let go first. */
export async function ensureFor(kind: string): Promise<{ ok: boolean; why?: string }> {
  if (kind === "cover") {
    await freeOllama();
    return (await ensureComfy())
      ? { ok: true }
      : { ok: false, why: "ComfyUI would not start, so there is no cover yet" };
  }
  await freeComfy();
  return (await ensureOllama()) ? { ok: true } : { ok: false, why: "Ollama would not start" };
}
