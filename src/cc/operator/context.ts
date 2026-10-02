import { db } from "../../db.ts";
import type { Reading, Tone } from "../../../web/src/contract/common.ts";
import type { ContextChannel, ContextInsight, ContextIssue, ContextPage, DraftRow } from "../../../web/src/contract/operator.ts";
import { articleStats, asReading, channels, GA4_NOTE, pages as gaPages, type Ask, type GaRange } from "../ga4.ts";
import { crawledAt, inventory, issueCounts, issues, type PageRow } from "../site/index.ts";
import { ok, waiting } from "../store.ts";
import { change, drafts, redirectTargets } from "./packs.ts";

/**
 * "Website context": the real data the operator's packs are built from, as a
 * person sees it before asking. Four tabs, each a Reading of its own, so a
 * source that is not connected costs one tab.
 *
 * The page status is a stated rule, the same everywhere it is shown:
 *
 *   Not answering  the address answers 4xx, 5xx or nothing
 *   Redirects      it answers 3xx
 *   Needs fixing   the crawl found a critical issue on it
 *   Needs update   a warning
 *   Healthy        neither (an opportunity alone keeps a page healthy)
 */

export const STATUS_RULE =
  "Status by the desk's crawl: Needs fixing has a critical finding, Needs update a warning, Healthy neither; Not answering is 4xx, 5xx or no answer. Views: GA4, consenting visitors only.";

function statusOf(r: PageRow): Pick<ContextPage, "status" | "statusLabel"> {
  if (r.status === 0 || r.status >= 400) return { status: "down", statusLabel: "Not answering" };
  if (r.status >= 300) return { status: "update", statusLabel: "Redirects" };
  if (r.issues.critical) return { status: "fix", statusLabel: "Needs fixing" };
  if (r.issues.warning) return { status: "update", statusLabel: "Needs update" };
  return { status: "healthy", statusLabel: "Healthy" };
}

const RANK: Record<ContextPage["status"], number> = { down: 0, fix: 1, update: 2, healthy: 3, unknown: 4 };

/** The pages: the busiest by GA4 views with the crawl's status; without GA4, the ones that need the most attention. */
export async function contextPages(range: GaRange, o: Ask = {}, most = 5): Promise<Reading<ContextPage[]>> {
  const inv = inventory();
  if (inv.state !== "ok") return inv;
  const byPath = new Map(inv.value.map((r) => [r.path, r]));
  const ga = await gaPages(range, { screen: true, ...o });
  if (ga.data && ga.at !== null) {
    const rows: ContextPage[] = [];
    for (const g of [...ga.data.rows].sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))) {
      const r = byPath.get(g.path);
      if (!r) continue;
      rows.push({ path: g.path, views: g.views, ...statusOf(r) });
      if (rows.length >= most) break;
    }
    return ok(rows, "ga4", ga.at, `${GA4_NOTE} Status: the desk's crawl of ${inv.asOf.slice(0, 10)}.`);
  }
  const rows = inv.value
    .filter((r) => r.inSitemap)
    .map((r) => ({ path: r.path, views: null, ...statusOf(r) }))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.path.localeCompare(b.path))
    .slice(0, most);
  return ok(rows, "crawl", inv.asOf, `The pages that need the most attention, by the desk's crawl. Views are not shown: ${ga.error ?? "GA4 has not answered"}.`);
}

/** The desk's articles, newest first, with GA4 views where GA4 has them. */
export async function contextInsights(range: GaRange, o: Ask = {}, most = 5): Promise<Reading<ContextInsight[]>> {
  const list = drafts();
  if (!list.length) return waiting("desk", "The desk has written no articles yet. Share a link with the bot, or create one on the Insights screen.");
  const stats = await articleStats(range, { screen: true, ...o });
  const views = new Map((stats.data?.rows ?? []).map((r) => [r.path, r.views]));
  const rows = list.slice(0, most).map((d) => {
    const path = d.state === "draft" ? null : `/insights/${d.slug}`;
    return {
      title: d.title ?? d.slug,
      path,
      state: (d.state === "listed" || d.state === "unlisted" ? d.state : "draft") as ContextInsight["state"],
      views: path && stats.data ? (views.get(path) ?? 0) : null,
      href: `/insights/${d.id}`,
    };
  });
  return ok(rows, "desk", new Date().toISOString(), stats.data ? `Views: ${GA4_NOTE}` : `Views are not shown: ${stats.error ?? "GA4 has not answered"}.`);
}

const toneOf = (now: number, before: number | null): Tone => (before === null || now === before ? "quiet" : now > before ? "good" : "bad");

/** Sessions by channel, with the change against the period before when it was measured. */
export async function contextTraffic(range: GaRange, o: Ask = {}): Promise<Reading<ContextChannel[]>> {
  const ch = await channels(range, { screen: true, ...o });
  return asReading(ch, (d) =>
    d.rows.slice(0, 6).map((r) => ({
      key: r.key,
      label: r.label,
      sessions: r.sessions,
      previous: r.previous?.sessions ?? null,
      change: r.previous ? change(r.sessions, r.previous.sessions).replace(/ \(from \d+\)$/, "") : null,
      tone: toneOf(r.sessions, r.previous?.sessions ?? null),
    })),
  );
}

/** The crawl's findings by rule, worst first, each with a few of its pages. */
export function contextIssues(most = 5): Reading<ContextIssue[]> {
  const counts = issueCounts();
  if (counts.state !== "ok") return counts;
  const all = issues();
  const pages = new Map<string, string[]>();
  if (all.state === "ok") {
    for (const f of all.value) {
      if (!f.path) continue;
      const l = pages.get(f.rule) ?? [];
      if (l.length < 3) l.push(f.path);
      pages.set(f.rule, l);
    }
  }
  return ok(
    counts.value.byRule.slice(0, most).map((r) => ({ rule: r.rule, title: r.title, severity: r.severity, count: r.count, pages: pages.get(r.rule) ?? [] })),
    "crawl",
    counts.asOf,
    "The desk's own rules (src/cc/site/rules.ts): yardsticks, not Google's law.",
  );
}

/** How much a "Propose fixes" would hand the workstation. */
export function fixable(): { metadata: number; redirect: number } {
  const all = issues();
  const inv = inventory();
  const inMap = new Set(inv.state === "ok" ? inv.value.filter((r) => r.inSitemap && r.status === 200).map((r) => r.path) : []);
  /* Pages with a proposal already waiting are not asked for again (packs.ts `metaTargets`). */
  const waiting = new Set((db.prepare("SELECT address FROM cc_proposals WHERE kind = 'meta' AND state = 'waiting'").all() as { address: string }[]).map((r) => r.address));
  const meta = new Set<string>();
  if (all.state === "ok") {
    for (const f of all.value) if (f.path && inMap.has(f.path) && !waiting.has(f.path) && /^(title|description)\./.test(f.rule)) meta.add(f.path);
  }
  let redirect = 0;
  try {
    redirect = crawledAt() ? redirectTargets().targets.length : 0;
  } catch {
    redirect = 0;
  }
  return { metadata: meta.size, redirect };
}

/** Articles the desk wrote that nobody has published. */
export function waitingDrafts(): Reading<DraftRow[]> {
  const list = drafts().filter((d) => d.state === "draft");
  return ok(
    list.map((d) => ({ id: d.id, title: d.title ?? d.slug, createdAt: `${d.created_at.replace(" ", "T")}Z`, href: `/insights/${d.id}` })),
    "desk",
    new Date().toISOString(),
  );
}
