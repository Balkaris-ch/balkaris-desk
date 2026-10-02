"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui/icons";
import { seoPlace } from "@/components/seo/nav/pages";
import { SECTIONS, sectionOf, type Section } from "./nav";
import "./side-group.css";

/**
 * The sidebar's rows. A client component for one reason: the active row
 * follows the address, and the frame's layout is not drawn again when the
 * address changes.
 *
 * A section with pages of its own (SEO) is a group: its row opens and closes
 * a submenu of those pages instead of going anywhere. The submenu is open
 * whenever the address is inside the section, and a click on the row opens it
 * from anywhere else; leaving the section closes it again. Inside the section
 * the lit row is the page's, not the section's, unless the submenu has been
 * closed or the address is none of its pages (SEO's earlier screen), when
 * the section's row is lit as any other.
 */
export function SideNav() {
  const pathname = usePathname();
  const active = sectionOf(pathname);
  const group = SECTIONS.find((s) => s.children?.length);
  const inGroup = group !== undefined && active?.key === group.key;
  const [open, setOpen] = useState(inGroup);

  /* Into the section (or from one of its pages to another): open. Out of it: closed. */
  useEffect(() => setOpen(inGroup), [inGroup, pathname]);

  /*
   * How many rows the window has to fit (side-group.css): inside the section
   * the rows close up to make room for its submenu, whether or not it is
   * open, so opening or closing it there never moves the row under the
   * pointer. Opened from elsewhere, the rows stay where they are and the
   * sidebar scrolls if it must; they close up once a page of the section is
   * open, which is a new screen anyway.
   */
  const grown = inGroup && group?.children ? group.children.length : 0;
  const fit = { "--side-rows": SECTIONS.length, "--side-subs": grown } as CSSProperties;

  return (
    <nav className={cx("dk-nav", grown > 0 && "dk-nav--grown")} aria-label="Sections" style={fit}>
      <ul>
        {SECTIONS.map((s) => {
          if (s.children?.length) return <Group key={s.key} section={s} open={open} inside={inGroup} pathname={pathname} onToggle={() => setOpen((o) => !o)} />;
          const on = s.key === active?.key;
          return (
            <li key={s.key}>
              {/* Not prefetched: fifteen rows would each render the frame on the box for nothing. */}
              <Link href={s.href} prefetch={false} className={cx("dk-nav-row", on && "dk-nav-row--on")} aria-current={on ? "page" : undefined}>
                <Icon name={s.icon} size={18} />
                <span>{s.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * A section with a submenu: a disclosure button and, under it, the pages as
 * indented rows with small icons. The pages' list is the section's own
 * (`Section.children`); which one is lit is the section's business, so SEO
 * asks its own rule (Page Optimization lights Pages).
 */
function Group({ section, open, inside, pathname, onToggle }: { section: Section; open: boolean; inside: boolean; pathname: string; onToggle: () => void }) {
  const lit = section.key === "seo" ? seoPlace(pathname)?.page.key : undefined;
  /* An address inside the section that is none of its pages (SEO's earlier screen) lights the section's row. */
  const pageLit = inside && open && section.children?.some((c) => c.key === lit);
  const id = `dk-nav-sub-${section.key}`;
  return (
    <li className="dk-nav-group">
      <button
        type="button"
        className={cx("dk-nav-row", "dk-nav-row--group", inside && (pageLit ? "dk-nav-row--within" : "dk-nav-row--on"))}
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <Icon name={section.icon} size={18} />
        <span>{section.label}</span>
        <Icon name="chevron-down" size={14} className="dk-nav-caret" />
      </button>
      <ul id={id} className="dk-nav-sub" hidden={!open} aria-label={`${section.label} pages`}>
        {section.children?.map((c) => {
          const on = inside && c.key === lit;
          return (
            <li key={c.key}>
              <Link href={c.href} prefetch={false} className={cx("dk-nav-subrow", on && "dk-nav-subrow--on")} aria-current={on ? "page" : undefined}>
                <Icon name={c.icon} size={14} />
                <span>{c.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
