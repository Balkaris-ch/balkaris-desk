import type { ChipTone } from "./Badge";
import { cx } from "@/lib/cx";
import { Count } from "./Badge";
import { Go } from "./Go";
import { Icon, type IconName } from "./icons";
import "./tabs.css";

export interface TabItem {
  /** Compared with `active`. */
  key: string;
  label: string;
  /** Where the tab goes: usually this page with `?tab=key`. */
  href: string;
  /** The number after the label. Null or undefined draws none; zero is drawn. */
  count?: number | string | null;
  /** The count's colour: bad for an inbox that needs attention. */
  countTone?: ChipTone;
  icon?: IconName;
}

export interface TabsProps {
  items: readonly TabItem[];
  /** The key of the tab that is showing. */
  active: string;
  /** What the tabs choose between, for a screen reader: "Insight views". */
  label: string;
  /** md is a page's strip (Insights, Pages); sm sits inside a panel (AI Operator's "Website context"). */
  size?: "md" | "sm";
  className?: string;
}

/**
 * Tabs as links, with counts. Each tab is an address, so the server draws the
 * right view, the back button works and a tab can be shared. The page reads
 * which one is active from its own search params and says so here.
 */
export function Tabs({ items, active, label, size = "md", className }: TabsProps) {
  return (
    <nav className={cx("dk-tabs", `dk-tabs--${size}`, className)} aria-label={label}>
      {items.map((t) => {
        const on = t.key === active;
        return (
          <Go key={t.key} href={t.href} className={cx("dk-tab", on && "dk-tab--on")} aria-current={on ? "page" : undefined} scroll={false}>
            {t.icon ? <Icon name={t.icon} size={size === "sm" ? 14 : 16} /> : null}
            <span>{t.label}</span>
            {t.count != null ? <Count tone={t.countTone ?? "quiet"}>{t.count}</Count> : null}
          </Go>
        );
      })}
    </nav>
  );
}
