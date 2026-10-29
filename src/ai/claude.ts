import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db.ts";
import { setState, state } from "../cc/store.ts";
import type { AiModel, AiProvider, AiState } from "../../web/src/contract/ai.ts";

/**
 * The switch between the studio PC's local models and Anthropic.
 *
 * Fini, 29 October 2026: "we are now getting 200 dollars per month - so I need
 * to be able to switch between local and Anthropic". Until then the desk wrote
 * with Ollama only (src/llm.ts, the rule of 22 September). Now the owner flips
 * one switch on Settings › Writing or with /ai in Telegram, and every model
 * call the workstation makes (articles, news, the Operator's SEO proposals, a
 * carousel's slides) goes to Claude instead, through this server.
 *
 * THE KEY NEVER LEAVES THE BOX. The workstation asks /runner/ai/ask with its
 * runner secret, and this module calls Anthropic. The key is
 * ANTHROPIC_API_KEY_DESK in the desk's .env when Fini makes one of its own,
 * else the engine's shared ANTHROPIC_API_KEY, read from /opt/balkaris/.env the
 * way the Sales engine reads it: read, never copied, never logged.
 *
 * EVERY CALL IS COUNTED IN DOLLARS (cc_ai_spend) against the month's budget.
 * When the month's spend reaches it, the desk writes locally again by itself
 * until the 1st, and says why wherever the switch is shown. A Claude call that
 * fails is never a failed article either: the workstation writes it locally.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_ai_spend (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL DEFAULT (datetime('now')),
    model      TEXT NOT NULL,
    purpose    TEXT NOT NULL,
    tokens_in  INTEGER NOT NULL,
    tokens_out INTEGER NOT NULL,
    cache_read INTEGER NOT NULL DEFAULT 0,
    cache_write INTEGER NOT NULL DEFAULT 0,
    usd        REAL NOT NULL,
    ms         INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cc_ai_spend_at ON cc_ai_spend (at);
`);

/** Dollars per million tokens: input, output, cache read, cache write (five-minute). */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  /* Where a refusal's server-side fallback may land. */
  "claude-opus-5": [5, 25, 0.5, 6.25],
  "claude-opus-4-8": [5, 25, 0.5, 6.25],
};
/* A model the table does not know is priced at the dearest tier, so the budget errs on the safe side. */
const UNKNOWN: [number, number, number, number] = [10, 50, 1, 12.5];

export const MODELS: { id: AiModel; label: string; note: string }[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "The best writer. About $4 per million words read, $20 per million written." },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Half the price of Opus, a little less careful." },
];

interface Settings {
  provider: AiProvider;
  model: AiModel;
  budgetUsd: number;
}

const DEFAULTS: Settings = { provider: "local", model: "claude-opus-5-5", budgetUsd: 200 };

export function settings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(state("ai.settings") ?? "{}") as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(change: Partial<Settings>): Settings {
  const next = { ...settings() };
  if (change.provider === "local" || change.provider === "anthropic") next.provider = change.provider;
  if (change.model && MODELS.some((m) => m.id === change.model)) next.model = change.model;
  if (typeof change.budgetUsd === "number" && Number.isFinite(change.budgetUsd)) next.budgetUsd = Math.min(2000, Math.max(0, Math.round(change.budgetUsd)));
  setState("ai.settings", JSON.stringify(next));
  return next;
}

/* ---------- the key -------------------------------------------------------- */

const ENGINE_ENV = process.env.ENGINE_ENV_FILE ?? "/opt/balkaris/.env";
let cached: { at: number; key: string | null; from: string } | null = null;

function key(): { key: string | null; from: string } {
  /* A key found is kept five minutes; no key is looked for again on every call, so one added on the box counts at once. */
  if (cached?.key && Date.now() - cached.at < 5 * 60_000) return cached;
  let found: string | null = process.env.ANTHROPIC_API_KEY_DESK?.trim() || null;
  let from = "ANTHROPIC_API_KEY_DESK in the desk's configuration";
  if (!found && process.env.ANTHROPIC_API_KEY?.trim()) {
    found = process.env.ANTHROPIC_API_KEY.trim();
    from = "ANTHROPIC_API_KEY in the desk's configuration";
  }
  if (!found) {
    from = "the engine's shared ANTHROPIC_API_KEY";
    try {
      const line = readFileSync(ENGINE_ENV, "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith("ANTHROPIC_API_KEY="));
      const v = line?.slice("ANTHROPIC_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
      found = v || null;
    } catch {
      found = null;
    }
  }
  cached = { at: Date.now(), key: found, from };
  return cached;
}

/* ---------- the month's spend -------------------------------------------- */

const monthStart = (): string => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:00`;
};

export function spentThisMonth(): { usd: number; calls: number } {
  const r = db.prepare("SELECT COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS calls FROM cc_ai_spend WHERE at >= ?").get(monthStart()) as { usd: number; calls: number };
  return { usd: r.usd, calls: r.calls };
}

export function costOf(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const [i, o, r, w] = PRICES[model] ?? UNKNOWN;
  return (u.input * i + u.output * o + u.cacheRead * r + u.cacheWrite * w) / 1_000_000;
}

/** Which one writes right now, and if it is not the one switched on, why. */
export function effective(): { provider: AiProvider; why: string | null } {
  const s = settings();
  if (s.provider === "local") return { provider: "local", why: null };
  if (!key().key) return { provider: "local", why: "there is no Anthropic key on the server" };
  const spent = spentThisMonth().usd;
  if (spent >= s.budgetUsd) return { provider: "local", why: `this month's budget of $${s.budgetUsd} is spent ($${spent.toFixed(2)}); Anthropic again on the 1st` };
  return { provider: "anthropic", why: null };
}

export function aiState(): AiState {
  const s = settings();
  const e = effective();
  const k = key();
  const spent = spentThisMonth();
  const recent = db
    .prepare("SELECT at, model, purpose, usd FROM cc_ai_spend ORDER BY id DESC LIMIT 8")
    .all() as { at: string; model: string; purpose: string; usd: number }[];
  return {
    provider: s.provider,
    effective: e.provider,
    why: e.why,
    model: s.model,
    models: MODELS,
    budgetUsd: s.budgetUsd,
    spentUsd: Math.round(spent.usd * 100) / 100,
    calls: spent.calls,
    key: k.key ? k.from : null,
    recent: recent.map((r) => ({ ...r, usd: Math.round(r.usd * 1000) / 1000 })),
  };
}

/** One line for Telegram's /ai. */
export function statusText(): string {
  const a = aiState();
  const name = MODELS.find((m) => m.id === a.model)?.label ?? a.model;
  const now = a.effective === "anthropic" ? `Writing with <b>${name}</b> (Anthropic)` : `Writing <b>locally</b> on the studio PC`;
  return (
    `${now}${a.why ? `, because ${a.why}` : ""}.\n` +
    `This month: $${a.spentUsd.toFixed(2)} of $${a.budgetUsd}, ${a.calls} calls.\n` +
    `/ai anthropic or /ai local switches it (the owner only).`
  );
}

/* ---------- the call ------------------------------------------------------- */

/**
 * Anthropic's structured outputs take a narrower JSON Schema than Ollama's
 * `format`: every object closed, no length or number bounds, no array sizes.
 * The bounds are dropped here; the writer's own validators (askJson) still
 * check every one of them and send the reason back, as they do for Ollama.
 */
export function strictSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(strictSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "pattern", "uniqueItems"].includes(k)) continue;
    out[k] = strictSchema(v);
  }
  if (out.type === "object" || out.properties) out.additionalProperties = false;
  return out;
}

/** What kind of picture a base64 string is, by its first bytes. */
function mediaOf(b64: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("UklGR")) return "image/webp";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  return "image/jpeg";
}

export interface ClaudeAsk {
  prompt: string;
  system?: string;
  schema?: Record<string, unknown> | null;
  images?: string[];
  /** The 12b's questions are quick ones: they get low effort. */
  quick?: boolean;
  /** For the spend record: "write", "operator", "carousel". */
  purpose?: string;
}

export interface ClaudeAnswer {
  text: string;
  model: string;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  usd: number;
}

export async function claudeAsk(q: ClaudeAsk): Promise<ClaudeAnswer> {
  const k = key().key;
  if (!k) throw new Error("there is no Anthropic key on the server");
  const s = settings();
  const client = new Anthropic({ apiKey: k, maxRetries: 2, timeout: 300_000 });
  const started = Date.now();

  const stream = client.beta.messages.stream({
    model: s.model,
    max_tokens: 32_000,
    /* A refusal is re-run on the model Anthropic routes that kind of refusal to, inside the same call. */
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...(q.system ? { system: [{ type: "text" as const, text: q.system, cache_control: { type: "ephemeral" as const } }] } : {}),
    output_config: {
      effort: q.quick ? "low" : "medium",
      ...(q.schema ? { format: { type: "json_schema" as const, schema: strictSchema(q.schema) as Record<string, unknown> } } : {}),
    },
    messages: [
      {
        role: "user",
        content: [
          ...(q.images ?? []).map((data) => ({ type: "image" as const, source: { type: "base64" as const, media_type: mediaOf(data), data } })),
          { type: "text" as const, text: q.prompt },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();

  const u = msg.usage;
  const tokens = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
  const usd = costOf(msg.model, tokens);
  const ms = Date.now() - started;
  db.prepare("INSERT INTO cc_ai_spend (model, purpose, tokens_in, tokens_out, cache_read, cache_write, usd, ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    msg.model,
    q.purpose ?? "write",
    tokens.input,
    tokens.output,
    tokens.cacheRead,
    tokens.cacheWrite,
    usd,
    ms,
  );

  if (msg.stop_reason === "refusal") throw new Error(`Claude declined to answer${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""}`);
  if (msg.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off at its length limit");
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { text, model: msg.model, ms, tokensIn: tokens.input + tokens.cacheRead + tokens.cacheWrite, tokensOut: tokens.output, usd };
}
