import type { ReactNode } from "react";
import type { JobListed } from "@/contract/common";
import type { AuditRun, SeoNav, SeoTab } from "@/contract/seo/common";
import { ask, askMe, type Answer } from "@/lib/api";
import { isAuditJob } from "@/components/seo/nav/pages";
import { SeoFrame } from "@/components/seo/nav/SeoFrame";
import type { RunningStep } from "@/components/seo/nav/AuditButton";

/**
 * The SEO section: every one of its pages under the same head and tab strip
 * (components/seo/nav/SeoFrame.tsx), and the sidebar's SEO submenu open
 * (components/shell/SideNav.tsx).
 *
 * It asks the desk two small things, together, and neither can take a page
 * down: the tab strip's counts (GET /api/v1/seo/nav, SeoNav in
 * contract/seo/common.ts: open opportunities, the owner's steps still open,
 * phrases nobody has judged, pages waiting for Request indexing; left out
 * quietly while the desk has no answer), and whether a full audit is running
 * (GET /api/v1/seo/audit, the desk's own record of it), so a page drawn in
 * the middle of one follows it. Only a desk without that record is asked
 * which of the audit's jobs are running instead (GET /api/v1/jobs). Each page
 * asks for its own data itself, in parallel with this.
 *
 * The frame is also told which pages the person may open, so the tab strip
 * lists only those, and somebody with no SEO page at all gets no SEO head.
 */
export default async function SeoLayout({ children }: { children: ReactNode }) {
  /* Who is looking is the frame's own question, answered once per request (lib/api.ts `askMe`): asking here costs nothing more. */
  const [nav, audit, who] = await Promise.all([ask<SeoNav>("/api/v1/seo/nav"), ask<{ audit: AuditRun | null }>("/api/v1/seo/audit"), askMe()]);
  const running = !audit.ok && audit.kind === "missing" ? runningAudit(await ask<JobListed[]>("/api/v1/jobs")) : [];
  return (
    <SeoFrame tabs={tabsOf(nav)} audit={auditRunning(audit)} running={running} pages={who.ok ? who.value.access?.pages : undefined}>
      {children}
    </SeoFrame>
  );
}

/**
 * The tabs with their counts when the desk gave them (contract/seo/common.ts,
 * SeoNav), else null: a desk without the route, a reading that is not ok, a
 * shape it did not agree. A desk older than the per-tab counts gets the
 * Opportunities count from `opportunities`, as before.
 */
function tabsOf(a: Answer<SeoNav>): SeoTab[] | null {
  if (!a.ok || typeof a.value !== "object" || a.value === null) return null;
  /* Read through the Reading wrapper the route sends: only an ok reading counts. */
  const w = a.value as unknown as { state?: unknown; value?: unknown };
  const nav = (w.state === undefined ? a.value : w.state === "ok" ? w.value : null) as Partial<SeoNav> | null;
  if (!nav) return null;
  const tabs = Array.isArray(nav.tabs) ? nav.tabs.filter((t): t is SeoTab => !!t && typeof t.key === "string") : [];
  if (tabs.length) return tabs;
  const n = nav.opportunities;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? [{ key: "opportunities", label: "Opportunities", href: "/seo/opportunities", count: n, countSays: "open" }] : null;
}

/** The audit the desk is running now, when it has the agreed shape; else null (none running, or no record). */
function auditRunning(a: Answer<{ audit: AuditRun | null }>): AuditRun | null {
  if (!a.ok || typeof a.value !== "object" || a.value === null) return null;
  const run = a.value.audit;
  if (!run || run.state !== "running" || typeof run.id !== "string" || !Array.isArray(run.steps)) return null;
  return run;
}

/** The audit's jobs that are running now, with the start of their run: for a desk with no record of the audit itself. */
function runningAudit(a: Answer<JobListed[]>): RunningStep[] {
  if (!a.ok || !Array.isArray(a.value)) return [];
  return a.value.filter((j) => j.running && j.lastStart && isAuditJob(j.name)).map((j) => ({ name: j.name, title: j.title, start: j.lastStart as string }));
}
