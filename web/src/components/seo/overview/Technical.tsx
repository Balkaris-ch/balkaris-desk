import type { Reading } from "@/contract/common";
import type { TechnicalPanel, TechnicalRow } from "@/contract/seo/overview";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Stamp } from "@/components/ui/Stamp";
import { Info } from "@/components/ui/Tooltip";
import { PanelAbsent, StatusMark } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { num, sourceLabel } from "@/lib/format";
import { TaskButton } from "./Act";
import { plural } from "./bits";
import { DEFAULT_RANGE, seoHref } from "./href";
import "./overview.css";

/** One check: its mark, its name with what the crawl found under it, its count, and Fix or View. */
function Check({ r, range, operate }: { r: TechnicalRow; range: string; operate: boolean }) {
  return (
    <li className="dk-seo-overview-check">
      <StatusMark tone={r.tone} />
      <span className="dk-seo-overview-check-label">
        <span className="dk-seo-overview-check-words">
          <span className="dk-seo-overview-check-text">{r.label}</span>
          {r.found.length ? <span className="dk-seo-overview-check-found">{r.found.map((f) => `${f.title} (${num(f.count)})`).join(" · ")}</span> : null}
        </span>
        <Info text={`${r.rule} Source: ${sourceLabel(r.source)}.`} label={`About ${r.label}`} />
      </span>
      <span className={cx("dk-seo-overview-check-n dk-num", `dk-seo-overview-check-n--${r.tone}`)}>
        {num(r.count)}
        {r.of !== null ? <span className="dk-seo-overview-check-of"> / {num(r.of)}</span> : null}
      </span>
      {r.fix && operate ? (
        <TaskButton task={r.fix.task} label="Fix" variant="quiet" className="dk-seo-overview-check-act" />
      ) : (
        <LinkButton href={seoHref(r.href, range)} size="xs" variant="ghost" className="dk-seo-overview-check-act" aria-label={`View ${r.label}`}>
          View
        </LinkButton>
      )}
    </li>
  );
}

/**
 * Technical SEO: Google's index, every family of the crawl's rules (each rule
 * in exactly one row, so the panel cannot read green while the crawl reports
 * something), and PageSpeed's lab. What needs a person comes first; the clean
 * checks fold into one line that opens. "Fix" exists only where an operator
 * task fixes it (titles, descriptions, redirects for broken links) and the
 * person may queue operator work; what it proposes waits for approval. Every
 * other row leads to its section of SEO › Technical.
 */
export function Technical({ reading, range = DEFAULT_RANGE, operate = true }: { reading: Reading<TechnicalPanel>; range?: string; operate?: boolean }) {
  const v = reading.state === "ok" ? reading.value : null;
  const needs = v ? v.rows.filter((r) => r.tone !== "good") : [];
  const clean = v ? v.rows.filter((r) => r.tone === "good") : [];
  const f = v?.findings;
  return (
    <Card
      title="Technical SEO"
      icon="wrench"
      className="dk-seo-overview-panel dk-seo-overview-a-tech"
      info="Counted by the desk’s crawl by its stated rules (src/cc/site/rules.ts), every rule in one of these lines; by Google’s URL Inspection for the index; and by PageSpeed’s lab for speed. Fix asks the operator for proposals, which wait for a person’s approval before anything on the site changes."
      sub={f ? `Last crawl: ${plural(f.critical, "critical finding")}, ${plural(f.warning, "warning")}, ${plural(f.opportunity, "opportunity", "opportunities")}` : undefined}
      right={<LinkButton href={seoHref("/seo/technical", range)} size="sm">View all</LinkButton>}
      flush
    >
      {v ? (
        <div>
          <ul className="dk-seo-overview-checks" aria-label="Technical checks that need attention">
            {needs.map((r) => (
              <Check key={r.key} r={r} range={range} operate={operate} />
            ))}
          </ul>
          {clean.length ? (
            <details className="dk-seo-overview-clean">
              <summary className="dk-seo-overview-clean-sum">
                <StatusMark tone="good" />
                <span>{plural(clean.length, "check")} clean</span>
              </summary>
              <ul className="dk-seo-overview-checks" aria-label="Technical checks that are clean">
                {clean.map((r) => (
                  <Check key={r.key} r={r} range={range} operate={operate} />
                ))}
              </ul>
            </details>
          ) : null}
          {v.unfiled ? <p className="dk-seo-overview-quiet dk-seo-overview-pad">{plural(v.unfiled, "finding")} of a rule this panel does not list yet: see SEO › Technical.</p> : null}
          <div className="dk-seo-overview-stampline">
            <Stamp reading={reading} />
          </div>
        </div>
      ) : reading.state !== "ok" ? (
        <div className="dk-seo-overview-pad">
          <PanelAbsent reading={reading} />
        </div>
      ) : null}
    </Card>
  );
}
