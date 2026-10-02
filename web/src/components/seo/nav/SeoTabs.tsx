"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { SEO_PAGES, seoPlace } from "./pages";

/**
 * The SEO section's tab strip (board 103): the eleven pages as links, the one
 * showing underlined in green, and on Opportunities the number open now when
 * the desk has it (`opportunities`; null draws no number at all).
 *
 * Each tab keeps the period chosen in the head (`?range=`) and nothing else:
 * a filter on one page means nothing on the next. Where the strip is wider
 * than the screen it scrolls sideways, fades at the edge that has more, and
 * brings the lit tab into view.
 */
export function SeoTabs({ opportunities }: { opportunities: number | null }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const active = seoPlace(pathname)?.page.key;
  const strip = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState<{ before: boolean; after: boolean }>({ before: false, after: false });
  const range = params.get("range");
  const keep = range ? `?range=${encodeURIComponent(range)}` : "";

  const measure = useCallback(() => {
    const ul = strip.current;
    if (!ul) return;
    const before = ul.scrollLeft > 1;
    const after = ul.scrollLeft + ul.clientWidth < ul.scrollWidth - 1;
    setMore((m) => (m.before === before && m.after === after ? m : { before, after }));
  }, []);

  useEffect(() => {
    const ul = strip.current;
    const on = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (ul && on) {
      /* Sideways only: scrollIntoView could move the page as well. */
      const left = on.offsetLeft - ul.offsetLeft;
      if (left < ul.scrollLeft || left + on.offsetWidth > ul.scrollLeft + ul.clientWidth) ul.scrollLeft = Math.max(0, left - 24);
    }
    measure();
  }, [active, measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return (
    <nav className="dk-seo-nav-tabs" aria-label="SEO pages" data-more-before={more.before || undefined} data-more-after={more.after || undefined}>
      <ul ref={strip} onScroll={measure}>
        {SEO_PAGES.map((p) => {
          const on = p.key === active;
          const count = p.key === "opportunities" ? opportunities : null;
          return (
            <li key={p.key}>
              <Link href={`${p.href}${keep}`} prefetch={false} className={cx("dk-seo-nav-tab", on && "dk-seo-nav-tab--on")} aria-current={on ? "page" : undefined}>
                <span>{p.label}</span>
                {count !== null ? (
                  <span className="dk-seo-nav-count dk-num">
                    {num(count)}
                    <span className="dk-sr"> open</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
