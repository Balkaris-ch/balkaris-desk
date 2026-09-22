/**
 * Talking back.
 *
 * The bot is a webhook, so this is the only outbound half: a `sendMessage`
 * and the two edits that turn one message into a progress line rather than a
 * column of five. A person who shares a link should watch one reply change
 * its mind, not collect a receipt per stage.
 *
 * Nothing here throws. A failed reply must never take down the handler that
 * is trying to say "your link is queued" — the link is already saved by then,
 * and losing the acknowledgement is annoying where losing the link is not
 * recoverable.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const API = `https://api.telegram.org/bot${TOKEN}`;

async function call(method: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { ok: boolean; result?: Record<string, unknown>; description?: string };
    if (!json.ok) {
      console.error(`telegram ${method}: ${json.description}`);
      return null;
    }
    return json.result ?? null;
  } catch (e) {
    console.error(`telegram ${method}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Telegram's HTML subset is four tags. Everything else must be escaped. */
export const esc = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export async function send(chat: number, text: string, replyTo?: number): Promise<number | null> {
  const r = await call("sendMessage", {
    chat_id: chat,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  });
  return (r?.message_id as number | undefined) ?? null;
}

/** Rewrite the message we already sent, so one reply tells the whole story. */
export async function edit(chat: number, messageId: number, text: string): Promise<void> {
  await call("editMessageText", {
    chat_id: chat,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/** Point Telegram at us. Called by scripts/webhook.ts, never at boot. */
export async function setWebhook(url: string, secret: string): Promise<Record<string, unknown> | null> {
  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "edited_message"],
    /* A link shared while the box was restarting should still arrive. */
    drop_pending_updates: false,
  });
}

export async function webhookInfo(): Promise<Record<string, unknown> | null> {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`${API}/getWebhookInfo`, { signal: AbortSignal.timeout(10_000) });
    return ((await res.json()) as { result?: Record<string, unknown> }).result ?? null;
  } catch {
    return null;
  }
}
