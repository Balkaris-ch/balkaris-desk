import type { ReactNode } from "react";
import type { ProposalRow } from "@/contract/operator";
import type { Evidence, OperatorPanel, OpportunityRow, Rate } from "@/contract/seo/common";
import type { OpportunityDetail, Outcome, OutcomeSpan, SeoOpportunitiesPayload, Serp } from "@/contract/seo/opportunities";
import { Badge, Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { InspectNowButton } from "@/components/seo/google/actions";
import { StatusDot } from "@/components/ui/StatusDot";
import { Tabs } from "@/components/ui/Tabs";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { ago, DASH, fullDate, num, percent, shortDate, sourceLabel } from "@/lib/format";
import { ActButton, Decide, OwnerDone } from "./Act";
import { ActionCell } from "./OppList";
import { actionEffect, actionLabel, gain, hrefWith, noEstimate, ownerStep, pos, PRIORITY_LABEL, PRIORITY_TONE, quoted, STATE_LABEL, STATE_TONE, times, TYPE_ICON } from "./look";
import { PositionChart } from "./PositionChart";

export type DetailTab = "analysis" | "ai" | "actions" | "history";
export const DETAIL_TABS: DetailTab[] = ["analysis", "ai", "actions", "history"];

/**
 * "Opportunity Details" (boards 111 and 114): one opportunity with everything
 * the desk knows about its subject. The head's four figures are Search
 * Console's over the head's range (the estimate is ours, and says so); the
 * tabs are its evidence and position history, the operator's suggestions and
 * the result as Google would show it, its actions, and what was done.
 */
export function OppDetail({ data, base, tab }: { data: SeoOpportunitiesPayload; base: Record<string, string>; tab: DetailTab }) {
  const s = data.selected;
  if (!s) {
    return (
      <Card className="dk-seo-opps-detail" title="Opportunity details" icon="lightbulb">
        <p className="dk-seo-opps-lead">Nothing is selected: the list is empty with these filters.</p>
      </Card>
    );
  }
  if (s.state !== "ok") {
    return (
      <Card className="dk-seo-opps-detail" title="Opportunity details" icon="lightbulb">
        <Absent reading={s} />
      </Card>
    );
  }
  const d = s.value;
  const o = d.opportunity;
  const page = o.subject.page;
  const to = (t: DetailTab) => hrefWith(base, { open: o.id, tab: t === "analysis" ? undefined : t });
  return (
    <Card
      className="dk-seo-opps-detail"
      id="detail"
      title="Opportunity details"
      right={
        <Tooltip text={o.priorityWhy}>
          <span tabIndex={0}>
            <Badge tone={PRIORITY_TONE[o.priority]} icon="flag">
              {PRIORITY_LABEL[o.priority]} priority
            </Badge>
          </span>
        </Tooltip>
      }
      footer={<Foot o={o} owner={data.viewer.owner} />}
    >
      <div className="dk-seo-opps-detail-head">
        <h3 className="dk-seo-opps-detail-title">{o.title}</h3>
        <p className="dk-seo-opps-detail-subject">
          <Chip icon={TYPE_ICON[o.type]}>{o.typeLabel}</Chip>
          {page ? (
            <Go href={`/seo/pages/view?path=${encodeURIComponent(page.path)}`} className="dk-seo-opps-detail-path" title={page.title ?? undefined}>
              {page.path === "/" ? "/ (the home page)" : page.path}
            </Go>
          ) : null}
          {o.subject.keyword ? <span className="dk-seo-opps-kw">{quoted(o.subject.keyword)}</span> : null}
          {o.subject.cluster && !o.subject.keyword ? <span className="dk-seo-opps-kw dk-seo-opps-kw--topic">{o.subject.cluster.name}</span> : null}
          {o.state.state !== "open" ? (
            <Badge tone={STATE_TONE[o.state.state]} dot>
              {STATE_LABEL[o.state.state]}
            </Badge>
          ) : null}
          {!o.active ? (
            <Tooltip text={o.clearedWhy ?? "The rules no longer find it."}>
              <span tabIndex={0}>
                <Badge tone="quiet">No longer found</Badge>
              </span>
            </Tooltip>
          ) : null}
        </p>
        {d.lookups.length ? <Lookups d={d} /> : null}
      </div>
      <Figures d={d} rank={data.rank} />
      <Tabs
        size="sm"
        label="About this opportunity"
        active={tab}
        className="dk-seo-opps-tabs"
        items={[
          { key: "analysis", label: "Analysis", href: to("analysis") },
          { key: "ai", label: "AI suggestions", href: to("ai"), count: d.proposals.length || null },
          { key: "actions", label: "Actions", href: to("actions") },
          { key: "history", label: "History", href: to("history") },
        ]}
      />
      <div className="dk-seo-opps-tabbody">
        {tab === "analysis" ? <Analysis d={d} rank={data.rank} /> : null}
        {tab === "ai" ? <Suggestions d={d} operator={data.operator} /> : null}
        {tab === "actions" ? <Actions o={o} owner={data.viewer.owner} /> : null}
        {tab === "history" ? <History d={d} /> : null}
      </div>
    </Card>
  );
}

/**
 * The results as the public sees them, in a new tab: the opportunity's search
 * (or its topic's busiest phrase) in Google and Bing for Switzerland. Links
 * only; the desk reads nothing from those pages.
 */
function Lookups({ d }: { d: OpportunityDetail }) {
  const phrase = d.lookups[0]!.phrase;
  const own = !!d.opportunity.subject.keyword;
  return (
    <p className="dk-seo-opps-lookups">
      <Tooltip
        text={
          own
            ? `Opens the results for ${quoted(phrase)} as a searcher in Switzerland sees them, without personal results. The desk reads nothing from them.`
            : `One phrase of the topic: the one Google showed the site for most in the range, else its first relevant one. Opens its results as a searcher in Switzerland sees them. The desk reads nothing from them.`
        }
      >
        <span className="dk-seo-opps-quiet" tabIndex={0}>
          Who ranks for {quoted(phrase)}:
        </span>
      </Tooltip>
      {d.lookups.map((l) => (
        <Go key={l.engine} href={l.href} className="dk-seo-opps-lookup">
          {l.label}
          <Icon name="external" size={12} />
        </Go>
      ))}
    </p>
  );
}

/* ---------- the four figures -------------------------------------------------------------------- */

const rateText = (r: Rate): string => (r.value === null ? DASH : r.small ? `${num(r.num)} of ${num(r.den)}` : percent(r.value, 1));

function Figures({ d, rank }: { d: OpportunityDetail; rank: SeoOpportunitiesPayload["rank"] }) {
  const p = d.opportunity.potential;
  const f = d.figures.state === "ok" ? d.figures.value : null;
  const window = rank.state === "ok" ? `${shortDate(rank.value.start)} – ${shortDate(rank.value.end)}` : null;
  return (
    <div className="dk-seo-opps-figs">
      {f ? (
        <>
          <Fig label={f.of === "cluster" ? "Position" : "Current position"} tip={f.of === "cluster" ? "A cluster has no one position: each phrase has its own, in Keyword cluster below." : `Google's average position for ${f.label}, ${window ?? "the window"}.`}>
            {f.position === null && f.of !== "cluster" ? <span className="dk-seo-opps-fig-word">not shown</span> : <b className="dk-num">{f.position === null ? DASH : pos(f.position)}</b>}
            <PositionMove now={f.position} before={f.previousPosition} compared={rank.state === "ok" && rank.value.compared} since={rank.state === "ok" ? rank.value.start : null} />
          </Fig>
          <Fig label="CTR" tip={`Clicks out of impressions, ${window ?? "the window"}${f.ctr.small ? ". Fewer than 30 impressions: the counts are shown, not a percentage." : "."}`}>
            <b className="dk-num">{rateText(f.ctr)}</b>
            {f.previousCtr && f.previousCtr.value !== null && f.ctr.value !== null && !f.ctr.small && !f.previousCtr.small ? <Delta value={f.ctr.value} previous={f.previousCtr.value} unit="percent" size="sm" /> : null}
          </Fig>
          <Fig label="Impressions" tip={`Times Google showed ${f.label} in its results, ${window ?? "the window"}. Not search volume: no free source gives that.`}>
            <b className="dk-num">{num(f.impressions.value)}</b>
            <Delta value={f.impressions.value} previous={f.impressions.previous} size="sm" />
          </Fig>
        </>
      ) : (
        <div className="dk-seo-opps-figs-absent">{d.figures.state !== "ok" ? <Absent reading={d.figures} form="panel" /> : null}</div>
      )}
      <Fig label="Est. traffic gain" tip={p ? `Our estimate: ${p.basis}.` : noEstimate(d.opportunity, f?.impressions.value)}>
        <b className={cx("dk-num", p && "dk-seo-opps-gain-figure")}>{p ? `${gain(p.clicksPerMonth)}/mo` : DASH}</b>
        {p ? <span className="dk-seo-opps-fig-note">our estimate</span> : null}
      </Fig>
    </div>
  );
}

/** One of the four figures: its label carries what it is, on hover and for the keyboard. */
function Fig({ label, tip, children }: { label: string; tip: string; children: ReactNode }) {
  return (
    <div className="dk-seo-opps-fig">
      <Tooltip text={tip}>
        <span className="dk-seo-opps-fig-label" tabIndex={0}>
          {label}
        </span>
      </Tooltip>
      <span className="dk-seo-opps-fig-value">{children}</span>
    </div>
  );
}

/** Positions gained since the window before: "↑ 4" when it rose (a smaller number). */
function PositionMove({ now, before, compared, since }: { now: number | null; before: number | null; compared: boolean; since: string | null }) {
  if (now === null || before === null) return compared && now !== null ? <span className="dk-seo-opps-fig-note">{since ? `not shown before ${shortDate(since)}` : "not shown before"}</span> : null;
  const gained = Math.round((before - now) * 10) / 10;
  if (Math.abs(gained) < 0.05) return <span className="dk-seo-opps-fig-note">unchanged</span>;
  return (
    <span className={cx("dk-seo-opps-move", gained > 0 ? "dk-seo-opps-move--up" : "dk-seo-opps-move--down")}>
      <Icon name={gained > 0 ? "arrow-up" : "arrow-down"} size={12} />
      {num(Math.abs(gained), 1)}
      <span className="dk-sr">positions {gained > 0 ? "up" : "down"}, from {pos(before)}</span>
    </span>
  );
}

/* ---------- Analysis ----------------------------------------------------------------------------- */

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="dk-seo-opps-section">
      <header>
        <h4>{title}</h4>
        {right}
      </header>
      {children}
    </section>
  );
}

const asOfText = (e: Evidence): string => (e.asOf ? (/^\d{4}-\d{2}-\d{2}$/.test(e.asOf) ? fullDate(e.asOf) : ago(e.asOf)) : "");

function Analysis({ d, rank }: { d: OpportunityDetail; rank: SeoOpportunitiesPayload["rank"] }) {
  const o = d.opportunity;
  const ranked = d.history.some((h) => h.position !== null);
  return (
    <>
      <Section title="What the desk measured">
        <dl className="dk-seo-opps-evidence">
          {o.evidence.map((e, i) => (
            <div key={`${e.label}-${i}`}>
              <dt>{e.label}</dt>
              <dd>
                <span className="dk-seo-opps-evidence-value">{e.value}</span>
                <span className="dk-seo-opps-evidence-from">
                  {e.source === "none" ? "our assumption" : sourceLabel(e.source)}
                  {asOfText(e) ? ` · ${asOfText(e)}` : ""}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="dk-seo-opps-why">
          <Icon name="flag" size={14} />
          <span>{o.priorityWhy}</span>
        </p>
        {o.early ? <p className="dk-seo-opps-note">An early signal: read from fewer impressions than the rule’s standard floor, so it can move a lot from day to day.</p> : null}
      </Section>
      {d.history.length || rank.state !== "ok" ? (
        <Section title="Position history" right={ranked ? <PosLegend target={d.target} /> : null}>
          {rank.state !== "ok" ? (
            <Absent reading={rank} form="tile" />
          ) : ranked ? (
            <PositionChart days={d.history} target={d.target} label={`Google's average position per day, ${shortDate(rank.value.start)} to ${shortDate(rank.value.end)}`} />
          ) : (
            <p className="dk-seo-opps-note">
              Google did not show it on any day from {fullDate(rank.value.start)} to {fullDate(rank.value.end)}, so there is no position to draw.
            </p>
          )}
        </Section>
      ) : null}
      {d.competing.length ? (
        <Section title="Other pages Google showed for this search">
          <ul className="dk-seo-opps-rows">
            {d.competing.map((c) => (
              <li key={c.page.path}>
                <Go href={`/seo/pages/view?path=${encodeURIComponent(c.page.path)}`} className="dk-seo-opps-path">
                  {c.page.path}
                </Go>
                <span className="dk-num">pos. {pos(c.position)}</span>
                <span className="dk-num dk-seo-opps-quiet">{times(c.impressions)}</span>
              </li>
            ))}
          </ul>
          <p className="dk-seo-opps-note">Two pages of the site showing for one search can hold each other back; one of them should be the answer.</p>
        </Section>
      ) : null}
      {d.competitors.length ? (
        <Section title="Competitor pages captured for this topic">
          <ul className="dk-seo-opps-rows dk-seo-opps-rows--comp">
            {d.competitors.map((c) => (
              <li key={c.url}>
                <Go href={c.url} className="dk-seo-opps-path" title={c.title ?? c.url}>
                  {c.domain}
                </Go>
                <span className="dk-seo-opps-quiet">{c.words !== null ? `${num(c.words)} words` : DASH}</span>
                <span className="dk-seo-opps-quiet">{c.priceStated === null ? DASH : c.priceStated ? "states a price" : "no price"}</span>
              </li>
            ))}
          </ul>
          <p className="dk-seo-opps-note">What each page itself says, read politely once a week. No traffic, rating or link count: no free source gives them.</p>
        </Section>
      ) : null}
    </>
  );
}

function PosLegend({ target }: { target: number | null }) {
  return (
    <span className="dk-seo-opps-legend">
      <span>
        <i className="dk-seo-opps-legend-dot" />
        Position
      </span>
      {target !== null ? (
        <span>
          <i className="dk-seo-opps-legend-dash" />
          Target
        </span>
      ) : null}
    </span>
  );
}

/* ---------- AI suggestions ----------------------------------------------------------------------- */

function Suggestions({ d, operator }: { d: OpportunityDetail; operator: OperatorPanel }) {
  const o = d.opportunity;
  const own = o.action.kind === "proposal" || o.action.kind === "brief";
  const waiting = d.proposals.find((p) => p.state === "waiting") ?? null;
  return (
    <>
      <p className="dk-seo-opps-runner">
        <StatusDot tone={operator.runner.state === "online" ? "good" : "quiet"} pulse={operator.runner.state === "online"} />
        <span>{operator.line}</span>
      </p>
      <Section title="What the operator can write for it">
        {own || d.alternatives.length ? (
          <ul className="dk-seo-opps-ops">
            {own ? (
              <li>
                <div>
                  <b>{o.action.label}</b>
                  <p>{o.action.step}</p>
                </div>
                {o.action.available && o.state.state === "open" ? (
                  <ActButton id={o.id} label={o.action.kind === "proposal" ? "Queue proposal" : "Queue brief"} title={actionEffect(o.action)} size="sm" said="under" icon="sparkles" />
                ) : (
                  <Badge tone={STATE_TONE[o.state.state]} dot>
                    {o.action.why ? "Not now" : STATE_LABEL[o.state.state]}
                  </Badge>
                )}
              </li>
            ) : null}
            {d.alternatives.map((a) => (
              <li key={a.as}>
                <div>
                  <b>{a.label}</b>
                  <p>{a.step}</p>
                  {!a.available && a.why ? <p className="dk-seo-opps-note">{a.why}</p> : null}
                </div>
                {a.available ? <ActButton id={o.id} as={a.as} label={a.as === "metadata" ? "Queue proposal" : "Queue brief"} title={a.step} size="sm" variant="quiet" said="under" icon="sparkles" /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="dk-seo-opps-note">{o.action.kind === "owner" ? "Nothing for the operator: only the owner can do this (Actions says how)." : "Nothing for the operator: this is a step a person takes (Actions says how)."}</p>
        )}
      </Section>
      {d.proposals.length ? (
        <Section title="Proposed titles and descriptions" right={<Go href="/operator?ap=waiting#approvals" className="dk-seo-opps-link">Approvals</Go>}>
          <ul className="dk-seo-opps-proposals">
            {d.proposals.map((p) => (
              <Proposal key={p.id} p={p} />
            ))}
          </ul>
        </Section>
      ) : null}
      {d.serp ? (
        <Section title="Preview (Google result)">
          <SerpPreview serp={d.serp} label="As the page says it now (the crawl)" />
          {waiting && (waiting.after.title !== undefined || waiting.after.description !== undefined) ? (
            <SerpPreview
              serp={{
                ...d.serp,
                title: waiting.shownTitle ?? d.serp.title,
                titleLength: waiting.lengths.title ?? d.serp.titleLength,
                description: waiting.after.description ?? d.serp.description,
                descriptionLength: waiting.lengths.description ?? d.serp.descriptionLength,
              }}
              label={`As proposal #${waiting.id} would make it, once a person approves`}
              proposed
            />
          ) : null}
        </Section>
      ) : (
        <p className="dk-seo-opps-note">No result to preview: {o.subject.page ? "the crawl does not know this address." : "this opportunity has no page yet."}</p>
      )}
    </>
  );
}

const PROPOSAL_TONE: Record<ProposalRow["state"], "warn" | "good" | "bad" | "quiet" | "info"> = { waiting: "warn", approved: "info", applied: "good", rejected: "bad", withdrawn: "quiet" };

function Proposal({ p }: { p: ProposalRow }) {
  return (
    <li>
      <p className="dk-seo-opps-proposal-head">
        <Badge tone={PROPOSAL_TONE[p.state]} dot>
          {p.state === "waiting" ? "Waiting for approval" : p.state[0]!.toUpperCase() + p.state.slice(1)}
        </Badge>
        <span className="dk-seo-opps-quiet">
          #{p.id} · {p.source === "operator" ? "the operator" : (p.proposedBy ?? "a person")} · {ago(p.createdAt)}
        </span>
      </p>
      {p.after.title !== undefined ? (
        <p className="dk-seo-opps-proposal-line">
          <span>{p.shownTitle ?? p.after.title}</span>
          <Length n={p.lengths.title} of={60} />
        </p>
      ) : null}
      {p.after.description !== undefined ? (
        <p className="dk-seo-opps-proposal-line dk-seo-opps-proposal-line--desc">
          <span>{p.after.description}</span>
          <Length n={p.lengths.description} of={160} />
        </p>
      ) : null}
    </li>
  );
}

function Length({ n, of }: { n: number | null; of: number }) {
  if (n === null) return null;
  return <span className={cx("dk-seo-opps-len dk-num", n > of && "dk-seo-opps-len--over")}>{`${num(n)} / ${num(of)}`}</span>;
}

/** The result as Google would draw it from what the page says: the desk's limits are working values, Google cuts by width. */
function SerpPreview({ serp, label, proposed }: { serp: Serp; label: string; proposed?: boolean }) {
  const url = serp.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const [host, ...rest] = url.split("/");
  const cut = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  return (
    <figure className={cx("dk-seo-opps-serp", proposed && "dk-seo-opps-serp--proposed")}>
      <figcaption>{label}</figcaption>
      <div className="dk-seo-opps-serp-card">
        <p className="dk-seo-opps-serp-site">
          <span className="dk-seo-opps-serp-fav" aria-hidden>
            <Icon name="globe" size={12} />
          </span>
          <span>
            <b>{host}</b>
            <span>{`https://${host}${rest.length ? ` › ${rest.join(" › ")}` : ""}`}</span>
          </span>
        </p>
        <p className="dk-seo-opps-serp-title">{cut(serp.title, serp.titleLimit + 3) ?? <i>No title</i>}</p>
        <p className="dk-seo-opps-serp-desc">{cut(serp.description, serp.descriptionLimit + 3) ?? <i>No description: Google writes its own from the page.</i>}</p>
      </div>
      <div className="dk-seo-opps-serp-meters">
        <Meter label="Title length" n={serp.titleLength} of={serp.titleLimit} />
        <Meter label="Meta description" n={serp.descriptionLength} of={serp.descriptionLimit} />
        <p className="dk-seo-opps-serp-schema" title="Structured data is what makes a page eligible for rich results; Google's Rich Results Test is the last word.">
          <span>Structured data</span>
          <b>{serp.schemaTypes.length ? serp.schemaTypes.join(", ") : "none"}</b>
        </p>
      </div>
    </figure>
  );
}

function Meter({ label, n, of }: { label: string; n: number; of: number }) {
  const over = n > of;
  return (
    <p className="dk-seo-opps-meter">
      <span className="dk-seo-opps-meter-top">
        <span>{label}</span>
        <b className={cx("dk-num", over && "dk-seo-opps-len--over")}>{`${num(n)} / ${num(of)}`}</b>
      </span>
      <span className="dk-seo-opps-meter-track" aria-hidden>
        <i className={cx(over && "dk-seo-opps-meter-over")} style={{ width: `${Math.min(100, (n / of) * 100)}%` }} />
      </span>
    </p>
  );
}

/* ---------- Actions -------------------------------------------------------------------------------- */

const KIND_LINE: Record<OpportunityRow["action"]["kind"], string> = {
  proposal: "A proposal for approval",
  brief: "A brief from the operator",
  owner: "Only the owner can do this",
  chrome: "By hand, in the owner's browser",
  code: "A change to the website's code: on the to-do list in AI Operator",
};

function Actions({ o, owner }: { o: OpportunityRow; owner: boolean }) {
  const a = o.action;
  const closed = o.state.state === "done" || o.state.state === "dismissed";
  const step = ownerStep(a);
  const open = o.state.state === "open";
  return (
    <>
      <Section title={a.label || "The step"}>
        <p className="dk-seo-opps-kind">
          <Chip>{KIND_LINE[a.kind]}</Chip>
        </p>
        <p className="dk-seo-opps-step">{a.step}</p>
        <div className="dk-seo-opps-buttons">
          {a.href ? (
            <LinkButton href={a.href} size="sm" variant="quiet" iconRight="external">
              {a.kind === "chrome" ? "Open in Search Console" : "Open"}
            </LinkButton>
          ) : null}
          {/* A page waiting for Google: ask its URL Inspection now, to see whether the request has worked yet. */}
          {a.kind === "chrome" && o.subject.page?.path ? <InspectNowButton path={o.subject.page.path} size="sm" compact /> : null}
          {step && open ? (
            /* A step from the audit: whoever took it marks its task done. The owner's own: the owner only. */
            a.kind === "owner" && !owner ? (
              <p className="dk-seo-opps-note">Only the owner marks this done, once it is done.</p>
            ) : (
              <OwnerDone task={step} />
            )
          ) : a.available && open && a.kind !== "owner" ? (
            <ActButton id={o.id} label={actionLabel(a)} title={actionEffect(a)} size="sm" said="under" />
          ) : a.why ? (
            <p className="dk-seo-opps-note">{a.why}</p>
          ) : o.state.note ? (
            <p className="dk-seo-opps-note">{o.state.note}</p>
          ) : null}
        </div>
      </Section>
      <Section title="Your decision">
        <p className="dk-seo-opps-note">
          It is {STATE_LABEL[o.state.state].toLowerCase()}
          {o.state.by ? `, set by ${o.state.by}${o.state.at ? ` ${ago(o.state.at)}` : ""}` : ""}
          {o.state.note && closed ? `: ${o.state.note}` : ""}. The engine never changes a decision; one it no longer finds is kept as it is.
        </p>
        <Decide id={o.id} state={o.state.state} />
      </Section>
    </>
  );
}

/* ---------- History ---------------------------------------------------------------------------------- */

/**
 * What happened to it: whether it worked (the subject's figures before and
 * after it was done or stopped being found), its facts, and every action and
 * decision the desk recorded for it.
 */
function History({ d }: { d: OpportunityDetail }) {
  const o = d.opportunity;
  return (
    <>
      {d.outcome ? (
        <Section title="Whether it worked">
          {d.outcome.state === "ok" ? <OutcomeTable o={d.outcome.value} /> : <Absent reading={d.outcome} form="panel" />}
          {d.outcome.state === "ok" && d.outcome.note ? <p className="dk-seo-opps-note">{d.outcome.note}</p> : null}
        </Section>
      ) : null}
      <Section title="Its record">
        <Facts o={o} />
      </Section>
      <Section title="What people did">
        {d.trail.length ? (
          <ol className="dk-seo-opps-trail">
            {d.trail.map((t, i) => (
              <li key={`${t.at}-${i}`}>
                <span className="dk-seo-opps-quiet dk-num" title={fullDate(t.at)}>
                  {ago(t.at)}
                </span>
                <span>
                  <b>{t.text}</b>
                  {t.actor ? <span className="dk-seo-opps-quiet"> · {t.actor}</span> : null}
                  {t.detail ? <em>{t.detail}</em> : null}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="dk-seo-opps-note">Nobody has acted on it or decided about it yet.</p>
        )}
      </Section>
    </>
  );
}

/** The 28 days before against the days after, for its search or its page. */
function OutcomeTable({ o }: { o: Outcome }) {
  const row = (label: string, s: OutcomeSpan) => (
    <tr>
      <th scope="row">
        {label}
        <span className="dk-seo-opps-quiet">
          {" "}
          {shortDate(s.start)} – {shortDate(s.end)}
          {s.days ? ` · ${num(s.days)} day${s.days === 1 ? "" : "s"}` : ""}
        </span>
      </th>
      <td className="dk-seo-opps-mini-n dk-num">{num(s.impressions)}</td>
      <td className="dk-seo-opps-mini-n dk-num">{num(s.clicks)}</td>
      <td className="dk-seo-opps-mini-n dk-num">{s.position === null ? <span className="dk-seo-opps-quiet">not shown</span> : pos(s.position)}</td>
    </tr>
  );
  return (
    <>
      <p className="dk-seo-opps-note">
        {o.what === "done" ? "Marked done" : "No longer found by the rules"} on {fullDate(o.day)}. {o.label} in Google, the days before against the days since:
      </p>
      <table className="dk-seo-opps-mini dk-seo-opps-outcome">
        <caption className="dk-sr">Search Console figures before and after</caption>
        <thead>
          <tr>
            <th scope="col">Span</th>
            <th scope="col" className="dk-seo-opps-mini-n">
              Impr.
            </th>
            <th scope="col" className="dk-seo-opps-mini-n">
              Clicks
            </th>
            <th scope="col" className="dk-seo-opps-mini-n">
              Pos.
            </th>
          </tr>
        </thead>
        <tbody>
          {row("Before", o.before)}
          {row("After", o.after)}
        </tbody>
      </table>
    </>
  );
}

function Facts({ o }: { o: OpportunityRow }) {
  const st = o.state;
  return (
    <ol className="dk-seo-opps-history">
      <li>
        <b>First found</b>
        <span>{fullDate(o.firstSeen)}</span>
      </li>
      <li>
        <b>Last found by the rules</b>
        <span>{o.active ? ago(o.lastSeen) : `${fullDate(o.lastSeen)}; no longer found${o.clearedWhy ? `: ${o.clearedWhy}` : ""}`}</span>
      </li>
      <li>
        <b>State</b>
        <span>
          {STATE_LABEL[st.state]}
          {st.by ? ` · ${st.by}` : ""}
          {st.at ? ` · ${ago(st.at)}` : ""}
          {st.note ? <em>{st.note}</em> : null}
        </span>
      </li>
      {st.task ? (
        <li>
          <b>Operator task</b>
          <span>
            <Go href={st.task.href}>#{st.task.id}</Go> · {st.task.state}
            <em>{st.task.title}</em>
          </span>
        </li>
      ) : null}
      {st.proposals.map((p) => (
        <li key={p.id}>
          <b>Proposal #{p.id}</b>
          <span>
            <Go href={p.href}>{p.address}</Go> · {p.state}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- the foot ---------------------------------------------------------------------------------- */

/**
 * Board 111's "Edit page content" and "Apply changes": here the page's own
 * optimization view, and the opportunity's action. Nothing applies by itself:
 * a proposal waits for a person's approval, a change to the website's code
 * goes on the to-do list, and a person's step is marked by the person who
 * took it (the owner's own, by the owner).
 */
function Foot({ o, owner }: { o: OpportunityRow; owner: boolean }) {
  const page = o.subject.page;
  const a = o.action;
  const step = ownerStep(a);
  const isOpen = o.state.state === "open";
  const open = a.available && isOpen;
  return (
    <div className="dk-seo-opps-detail-foot">
      {page ? (
        <LinkButton href={`/seo/pages/view?path=${encodeURIComponent(page.path)}`} size="md" variant="quiet" icon="pencil" block>
          Optimize this page
        </LinkButton>
      ) : null}
      <span className="dk-seo-opps-detail-main">
        {step && isOpen && (a.kind === "chrome" || owner) ? (
          <OwnerDone task={step} variant="primary" size="md" block />
        ) : open && a.kind === "chrome" && a.href ? (
          <LinkButton href={a.href} size="md" variant="primary" iconRight="external" block title="Opens URL Inspection in Search Console, where “Request indexing” is. Mark it requested here afterwards.">
            {a.label}
          </LinkButton>
        ) : open && a.kind !== "owner" ? (
          <ActButton id={o.id} label={a.kind === "code" ? actionLabel(a) : a.label} title={actionEffect(a)} variant="primary" size="md" block said="under" />
        ) : (
          <ActionCell r={o} size="sm" />
        )}
      </span>
    </div>
  );
}
