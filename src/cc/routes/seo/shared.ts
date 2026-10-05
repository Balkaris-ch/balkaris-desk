import type { Context, MiddlewareHandler } from "hono";
import { db } from "../../../db.ts";
import type { Vars } from "../../access.ts";
import { runnerState } from "../../operator/queue.ts";
import * as gsc from "../../search/gsc.ts";
import { off, series, since, today, waiting } from "../../store.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { NewTask } from "../../../../web/src/contract/operator.ts";
import type { OperatorPanel, SeoHead, SeoNav, SeoRange, SeoTab } from "../../../../web/src/contract/seo/common.ts";
import { auditRun } from "../../seo/audit.ts";
import { figures, indexFigures, keywordFigures, openOpportunities } from "../../seo/figures.ts";
import { lastSnapDay, rangeOf, spanOf } from "../../seo/rank.ts";
import { siteView, type SiteView } from "../../seo/site.ts";

/**
 * What every route of the SEO section shares: the head (range, span, the
 * audit, the tab strip's counts and the figures several pages show), the
 * honest absences of the search history, the operator panel's truthful line,
 * and the one way a CSV file is written.
 */

/*
 * THE FIGURES TWO PAGES BOTH SHOW are counted in src/cc/seo/figures.ts and
 * handed on from here, so a page's route needs one import: open
 * opportunities, tracked keywords, what Google has indexed.
 * `head().nav.figures` carries the same numbers to the interface.
 */
export { figures, indexFigures, keywordFigures, openOpportunities };

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

/**
 * The tab strip's counts, and the figures several pages show. Cheap: counts
 * in the desk's own tables, and the index check's newest rows.
 *
 * A TAB'S COUNT is either a total (Opportunities: how many are open) or work
 * that waits on a person (`todo`): the owner's own steps on the Overview,
 * pages nobody has yet sent to Google on Technical, phrases nobody has judged
 * on Keywords. A count of nothing is not drawn: no chip, never a 0.
 */
export function nav(): SeoNav {
  const n = (sql: string): number => {
    try {
      return (db.prepare(sql).get() as { n: number }).n;
    } catch {
      return 0;
    }
  };
  const f = figures();
  const opportunities = f.opportunities;
  const needsYou = n("SELECT COUNT(*) AS n FROM cc_seo_owner_tasks WHERE who = 'owner' AND done = 0");
  const indexRequests = n("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE type = 'not-indexed' AND active = 1 AND state = 'open'");
  type Chip = Pick<SeoTab, "count" | "countSays" | "todo">;
  const todo = (count: number, one: string, many: string): Chip => (count > 0 ? { count, countSays: count === 1 ? one : many, todo: true } : { count: null });
  const chips: Partial<Record<SeoTab["key"], Chip>> = {
    overview: todo(needsYou, "step needs you", "steps need you"),
    opportunities: { count: opportunities, countSays: "open" },
    keywords: todo(f.keywords.unjudged, "phrase to judge", "phrases to judge"),
    technical: todo(indexRequests, "page waits for Request indexing", "pages wait for Request indexing"),
  };
  return { opportunities, needsYou, indexRequests, tabs: TABS.map((t) => ({ ...t, ...(chips[t.key] ?? { count: null }) })), figures: f };
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

/* ---------- a CSV file ----------------------------------------------------------------------- */

/** The byte-order mark Excel needs to read a CSV as UTF-8: without it "für" opens as "fÃ¼r". */
const BOM = "﻿";

/**
 * One cell: empty for nothing, a leading quote on what a spreadsheet would
 * run as a formula, quoted when it holds a comma, a semicolon, a quote or a
 * line break.
 */
export const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A CSV file's text: the mark, a head row, CRLF between the rows and after the last. */
export const csvText = (headRow: readonly unknown[], rows: readonly (readonly unknown[])[]): string => `${BOM}${[headRow, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;

/**
 * Answer with a CSV file to download: "balkaris-seo-<name>-<today>.csv".
 * Every export of the section should end in this, so none can leave the mark
 * out again (the keyword export did, and Excel showed "fÃ¼r").
 */
export function csvFile(c: Context<Vars>, name: string, headRow: readonly unknown[], rows: readonly (readonly unknown[])[]): Response {
  return c.body(csvText(headRow, rows), 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="balkaris-seo-${name.replace(/[^a-z0-9-]+/gi, "-")}-${today()}.csv"`,
    "cache-control": "no-store",
  });
}

/**
 * The net under every export: a text/csv answer that does not begin with the
 * mark is given one. Mounted once over the whole section (src/cc/routes/seo.ts),
 * so an export written by hand in a page's own file is right as well.
 */
export const csvMark: MiddlewareHandler<Vars> = async (c, next) => {
  await next();
  const res = c.res;
  if (!res || !(res.headers.get("content-type") ?? "").toLowerCase().startsWith("text/csv")) return;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const marked = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const out = new Uint8Array(bytes.length + (marked ? 0 : 3));
  if (!marked) out.set([0xef, 0xbb, 0xbf], 0);
  out.set(bytes, marked ? 0 : 3);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  c.res = undefined;
  c.res = new Response(out, { status: res.status, headers });
};
