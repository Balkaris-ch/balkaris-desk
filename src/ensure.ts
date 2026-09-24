import { spawn, type ChildProcess } from "node:child_process";
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
/*
 * NO WINDOW, AND STILL OURS. Two requirements that fought each other for a day.
 *
 * Fini, 24 September 2026, with a screenshot of a black terminal sitting on
 * top of the site he was reviewing: *"THE FUCK YOU KEEP DOING WITH THIS??? it
 * distrpts my flow."* And later the same day: *"when job finish it turn it
 * off."* Invisible, and closeable.
 *
 * The first answer was pythonw.exe with `detached: true`. It solved the window
 * — a detached CONSOLE application gets its own console on Windows and
 * `windowsHide` cannot help, because the window belongs to the new console
 * rather than to the process. It also broke ComfyUI: pythonw is built as a GUI
 * application and has NO stdout at all, and ComfyUI prints on almost every
 * path. It came up, answered once, and died the moment anything made it write
 * — which looked, from the outside, exactly like a successful start
 * followed by a mysterious disappearance. `kill ESRCH` on a process that had
 * been alive four seconds earlier is what finally gave it away.
 *
 * So: python.exe, and NOT detached. Without `detached` no new console is
 * created, `windowsHide` hides the one the child would otherwise show, and it
 * is a genuine child process — which is the part that matters, because a
 * child can be killed by the handle we already hold instead of by a pid
 * written on a note. It dies with the runner, and that is the behaviour we
 * wanted anyway: nothing of ours should outlive the thing that started it.
 */
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

/**
 * The ComfyUI WE started, or null if it was already running when we arrived.
 *
 * A HANDLE, NOT A PID ON A NOTE. The version before this wrote the pid to a
 * file so it would survive a runner restart, then had to prove the pid was
 * still ComfyUI before killing it — pids get reused and the note outlives the
 * process it names. That identity check asked `wmic`, `wmic` has been removed
 * from Windows 11, and a missing program reads as "not ours": ComfyUI was
 * never closed and nothing in the log said so. The replacement asked
 * PowerShell and was still wrong, because the pid it was checking belonged to
 * a pythonw that had already died.
 *
 * All of that machinery existed to answer one question — is this ours? — that
 * a child process answers by existing. ComfyUI is a child now. It dies with
 * the runner, which is the behaviour we wanted anyway, and nothing of ours
 * outlives the thing that started it.
 *
 * It matters that we only ever close our own: Cinema Studio drives the same
 * ComfyUI on the same port 8189 (sm-fixed/.env) and its watchdog only reports
 * on it rather than owning it. If the desk closed one it had not started,
 * somebody's storyboard frames would sit undrawn until a person noticed.
 */
let comfy: ChildProcess | null = null;

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
  /* NOT detached, so no new console is made and `windowsHide` can hide the
     one it would otherwise show; `unref` only frees the event loop and does
     not sever the parent, so this is still a child we hold and can close. */
  comfy = spawn(COMFY_PY, [`${COMFY_DIR}/main.py`, "--listen", "127.0.0.1", "--port", COMFY_PORT], {
    stdio: "ignore",
    windowsHide: true,
    cwd: COMFY_DIR,
  });
  comfy.unref();
  comfy.on("exit", () => {
    comfy = null;
  });
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
/**
 * `/free` DOES NOT FREE ANYTHING. IT ENDS COMFYUI.
 *
 * Measured, because nothing about it looks like that from here: POST
 * /free {unload_models, free_memory} answers **200**, and then the process
 * exits with code 15, every time. This was written as a polite request to
 * drop the weights and keep serving, and it is a shutdown with a success
 * code on it.
 *
 * Two things follow, and the second is the serious one.
 *
 * It explains a line nobody questioned. Every cover job in the log begins
 * "ComfyUI is not running — starting it", including jobs a minute apart. Of
 * course it does: the write job before it had just killed ComfyUI, and seven
 * seconds of startup was being paid on every single picture.
 *
 * And ComfyUI IS SHARED. Cinema Studio drives the same one on the same port
 * 8189 (sm-fixed/.env), and its watchdog only reports on it — nothing owns
 * its lifecycle. So for as long as this has existed, writing a Balkaris
 * article has been terminating whatever storyboard ComfyUI was in the middle
 * of, and the only trace on their side would be frames that quietly never
 * drew. Nobody noticed because the desk's own logs called it "asked ComfyUI
 * for the card back".
 *
 * So it only ever touches a ComfyUI THIS RUNNER STARTED. If one is up that we
 * did not start, it belongs to somebody else and it is left alone, said out
 * loud, and the job proceeds — a write that has to share the card is slower,
 * and slower is not a reason to end someone else's work.
 */
async function freeComfy(): Promise<void> {
  if (!(await answering(`${COMFY_URL}/system_stats`, 1500))) return;

  if (!comfy || comfy.exitCode !== null) {
    console.log("  ComfyUI is running and it is not ours — leaving it alone");
    return;
  }

  try {
    await fetch(`${COMFY_URL}/free`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(20_000),
    });
    console.log("  closed ComfyUI");
    /* It goes down in well under a second, but the next thing we do is load
       19 GB and there is no prize for being early. */
    await sleep(3000);
  } catch {
    /* It did not answer; the load below will say so far more clearly. */
  }
  comfy = null;
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

  /* `freeComfy` is the shutdown — see the note on it — and it already refuses
     to touch a ComfyUI that is not ours. So closing on an empty queue is the
     same call the write path makes, and there is nothing to kill afterwards. */
  if (comfy && comfy.exitCode === null) {
    await freeComfy();

    /* Give it a few seconds to actually go before believing either answer.
       A single probe the instant after was wrong in both directions: it
       reported "still answering" on a port that was dead four seconds later,
       which would have logged a failure on a success. */
    let gone = false;
    for (let i = 0; i < 8 && !gone; i++) {
      await sleep(1000);
      gone = !(await answering(`${COMFY_URL}/system_stats`, 1500));
    }
    if (gone) freed.push("closed ComfyUI");
    else console.error("  ComfyUI would not close — it is still answering on its port");
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
