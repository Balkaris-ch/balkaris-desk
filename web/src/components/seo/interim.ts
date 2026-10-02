import type { SeoPayload } from "@/contract/seo";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";

/**
 * The SEO screen's one payload (GET /api/v1/seo), read for the SEO section's
 * pages while each is rebuilt to its own board. Every panel it feeds is the
 * real one from the screen the section replaced; nothing here is a figure of
 * its own.
 */
export type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export async function seoPayload(searchParams: Search): Promise<{ data: SeoPayload; qs: string; open: string | undefined }> {
  const q = await searchParams;
  const range = parseRange(q.range);
  const open = one(q.open)?.trim() || undefined;
  const data = await api<SeoPayload>("/api/v1/seo", { range, open, specimen: one(q.specimen) === "1" ? "1" : undefined });
  /* The full lists follow the page's range, and its specimen when it shows one. */
  const p = new URLSearchParams();
  if (data.range !== "30d") p.set("range", data.range);
  if (data.specimen) p.set("specimen", "1");
  return { data, qs: p.size ? `?${p}` : "", open };
}
