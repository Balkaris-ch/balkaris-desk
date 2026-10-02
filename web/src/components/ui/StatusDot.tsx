import type { ReactNode } from "react";
import type { ChipTone } from "./Badge";
import { cx } from "@/lib/cx";
import "./tone.css";
import "./status-dot.css";

export interface StatusDotProps {
  tone?: ChipTone;
  /** A slow halo: something is live right now. */
  pulse?: boolean;
  /** Colour the label with the tone ("Live" in green) instead of body ink. */
  tint?: boolean;
  /** The label beside the dot. Without one, give `title` so the dot is named. */
  children?: ReactNode;
  title?: string;
  className?: string;
}

/** A coloured dot, alone or before a word: "● Live", "● Success", the top bar's light. */
export function StatusDot({ tone = "good", pulse, tint, children, title, className }: StatusDotProps) {
  return (
    <span className={cx("dk-dot", `dk-tone-${tone}`, tint && "dk-dot--tint", className)} title={title}>
      <span className={cx("dk-dot-mark", pulse && "dk-dot-mark--pulse")} role={children ? undefined : "img"} aria-label={children ? undefined : (title ?? tone)} />
      {children != null ? <span className="dk-dot-label">{children}</span> : null}
    </span>
  );
}
