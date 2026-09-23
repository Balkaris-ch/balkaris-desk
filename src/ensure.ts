import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
const COMFY_PY = process.env.COMFY_PYTHON ?? `${COMFY_DIR}/venv/Scripts/python.exe`;

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
function launch(exe: string, args: string[], cwd?: string): void {
  const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true, cwd });
  child.unref();
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
  launch(COMFY_PY, [`${COMFY_DIR}/main.py`, "--listen", "127.0.0.1", "--port", COMFY_PORT], COMFY_DIR);
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
