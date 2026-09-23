import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { getPerson, type Person } from "./people.ts";

/**
 * Who is looking at the console.
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

/** Signed with the same secret the runner carries. One secret, one rotation. */
const SECRET = (): string => process.env.DESK_RUNNER_SECRET ?? "";

function sign(payload: string): string {
  return createHmac("sha256", SECRET()).update(payload).digest("base64url");
}

function verify(payload: string, mac: string): boolean {
  if (!SECRET()) return false;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function issue(c: Context, telegram: number): void {
  const until = Date.now() + DAYS * 86_400_000;
  const payload = `${telegram}.${until}`;
  const value = `${payload}.${sign(payload)}`;
  /* HttpOnly so no script can read it, SameSite=Lax so a form post from the
     console itself still carries it, Secure because Caddy terminates TLS and
     this is never served over plain http. */
  c.header(
    "set-cookie",
    `${COOKIE}=${value}; Path=/; Max-Age=${DAYS * 86_400}; HttpOnly; Secure; SameSite=Lax`,
    { append: true },
  );
}

export function clear(c: Context): void {
  c.header("set-cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, { append: true });
}

/** The person looking, or null. Never throws; a bad cookie is just nobody. */
export function whoIs(c: Context): Person | null {
  const raw = c.req.header("cookie") ?? "";
  const hit = raw.split(/;\s*/).find((p) => p.startsWith(`${COOKIE}=`));
  if (!hit) return null;

  const [telegram, until, mac] = hit.slice(COOKIE.length + 1).split(".");
  if (!telegram || !until || !mac) return null;
  if (!verify(`${telegram}.${until}`, mac)) return null;
  if (Number(until) < Date.now()) return null;

  return getPerson(Number(telegram));
}
