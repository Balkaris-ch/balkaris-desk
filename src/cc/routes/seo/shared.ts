import type { Context } from "hono";
import { db } from "../../../db.ts";
import type { Vars } from "../../access.ts";
import { runnerState } from "../../operator/queue.ts";
import * as gsc from "../../search/gsc.ts";
import { off, series, since, today, waiting } from "../../store.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { NewTask } from "../../../../web/src/contract/operator.ts";
import type { OperatorPanel, SeoHead, SeoNav, SeoRange, SeoTab } from "../../../../web/src/contract/seo/common.ts";
import { auditRun } from "../../seo/audit.ts";
import { lastSnapDay, rangeOf, spanOf } from "../../seo/rank.ts";
import { siteView, type SiteView } from "../../seo/site.ts";

/**
 * What every route of the SEO section shares: the head (range, span, the
 * audit, the tab strip's counts), the honest absences of the search history,
 * and the operator panel's truthful line.
 */

export const TABS: Omit<SeoTab, "count">[] = [
  { key: "overview", label: "Overview", href: "/seo" },
  { key: "opportunities", label: "Opportunities", href: "/seo/opportunities" },
  { key: "pages", label: "Pages", href: "/seo/pages" },
  { key: "keywords", label: "Keywords", href: "/seo/keywords" },
  { key: "content-gaps", label: "Content Gaps", href: "/seo/content-gaps" },
  { key: "backlinks", label: "Backlinks", href: "/seo/backlinks" },
  { key: "technical", label: "Technical", href: "/seo/technical" },
  { key: "search-console", label: "Search Console", href: "/seo/search-console" },
  { key: "competitors", label: "Competitors", href: "/seo/competitors" },
  { key: "ai-search", label: "AI Search", href: "/seo/ai-search" },
  { key: "automations", label: "Automations", href: "/seo/automations" },
];

/** The tab strip's and the sidebar's counts. Cheap: three counts in the desk's own tables. */
export function nav(): SeoNav {
  const n = (sql: string): number => {
    try {
      return (db.prepare(sql).get() as { n: number }).n;
    } catch {
      return 0;
    }
  };
  const opportunities = n("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE active = 1 AND state IN ('open', 'queued', 'in-progress')");
  const needsYou = n("SELECT COUNT(*) AS n FROM cc_seo_owner_tasks WHERE who = 'owner' AND done = 0");
  const indexRequests = n("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE type = 'not-indexed' AND active = 1 AND state = 'open'");
  return { opportunities, needsYou, indexRequests, tabs: TABS.map((t) => ({ ...t, count: t.key === "opportunities" ? opportunities : null })) };
}

export function head(range: SeoRange): SeoHead {
  let audit: SeoHead["audit"] = null;
  try {
    audit = auditRun();
  } catch {
    audit = null;
  }
  return { range, span: spanOf(range), audit, nav: nav(), at: new Date().toISOString() };
}

export const rangeFrom = (c: Context<Vars>): SeoRange => rangeOf(c.req.query("range"));

/** A whole number from the query string, kept inside a range. */
export const int = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const v = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
};

/** The JSON body, or an empty object when there is none. */
export async function body(c: Context<Vars>): Promise<Record<string, unknown>> {
  const b = (await c.req.json().catch(() => null)) as unknown;
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

/**
 * Why the desk's Search Console history has nothing to show: not connected
 * (off, with the step), or connected and not yet snapshotted (waiting).
 */
export function historyAbsent<T>(): Reading<T> {
  const a = gsc.access();
  if (a.state !== "ok") return off("gsc", gsc.reasonFor(a), gsc.stepFor(a));
  return waiting("gsc", "Search Console is connected; the desk's first snapshot of its history has not run yet. It runs about two and a half minutes after the desk starts, then every six hours.");
}

/** The history's note: what the numbers are. */
export const HISTORY_NOTE = "Google Search, web results, from the desk's own daily snapshots of Search Console (final days, two to three days behind). Rare queries are withheld by Google.";

/** When the history was last written, ISO. */
export function historyAt(): string {
  const r = db.prepare("SELECT MAX(at) AS at FROM cc_seo_snaps").get() as { at: string | null };
  return r.at ?? lastSnapDay() ?? new Date().toISOString();
}

/**
 * A daily count the engine records (cc_series) as a tile: the newest value,
 * the value on the last day before the window when the series reaches that
 * far, and the line. Null when nothing was recorded yet.
 */
export function recorded(metric: string, days: number): Stat | null {
  const line = series(metric, days + 1);
  const last = line.at(-1);
  if (!last) return null;
  const before = today(-days);
  const first = since(metric);
  const then = first && first <= before ? [...line].reverse().find((p) => p.day <= before) : undefined;
  return { value: last.value, previous: then ? then.value : null, unit: "count", series: line.filter((p) => p.day > before).map((p) => p.value) };
}

const RUNS_ON =
  "The AI SEO Operator is the desk's own operator: it runs on the studio workstation's local model, so a task waits in the queue while the workstation is off and is answered when it is on. What it proposes for the website waits for a person's approval.";

/** The operator panel, with the runner's real state and the suggestions given. */
export function operatorPanel(suggestions: { label: string; task: NewTask }[]): OperatorPanel {
  let runner: OperatorPanel["runner"];
  try {
    runner = runnerState();
  } catch {
    runner = { state: "never", lastSeen: null, line: "The workstation's state could not be read.", articlesFirst: 0 };
  }
  return { runner, line: `${runner.line} ${RUNS_ON}`, suggestions };
}

/** The SEO section's suggested operator tasks. Each is a real task kind; nothing here invents a figure. */
export const SEO_SUGGESTIONS: { label: string; task: NewTask }[] = [
  { label: "Find SEO opportunities in the crawl and Search Console", task: { kind: "opportunities", depth: "deep" } },
  { label: "Propose titles and descriptions for the pages that break a rule", task: { kind: "metadata", depth: "deep" } },
  { label: "Summarise the SEO audit of the last crawl", task: { kind: "audit", depth: "deep" } },
  { label: "Propose redirects for addresses that no longer answer", task: { kind: "redirect", depth: "deep" } },
  { label: "Which pages should Google index first, and why?", task: { kind: "ask", prompt: "Which of the website's pages matter most for enquiries, and which of them should search engines index first? Answer from the pages and findings only.", context: "website", depth: "deep" } },
  { label: "Brief: a German page on what a website costs in Switzerland", task: { kind: "brief", prompt: "A German (de-CH) page answering 'Was kostet eine Website in der Schweiz?' for Swiss small businesses: what drives the price, the kinds of site, running costs, and how Balkaris works. Leave every price for the owner to fill in.", depth: "deep" } },
];

/** The crawl's pages, read once per answer. */
export const view = (): SiteView => siteView();

/** Activity kinds the SEO engine writes, and the index events it watches. */
export const SEO_KINDS = ["seo", "seo-action", "seo-state", "seo-import", "seo-research", "seo-ai", "seo-competitors", "seo-presence", "gsc.indexed", "gsc.dropped"];
