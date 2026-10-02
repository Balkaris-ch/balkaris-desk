import type { ChipTone } from "./Badge";
import { cx } from "@/lib/cx";
import "./tone.css";
import "./progress.css";

export interface ProgressBarProps {
  /** How far along, out of `max`. Clamped to the bar. */
  value: number;
  max?: number;
  tone?: ChipTone;
  /** What the bar measures, for a screen reader: "Share of visitors". */
  label: string;
  /** thin is the bar beside a table figure, md a running task. */
  size?: "thin" | "md";
  className?: string;
}

/** A filled share of a track: a country's share of visitors, a task's progress. */
export function ProgressBar({ value, max = 1, tone = "good", label, size = "thin", className }: ProgressBarProps) {
  const share = max > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <span
      className={cx("dk-bar", `dk-bar--${size}`, `dk-tone-${tone}`, className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
    >
      <span className="dk-bar-fill" style={{ width: `${share * 100}%` }} />
    </span>
  );
}
