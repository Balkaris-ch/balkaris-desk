import type { EnginePart } from "@/contract/seo/overview";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/StatusDot";
import { DEFAULT_RANGE, seoHref } from "./href";
import "./overview.css";

const ICON: Record<EnginePart["key"], IconName> = {
  "rank-history": "line-chart",
  keywords: "tag",
  opportunities: "lightbulb",
  indexation: "search",
  "ai-search": "robot",
  competitors: "users",
  presence: "link",
  "owner-tasks": "user",
};

const STATE: Record<EnginePart["state"], { tone: "good" | "warn" | "quiet"; word: string }> = {
  ok: { tone: "good", word: "Working" },
  waiting: { tone: "warn", word: "Waiting" },
  off: { tone: "quiet", word: "Not connected" },
};

/**
 * What the SEO tools are made of, each part with its real state in one line
 * of counts: the overview of every feature the owner asked to see.
 */
export function Engine({ parts, range = DEFAULT_RANGE }: { parts: EnginePart[]; range?: string }) {
  return (
    <Card
      title="What the SEO tools do"
      icon="layers"
      className="dk-seo-overview-panel dk-seo-overview-a-engine"
      info="Every part of the SEO engine, with what it holds today, read from the desk’s own tables. Each line leads to the page that shows it whole."
      flush
    >
      <ul className="dk-seo-overview-parts" aria-label="Parts of the SEO engine">
        {parts.map((p) => (
          <li key={p.key}>
            <Go href={seoHref(p.href, range)} className="dk-seo-overview-part">
              <span className="dk-seo-overview-part-icon" aria-hidden>
                <Icon name={ICON[p.key]} size={16} />
              </span>
              <span className="dk-seo-overview-part-text">
                <span className="dk-seo-overview-part-title">
                  {p.title}
                  <StatusDot tone={STATE[p.state].tone} title={STATE[p.state].word} />
                </span>
                <span className="dk-seo-overview-part-line">{p.line}</span>
              </span>
              <Icon name="chevron-right" size={14} className="dk-seo-overview-part-go" />
            </Go>
          </li>
        ))}
      </ul>
    </Card>
  );
}
