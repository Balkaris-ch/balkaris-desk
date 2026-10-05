import type { ActivityItem } from "@/contract/common";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { activityItems, Timeline } from "@/components/ui/Timeline";
import { Fill } from "./Fill";
import { DEFAULT_RANGE, seoHref } from "./href";
import "./overview.css";

/**
 * Recent SEO actions: what the SEO engine did and what people decided, the
 * crawl, and the operator's SEO work (titles, descriptions, redirects,
 * briefs, questions asked from this page), newest first, from the desk's own
 * log. Under the AI SEO Operator, as on the boards, it shows as many entries
 * as the column has room for (Fill); the whole log is under View all.
 */
export function Recent({ items, at, range = DEFAULT_RANGE }: { items: ActivityItem[]; at: string; range?: string }) {
  return (
    <Card
      title="Recent SEO actions"
      icon="clock"
      className="dk-seo-overview-panel dk-seo-overview-a-recent"
      info="The desk’s own log: the SEO engine’s runs and imports, a person’s decisions on opportunities and owner tasks, the crawl, and the operator’s titles, descriptions, redirects, briefs and questions asked here, with what was approved or rejected."
      right={<LinkButton href={seoHref("/seo/automations", range)} size="sm">View all</LinkButton>}
    >
      {items.length ? (
        <Fill className="dk-seo-overview-recent-fill" watch={`${items.length}:${items[0]!.id}`}>
          <Timeline items={activityItems(items.map((i) => (i.href ? { ...i, href: seoHref(i.href, range) } : i)), new Date(at))} label="Recent SEO actions" className="dk-seo-overview-timeline" />
        </Fill>
      ) : (
        <Empty icon="clock" title="Nothing yet" compact>
          The SEO engine has not written anything to the log yet.
        </Empty>
      )}
    </Card>
  );
}
