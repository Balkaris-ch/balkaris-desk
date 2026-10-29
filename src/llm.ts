/**
 * The one door to a model.
 *
 * Fini, 22 September 2026: no Anthropic keys here, and that still holds for
 * THIS machine: no key on the workstation, and `ask()` throws on a hosted
 * model name rather than reaching for a paid API by itself. Fini, 29 October
 * 2026: the desk may write with Anthropic when the owner switches it on. So
 * `ask()` first asks the desk which is switched on (GET /runner/ai, at most
 * once a minute). On "anthropic" the call goes to the desk (POST
 * /runner/ai/ask), which calls Claude with the key that stays on the box and
 * counts every dollar against the month's budget (src/ai/claude.ts). Anything
 * but an answer from there (switched back, budget spent, Claude failing, the
 * desk away) and the call is answered here by Ollama, as it always was.
 *
 * Ollama's `format` takes a JSON Schema and constrains generation to it, so a
 * structured answer is a parse and not a hope. It is not perfect — a small
 * model will still leave a required field empty — so `askJson` validates and
 * retries once with the failure quoted back at it before giving up.
 */

export const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");

/** gemma4:26b writes; the 12b answers the cheap questions. Both are on the 4090. */
export const WRITE_MODEL = process.env.WRITE_MODEL ?? "gemma4:26b";
export const QUICK_MODEL = process.env.QUICK_MODEL ?? "gemma4:12b-it-qat";

const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 16384);

export interface AskOptions {
  model?: string;
  system?: string;
  /** A JSON Schema. With one, the reply is constrained to it. */
  schema?: Record<string, unknown>;
  temperature?: number;
  /** Ollama has no timeout of its own; a cold 26b load can take a minute. */
  timeoutMs?: number;
  /**
   * Base64 images for a vision pass, on the user message the way Ollama wants
   * them. Used to read a carousel's slides with the 12b, which is the one
   * model that fits beside ComfyUI and Whisper on the card.
   */
  images?: string[];
  /** How many times this call has already waited for Ollama to come back. Internal. */
  waited?: number;
  /** For the desk's spend record when Anthropic answers: "write", "operator", "carousel". */
  purpose?: string;
  /** Ollama only, whatever the switch says. Internal: the fallback after Anthropic failed. */
  local?: boolean;
}

/* ---------- the switch: local or Anthropic -------------------------------- */

let desk: { url: string; secret: string } | null = null;
/** The runner tells this module where the desk is, once, at start. Without it every call is local. */
export function useDesk(url: string, secret: string): void {
  desk = { url: url.replace(/\/$/, ""), secret };
}

let mode: { at: number; provider: "local" | "anthropic" } | null = null;
export async function aiProvider(): Promise<"local" | "anthropic"> {
  if (!desk) return "local";
  if (mode && Date.now() - mode.at < 60_000) return mode.provider;
  let p: "local" | "anthropic" = "local";
  try {
    const res = await fetch(`${desk.url}/runner/ai`, { headers: { authorization: `Bearer ${desk.secret}` }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) p = ((await res.json()) as { provider?: string }).provider === "anthropic" ? "anthropic" : "local";
  } catch {
    /* the desk away: write locally */
  }
  if (p !== mode?.provider) console.log(p === "anthropic" ? "  the desk says: write with Anthropic" : "  the desk says: write locally");
  mode = { at: Date.now(), provider: p };
  return p;
}

/** The call, answered by Claude through the desk. Null means "answer it locally". */
async function viaDesk(prompt: string, opts: AskOptions): Promise<AskResult | null> {
  if (!desk) return null;
  try {
    const res = await fetch(`${desk.url}/runner/ai/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${desk.secret}` },
      body: JSON.stringify({
        prompt,
        system: opts.system,
        schema: opts.schema ?? null,
        images: opts.images,
        quick: opts.model === QUICK_MODEL,
        purpose: opts.purpose,
      }),
      signal: AbortSignal.timeout(Math.max(opts.timeoutMs ?? 0, 300_000) + 30_000),
    });
    if (res.status === 409) {
      mode = { at: Date.now(), provider: "local" };
      console.log(`  Anthropic is off now (${((await res.json().catch(() => ({}))) as { why?: string }).why ?? "switched back"}): writing locally`);
      return null;
    }
    if (!res.ok) {
      console.log(`  Claude did not answer (${((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.status}): writing this one locally`);
      return null;
    }
    const r = (await res.json()) as AskResult;
    answered.set(r.model, (answered.get(r.model) ?? 0) + 1);
    return { text: r.text, model: r.model, ms: r.ms, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
  } catch (e) {
    console.log(`  the desk did not pass the call to Claude (${e instanceof Error ? e.message : String(e)}): writing this one locally`);
    return null;
  }
}

/* Ollama updates itself (Fini, 14 October 2026: keep it so). While it does,
   its server is gone for a minute or two and every call fails with "not
   answering", which used to spend a job's three attempts in seconds. A call
   now waits for it: half a minute at a time, five times, starting it if it
   is not running (ensure.ts), and only then fails. */
const OLLAMA_WAITS = 5;
const OLLAMA_WAIT_MS = Number(process.env.OLLAMA_WAIT_MS ?? 30_000);

export interface AskResult {
  text: string;
  model: string;
  ms: number;
  tokensIn: number;
  tokensOut: number;
}

function assertLocal(model: string): void {
  if (/^(claude|gpt|gemini|o[0-9]|sonnet|opus|haiku)/i.test(model)) {
    throw new Error(
      `balkaris-desk runs on local models only — "${model}" is a hosted one. ` +
        `See the rule at the top of src/llm.ts; nothing here is allowed to bill.`,
    );
  }
}

/**
 * How many answers each model has given in this process. A caller that makes
 * several calls (the writer makes one per section) compares it before and
 * after, so a draft records the model that really wrote it, the 12b included
 * when the 26b could not load (`modelsSince`).
 */
const answered = new Map<string, number>();
export const answeredSoFar = (): Map<string, number> => new Map(answered);
/** The models that answered since `before` was taken, joined for a label: "gemma4:26b + gemma4:12b-it-qat". */
export function modelsSince(before: Map<string, number>, fallback: string): string {
  const used = [...answered].filter(([m, n]) => n > (before.get(m) ?? 0)).map(([m]) => m);
  return used.length ? used.join(" + ") : fallback;
}

/* ---------- does the 26b fit right now? ------------------------------------
 * 14 October 2026: with another program on the card (DaVinci Resolve, a game)
 * the 26b either fails to load at once or loads half onto the processor and
 * then takes four minutes to time out. Ask first: if it is not loaded already
 * and the card has less free memory than it needs, write with the 12b
 * straight away. Asked at most once a minute; if the card cannot be asked,
 * the 26b is tried as before. */
const WRITE_MODEL_MIB = Number(process.env.WRITE_MODEL_MIB ?? 17_500);
let fits: { at: number; ok: boolean; why: string } | null = null;

async function writeModelFits(): Promise<{ ok: boolean; why: string }> {
  if (fits && Date.now() - fits.at < 60_000) return fits;
  let ok = true;
  let why = "";
  try {
    const ps = (await (await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(5_000) })).json()) as { models?: { name?: string; model?: string; size_vram?: number }[] };
    const loaded = (ps.models ?? []).some((m) => m.name === WRITE_MODEL || m.model === WRITE_MODEL);
    if (!loaded) {
      const { execFile } = await import("node:child_process");
      const free = await new Promise<number | null>((resolve) =>
        execFile("nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], { timeout: 5_000, windowsHide: true }, (e, out) =>
          resolve(e ? null : Number(String(out).trim().split(/\r?\n/)[0])),
        ),
      );
      /* What Ollama holds for another model (the 12b, say) it gives back to load the 26b, so it counts as free. */
      const ollamaHolds = Math.round((ps.models ?? []).reduce((s, m) => s + (m.size_vram ?? 0), 0) / 1048576);
      if (free !== null && Number.isFinite(free) && free + ollamaHolds < WRITE_MODEL_MIB) {
        ok = false;
        why = `${free + ollamaHolds} MB free on the graphics card and ${WRITE_MODEL} needs about ${WRITE_MODEL_MIB}`;
      }
    }
  } catch {
    /* Ollama's list or the card could not be asked: try the 26b, as before this check existed. */
  }
  fits = { at: Date.now(), ok, why };
  return fits;
}

export async function ask(prompt: string, opts: AskOptions = {}): Promise<AskResult> {
  if (!opts.local && !opts.waited && (await aiProvider()) === "anthropic") {
    const got = await viaDesk(prompt, opts);
    if (got) return got;
    opts = { ...opts, local: true };
  }
  const asked = opts.model ?? WRITE_MODEL;
  let model = asked;
  if (asked === WRITE_MODEL && WRITE_MODEL !== QUICK_MODEL) {
    const f = await writeModelFits();
    if (!f.ok) {
      console.log(`  ${WRITE_MODEL} does not fit now (${f.why}): writing with ${QUICK_MODEL}`);
      model = QUICK_MODEL;
    }
  }
  assertLocal(model);

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 240_000);

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: opts.schema,
        /* LOCAL-AI.md, the hard way: a thinking model spends its budget
           reasoning and then truncates the JSON, so a structured call gets a
           half-finished object and a confusing parse error. Off for every
           call here, because every call here is structured. */
        think: false,
        options: { temperature: opts.temperature ?? 0.4, num_ctx: NUM_CTX },
        messages: [
          ...(opts.system ? [{ role: "system", content: opts.system }] : []),
          { role: "user", content: prompt, ...(opts.images?.length ? { images: opts.images } : {}) },
        ],
      }),
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    /* The 26b loaded half onto the processor and ran out of time: the 12b answers instead of the job failing. */
    if (why.includes("abort") && model === WRITE_MODEL && model !== QUICK_MODEL) {
      console.log(`  ${model} did not answer in time: writing with ${QUICK_MODEL} instead`);
      fits = { at: Date.now(), ok: false, why: `${model} timed out a moment ago` };
      return ask(prompt, { ...opts, model: QUICK_MODEL });
    }
    if (!why.includes("abort") && (opts.waited ?? 0) < OLLAMA_WAITS) {
      const n = (opts.waited ?? 0) + 1;
      console.log(`  Ollama is not answering (${why}); it may be updating itself. Waiting ${Math.round(OLLAMA_WAIT_MS / 1000)} s (${n} of ${OLLAMA_WAITS})`);
      await new Promise((r) => setTimeout(r, OLLAMA_WAIT_MS));
      try {
        await (await import("./ensure.ts")).ensureOllama();
      } catch {
        /* starting it is a courtesy; the next try says whether it is back */
      }
      clearTimeout(timer);
      return ask(prompt, { ...opts, model: asked, waited: n });
    }
    throw new Error(
      why.includes("abort")
        ? `${model} did not answer in time. A cold 26b takes a while on first load — try again, or set WRITE_MODEL to the 12b.`
        : `Ollama is not answering at ${OLLAMA_URL} (${why}). Start it, then try again.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const said = (await res.text()).slice(0, 300);
    /* The 26b needs about 17 GB of the card's 24. When another program holds
       the rest (8 October 2026: DaVinci Resolve, 7 GB), Ollama cannot load it
       and says only "error loading model: vector", three times, and the link
       sticks. The 12b fits beside it: write with that rather than not at all.
       The answer names the model it came from, so the draft records it. */
    if (model === WRITE_MODEL && model !== QUICK_MODEL && /error loading model|llama-server process has terminated|out of memory|unable to allocate/i.test(said)) {
      console.log(`  ${model} would not load (graphics memory taken by another program?): writing with ${QUICK_MODEL} instead`);
      return ask(prompt, { ...opts, model: QUICK_MODEL });
    }
    throw new Error(`Ollama ${res.status}: ${said}`);
  }

  const json = (await res.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };

  answered.set(model, (answered.get(model) ?? 0) + 1);
  return {
    text: json.message?.content ?? "",
    model,
    ms: Date.now() - started,
    tokensIn: json.prompt_eval_count ?? 0,
    tokensOut: json.eval_count ?? 0,
  };
}

/**
 * The same call, parsed and checked. `validate` throws with a sentence a
 * model can act on ("takeaways must have at least three entries"), and that
 * sentence is what the retry is given.
 */
export async function askJson<T>(
  prompt: string,
  schema: Record<string, unknown>,
  validate: (v: unknown) => T,
  opts: AskOptions = {},
): Promise<{ value: T; result: AskResult }> {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = attempt === 0 ? prompt : `${prompt}\n\nYour last answer was rejected: ${last}\nAnswer again, fixing only that.`;
    const result = await ask(body, { ...opts, schema });
    try {
      return { value: validate(JSON.parse(result.text)), result };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`the model could not produce a usable answer: ${last}`);
}

/** Is the local machine actually up? Used by the bot before it promises anything. */
export async function health(): Promise<{ ok: boolean; models: string[]; why?: string }> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, models: [], why: `Ollama answered ${res.status}` };
    const json = (await res.json()) as { models?: { name: string }[] };
    return { ok: true, models: (json.models ?? []).map((m) => m.name) };
  } catch (e) {
    return { ok: false, models: [], why: e instanceof Error ? e.message : String(e) };
  }
}
