import type { Tone } from "@/contract/common";
import { cx } from "@/lib/cx";
import { DASH } from "@/lib/format";
import { colorClass, r2, toneColor } from "./series";
import "./charts.css";
import "./ring.css";

export interface RingProps {
  /** The score, 0 to `max`. Null when there is none: an empty ring and a dash, never a zero. */
  value: number | null;
  /** What it is a score of, for a screen reader: "SEO score". */
  label: string;
  /** The top of the scale. 100 by default. */
  max?: number;
  /** "row" is the small ring in a table row (the Pages board's SEO score); "panel" is the large one with a word under its figure (Route health). */
  size?: "row" | "panel";
  /** Sets the colour outright. Left out, the thresholds decide. */
  tone?: Tone;
  /** At or above this the ring is green. 80 by default, where the boards' colours turn from amber to green. */
  good?: number;
  /** At or above this, and below `good`, it is amber; below it, red. 50 by default. */
  warn?: number;
  /** Print the figure with a percent sign (a share) instead of bare (a score). */
  percent?: boolean;
  /** Replaces the printed figure. */
  figure?: string;
  /** The word under the figure in a panel ring: "Healthy". */
  caption?: string;
  className?: string;
}

/** The tone a score has by its thresholds: good, warn or bad; quiet when there is no score. */
export function ringTone(value: number | null, good = 80, warn = 50): Tone {
  if (value === null || !Number.isFinite(value)) return "quiet";
  return value >= good ? "good" : value >= warn ? "warn" : "bad";
}

/* The ring's thickness in its 100-unit box: 3px of 30 on the boards' rows, 12px of 112 on Route health. */
const WIDTH = { row: 11, panel: 10 } as const;

/**
 * A ring gauge: one score out of a maximum, coloured by where it falls.
 *
 *   <Ring value={page.seoScore} label="SEO score" />
 *   <Ring size="panel" value={healthyShare} percent caption="Healthy" label="Healthy routes" />
 *
 * A ring is for one number. Route health on the boards also shows small
 * amber and red parts: that is several numbers, so it is a
 * `<Donut weight="thin">` with the figure in its middle.
 */
export function Ring({ value, label, max = 100, size = "row", tone, good = 80, warn = 50, percent = false, figure, caption, className }: RingProps) {
  const v = value !== null && Number.isFinite(value) ? value : null;
  const has = v !== null;
  const part = v !== null && max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
  const width = WIDTH[size];
  const r = 50 - width / 2;
  const turn = 2 * Math.PI * r;
  const text = figure ?? (v !== null ? `${Math.round(v)}${percent ? "%" : ""}` : DASH);
  /* The thresholds are on a scale of 100, whatever the ring's own maximum is. */
  const color = colorClass(toneColor(tone ?? ringTone(v !== null && max > 0 ? (v / max) * 100 : null, good, warn)));

  return (
    <span className={cx("dk-ring", `dk-ring--${size}`, color, className)} role="img" aria-label={has ? `${label}: ${text}${percent ? "" : ` of ${max}`}` : `${label}: no reading`}>
      <svg className="dk-ring-svg" viewBox="0 0 100 100" focusable="false" aria-hidden="true">
        <circle className="dk-ring-track" cx="50" cy="50" r={r} strokeWidth={width} />
        {part > 0 && <circle className="dk-ring-arc" cx="50" cy="50" r={r} strokeWidth={width} strokeDasharray={`${r2(part * turn)} ${r2(turn)}`} transform="rotate(-90 50 50)" />}
      </svg>
      <span className="dk-ring-middle" aria-hidden="true">
        <b className="dk-ring-figure">{text}</b>
        {size === "panel" && caption && <span className="dk-ring-caption">{caption}</span>}
      </span>
    </span>
  );
}
