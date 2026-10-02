import { db, lastBeat, log } from "./db.ts";
import { extract, ExtractError, firstUrl } from "./extract.ts";
import { match } from "./match.ts";
import { serviceName, TOPICS } from "./catalogue.ts";
import { edit, esc, send, type Keyboard } from "./telegram.ts";
import { isSocial, platformOf } from "./social/shape.ts";
import { FORMATS, formatIn, type Format } from "./templates.ts";

/**
 * A link arrives.
 *
 * Everything here runs on the box, so it happens the moment somebody presses
 * send: the page is fetched and read, the shelf and the services are decided
 * by the table in match.ts, and the whole thing is saved and queued. Only the
 * writing waits for the workstation.
 *
 * The reply is ONE message that changes three times — reading it, what it
 * turned out to be, and where it now stands — because a person who shares a
 * link wants to watch one line, not collect five.
 *
 * A link shared twice is not a second row. The second share finds the first
 * and says what became of it, which is most of the value of a link collector:
 * "we already have that one, it went out in August".
 */

export interface LinkRow {
  id: number;
  url: string;
  title: string | null;
  site: string | null;
  topic: string | null;
  services: string | null;
  state: string;
  created_at: string;
}

/**
 * "Attach the video, or just the text."
 *
 * Fini, 24 September 2026: *"we have the choice also when we add a link. Say
 * attach the video or just text."*
 *
 * A WORD IN THE MESSAGE, not a question the bot asks back. He shares these
 * from a phone, out of TikTok's own share sheet, usually with the link and
 * nothing else — and a bot that replies "attach the video? yes/no" to every
 * share turns a one-second action into a conversation. So attaching is the
 * default, because a video worth sharing is usually worth showing, and
 * anybody who wants prose says so in the same breath.
 *
 * Whatever he types alongside the link is searched, so "text only" works as a
 * caption, a reply or a line under the url. The desk's draft page can change
 * its mind afterwards; nothing has to be read again either way.
 */
const TEXT_ONLY = /\b(text[ -]?only|no video|just (the )?text|without (the )?video)\b/i;

/**
 * "Give me options on how to write the articles."
 *
 * Fini, 2 October 2026 — and this time he asked for the question the note
 * above decided against. The two are different decisions. Whether to attach a
 * video has a right answer nearly every time, so a default and a word is
 * enough. HOW A PIECE IS WRITTEN — the standard way, long, technical, or
 * short and plain (templates.ts `FORMATS`) — is a decision about its reader,
 * there is no default that is usually right, and he asked to be offered it.
 *
 * So both, and neither costs him the one-second share:
 *
 *   · a word beside the link ("long", "tech", "simple") is the answer, and
 *     the bot asks nothing;
 *   · without one, its reply carries four buttons. The job is held for
 *     `HOLD_SECONDS`, so a press decides before anything is written, and a
 *     link shared and forgotten is written the standard way when the hold
 *     runs out. The question never becomes a reason a link sits unwritten.
 *
 * A press after the writing has started changes nothing and says so. Writing
 * a published piece again in another format is a different job (a second
 * article at a second address, or a replaced one) and is not offered here.
 */
export const HOLD_SECONDS = 90;

export const formatKeys = (linkId: number): Keyboard => [
  [
    { text: FORMATS.standard.button, data: `f:${linkId}:standard` },
    { text: FORMATS.deep.button, data: `f:${linkId}:deep` },
  ],
  [
    { text: FORMATS.technical.button, data: `f:${linkId}:technical` },
    { text: FORMATS.simple.button, data: `f:${linkId}:simple` },
  ],
];

const ASK = "How should I write it? <i>No answer in a minute and a half and I write it the standard way.</i>";

const STATE_WORDS: Record<string, string> = {
  new: "waiting to be written",
  queued: "waiting to be written",
  drafted: "written, waiting for you to approve it",
  published: "published",
  failed: "it did not work — the desk has the reason",
};

/**
 * Has a runner asked for work lately, and if not, for how long?
 *
 * Fini, 24 September 2026: *"The workstation is alive - it works."* He was
 * right, and the bot had told him the workstation was asleep, because the
 * only thing this can actually see is whether a RUNNER polled. His machine
 * was on the whole time; the runner process on it had died, and "asleep" sent
 * him looking at a computer that was plainly awake.
 *
 * So it reports the fact rather than an interpretation of it: how long since
 * anything checked in. The difference matters because the two have different
 * remedies. A closed laptop fixes itself when it opens. A dead runner on a
 * running machine fixes itself never, and the message has to be the kind that
 * makes somebody look.
 */
function lastPoll(): { awake: boolean; silentFor: string } {
  const seen = lastBeat();
  if (!seen) return { awake: false, silentFor: "ever" };

  const ms = Date.now() - Date.parse(`${seen}Z`);
  const mins = Math.round(ms / 60_000);
  const hours = Math.round(mins / 60);
  return {
    awake: ms < 5 * 60_000,
    silentFor: mins < 90 ? `${mins} minutes` : hours < 36 ? `${hours} hours` : `${Math.round(hours / 24)} days`,
  };
}

/** What to say when nothing is listening. Names the fix, because there is one. */
const COLD = (silentFor: string) =>
  `Kept and queued — but nothing on the workstation has asked for work in ${silentFor}. ` +
  /* Forward slashes on purpose. A Windows path in a template literal is a
     minefield: the first draft of this line said scripts\\run_runner.cmd and
     shipped a carriage return, because \\r is an escape before it is a folder
     separator. cmd.exe takes either. */
  `If that machine is on, its runner has stopped: <code>scripts/run_runner.cmd</code>. ` +
  `Nothing is lost either way; this goes through the moment it is back.`

/**
 * The line under what the link turned out to be, once how to write it is
 * settled — by a word, by a button, or by the hold running out.
 */
export function settledLine(format: Format, social: boolean): string {
  const seenAt = lastPoll();
  const as = FORMATS[format].as;
  if (!seenAt.awake) return `${COLD(seenAt.silentFor)} It will be written ${as}.`;
  return social ? `Fetching it now, to be written ${as}. I will say what it turned out to be.` : `Writing it now, ${as}.`;
}

/**
 * Rewrite the bot's reply for a link whose format is now known, and take the
 * buttons away. Called from the two places that settle it after the share:
 * the button (server.ts) and the runner taking a job nobody answered.
 */
export async function settle(linkId: number, format: Format): Promise<void> {
  const l = db.prepare("SELECT from_chat, tg_msg, tg_text, kind FROM links WHERE id = ?").get(linkId) as
    | { from_chat: number | null; tg_msg: number | null; tg_text: string | null; kind: string }
    | undefined;
  if (!l?.from_chat || !l.tg_msg) return;
  await edit(l.from_chat, l.tg_msg, `${l.tg_text ?? ""}\n\n${settledLine(format, l.kind === "social")}`.trim());
}

function summarise(topic: string | null, services: string[]): string {
  const shelf = TOPICS.find((t) => t.id === topic)?.name;
  const names = services.map(serviceName);
  const lines = [];
  if (shelf) lines.push(`Shelf: <b>${esc(shelf)}</b>`);
  if (names.length) lines.push(`Services: ${names.map((n) => esc(n)).join(", ")}`);
  else lines.push("Services: <i>none matched — the article may not be about anything we sell</i>");
  return lines.join("\n");
}

/**
 * The whole flow for one shared link. `chat` and `replyTo` are how it talks
 * back; pass neither and it runs silently, which is what scripts/intake.ts
 * does when a link is fed in by hand.
 */
export async function takeLink(
  raw: string,
  who: { chat?: number; user?: number; name?: string; note?: string; replyTo?: number } = {},
): Promise<{ id: number; already: boolean } | null> {
  const url = firstUrl(raw);
  if (!url) return null;

  const chat = who.chat;
  let msg: number | null = null;
  const say = async (text: string, keys?: Keyboard) => {
    if (!chat) return;
    if (msg === null) msg = await send(chat, text, who.replyTo, keys);
    else await edit(chat, msg, text, keys);
  };

  /* How to write it, if the message said. Only a person in a chat can be
     asked, so a link fed in by hand (scripts/intake.ts) is never held: it is
     written the way its words say, or the standard way. */
  const asked = formatIn(`${raw} ${who.note ?? ""}`);
  const ask = Boolean(chat) && !asked;
  const hold = ask ? `+${HOLD_SECONDS} seconds` : null;

  /* The reply ends on the question with its buttons, or on what is happening.
     Either way the part above that line is kept on the row, with the
     message's id, so the button and the runner can rewrite it later. */
  const reply = async (id: number, head: string, social: boolean) => {
    await say(`${head}\n\n${ask ? ASK : settledLine(asked ?? "standard", social)}`, ask ? formatKeys(id) : undefined);
    if (msg !== null) db.prepare("UPDATE links SET tg_msg = ?, tg_text = ? WHERE id = ?").run(msg, head, id);
  };

  /* Already have it? Say what became of it and stop — no second row, no
     second draft, no second fetch of a page we have already read. */
  const seen = db.prepare("SELECT * FROM links WHERE url = ? OR url = ?").get(url, url.replace(/\/$/, "")) as
    | LinkRow
    | undefined;
  if (seen) {
    const svc = seen.services ? (JSON.parse(seen.services) as string[]) : [];
    await say(
      `Already have that one.\n\n<b>${esc(seen.title ?? seen.url)}</b>\n` +
        `Shared ${esc(seen.created_at.slice(0, 10))} — ${esc(STATE_WORDS[seen.state] ?? seen.state)}.\n\n` +
        summarise(seen.topic, svc),
    );
    log("link.duplicate", { url }, seen.id);
    return { id: seen.id, already: true };
  }

  /* A YouTube, TikTok or Instagram link cannot be read here: the box has no
     yt-dlp, no ffmpeg, no Whisper and no GPU. It is kept with everything we
     know from the URL alone and handed to the workstation as an 'ingest' job,
     which resolves it, transcribes or reads it, matches it and writes it in
     one pass. The shelf and the services therefore arrive LATER for a social
     link than for an article, which is the honest trade and the reply says so. */
  if (isSocial(url)) {
    /* The whole message, not just the note: the word may be anywhere around
       the link, and on a phone it is usually typed after it. */
    const attach = TEXT_ONLY.test(`${raw} ${who.note ?? ""}`) ? 0 : 1;
    const info = db
      .prepare(
        `INSERT INTO links (url, from_chat, from_user, from_name, note, kind, state, attach, format)
         VALUES (?,?,?,?,?,'social','queued',?,?)`,
      )
      .run(url, who.chat ?? null, who.user ?? null, who.name ?? null, who.note ?? null, attach, asked);
    const id = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO jobs (link_id, kind, not_before) VALUES (?, 'ingest', datetime('now', ?))").run(id, hold);
    log("link.social", { url, format: asked }, id);

    const where = platformOf(url) ?? "a social post";
    const how = attach ? "" : " Just the text, no player.";
    await reply(id, `That is ${esc(where)}.${how}`, true);
    return { id, already: false };
  }

  await say("Reading it…");

  let piece;
  try {
    piece = await extract(url);
  } catch (e) {
    const why = e instanceof ExtractError ? e.message : e instanceof Error ? e.message : String(e);
    /* The link is still kept. A page behind a paywall today may be readable
       tomorrow, and the point of a collector is that nothing is dropped. */
    const info = db
      .prepare("INSERT INTO links (url, from_chat, from_user, from_name, note, state, error) VALUES (?,?,?,?,?,'failed',?)")
      .run(url, who.chat ?? null, who.user ?? null, who.name ?? null, who.note ?? null, why.slice(0, 400));
    const id = Number(info.lastInsertRowid);
    log("link.unreadable", { url, why }, id);
    await say(`Kept it, but I could not read it: ${esc(why)}.\n\nIt is on the desk if you want to look.`);
    return { id, already: false };
  }

  const m = match(piece.title, piece.text);
  const services = m.services.map((s) => s.slug);

  const info = db
    .prepare(
      `INSERT INTO links (url, from_chat, from_user, from_name, note, title, site, author, published, words, topic, services, body, state, format)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',?)`,
    )
    .run(
      url,
      who.chat ?? null,
      who.user ?? null,
      who.name ?? null,
      who.note ?? null,
      piece.title,
      piece.site,
      piece.author,
      piece.published,
      piece.words,
      m.topic,
      JSON.stringify(services),
      piece.text,
      asked,
    );

  const id = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO jobs (link_id, kind, not_before) VALUES (?, 'write', datetime('now', ?))").run(id, hold);
  log("link.taken", { url, words: piece.words, topic: m.topic, services, format: asked }, id);

  /* The line it ends on is our own words, with our own markup in them: not
     escaped, unlike every line above it that came off somebody else's page. */
  await reply(
    id,
    `<b>${esc(piece.title)}</b>\n<i>${esc(piece.site)}${piece.author ? ` · ${esc(piece.author)}` : ""} · ${piece.words} words</i>\n\n` +
      summarise(m.topic, services),
    false,
  );

  return { id, already: false };
}
