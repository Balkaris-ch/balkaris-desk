"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SeoTab } from "@/contract/seo/common";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { Icon } from "@/components/ui/icons";
import { mayOpen, type PageAccess } from "@/components/shell/nav";
import { SEO_PAGES, seoPlace } from "./pages";

/**
 * The SEO section's tab strip (board 103): the eleven pages as links, the one
 * showing underlined in green, and the counts the desk keeps for them
 * (GET /api/v1/seo/nav, `tabs`; null draws no count at all):
 *
 *   Opportunities  how many are open: the board's filled green chip
 *   Overview       the owner's own steps still open          } work waiting on a
 *   Keywords       phrases nobody has judged yet             } person: a quiet
 *   Technical      pages waiting for "Request indexing"      } amber chip
 *
 * A tab with nothing waiting draws no chip, never a 0. Each count's words
 * ("steps need you") are read out after the number and shown on hover.
 *
 * Each tab keeps the period chosen in the head (`?range=`) and nothing else:
 * a filter on one page means nothing on the next. The tabs close up on a
 * laptop's window so all eleven fit down to 1280 (seo-nav.css); where the
 * strip is still wider than the screen it scrolls sideways, fades at the edge
 * that has more with an arrow there for a mouse, and brings the lit tab into
 * view.
 *
 * A page the owner withheld from this person has no tab (`pages`, as the
 * sidebar's submenu follows it); on such a page's own address none is lit.
 */
export function SeoTabs({ tabs, pages }: { tabs: SeoTab[] | null; pages?: PageAccess }) {
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

  /* The strip's own size, not the window's: the labels' font arriving late changes it too. */
  useEffect(() => {
    const ul = strip.current;
    if (!ul || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const watch = new ResizeObserver(measure);
    watch.observe(ul);
    for (const li of Array.from(ul.children)) watch.observe(li);
    return () => watch.disconnect();
  }, [measure]);

  /* Most of a strip's width along, for the arrows at its edges. */
  const nudge = (way: 1 | -1) => {
    const ul = strip.current;
    if (!ul) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ul.scrollBy({ left: way * Math.round(ul.clientWidth * 0.6), behavior: still ? "auto" : "smooth" });
  };

  return (
    <nav className="dk-seo-nav-tabs" aria-label="SEO pages" data-more-before={more.before || undefined} data-more-after={more.after || undefined}>
      {/*
        The arrows are for a mouse, which cannot scroll a strip sideways: out
        of the tab order and hidden from screen readers, because the keyboard
        reaches every tab with Tab (the browser brings each into view) and the
        sidebar's SEO submenu lists the same pages.
      */}
      {more.before ? (
        <button type="button" className="dk-seo-nav-more dk-seo-nav-more--before" tabIndex={-1} aria-hidden onClick={() => nudge(-1)}>
          <Icon name="chevron-left" size={14} />
        </button>
      ) : null}
      {more.after ? (
        <button type="button" className="dk-seo-nav-more dk-seo-nav-more--after" tabIndex={-1} aria-hidden onClick={() => nudge(1)}>
          <Icon name="chevron-right" size={14} />
        </button>
      ) : null}
      <ul ref={strip} onScroll={measure}>
        {SEO_PAGES.filter((p) => mayOpen(pages, p.href)).map((p) => {
          const on = p.key === active;
          /* The desk keys the Overview "overview"; this list keys it by its address, "". */
          const tab = tabs?.find((t) => t.key === (p.key || "overview"));
          const count = tab && typeof tab.count === "number" && Number.isInteger(tab.count) && tab.count >= 0 ? tab.count : null;
          const says = tab?.countSays ?? (p.key === "opportunities" ? "open" : "");
          return (
            <li key={p.key}>
              <Link href={`${p.href}${keep}`} prefetch={false} className={cx("dk-seo-nav-tab", on && "dk-seo-nav-tab--on")} aria-current={on ? "page" : undefined}>
                {/* data-label: the label's width at the lit weight is kept by every tab (seo-nav.css), so lighting one never moves the others. */}
                <span className="dk-seo-nav-tab-label" data-label={p.label}>
                  {p.label}
                </span>
                {count !== null && (count > 0 || !tab?.todo) ? (
                  <span className={cx("dk-seo-nav-count dk-num", tab?.todo && "dk-seo-nav-count--todo")} title={says ? `${num(count)} ${says}` : undefined}>
                    {num(count)}
                    {says ? <span className="dk-sr"> {says}</span> : null}
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
