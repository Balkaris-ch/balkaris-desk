"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui/icons";
import { SECTIONS, sectionOf } from "./nav";

/**
 * The sidebar's fourteen rows. A client component for one reason: the active
 * row follows the address, and the frame's layout is not drawn again when the
 * address changes.
 */
export function SideNav() {
  const active = sectionOf(usePathname());
  return (
    <nav className="dk-nav" aria-label="Sections">
      <ul>
        {SECTIONS.map((s) => {
          const on = s.key === active?.key;
          return (
            <li key={s.key}>
              {/* Not prefetched: fourteen rows would each render the frame on the box for nothing. */}
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
