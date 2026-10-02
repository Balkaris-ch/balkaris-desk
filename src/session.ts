import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { db, log } from "./db.ts";
import { byEmail, getPerson, rememberGoogle, type Person } from "./people.ts";

/**
 * Who is looking at the desk.
 *
 * A signed cookie carrying one number — the person's row id — and nothing else.
 * No session table, no store to clean up, no state that can disagree with
 * itself. The signature is HMAC over "id.expiry" with the desk's own secret,
 * so a cookie cannot be edited into somebody else's and cannot outlive its
 * stamp.
 *
 * Everything the cookie AUTHORISES is read fresh from `people` on every
 * request, so removing somebody's email takes their publishing away
 * immediately rather than whenever their cookie happens to expire.
 */

const COOKIE = "desk";
const DAYS = 30;

/** How long a session lasts, for the pages that say so (Settings): read from here, never repeated. */
export const SESSION_DAYS = DAYS;

/**
 * WHICH SECRET SIGNS A COOKIE.
 *
 * It used to be the runner's: one secret, one rotation. That stops being
 * acceptable the day enquiries appear on the desk, because the runner's secret
 * also lives on the workstation, and whoever holds it could sign themselves a
 * cookie as the owner and read every enquiry. So the desk gets a secret of its
 * own, DESK_SESSION_SECRET, which exists on the box and nowhere else.
 *
 * Until Fini mints it nothing changes: cookies are signed and checked with the
 * runner's secret exactly as before.
 *
 * THE DAY HE MINTS IT, nobody is signed out. A cookie signed with the runner's
 * secret is still accepted for `HANDOVER_DAYS` and is replaced, on the request
 * that carries it, by one signed with the new secret; whoever opens the desk
 * that week moves across without noticing. After that the runner's secret
 * opens nothing here, for good.
 *
 * Accepting both for as long as both exist was the other option and it is not
 * safe: both ALWAYS exist (the runner needs its secret), so the old door would
 * never close and the new secret would protect nothing. A week of handover
 * leaves the exposure what it is today for seven more days (a session started
 * in that week lasts its thirty days, like any other) and then ends it; the
 * price is that somebody who stays away longer signs in again, which is one
 * click.
 */
const HANDOVER_DAYS = 7;

/** The handover week, for the step that tells the owner about it (Settings). */
export const SESSION_HANDOVER_DAYS = HANDOVER_DAYS;

const sessionSecret = (): string => process.env.DESK_SESSION_SECRET ?? "";
const runnerSecret = (): string => process.env.DESK_RUNNER_SECRET ?? "";
/** `||`, not `??`: an empty DESK_SESSION_SECRET= line in .env means "not minted yet". */
const signingSecret = (): string => sessionSecret() || runnerSecret();

const mac = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

function matches(payload: string, given: string, secret: string): boolean {
  if (!secret) return false;
  const want = Buffer.from(mac(payload, secret));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * When this desk first had a session secret: where the handover week starts.
 *
 * Kept in `events`, so it survives restarts and can be read three weeks later
 * by somebody asking why they were signed out. Written when the server starts
 * with the secret set, NOT when the first old cookie arrives: otherwise a week
 * in which nobody happened to open the desk would leave the handover unstarted
 * and the old door open for whoever came first.
 */
function handoverStarted(): number {
  const row = db.prepare("SELECT at FROM events WHERE what = 'session.secret' ORDER BY id LIMIT 1").get() as
    | { at: string }
    | undefined;
  if (row) return Date.parse(`${row.at.replace(" ", "T")}Z`);
  log("session.secret", `cookies signed with the runner secret are accepted for ${HANDOVER_DAYS} more days`);
  return Date.now();
}

if (sessionSecret()) handoverStarted();

/** Is the signature good, and with which secret? "old" is the runner's, inside the handover week. */
function verify(payload: string, given: string): "current" | "old" | null {
  if (!sessionSecret()) return matches(payload, given, runnerSecret()) ? "current" : null;
  if (matches(payload, given, sessionSecret())) return "current";
  if (!matches(payload, given, runnerSecret())) return null;
  return Date.now() - handoverStarted() < HANDOVER_DAYS * 86_400_000 ? "old" : null;
}

/**
 * The cookie's value for a person: "id.expiry.signature".
 *
 * `issue` is what a request uses. This is exported for the checks, which have
 * no browser and need to arrive as somebody (scripts/check-cc-core.ts), and
 * they pass `secret` to arrive with a cookie signed the old way.
 */
export function seal(telegram: number, secret: string = signingSecret()): string {
  const payload = `${telegram}.${Date.now() + DAYS * 86_400_000}`;
  return `${payload}.${mac(payload, secret)}`;
}

export function issue(c: Context, telegram: number): void {
  /* HttpOnly so no script can read it, SameSite=Lax so a form post from the
     console itself still carries it, Secure because Caddy terminates TLS and
     this is never served over plain http. */
  c.header(
    "set-cookie",
    `${COOKIE}=${seal(telegram)}; Path=/; Max-Age=${DAYS * 86_400}; HttpOnly; Secure; SameSite=Lax`,
    { append: true },
  );
}

export function clear(c: Context): void {
  c.header("set-cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, { append: true });
}

/**
 * THE WORKSTATION'S DEV COPY SIGNS YOU IN BY ITSELF.
 *
 * Google sign-in redirects to desk.balkaris.ch, so a copy of the desk on
 * localhost has no way to let anybody in. `DESK_DEV_USER=<an address>` in
 * work/dev.env makes every request without a cookie arrive as that person,
 * who is created the way a Google sign-in would create them.
 *
 * That is a door with no lock, so three things must ALL be true before it
 * exists, and on the box none of them is:
 *
 *   NODE_ENV is not "production"   the systemd unit sets it, and so does the .env
 *   DESK_DEV_USER is set           nothing on the box sets it
 *   DESK_URL is not an https one   the real desk's is, and an unset one counts
 *                                  as the real desk's
 *
 * And even then `whoIs` opens it only for a request addressed to this machine
 * by a loopback name (see `addressedToLoopback`), because the workstation's
 * browser visits other sites while the copy runs.
 *
 * Read on every request rather than once at start, so there is no moment after
 * boot when a stale answer is trusted. scripts/check-cc-core.ts proves each
 * of the four shuts it.
 */
export function devUser(): Person | null {
  if (process.env.NODE_ENV === "production") return null;
  const email = (process.env.DESK_DEV_USER ?? "").trim().toLowerCase();
  if (!email) return null;
  if (/^https:/i.test(process.env.DESK_URL ?? "https://desk.balkaris.ch")) return null;
  /* Not rememberGoogle() for somebody already known: it would overwrite the
     name they signed in with by the front half of their address. */
  return byEmail(email) ?? rememberGoogle(email, email.split("@")[0]);
}

/** localhost and its subdomains, 127.x.x.x, [::1]: names that cannot leave this machine. Any port. */
const LOOPBACK = /^(?:localhost|[\w-]+(?:\.[\w-]+)*\.localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i;

/**
 * Was this request addressed to this machine by a loopback name, at every hop?
 *
 * The development door's last lock. A page on any site the workstation's
 * browser opens can re-point its own DNS name at 127.0.0.1 (DNS rebinding),
 * and from then on the browser treats the desk as that site's own: it reads
 * every answer, and the Origin it sends matches the Host it sends, so
 * `fromOurPages` in src/server.ts cannot tell. What a browser cannot do is
 * send that request with a Host of "localhost". So the door opens only when
 * the Host and every X-Forwarded-Host beside it are loopback names. The
 * interface's dev server proxies with Host 127.0.0.1 and reports the browser's
 * host in X-Forwarded-Host, which is why that one is read too. A header that
 * is not there is not a hop.
 */
function addressedToLoopback(c: Context): boolean {
  const hosts = [c.req.header("host") ?? "", ...(c.req.header("x-forwarded-host") ?? "").split(",")]
    .map((h) => h.trim())
    .filter(Boolean);
  return hosts.length > 0 && hosts.every((h) => LOOPBACK.test(h));
}

/** The person looking, or null. Never throws; a bad cookie is just nobody. */
export function whoIs(c: Context): Person | null {
  return fromCookie(c) ?? (addressedToLoopback(c) ? devUser() : null);
}

function fromCookie(c: Context): Person | null {
  const raw = c.req.header("cookie") ?? "";
  const hit = raw.split(/;\s*/).find((p) => p.startsWith(`${COOKIE}=`));
  if (!hit) return null;

  const [telegram, until, given] = hit.slice(COOKIE.length + 1).split(".");
  if (!telegram || !until || !given) return null;
  const signed = verify(`${telegram}.${until}`, given);
  if (!signed) return null;
  /* Past its stamp, or stamped further ahead than the desk ever stamps one. */
  const left = Number(until) - Date.now();
  if (!(left > 0 && left <= DAYS * 86_400_000)) return null;

  const person = getPerson(Number(telegram));
  /* Signed the old way, inside the handover week: hand back the same session
     signed the new way, so this person never meets the day the old one stops. */
  if (person && signed === "old") issue(c, person.telegram);
  return person;
}
