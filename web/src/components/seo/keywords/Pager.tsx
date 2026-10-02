import { Suspense } from "react";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { DEFAULT_LIMIT, keywordsHref, ROWS_PER_PAGE, type Place } from "./href";

/** The page numbers with gaps: 1 … 4 5 6 … 11. */
function pageNumbers(at: number, count: number): (number | "gap")[] {
  const want = new Set([1, count, at - 1, at, at + 1].filter((n) => n >= 1 && n <= count));
  const out: (number | "gap")[] = [];
  let last = 0;
  for (const n of [...want].sort((a, b) => a - b)) {
    if (n - last > 1) out.push("gap");
    out.push(n);
    last = n;
  }
  return out;
}

/** "Showing 1–25 of 1,218 keywords", the page numbers, and the rows per page: the list's and the clusters' foot. */
export function Pager({ place, total, noun }: { place: Place; total: number; noun: { one: string; many: string } }) {
  const { offset, limit } = place.asked;
  const count = Math.max(1, Math.ceil(total / limit));
  const at = Math.floor(offset / limit) + 1;
  const to = (n: number) => keywordsHref(place, { offset: (n - 1) * limit });
  const arrow = (n: number, on: boolean, icon: "chevron-left" | "chevron-right", label: string) =>
    on ? (
      <Go href={to(n)} scroll={false} className="dk-seo-kw-pg" aria-label={label}>
        <Icon name={icon} size={14} />
      </Go>
    ) : (
      <span className="dk-seo-kw-pg dk-seo-kw-pg--off" aria-hidden>
        <Icon name={icon} size={14} />
      </span>
    );
  return (
    <div className="dk-seo-kw-pager">
      <p className="dk-seo-kw-showing dk-num">
        {total ? `Showing ${num(offset + 1)}–${num(Math.min(total, offset + limit))} of ${num(total)} ${total === 1 ? noun.one : noun.many}` : `No ${noun.one} matches`}
      </p>
      {count > 1 ? (
        <nav className="dk-seo-kw-pages" aria-label="Pages of the list">
          {arrow(at - 1, at > 1, "chevron-left", "Previous page")}
          {pageNumbers(at, count).map((n, i) =>
            n === "gap" ? (
              <span key={`g${i}`} className="dk-seo-kw-pg dk-seo-kw-pg--gap" aria-hidden>
                …
              </span>
            ) : (
              <Go key={n} href={to(n)} scroll={false} className={cx("dk-seo-kw-pg dk-num", n === at && "dk-seo-kw-pg--on")} aria-current={n === at ? "page" : undefined}>
                {n}
              </Go>
            ),
          )}
          {arrow(at + 1, at < count, "chevron-right", "Next page")}
        </nav>
      ) : null}
      <div className="dk-seo-kw-perpage">
        <span aria-hidden>Rows per page</span>
        {/* The select reads the address in the browser; until it has, its place is kept. */}
        <Suspense fallback={<span className="dk-seo-kw-perpage-space" />}>
          <Select param="limit" fallback={String(DEFAULT_LIMIT)} resets={["offset"]} label="Rows per page" options={ROWS_PER_PAGE.map((n) => ({ value: String(n), label: String(n) }))} />
        </Suspense>
      </div>
    </div>
  );
}
