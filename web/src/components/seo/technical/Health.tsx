import type { Reading, Stat } from "@/contract/common";
import type { Indexation, SeoTechnicalPayload, TechLine } from "@/contract/seo/technical";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Stamp } from "@/components/ui/Stamp";
import { Info } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { ago, num, sourceLabel } from "@/lib/format";
import { TaskButton } from "./Act";
import { Body, Figure, Mark, type LineTone } from "./bits";

/**
 * The board's left column: Technical SEO Health (the crawl's score out of
 * 100, with what is not in it) and the checklist under it, each line counted
 * by its own source.
 */
export function HealthCard({ score, crawl, indexation }: { score: Reading<Stat>; crawl: SeoTechnicalPayload["crawl"]; indexation: Reading<Indexation> }) {
  return (
    <Card
      title="Technical SEO Health"
      icon="shield-check"
      info="The desk’s own score: each page starts at 100 and loses the stated points of every rule it breaks (src/cc/site/rules.ts); the site’s score is the mean of the pages, less the site-wide rules. It is not a figure from Google, and it does not include Google’s index."
      className="dk-seo-technical-health"
    >
      <Body reading={score}>
        {(s) => (
          <div className="dk-seo-technical-health-body">
            <p className="dk-seo-technical-score">
              <b className="dk-num">{num(s.value)}</b>
              <span className="dk-seo-technical-score-of dk-num"> / 100</span>
              {s.previous !== null ? <Delta value={s.value} previous={s.previous} unit="score" size="sm" className="dk-seo-technical-score-delta" /> : null}
            </p>
            <ProgressBar value={s.value} max={100} tone={s.value >= 90 ? "good" : s.value >= 70 ? "warn" : "bad"} label="Technical SEO health out of 100" size="md" className="dk-seo-technical-score-bar" />
            {crawl.state === "ok" ? (
              <p className="dk-seo-technical-health-counts">
                <span>
                  <b className={cx("dk-num", crawl.value.critical ? "dk-seo-technical-ink-bad" : null)}>{num(crawl.value.critical)}</b> critical
                </span>
                <span>
                  <b className={cx("dk-num", crawl.value.warning ? "dk-seo-technical-ink-warn" : null)}>{num(crawl.value.warning)}</b> {crawl.value.warning === 1 ? "warning" : "warnings"}
                </span>
                <span>
                  <b className="dk-num">{num(crawl.value.opportunity)}</b> {crawl.value.opportunity === 1 ? "opportunity" : "opportunities"}
                </span>
                <span className="dk-seo-technical-health-when">
                  {num(crawl.value.pages)} pages read, crawled <time dateTime={crawl.value.finished} suppressHydrationWarning>{ago(crawl.value.finished)}</time>
                </span>
              </p>
            ) : null}
            {indexation.state === "ok" && indexation.value.indexed < (indexation.value.of ?? indexation.value.inspected) ? (
              <Go href="#indexing" className="dk-seo-technical-health-index">
                <Icon name="alert" size={14} />
                <span>
                  Not in this score: Google’s index. {num(indexation.value.indexed)} of {num(indexation.value.of ?? indexation.value.inspected)} sitemap addresses are indexed.
                </span>
                <Icon name="chevron-right" size={14} />
              </Go>
            ) : null}
            <div className="dk-seo-technical-stampline">
              <Stamp reading={score} />
            </div>
          </div>
        )}
      </Body>
    </Card>
  );
}

const toneOf = (l: TechLine): LineTone => (l.reading.state === "ok" ? l.reading.value.tone : "absent");

/** The board's checklist: the eleven lines in its order, each with its count and, where the operator can propose the fix, a button. */
export function ChecksCard({ lines }: { lines: TechLine[] }) {
  return (
    <Card className="dk-seo-technical-checks-card" flush>
      <ul className="dk-seo-technical-checks" aria-label="Technical checks">
        {lines.map((l) => {
          const r = l.reading;
          return (
            <li key={l.key} className="dk-seo-technical-check">
              <Mark tone={toneOf(l)} />
              <span className="dk-seo-technical-check-label">
                <Go href={l.href} className="dk-seo-technical-check-text">
                  {l.label}
                </Go>
                <Info text={`${l.rule} Source: ${sourceLabel(r.source)}.${r.state === "ok" && r.note ? ` ${r.note}` : ""}`} label={`About ${l.label}`} />
              </span>
              <span className="dk-seo-technical-check-figure">
                {r.state === "ok" ? (
                  <>
                    <Figure n={r.value.count} of={r.value.of} tone={r.value.count === 0 && r.value.tone !== "info" ? "good" : r.value.tone} />
                    {r.value.previous !== null && r.value.previous !== r.value.count ? (
                      /* Only the page counts and the index carry a history, and for both more is better. */
                      <span className={cx("dk-seo-technical-check-change dk-num", r.value.count > r.value.previous ? "dk-seo-technical-ink-good" : "dk-seo-technical-ink-bad")}>
                        {r.value.count > r.value.previous ? "+" : "−"}
                        {num(Math.abs(r.value.count - r.value.previous))}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="dk-seo-technical-check-absent" title={`${r.reason}${r.state === "off" && r.step ? ` ${r.step}` : ""}`}>
                    {r.state === "waiting" ? "Nothing yet" : "Not available"}
                  </span>
                )}
              </span>
              <span className="dk-seo-technical-check-act">
                {l.fix ? (
                  <TaskButton task={l.fix.task} label={l.fix.label} variant="good" />
                ) : (
                  <Go href={l.href} className="dk-seo-technical-chev" aria-label={`Details of ${l.label}`}>
                    <Icon name="chevron-right" size={14} />
                  </Go>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
