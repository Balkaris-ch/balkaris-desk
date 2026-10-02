import type { Stat } from "@/contract/common";
import { cx } from "@/lib/cx";
import { change, DASH, figure } from "@/lib/format";
import { Icon } from "./icons";
import "./delta.css";

interface Common {
  /** For a figure where less is better: a load time, an error rate, a bounce. */
  downIsGood?: boolean;
  /** sm sits in a table row, md under a tile's figure. */
  size?: "sm" | "md";
  className?: string;
}

export type DeltaProps = Common &
  (
    | {
        /** The figure now. */
        value: number;
        /** The same figure one period earlier, or null when there is none yet. */
        previous: number | null;
        unit?: Stat["unit"];
        percent?: undefined;
      }
    | {
        /** A change the server already worked out, in percent. Null prints the dash. */
        percent: number | null;
        value?: undefined;
        previous?: undefined;
        unit?: undefined;
      }
  );

/**
 * The change against the period before.
 *
 *   ↑ 18.4%    the usual case
 *   3 → 5      when both figures are under 20: "up 67%" of three is noise
 *   0 → 124    when there was nothing before: a rise from zero has no percentage
 *   —          when there is no earlier figure. Never a made-up "0%".
 *   — 0%       when nothing changed
 *
 * Green means better and red means worse, which for `downIsGood` is the other
 * way round from up and down.
 */
export function Delta(props: DeltaProps) {
  const { downIsGood = false, size = "md", className } = props;
  const base = cx("dk-delta", "dk-num", `dk-delta--${size}`, className);

  let diff: number;
  let text: string;
  let spoken: string;
  let arrow = true;

  if (props.percent !== undefined) {
    if (props.percent === null || !Number.isFinite(props.percent)) return <None className={base} />;
    diff = props.percent;
    text = pct(props.percent);
    spoken = `${props.percent > 0 ? "up" : props.percent < 0 ? "down" : "unchanged at"} ${text}`;
  } else {
    const { value, previous, unit = "count" } = props;
    if (previous === null || previous === undefined || !Number.isFinite(previous) || !Number.isFinite(value)) return <None className={base} />;
    diff = value - previous;
    const rel = change(value, previous);
    if ((Math.abs(value) < 20 && Math.abs(previous) < 20) || rel === null) {
      arrow = false;
      text = `${figure(previous, unit)} → ${figure(value, unit)}`;
      spoken = `from ${figure(previous, unit)} to ${figure(value, unit)}`;
    } else {
      text = pct(rel);
      spoken = `${diff > 0 ? "up" : diff < 0 ? "down" : "unchanged at"} ${text} against the period before`;
    }
  }

  const tone = diff === 0 ? "flat" : diff > 0 !== downIsGood ? "good" : "bad";
  return (
    <span className={cx(base, `dk-delta--${tone}`)}>
      {arrow ? diff === 0 ? <span aria-hidden>{DASH}</span> : <Icon name={diff > 0 ? "arrow-up" : "arrow-down"} size={size === "sm" ? 12 : 14} /> : null}
      <span aria-hidden>{text}</span>
      <span className="dk-sr">{spoken}</span>
    </span>
  );
}

function None({ className }: { className: string }) {
  return (
    <span className={cx(className, "dk-delta--none")}>
      <span aria-hidden>{DASH}</span>
      <span className="dk-sr">no earlier figure to compare with</span>
    </span>
  );
}

/* "18.4%", "26%", "0.01%", "140%": as many decimals as the size of the change deserves. */
function pct(p: number): string {
  const a = Math.abs(p);
  const digits = a === 0 ? 0 : a < 0.1 ? 2 : a < 100 ? 1 : 0;
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(a)}%`;
}
