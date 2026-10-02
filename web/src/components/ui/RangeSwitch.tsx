"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Range } from "@/contract/common";
import { cx } from "@/lib/cx";
import { parseRange, rangeLabel, rangeShort, RANGES } from "@/lib/format";
import "./range-switch.css";

export interface RangeSwitchProps {
  /** The ranges offered, in order. Default: 7D 30D 90D 1Y. Site Health passes 1H 24H 7D 30D. */
  ranges?: readonly Range[];
  /** The range a bare address means. It is left out of the address. */
  fallback?: Range;
  /** The search param it writes. */
  param?: string;
  className?: string;
}

/**
 * 7D 30D 90D 1Y. Each is a link to this same page with `?range=`, so the
 * server draws the screen for that range and the choice can be shared. The
 * page reads it back with `parseRange((await searchParams).range)` using the
 * same list and fallback it gave here.
 */
export function RangeSwitch({ ranges = RANGES, fallback = "30d", param = "range", className }: RangeSwitchProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const now = parseRange(params.get(param) ?? undefined, ranges, fallback);
  const base = parseRange(undefined, ranges, fallback);

  return (
    <nav className={cx("dk-range", className)} aria-label="Period">
      {ranges.map((r) => {
        const next = new URLSearchParams(params.toString());
        if (r === base) next.delete(param);
        else next.set(param, r);
        const q = next.toString();
        return (
          <Link
            key={r}
            href={q ? `${pathname}?${q}` : pathname}
            prefetch={false}
            scroll={false}
            replace
            className={cx("dk-range-item", r === now && "dk-range-item--on")}
            aria-current={r === now ? "true" : undefined}
            title={rangeLabel(r)}
          >
            {rangeShort(r)}
          </Link>
        );
      })}
    </nav>
  );
}
