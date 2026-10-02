import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Icon, type IconName } from "./icons";
import "./empty.css";

export interface EmptyProps {
  icon?: IconName;
  /** What is not here: "No drafts". */
  title: string;
  /** Why, and what would put something here. One or two plain sentences. */
  children?: ReactNode;
  /** A button or link that does the thing the text describes. */
  action?: ReactNode;
  /** compact fits a short panel; the default centres itself in a tall one. */
  compact?: boolean;
  className?: string;
}

/**
 * A panel with nothing in it yet, and why. For a list that is truly empty: the
 * source answered and there are no rows. A source that did not answer is not
 * empty, it is absent, and that is `Read`.
 */
export function Empty({ icon = "inbox", title, children, action, compact, className }: EmptyProps) {
  return (
    <div className={cx("dk-empty", compact && "dk-empty--compact", className)}>
      <span className="dk-empty-mark" aria-hidden>
        <Icon name={icon} size={18} />
      </span>
      <p className="dk-empty-title">{title}</p>
      {children ? <div className="dk-empty-text">{children}</div> : null}
      {action ? <div className="dk-empty-action">{action}</div> : null}
    </div>
  );
}
