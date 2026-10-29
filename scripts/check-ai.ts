/**
 * The AI switch: local or Anthropic (src/ai/claude.ts, src/llm.ts).
 *
 *   npm run check:ai
 *
 * Fini, 29 October 2026: "I need to be able to switch between local and
 * Antrophic", with $200 a month for Anthropic. What is proved, with no call to
 * Anthropic or Ollama (both are stand-ins here):
 *   1. a new desk writes locally;
 *   2. switched to Anthropic without a key on the server, it still writes locally and says why;
 *   3. with the engine's key readable, Anthropic writes;
 *   4. a month's spend at the budget sends it back to local until the 1st;
 *   5. a schema is closed and stripped of the bounds Anthropic refuses, nested too;
 *   6. a million tokens in and out on Opus 5.5 cost $24;
 *   7. on the workstation, "anthropic" sends the call to the desk and the draft records Claude;
 *   8. a Claude failure at the desk is written locally by Ollama instead;
 *   9. "local" never touches the desk's ask door.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-ai-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.ENGINE_ENV_FILE = path.join(dir, "engine.env");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY_DESK;

let failed = 0;
const check = (n: number, what: string, ok: boolean, got?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${n}. ${what}${ok ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

const ai = await import("../src/ai/claude.ts");
const { db } = await import("../src/db.ts");

check(1, "a new desk writes locally", ai.effective().provider === "local" && ai.settings().provider === "local", ai.effective());

ai.saveSettings({ provider: "anthropic" });
const noKey = ai.effective();
check(2, "Anthropic without a key still writes locally, and says why", noKey.provider === "local" && /no Anthropic key/.test(noKey.why ?? ""), noKey);

writeFileSync(process.env.ENGINE_ENV_FILE, "OTHER=1\nANTHROPIC_API_KEY=sk-ant-test-not-real\n");
check(3, "with the engine's key readable, Anthropic writes", ai.effective().provider === "anthropic" && ai.aiState().key !== null, ai.effective());

db.prepare("INSERT INTO cc_ai_spend (model, purpose, tokens_in, tokens_out, usd, ms) VALUES ('claude-opus-5-5', 'write', 1, 1, 200, 1)").run();
const spent = ai.effective();
check(4, "the month's budget spent sends it back to local", spent.provider === "local" && /budget/.test(spent.why ?? ""), spent);
db.prepare("DELETE FROM cc_ai_spend").run();

const strict = ai.strictSchema({
  type: "object",
  required: ["title", "beats"],
  properties: { title: { type: "string", minLength: 10, maxLength: 70 }, beats: { type: "array", minItems: 3, items: { type: "object", properties: { text: { type: "string" } } } } },
}) as { additionalProperties: boolean; properties: { title: Record<string, unknown>; beats: { minItems?: number; items: { additionalProperties: boolean } } } };
check(
  5,
  "a schema is closed and stripped of the bounds Anthropic refuses",
  strict.additionalProperties === false && !("minLength" in strict.properties.title) && strict.properties.beats.minItems === undefined && strict.properties.beats.items.additionalProperties === false,
  strict,
);

check(6, "a million in and out on Opus 5.5 is $24", Math.abs(ai.costOf("claude-opus-5-5", { input: 1e6, output: 1e6, cacheRead: 0, cacheWrite: 0 }) - 24) < 1e-9);

/* The workstation's side, with the desk and Ollama as stand-ins. */
let deskMode = "anthropic";
let deskFails = false;
let askedDesk = 0;
let askedOllama = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/runner/ai")) return Response.json({ provider: deskMode });
  if (url.endsWith("/runner/ai/ask")) {
    askedDesk++;
    return deskFails ? Response.json({ error: "overloaded" }, { status: 502 }) : Response.json({ text: '{"ok":true}', model: "claude-opus-5-5", ms: 5, tokensIn: 10, tokensOut: 5 });
  }
  if (url.includes("/api/ps")) return Response.json({ models: [{ name: "gemma4:26b" }] });
  if (url.includes("/api/chat")) {
    askedOllama++;
    return Response.json({ message: { content: '{"ok":true}' }, prompt_eval_count: 3, eval_count: 2 });
  }
  throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`);
}) as typeof fetch;

const llm = await import("../src/llm.ts");
llm.useDesk("https://desk.test", "runner");
const before = llm.answeredSoFar();
const a = await llm.ask("Say ok", { schema: { type: "object" } });
check(7, "on Anthropic the call goes to the desk and the draft records Claude", a.model === "claude-opus-5-5" && askedDesk === 1 && askedOllama === 0 && llm.modelsSince(before, "?") === "claude-opus-5-5", { a, askedDesk, askedOllama });

deskFails = true;
const b = await llm.ask("Say ok", { schema: { type: "object" } });
check(8, "a Claude failure is written locally instead", b.model === "gemma4:26b" && askedDesk === 2 && askedOllama === 1, { b, askedDesk, askedOllama });

/* The switch is read at most once a minute; a 409 from the desk resets it, here the stand-in is told directly. */
deskMode = "local";
deskFails = false;
await new Promise((r) => setTimeout(r, 5));
const realNow = Date.now;
Date.now = () => realNow() + 61_000;
const c = await llm.ask("Say ok", { schema: { type: "object" } });
Date.now = realNow;
check(9, "local never touches the desk's ask door", c.model === "gemma4:26b" && askedDesk === 2 && askedOllama === 2, { c, askedDesk, askedOllama });

try {
  db.close();
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* Windows keeps the database file locked a moment longer; the scratch folder is left to the system. */
}
console.log(failed ? `\n${failed} failed` : "\nall 9 passed");
process.exit(failed ? 1 : 0);
