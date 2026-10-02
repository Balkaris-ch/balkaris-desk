/**
 * The Telegram question, end to end, against the real server code and a
 * throwaway database — with Telegram itself and the shared pages replaced by
 * a recorder, so nothing leaves this machine and no bot says anything.
 *
 *   npm run check:telegram
 *
 * What is proved:
 *   1. a bare link is answered with the question and four buttons, its job is
 *      held, and the runner is given nothing while it is;
 *   2. a press writes the format on the link, lifts the hold, takes the
 *      buttons away and says what is happening; the runner is then handed a
 *      link that says `deep`;
 *   3. a word beside the link ("tech") is the answer and nothing is asked;
 *   4. nobody answering is the standard way once the hold has run out, and
 *      the reply stops asking at the moment the runner takes the job;
 *   5. a press after that changes nothing and says so;
 *   6. a press from another chat is refused.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "desk-test-"));
process.env.DESK_DB = path.join(dir, "desk.db");
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "hook";
process.env.DESK_RUNNER_SECRET = "runner";
process.env.DESK_PORT = "3491";
process.env.DESK_AUTOPUBLISH = "0";

/* ---- the recorder ---------------------------------------------------------- */
const real = globalThis.fetch;
const sent: { method: string; body: Record<string, unknown> }[] = [];
let nextMessage = 100;

const ARTICLE = (n: string) => `<!doctype html><html><head><title>Article ${n} about search</title></head><body><article>
<h1>Article ${n} about search</h1>
${Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i} of article ${n}. Search engines rank pages, and a company that wants to be found needs pages that answer questions people actually ask, with structured data and a sitemap behind them, which is the kind of SEO work that takes patience.</p>`).join("\n")}
</article></body></html>`;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://api.telegram.org/")) {
    const method = url.split("/").pop()!;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    sent.push({ method, body });
    return new Response(JSON.stringify({ ok: true, result: method === "sendMessage" ? { message_id: nextMessage++ } : true }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (url.startsWith("https://example.test/")) {
    const page = new Response(ARTICLE(url.split("/").pop()!), { headers: { "content-type": "text/html; charset=utf-8" } });
    /* A made Response has no address, and the reader hands its address to the parser. */
    Object.defineProperty(page, "url", { value: url });
    return page;
  }
  return real(input as never, init);
}) as typeof fetch;

await import("../src/server.ts");
const { db } = await import("../src/db.ts");

const BASE = "http://127.0.0.1:3491";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let updateId = 1;
const tg = async (update: Record<string, unknown>) => {
  await real(`${BASE}/tg/hook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "hook" },
    body: JSON.stringify({ update_id: updateId++, ...update }),
  });
  await wait(900); /* the handler works after it has answered */
};
const share = (chat: number, text: string) =>
  tg({ message: { message_id: 10 + updateId, chat: { id: chat, type: "private" }, from: { id: chat, first_name: "Fini" }, text } });
const press = (chat: number, messageId: number, data: string) =>
  tg({ callback_query: { id: `cb${updateId}`, from: { id: chat, first_name: "Fini" }, message: { message_id: messageId, chat: { id: chat } }, data } });
const next = async () =>
  (await (
    await real(`${BASE}/runner/next`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer runner" },
      body: JSON.stringify({ name: "test", kinds: ["ingest", "write", "cover", "clip"] }),
    })
  ).json()) as { job: { id: number; kind: string } | null; link?: { id: number; format: string | null; title: string } };

let failed = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}${detail ? `  — ${detail}` : ""}`);
};
const last = (method: string) => [...sent].reverse().find((s) => s.method === method);
const keysOf = (s?: { body: Record<string, unknown> }) =>
  ((s?.body.reply_markup as { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const row = (id: number) => db.prepare("SELECT format, tg_msg, tg_text FROM links WHERE id = ?").get(id) as { format: string | null; tg_msg: number | null; tg_text: string | null };
const job = (linkId: number) => db.prepare("SELECT state, not_before, datetime('now') now FROM jobs WHERE link_id = ? ORDER BY id DESC LIMIT 1").get(linkId) as { state: string; not_before: string | null; now: string };

await wait(600);
const ME = 4242;

/* A runner has to have polled, or the bot says the workstation is silent. */
await next();

console.log("\n1. a bare link");
await share(ME, "https://example.test/one");
let q = last("editMessageText");
check("the reply ends on the question", String(q?.body.text).includes("How should I write it?"), String(q?.body.text).split("\n").at(-1));
check("with four buttons", keysOf(q).length === 4, keysOf(q).map((k) => k.text).join(" | "));
check("each carrying the link and a format", keysOf(q).every((k) => /^f:1:(standard|deep|technical|simple)$/.test(k.callback_data)));
check("the link has no format yet", row(1).format === null);
check("the bot's message is remembered", row(1).tg_msg !== null && Boolean(row(1).tg_text?.includes("Article one")));
check("its job is held", job(1).not_before !== null && job(1).not_before! > job(1).now, `${job(1).not_before} > ${job(1).now}`);
check("and the runner is given nothing", (await next()).job === null);

console.log("\n2. the Long read button");
await press(ME, row(1).tg_msg!, "f:1:deep");
check("the press is answered", last("answerCallbackQuery")?.body.text === "Long read it is.", String(last("answerCallbackQuery")?.body.text));
q = last("editMessageText");
check("the reply says what is happening", String(q?.body.text).endsWith("Writing it now, as a long read."), String(q?.body.text).split("\n").at(-1));
check("and the buttons are gone", keysOf(q).length === 0 && q?.body.reply_markup !== undefined);
check("the link says deep", row(1).format === "deep");
check("the hold is lifted", job(1).not_before === null);
let got = await next();
check("the runner is handed it, as deep", got.job?.kind === "write" && got.link?.format === "deep", `${got.job?.kind} ${got.link?.format}`);

console.log("\n3. a word beside the link");
const before = sent.length;
await share(ME, "tech please https://example.test/two");
q = last("editMessageText");
check("nothing is asked", !String(q?.body.text).includes("How should I write it?") && keysOf(q).length === 0);
check("it says so", String(q?.body.text).endsWith("Writing it now, from the technical side."), String(q?.body.text).split("\n").at(-1));
check("the link says technical", row(2).format === "technical");
check("the job is not held", job(2).not_before === null);
got = await next();
check("the runner is handed it at once", got.link?.format === "technical", String(got.link?.format));
check("two messages only: reading it, then what it is", sent.length - before === 2, String(sent.length - before));

console.log("\n4. nobody answers");
await share(ME, "https://example.test/three");
check("held, and asking", job(3).not_before !== null && keysOf(last("editMessageText")).length === 4);
db.prepare("UPDATE jobs SET not_before = datetime('now', '-1 seconds') WHERE link_id = 3").run();
got = await next();
await wait(500);
check("once the hold has run out the runner gets it, as standard", got.link?.format === "standard", String(got.link?.format));
q = last("editMessageText");
check("and the reply stops asking", String(q?.body.text).endsWith("Writing it now, the standard way.") && keysOf(q).length === 0, String(q?.body.text).split("\n").at(-1));

console.log("\n5. a press that comes too late");
await press(ME, row(3).tg_msg!, "f:3:simple");
check("changes nothing", row(3).format === "standard");
check("and says so", String(last("answerCallbackQuery")?.body.text).startsWith("Too late for this one"), String(last("answerCallbackQuery")?.body.text));

console.log("\n6. a press from somewhere else");
await share(ME, "https://example.test/four");
await press(999, row(4).tg_msg!, "f:4:simple");
check("is refused", row(4).format === null && last("answerCallbackQuery")?.body.text === undefined);
await press(ME, row(4).tg_msg!, "f:4:nonsense");
check("and so is a format that does not exist", row(4).format === null);
await press(ME, row(4).tg_msg!, "f:4:simple");
check("the right one still works afterwards", row(4).format === "simple" && String(last("editMessageText")?.body.text).endsWith("Writing it now, short and in plain words."));

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}; ${sent.length} calls to Telegram recorded, none sent.`);
db.close();
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* Windows keeps the file a moment longer. */
}
process.exit(failed ? 1 : 0);
