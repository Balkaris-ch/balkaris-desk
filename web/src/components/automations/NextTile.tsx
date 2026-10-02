import type { Reading } from "@/contract/common";
import type { NextRun } from "@/contract/automations";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Icon } from "@/components/ui/icons";
import { ago, clock } from "@/lib/format";

/**
 * "Next run": a time, not a number, so it is drawn here in the tile's shape
 * rather than through `Tile`, whose figure is always a count or a measure.
 */
export function NextTile({ reading, at }: { reading: Reading<NextRun>; at: string }) {
  const due = reading.state === "ok" && Date.parse(reading.value.at) <= Date.parse(at);
  return (
    <article className="dk-automations-tile">
      <h3 className="dk-automations-tile-label">Next run</h3>
      {reading.state === "ok" ? (
        <>
          <p className="dk-automations-tile-figure dk-num">
            <time dateTime={reading.value.at}>{due ? "due now" : ago(reading.value.at, at)}</time>
          </p>
          <p className="dk-automations-tile-under">
            <Icon name="clock" size={14} />
            <span className="dk-num">{due ? `due since ${clock(reading.value.at)}` : `at ${clock(reading.value.at)}`}</span>
          </p>
          <p className="dk-automations-tile-sub" title={reading.value.title}>
            {reading.value.title}
          </p>
          <Stamp reading={reading} />
        </>
      ) : (
        <Absent reading={reading} form="tile" />
      )}
    </article>
  );
}
