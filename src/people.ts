import { db, log } from "./db.ts";

/**
 * Who works this desk, and whose name goes on what.
 *
 * Fini, 23 September 2026: *"we do not have that email. It should go through
 * whoever publish — we need maybe to add auth to this and the publish go
 * through their email... And on the blog, we attach whoever actually added
 * from the Telegram the name, like Fini, Damir, Tihomir."*
 *
 * TWO DIFFERENT NAMES, AND THEY ARE NOT THE SAME PERSON'S JOB:
 *
 *   who shared it     goes on the article as its byline. Whoever sent the
 *                     link to the bot found the thing and thought it was
 *                     worth writing about, and that is what a byline is for.
 *   who published it  goes on the COMMIT, as its git author, and is the
 *                     reason publishing works at all — Vercel refuses to
 *                     build a commit whose author is not on the team, which
 *                     is exactly what it did to desk@balkaris.ch.
 *
 * So the desk does not have an identity of its own any more. Everything it
 * pushes is pushed as a person.
 *
 * A row is learned, never invented. The bot records a Telegram id the first
 * time somebody writes to it; the email and the byline are filled in by hand
 * because guessing an address produces the same failed deployment and a
 * confusing email to whoever owns the domain.
 */

export interface Person {
  /** Telegram user id. The only identity the bot can actually prove. */
  telegram: number;
  /** What the bot calls them, and what the console shows. */
  name: string;
  /**
   * The address git commits as. It MUST be an email on their Vercel account,
   * or the deployment is refused and the article sits on main doing nothing.
   */
  email: string | null;
  /**
   * The byline on an article they shared: a key of `authors` in the site's
   * content/journal.ts — "fini", "damir", "tihomir", or "balkaris" for the
   * studio. A name that is not in that record falls back to the studio, so a
   * typo costs a byline and never a broken page.
   */
  author: string;
  /** Publishing needs an email. Everything else does not. */
  canPublish: boolean;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    telegram   INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT,
    author     TEXT NOT NULL DEFAULT 'balkaris',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /* One-time login links. The bot sends one; opening it sets the cookie.
     No passwords anywhere — the identity we can prove is the Telegram
     account, so that is the identity the console uses. */
  CREATE TABLE IF NOT EXISTS logins (
    token      TEXT PRIMARY KEY,
    telegram   INTEGER NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const row = (r: Record<string, unknown> | undefined): Person | null =>
  r
    ? {
        telegram: Number(r.telegram),
        name: String(r.name),
        email: (r.email as string | null) ?? null,
        author: String(r.author ?? "balkaris"),
        canPublish: !!r.email,
      }
    : null;

export const getPerson = (telegram: number): Person | null =>
  row(db.prepare("SELECT * FROM people WHERE telegram = ?").get(telegram) as Record<string, unknown> | undefined);

/**
 * The same person, found by the address they signed in with.
 *
 * Since the login became Google, the EMAIL is the identity and it arrives
 * already proved — so there is nothing to type in on a people page and
 * nothing to keep in step. Somebody who has also written to the bot is
 * matched to that row by address, so their byline and their Telegram
 * sharing stay one person.
 */
export const byEmail = (email: string): Person | null =>
  row(db.prepare("SELECT * FROM people WHERE lower(email) = lower(?)").get(email) as Record<string, unknown> | undefined);

/**
 * Remember somebody who signed in with Google.
 *
 * The address is the key. A row already carrying that address is updated;
 * otherwise a new one is made with a NEGATIVE id, because `telegram` is the
 * primary key and this person may never write to the bot at all. When they
 * do, `remember()` links the real id to the same address.
 */
export function rememberGoogle(email: string, name: string): Person {
  const had = byEmail(email);
  if (had) {
    db.prepare("UPDATE people SET name = ? WHERE telegram = ?").run(name, had.telegram);
    return { ...had, name };
  }
  const id = -Math.abs(
    [...email].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) || 1,
  );
  db.prepare("INSERT OR REPLACE INTO people (telegram, name, email, author) VALUES (?,?,?,?)").run(
    id,
    name,
    email,
    "balkaris",
  );
  log("person.google", { email });
  return { telegram: id, name, email, author: "balkaris", canPublish: true };
}

export const everyone = (): Person[] =>
  (db.prepare("SELECT * FROM people ORDER BY name").all() as Record<string, unknown>[])
    .map(row)
    .filter((p): p is Person => !!p);

/**
 * Remember somebody who wrote to the bot.
 *
 * Their name is kept fresh — people change their Telegram display name — but
 * an email and a byline already set are never overwritten by a display name,
 * because those were entered deliberately and this is not.
 */
export function remember(telegram: number, name: string): Person {
  const had = getPerson(telegram);
  if (had) {
    if (had.name !== name) db.prepare("UPDATE people SET name = ? WHERE telegram = ?").run(name, telegram);
    return { ...had, name };
  }
  db.prepare("INSERT INTO people (telegram, name) VALUES (?, ?)").run(telegram, name);
  log("person.new", { telegram, name });
  return { telegram, name, email: null, author: "balkaris", canPublish: false };
}

export function setEmail(telegram: number, email: string | null): void {
  db.prepare("UPDATE people SET email = ? WHERE telegram = ?").run(email, telegram);
  log("person.email", { telegram, set: !!email });
}

export function setAuthor(telegram: number, author: string): void {
  db.prepare("UPDATE people SET author = ? WHERE telegram = ?").run(author, telegram);
  log("person.author", { telegram, author });
}

/* ---------- one-time login links ------------------------------------------- */

/**
 * A link the bot sends, good once.
 *
 * Nobody types a password into this thing. The desk already knows, and can
 * prove, exactly one identity per person — their Telegram account — so the
 * login is: ask the bot, get a link in the chat only you can read, open it.
 */
export function mintLogin(telegram: number): string {
  const token = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  db.prepare("INSERT INTO logins (token, telegram) VALUES (?, ?)").run(token, telegram);
  /* One live link at a time: minting a new one burns the old, so a link
     forwarded by accident stops working the moment its owner asks again. */
  db.prepare("UPDATE logins SET used_at = datetime('now') WHERE telegram = ? AND token != ? AND used_at IS NULL").run(
    telegram,
    token,
  );
  return token;
}

/** Spend a login link. Good once, and only for fifteen minutes. */
export function spendLogin(token: string): Person | null {
  const r = db
    .prepare("SELECT * FROM logins WHERE token = ? AND used_at IS NULL AND created_at > datetime('now', '-15 minutes')")
    .get(token) as { telegram: number } | undefined;
  if (!r) return null;
  db.prepare("UPDATE logins SET used_at = datetime('now') WHERE token = ?").run(token);
  log("person.login", { telegram: r.telegram });
  return getPerson(r.telegram);
}
