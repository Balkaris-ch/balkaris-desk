/**
 * The one door to a model, and it only opens onto this machine.
 *
 * Fini, 22 September 2026: no Anthropic keys here. So there is no Anthropic
 * client in this repo, no `ANTHROPIC_API_KEY` in `.env.example`, and `ask()`
 * throws on a model name that is not local rather than quietly reaching for a
 * paid API the way sm-fixed's provider can. A blog post from the desk costs
 * electricity; that is the whole reason the desk exists.
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
}

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

export async function ask(prompt: string, opts: AskOptions = {}): Promise<AskResult> {
  const model = opts.model ?? WRITE_MODEL;
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
        options: { temperature: opts.temperature ?? 0.4, num_ctx: NUM_CTX },
        messages: [
          ...(opts.system ? [{ role: "system", content: opts.system }] : []),
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(
      why.includes("abort")
        ? `${model} did not answer in time. A cold 26b takes a while on first load — try again, or set WRITE_MODEL to the 12b.`
        : `Ollama is not answering at ${OLLAMA_URL} (${why}). Start it, then try again.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = (await res.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };

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
