import type { Tone } from "@/contract/common";
import { cx } from "@/lib/cx";
import { compact, DASH, figure as printFigure } from "@/lib/format";
import type { Unit } from "@/lib/scale";
import { shareTexts, type LegendItem } from "./Legend";
import { asColor, colorClass, r2, slotColor, type ChartColor } from "./series";
import "./charts.css";
import "./donut.css";

/** One slice. The contract's `Share` fits as it is. */
export interface DonutSlice {
  key?: string;
  label: string;
  value: number;
  /** By default the series slots in order: s1, s2, s3… The seventh slice starts again at s1, so group a long tail into "Other" on the server. */
  color?: ChartColor;
}

export interface DonutProps {
  /** The parts, in the order they are drawn (clockwise from twelve o'clock) and listed. Slices of zero take no room. */
  slices: readonly DonutSlice[];
  /** What the donut shows, for a screen reader: "Visitors by source". */
  label: string;
  /** The figure in the middle. By default the total of the slices, shortened as `compact` prints it (thousands as "k"). */
  figure?: string;
  /** The word under the figure: "Visitors", "Leads", "Healthy". */
  caption?: string;
  /** Colours the caption (Route health's green "Healthy"). */
  captionTone?: Tone;
  /** "panel" is the boards' donut beside a legend; "small" fits a narrow column. */
  size?: "panel" | "small";
  /** "bold" is Traffic sources; "thin" is Route health's ring of several parts. */
  weight?: "bold" | "thin";
  /** How a slice's own value is printed in the middle while the pointer is on it. */
  unit?: Unit;
  /**
   * Optional: each slice's share as the screen prints it, in the order of
   * `slices`, in place of the percentage in the hover caption and the
   * screen-reader label. For a whole too small for a percentage: "3 of 21".
   */
  shares?: readonly string[];
  className?: string;
}

/* Ring thickness in the 100-unit box, measured on the boards: Traffic sources
   is 28 of a 68 radius, Route health 12 of 56. */
const WEIGHT = { bold: 20, thin: 11 } as const;
/* The pause between two slices, as a part of the whole turn. */
const GAP = 0.004;

function arc(from: number, to: number, r: number): string {
  const at = (t: number) => `${r2(50 + r * Math.sin(2 * Math.PI * t))} ${r2(50 - r * Math.cos(2 * Math.PI * t))}`;
  return `M${at(from)}A${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${at(to)}`;
}

/**
 * A donut: parts of a whole, with the whole in the middle. The boards'
 * Traffic sources and Leads by source, and with `weight="thin"` Route health.
 * The legend is a separate component so the screen can place it:
 *
 *   <Donut label="Visitors by source" slices={sources} caption="Visitors" />
 *   <Legend layout="column" items={sliceLegend(sources)} />
 *
 * The pointer on a slice dims the others and puts that slice's name and value
 * in the middle (no script: it is a stylesheet rule). With no slices, or a
 * total of zero, the ring is an empty track and the middle says "—" or "0":
 * an even split would be an invented one.
 */
export function Donut({ slices, label, figure, caption, captionTone, size = "panel", weight = "bold", unit = "count", shares: given, className }: DonutProps) {
  const width = WEIGHT[weight];
  const r = 50 - width / 2;
  const drawn = slices.map((s, i) => ({ ...s, color: s.color ?? slotColor(i), index: i })).filter((s) => s.value > 0);
  const total = drawn.reduce((a, s) => a + s.value, 0);
  const shares = given ? drawn.map((s) => given[s.index] ?? "") : shareTexts(drawn.map((s) => s.value));
  const gap = drawn.length > 1 ? GAP : 0;

  let turn = 0;
  const arcs = drawn.map((s) => {
    const part = s.value / total;
    const from = turn + gap / 2;
    /* A sliver smaller than the pause would vanish; it keeps a hair of its own. */
    const to = Math.max(from + 0.002, turn + part - gap / 2);
    turn += part;
    return { ...s, d: drawn.length === 1 ? null : arc(from, to, r) };
  });

  const middle = figure ?? (slices.length === 0 ? DASH : compact(total));
  const said = slices.length === 0 ? "no data" : drawn.length === 0 ? "every part is zero" : drawn.map((s, i) => `${s.label} ${shares[i]}`).join(", ");

  return (
    <div className={cx("dk-donut", `dk-donut--${size}`, className)} role="img" aria-label={`${label}: ${said}`}>
      <svg className="dk-donut-svg" viewBox="0 0 100 100" focusable="false" aria-hidden="true">
        {arcs.length === 0 && <circle className="dk-donut-track" cx="50" cy="50" r={r} strokeWidth={width} />}
        {arcs.map((s, i) =>
          s.d === null ? (
            <circle key={i} className={cx("dk-donut-slice", colorClass(s.color))} data-i={i} cx="50" cy="50" r={r} strokeWidth={width} />
          ) : (
            <path key={i} className={cx("dk-donut-slice", colorClass(s.color))} data-i={i} d={s.d} strokeWidth={width} />
          ),
        )}
      </svg>
      <div className="dk-donut-middle" aria-hidden="true">
        <span className="dk-donut-whole">
          <b className="dk-donut-figure">{middle}</b>
          {caption && <span className={cx("dk-donut-caption", captionTone && colorClass(asColor(captionTone)))} data-toned={captionTone ? "" : undefined}>{caption}</span>}
        </span>
        {arcs.slice(0, 8).map((s, i) => (
          <span key={i} className="dk-donut-part" data-i={i}>
            <b className="dk-donut-figure">{printFigure(s.value, unit)}</b>
            <span className="dk-donut-caption">
              {s.label} · {shares[i]}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The legend that belongs to a donut: the same slices in the same order and
 * colours, each with its share of the whole and its own value.
 */
export function sliceLegend(slices: readonly DonutSlice[], unit: Unit = "count"): LegendItem[] {
  const shares = shareTexts(slices.map((s) => s.value));
  return slices.map((s, i) => ({ label: s.label, color: s.color ?? slotColor(i), share: shares[i], value: printFigure(s.value, unit) }));
}
