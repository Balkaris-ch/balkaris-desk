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

import { db } from "./db.ts";

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
    const json = (await res.json()) as { ok: boolean; result?: Record<string, unknown> | true; description?: string };
    if (!json.ok) {
      console.error(`telegram ${method}: ${json.description}`);
      return null;
    }
    return typeof json.result === "object" && json.result ? json.result : {};
  } catch (e) {
    console.error(`telegram ${method}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Telegram's HTML subset is four tags. Everything else must be escaped. */
export const esc = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/**
 * Buttons under a message, in rows.
 *
 * `data` is what Telegram sends back when one is pressed, and it is all the
 * bot learns: 64 bytes at most, so it carries an id and a word and nothing
 * that has to be trusted — the handler looks everything else up.
 */
export type Keyboard = { text: string; data: string }[][];

/* "No buttons" is always said out loud, as an empty keyboard: an edit that
   leaves `reply_markup` out says nothing about the buttons that were there,
   and a question that has been answered must not go on offering itself. */
const markup = (keys?: Keyboard) => ({
  reply_markup: { inline_keyboard: (keys ?? []).map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) },
});

export async function send(chat: number, text: string, replyTo?: number, keys?: Keyboard): Promise<number | null> {
  const r = await call("sendMessage", {
    chat_id: chat,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    ...(keys?.length ? markup(keys) : {}),
  });
  return (r?.message_id as number | undefined) ?? null;
}

/**
 * The owner's own chat: `TELEGRAM_OWNER_ID` when it is set, else the chat that
 * claimed the bot first (src/server.ts, mayUse). Null before either exists.
 */
export function ownerChat(): number | null {
  const env = Number(process.env.TELEGRAM_OWNER_ID ?? 0);
  if (env) return env;
  try {
    const row = db.prepare("SELECT detail FROM events WHERE what = 'owner.claimed' ORDER BY id LIMIT 1").get() as { detail: string } | undefined;
    const chat = row ? Number((JSON.parse(row.detail) as { chat?: number }).chat) : 0;
    return chat || null;
  } catch {
    return null;
  }
}

/**
 * One line to the owner, unasked: the things he must not find out by himself.
 *
 * On 5 October 2026 Vercel switched the website off for an unpaid invoice at
 * 08:28. The desk saw it within two minutes, turned its light red, wrote it in
 * the feed, and told nobody; the owner found out in the afternoon. A feed is
 * read by somebody who is already looking.
 *
 * `text` is HTML as `send` takes it: pass anything that is not ours through
 * `esc`. True when Telegram took it; false without a token, without a known
 * owner, or when the send failed. Never throws.
 */
export async function tellOwner(text: string): Promise<boolean> {
  const chat = ownerChat();
  if (!chat) return false;
  return (await send(chat, text)) !== null;
}

/** Rewrite the message we already sent, so one reply tells the whole story.
 *  Its buttons are replaced by `keys`, and taken away when there are none. */
export async function edit(chat: number, messageId: number, text: string, keys?: Keyboard): Promise<void> {
  await call("editMessageText", {
    chat_id: chat,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...markup(keys),
  });
}

/**
 * Tell Telegram a button press arrived, with a line the person sees for a
 * second over the chat. It must be answered even when there is nothing to
 * say: until it is, the button shows a spinner.
 */
export async function answer(callbackId: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

/**
 * What the bot is sent. A button press is a `callback_query`, and Telegram
 * only delivers the kinds a webhook has asked for — so a bot whose webhook
 * was set before the buttons existed never hears them pressed until it is
 * set again (deploy/webhook.sh).
 */
export const UPDATES = ["message", "edited_message", "callback_query"] as const;

/** Point Telegram at us. Called by deploy/webhook.sh, never at boot. */
export async function setWebhook(url: string, secret: string): Promise<Record<string, unknown> | null> {
  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: UPDATES,
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
