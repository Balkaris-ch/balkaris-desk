import type { Rate } from "@/contract/seo/common";
import type { LackRow, SeoCompetitorsPayload } from "@/contract/seo/competitors";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Info } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { taskWho } from "./look";

/**
 * "What they have that we lack": each line measured on their pages read and
 * on ours, the two side by side, and its (i) says how each side was read
 * (the price is read by two readers, and says so). A rate from fewer than thirty
 * pages is printed as "3 of 14", never as a percentage alone. Lines where we
 * do as well are shown too: the panel is a comparison, not a list of faults.
 */
export function Lacks({ reading }: { reading: SeoCompetitorsPayload["lacks"] }) {
  return (
    <Card
      title="What they have that we lack"
      icon="target"
      tone="bad"
      className="dk-seo-competitors-lacks"
      info="Their side: the competitor pages the desk has read (platforms never). Our side: the sitemap pages the crawl read, the readiness check's price check, the AI checks and the profile registry. Each line says how both sides were measured."
      right={<Stamp reading={reading} />}
    >
      <Read reading={reading}>
        {(v) => (
          <div className="dk-seo-competitors-lack-list" role="table" aria-label="Them beside us">
            <div className="dk-seo-competitors-lack-head" role="row">
              <span role="columnheader">What</span>
              <span role="columnheader">Them ({num(v.pagesRead)} pages read)</span>
              <span role="columnheader">Balkaris ({num(v.ourPages)} sitemap pages)</span>
            </div>
            {v.rows.map((r) => (
              <LackLine key={r.key} r={r} />
            ))}
          </div>
        )}
      </Read>
    </Card>
  );
}

function share(r: Rate | null): number {
  return r && r.den ? r.num / r.den : 0;
}

/** "12 of 48 · 25%": the counts first, the percentage only where there are thirty or more. */
function rateText(r: Rate): string {
  return r.small || r.value === null ? `${num(r.num)} of ${num(r.den)}` : `${num(r.num)} of ${num(r.den)} · ${num(r.value, r.value < 10 ? 1 : 0)}%`;
}

function Side({ rate, line, tone }: { rate: Rate | null; line: string; tone: "info" | "good" | "bad" }) {
  return (
    <span className="dk-seo-competitors-lack-side">
      {rate ? (
        <>
          <span className="dk-seo-competitors-lack-fig dk-num">{rateText(rate)}</span>
          <ProgressBar value={share(rate)} tone={tone} label={line} />
        </>
      ) : null}
      <span className="dk-seo-competitors-lack-line">{line}</span>
    </span>
  );
}

function LackLine({ r }: { r: LackRow }) {
  return (
    <div className={cx("dk-seo-competitors-lack-row", r.lack === true && "dk-seo-competitors-lack-row--on")} role="row">
      <span className="dk-seo-competitors-lack-what" role="cell">
        <span className="dk-seo-competitors-lack-label">
          {r.label}
          <Info text={r.how} />
        </span>
        {r.lack === true ? (
          <Badge tone="bad" dot>
            We lack it
          </Badge>
        ) : r.lack === false ? (
          <Badge tone="good" dot>
            Not a lack
          </Badge>
        ) : (
          <Badge tone="quiet">Not compared</Badge>
        )}
      </span>
      <span className="dk-seo-competitors-lack-them" role="cell">
        <Side rate={r.them} line={r.themLine} tone="info" />
      </span>
      <span className="dk-seo-competitors-lack-us" role="cell">
        <Side rate={r.us} line={r.usLine} tone={r.lack === true ? "bad" : "good"} />
        {r.task ? (
          <span className="dk-seo-competitors-task" title={`${taskWho(r.task)}: ${r.task.title}`}>
            {r.task.href ? (
              <Go href={r.task.href} className="dk-seo-competitors-task-link">
                {taskWho(r.task)}: {r.task.title}
              </Go>
            ) : (
              <span>
                {taskWho(r.task)}: {r.task.title}
              </span>
            )}
            {r.task.done ? " (marked done)" : ""}
          </span>
        ) : null}
      </span>
    </div>
  );
}
