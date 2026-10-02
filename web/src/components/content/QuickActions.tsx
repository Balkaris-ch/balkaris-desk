import { Card } from "@/components/ui/Card";
import { ActionList, type ActionItem } from "@/components/ui/ActionList";
import { ago } from "@/lib/format";
import type { ContentPayload } from "@/contract/content";
import { runCrawl } from "./actions";
import { CrawlWatch } from "./CrawlWatch";
import { hrefFor, type ContentView } from "./view";

/**
 * Quick actions: two links to where the work is done, and the one action
 * this screen runs itself, the crawl. Nothing here does nothing: "Create new
 * insight" is offered only to a person the Insights screen opens its create
 * dialog for (`canCreate`, the same rule as there).
 */
export function QuickActions({ crawl, canCreate, view }: { crawl: ContentPayload["crawl"]; canCreate: boolean; view: ContentView }) {
  const items: ActionItem[] = [
    ...(canCreate ? [{ icon: "plus", label: "Create new insight", description: "Start an article from a link, at the desk", href: "/insights?create=1" } satisfies ActionItem] : []),
    { icon: "file-text", label: "Generate page brief", description: "Ask the AI Operator for a brief for a page", href: "/operator?do=brief" },
    {
      icon: "refresh",
      label: "Run the crawl now",
      description: crawl.running ? "The crawl is running now" : crawl.finished ? `Last crawl finished ${ago(crawl.finished)}` : "Read every page of the website now",
      action: runCrawl,
      fields: { back: hrefFor(view) },
    },
  ];
  return (
    <Card id="actions" title="Quick actions" icon="bolt">
      <ActionList label="Quick actions" items={items} />
      <CrawlWatch asked={view.crawl} running={crawl.running} finished={crawl.finished} />
    </Card>
  );
}
