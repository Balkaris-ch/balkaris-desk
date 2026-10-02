import type { InsightsPayload } from "@/contract/insights";
import { ActionList } from "@/components/ui/ActionList";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { hrefOf, type View } from "./href";

const KIND_ICON: Record<string, IconName> = {
  Title: "pencil",
  Description: "file-text",
  Links: "link",
  Cover: "image",
  Content: "article",
  Stuck: "alert",
  Freshness: "clock",
};

/** How many findings the panel shows before "View all". */
const FIRST = 4;

/**
 * Recommendations: what the stated rules find, article by article. Each row
 * names the article, what to do, the figure the rule measured, and the kind of
 * finding. There is no predicted uplift: nothing here can know one.
 */
export function RecommendationsPanel({ data, view }: { data: InsightsPayload; view: View }) {
  const all = view.recs === "all";
  const r = data.recommendations;
  const n = r.state === "ok" ? r.value.length : null;
  return (
    <Card
      id="recommendations"
      className="dk-insights-recs"
      title="Recommendations"
      icon="sparkles"
      count={n ?? undefined}
      right={
        n !== null && n > FIRST ? (
          <LinkButton href={all ? hrefOf(view, { recs: undefined }, "recommendations") : hrefOf(view, { recs: "all" }, "recommendations")} size="xs" variant="quiet">
            {all ? "Show fewer" : "View all"}
          </LinkButton>
        ) : undefined
      }
    >
      <Read reading={r}>
        {(list, reading) =>
          list.length === 0 ? (
            <Empty compact icon="check-circle" title="Nothing found">
              No article breaks one of the rules.
            </Empty>
          ) : (
            <>
              <ul className="dk-insights-recs-list">
                {(all ? list : list.slice(0, FIRST)).map((x) => (
                  <li key={x.id}>
                    <Go href={x.href} className="dk-insights-rec" title={x.text}>
                      <span className={`dk-insights-rec-icon dk-tone-${x.tone}`} aria-hidden>
                        <Icon name={KIND_ICON[x.kind] ?? "lightbulb"} size={16} />
                      </span>
                      <span className="dk-insights-rec-text">
                        <b>{x.action}</b>
                        <span>
                          “{x.subject}” · {x.measure}
                        </span>
                        <span className="dk-sr">{x.text}</span>
                      </span>
                      <Chip tone={x.tone === "bad" ? "bad" : x.tone === "warn" ? "warn" : "good"}>{x.kind}</Chip>
                    </Go>
                  </li>
                ))}
              </ul>
              <p className="dk-insights-foot">
                <Stamp reading={reading} />
              </p>
            </>
          )
        }
      </Read>
    </Card>
  );
}

/** Quick actions: only the ones that do something. */
export function QuickActions({ view, canCreate, drafts }: { view: View; canCreate: boolean; drafts: number }) {
  const here = hrefOf(view);
  /* The dialog opens itself on ?create=1 (CreateInsight). */
  const create = `${here}${here.includes("?") ? "&" : "?"}create=1`;
  return (
    <Card className="dk-insights-quick" title="Quick actions" icon="bolt">
      <ActionList
        label="Quick actions"
        columns={2}
        items={[
          ...(canCreate ? [{ icon: "plus" as const, label: "Create new insight", description: "Give the desk a link to write", href: create }] : []),
          { icon: "file-text" as const, label: "Generate brief", description: "From a topic", href: "/operator?do=brief" },
          { icon: "send" as const, label: "Publish draft", description: drafts === 0 ? "None waiting" : `${drafts} waiting`, href: hrefOf(view, { tab: "drafts" }) },
        ]}
      />
    </Card>
  );
}
