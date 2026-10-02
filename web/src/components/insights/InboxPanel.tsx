import type { InsightsPayload } from "@/contract/insights";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import type { IconName } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { Tabs } from "@/components/ui/Tabs";
import { Thumb } from "@/components/ui/Thumb";
import { ago } from "@/lib/format";
import { hrefOf, type View } from "./href";
import { RetryButton } from "./RetryButton";
import { STATUS_WORD } from "./status";

/** A mark for where a link came from. Plain shapes, no platform's logo. */
export const SOURCE_ICON: Record<string, IconName> = { tiktok: "video", instagram: "image", youtube: "play", social: "users", web: "link", site: "globe" };

/**
 * The links shared and not yet written (the Inbox tab's rows), newest first,
 * by where they came from. Each can be opened; a stuck one, or one the desk
 * could not read, can be tried again. Every source the desk has had a link
 * from keeps its tab, with how many of its links wait.
 */
export function InboxPanel({ data, view }: { data: InsightsPayload; view: View }) {
  const { sources, source, rows } = data.inbox;
  const here = sources.find((s) => s.key === source);
  return (
    <Card
      className="dk-insights-inbox"
      title="Content inbox & sources"
      icon="inbox"
      info="Links shared with the desk that are not written yet (to read, writing or stuck), by the platform they came from. The Telegram bot and Create insight both put them here. Once written, a link leaves the inbox for Drafts, Review or Published."
    >
      {sources.length === 0 ? (
        <Empty compact title="Nothing shared yet">
          Send the bot a link, or use Create insight: an article, a TikTok, a Reel or a carousel.
        </Empty>
      ) : (
        <>
          <Tabs
            size="sm"
            label="Where the links came from"
            active={source ?? ""}
            className="dk-insights-sources"
            items={sources.map((s) => ({ key: s.key, label: s.label, count: s.count, href: hrefOf(view, { source: s.key }) }))}
          />
          {rows.length === 0 ? (
            <Empty compact icon="check-circle" title="Nothing waiting">
              {here ? `All ${here.shared} ${here.shared === 1 ? "link" : "links"} shared from ${here.key === "web" ? "the web" : here.label} ${here.shared === 1 ? "has" : "have"} been written.` : "Every shared link has been written."}
            </Empty>
          ) : (
            <ul className="dk-insights-inbox-list">
              {rows.map((r) => (
                <li key={r.linkId} className="dk-insights-inbox-row">
                  <Thumb src={r.cover} size="sm" icon={SOURCE_ICON[source ?? "web"] ?? "link"} />
                  <div className="dk-insights-inbox-text">
                    <Go href={r.href} className="dk-insights-inbox-title" title={r.title}>
                      {r.title}
                    </Go>
                    <p className="dk-insights-inbox-meta">
                      {r.handle ? <span className="dk-insights-inbox-handle">{r.handle}</span> : null}
                      <time dateTime={r.shared}>{ago(r.shared)}</time>
                      <span className={`dk-insights-word dk-insights-word--${r.status}`}>{STATUS_WORD[r.status]}</span>
                    </p>
                    {/* The line that says why; the whole error on hover, and on the link's own page. */}
                    {r.problem ? (
                      <p className="dk-insights-inbox-problem" title={r.problemFull ?? r.problem}>
                        {r.problem}
                      </p>
                    ) : null}
                  </div>
                  {r.canRetry ? (
                    <RetryButton linkId={r.linkId} />
                  ) : (
                    <LinkButton href={r.href} size="xs" variant="quiet">
                      Open
                    </LinkButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="dk-insights-foot dk-insights-inbox-foot">
            <Stamp source="desk" asOf={data.inbox.asOf} />
          </p>
        </>
      )}
    </Card>
  );
}
