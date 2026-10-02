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
import { BriefButton, StepButton } from "./Act";
import { BriefMark, LangMark } from "./Bits";
import { BASE, bare, coverText, plural, shareText } from "./look";

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
export function Headline({ german, price }: { german: Reading<GermanGap>; price: Reading<PriceGap> }) {
  return (
    <div className="dk-seo-gaps-headline">
      <GermanCard reading={german} />
      <PriceCard reading={price} />
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

/** "Start with": the cluster to answer first, with its brief, on one line. */
function StartWith({ c, label = "Start with", phrases, why }: { c: ClusterRow | undefined; label?: string; phrases: string; why: string }) {
  if (!c) return null;
  return (
    <div className="dk-seo-gaps-start">
      <span className="dk-seo-gaps-start-label">{label}</span>
      <Go className="dk-seo-gaps-start-name" href={`${BASE}?view=clusters&open=${encodeURIComponent(c.key)}`} title={`${phrases}${c.rank ? ` · #${c.rank} in the audit's order of attack` : ""}`}>
        {bare(c.name)}
      </Go>
      <LangMark lang={c.lang} />
      <span className="dk-seo-gaps-start-meta dk-num">{phrases}</span>
      {c.brief.available ? <BriefButton cluster={c.key} title={why} /> : <BriefMark brief={c.brief} />}
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
              {can ? (
                <StepButton
                  id={s.id}
                  label={s.action.kind === "code" ? "Put on the to-do list" : s.action.kind === "proposal" ? "Ask for a proposal" : "Write a brief"}
                  title={s.action.step}
                />
              ) : s.state.task ? (
                <Go className="dk-seo-gaps-step-state" href={s.state.task.href}>
                  Task #{s.state.task.id} {s.state.task.state}
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

function GermanCard({ reading }: { reading: Reading<GermanGap> }) {
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
        <LinkButton href={`${BASE}?view=language&open=de`} size="xs" variant="quiet" iconRight="arrow-right">
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
            German topics have no German page.
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

function PriceCard({ reading }: { reading: Reading<PriceGap> }) {
  const p = reading.state === "ok" ? reading.value : null;
  return (
    <Big
      kind="price"
      icon="tag"
      name="Price questions"
      rank="the next: “was kostet …”"
      aside={p?.owner ? <OwnerLink task={p.owner} /> : null}
      reading={reading}
      info="A phrase asks a price when it carries kosten, kostet, preis, price, cost, how much, tarif, budget or CHF: distinct phrases counted, not weighed by a volume. Answered: the keyword table maps it to a page of its own language. The site's prices: the readiness check's CHF test on the service and landing pages it applies to. Competitors: the pages the desk read for the same searches."
      link={
        <LinkButton href={`${BASE}?view=keywords&price=1`} size="xs" variant="quiet" iconRight="arrow-right">
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
            price topics have no page in their language.
            {p.competitors ? (
              <>
                {" "}
                <span title="The competitor pages the desk read for the same searches, and how many of them state a price.">
                  Competitors: <b className="dk-num">{num(p.competitors.priced)}</b> of {num(p.competitors.pages)} pages read state one.
                </span>
              </>
            ) : null}
          </p>
          <div className="dk-seo-gaps-big-act">
            <StartWith
              c={p.top[0]}
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
export function TableCoverage({ tiles }: { tiles: GapTiles }) {
  const first = [tiles.gaps, tiles.mappedPhrases, tiles.clusters].find((r) => r.state === "ok");
  const sub = tiles.clusters.state === "ok" ? tiles.clusters.value.sub : undefined;
  return (
    <p className="dk-seo-gaps-table">
      <span className="dk-seo-gaps-start-label">Whole table</span>
      <span>
        <Part reading={tiles.gaps}>
          {(s) => (
            <>
              <b className="dk-num">{s.of !== undefined ? coverText(s.value, s.of).main : num(s.value)}</b> topics have no page
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
      <Info
        text={`A topic cluster is a gap when it holds a relevant phrase and no page of its own language answers it. A phrase is answered when the keyword table maps it to a page of its language: the audit's mapping, a person's, or the desk's rule. All counted, never weighed.${sub ? ` Clusters: ${sub}.` : ""}`}
      />
      {first ? <Stamp reading={first} /> : null}
    </p>
  );
}
