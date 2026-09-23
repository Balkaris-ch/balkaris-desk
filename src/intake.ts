import { db, log } from "./db.ts";
import { extract, ExtractError, firstUrl } from "./extract.ts";
import { match } from "./match.ts";
import { serviceName, TOPICS } from "./catalogue.ts";
import { edit, esc, send } from "./telegram.ts";
import { isSocial, platformOf } from "./social/shape.ts";

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

const STATE_WORDS: Record<string, string> = {
  new: "waiting to be written",
  queued: "waiting to be written",
  drafted: "written, waiting for you to approve it",
  published: "published",
  failed: "it did not work — the desk has the reason",
};

/** Is a runner awake? Decides whether we promise "shortly" or "when it wakes". */
function workstationAwake(): boolean {
  const row = db.prepare("SELECT MAX(at) a FROM events WHERE what = 'runner.poll'").get() as { a: string | null };
  return !!row.a && Date.now() - Date.parse(`${row.a}Z`) < 5 * 60_000;
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
  const say = async (text: string) => {
    if (!chat) return;
    if (msg === null) msg = await send(chat, text, who.replyTo);
    else await edit(chat, msg, text);
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
    const info = db
      .prepare(
        `INSERT INTO links (url, from_chat, from_user, from_name, note, kind, state)
         VALUES (?,?,?,?,?,'social','queued')`,
      )
      .run(url, who.chat ?? null, who.user ?? null, who.name ?? null, who.note ?? null);
    const id = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO jobs (link_id, kind) VALUES (?, 'ingest')").run(id);
    log("link.social", { url }, id);

    const where = platformOf(url) ?? "a social post";
    await say(
      workstationAwake()
        ? `That is ${esc(where)} — fetching it now. I will say what it turned out to be.`
        : `That is ${esc(where)}. Kept and queued — it needs the workstation, which is asleep, so it gets read when the machine next wakes.`,
    );
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
      `INSERT INTO links (url, from_chat, from_user, from_name, note, title, site, author, published, words, topic, services, body, state)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'queued')`,
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
    );

  const id = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO jobs (link_id, kind) VALUES (?, 'write')").run(id);
  log("link.taken", { url, words: piece.words, topic: m.topic, services }, id);

  const waiting = workstationAwake()
    ? "Writing it now."
    : "Queued — the workstation is asleep, so this gets written when it next wakes.";

  await say(
    `<b>${esc(piece.title)}</b>\n<i>${esc(piece.site)}${piece.author ? ` · ${esc(piece.author)}` : ""} · ${piece.words} words</i>\n\n` +
      `${summarise(m.topic, services)}\n\n${esc(waiting)}`,
  );

  return { id, already: false };
}
