/**
 * GET /api/v1/seo/backlinks?range=30d — links and presence.
 *
 * WHAT THERE IS, AND WHAT THERE IS NOT. Google gives no backlink API. Links
 * come from Bing Webmaster (off until its key exists), the sites that send
 * visitors (GA4 referrals, consenting visitors only) and the profiles and
 * listings the desk knows of, checked once a week. There is no "domain
 * rating", no "authority" and no "new/lost links" figure: none has a free,
 * honest source.
 *
 * Types only.
 */
import type { Reading } from "../common";
import type { OwnerTaskRow, SeoHead } from "./common";

export interface SeoBacklinksPayload {
  head: SeoHead;
  /** Bing Webmaster's inbound links. */
  bing: Reading<{ total: number; complete: boolean; pages: { path: string; links: number }[]; history: { day: string; links: number }[] }>;
  /** Sites that sent visitors (GA4 sessionMedium "referral") in the window, most sessions first. */
  referrers: Reading<{ start: string; end: string; total: number; rows: Referrer[] }>;
  profiles: Reading<{ rows: ProfileRow[]; checkedAt: string | null }>;
  /** Name, address and phone as each source states them, side by side. */
  nap: Reading<NapMatrix>;
  /** The owner tasks about presence (profiles, listings, reviews, the one true address). */
  needsYou: OwnerTaskRow[];
}

export interface Referrer {
  host: string;
  sessions: number;
  users: number;
  /** The same in the window before; null when GA4 did not measure it whole. */
  previous: number | null;
  /** The page most of its sessions began on. */
  topLanding: string | null;
  /** Named as an AI assistant (chatgpt.com, perplexity.ai …): also counted on AI Search. */
  ai: boolean;
}

export type ProfileState = "exists" | "not-found" | "unknown" | "not-checked";

export interface ProfileRow {
  /** "google-business-profile", "linkedin", "clutch" … */
  key: string;
  name: string;
  kind: "listing" | "social" | "directory" | "register" | "website";
  /** The profile's address, when one is known. */
  url: string | null;
  /** What the weekly check found: the address answered (exists), answered 404/410 (not found), refused or no address known (unknown). */
  state: ProfileState;
  /** Why the state is what it is: "LinkedIn refuses automated checks (999)", "the audit found no listing on 2 Oct 2026". */
  stateWhy: string;
  checkedAt: string | null;
  /** Name, address and phone the check could read from the profile itself; null when nothing was readable. */
  nap: { name: string | null; address: string | null; phone: string | null } | null;
  /** What the audit saw on the profile on its day, kept apart from what the check reads. */
  napSeen: { name: string | null; address: string | null; phone: string | null; day: string } | null;
  /** The owner task that creates or fixes it, when there is one. */
  ownerTaskId: string | null;
}

export interface NapMatrix {
  /** One row per field, one cell per source that states it. */
  fields: { field: "name" | "address" | "phone"; values: { source: string; value: string; day: string }[]; consistent: boolean }[];
  /** True only when every source that states a field states the same value. */
  consistent: boolean;
}
