import type { ArticlePayload } from "@/contract/article";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { ago } from "@/lib/format";
import { StateBadge } from "./parts";
import "./article.css";

/** Other articles written from the same link (a deleted draft written again), newest first. Nothing when there are none. */
export function Siblings({ siblings }: { siblings: ArticlePayload["siblings"] }) {
  if (!siblings.length) return null;
  return (
    <Card title="Other drafts from this link" icon="layers" count={siblings.length}>
      <ul className="dk-article-sibs">
        {siblings.map((s) => (
          <li key={s.id}>
            <Go href={`/insights/${s.id}`} className="dk-article-sib">
              <span className="dk-article-sib-text">
                <span className="dk-article-sib-title">{s.title}</span>
                <span className="dk-article-quiet">{`Draft ${s.id}, written ${ago(s.writtenAt)}`}</span>
              </span>
              <StateBadge state={s.state} />
              <Icon name="chevron-right" size={14} />
            </Go>
          </li>
        ))}
      </ul>
    </Card>
  );
}
