import type { AnchorHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { hrefKind } from "@/lib/href";

export interface GoProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children?: ReactNode;
  /** For a link that changes only the search params (a tab, a range): stay where the reader has scrolled to. */
  scroll?: boolean;
  /** Replace the history entry instead of adding one: a filter is not a place to go back to. */
  replace?: boolean;
}

/**
 * A link, as the right element for where it leads: next/link for a screen of
 * this interface, a plain <a> for a page the desk server draws (the console, a
 * draft), a new tab for another site. Every primitive that takes an `href`
 * goes through this, so a screen never has to think about which it is.
 *
 * Screens are not prefetched. Each prefetch would render the frame and ask
 * the desk server who is looking, and the box this runs on is small.
 */
export function Go({ href, children, scroll, replace, ...rest }: GoProps) {
  const kind = hrefKind(href);
  if (kind === "external") {
    return (
      <a href={href} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  if (kind === "server") {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} prefetch={false} scroll={scroll} replace={replace} {...rest}>
      {children}
    </Link>
  );
}
