import type { ReactNode } from "react";
import type { SeoKeywordsPayload } from "@/contract/seo/keywords";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Info } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { KEYWORD_ONLY, keywordsHref, type Place } from "./href";

/**
 * The list's head, inside its panel. Board 113 puts the filters straight
 * under the tiles, so nothing stands between them here either: the head holds
 * the two ways the page lists (the phrases, or the topic clusters they form)
 * with their counts, the panel's (i), its quick filters or its one line, and
 * its buttons on the right ("Track a phrase", "Bulk actions", "Export").
 *
 * The panel's heading is the switch itself; `title` names the panel for a
 * screen reader.
 */
export function KwHead({
  data,
  place,
  title,
  info,
  middle,
  actions,
}: {
  data: SeoKeywordsPayload;
  place: Place;
  title: string;
  info: ReactNode;
  middle?: ReactNode;
  actions?: ReactNode;
}) {
  const view = data.asked.view;
  const phrases = data.tiles.total.state === "ok" ? data.tiles.total.value.value : null;
  const mode = (key: "keywords" | "clusters", label: string, count: number | null, icon: "list" | "layers") => (
    <Go
      href={keywordsHref(place, key === "clusters" ? { ...KEYWORD_ONLY, view: key, offset: 0, open: null } : { view: key, offset: 0 })}
      scroll={false}
      className={cx("dk-seo-kw-mode", view === key && "dk-seo-kw-mode--on")}
      aria-current={view === key ? "page" : undefined}
    >
      <Icon name={icon} size={14} />
      <span>{label}</span>
      {count !== null ? <span className="dk-seo-kw-mode-n dk-num">{num(count)}</span> : null}
    </Go>
  );
  return (
    <div className="dk-seo-kw-head">
      <h2 className="dk-sr">{title}</h2>
      <div className="dk-seo-kw-head-left">
        {/* The (i) stays beside the switch it explains when the head wraps. */}
        <span className="dk-seo-kw-head-mode">
          <nav className="dk-seo-kw-modes" aria-label="List by">
            {mode("keywords", "Keywords", phrases, "list")}
            {mode("clusters", "Topic clusters", data.clusterTotal, "layers")}
          </nav>
          <Info text={info} />
        </span>
        {middle}
      </div>
      {actions ? <div className="dk-seo-kw-head-right">{actions}</div> : null}
    </div>
  );
}
