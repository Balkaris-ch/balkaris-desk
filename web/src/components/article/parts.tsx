import type { ReactNode } from "react";
import type { SiteState } from "@/contract/article";
import { Badge, type ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import "./article.css";

/** A list of facts: a quiet label on the left, the value on the right. Rows whose value is null are left out. */
export function Facts({ rows, className }: { rows: [label: string, value: ReactNode][]; className?: string }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "");
  if (!shown.length) return null;
  return (
    <dl className={cx("dk-article-facts", className)}>
      {shown.map(([label, value]) => (
        <div key={label} className="dk-article-fact">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const STATES: Record<SiteState, { label: string; tone: ChipTone; icon: IconName }> = {
  draft: { label: "Draft, not on the site", tone: "violet", icon: "pencil" },
  unlisted: { label: "Live, unlisted", tone: "info", icon: "eye" },
  listed: { label: "Published", tone: "good", icon: "check-circle" },
  down: { label: "Taken down", tone: "warn", icon: "x-circle" },
};

/** The article's place on the website, as a badge. */
export function StateBadge({ state }: { state: SiteState }) {
  const s = STATES[state];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

/**
 * What each place on the site means, in the old console's words (src/console.ts
 * draftPage), with the fourth state the old page could not name.
 */
export const STATE_SAYS: Record<SiteState, string> = {
  draft:
    "Not on the site at all yet. Putting it there gives it a real address that nobody can find: no menu, no shelf, no sitemap, and noindex so a crawler leaves it alone.",
  unlisted:
    "Live at its own address and in none of the menus. It carries noindex, so it is readable by anyone you send the link to and invisible to search.",
  listed: "Published: in the menu, on the shelves, in the sitemap and in search.",
  down: "It was live and was taken off the site: its address no longer works. It is a draft again and can be put back.",
};

/** A link's state as the old console's list names it. */
export const LINK_SAYS: Record<string, { label: string; tone: ChipTone }> = {
  new: { label: "Just shared", tone: "quiet" },
  queued: { label: "Waiting for the workstation", tone: "warn" },
  social: { label: "Waiting for the workstation", tone: "warn" },
  drafted: { label: "Written", tone: "violet" },
  listed: { label: "Published", tone: "good" },
  unlisted: { label: "Live at its address, not listed", tone: "info" },
  failed: { label: "Could not be read", tone: "bad" },
};

/** A job's state, as a chip's tone. */
export const JOB_TONE: Record<string, ChipTone> = { queued: "warn", running: "info", done: "good", stuck: "bad" };

/** What each job is for, in words. */
export const JOB_SAYS: Record<string, string> = {
  ingest: "Read the post",
  write: "Write the article",
  cover: "Draw the cover",
  clip: "Cut the silent clip",
  reclose: "Write a different ending",
};

/** A platform as people write it. */
export function platformName(p: string | null | undefined): string | null {
  if (!p) return null;
  const known: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", linkedin: "LinkedIn", x: "X", facebook: "Facebook" };
  return known[p.toLowerCase()] ?? p;
}

/** The kind of thing that was shared. */
export function kindName(k: string): string {
  const known: Record<string, string> = { article: "Article", video: "Video", carousel: "Carousel", social: "Social post, not read yet" };
  return known[k] ?? k;
}
