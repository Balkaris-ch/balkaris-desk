import type { Context } from "hono";

/**
 * May this request see a screen in its "connected" state, fed with made-up
 * data, before the real source exists?
 *
 * Most of the SEO, Conversions and Leads screens wait for a key only Fini can
 * create. Their connected state still has to be built and looked at before
 * that day, so a screen may answer `?specimen=1` with obviously artificial
 * rows. That must be impossible on the real desk, so the switch has the same
 * three locks as the development sign-in (src/session.ts):
 *
 *   NODE_ENV is not "production"   the systemd unit sets it
 *   DESK_DEV_USER is set           nothing on the box sets it
 *   DESK_URL is not an https one   the real desk's is, and an unset one counts
 *
 * A route that offers a specimen calls this and nothing else to decide, and
 * puts `specimen: true` in what it returns so the page can say so on screen.
 * Specimen data lives in the route's own file, is named as such, and never
 * resembles a real person, client or figure.
 */
export function specimenAllowed(c: Context): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (!(process.env.DESK_DEV_USER ?? "").trim()) return false;
  if (/^https:/i.test(process.env.DESK_URL ?? "https://desk.balkaris.ch")) return false;
  return c.req.query("specimen") === "1";
}
