import type { AiSearchAsked, ReadinessCheck } from "@/contract/seo/ai-search";
import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";

/** This page's address, and the desk server's for its reads and changes. */
export const BASE = "/seo/ai-search";
export const API = "/api/v1/seo/ai-search";

/** How a readiness check's state is drawn: shared by the server panels and the page table (a client component). */
export const CHECK_STATE: Record<ReadinessCheck["state"], { tone: ChipTone; icon: IconName; word: string }> = {
  pass: { tone: "good", icon: "check-circle", word: "Passes" },
  fail: { tone: "bad", icon: "x-circle", word: "Fails" },
  unknown: { tone: "warn", icon: "help", word: "Could not be read" },
  "n/a": { tone: "quiet", icon: "minus", word: "Does not apply" },
};

/** Who fixes a failing check, as a chip. */
export const WHO_FIX: Record<NonNullable<ReadinessCheck["who"]>, { word: string; tone: ChipTone }> = {
  content: { word: "Content", tone: "violet" },
  code: { word: "Website code", tone: "quiet" },
  owner: { word: "Needs you", tone: "warn" },
};

/** Each value of the address that is not its default: what a link or a form carries on. */
export function paramsOf(range: string, a: AiSearchAsked): Record<string, string> {
  const out: Record<string, string> = {};
  if (range && range !== "30d") out.range = range;
  if (a.q) out.q = a.q;
  /* A search looks through every question by default, the plain page through the ones without the name. */
  if (a.show !== (a.q ? "all" : "unprompted")) out.show = a.show;
  if (a.engine !== "all") out.engine = a.engine;
  if (a.open) out.open = a.open;
  if (a.named !== "top") out.named = a.named;
  if (a.who) out.who = a.who;
  if (a.fail) out.fail = a.fail;
  if (a.find) out.find = a.find;
  if (a.kind) out.kind = a.kind;
  if (a.pages !== "top") out.pages = a.pages;
  if (a.page) out.page = a.page;
  if (a.psort !== "fails") out.psort = a.psort;
  if (a.asking !== "top") out.asking = a.asking;
  return out;
}

/** This page with some values changed (an empty one removed), and the panel to land on. */
export function hrefWith(base: Record<string, string>, change: Record<string, string | null | undefined>, hash?: string): string {
  const p = new URLSearchParams(base);
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined || v === null || v === "") p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return `${BASE}${s ? `?${s}` : ""}${hash ? `#${hash}` : ""}`;
}

/** A list of the page as a CSV file. */
export const exportHref = (what: "answers" | "readiness" | "named" | "directories"): string => `${API}/export?what=${what}`;

/** The Competitors tab, searched for one company. */
export const competitorHref = (name: string): string => `/seo/competitors?q=${encodeURIComponent(name)}`;
