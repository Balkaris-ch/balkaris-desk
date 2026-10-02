import type { ReactNode } from "react";
import type { Reading, Stat } from "@/contract/common";
import type { ChipTone } from "./Badge";
import { cx } from "@/lib/cx";
import { compact as short, figure, num } from "@/lib/format";
import { Delta } from "./Delta";
import { Icon, type IconName } from "./icons";
import { Absent } from "./Read";
import { Stamp } from "./Stamp";
import { Info } from "./Tooltip";
import "./tone.css";
import "./tile.css";

export interface TileProps {
  /** What the figure is: "Visitors". */
  label: string;
  /** The figure, or the reason there is none. */
  reading: Reading<Stat>;
  /** The (i) beside the label: how the figure is defined. */
  info?: ReactNode;
  /** A coloured icon square before the figure, as on the Insights board. */
  icon?: IconName;
  /** The icon square's tone. */
  tone?: ChipTone;
  /** Less is better for this figure (a load time, an error rate): a fall is green. */
  downIsGood?: boolean;
  /** Print large counts short: "12.4k" instead of "12,429". */
  compact?: boolean;
  /** The top right corner: a Badge ("● Healthy"). */
  badge?: ReactNode;
  /**
   * The spark chart beside the figure. It is given the stat so it can draw
   * `stat.series`; it is not called when the reading has no value or the
   * series is empty, so a chart is never drawn from nothing.
   */
  chart?: (stat: Stat) => ReactNode;
  /** Hide the source line under the figure, when the screen prints it once for the whole row. */
  noStamp?: boolean;
  /**
   * A small line at the foot of the tile, drawn whether the reading is ok or
   * absent: a true stand-in named as what it is ("Form submissions seen by
   * GA4: 3") under an absent figure.
   */
  foot?: ReactNode;
  /**
   * Where the change sits. "under" (the default) puts it on its own line under
   * the figure, as on the Command Center board; "inline" puts it beside the
   * figure ("48 ↑ 26%") with `stat.sub` under both, as on the Insights board.
   * "none" leaves the change out, for a figure that never has an earlier
   * period to compare with, so no lone dash stands under it.
   */
  delta?: "under" | "inline" | "none";
  className?: string;
}

/**
 * One headline figure: label, the number in its unit, "/ of", the change
 * against the period before, a small line, a spark chart, and where it came
 * from. Given a reading that is not `ok` it keeps its shape and says, in the
 * compact absent form, what is missing.
 *
 *   <Tile label="Visitors" reading={data.visitors} chart={(s) => <Spark values={s.series} />} />
 *   <Tile label="Published" icon="article" delta="inline" reading={data.published} />   the Insights board's row
 */
export function Tile({ label, reading, info, icon, tone = "good", downIsGood, compact, badge, chart, noStamp, foot, delta = "under", className }: TileProps) {
  const stat = reading.state === "ok" ? reading.value : null;
  const spark = stat && chart && stat.series.length > 1 ? chart(stat) : null;
  /* Beside the figure the change is set a size smaller, as on the Insights board. */
  const change = stat && delta !== "none" ? <Delta value={stat.value} previous={stat.previous} unit={stat.unit} downIsGood={downIsGood} size={delta === "inline" ? "sm" : "md"} /> : null;

  return (
    <article className={cx("dk-tile", icon && "dk-tile--icon", className)}>
      {icon ? (
        <span className={cx("dk-tile-icon", `dk-tone-${tone}`)} aria-hidden>
          <Icon name={icon} size={18} />
        </span>
      ) : null}

      <div className="dk-tile-main">
        <div className="dk-tile-top">
          <h3 className="dk-tile-label">
            <span className="dk-tile-label-text">{label}</span>
            {info ? <Info text={info} /> : null}
          </h3>
          {badge ? <span className="dk-tile-badge">{badge}</span> : null}
        </div>

        {stat ? (
          <div className="dk-tile-row">
            <div className="dk-tile-figures">
              <p className={cx("dk-tile-figure", "dk-num", delta === "inline" && "dk-tile-figure--beside")}>
                <span className="dk-tile-value">{compact && stat.unit === "count" ? short(stat.value) : figure(stat.value, stat.unit)}</span>
                {stat.of != null ? <span className="dk-tile-of">/ {num(stat.of)}</span> : null}
                {delta === "inline" ? <span className="dk-tile-beside">{change}</span> : null}
              </p>
              {delta === "inline" || delta === "none" ? null : <p className="dk-tile-under">{change}</p>}
              {stat.sub ? <p className="dk-tile-sub">{stat.sub}</p> : null}
              {noStamp ? null : <Stamp reading={reading} />}
            </div>
            {spark ? <div className="dk-tile-chart">{spark}</div> : null}
          </div>
        ) : reading.state !== "ok" ? (
          <Absent reading={reading} form="tile" />
        ) : null}
        {foot ? <div className="dk-tile-foot">{foot}</div> : null}
      </div>
    </article>
  );
}

export interface TilesProps {
  children: ReactNode;
  /** How many tiles are in the row (3 to 7). It decides how the row breaks when it does not fit. */
  count: 3 | 4 | 5 | 6 | 7;
  className?: string;
}

/**
 * The row of tiles under a page's head. One row while they fit, then two even
 * rows, then two columns, then one: never a lone tile stretched across the
 * screen and never a hole.
 */
export function Tiles({ children, count, className }: TilesProps) {
  return (
    <div className={cx("dk-tiles", className)}>
      <div className="dk-tiles-grid" data-n={count}>
        {children}
      </div>
    </div>
  );
}
