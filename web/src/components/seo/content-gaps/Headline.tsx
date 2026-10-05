import type { ReactNode } from "react";
import type { Reading, Stat } from "@/contract/common";
import type { OpportunityRow, OwnerTaskRow } from "@/contract/seo/common";
import type { ClusterRow, GapTiles, GermanGap, PriceGap } from "@/contract/seo/content-gaps";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Info } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { DASH, num } from "@/lib/format";
import { StepButton } from "./Act";
import { BriefCell, LangMark } from "./Bits";
import { bare, coverText, hrefFresh, plural, shareText } from "./look";

/**
 * The two largest gaps, in one band above the view switch (the owner's
 * brief: make them obvious), kept low so the board's list and open group
 * still begin on the first screen: the market searches in German and the
 * site has no German page; buyers ask the price and few pages state one.
 * Each says its figure, one line, and where to start, with the audit's steps
 * folded under it.
 *
 * Every figure is a count from the keyword table, the crawl or the readiness
 * check: phrases are counted, never weighed by a search volume nobody gives.
 */
export function Headline({ german, price, base }: { german: Reading<GermanGap>; price: Reading<PriceGap>; base: Record<string, string> }) {
  return (
    <div className="dk-seo-gaps-headline">
      <GermanCard reading={german} base={base} />
      <PriceCard reading={price} base={base} />
    </div>
  );
}

/** A two-part bar with its key on the same line: the part, then the rest, each with its own tone. */
function Split({ parts, label }: { parts: { value: number; tone: "violet" | "info" | "bad" | "good" | "quiet" | "warn"; name: string }[]; label: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div className="dk-seo-gaps-split">
      <span className="dk-seo-gaps-split-bar" role="img" aria-label={label}>
        {parts.map((p) =>
          p.value ? <span key={p.name} className={cx("dk-seo-gaps-split-part", `dk-tone-${p.tone}`)} style={{ flexGrow: total ? p.value / total : 0 }} /> : null,
        )}
      </span>
      <span className="dk-seo-gaps-split-legend">
        {parts.map((p) => (
          <span key={p.name} className="dk-seo-gaps-split-key">
            <span className={cx("dk-seo-gaps-split-dot", `dk-tone-${p.tone}`)} aria-hidden />
            {p.name} <b className="dk-num">{num(p.value)}</b>
          </span>
        ))}
      </span>
    </div>
  );
}

/** "Start with": the cluster to answer first, with its brief (or where its brief stands), on one line. */
function StartWith({ c, label = "Start with", phrases, why, base }: { c: ClusterRow | undefined; label?: string; phrases: string; why: string; base: Record<string, string> }) {
  if (!c) return null;
  return (
    <div className="dk-seo-gaps-start">
      <span className="dk-seo-gaps-start-label">{label}</span>
      <Go className="dk-seo-gaps-start-name" href={hrefFresh(base, { view: "clusters", open: c.key })} title={`${phrases}${c.rank ? ` · #${c.rank} in the audit's order of attack` : ""}`}>
        {bare(c.name)}
      </Go>
      <LangMark lang={c.lang} />
      <span className="dk-seo-gaps-start-meta dk-num">{phrases}</span>
      <BriefCell brief={c.brief} cluster={c.key} title={why} />
    </div>
  );
}

/**
 * The audit's site-wide steps, folded: each with what can be done with it
 * here. A brief is queued for the operator; a change to the website's code
 * goes on the to-do list once (from open); the owner's steps say so.
 */
function Steps({ steps, label }: { steps: OpportunityRow[]; label: string }) {
  if (!steps.length) return null;
  return (
    <details className="dk-seo-gaps-steps">
      <summary>
        <Icon name="chevron-right" size={14} />
        <span>
          {label} ({steps.length})
        </span>
      </summary>
      <ul className="dk-seo-gaps-steps-list">
        {steps.map((s) => {
          const open = s.state.state === "open";
          const can = s.action.available && (s.action.kind === "brief" || s.action.kind === "proposal" || (s.action.kind === "code" && open));
          const t = s.state.task;
          /* The operator wrote it: the link to read it comes first, and asking again is a quiet choice beside it, never the same button as before. */
          const written = !!t && t.state === "done" && (s.action.kind === "brief" || s.action.kind === "proposal");
          return (
            <li key={s.id} className="dk-seo-gaps-step">
              <span className="dk-seo-gaps-step-text">
                <span className="dk-seo-gaps-step-title">{s.title}</span>
                <span className="dk-seo-gaps-step-meta">
                  {s.action.kind === "code"
                    ? "A change to the website's code"
                    : s.action.kind === "brief"
                      ? "The operator writes a brief"
                      : s.action.kind === "proposal"
                        ? "The operator proposes a title and description"
                        : s.action.kind === "owner"
                          ? "Only the owner"
                          : "By hand, in the owner's browser"}
                  {!open ? ` · ${s.state.note ?? s.state.state}` : ""}
                </span>
              </span>
              {written ? (
                <span className="dk-seo-gaps-briefcell">
                  <Go className="dk-seo-gaps-brief dk-seo-gaps-brief--done" href={t!.href} title={s.state.note ?? undefined}>
                    <Icon name="check-circle" size={12} />
                    {s.action.kind === "proposal" ? "Proposal ready" : "Brief ready"} · #{t!.id}
                  </Go>
                  {can ? <StepButton id={s.id} label="Ask again" title={`Operator task #${t!.id} is written already; this asks for a new one. ${s.action.step}`} /> : null}
                </span>
              ) : can ? (
                <StepButton
                  id={s.id}
                  label={s.action.kind === "code" ? "Put on the to-do list" : s.action.kind === "proposal" ? "Ask for a proposal" : "Write a brief"}
                  title={s.action.step}
                />
              ) : t ? (
                <Go className="dk-seo-gaps-step-state" href={t.href}>
                  Task #{t.id} {t.state}
                </Go>
              ) : (
                <Go className="dk-seo-gaps-step-state" href={`/seo/opportunities?open=${encodeURIComponent(s.id)}`}>
                  {s.action.kind === "owner" || s.action.kind === "chrome" ? "Mark it done with its task" : open ? (s.action.why ?? "In Opportunities") : "In Opportunities"}
                </Go>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** A large card without the panel head: an eyebrow line carries its name, its (i), its stamp and its link. */
function Big({
  kind,
  icon,
  name,
  rank,
  info,
  reading,
  aside,
  link,
  children,
}: {
  kind: "german" | "price";
  icon: IconName;
  name: string;
  rank: string;
  info: string;
  reading: Reading<unknown>;
  aside?: ReactNode;
  link: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cx("dk-card dk-seo-gaps-big", `dk-seo-gaps-big--${kind}`)} aria-label={`${name}: ${rank}`}>
      <header className="dk-seo-gaps-big-head">
        <span className="dk-seo-gaps-big-eyebrow">
          <Icon name={icon} size={16} />
          <span className="dk-seo-gaps-big-name">{name}</span>
          <span className="dk-seo-gaps-big-rank">{rank}</span>
          <Info text={info} />
        </span>
        <span className="dk-seo-gaps-big-links">
          {reading.state === "ok" ? aside : null}
          <Stamp reading={reading} />
          {reading.state === "ok" ? link : null}
        </span>
      </header>
      {reading.state === "ok" ? <div className="dk-seo-gaps-big-body">{children}</div> : <Absent reading={reading} />}
    </section>
  );
}

function GermanCard({ reading, base }: { reading: Reading<GermanGap>; base: Record<string, string> }) {
  const g = reading.state === "ok" ? reading.value : null;
  return (
    <Big
      kind="german"
      icon="globe"
      name="German"
      rank="the largest gap"
      reading={reading}
      info="Relevant phrases of the keyword table (the SEO audit's research, Search Console and Google Autocomplete) by the language they are searched in: distinct phrases counted, not weighed by a search volume no free source gives. The site's pages by the language their html declares, as the crawl read them; hreflang by the readiness check. Impressions: Search Console's, for the site, in the period."
      link={
        <LinkButton href={hrefFresh(base, { view: "language", open: "de" })} size="xs" variant="quiet" iconRight="arrow-right">
          German gaps
        </LinkButton>
      }
    >
      {g ? (
        <>
          <div className="dk-seo-gaps-big-figures">
            <p className="dk-seo-gaps-big-figure">
              <b className="dk-num">{shareText(g.phrases.de, g.phrases.total)}</b>
              <span>
                of relevant phrases are German
                <small className="dk-num">
                  {num(g.phrases.de)} of {num(g.phrases.total)} distinct phrases
                </small>
              </span>
            </p>
            <p className="dk-seo-gaps-big-side">
              <span className="dk-seo-gaps-big-side-label">The site</span>
              <b className="dk-num">
                {num(g.pages.de)} <small>of {num(g.pages.total)}</small>
              </b>
              <span>
                pages in German
                {g.pages.hreflang !== null ? <span className="dk-seo-gaps-nowrap"> · {num(g.pages.hreflang)} linked by hreflang</span> : null}
              </span>
            </p>
          </div>
          <Split
            label={`${num(g.phrases.de)} German and ${num(g.phrases.en)} English relevant phrases`}
            parts={[
              { value: g.phrases.de, tone: "violet", name: "German" },
              { value: g.phrases.en, tone: "info", name: "English" },
              ...(g.phrases.other ? [{ value: g.phrases.other, tone: "quiet" as const, name: "Not known" }] : []),
            ]}
          />
          <p className="dk-seo-gaps-big-line">
            <b className="dk-num">
              {num(g.clusters.gaps)} of {num(g.clusters.de)}
            </b>{" "}
            <span title="A cluster is one topic in one language, as the keyword table files the phrases.">German clusters</span> have no German page.
            {g.impressions ? (
              <>
                {" "}
                <span title="Search Console impressions in the period: how often Google showed the site for the keyword table's German and English phrases.">
                  Shown in Google <b className="dk-num">{num(g.impressions.de)}</b> time{g.impressions.de === 1 ? "" : "s"} for German phrases, <b className="dk-num">{num(g.impressions.en)}</b> for English.
                </span>
              </>
            ) : null}
          </p>
          <div className="dk-seo-gaps-big-act">
            <StartWith
              c={g.top[0]}
              base={base}
              phrases={g.top[0] ? plural(g.top[0].keywords.relevant, "phrase") : ""}
              why="The operator writes the brief for a German (de-CH) page on this topic, from its searches. A person writes and publishes the page."
            />
            <Steps steps={g.steps} label="The audit's German steps" />
          </div>
        </>
      ) : null}
    </Big>
  );
}

function PriceCard({ reading, base }: { reading: Reading<PriceGap>; base: Record<string, string> }) {
  const p = reading.state === "ok" ? reading.value : null;
  return (
    <Big
      kind="price"
      icon="tag"
      name="Price questions"
      rank="the next: “was kostet …”"
      aside={p?.owner ? <OwnerLink task={p.owner} /> : null}
      reading={reading}
      info="A phrase asks a price when it carries kosten, kostet, preis, price, cost, how much, tarif, budget or CHF: distinct phrases counted, not weighed by a volume. Answered: the keyword table maps it to a page of its own language. The site's prices: the readiness check's CHF test on the service and landing pages it applies to. Competitors: only the pages that ranked for the same searches; a home page, read when the capture named only the site, is not how a competitor answers the search and is not counted."
      link={
        <LinkButton href={hrefFresh(base, { view: "keywords", price: "1" })} size="xs" variant="quiet" iconRight="arrow-right">
          Price phrases
        </LinkButton>
      }
    >
      {p ? (
        <>
          <div className="dk-seo-gaps-big-figures">
            <p className="dk-seo-gaps-big-figure">
              <b className="dk-num">{num(p.phrases.total)}</b>
              <span>
                relevant phrases ask a price
                <small className="dk-num">
                  {shareText(p.phrases.total, p.relevant)} of all · {num(p.phrases.de)} German · {num(p.phrases.questions)} questions
                </small>
              </span>
            </p>
            <p className="dk-seo-gaps-big-side">
              <span className="dk-seo-gaps-big-side-label">The site</span>
              {p.pricedPages ? (
                <>
                  <b className="dk-num">
                    {num(p.pricedPages.count)} <small>of {num(p.pricedPages.of)}</small>
                  </b>
                  <span title={p.pricedPages.paths.join(", ")}>service pages state a CHF price</span>
                </>
              ) : (
                <>
                  <b className="dk-num">{DASH}</b>
                  <span>the readiness check has not read the pages yet</span>
                </>
              )}
            </p>
          </div>
          <Split
            label={`${num(p.phrases.covered)} of ${num(p.phrases.total)} price phrases have a page of their language`}
            parts={[
              { value: p.phrases.total - p.phrases.covered, tone: "bad", name: "No page" },
              { value: p.phrases.covered, tone: "good", name: "Answered" },
            ]}
          />
          <p className="dk-seo-gaps-big-line">
            <b className="dk-num">
              {num(p.clusters.gaps)} of {num(p.clusters.total)}
            </b>{" "}
            price clusters have no page in their language.
            {p.competitors ? (
              <>
                {" "}
                {p.competitors.ranking ? (
                  <span title={`The competitor pages that ranked for the same searches, and how many of them state a price.${p.competitors.home ? ` ${plural(p.competitors.home, "home page")} read as well are not counted: a home page is not how a competitor answers the search.` : ""}`}>
                    Competitors: <b className="dk-num">{num(p.competitors.priced)}</b> of {plural(p.competitors.ranking, "ranking page")} read state one.
                  </span>
                ) : (
                  <span className="dk-seo-gaps-quiet" title="The capture named the competitors without the address that ranked, so only their home pages were read: those do not say how they answer a price question.">
                    Competitors: no ranking page read yet ({plural(p.competitors.home, "home page")} only).
                  </span>
                )}
              </>
            ) : null}
          </p>
          <div className="dk-seo-gaps-big-act">
            <StartWith
              c={p.top[0]}
              base={base}
              phrases={p.top[0] ? plural(p.top[0].price, "price phrase") : ""}
              why="The topic with the most price phrases and no page of its language. The operator writes the brief for the page that answers them, from its searches; the prices themselves are the owner's to give. A person writes and publishes the page."
            />
            <Steps steps={p.steps} label="The audit's price steps" />
          </div>
        </>
      ) : null}
    </Big>
  );
}

/** The owner's price task, as a link to its row in "Needs you" below, where it is marked done. */
function OwnerLink({ task }: { task: OwnerTaskRow }) {
  return (
    <a className="dk-seo-gaps-owner-link" href="#needs-you" title={`${task.title}. The exact step and “I have done it” are under Needs you.`}>
      <Chip tone={task.done ? "good" : "warn"} icon={task.done ? "check" : "user"}>
        {task.done ? "Prices given" : "Needs you"}
      </Chip>
    </a>
  );
}

/** One figure of the whole table, as a sentence part: "7 of 20 topics have no page". */
function Part({ reading, children }: { reading: Reading<Stat>; children: (s: Stat) => ReactNode }) {
  if (reading.state !== "ok") return <Absent reading={reading} form="inline" />;
  return <>{children(reading.value)}</>;
}

/**
 * The coverage of the whole keyword table, beside the view switch: what the
 * coverage list breaks down. The German and price figures are in the cards.
 */
export function TableCoverage({ tiles, unjudged }: { tiles: GapTiles; unjudged: { count: number; href: string } | null }) {
  const first = [tiles.gaps, tiles.mappedPhrases, tiles.clusters].find((r) => r.state === "ok");
  const sub = tiles.clusters.state === "ok" ? tiles.clusters.value.sub : undefined;
  return (
    <p className="dk-seo-gaps-table">
      <span className="dk-seo-gaps-start-label">Whole table</span>
      <span>
        <Part reading={tiles.gaps}>
          {(s) => (
            <>
              <b className="dk-num">{s.of !== undefined ? coverText(s.value, s.of).main : num(s.value)}</b> clusters have no page of their language
            </>
          )}
        </Part>
      </span>
      <span aria-hidden>·</span>
      <span>
        <Part reading={tiles.mappedPhrases}>
          {(s) => {
            const t = s.of !== undefined ? coverText(s.value, s.of) : null;
            return (
              <>
                <b className="dk-num">{t ? t.main : num(s.value)}</b> phrases have one{t?.share ? <span className="dk-num"> ({t.share})</span> : null}
              </>
            );
          }}
        </Part>
      </span>
      {/* Finds wait for a person: this page counts relevant phrases only, so a phrase found and not judged adds no gap until somebody judges it. */}
      {unjudged && unjudged.count ? (
        <>
          <span aria-hidden>·</span>
          <Go className="dk-seo-gaps-table-link" href={unjudged.href} title="Phrases Search Console and Google Autocomplete found that nobody has judged yet. This page counts relevant phrases only: judge them in Keywords, or a search Google reports in From Search Console here.">
            <b className="dk-num">{num(unjudged.count)}</b> new {unjudged.count === 1 ? "phrase waits" : "phrases wait"} to be judged
          </Go>
        </>
      ) : null}
      <Info
        text={`A cluster (one topic in one language) is a gap when it holds a relevant phrase and no page of its own language answers it. A phrase is answered when the keyword table maps it to a page of its language: the audit's mapping, a person's, or the desk's rule. All counted, never weighed.${sub ? ` Clusters: ${sub}.` : ""}`}
      />
      {first ? <Stamp reading={first} /> : null}
    </p>
  );
}
