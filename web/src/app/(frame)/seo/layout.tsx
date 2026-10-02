import type { ReactNode } from "react";
import type { JobListed } from "@/contract/common";
import type { SeoNav } from "@/contract/seo/common";
import { ask, type Answer } from "@/lib/api";
import { isAuditJob } from "@/components/seo/nav/pages";
import { SeoFrame } from "@/components/seo/nav/SeoFrame";
import type { RunningStep } from "@/components/seo/nav/AuditButton";

/**
 * The SEO section: every one of its pages under the same head and tab strip
 * (components/seo/nav/SeoFrame.tsx), and the sidebar's SEO submenu open
 * (components/shell/SideNav.tsx).
 *
 * It asks the desk two small things, together, and neither can take a page
 * down: how many opportunities are open (GET /api/v1/seo/nav, SeoNav in
 * contract/seo/common.ts: the count on the Opportunities tab, left out
 * quietly while the desk has no answer), and
 * which of the audit's jobs are running now (GET /api/v1/jobs), so a page
 * drawn in the middle of an audit shows it. Each page asks for its own data
 * itself, in parallel with this.
 */
export default async function SeoLayout({ children }: { children: ReactNode }) {
  const [nav, jobs] = await Promise.all([ask<SeoNav>("/api/v1/seo/nav"), ask<JobListed[]>("/api/v1/jobs")]);
  return (
    <SeoFrame opportunities={openCount(nav)} running={runningAudit(jobs)}>
      {children}
    </SeoFrame>
  );
}

/**
 * The open-opportunities count when the desk gave one (contract/seo/common.ts,
 * SeoNav: the Opportunities tab's own count, else `opportunities`), else null:
 * a desk without the route, a reading that is not ok, a shape it did not agree.
 */
function openCount(a: Answer<SeoNav>): number | null {
  if (!a.ok || typeof a.value !== "object" || a.value === null) return null;
  /* Also read through a Reading wrapper, should the route send one: only an ok reading counts. */
  const w = a.value as unknown as { state?: unknown; value?: unknown };
  const nav = (w.state === undefined ? a.value : w.state === "ok" ? w.value : null) as Partial<SeoNav> | null;
  if (!nav) return null;
  const tab = Array.isArray(nav.tabs) ? nav.tabs.find((t) => t?.key === "opportunities") : undefined;
  const n = tab && tab.count !== undefined ? tab.count : nav.opportunities;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

/** The audit's jobs that are running now, with the start of their run. */
function runningAudit(a: Answer<JobListed[]>): RunningStep[] {
  if (!a.ok || !Array.isArray(a.value)) return [];
  return a.value.filter((j) => j.running && j.lastStart && isAuditJob(j.name)).map((j) => ({ name: j.name, title: j.title, start: j.lastStart as string }));
}
