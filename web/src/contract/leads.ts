import type { Range, Reading, SourceStatus, Stat } from "./common";

/**
 * GET /api/v1/leads — the Leads screen, in one answer.
 *
 * The enquiries the engine keeps from the website's form, read from the
 * engine (each answer held in memory for at most a minute) and never copied
 * to the desk. Two kinds of figure travel here, and the difference is who may
 * see them:
 *
 *   counts   tiles, the day chart, By page, By service, By stage: no personal
 *            field, for everybody signed in.
 *   rows     `list` and `open`: names, contact details, messages. Only for a
 *            person the owner has allowed to see leads (`viewer.seesLeads`);
 *            for anybody else they are `off` with the reason.
 *
 * Query: ?range=7d|30d|90d|1y (default 30d), the list's filters ?q= ?stage=
 * ?group= ?call=, ?open=<enquiry id> for one enquiry in full, and ?specimen=1
 * on a workstation only (see src/cc/specimen.ts).
 *
 * Types only.
 */

/** The engine's six stages, in the order an enquiry moves through them. */
export type LeadStage = "received" | "processed" | "expert_assigned" | "meeting_confirmed" | "proposal_in_preparation" | "proposal_ready";

/** One Zurich day: enquiries that came in, and how many of them hold a booked call that was not cancelled. */
export interface LeadsDay {
  /** YYYY-MM-DD in Zurich. */
  date: string;
  enquiries: number;
  booked: number;
}

/** Enquiries per day, and where the engine's record begins when that is inside the range. */
export interface LeadsDays {
  /** One per Zurich day, oldest first, from the range's first day or the record's, whichever is later. */
  days: LeadsDay[];
  /** YYYY-MM-DD: the day the engine's record begins, when it begins after the range's first day (days before it are unknown, not zero). Null otherwise. */
  recordBegins: string | null;
}

/** One bar of By page, By service or By stage. */
export interface LeadsGroup {
  key: string;
  label: string;
  count: number;
  /** A screen of the desk about this group: a page's detail. */
  href?: string;
}

/** The groups and the number they are shares of. */
export interface LeadsGroups {
  groups: LeadsGroup[];
  /** Enquiries in the range: what a share is a share of. A service list can add up to more (one enquiry, two services). */
  of: number;
}

/** A booked call as the engine keeps it. */
export interface LeadsCall {
  /** ISO UTC. */
  start: string;
  /** ISO UTC; the engine's slot is thirty minutes. */
  end: string | null;
  meetUrl: string | null;
  /** ISO UTC, when the visitor booked it. */
  bookedAt: string | null;
  /** Null when the engine's row did not say whether the call was cancelled. */
  cancelled: boolean | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  /** Who holds the call: a name, else an address. Null when the engine names nobody. */
  with: string | null;
}

/** Where the form was sent from, and the crawl's group for that page. */
export interface LeadsPage {
  /** "/contact". Null when the enquiry carries no page. */
  path: string | null;
  /** The crawl's kind ("landing", "segment"…), or "unknown" (not in the crawl), or "none" (no page recorded). */
  group: string;
  /** "Landing page", "Industry"… as the Pages screen names it. */
  groupLabel: string;
}

/** One enquiry in the list. PERSONAL DATA: only ever sent to a person who may see leads. */
export interface LeadsRow {
  /** The engine's enquiry id ("web_…"). */
  id: string;
  /** The engine's lead (a uuid). */
  leadId: string | null;
  /** "BK-2026-0001": the reference the visitor was given. */
  ref: string | null;
  /** ISO UTC. */
  receivedAt: string | null;
  name: string | null;
  company: string | null;
  /** The lead's address (the engine keeps one per lead, not per enquiry). */
  email: string | null;
  /** The services as the website words them. */
  services: string[];
  /** "quote", "talk" or "meeting", as the visitor chose. */
  intent: string | null;
  page: LeadsPage;
  /** One of LeadStage, or whatever else the engine sends, printed as it is. */
  stage: string | null;
  call: LeadsCall | null;
  /** The same lead sent an earlier enquiry. */
  returning: boolean;
}

/** An earlier (or later) enquiry of the same lead, as a line in the open enquiry. */
export interface LeadsSibling {
  id: string;
  ref: string | null;
  receivedAt: string | null;
  services: string[];
  intent: string | null;
  stage: string | null;
  /** True when this is the lead's newest enquiry. */
  current: boolean;
}

/** One enquiry in full. PERSONAL DATA, as LeadsRow. */
export interface LeadsDetail extends LeadsRow {
  phone: string | null;
  website: string | null;
  /** What they wrote; "" when they wrote nothing. */
  message: string;
  /** What the visitor first said to the website's guide. */
  firstWords: string | null;
  /** The recommendation the visitor was shown. */
  recommendation: string | null;
  /** Free text: a website, a profile, anything that helps the research. */
  links: string | null;
  /** The engine's summary of the conversation. */
  summary: { projectType: string | null; goals: string[]; timeline: string | null; references: string | null } | null;
  /** Each stage it reached, oldest first. */
  timeline: { stage: string; at: string }[];
  /** Lines the visitor reads on their status page. */
  updates: { at: string; text: string; by: string | null }[];
  /** True for the lead's newest enquiry. */
  current: boolean | null;
  /** The engine's pipeline status for the lead (new, meeting, client…). */
  leadStatus: string | null;
  /** website_form, or the older source of a contact the engine already knew. */
  leadSource: string | null;
  /** The lead's other enquiries the engine keeps, newest first. */
  others: LeadsSibling[];
  /** The lead in the engine's own interface (sign-in there required). */
  engineHref: string | null;
}

/** The list's filters as the server applied them; "" is "all". */
export interface LeadsFilters {
  q: string;
  stage: string;
  group: string;
  /** "booked", "cancelled", "none", or "". */
  call: string;
}

export interface LeadsList {
  rows: LeadsRow[];
  /** Enquiries in the range before the filters. */
  total: number;
  /** After the filters, before `cap`. */
  matched: number;
  /** At most this many rows are sent; null when all of them are. */
  cap: number | null;
  filters: LeadsFilters;
  /** What the selects offer: the stages and page groups present in the range, and always the one a filter applies. */
  options: { stages: { value: string; label: string }[]; groups: { value: string; label: string }[] };
}

export interface LeadsPayload {
  range: Range;
  /** True when ?specimen=1 fed the panels with made-up rows. The page must say so on screen. */
  specimen: boolean;
  viewer: {
    /** May read names, contact details and messages. */
    seesLeads: boolean;
    owner: boolean;
  };
  /** The engine as a source: whether the desk holds a key, and the one line that gives it one. */
  engine: {
    status: SourceStatus;
    /** The command the owner runs on the workstation. */
    line: string;
  };
  tiles: {
    /** Enquiries in the range, with the period before. */
    enquiries: Reading<Stat>;
    /** Of those, how many hold a booked call that was not cancelled. */
    booked: Reading<Stat>;
    /**
     * Of those, how many nobody at Balkaris has moved on in the engine: no
     * stage a founder sets and no update to the visitor. The stages the
     * engine sets by itself (received, and meeting confirmed from a call the
     * visitor booked) do not count as moving on.
     */
    awaiting: Reading<Stat>;
    /** Of those, the rest: a founder has set a stage or written the visitor an update. */
    talking: Reading<Stat>;
    /** Leads with an enquiry in the range that had sent one before. */
    returning: Reading<Stat>;
  };
  perDay: Reading<LeadsDays>;
  byPage: Reading<LeadsGroups>;
  byService: Reading<LeadsGroups>;
  byStage: Reading<LeadsGroups>;
  /** The list, or `off` with the reason for a person who may not see it. */
  list: Reading<LeadsList>;
  /** The enquiry asked for with ?open=, or null when none was. */
  open: Reading<LeadsDetail> | null;
  /** The facts that belong beside every figure here, one sentence each. */
  facts: string[];
}
