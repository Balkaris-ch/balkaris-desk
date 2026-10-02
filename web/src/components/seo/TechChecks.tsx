import type { TechCheck } from "@/contract/seo";
import { cx } from "@/lib/cx";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { AbsentLine, StatusMark } from "./bits";
import "./seo.css";

/**
 * Indexation & technical SEO: the board's ten checks in its order, real today
 * from the crawl and the sitemap job (Pages indexed waits for Search
 * Console). Each value leads to that check's part of the full report.
 */
export function TechChecks({ checks, className }: { checks: TechCheck[]; className?: string }) {
  const crawl = checks.find((c) => c.key === "titles")?.reading;
  return (
    <Card
      className={className}
      title="Indexation & technical SEO"
      icon="settings"
      info="Read by the desk itself: the sitemap and robots.txt every quarter of an hour, every page once a day by its crawl, judged by the stated rules in src/cc/site/rules.ts. Pages indexed is Google’s URL Inspection of each sitemap address, once Search Console is connected."
      flush
    >
      <div className="dk-seo-checks">
        <div className="dk-seo-checks-head">
          {/* The column words are for the eye: each row names its check and says its status. The link stays reachable. */}
          <span aria-hidden>Check</span>
          <span aria-hidden>Status</span>
          <LinkButton href="/seo/report" size="xs" className="dk-seo-checks-report">
            View full report
          </LinkButton>
        </div>
        <ul className="dk-seo-checks-list" aria-label="Checks">
          {checks.map((c) => {
            const r = c.reading;
            const tone = r.state === "ok" ? r.value.tone : "absent";
            if (r.state !== "ok") {
              /* Nothing to lead to yet: the row says why, and how to connect it, on hover. */
              return (
                <li key={c.key}>
                  <div className="dk-seo-check">
                    <span className="dk-seo-check-label">{c.label}</span>
                    <StatusMark tone={tone} />
                    <span className="dk-seo-check-value dk-seo-check-value--absent">
                      <AbsentLine reading={r}>{r.state === "off" ? "Not connected" : "Nothing yet"}</AbsentLine>
                    </span>
                    <span className="dk-seo-check-go" />
                  </div>
                </li>
              );
            }
            const plain = r.value.tone === "good" && !/^No /.test(r.value.text);
            return (
              <li key={c.key}>
                <Go href={c.href} className="dk-seo-check dk-seo-check--link">
                  <span className="dk-seo-check-label">{c.label}</span>
                  <StatusMark tone={tone} />
                  <span className={cx("dk-seo-check-value", `dk-seo-check-value--${plain ? "plain" : r.value.tone}`)}>{r.value.text}</span>
                  <Icon name="chevron-right" size={14} className="dk-seo-check-go" />
                </Go>
              </li>
            );
          })}
        </ul>
        <div className="dk-seo-flush-foot">{crawl ? <Stamp reading={crawl} /> : null}</div>
      </div>
    </Card>
  );
}
