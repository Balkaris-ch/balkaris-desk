import { Suspense, type ReactNode } from "react";
import type { Range } from "@/contract/common";
import { longDate, RANGES, zurich } from "@/lib/format";
import { RangeSwitch } from "@/components/ui/RangeSwitch";
import { Skeleton } from "@/components/ui/Skeleton";
import "./page-head.css";

export interface PageHeadProps {
  /** The small uppercase line over the title: the section's name. */
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /**
   * The period switch. `true` is the usual four (7D 30D 90D 1Y); a list is a
   * custom set, such as Site Health's 1H 24H 7D 30D. Left out, there is none.
   * The switch writes `?range=`; the page reads it with `parseRange`.
   */
  ranges?: true | readonly Range[];
  /** The range a bare address means. Default 30d. */
  rangeFallback?: Range;
  /** A button on the right, under the date: "Create insight", "Add page". */
  action?: ReactNode;
}

/**
 * The top of every screen: eyebrow, title, subtitle on the left; today's date
 * (Zurich), and under it the period switch and the screen's action, on the
 * right.
 *
 *   <PageHead eyebrow="SEO" title="SEO" subtitle="…" ranges />
 */
export function PageHead({ eyebrow, title, subtitle, ranges, rangeFallback = "30d", action }: PageHeadProps) {
  const list = ranges === true ? RANGES : ranges;
  const now = new Date();
  return (
    <header className="dk-head">
      <div className="dk-head-text">
        <p className="dk-eyebrow">{eyebrow}</p>
        <h1 className="dk-head-title">{title}</h1>
        {subtitle ? <p className="dk-head-sub">{subtitle}</p> : null}
      </div>
      <div className="dk-head-side">
        <time className="dk-head-date" dateTime={zurich(now)?.key}>
          {longDate(now)}
        </time>
        {list || action ? (
          <div className="dk-head-tools">
            {list ? (
              /* The switch reads the address in the browser; until it has, its place is kept. */
              <Suspense fallback={<span className="dk-head-range-space" />}>
                <RangeSwitch ranges={list} fallback={rangeFallback} />
              </Suspense>
            ) : null}
            {action}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/**
 * A screen's head while the screen loads, for its loading.tsx: the same
 * height and places as `PageHead`, in grey blocks. The date is real, because
 * it is known without asking anybody.
 */
export function PageHeadSkeleton() {
  const now = new Date();
  return (
    <header className="dk-head" aria-busy="true">
      <div className="dk-head-text dk-head-text--skeleton">
        <Skeleton width={96} height={11} />
        <Skeleton width={280} height={34} />
        <Skeleton width={420} height={14} />
      </div>
      <div className="dk-head-side">
        <time className="dk-head-date" dateTime={zurich(now)?.key}>
          {longDate(now)}
        </time>
      </div>
    </header>
  );
}
