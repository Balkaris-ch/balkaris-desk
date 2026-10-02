import type { CSSProperties } from "react";
import { num, shortDate } from "@/lib/format";

/**
 * Google's average position per day, drawn the way a position reads: 1 at the
 * top. The desk's time charts put the larger number higher, which for a
 * position is upside down, so this one is drawn here, by hand, in the charts'
 * manner: straight segments, a dot on every reading, a gap (never a zero) on a
 * day Google did not show it, and the target as a dashed line.
 *
 * The lines are an SVG stretched over the plot (their strokes keep their
 * width); the dots and the labels are HTML placed in percent, so neither is
 * stretched with it, at any width. A server component: complete in the HTML it
 * is sent as. Each dot carries its day's figures as its title, for the pointer.
 */

/** The bottom of the axis: the first round depth past every reading and the target. */
function depth(deepest: number): { max: number; ticks: number[] } {
  for (const [max, ticks] of [
    [5, [1, 3, 5]],
    [10, [1, 5, 10]],
    [20, [1, 5, 10, 15, 20]],
    [30, [1, 10, 20, 30]],
    [50, [1, 10, 20, 30, 40, 50]],
    [100, [1, 25, 50, 75, 100]],
  ] as const) {
    if (deepest <= max) return { max, ticks: [...ticks] };
  }
  const max = Math.ceil(deepest / 50) * 50;
  return { max, ticks: [1, Math.round(max / 2), max] };
}

const at = (x: number, y: number): CSSProperties => ({ left: `${x}%`, top: `${y}%` });

export function PositionChart({ days, target, label }: { days: { date: string; position: number | null; impressions: number; clicks: number }[]; target: number | null; label: string }) {
  const ranked = days.filter((d) => d.position !== null);
  if (!days.length || !ranked.length) return null;
  const deepest = Math.max(...ranked.map((d) => d.position as number), target ?? 1);
  const axis = depth(deepest);
  const x = (i: number): number => (days.length === 1 ? 50 : (i / (days.length - 1)) * 100);
  const y = (p: number): number => ((Math.min(p, axis.max) - 1) / (axis.max - 1)) * 100;

  /* Runs of consecutive days with a position: one path each. */
  const runs: string[] = [];
  let run: string[] = [];
  days.forEach((d, i) => {
    if (d.position === null) {
      if (run.length > 1) runs.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${run.length ? "L" : "M"}${x(i).toFixed(2)} ${y(d.position).toFixed(2)}`);
  });
  if (run.length > 1) runs.push(run.join(" "));

  const labelled = days.length === 1 ? [0] : [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])];

  return (
    <div className="dk-seo-opps-pos" role="img" aria-label={label}>
      <div className="dk-seo-opps-pos-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {axis.ticks.map((t) => (
            <line key={t} className="dk-seo-opps-pos-grid" x1={0} x2={100} y1={y(t)} y2={y(t)} />
          ))}
          {target !== null ? <line className="dk-seo-opps-pos-target" x1={0} x2={100} y1={y(target)} y2={y(target)} /> : null}
          {runs.map((d, i) => (
            <path key={i} className="dk-seo-opps-pos-line" d={d} />
          ))}
        </svg>
        {axis.ticks.map((t) => (
          <span key={t} className="dk-seo-opps-pos-y" style={{ top: `${y(t)}%` }} aria-hidden>
            {t}
          </span>
        ))}
        {target !== null ? (
          <span className="dk-seo-opps-pos-target-text" style={{ top: `${y(target)}%` }} aria-hidden>
            target {num(target, 1)}
          </span>
        ) : null}
        {days.map((d, i) =>
          d.position === null ? null : (
            <i
              key={d.date}
              className="dk-seo-opps-pos-dot"
              style={at(x(i), y(d.position))}
              title={`${shortDate(d.date)}: position ${num(d.position, 1)}, shown ${num(d.impressions)} ${d.impressions === 1 ? "time" : "times"}, ${num(d.clicks)} ${d.clicks === 1 ? "click" : "clicks"}`}
            />
          ),
        )}
        {labelled.map((i) => (
          <span key={i} className="dk-seo-opps-pos-x" data-edge={days.length === 1 ? undefined : i === 0 ? "start" : i === days.length - 1 ? "end" : undefined} style={{ left: `${x(i)}%` }} aria-hidden>
            {shortDate(days[i]!.date)}
          </span>
        ))}
      </div>
    </div>
  );
}
