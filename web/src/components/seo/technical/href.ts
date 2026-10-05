/**
 * SEO › Technical's addresses. The page's state lives in its address: the
 * period, the lists' filters and an open extraction rule. Every link and form
 * of the page is built here, so a filter never drops the others.
 */

/** The search params this page reads; anything else in an address is left out of the links it builds. */
export const KEPT = ["range", "q", "sev", "index", "device", "rule", "audit"] as const;
export type Kept = Partial<Record<(typeof KEPT)[number], string>>;

/** The kept params of a request's search params, as plain strings. */
export function keptOf(q: Record<string, string | string[] | undefined>): Kept {
  const out: Kept = {};
  for (const k of KEPT) {
    const v = q[k];
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

/** This page with `change` applied over `base` (null or "" removes a param), and an anchor. */
export function techHref(base: Kept, change: Partial<Record<(typeof KEPT)[number], string | null>> = {}, hash?: string): string {
  const p = new URLSearchParams();
  const merged: Record<string, string | null | undefined> = { ...base, ...change };
  for (const k of KEPT) {
    const v = merged[k];
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return `/seo/technical${s ? `?${s}` : ""}${hash ? `#${hash}` : ""}`;
}

/** The lists as a file, with the page's own filters (GET /api/v1/seo/technical/export.csv). */
export function exportHref(what: "issues" | "pages" | "redirects" | "index", base: Kept): string {
  const p = new URLSearchParams({ what });
  for (const k of ["q", "sev", "index"] as const) if (base[k]) p.set(k, base[k] as string);
  return `/api/v1/seo/technical/export.csv?${p.toString()}`;
}
