"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import type { AuditRun } from "@/contract/seo/common";
import { RANGES, rangeLabel } from "@/lib/format";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { mayOpen, type PageAccess } from "@/components/shell/nav";
import { AuditButton, type RunningStep } from "./AuditButton";
import { SeoTabs } from "./SeoTabs";
import { SEO_PAGES, seoPlace } from "./pages";
import "@/components/shell/page-head.css";
import "./seo-nav.css";

const PERIODS = RANGES.map((r) => ({ value: r, label: rangeLabel(r) }));

export interface SeoFrameProps {
  /** Open opportunities for the tab's count, or null to draw none. */
  opportunities: number | null;
  /** The full audit the desk was running when the page was drawn (its own record), or null. */
  audit: AuditRun | null;
  /** On a desk with no record of the audit: the audit's jobs already running when the page was drawn. */
  running: RunningStep[];
  /** What the person may open, page by page (`Me.access.pages`); absent means everything. */
  pages?: PageAccess;
  children: ReactNode;
}

/**
 * What every SEO page has around it (app/(frame)/seo/layout.tsx): the head
 * (breadcrumb, "SEO Operations" and its line, the period, "Run full SEO
 * audit") and the tab strip, then the page. Page Optimization has its own
 * title and line in the same places (pages.ts).
 *
 * A client component only because the layout is not told the address and the
 * head and the lit tab depend on it. The page itself passes through as
 * `children` and stays a server component.
 *
 * The earlier SEO screen's addresses (/seo/legacy, /seo/report, /seo/list/…)
 * are none of the eleven pages: they keep their own heads and get nothing
 * from here.
 *
 * Neither does somebody the owner gave no SEO page at all: the page's own
 * refusal is then all there is to draw, with no head, period or audit button
 * over it. With some of the pages, the head stays and the strip lists those.
 */
export function SeoFrame({ opportunities, audit, running, pages, children }: SeoFrameProps) {
  const place = seoPlace(usePathname());
  if (!place || !SEO_PAGES.some((p) => mayOpen(pages, p.href))) return <>{children}</>;
  const { head } = place;

  return (
    <>
      <header className="dk-head dk-seo-nav-head">
        <div className="dk-head-text">
          <nav className="dk-eyebrow dk-seo-nav-crumbs" aria-label="Breadcrumb">
            <ol>
              {head.crumbs.map((c) => (
                <li key={c.href}>
                  <Link href={c.href} prefetch={false}>
                    {c.label}
                  </Link>
                  <Icon name="chevron-right" size={12} />
                </li>
              ))}
            </ol>
          </nav>
          <h1 className="dk-head-title">{head.title}</h1>
          <p className="dk-head-sub">{head.sub}</p>
        </div>
        <div className="dk-seo-nav-tools">
          {/* The select reads the address in the browser; until it has, its place is kept. */}
          <Suspense fallback={<span className="dk-seo-nav-range-space" />}>
            <Select param="range" fallback="30d" label="Period" options={PERIODS} size="md" className="dk-seo-nav-range" />
          </Suspense>
          <AuditButton audit={audit} running={running} />
        </div>
      </header>
      <Suspense fallback={<div className="dk-seo-nav-tabs-space" />}>
        <SeoTabs opportunities={opportunities} pages={pages} />
      </Suspense>
      {children}
    </>
  );
}
