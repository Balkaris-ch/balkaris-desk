import type { ReactNode } from "react";
import type { Priority } from "@/contract/seo/common";
import type { BriefState, GapKeyword, GapQuery, GapSort } from "@/contract/seo/content-gaps";
import type { Intent, KeywordSource } from "@/contract/seo/keywords";
import { Chip } from "@/components/ui/Badge";
import type { ButtonSize } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { DASH, num } from "@/lib/format";
import { BriefButton } from "./Act";
import { hrefWith, INTENT_TONE, INTENT_WORD, LIMITS, PRIORITY_TONE, PRIORITY_WORD, sortHref, SOURCE_TIP, SOURCE_WORD } from "./look";

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

/**
 * Which page of a competitor the desk read. A home page was read because the
 * capture named the site without the address that ranked: what it says is
 * what the site is, not how it answers the search, and the mark says so.
 */
export function PageKind({ address }: { address: "ranking" | "home" }) {
  return address === "ranking" ? (
    <span className="dk-seo-gaps-flag dk-seo-gaps-flag--ranking" title="The address that was in the captured results for the search.">
      Ranking page
    </span>
  ) : (
    <span className="dk-seo-gaps-flag" title="The site's home page, read because the capture named the site and not the address that ranked. Its words, language and price are the home page's, not the answer to the search.">
      Home page
    </span>
  );
}

/** Where a brief stands, as a link to its operator task; or why none can be asked. */
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

/**
 * A cluster's brief, wherever the page offers it. Never asked: the button.
 * Queued or running: where it stands. Written: the link to read it, with a
 * quiet "Ask again" beside it, so a finished brief is never drawn as if none
 * existed. Failed or stopped: that, and the button to try again.
 */
export function BriefCell({
  brief,
  cluster,
  phrases,
  label = "Create brief",
  title,
  size = "xs",
  under,
}: {
  brief: BriefState;
  cluster: string;
  phrases?: number[];
  label?: string;
  title: string;
  size?: ButtonSize;
  under?: boolean;
}) {
  if (!brief.available) return <BriefMark brief={brief} />;
  if (!brief.task) return <BriefButton cluster={cluster} phrases={phrases} label={label} title={title} size={size} under={under} />;
  return (
    <span className={cx("dk-seo-gaps-briefcell", under && "dk-seo-gaps-briefcell--under")}>
      <BriefMark brief={brief} />
      <BriefButton
        cluster={cluster}
        phrases={phrases}
        label={brief.ready ? "Ask again" : "Try again"}
        variant="quiet"
        icon="refresh"
        size="xs"
        title={brief.ready ? `A brief is written already (operator task #${brief.task.id}). This asks the operator for a new one; the first stays in AI Operator. ${title}` : `The last brief did not finish. ${title}`}
        under={under}
      />
    </span>
  );
}

/** A row's action: "Create brief" while none is asked, else where its cluster's brief stands. */
export function RowBrief({ k, label = "Create brief" }: { k: GapKeyword; label?: string }) {
  if (!k.brief || !k.cluster) {
    return (
      <span className="dk-seo-gaps-quiet" title="The phrase belongs to no cluster: file it under one in Keywords to brief it.">
        {DASH}
      </span>
    );
  }
  return (
    <BriefCell
      brief={k.brief}
      cluster={k.cluster.key}
      phrases={[k.id]}
      label={label}
      title={`The brief for the page that answers its topic “${k.cluster.name}”, with “${k.phrase}” named first and the topic's other missing phrases after it: one page answers a topic, so the topic's other rows show this brief once it is queued. The operator writes it on the studio workstation; a person writes and publishes the page.`}
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

/**
 * A column's head in a table the SERVER orders: a link, so the order covers
 * every row of the list and not only the rows on this page, and is part of
 * the address. `first` marks the column the table is ordered by when the
 * address names none.
 */
export function SortHead({ label, sort, asked, base, first, title }: { label: ReactNode; sort: GapSort; asked: GapQuery; base: Record<string, string>; first?: boolean; title?: string }) {
  const on = asked.sort ? asked.sort === sort : !!first;
  return (
    <Go href={sortHref(base, asked, sort, on)} scroll={false} replace className={cx("dk-table-sort", on && "dk-table-sort--on")} title={title ?? "Order the whole list by this column"} aria-label={`Order by this column${on ? `, now ${asked.dir === "asc" ? "ascending" : "descending"}` : ""}`}>
      <span>{label}</span>
      <Icon name={on ? (asked.dir === "asc" ? "arrow-up" : "arrow-down") : "sort"} size={12} />
    </Go>
  );
}

/** "1–50 of 400", the pages before and after as links, and how many rows a page holds. */
export function Pager({ total, offset, limit, href, base }: { total: number; offset: number; limit: number; href: (offset: number) => string; base?: Record<string, string> }) {
  /* Nothing to page and nothing to choose: the smallest size already shows every row. */
  if (total <= LIMITS[0] && total <= limit) return null;
  const last = Math.min(total, offset + limit);
  return (
    <nav className="dk-seo-gaps-pager" aria-label="Pages of the table">
      {base ? (
        <span className="dk-seo-gaps-pager-sizes">
          <span>Rows</span>
          {LIMITS.map((n) => (
            <Go
              key={n}
              href={hrefWith(base, { limit: n === LIMITS[0] ? null : String(n), offset: null })}
              className={cx("dk-seo-gaps-pager-size", limit === n && "dk-seo-gaps-pager-size--on")}
              aria-current={limit === n ? "true" : undefined}
              title={`Show ${n} rows a page`}
              scroll={false}
              replace
            >
              {n}
            </Go>
          ))}
        </span>
      ) : null}
      <span className="dk-num">
        {num(Math.min(offset + 1, total))}–{num(last)} of {num(total)}
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

/** The search in force, said above a table it narrows, with the way out of it. */
export function Found({ q, base, what }: { q: string; base: Record<string, string>; what: string }) {
  if (!q) return null;
  return (
    <p className="dk-seo-gaps-found">
      <Icon name="search" size={13} />
      <span>
        Only {what} carrying “{q}”.
      </span>
      <Go href={hrefWith(base, { q: null, offset: null })} scroll={false} replace className="dk-seo-gaps-found-clear">
        Show all
      </Go>
    </p>
  );
}
