/**
 * Addresses of the Experiments screen. Everything it shows is chosen in the
 * address (the range, the change, the page, the window, the chart's figure),
 * so a comparison can be shared, reloaded and gone back to.
 *
 * A refusal from the desk server is never carried in the address: anybody
 * could write one into a link. It comes back to the form that was sent, as
 * that form's state (actions.ts).
 */

/** The search params the screen reads. */
export const KEYS = ["range", "change", "date", "page", "window", "metric", "saved", "changes"] as const;
export type Key = (typeof KEYS)[number];
export type Here = Partial<Record<Key, string>>;

/** The screen's own params from Next's searchParams: the first value of each, nothing else. */
export function here(q: Record<string, string | string[] | undefined>): Here {
  const out: Here = {};
  for (const k of KEYS) {
    const v = q[k];
    const one = Array.isArray(v) ? v[0] : v;
    if (one) out[k] = one;
  }
  return out;
}

/** This screen's address with some params changed: a value replaces, null removes. */
export function to(now: Here, change: Partial<Record<Key, string | number | null>>, hash?: string): string {
  const next = new URLSearchParams();
  for (const k of KEYS) {
    const v = k in change ? change[k] : now[k];
    if (v !== null && v !== undefined && v !== "") next.set(k, String(v));
  }
  const q = next.toString();
  return `/experiments${q ? `?${q}` : ""}${hash ? `#${hash}` : ""}`;
}

/** The params a comparison is asked with, cleared: picking another change starts a new comparison. */
export const FRESH = { change: null, date: null, page: null, saved: null } as const;
