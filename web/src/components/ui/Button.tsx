import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Go } from "./Go";
import { Icon, type IconName } from "./icons";
import "./button.css";

/**
 *   primary  the one filled green action of a screen ("Create insight")
 *   quiet    outlined, neutral: "View all", "Stop", a cancel
 *   good     outlined green: "View", "Approve"
 *   danger   outlined red: "Investigate", a delete
 *   ghost    no edge until hovered: an icon in a row, a menu trigger
 */
export type ButtonVariant = "primary" | "quiet" | "good" | "danger" | "ghost";
/** md is a page's action (36px), sm sits in a panel's head (30px), xs in a table row (26px). */
export type ButtonSize = "md" | "sm" | "xs";

export interface ButtonLook {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Drawn before the label. */
  icon?: IconName;
  /** Drawn after the label: a chevron, an external mark. */
  iconRight?: IconName;
  /** Fill the width of what holds it. */
  block?: boolean;
}

/** The class list of a button, for an element that must look like one. */
export function buttonClass({ variant = "quiet", size = "md", block }: ButtonLook, extra?: string): string {
  return cx("dk-btn", `dk-btn--${variant}`, `dk-btn--${size}`, block && "dk-btn--block", extra);
}

function Inside({ icon, iconRight, size, children }: ButtonLook & { children?: ReactNode }) {
  const px = size === "md" || size === undefined ? 16 : 14;
  return (
    <>
      {icon ? <Icon name={icon} size={px} /> : null}
      {children != null && children !== false ? <span className="dk-btn-label">{children}</span> : null}
      {iconRight ? <Icon name={iconRight} size={px} /> : null}
    </>
  );
}

export type ButtonProps = ButtonLook & ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * A button. `type` is "button" unless said: a button inside a form must ask
 * to submit it. With an icon and no children it is square, and then it needs
 * an `aria-label`.
 */
export function Button({ variant, size, icon, iconRight, block, className, type = "button", children, ...rest }: ButtonProps) {
  const bare = children == null || children === false;
  return (
    <button type={type} className={buttonClass({ variant, size, block }, cx(bare && "dk-btn--icon", className))} {...rest}>
      <Inside icon={icon} iconRight={iconRight} size={size}>
        {children}
      </Inside>
    </button>
  );
}

export interface LinkButtonProps extends ButtonLook {
  href: string;
  children?: ReactNode;
  className?: string;
  "aria-label"?: string;
  title?: string;
}

/** A link that looks like a button: "View all", "View live site". */
export function LinkButton({ href, variant, size, icon, iconRight, block, className, children, ...rest }: LinkButtonProps) {
  const bare = children == null || children === false;
  return (
    <Go href={href} className={buttonClass({ variant, size, block }, cx(bare && "dk-btn--icon", className))} {...rest}>
      <Inside icon={icon} iconRight={iconRight} size={size}>
        {children}
      </Inside>
    </Go>
  );
}
