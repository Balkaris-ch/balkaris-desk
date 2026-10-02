import type { Reading } from "@/contract/common";
import type { TechnicalPanel } from "@/contract/seo/overview";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Stamp } from "@/components/ui/Stamp";
import { Info } from "@/components/ui/Tooltip";
import { PanelAbsent, StatusMark } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { num, sourceLabel } from "@/lib/format";
import { TaskButton } from "./Act";
import "./overview.css";

/**
 * Technical SEO: the board's checks, each counted by its own source (the
 * crawl, Google's URL Inspection, PageSpeed's lab). "Fix" exists only where an
 * operator task fixes it (titles and descriptions, redirects for broken
 * links), and what it proposes waits for approval; every other row leads to
 * the Technical page.
 */
export function Technical({ reading }: { reading: Reading<TechnicalPanel> }) {
  return (
    <Card
      title="Technical SEO"
      icon="wrench"
      className="dk-seo-overview-panel dk-seo-overview-a-tech"
      info="Counted by the desk’s crawl by its stated rules (src/cc/site/rules.ts), by Google’s URL Inspection for the index, and by PageSpeed’s lab for speed. Fix asks the operator for proposals, which wait for a person’s approval before anything on the site changes."
      right={<LinkButton href="/seo/technical" size="sm">View all</LinkButton>}
      flush
    >
      {reading.state === "ok" ? (
        <div>
          <ul className="dk-seo-overview-checks" aria-label="Technical checks">
            {reading.value.rows.map((r) => (
              <li key={r.key} className="dk-seo-overview-check">
                <StatusMark tone={r.tone} />
                <span className="dk-seo-overview-check-label">
                  <span className="dk-seo-overview-check-text">{r.label}</span>
                  <Info text={`${r.rule} Source: ${sourceLabel(r.source)}.`} label={`About ${r.label}`} />
                </span>
                <span className={cx("dk-seo-overview-check-n dk-num", `dk-seo-overview-check-n--${r.tone}`)}>
                  {num(r.count)}
                  {r.of !== null ? <span className="dk-seo-overview-check-of"> / {num(r.of)}</span> : null}
                </span>
                {r.fix ? (
                  <TaskButton task={r.fix.task} label="Fix" variant="quiet" className="dk-seo-overview-check-act" />
                ) : (
                  <LinkButton href={r.href} size="xs" variant="ghost" className="dk-seo-overview-check-act" aria-label={`View ${r.label}`}>
                    View
                  </LinkButton>
                )}
              </li>
            ))}
          </ul>
          <div className="dk-seo-overview-stampline">
            <Stamp reading={reading} />
          </div>
        </div>
      ) : (
        <div className="dk-seo-overview-pad">
          <PanelAbsent reading={reading} />
        </div>
      )}
    </Card>
  );
}
