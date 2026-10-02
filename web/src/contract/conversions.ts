import type { Reading, Share, Stat } from "./common";

/**
 * What GET /api/v1/conversions answers: the whole Conversions screen in one
 * payload.
 *
 * TWO SOURCES MEET HERE AND ARE NEVER ADDED TOGETHER.
 *
 *   GA4      events the website sends from the visitor's browser
 *            (generate_lead, book_meeting, invite_shown) and GA4's own
 *            (form_start, sessions, active users). Consenting visitors only,
 *            so an undercount, but tied to pages, channels and days.
 *   engine   every enquiry that was stored, with its stage and booked call,
 *            read live and never kept by the desk. It knows the page the form
 *            was sent from, but no traffic source and no value. Names and
 *            messages reach only a person who may see leads.
 *
 * Every panel is a Reading of its own, so one source that is not connected
 * costs its own panels and nothing else. Types only: the server imports this
 * file with `import type`.
 */

/** The periods this screen offers: the page's switch and each panel's own select. */
export type ConversionsRange = "7d" | "30d" | "90d" | "1y";

export interface ConversionsPayload {
  /** The page's period (`?range=`). */
  range: ConversionsRange;
  /**
   * The period of each panel that has a select of its own on the board
   * (`?funnel=`, `?channels=`, `?trend=`). Each is the page's period unless
   * its own parameter says otherwise.
   */
  ranges: { funnel: ConversionsRange; channels: ConversionsRange; trend: ConversionsRange };
  /** True only on a development copy asked for `?specimen=1`: the engine's panels then hold artificial rows. */
  specimen: boolean;
  /** May this person read enquiries (names, companies, messages)? Counts are shown to everybody signed in. */
  seesLeads: boolean;

  tiles: ConversionTiles;
  /** "Conversion funnel": GA4 counts of the steps the website really measures. */
  funnel: Reading<FunnelData>;
  /** "Enquiries by channel (GA4)": generate_lead events by the channel of their session. */
  channels: Reading<ChannelData>;
  /** "Top converting pages": generate_lead events by the page they were sent from. */
  topPages: Reading<TopPages>;
  /** "Conversions over time": form submissions (line) and booked calls (bars) per day, from GA4. */
  trend: Reading<TrendData>;
  /** "Leads by service": the engine's enquiries by the services ticked on the form. */
  services: Reading<GroupList>;
  /** "Enquiries by page group": the engine's enquiries by the kind of page the form was sent from. */
  pageGroups: Reading<GroupList>;
  /** "Where enquiries start": GA4 events by their `method` parameter. */
  starts: Reading<StartsData>;
  /**
   * Clarity's own heatmaps, to open in a new tab. The desk cannot draw a
   * heatmap: Clarity's export has none. Without the project id it is the
   * list of Clarity projects.
   */
  heatmaps: string;
  /** True when `heatmaps` reaches the project's heatmaps; false when it is Clarity's list of projects (no project id set). */
  heatmapsDirect: boolean;
  /** "Recent leads & enquiries": the newest enquiries, only for a person who may see leads. */
  recent: Reading<RecentLead[]>;
}

/** The six tiles under the head. Engine figures and their GA4 stand-ins are separate readings. */
export interface ConversionTiles {
  /** Enquiries the engine stored in the period. */
  leads: Reading<Stat>;
  /** GA4's generate_lead count in the period, printed under `leads` as the named stand-in while the engine is not connected. */
  leadsGa4: Reading<Stat>;
  /** Enquiries with a booked call that was not cancelled, from the engine. */
  booked: Reading<Stat>;
  /** GA4's book_meeting count, the stand-in under `booked`. */
  bookedGa4: Reading<Stat>;
  /** GA4's own form_start: the first time in a session a visitor uses any form on the site. */
  formStarts: Reading<Stat>;
  /** GA4's generate_lead: the website's enquiry forms, the AI guide and the video page's dock. */
  submissions: Reading<Stat>;
  /** generate_lead events per session, in percent, with the two counts it is made of. */
  rate: Reading<RateStat>;
  /** Always absent: no value is recorded anywhere for an enquiry. */
  pipeline: Reading<Stat>;
}

/** A rate and the two raw counts it was made from. */
export interface RateStat extends Stat {
  /** generate_lead events in the period. */
  part: number;
  /** Sessions in the period. */
  whole: number;
}

/** One step of the funnel: a figure GA4 counts, named by its real event. */
export interface FunnelStepData {
  key: string;
  /** The step as the panel prints it: "Sheet shown". */
  label: string;
  /** What GA4 calls it: "invite_shown", or "active users" for the first step. */
  event: string;
  value: number;
}

export interface FunnelData {
  steps: FunnelStepData[];
  /** True when the period begins before GA4 measured the whole of its first day. */
  partial: boolean;
  /** The first day GA4 measured the website, YYYY-MM-DD. */
  since: string;
}

export interface ChannelData {
  /** Largest first; a long tail is folded into "Other". */
  slices: Share[];
  /** All generate_lead events in the period. */
  total: number;
  /** The first day GA4 measured, YYYY-MM-DD, when the period begins before it; null when the period was measured whole. */
  measuredFrom: string | null;
}

/** One page in "Top converting pages". */
export interface TopPage {
  /** The address, as the desk writes it: "/contact". */
  path: string;
  /** The page's title from the desk's last crawl, or null when the crawl does not know the page. */
  title: string | null;
  /** The page's share picture from the crawl, or null. */
  picture: string | null;
  /** generate_lead events sent from this page. */
  enquiries: number;
  /** Sessions in which this page was seen, or null when GA4 has none for it. */
  sessions: number | null;
  /** enquiries / sessions in percent, only when the page had at least `TopPages.floor` sessions; else null. */
  rate: number | null;
}

export interface TopPages {
  /** Most enquiries first. Every page with at least one, up to 100. */
  rows: TopPage[];
  /** The fewest sessions a page needs before its rate is printed. */
  floor: number;
  /** The first day GA4 measured, YYYY-MM-DD, when the period begins before it; null when the period was measured whole. */
  measuredFrom: string | null;
}

/** One day of "Conversions over time". Null before GA4 measured the website. */
export interface TrendDay {
  /** YYYY-MM-DD */
  date: string;
  submissions: number | null;
  booked: number | null;
}

export interface TrendData {
  days: TrendDay[];
  /** From this day on GA4 may still change the figures. */
  provisionalFrom: string;
  /** The first day GA4 measured the website. */
  since: string;
}

/** One group of enquiries: a service, or a kind of page. */
export interface GroupRow {
  key: string;
  label: string;
  count: number;
  /** The same group in the period before, or null when it could not be read whole. */
  previous: number | null;
}

export interface GroupList {
  /** Largest first, every group. */
  rows: GroupRow[];
  /** Enquiries in the period, so a group's share can be printed. One enquiry may sit in several groups. */
  total: number | null;
}

/** One place an enquiry or a call can start from. */
export interface StartPlace {
  /** "contact-page", "sheet", "ai-guide", "video-dock", or the raw method value. */
  key: string;
  label: string;
  /** The `method` values counted here. */
  methods: string[];
  count: number;
}

export interface StartsData {
  /** generate_lead by place, largest first. */
  enquiries: StartPlace[];
  enquiryTotal: number;
  /** book_meeting by place, largest first. */
  calls: StartPlace[];
  callTotal: number;
  /** invite_shown: how often an enquiry sheet opened on a marketing page, and on how many different sheets. */
  sheetsShown: number;
  sheets: number;
}

/** One enquiry in "Recent leads & enquiries". PERSONAL DATA: only sent to a person who may see leads. */
export interface RecentLead {
  /** The engine's enquiry id; the row opens it on the Leads screen, /leads?open=<id>. */
  id: string;
  name: string | null;
  company: string | null;
  /** The services as the website words them. */
  services: string[];
  /** The address the form was sent from. */
  page: string | null;
  /** The engine's stage key: received, processed, expert_assigned, meeting_confirmed, proposal_in_preparation, proposal_ready. */
  stage: string | null;
  /** The booked call, if there is one; a cancelled call stays, marked. */
  call: { start: string; cancelled: boolean; with: string | null } | null;
  /** When it came in, ISO. */
  capturedAt: string | null;
}
