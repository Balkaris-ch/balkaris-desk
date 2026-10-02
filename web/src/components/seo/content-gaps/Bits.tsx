import type { Priority } from "@/contract/seo/common";
import type { BriefState, GapKeyword } from "@/contract/seo/content-gaps";
import type { Intent, KeywordSource } from "@/contract/seo/keywords";
import { Chip } from "@/components/ui/Badge";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { DASH, num } from "@/lib/format";
import { BriefButton } from "./Act";
import { INTENT_TONE, INTENT_WORD, PRIORITY_TONE, PRIORITY_WORD, SOURCE_TIP, SOURCE_WORD } from "./look";

/** Small marks the page's tables share. */

export function LangMark({ lang }: { lang: string | null }) {
  if (!lang) return null;
  return (
    <span className={cx("dk-seo-gaps-lang", lang === "de" && "dk-seo-gaps-lang--de")} title={lang === "de" ? "German" : lang === "en" ? "English" : lang}>
      {lang.toUpperCase()}
    </span>
  );
}

export function PriorityMark({ priority }: { priority: Priority }) {
  return (
    <span className={cx("dk-seo-gaps-prio", `dk-tone-${PRIORITY_TONE[priority]}`)} title="The audit's judgement of whether a young site can win it, or a person's: not a measured figure.">
      <span className="dk-seo-gaps-prio-dot" aria-hidden />
      {PRIORITY_WORD[priority]}
      <span className="dk-sr"> priority</span>
    </span>
  );
}

export function IntentChip({ intent }: { intent: Intent | null }) {
  if (!intent) return <span className="dk-seo-gaps-quiet">{DASH}</span>;
  return (
    <Chip tone={INTENT_TONE[intent]} className="dk-seo-gaps-intent">
      {INTENT_WORD[intent]}
    </Chip>
  );
}

/** Price, question and local: what the phrase asks, by its words. */
export function Flags({ flags }: { flags: GapKeyword["flags"] }) {
  return (
    <>
      {flags.price ? <span className="dk-seo-gaps-flag dk-seo-gaps-flag--price">Price</span> : null}
      {flags.question ? <span className="dk-seo-gaps-flag">Question</span> : null}
      {flags.local ? <span className="dk-seo-gaps-flag">Local</span> : null}
    </>
  );
}

/** Where a phrase was found: Autocomplete is the proof that people search it. */
export function Sources({ sources }: { sources: KeywordSource[] }) {
  if (!sources.length) return <span className="dk-seo-gaps-quiet">{DASH}</span>;
  return (
    <span className="dk-seo-gaps-sources">
      {sources.map((s) => (
        <span key={s} className={cx("dk-seo-gaps-source", `dk-seo-gaps-source--${s}`)} title={SOURCE_TIP[s]}>
          {SOURCE_WORD[s]}
        </span>
      ))}
    </span>
  );
}

/** A brief that cannot be asked now: where it stands, or why. */
export function BriefMark({ brief }: { brief: BriefState }) {
  if (brief.task) {
    const busy = brief.task.state === "queued" || brief.task.state === "running";
    return (
      <Go href={brief.task.href} className={cx("dk-seo-gaps-brief", busy ? "dk-seo-gaps-brief--busy" : brief.task.state === "done" ? "dk-seo-gaps-brief--done" : "dk-seo-gaps-brief--bad")} title={brief.note ?? brief.why ?? undefined}>
        <Icon name={busy ? "clock" : brief.task.state === "done" ? "check-circle" : "alert"} size={12} />
        {busy ? `Brief ${brief.task.state} · #${brief.task.id}` : brief.task.state === "done" ? `Brief ready · #${brief.task.id}` : `Brief ${brief.task.state} · #${brief.task.id}`}
      </Go>
    );
  }
  return (
    <span className="dk-seo-gaps-brief dk-seo-gaps-brief--quiet" title={brief.why ?? undefined}>
      {brief.state === "done" ? "Done" : brief.state === "dismissed" ? "Dismissed" : "Not now"}
    </span>
  );
}

/** A row's action: "Create brief" while it can be asked, else where its brief stands. */
export function RowBrief({ k, label = "Create brief" }: { k: GapKeyword; label?: string }) {
  if (!k.brief || !k.cluster) {
    return (
      <span className="dk-seo-gaps-quiet" title="The phrase belongs to no cluster: file it under one in Keywords to brief it.">
        {DASH}
      </span>
    );
  }
  if (!k.brief.available) return <BriefMark brief={k.brief} />;
  return (
    <BriefButton
      cluster={k.cluster.key}
      phrases={[k.id]}
      label={label}
      title={`A brief for a page on “${k.phrase}”, filed under its topic “${k.cluster.name}”: one page answers a topic, so the topic's other rows show this brief once it is queued. The operator writes it on the studio workstation; a person writes and publishes the page.`}
    />
  );
}

/** Impressions in a cell: the number, or a dash that says why. */
export function Impressions({ n, position }: { n: number | null; position?: number | null }) {
  if (n === null) return <span className="dk-seo-gaps-quiet" title="Google has not shown the site for it in the period.">{DASH}</span>;
  return (
    <span className="dk-num" title={position != null ? `Average position ${num(position, 1)}` : undefined}>
      {num(n)}
    </span>
  );
}

/**
 * A competitor page's length. The reader counts the words of the html it is
 * sent; nought means it could not read the text (a page that builds its text
 * in the browser, or answers with an empty shell), not a page without words.
 */
export function Words({ n }: { n: number | null }) {
  if (!n) {
    return (
      <span className="dk-seo-gaps-quiet" title={n === 0 ? "Not readable: the reader found no text in the page it was sent (it may build its text in the browser)." : "Not read."}>
        {DASH}
      </span>
    );
  }
  return <>{num(n)}</>;
}

/** "1–50 of 400", with the pages before and after as links. */
export function Pager({ total, offset, limit, href }: { total: number; offset: number; limit: number; href: (offset: number) => string }) {
  if (total <= limit) return null;
  const last = Math.min(total, offset + limit);
  return (
    <nav className="dk-seo-gaps-pager" aria-label="Pages of the table">
      <span className="dk-num">
        {num(offset + 1)}–{num(last)} of {num(total)}
      </span>
      {offset > 0 ? (
        <Go href={href(Math.max(0, offset - limit))} className="dk-seo-gaps-pager-link" scroll={false}>
          <Icon name="chevron-left" size={14} />
          Previous
        </Go>
      ) : null}
      {last < total ? (
        <Go href={href(offset + limit)} className="dk-seo-gaps-pager-link" scroll={false}>
          Next
          <Icon name="chevron-right" size={14} />
        </Go>
      ) : null}
    </nav>
  );
}
