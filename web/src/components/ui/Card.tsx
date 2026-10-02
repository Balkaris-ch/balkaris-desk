import type { ReactNode } from "react";
import type { ChipTone } from "./Badge";
import { cx } from "@/lib/cx";
import { Go } from "./Go";
import { Icon, type IconName } from "./icons";
import { Info } from "./Tooltip";
import "./tone.css";
import "./card.css";

export interface CardProps {
  /** The panel's title. Without one the panel has no head at all. */
  title?: ReactNode;
  /** Drawn before the title, in `tone`. */
  icon?: IconName;
  /** The icon's colour. Green unless the panel is a warning ("Attention required" is bad). */
  tone?: ChipTone;
  /** A quiet figure after the title: "All insights (48)". */
  count?: ReactNode;
  /** The (i) beside the title: what the panel shows and where it comes from. */
  info?: ReactNode;
  /** The head's right side: a "View all" LinkButton, a Select, a Stamp. */
  right?: ReactNode;
  /** A second line under the title ("Visitor to booked call conversion"). */
  sub?: ReactNode;
  /** A hairline under the head, as on "Attention required". */
  divided?: boolean;
  /** No padding around the body: for a Table, whose rows run edge to edge. */
  flush?: boolean;
  /** Under the body, behind a hairline: usually a CardFoot. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}

/**
 * A panel: the dark rounded box every part of a screen sits in. Head (icon,
 * title, info, right slot), body, optional footer. A screen lays panels out
 * with `Grid` and never restyles one.
 */
export function Card({ title, icon, tone = "good", count, info, right, sub, divided, flush, footer, children, className, id }: CardProps) {
  const head = title != null || right != null;
  return (
    <section className={cx("dk-card", flush && "dk-card--flush", className)} id={id}>
      {head ? (
        <header className={cx("dk-card-head", divided && "dk-card-head--divided")}>
          <div className="dk-card-heading">
            {icon ? (
              <span className={cx("dk-card-icon", `dk-tone-${tone}`)}>
                <Icon name={icon} size={20} />
              </span>
            ) : null}
            <div className="dk-card-titles">
              <h2 className="dk-card-title">
                <span className="dk-card-title-text">{title}</span>
                {count != null ? <span className="dk-card-count dk-num">({count})</span> : null}
                {info ? <Info text={info} /> : null}
              </h2>
              {sub ? <p className="dk-card-sub">{sub}</p> : null}
            </div>
          </div>
          {right ? <div className="dk-card-right">{right}</div> : null}
        </header>
      ) : null}
      {children != null ? <div className="dk-card-body">{children}</div> : null}
      {footer ? <footer className="dk-card-foot">{footer}</footer> : null}
    </section>
  );
}

/** A panel's footer as one link across its width: "View route issues ›". */
export function CardFoot({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Go href={href} className="dk-card-footlink">
      <span>{children}</span>
      <Icon name="chevron-right" size={14} />
    </Go>
  );
}
