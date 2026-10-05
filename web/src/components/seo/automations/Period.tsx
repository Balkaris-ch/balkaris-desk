import type { Reading } from "@/contract/common";
import type { SeoJobsPeriod } from "@/contract/seo/automations";
import type { SeoRange } from "@/contract/seo/common";
import { SparkBars } from "@/components/charts/SparkBars";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { fullDate, num, rangeLabel } from "@/lib/format";
import { exportHref, jobHref, when } from "./words";

/**
 * The head's period on this tab: how many runs these jobs made in it, how
 * many failed or were cut off by a restart, which ones failed, and what they
 * brought in (new phrases, new searches, opportunities, pages indexed or
 * dropped), each counted from the table its job writes and linked to where it
 * shows. The runs come from the scheduler's week and the SEO section's own
 * longer copy of them, so a year is a year once the desk has kept one; before
 * that the card says from when it counts. Export gives the same runs as CSV.
 */
export function Period({ reading, range, at, logLines }: { reading: Reading<SeoJobsPeriod>; range: SeoRange; at: string; logLines: number }) {
  const has = reading.state === "ok" && reading.value.ok + reading.value.failed + reading.value.cut > 0;
  return (
    <Card
      title="In the period"
      icon="bar-chart"
      count={rangeLabel(range)}
      sub="What these jobs did in the period chosen at the top, and what they brought in."
      right={
        <span className="dk-seo-automations-card-right">
          <Stamp reading={reading} />
          {has ? (
            <LinkButton href={exportHref(range)} size="sm" icon="download" title="Every run of these jobs in the period, as a CSV file">
              Export runs
            </LinkButton>
          ) : null}
        </span>
      }
    >
      <Read reading={reading}>
        {(p) => (
          <div className="dk-seo-automations-period">
            <div className="dk-seo-automations-period-runs">
              <p className="dk-seo-automations-split-figure dk-num">
                {num(p.ok)} <span className="dk-seo-automations-of">runs finished</span>
              </p>
              <p className="dk-num">
                <span className={p.failed ? "dk-seo-automations-bad" : "dk-seo-automations-quiet"}>{num(p.failed)} failed</span>
                <span className="dk-seo-automations-quiet"> · {num(p.cut)} cut off by a restart · {num(logLines)} log lines</span>
              </p>
              <SparkBars data={p.series} label={`Runs started, ${p.sliceDays === 1 ? "day by day" : `${p.sliceDays} days to a bar`}`} />
              {p.begins && Date.parse(p.begins) > Date.parse(at) - p.days * 86_400_000 ? (
                <p className="dk-seo-automations-quiet">The desk began keeping these runs on {fullDate(p.begins)}, so it counts from then.</p>
              ) : null}
            </div>

            <div>
              <p className="dk-seo-automations-more-head">What they brought in</p>
              {p.found.length ? (
                <dl className="dk-seo-automations-facts dk-seo-automations-found">
                  {p.found.map((f) => (
                    <div key={f.key} className="dk-seo-automations-found-row">
                      <dt>{f.href ? <Go href={f.href}>{f.label}</Go> : f.label}</dt>
                      <dd className="dk-num" title={`Counted from what "${f.from}" writes`}>
                        {num(f.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="dk-seo-automations-quiet">None of the tables these jobs write could be read just now.</p>
              )}
            </div>

            <div>
              <p className="dk-seo-automations-more-head">Failed runs</p>
              {p.failures.length ? (
                <ol className="dk-seo-automations-log">
                  {p.failures.slice(0, 6).map((f) => (
                    <li key={`${f.job}:${f.start}`}>
                      <time className="dk-num" dateTime={f.start}>
                        {when(f.start, at)}
                      </time>
                      <StatusDot tone="bad" title="Failed" />
                      <Go href={jobHref(f.job, range)} className="dk-seo-automations-log-body dk-seo-automations-log-link">
                        <span className="dk-seo-automations-log-text">{f.title}</span>
                        {f.note ? <span className="dk-seo-automations-log-detail">{f.note}</span> : null}
                      </Go>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="dk-seo-automations-quiet">None in the period.</p>
              )}
            </div>
          </div>
        )}
      </Read>
    </Card>
  );
}
