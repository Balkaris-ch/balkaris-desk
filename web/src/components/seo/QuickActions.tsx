import type { AuditState } from "@/contract/seo";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { AuditAction } from "./AuditAction";
import "./seo.css";

const LINKS: { icon: IconName; label: string; description: string; href: string }[] = [
  { icon: "edit", label: "Generate metadata", description: "Draft titles and descriptions with AI", href: "/operator?do=metadata" },
  { icon: "redirect", label: "Create redirect", description: "Keep old links working after a move", href: "/operator?do=redirect" },
  { icon: "file-text", label: "Generate page brief", description: "An SEO content brief from the AI operator", href: "/operator?do=brief" },
];

/**
 * Quick actions, drawn as the board draws them: one line each (icon, the
 * action, what it does in small grey type, a chevron) with a hairline between.
 * The audit runs here (the crawl, with its progress); the other three open the
 * AI operator with the task chosen.
 */
export function QuickActions({ audit, rules, className }: { audit: AuditState; rules: number | null; className?: string }) {
  return (
    <Card className={className} title="Quick actions" icon="bolt" flush>
      <ul className="dk-seo-actions" aria-label="Quick actions">
        <li>
          <AuditAction job={audit.job} rules={rules} />
        </li>
        {LINKS.map((l) => (
          <li key={l.label}>
            <Go href={l.href} className="dk-seo-action">
              <Icon name={l.icon} size={16} className="dk-seo-action-icon" />
              <span className="dk-seo-action-text">
                <span className="dk-seo-action-label">{l.label}</span>
                <span className="dk-seo-action-desc" title={l.description}>
                  {l.description}
                </span>
              </span>
              <Icon name="chevron-right" size={14} className="dk-seo-action-go" />
            </Go>
          </li>
        ))}
      </ul>
    </Card>
  );
}
