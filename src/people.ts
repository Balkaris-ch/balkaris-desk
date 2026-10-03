import { db, log } from "./db.ts";
import { areaLevel, grantsColumn, newcomerGrants, parseGrants, type Grants } from "./grants.ts";

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
  /**
   * Publishing needs an email, and edit on Insights (src/grants.ts): somebody
   * the owner gave Insights to read only cannot publish, from the desk or by
   * the bot's automatic publishing.
   */
  canPublish: boolean;
  /**
   * The owner can change anybody's email, byline and access; everyone else
   * can see the team and change nothing about it.
   *
   * Fini, 23 September 2026: *"fini is the super admin and people cannot
   * change other one's emails — they might see the team but they cannot
   * change the emails, and only me I can change, revoke or stuff like
   * that."*
   *
   * Read from DESK_OWNER rather than a column, so ownership cannot be
   * granted from inside the console by anybody, including the owner. It
   * moves by editing the box's .env, which needs the server.
   */
  owner: boolean;
  /** Somebody an owner has switched off. They can sign in, and every door answers 403. */
  revoked: boolean;
  /**
   * May read enquiries: names, contact details, messages.
   *
   * An enquiry is a stranger's personal data, and "has a @balkaris.ch
   * account" is not a reason to read it. So this is off for everybody until
   * the owner switches it on for them, the owner always has it, and a revoked
   * person never does whatever the column says. Nor does somebody whose
   * grants take Leads away: the right to read them is meaningless without
   * the area, and every place that names an enquirer reads this.
   */
  seesLeads: boolean;
  /**
   * What the owner gave them, area by area (src/grants.ts). NULL is no row:
   * everything, as the desk gave everybody before access existed. Never
   * applies to the owner.
   */
  grants: Grants | null;
  /** When the owner added them by address, before they ever signed in; null for everybody who arrived by themselves. */
  invitedAt: string | null;
}

/** The one account that can change other people. */
export const OWNER_EMAIL = (process.env.DESK_OWNER ?? "fini@balkaris.ch").toLowerCase();

db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    telegram   INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT,
    author     TEXT NOT NULL DEFAULT 'balkaris',
    revoked    INTEGER NOT NULL DEFAULT 0,
    sees_leads INTEGER NOT NULL DEFAULT 0,
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

/* Added after the table existed. `grants` NULL is "no row": everything, as before (src/grants.ts). */
for (const column of ["revoked INTEGER NOT NULL DEFAULT 0", "sees_leads INTEGER NOT NULL DEFAULT 0", "grants TEXT", "invited_at TEXT", "invited_by TEXT"]) {
  try {
    db.exec(`ALTER TABLE people ADD COLUMN ${column}`);
  } catch {
    /* already there */
  }
}

const row = (r: Record<string, unknown> | undefined): Person | null => {
  if (!r) return null;
  const owner = String(r.email ?? "").toLowerCase() === OWNER_EMAIL;
  const revoked = !!r.revoked;
  const grants = owner ? null : parseGrants(r.grants);
  const holder = { owner, revoked, grants };
  return {
    telegram: Number(r.telegram),
    name: String(r.name),
    email: (r.email as string | null) ?? null,
    author: String(r.author ?? "balkaris"),
    canPublish: !!r.email && !revoked && areaLevel(holder, "insights") === "edit",
    owner,
    revoked,
    seesLeads: !revoked && (owner || !!r.sees_leads) && areaLevel(holder, "leads") !== "none",
    grants,
    invitedAt: (r.invited_at as string | null) ?? null,
  };
};

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
  /* Somebody nobody invited starts with what the owner chose for newcomers
     (Team › Access & Roles): everything, as before, unless the owner chose otherwise. */
  const grants = email.toLowerCase() === OWNER_EMAIL ? null : newcomerGrants();
  const id = googleId(email);
  db.prepare("INSERT OR REPLACE INTO people (telegram, name, email, author, grants) VALUES (?,?,?,?,?)").run(
    id,
    name,
    email,
    "balkaris",
    grantsColumn(grants),
  );
  log("person.google", { email });
  return getPerson(id)!;
}

/** The row id for somebody known only by their address: negative, so it can never be a Telegram id. */
function googleId(email: string): number {
  return -Math.abs([...email].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) || 1);
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
  return { telegram, name, email: null, author: "balkaris", canPublish: false, owner: false, revoked: false, seesLeads: false, grants: null, invitedAt: null };
}

export function setEmail(telegram: number, email: string | null): void {
  db.prepare("UPDATE people SET email = ? WHERE telegram = ?").run(email, telegram);
  log("person.email", { telegram, set: !!email });
}

export function setRevoked(telegram: number, revoked: boolean): void {
  db.prepare("UPDATE people SET revoked = ? WHERE telegram = ?").run(revoked ? 1 : 0, telegram);
  log("person.revoked", { telegram, revoked });
}

/**
 * Let somebody read enquiries, or stop them.
 *
 * It changes nothing for the owner (always yes) or for a revoked person
 * (always no): see `Person.seesLeads`. The caller checks that it is the owner
 * asking; this only writes it down and records that it happened.
 */
export function setSeesLeads(telegram: number, sees: boolean): void {
  db.prepare("UPDATE people SET sees_leads = ? WHERE telegram = ?").run(sees ? 1 : 0, telegram);
  log("person.leads", { telegram, sees });
}

/**
 * Tie a Telegram account to an email already on the desk.
 *
 * Somebody signs in with Google and gets a row keyed by their address;
 * they then write to the bot and get a second row keyed by a Telegram id.
 * They are one person, and the byline on what they share should be theirs,
 * so the owner joins the two on the people page: the Telegram row's id is
 * kept, the email and byline come across, and the placeholder row goes.
 */
export function link(telegram: number, email: string): boolean {
  const tg = getPerson(telegram);
  const acct = byEmail(email);
  if (!tg || !acct || tg.telegram === acct.telegram) return false;

  /* Everything the owner decided about the account comes across with it,
     including whether it may read enquiries: joining two rows must not
     quietly take a right away, or hand one out. The column is copied as it
     is stored, not as `seesLeads` reads (which is always true for the owner). */
  db.prepare(
    `UPDATE people SET email = ?, author = ?, revoked = ?,
            sees_leads = (SELECT sees_leads FROM people WHERE telegram = ?),
            grants     = (SELECT grants FROM people WHERE telegram = ?),
            invited_at = (SELECT invited_at FROM people WHERE telegram = ?),
            invited_by = (SELECT invited_by FROM people WHERE telegram = ?)
      WHERE telegram = ?`,
  ).run(acct.email, acct.author, acct.revoked ? 1 : 0, acct.telegram, acct.telegram, acct.telegram, acct.telegram, telegram);
  db.prepare("DELETE FROM people WHERE telegram = ?").run(acct.telegram);
  /* What they did on the desk was done as the Google row; it is this person's now. */
  for (const fn of onLink) fn(acct.telegram, telegram);
  log("person.linked", { telegram, email });
  return true;
}

/** Called with (old id, kept id) when two rows become one, so whoever keeps records by id can follow (src/presence.ts). */
const onLink: ((from: number, to: number) => void)[] = [];
export const whenLinked = (fn: (from: number, to: number) => void): void => void onLink.push(fn);

/**
 * What a person may do, area by area: the owner's choice, or NULL for no
 * restriction. The caller checks that the owner is asking; this writes it
 * down and records that it happened. The owner's own row is never written.
 */
export function setGrants(telegram: number, grants: Grants | null): void {
  const p = getPerson(telegram);
  if (!p || p.owner) return;
  db.prepare("UPDATE people SET grants = ? WHERE telegram = ?").run(grantsColumn(grants), telegram);
  log("person.grants", { telegram, grants: grants === null ? "all" : Object.keys(grants) });
}

/**
 * Give somebody access before they ever sign in.
 *
 * The desk's identity is a Google account of the studio's domain, and Google
 * sign-in finds a person by their address (`rememberGoogle`). So an
 * invitation is simply the row their first sign-in will find: their name,
 * their address, the access the owner chose, made now. Nothing is sent: the
 * desk has no mail of its own, and the address is all they need to sign in.
 */
export function invite(email: string, name: string, grants: Grants | null, by: string): Person {
  const id = googleId(email);
  db.prepare("INSERT INTO people (telegram, name, email, author, grants, invited_at, invited_by) VALUES (?,?,?,?,?,datetime('now'),?)").run(
    id,
    name,
    email,
    "balkaris",
    grantsColumn(grants),
    by,
  );
  log("person.invited", { email, by });
  return getPerson(id)!;
}

/** Take back an invitation nobody has used: the row goes, as if it had never been made. */
export function withdraw(telegram: number): void {
  db.prepare("DELETE FROM people WHERE telegram = ? AND telegram < 0 AND invited_at IS NOT NULL").run(telegram);
  log("person.withdrawn", { telegram });
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
