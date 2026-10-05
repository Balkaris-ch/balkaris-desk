import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";
import type { OpportunityRow, OpportunityState, OpportunityType, Priority } from "@/contract/seo/common";
import type { OpportunityQuery } from "@/contract/seo/opportunities";
import { num } from "@/lib/format";

/**
 * How SEO › Opportunities draws what the engine gives it: an icon per type,
 * a tone per priority and state, the short words a table button has room for,
 * and the page's own addresses. No client code: the page's server components
 * and its few client components both read this.
 */

export const BASE = "/seo/opportunities";

/** The type's mark in the list and the detail. */
export const TYPE_ICON: Record<OpportunityType, IconName> = {
  "not-indexed": "eye",
  "near-page-one": "trending-up",
  "low-ctr": "target",
  "ranking-drop": "trending-down",
  "keyword-gap": "layers",
  "german-missing": "globe",
  "thin-content": "file-text",
  "missing-answer": "robot",
  technical: "wrench",
  "internal-links": "link",
  entity: "map-pin",
};

/** The boards draw High red, Medium amber and Low quiet. */
export const PRIORITY_TONE: Record<Priority, ChipTone> = { high: "bad", medium: "warn", low: "quiet" };
export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };

export const STATE_LABEL: Record<OpportunityState, string> = {
  open: "Open",
  queued: "Queued",
  "in-progress": "In progress",
  done: "Done",
  dismissed: "Dismissed",
};
export const STATE_TONE: Record<OpportunityState, ChipTone> = { open: "quiet", queued: "info", "in-progress": "violet", done: "good", dismissed: "quiet" };

/**
 * The words a table row's button has room for. The engine's own label ("Propose
 * a title and description") is the detail's button and every button's title.
 * Each says what pressing it does, never more: a change to the website's code
 * is put on the to-do list, not made; a person's step is marked by the person
 * who took it.
 */
export function shortAction(r: OpportunityRow): string {
  const a = r.action;
  switch (a.kind) {
    case "proposal":
      return "Propose title";
    case "brief":
      return /investigat/i.test(a.label) ? "Investigate" : /answer|faq/i.test(a.label) ? "Write FAQ" : "Write brief";
    case "chrome":
      return a.href ? "Inspect URL" : DONE_IT;
    case "code":
      return "Add to-do";
    default:
      return "Needs you";
  }
}

/** A person's step from the audit, marked by the person who took it. */
export const DONE_IT = "I have done it";

/** The detail's words for a change to the website's code. */
export const TO_DO = "Add to the to-do list";

/** The action's own button, in the detail: what pressing it does. */
export function actionLabel(a: OpportunityRow["action"]): string {
  switch (a.kind) {
    case "proposal":
      return "Queue proposal";
    case "brief":
      return "Queue brief";
    case "chrome":
      return a.href ? "Mark indexing requested" : DONE_IT;
    case "code":
      return TO_DO;
    default:
      return DONE_IT;
  }
}

/** What pressing an action's button does, in one line for its title. */
export function actionEffect(a: Pick<OpportunityRow["action"], "kind" | "href">): string {
  switch (a.kind) {
    case "proposal":
      return "Queues an operator task on the studio workstation; what it proposes waits in AI Operator › Approvals.";
    case "brief":
      return "Queues an operator task on the studio workstation; the brief appears in AI Operator.";
    case "chrome":
      return a.href
        ? "Records that you pressed “Request indexing” for it in Search Console's URL Inspection. Press it there first."
        : "Records that you took this step in the owner's browser: its task is marked done, and the opportunities waiting on it with it.";
    case "code":
      return "Puts the step on the to-do list in AI Operator for whoever changes the website's code, and marks it queued. Nothing changes on the site; the next crawl checks it.";
    default:
      return "Only the owner can do this, and only the owner marks it done.";
  }
}

/** A step from the audit that a person marks done with its task (POST …/owner-task), not with the action route. */
export const ownerStep = (a: OpportunityRow["action"]): string | null => (a.ownerTaskId && (a.kind === "owner" || (a.kind === "chrome" && !a.href)) ? a.ownerTaskId : null);

/** A query as the page quotes it: the searcher's own quotation marks left out ("“content marketing”", not "“"content marketing"”"). */
export const quoted = (q: string): string => `“${q.replace(/^["'“”]+|["'“”]+$/g, "").trim() || q}”`;

/** Every state, as the state select's "Every state" asks for them. */
export const EVERY_STATE = "open,queued,in-progress,done,dismissed";

/** The page's search params as the server applied them, as a flat record for links. */
export function paramsOf(asked: OpportunityQuery, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  if (asked.range !== "30d") out.range = asked.range;
  if (asked.country !== "all") out.country = asked.country;
  if (asked.types.length) out.type = asked.types.join(",");
  if (asked.priority) out.priority = asked.priority;
  const defaultStates = ["open", "queued", "in-progress"];
  if (asked.states.join(",") !== defaultStates.join(",")) out.state = asked.states.join(",");
  /* Left out when it is what the states imply (still found for to-do, found or not once done or dismissed is asked). */
  if (asked.active !== asked.activeDefault) out.active = asked.active;
  if (asked.action) out.action = asked.action;
  if (asked.page) out.page = asked.page;
  if (asked.cluster) out.cluster = asked.cluster;
  if (asked.keyword) out.keyword = asked.keyword;
  if (asked.q) out.q = asked.q;
  if (asked.sort !== "priority") out.sort = asked.sort;
  if (asked.offset) out.offset = String(asked.offset);
  if (asked.limit !== 10) out.limit = String(asked.limit);
  for (const [k, v] of Object.entries(extra)) if (v) out[k] = v;
  return out;
}

/**
 * This page with some params changed. `undefined` or "" removes one. A change
 * to the list's filters also drops the paging and the one in detail, so the
 * first row of the new list is shown.
 */
export function hrefWith(base: Record<string, string>, change: Record<string, string | undefined | null>): string {
  const next = new URLSearchParams(base);
  const filters = ["type", "priority", "state", "active", "action", "page", "cluster", "keyword", "q", "sort", "limit"];
  if (Object.keys(change).some((k) => filters.includes(k))) {
    next.delete("offset");
    next.delete("open");
    next.delete("tab");
  }
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined || v === null || v === "") next.delete(k);
    else next.set(k, v);
  }
  const q = next.toString();
  return q ? `${BASE}?${q}` : BASE;
}

/**
 * The list as the page shows it, every matching row, as CSV (GET …/export.csv
 * with the same filters and order; the paging and the one in detail left out).
 */
export function exportHref(asked: OpportunityQuery): string {
  const p = new URLSearchParams(paramsOf(asked));
  p.delete("offset");
  p.delete("limit");
  const s = p.toString();
  return `/api/v1/seo/opportunities/export.csv${s ? `?${s}` : ""}`;
}

/** Only the period and the country: where a tile's count is the list's (to do, still found, no other filter). */
export function viewOf(asked: OpportunityQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (asked.range !== "30d") out.range = asked.range;
  if (asked.country !== "all") out.country = asked.country;
  return out;
}

/** The kinds the engine estimates a gain for (src/cc/seo/engine.ts): a search Google shows, or a topic gap with impressions. */
const ESTIMATED = new Set<OpportunityType>(["near-page-one", "low-ctr", "ranking-drop", "keyword-gap", "german-missing"]);

/**
 * Why an opportunity has no estimate, in one sentence. `shown` is how many
 * impressions its subject had in the range, when the page knows.
 */
export function noEstimate(r: OpportunityRow, shown?: number | null): string {
  if (!ESTIMATED.has(r.type)) return `No estimate: the desk estimates a gain only for a search Google shows or a topic gap Google has shown, from the impressions Search Console counted. ${r.typeLabel} is not measured that way.`;
  if (shown) return "No estimate: its click rate is already at or above our curve's at the target.";
  return "No estimate: Google has not shown it, and the desk estimates only from the impressions Search Console counted.";
}

/** "+0.4 / mo": our estimate's clicks a month, with as many decimals as a small number needs. */
export const gain = (clicks: number): string => `+${num(clicks, clicks < 10 ? 1 : 0)}`;

/** A position as Search Console gives it: one decimal at most. */
export const pos = (p: number | null | undefined): string => (p == null ? "—" : num(p, 1));

/** "1 time", "4 times". */
export const times = (n: number): string => `${num(n)} ${n === 1 ? "time" : "times"}`;
