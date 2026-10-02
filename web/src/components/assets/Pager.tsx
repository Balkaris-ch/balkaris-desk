import { Suspense, type ReactNode } from "react";
import type { AssetsQuery } from "@/contract/assets";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { assetsHref } from "./href";

/** The pages to offer: the first, the last, and two either side of this one; a gap is null. */
function steps(page: number, last: number): (number | null)[] {
  const want = new Set([1, last, page - 1, page, page + 1].filter((p) => p >= 1 && p <= last));
  const out: (number | null)[] = [];
  let prev = 0;
  for (const p of [...want].sort((a, b) => a - b)) {
    if (p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * Under the table: which rows are showing and where they come from (the
 * `stamps`, as the Pages screen prints them there), the pages, and how many
 * rows a page holds. Every one of them is an address.
 */
export function Pager({ total, page, per, q, noun, stamps }: { total: number; page: number; per: number; q: AssetsQuery; noun: [string, string]; stamps?: ReactNode }) {
  const last = Math.max(1, Math.ceil(total / per));
  const from = total ? (page - 1) * per + 1 : 0;
  const to = Math.min(total, page * per);
  return (
    <nav className="dk-assets-pager" aria-label="Pages of the list">
      <p className="dk-assets-pager-said">
        <span className="dk-num">
          {total ? (
            <>
              {num(from)}–{num(to)} of {num(total)} {total === 1 ? noun[0] : noun[1]}
            </>
          ) : (
            `No ${noun[1]}`
          )}
        </span>
        {stamps ? <span className="dk-assets-pager-stamps">{stamps}</span> : null}
      </p>
      {last > 1 ? (
        <span className="dk-assets-pager-pages">
          {page > 1 ? (
            <Go href={assetsHref(q, { page: page - 1 })} className="dk-assets-pager-step" aria-label="Previous page" scroll={false}>
              <Icon name="chevron-left" size={14} />
            </Go>
          ) : (
            <span className="dk-assets-pager-step dk-assets-pager-step--off" aria-hidden>
              <Icon name="chevron-left" size={14} />
            </span>
          )}
          {steps(page, last).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="dk-assets-pager-gap" aria-hidden>
                …
              </span>
            ) : (
              <Go key={p} href={assetsHref(q, { page: p })} className={cx("dk-assets-pager-step", p === page && "dk-assets-pager-step--on")} aria-current={p === page ? "page" : undefined} scroll={false}>
                {p}
              </Go>
            ),
          )}
          {page < last ? (
            <Go href={assetsHref(q, { page: page + 1 })} className="dk-assets-pager-step" aria-label="Next page" scroll={false}>
              <Icon name="chevron-right" size={14} />
            </Go>
          ) : (
            <span className="dk-assets-pager-step dk-assets-pager-step--off" aria-hidden>
              <Icon name="chevron-right" size={14} />
            </span>
          )}
        </span>
      ) : null}
      <span className="dk-assets-pager-per">
        <span className="dk-assets-pager-per-label">Rows</span>
        <Suspense fallback={null}>
          <Select
            param="per"
            label="Rows per page"
            resets={["page", "file"]}
            options={[
              { value: "8", label: "8" },
              { value: "25", label: "25" },
              { value: "50", label: "50" },
              { value: "100", label: "100" },
            ]}
          />
        </Suspense>
      </span>
    </nav>
  );
}
