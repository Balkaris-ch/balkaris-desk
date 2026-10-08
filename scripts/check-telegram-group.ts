/**
 * The bot in a group: who it answers there, and what it leaves alone.
 *
 *   npm run check:telegram-group
 *
 * Fini, 8 October 2026: he made the group "Balkaris Insights" for himself and
 * Tiho, and the bot answered "not open" to everything in it, even "group
 * created", because only private chats were let in. What is proved:
 *   1. the owner's link in a group is taken, under his name, and the answer goes to the group;
 *   2. a person allowed in private (Tiho) is taken in the group too;
 *   3. a stranger in the same group is ignored without a word;
 *   4. service messages and chatter in a group get no answer;
 *   5. a stranger in a private chat is still told the bot is not open.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-tg-group-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.TELEGRAM_WEBHOOK_SECRET = "hook";
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.DESK_RUNNER_SECRET = "runner";
process.env.DESK_PORT = "3492";
process.env.DESK_AUTOPUBLISH = "0";
delete process.env.TELEGRAM_OWNER_ID;

const sent: { chat: number; text: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://api.telegram.org/")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id?: number; text?: string };
    if (body.chat_id !== undefined) sent.push({ chat: Number(body.chat_id), text: String(body.text ?? "") });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 900 + sent.length } }), { headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("https://example.test/")) {
    const page = new Response(`<!doctype html><html><head><title>An article</title></head><body><article><h1>An article</h1>${"<p>A paragraph about search engines and the pages that answer what people ask, long enough to be read as an article by the desk.</p>".repeat(8)}</article></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    Object.defineProperty(page, "url", { value: url });
    return page;
  }
  return realFetch(input as never, init);
}) as typeof fetch;

await import("../src/server.ts");
const { db } = await import("../src/db.ts");

let failed = 0;
const check = (what: string, ok: boolean, got = "") => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  (got ${got})`}`);
};

let id = 1;
const OWNER = 7771262300;
const TIHO = 7274175494;
const STRANGER = 5550001;
const GROUP = -5166382828;
const tg = async (message: Record<string, unknown>) => {
  await realFetch("http://127.0.0.1:3492/tg/hook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "hook" },
    body: JSON.stringify({ update_id: id, message: { message_id: id++, ...message } }),
  });
  await new Promise((r) => setTimeout(r, 900)); /* the handler works after it has answered */
};
const say = (chat: number, type: string, from: number, name: string, text?: string) =>
  tg({ chat: { id: chat, type }, from: { id: from, first_name: name }, ...(text === undefined ? {} : { text }) });
const linksFrom = (chat: number) => (db.prepare("SELECT from_user, from_name FROM links WHERE from_chat = ?").all(chat) as { from_user: number; from_name: string }[]);

/* The owner claims the bot in private, the way the real one was claimed; Tiho is let in in private. */
await say(OWNER, "private", OWNER, "Fini", "/status");
db.prepare("INSERT INTO events (what, detail) VALUES ('chat.allowed', ?)").run(JSON.stringify({ chat: TIHO }));
sent.length = 0;

await say(GROUP, "group", OWNER, "Fini", undefined);
await say(GROUP, "group", OWNER, "Fini", "morning Tiho");
check("a service message and chatter in the group get no answer", sent.length === 0, JSON.stringify(sent));

await say(GROUP, "group", OWNER, "Fini", "https://example.test/an-article");
let rows = linksFrom(GROUP);
check("the owner's link in the group is taken", rows.length === 1, JSON.stringify(rows));
check("under the owner's name", rows[0]?.from_user === OWNER, JSON.stringify(rows[0]));
check("and the answer goes to the group", sent.some((s) => s.chat === GROUP), JSON.stringify(sent));

await say(GROUP, "group", TIHO, "Tiho", "https://example.test/another-article");
rows = linksFrom(GROUP);
check("Tiho's link in the group is taken, under his name", rows.length === 2 && rows[1]?.from_user === TIHO, JSON.stringify(rows));

sent.length = 0;
await say(GROUP, "group", STRANGER, "Someone", "https://example.test/a-third");
check("a stranger's link in the group is ignored", linksFrom(GROUP).length === 2, JSON.stringify(linksFrom(GROUP)));
check("without a word in the group", sent.length === 0, JSON.stringify(sent));

await say(STRANGER, "private", STRANGER, "Someone", "hello");
check("a stranger in private is told the bot is not open", sent.some((s) => s.chat === STRANGER && /not open/.test(s.text)), JSON.stringify(sent));

globalThis.fetch = realFetch;
/* The database is still open on Windows; the folder is in the temp dir either way. */
try {
  rmSync(dir, { recursive: true, force: true });
} catch {}
console.log(failed ? `\n${failed} failed.` : "\nall passed; nothing was sent to Telegram.");
process.exit(failed ? 1 : 0);
