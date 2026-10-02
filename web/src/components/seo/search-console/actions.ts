"use server";

import type { OpportunityAnswer } from "@/contract/seo/common";
import { askPost } from "@/lib/api";

export type Marked = { ok: true } | { ok: false; message: string };

const PATH = /^\/[^\s?#]{0,299}$/;

/**
 * "Mark requested" in the URL Inspection table: a person says they pressed
 * Request indexing for the address in Search Console (POST
 * /api/v1/seo/indexing/requested). No API can request indexing for an
 * ordinary page, so this only records that a person did it, by name, in the
 * desk's queue; it asks Google nothing and changes nothing on the website.
 * `submitted: false` takes the mark back.
 */
export async function markRequested(path: string, submitted: boolean): Promise<Marked> {
  if (typeof path !== "string" || !PATH.test(path) || typeof submitted !== "boolean") return { ok: false, message: "This button cannot mark that address." };
  const a = await askPost<OpportunityAnswer>("/api/v1/seo/indexing/requested", { path, submitted });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}
