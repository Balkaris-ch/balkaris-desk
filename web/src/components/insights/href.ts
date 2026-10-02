/**
 * The Insights screen's own addresses. Every control on it is a link that
 * changes one search param and keeps the others, so a view (a tab, a filter,
 * a month, the specimen) can be shared and survives the back button.
 */

/** The params the screen reads. Each is either a value or absent. */
export const KEPT = ["tab", "range", "month", "source", "type", "status", "category", "q", "recs", "rows", "specimen"] as const;
export type Kept = (typeof KEPT)[number];
export type View = Partial<Record<Kept, string>>;

/** The current view, from the page's search params. Only the known params, only their first value. */
export function viewOf(sp: Record<string, string | string[] | undefined>): View {
  const out: View = {};
  for (const k of KEPT) {
    const v = sp[k];
    const one = Array.isArray(v) ? v[0] : v;
    if (one) out[k] = one;
  }
  return out;
}

/** /insights with the view, changed by `change` (undefined or "" removes a param). */
export function hrefOf(view: View, change: View = {}, hash?: string): string {
  const q = new URLSearchParams();
  const all = { ...view, ...change };
  for (const k of KEPT) {
    const v = all[k];
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return `/insights${s ? `?${s}` : ""}${hash ? `#${hash}` : ""}`;
}
