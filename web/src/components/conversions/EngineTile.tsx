import type { ReactNode } from "react";
import type { Reading, Stat } from "@/contract/common";
import { Tile } from "@/components/ui/Tile";
import { Delta } from "@/components/ui/Delta";
import { Tooltip } from "@/components/ui/Tooltip";
import { ago, num } from "@/lib/format";
import "./conversions.css";

export interface EngineTileProps {
  label: string;
  /** The engine's figure: what the tile is about. */
  reading: Reading<Stat>;
  /** GA4's nearest count, printed under the absent figure as what it is, never in its place. */
  standIn: Reading<Stat>;
  /** The stand-in's real name: "generate_lead". */
  event: string;
  info: ReactNode;
  chart?: (stat: Stat) => ReactNode;
}

/**
 * A tile whose figure belongs to the engine. While the engine is not
 * connected the figure is absent, with its reason and step, and in the
 * shared tile's `foot`, on a line of its own, GA4's count of the nearest
 * event, named by its event. The two are never one number: GA4 counts
 * consenting visitors' browsers, the engine counts what was stored.
 */
export function EngineTile({ label, reading, standIn, event, info, chart }: EngineTileProps) {
  const foot =
    reading.state !== "ok" && standIn.state === "ok" ? (
      <Tooltip
        text={
          <>
            Not the engine&apos;s figure: GA4 counted {event} {num(standIn.value.value)} {standIn.value.value === 1 ? "time" : "times"} in this period. {standIn.note} Read {ago(standIn.asOf)}.
          </>
        }
      >
        <span className="dk-conversions-standin" tabIndex={0}>
          <span className="dk-conversions-standin-name">
            GA4 <code>{event}</code>
          </span>
          <b className="dk-num">{num(standIn.value.value)}</b>
          <Delta value={standIn.value.value} previous={standIn.value.previous} size="sm" />
        </span>
      </Tooltip>
    ) : undefined;
  return <Tile label={label} reading={reading} info={info} chart={chart} foot={foot} />;
}
