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
 * Why this person cannot publish, for the sentence that tells them; null when
 * they can. "access": they do not have edit on Insights (or are switched
 * off), and the owner changes that. "address": they have it and no email.
 * Access is asked FIRST, so somebody with neither is not sent to add an email
 * that would not help them.
 */
export function publishBlock(p: Person): "access" | "address" | null {
  if (p.canPublish) return null;
  return areaLevel(p, "insights") !== "edit" ? "access" : "address";
}

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
 *
 * THE ROW ALREADY IN ITS PLACE. The id is made from the address, so a row
 * sitting there without the address is the row of somebody whose address the
 * owner changed or removed since. It used to be replaced whole, which handed
 * a restricted or switched-off person every area back the next time they
 * signed in with the old address. What happens now goes by what the row
 * carries (`landing`):
 *
 *   ANOTHER address   The row is found by the address the owner gave it, and
 *                     a sign-in with the former one does not touch it: not
 *                     its address, byline, enquiry right, grants or
 *                     switch-off. Moving it back would leave the address the
 *                     owner restricted with no row, and that address would
 *                     then sign in as a newcomer. The arriving address goes
 *                     one id below, with what a newcomer gets. While a row it
 *                     passed is restricted or switched off it gets NOTHING,
 *                     and the same switch-off: it may be the same person
 *                     coming in by their former address, so they wait for the
 *                     owner, who sees them on the team as waiting.
 *   NO address        Nobody else is found by this row, so it gets the
 *                     address back and keeps what the owner decided: grants
 *                     that are stored stay exactly as stored and switched off
 *                     stays switched off. With no grants it gets what a
 *                     newcomer gets, as a new row would. The byline and the
 *                     enquiry right do not come back.
 *
 * The id below is read the same way, and the one below that, because that is
 * where the rows made beside the place are: one of them re-addressed in its
 * turn is passed like the first, and one whose address was removed takes the
 * address back, with nothing instead of a newcomer's share, and the same
 * switch-off, where a row passed on the way to it is restricted or switched
 * off.
 *
 * So a sign-in never undoes what the owner decided about a row, and never
 * takes a person off the address the owner gave them. The owner's own address
 * is the one exception, the other way: it always lands on its id unrestricted
 * and switched on, so a row planted there cannot lock the owner out.
 */
export function rememberGoogle(email: string, name: string): Person {
  const had = byEmail(email);
  if (had) {
    db.prepare("UPDATE people SET name = ? WHERE telegram = ?").run(name, had.telegram);
    return { ...had, name };
  }
  const owner = email.toLowerCase() === OWNER_EMAIL;
  const { id, there, limited, off } = landing(email);
  /* Somebody nobody invited starts with what the owner chose for newcomers
     (Team › Access & Roles): everything, as before, unless the owner chose otherwise. */
  const stored = !!there && parseGrants(there.grants) !== null;
  const grants = owner ? null : stored ? (there?.grants ?? null) : limited || off ? grantsColumn({}) : grantsColumn(newcomerGrants());
  const revoked = !owner && (off || there?.revoked) ? 1 : 0;
  db.prepare(
    `INSERT INTO people (telegram, name, email, author, grants, revoked) VALUES (?,?,?,'balkaris',?,?)
     ON CONFLICT(telegram) DO UPDATE SET name = excluded.name, email = excluded.email, author = 'balkaris',
       sees_leads = 0, grants = excluded.grants, revoked = excluded.revoked`,
  ).run(id, name, email, grants, revoked);
  log("person.google", { email });
  return getPerson(id)!;
}

/** The row id for somebody known only by their address: negative, so it can never be a Telegram id. */
function googleId(email: string): number {
  return -Math.abs([...email].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) || 1);
}

type Seat = { email: string | null; grants: string | null; revoked: number };

/**
 * Where a sign-in with an address no row carries lands, by `rememberGoogle`'s
 * rule: past every row that carries another address, on the first id that is
 * free or holds a row with no address (`there`). `limited` and `off` say
 * whether the owner limited or switched off one of the rows passed, and
 * `passed` is the first of them. The ids only go down, so they stay negative
 * and are never a Telegram id; a row made beside its place is found by its
 * address from then on, not by the number. The owner's address passes nobody.
 */
function landing(email: string): { id: number; there: Seat | undefined; passed: number | null; limited: boolean; off: boolean } {
  const seat = db.prepare("SELECT email, grants, revoked FROM people WHERE telegram = ?");
  const place = googleId(email);
  const owner = email.toLowerCase() === OWNER_EMAIL;
  let id = place;
  let there = seat.get(id) as Seat | undefined;
  let limited = false;
  let off = false;
  while (!owner && there?.email) {
    off ||= !!there.revoked;
    limited ||= parseGrants(there.grants) !== null;
    there = seat.get(--id) as Seat | undefined;
  }
  return { id, there, passed: id === place ? null : place, limited, off };
}

/**
 * Who sits where an address would sign in to, and how the address would
 * arrive, for the invitation that cannot be made there (the invitation is the
 * row at that place). "back": on this person's own row, which has no address
 * and takes it back. Otherwise as a new person beside them: switched "off" or
 * with "nothing" while a row it passes is, else as a "newcomer". Null when the
 * place is free. Read from the same walk as the sign-in, so the sentence the
 * owner is given cannot drift from what happens.
 */
export function inPlaceOf(email: string): { person: Person; arrives: "back" | "off" | "nothing" | "newcomer" } | null {
  const l = landing(email);
  const at = l.there ? l.id : l.passed;
  const person = at === null ? null : getPerson(at);
  if (!person) return null;
  return { person, arrives: l.there ? "back" : l.off ? "off" : l.limited ? "nothing" : "newcomer" };
}

/**
 * Why a person's address may not be changed or removed, or null when it may.
 *
 * Google sign-in finds a person by their address and nothing else
 * (`rememberGoogle`). An address nobody carries any more is a NEW person the
 * next time somebody signs in with it, with what a newcomer gets. So while a
 * person is switched off ("off") or their access is limited ("restricted"),
 * the address they have stays: changing it would be a way round what the
 * owner decided. Adding one where there was none only closes a door. Asked by
 * both doors that change an address (Settings › People and the old console's
 * people form), so the two cannot drift.
 */
export function addressHeld(p: Person): "off" | "restricted" | null {
  if (!p.email) return null;
  return p.revoked ? "off" : p.grants !== null ? "restricted" : null;
}

export const everyone = (): Person[] =>
  (db.prepare("SELECT * FROM people ORDER BY name").all() as Record<string, unknown>[])
    .map(row)
    .filter((p): p is Person => !!p);

/**
 * WHO THE BOT PUBLISHES AS, for a link somebody shared with it.
 *
 * The Telegram door never passes the server's gate, so the access the owner
 * gave is asked here, once, for the automatic publishing (src/server.ts
 * `autoPublish`):
 *
 *   held     the desk knows the sharer and they do not have edit on Insights:
 *            read-only, not given at all, or switched off. The piece is
 *            written and waits on the desk for somebody who may publish. It
 *            goes by the grants and never by "has an address": falling back
 *            to the owner here would publish, under the owner's name, for
 *            exactly the people the owner told the desk not to publish for.
 *   by       the sharer, when they can publish; else the owner, which is the
 *            rule for somebody the desk does not know and for a teammate the
 *            bot met who has no address and no restriction (Settings ›
 *            Writing documents it).
 *   nobody   neither can: no address on the desk at all.
 */
export type Publisher = { by: Person } | { held: Person } | { nobody: true };

export function publisherFor(sharer: Person | null, all: Person[]): Publisher {
  if (sharer && areaLevel(sharer, "insights") !== "edit") return { held: sharer };
  if (sharer?.canPublish) return { by: sharer };
  const owner = all.find((p) => p.owner && p.canPublish);
  return owner ? { by: owner } : { nobody: true };
}

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

/**
 * Take back an invitation nobody has used: the row goes, as if it had never
 * been made. Only a row sign-in made for an address (a negative id) that was
 * an invitation: never the bot's row for a person, whose Telegram identity and
 * byline would go with it. Answers whether a row went, and writes it down
 * only then, so the caller can say what really happened.
 */
export function withdraw(telegram: number): boolean {
  const gone = Number(db.prepare("DELETE FROM people WHERE telegram = ? AND telegram < 0 AND invited_at IS NOT NULL").run(telegram).changes) > 0;
  if (gone) log("person.withdrawn", { telegram });
  return gone;
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
