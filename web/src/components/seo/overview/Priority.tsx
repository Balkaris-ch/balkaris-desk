import type { Reading } from "@/contract/common";
import type { CtrCurve } from "@/contract/seo/common";
import type { PriorityPanel } from "@/contract/seo/overview";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { num } from "@/lib/format";
import { PriorityTable } from "./PriorityTable";
import "./overview.css";

/** "every 15 minutes", "every hour": a job's interval in seconds, in words. */
export const everyWords = (s: number): string =>
  s % 3600 === 0 ? (s === 3600 ? "every hour" : `every ${s / 3600} hours`) : s % 60 === 0 ? `every ${s / 60} minutes` : `every ${s} seconds`;

/** The click-through curve "our estimate" assumes, in one sentence for the (i). */
export function curveLine(c: CtrCurve): string {
  const at = (p: number) => c.points.find((x) => x.position === p)?.ctr;
  return `${c.note} Positions 1, 3, 5 and 10: ${at(1)}%, ${at(3)}%, ${at(5)}%, ${at(10)}%; beyond 20: ${c.beyond}%.`;
}

/**
 * Priority Opportunities: what the opportunity engine found, highest priority
 * first, with what to do about each. The table and its filters run in the
 * browser (PriorityTable); this draws the panel and its absent state.
 */
export function Priority({ reading, curve }: { reading: Reading<PriorityPanel>; curve: CtrCurve }) {
  const total = reading.state === "ok" ? reading.value.total : null;
  return (
    <Card
      title="Priority Opportunities"
      icon="lightbulb"
      className="dk-seo-overview-panel dk-seo-overview-a-prio"
      info={
        <>
          Found by the stated rules in src/cc/seo/rules.ts from Search Console, the crawl, Google’s URL Inspection, the readiness check and the SEO audit, highest priority first. “Our est.” is our own estimate of the clicks a month it could add: {curveLine(curve)}
        </>
      }
      right={total !== null ? <LinkButton href="/seo/opportunities" size="sm">View all ({num(total)})</LinkButton> : null}
      flush
    >
      {reading.state === "ok" ? (
        reading.value.total ? (
          <>
            <PriorityTable panel={reading.value} />
            <div className="dk-seo-overview-stampline">
              <Stamp reading={reading} />
            </div>
          </>
        ) : (
          <Empty icon="check-circle" title="Nothing open" compact>
            The rules find nothing to do at the moment.
            {reading.value.every ? ` The engine wakes ${everyWords(reading.value.every)} and runs them again whenever something they read has changed.` : ""}
          </Empty>
        )
      ) : (
        <div className="dk-seo-overview-pad">
          <PanelAbsent reading={reading} />
        </div>
      )}
    </Card>
  );
}
