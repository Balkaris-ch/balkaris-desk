import { ask as askModel, QUICK_MODEL, WRITE_MODEL, type AskOptions, type AskResult } from "../../llm.ts";

/**
 * The workstation's half of the AI Operator: one task, if there is one.
 *
 * Called by the runner (src/runner.ts) in its loop, only when it had no
 * article to do: articles always come first, and the box also refuses to
 * hand out a question while an article job is waiting. It asks the box for
 * the next task, runs the finished prompt on the local model through
 * src/llm.ts, and posts the model's text back. That is all. The box built
 * the prompt from its own data, and the box checks the answer (it may send
 * the same task back once with the reason, which is just another task to
 * this function). Nothing here keeps state; nothing here opens the desk's
 * database.
 *
 * WIRING, one line in src/runner.ts's forever loop:
 *
 *     const did = (await once()) || (await operatorOnce({ desk: DESK, name: NAME, secret: SECRET }));
 *
 * with `import { operatorOnce } from "./cc/operator/work.ts";` at the top.
 * It returns true when it did something, so the runner's "quiet" count and
 * its release of the GPU work exactly as they do for articles.
 */

export interface OperatorWork {
  /** The desk's address, as the runner uses it: https://desk.balkaris.ch */
  desk: string;
  /** The runner's name, as it is known to the desk. */
  name: string;
  /** DESK_RUNNER_SECRET. */
  secret: string;
  /** The model call. src/llm.ts `ask` unless a check passes a stand-in. */
  ask?: (prompt: string, opts: AskOptions) => Promise<AskResult>;
  /** Start whatever the model needs. src/ensure.ts `ensureFor("write")` unless a check passes a stand-in. */
  ensure?: () => Promise<{ ok: boolean; why?: string }>;
  /** Where to say what happened. console.log unless given. */
  log?: (line: string) => void;
}

/** A task as the box hands it out (src/cc/operator/queue.ts `Handed`). */
interface Handed {
  id: number;
  kind: string;
  attempt: number;
  system: string;
  prompt: string;
  schema: Record<string, unknown> | null;
  model: "quick" | "write";
  temperature: number;
  timeoutMs: number;
}

/** The desk refused the runner's secret: the one fault the runner's own loop must hear about. */
class Refused extends Error {}

async function post<T>(o: OperatorWork, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${o.desk.replace(/\/$/, "")}/runner${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${o.secret}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw new Refused("the desk refused the runner secret — re-run deploy/mint-secrets.sh");
  if (!res.ok) throw new Error(`desk answered ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Take one operator task, answer it, send the answer back. True when a task
 * was taken (answered or failed), false when there was none.
 *
 * A FAULT IN THE OPERATOR'S DOOR NEVER COSTS THE ARTICLES. Anything but a
 * refused secret (a 503 while the queue cannot be read, a 404 while the box
 * runs a build without these routes, a desk that does not answer) is logged
 * and answered "nothing done", so the runner's loop goes on polling for
 * articles at its usual pace instead of treating the whole desk as down.
 */
export async function operatorOnce(o: OperatorWork): Promise<boolean> {
  const say = o.log ?? ((line: string) => console.log(line));
  let got: { task: Handed | null; wait?: string };
  try {
    got = await post<{ task: Handed | null; wait?: string }>(o, "/op/next", { name: o.name });
  } catch (e) {
    if (e instanceof Refused) throw e;
    say(`operator: no task this time (${e instanceof Error ? e.message : String(e)})`);
    return false;
  }
  const t = got.task;
  if (!t) return false;
  return answer(o, t, say);
}

async function answer(o: OperatorWork, t: Handed, say: (line: string) => void): Promise<boolean> {
  /* The answer could not be delivered: the box hands the task out again after fifteen minutes. */
  const send = async (body: unknown) => {
    try {
      await post(o, `/op/result/${t.id}`, body);
    } catch (e) {
      if (e instanceof Refused) throw e;
      say(`operator: the answer to task ${t.id} could not be delivered (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  say(`\n→ operator task ${t.id} (${t.kind}, attempt ${t.attempt})`);
  const ensure = o.ensure ?? (async () => (await import("../../ensure.ts")).ensureFor("write"));
  let ready: { ok: boolean; why?: string };
  try {
    ready = await ensure();
  } catch (e) {
    ready = { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
  if (!ready.ok) {
    await send({ ok: false, error: ready.why ?? "the local model would not start" });
    return true;
  }

  let r: AskResult;
  try {
    r = await (o.ask ?? askModel)(t.prompt, {
      model: t.model === "quick" ? QUICK_MODEL : WRITE_MODEL,
      system: t.system,
      ...(t.schema ? { schema: t.schema } : {}),
      temperature: t.temperature,
      timeoutMs: t.timeoutMs,
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    say(`  failed: ${why}`);
    await send({ ok: false, error: why });
    return true;
  }
  say(`  answered with ${r.model} in ${Math.round(r.ms / 1000)}s (${r.tokensIn} in, ${r.tokensOut} out)`);
  await send({ ok: true, text: r.text, model: r.model, ms: r.ms });
  return true;
}
