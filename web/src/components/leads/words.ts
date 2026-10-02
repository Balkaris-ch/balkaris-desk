import type { ChipTone } from "@/components/ui/Badge";
import type { LeadsFilters, LeadStage } from "@/contract/leads";
import { clock, DASH, zurich } from "@/lib/format";

/**
 * How the Leads screen says things: the engine's stages and intents in plain
 * words, a call's time on the studio's clock, and the addresses that keep the
 * screen's filters when an enquiry is opened or closed.
 */

const STAGE: Record<LeadStage, { label: string; tone: ChipTone }> = {
  received: { label: "Received", tone: "warn" },
  processed: { label: "Processed", tone: "info" },
  expert_assigned: { label: "Expert assigned", tone: "violet" },
  meeting_confirmed: { label: "Meeting confirmed", tone: "good" },
  proposal_in_preparation: { label: "Proposal in preparation", tone: "info" },
  proposal_ready: { label: "Proposal ready", tone: "good" },
};

const known = (s: string | null): s is LeadStage => !!s && s in STAGE;

/** "Meeting confirmed". A stage the engine sends that this screen does not know is printed as it came. */
export const stageLabel = (s: string | null): string => (known(s) ? STAGE[s].label : s ? s.replace(/_/g, " ") : "No stage");
export const stageTone = (s: string | null): ChipTone => (known(s) ? STAGE[s].tone : "quiet");

/** What the visitor chose on the form, in the engine's own words ("a quote", "a call", "a conversation"). */
export function intentWords(intent: string | null): string | null {
  if (intent === "quote") return "Wants a quote";
  if (intent === "meeting") return "Wants a call";
  if (intent === "talk") return "Wants a conversation";
  return intent ? `Intent: ${intent}` : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Thu 8 Oct, 14:30", on the studio's clock. */
export function callTime(iso: string): string {
  const z = zurich(iso);
  return z ? `${DAYS[z.weekday]} ${z.day} ${MONTHS[z.month - 1]}, ${clock(iso)}` : DASH;
}

/** "2 Oct 2026, 09:31", on the studio's clock. */
export function stampTime(iso: string | null): string {
  const z = iso ? zurich(iso) : null;
  return z ? `${z.day} ${MONTHS[z.month - 1]} ${z.year}, ${clock(iso!)}` : DASH;
}

/** The screen's address state: the range and the list's filters, and specimen on a workstation. */
export interface LeadsQuery extends LeadsFilters {
  range: string | null;
  specimen: boolean;
}

/** /leads with these params, and `open` set or removed. */
export function leadsHref(q: LeadsQuery, open: string | null): string {
  const p = new URLSearchParams();
  if (q.range) p.set("range", q.range);
  if (q.q) p.set("q", q.q);
  if (q.stage) p.set("stage", q.stage);
  if (q.group) p.set("group", q.group);
  if (q.call) p.set("call", q.call);
  if (q.specimen) p.set("specimen", "1");
  if (open) p.set("open", open);
  const s = p.toString();
  return s ? `/leads?${s}` : "/leads";
}

/** A page's detail on the Pages screen. */
export const pageHref = (path: string): string => `/pages/view?path=${encodeURIComponent(path)}`;

/** A website address a visitor typed, as a link: only http(s), and "https://" added when they left it out. */
export function webHref(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const withScheme = /^https?:\/\//i.test(t) ? t : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) ? `https://${t}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
