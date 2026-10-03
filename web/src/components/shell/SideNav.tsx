"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui/icons";
import { seoPlace } from "@/components/seo/nav/pages";
import { sectionOf, visibleSections, type PageAccess, type Section } from "./nav";
import "./side-group.css";

/**
 * The sidebar's rows. A client component for one reason: the active row
 * follows the address, and the frame's layout is not drawn again when the
 * address changes.
 *
 * Only the sections and pages this person may open are drawn (`pages`, from
 * /me: what the owner gave them, src/grants.ts). Hiding a row is courtesy;
 * the server refuses the rest whatever is drawn here.
 *
 * A section with pages of its own (SEO, Team) is a group: its row opens and
 * closes a submenu of those pages instead of going anywhere. The submenu is
 * open whenever the address is inside the section, and a click on the row
 * opens it from anywhere else (closing any other); leaving the section closes
 * it again. Inside the section the lit row is the page's, not the section's,
 * unless the submenu has been closed or the address is none of its pages
 * (SEO's earlier screen), when the section's row is lit as any other.
 */
export function SideNav({ pages }: { pages?: PageAccess | null }) {
  const pathname = usePathname();
  const sections = visibleSections(pages);
  const active = sectionOf(pathname);
  const group = active?.children?.length ? sections.find((s) => s.key === active.key) : undefined;
  const inGroup = group !== undefined;
  const [open, setOpen] = useState<string | null>(inGroup ? group.key : null);
  const [at, setAt] = useState(pathname);

  /*
   * Into a section (or from one of its pages to another): open. Out of it:
   * closed. Reset while drawing, not in an effect, so the screen a click led
   * to never shows one frame of the submenu as it was on the screen before.
   */
  if (at !== pathname) {
    setAt(pathname);
    setOpen(inGroup ? group.key : null);
  }

  /*
   * How many rows the window has to fit (side-group.css): inside the section
   * the submenu's rows, then the sections' rows, close up to make room for
   * it, whether or not it is open, so opening or closing it there never
   * moves the row under the pointer. Opened from elsewhere, the rows stay
   * where they are and the sidebar scrolls if it must; they close up once a
   * page of the section is open, which is a new screen anyway. In the phone's
   * drawer nothing closes up: it scrolls, and the rows keep their size for a
   * finger.
   */
  const grown = inGroup && group?.children ? group.children.length : 0;
  const fit = { "--side-rows": sections.length, "--side-subs": grown } as CSSProperties;

  return (
    <nav className={cx("dk-nav", grown > 0 && "dk-nav--grown")} aria-label="Sections" style={fit}>
      <ul>
        {sections.map((s) => {
          if (s.children?.length) {
            return (
              <Group
                key={s.key}
                section={s}
                open={open === s.key}
                inside={active?.key === s.key}
                pathname={pathname}
                onToggle={() => setOpen((o) => (o === s.key ? null : s.key))}
              />
            );
          }
          const on = s.key === active?.key;
          return (
            <li key={s.key}>
              {/* Not prefetched: sixteen rows would each render the frame on the box for nothing. */}
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

/** The page of a section's submenu an address is: the longest address that holds it, so /team/members is Members and not Activity's /team. */
function litChild(section: Section, pathname: string): string | undefined {
  if (section.key === "seo") return seoPlace(pathname)?.page.key;
  const path = pathname.replace(/\/+$/, "") || "/";
  return [...(section.children ?? [])].sort((a, b) => b.href.length - a.href.length).find((c) => path === c.href || path.startsWith(`${c.href}/`))?.key;
}

/**
 * A section with a submenu: a disclosure button and, under it, the pages as
 * indented rows with small icons. The pages' list is the section's own
 * (`Section.children`); which one is lit is the section's business, so SEO
 * asks its own rule (Page Optimization lights Pages).
 */
function Group({ section, open, inside, pathname, onToggle }: { section: Section; open: boolean; inside: boolean; pathname: string; onToggle: () => void }) {
  const lit = inside ? litChild(section, pathname) : undefined;
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
        /* Lit as the section's row (its pages hidden, or none of them is the screen): say so, as a lit link does. */
        aria-current={inside && !pageLit ? "true" : undefined}
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
