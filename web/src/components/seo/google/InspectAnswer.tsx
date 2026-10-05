import type { InspectNow } from "@/contract/seo/google";
import { Chip } from "@/components/ui/Badge";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { fullDate, ago } from "@/lib/format";

/**
 * Google's URL Inspection of one address, in plain words: indexed or why not,
 * the canonical Google chose, its last crawl, phone usability and the rich
 * results it found. It is Google's stored record of the address (its indexed
 * version), not a live test of the page. No hooks: drawn by the server where
 * a kept answer is shown, and by "Inspect now" right after it is pressed.
 */
export function InspectAnswer({ inspection: i, compact }: { inspection: InspectNow; compact?: boolean }) {
  return (
    <div className="dk-seo-google-answer" role="group" aria-label={`Google's answer for ${i.path}`}>
      <p className="dk-seo-google-answer-head">
        <Chip tone={i.indexed ? "good" : "warn"}>{i.indexed ? "Indexed" : "Not indexed"}</Chip>
        <span className="dk-seo-google-answer-line">{i.line}</span>
      </p>
      {i.changed ? <p className="dk-seo-google-answer-was">{i.changed}</p> : null}
      {i.indexed ? null : (
        <p className="dk-seo-google-answer-text">
          <b>What Google means.</b> {i.meaning} <b>The fix.</b> {i.fix}
        </p>
      )}
      <ul className="dk-seo-google-answer-facts">
        <li>
          <span className="dk-seo-google-answer-k">Last crawl</span>
          <span>{i.lastCrawl ? `${fullDate(i.lastCrawl)}${i.crawledAs ? `, by the ${i.crawledAs === "MOBILE" ? "phone" : "desktop"} crawler` : ""}` : "Google has not crawled it"}</span>
        </li>
        <li>
          <span className="dk-seo-google-answer-k">Canonical</span>
          <span>{i.canonical.line}</span>
        </li>
        {compact ? null : (
          <>
            <li>
              <span className="dk-seo-google-answer-k">Phone</span>
              <span>{i.mobile.line}</span>
            </li>
            <li>
              <span className="dk-seo-google-answer-k">Rich results</span>
              <span>{i.rich.line}</span>
            </li>
            {i.rich.items.some((x) => x.issues.length) ? (
              <li>
                <span className="dk-seo-google-answer-k">Their issues</span>
                <span>
                  {i.rich.items
                    .flatMap((x) => x.issues.map((s) => `${x.type}: ${s.message}${s.severity === "ERROR" ? " (error)" : ""}`))
                    .slice(0, 6)
                    .join("; ")}
                </span>
              </li>
            ) : null}
            {i.referring.length ? (
              <li>
                <span className="dk-seo-google-answer-k">Found linked from</span>
                <span>{i.referring.slice(0, 3).map((u) => u.replace(/^https?:\/\/[^/]+/, "") || "/").join(", ")}</span>
              </li>
            ) : null}
          </>
        )}
      </ul>
      <p className="dk-seo-google-answer-foot">
        <span>
          Asked by {i.by}{" "}
          <time dateTime={i.at} suppressHydrationWarning>
            {ago(i.at)}
          </time>
        </span>
        {i.consoleHref ? (
          <Go href={i.consoleHref} className="dk-seo-google-ext">
            Open in Search Console <Icon name="external" size={12} />
          </Go>
        ) : null}
      </p>
    </div>
  );
}
