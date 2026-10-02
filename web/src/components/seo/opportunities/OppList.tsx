import type { OpportunityRow } from "@/contract/seo/common";
import type { OpportunityFacets, OpportunityLine, OpportunityQuery, SeoOpportunitiesPayload } from "@/contract/seo/opportunities";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import "@/components/ui/early.css";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { DASH, num, shortDate } from "@/lib/format";
import { ActButton, BulkForm, BulkMenu, OwnerDone, RowMenu } from "./Act";
import { actionEffect, BASE, gain, hrefWith, noEstimate, ownerStep, paramsOf, pos, PRIORITY_LABEL, PRIORITY_TONE, shortAction, STATE_LABEL, STATE_TONE, times, TYPE_ICON } from "./look";

const FIND = "dk-seo-opps-find";
const SORTS = [
  { value: "priority", label: "By priority" },
  { value: "potential", label: "By our estimate" },
  { value: "newest", label: "Newest first" },
  { value: "page", label: "By page" },
];
const STATES = [
  { value: "", label: "To do" },
  { value: "open", label: "Open" },
  { value: "queued", label: "Queued" },
  { value: "in-progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "dismissed", label: "Dismissed" },
  { value: "open,queued,in-progress,done,dismissed", label: "Every state" },
];
const LIMITS = [
  { value: "10", label: "10" },
  { value: "25", label: "25" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
];
const RESETS = ["offset", "open", "tab"] as const;

/**
 * "SEO Opportunities" (board 111): the chips by type and priority, the
 * filters, the table with its checkboxes and "Bulk actions", and the pager.
 * Each row opens in the detail beside it (?open=).
 *
 * The board's columns, with what is true in them: Current is Google's
 * average position for the row's query or page over the head's range; Target
 * and Est. gain are our estimate's (src/cc/seo/ctr.ts), and only where Search
 * Console counted impressions. There is no search volume and no difficulty
 * column: no free source gives either. The list is paged on the server, so
 * its order is the head's "Order" select (?sort=), over the whole list; the
 * column heads do not sort the one page shown.
 */
export function OppList({ data, openId }: { data: SeoOpportunitiesPayload; openId: string | null }) {
  const asked = data.asked;
  const base = paramsOf(asked);
  const total = data.facets.types.reduce((n, t) => n + t.count, 0);

  return (
    <>
      {/* The search box's own form, outside the list's form: forms do not nest. Its field is in the list's head (form="…"). */}
      <form id={FIND} method="get" action={BASE} hidden>
        {Object.entries(base)
          .filter(([k]) => k !== "q" && k !== "offset")
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
      </form>
      <BulkForm className="dk-seo-opps-listform">
        <Card
          className="dk-seo-opps-list"
          title="SEO Opportunities"
          sub="What the rules found in Search Console, Google’s index, the crawl and the SEO audit, ranked, each with the step that acts on it."
          info={<RulesInfo rules={data.rules} />}
          right={
            <>
              <Select param="state" label="Which opportunities, by state (To do: open, queued and in progress)" fallback="" resets={RESETS} options={STATES} className="dk-seo-opps-head-select" />
              <Select param="sort" label="Order" fallback="priority" resets={RESETS} options={SORTS} className="dk-seo-opps-head-select" />
              <BulkMenu />
            </>
          }
          flush
          footer={<Pager reading={data.list} asked={asked} base={base} cleared={data.facets.cleared} />}
        >
          <Chips facets={data.facets} asked={asked} base={base} total={total} />
          <Filters facets={data.facets} asked={asked} />
          {data.list.state === "ok" ? (
            <Table
              caption="SEO opportunities"
              className="dk-seo-opps-table"
              rows={data.list.value.rows}
              rowKey={(r) => r.id}
              rowHref={(r) => hrefWith(base, { open: r.id })}
              keepScroll
              select={{ name: "ids", label: (r) => r.title }}
              density="roomy"
              minWidth={860}
              empty={asked.q || asked.types.length || asked.priority || asked.page || asked.cluster ? "No opportunity matches these filters." : "No opportunity in this state. The engine looks again every hour."}
              columns={columns(data, openId)}
            />
          ) : (
            <Absent reading={data.list} className="dk-seo-opps-absent" />
          )}
        </Card>
      </BulkForm>
    </>
  );
}

function RulesInfo({ rules }: { rules: SeoOpportunitiesPayload["rules"] }) {
  return (
    <span className="dk-seo-opps-rules">
      <b>How each kind is found and ranked</b>
      {rules.map((r) => (
        <span key={r.type}>
          <b>{r.label}.</b> {r.rule}
        </span>
      ))}
    </span>
  );
}

function Chips({ facets, asked, base, total }: { facets: OpportunityFacets; asked: OpportunityQuery; base: Record<string, string>; total: number }) {
  const high = facets.priorities.find((p) => p.priority === "high")?.count ?? 0;
  const noFilter = !asked.types.length && !asked.priority;
  const chip = (key: string, label: string, count: number, href: string, on: boolean) => (
    <Go key={key} href={href} scroll={false} className={cx("dk-seo-opps-chip", on && "dk-seo-opps-chip--on")} aria-current={on ? "true" : undefined}>
      <span>{label}</span>
      <span className="dk-seo-opps-chip-n dk-num">{num(count)}</span>
    </Go>
  );
  return (
    <nav className="dk-seo-opps-chips" aria-label="Opportunities by kind">
      {chip("all", "All", total, hrefWith(base, { type: undefined, priority: undefined }), noFilter)}
      {chip("high", "High priority", high, hrefWith(base, { type: undefined, priority: "high" }), !asked.types.length && asked.priority === "high")}
      {facets.types.map((t) => chip(t.type, t.label, t.count, hrefWith(base, { type: t.type, priority: undefined }), asked.types.length === 1 && asked.types[0] === t.type && !asked.priority))}
    </nav>
  );
}

function Filters({ facets, asked }: { facets: OpportunityFacets; asked: OpportunityQuery }) {
  return (
    <div className="dk-seo-opps-filters">
      <label className="dk-seo-opps-find">
        <Icon name="search" size={14} />
        <input form={FIND} type="search" name="q" defaultValue={asked.q} placeholder="Search opportunities" aria-label="Search opportunities" />
      </label>
      <Select
        param="page"
        label="Page"
        fallback=""
        resets={RESETS}
        options={[{ value: "", label: "All pages" }, ...facets.pages.map((p) => ({ value: p.path, label: `${p.path} (${p.count})` }))]}
      />
      <Select
        param="cluster"
        label="Topic"
        fallback=""
        resets={RESETS}
        options={[{ value: "", label: "All topics" }, ...facets.clusters.map((c) => ({ value: c.key, label: `${c.name} (${c.count})` }))]}
      />
      <Select
        param="action"
        label="Who acts"
        fallback=""
        resets={RESETS}
        options={[{ value: "", label: "Every kind of action" }, ...facets.actions.map((a) => ({ value: a.kind, label: `${a.label} (${a.count})` }))]}
      />
      <Select
        param="priority"
        label="Priority"
        fallback=""
        resets={RESETS}
        options={[{ value: "", label: "All priorities" }, ...facets.priorities.map((p) => ({ value: p.priority, label: `${PRIORITY_LABEL[p.priority]} (${p.count})` }))]}
      />
    </div>
  );
}

/** The figure the "Current" column shows, with what it is on hover. */
function Current({ r, rank }: { r: OpportunityLine; rank: SeoOpportunitiesPayload["rank"] }) {
  if (!r.now) {
    if (rank.state !== "ok") return <Absent reading={rank} form="inline" />;
    return (
      <Tooltip text="This opportunity has no single search or page to measure: a topic, a site-wide change, or a step off the site.">
        <span className="dk-seo-opps-none" tabIndex={0}>
          {DASH}
        </span>
      </Tooltip>
    );
  }
  const n = r.now;
  const window = rank.state === "ok" ? `${shortDate(rank.value.start)} – ${shortDate(rank.value.end)}` : "the window";
  const what = n.of === "query" ? `“${r.subject.keyword}”` : (r.subject.page?.path ?? "the page");
  if (n.position === null) {
    return (
      <Tooltip text={`Google did not show ${what} in ${window}.`}>
        <span className="dk-seo-opps-quiet" tabIndex={0}>
          not shown
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip text={`Google’s average position for ${what}, ${window}: shown ${times(n.impressions)}, ${num(n.clicks)} ${n.clicks === 1 ? "click" : "clicks"}.`}>
      <span className="dk-seo-opps-pos-figure" tabIndex={0}>
        {pos(n.position)}
        {/* The rule's own floor is in its sentence (priorityWhy), so the mark carries that sentence. */}
        {r.early ? (
          <span className="dk-early-mark" title={r.priorityWhy}>
            early
          </span>
        ) : null}
      </span>
    </Tooltip>
  );
}

function Gain({ r }: { r: OpportunityLine }) {
  if (!r.potential) {
    return (
      <Tooltip text={noEstimate(r, r.now?.impressions)}>
        <span className="dk-seo-opps-none" tabIndex={0}>
          {DASH}
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip text={`${r.potential.basis}.`}>
      <span className="dk-seo-opps-gain-figure" tabIndex={0}>
        {gain(r.potential.clicksPerMonth)}
        <span className="dk-seo-opps-per">/mo</span>
      </span>
    </Tooltip>
  );
}

/** The row's action: its button, the link that helps do it, the state it is in, or "Needs you". */
export function ActionCell({ r, size = "xs" }: { r: OpportunityRow; size?: "xs" | "sm" }) {
  const a = r.action;
  const step = ownerStep(a);
  /* A step from the audit in the owner's browser: whoever took it marks its task done. The owner's own steps say "Needs you". */
  if (step && a.kind === "chrome" && r.state.state === "open" && a.available) return <OwnerDone task={step} size={size} said="inline" />;
  if (r.state.state !== "open" || !a.available) {
    const s = r.state.state;
    return (
      <Tooltip text={[r.state.note, a.why].filter(Boolean).join(" ") || STATE_LABEL[s]}>
        <span tabIndex={0}>
          <Badge tone={a.kind === "owner" && s === "open" ? "warn" : STATE_TONE[s]} dot>
            {a.kind === "owner" && s === "open" ? "Needs you" : STATE_LABEL[s]}
          </Badge>
        </span>
      </Tooltip>
    );
  }
  if (a.kind === "chrome" && a.href) {
    return (
      <Go href={a.href} className="dk-btn dk-btn--good dk-btn--xs dk-seo-opps-go" title={`Opens URL Inspection in Search Console, where "Request indexing" is. ${a.step}`}>
        <span className="dk-btn-label">{shortAction(r)}</span>
        <Icon name="external" size={12} />
      </Go>
    );
  }
  return <ActButton id={r.id} label={shortAction(r)} title={`${a.label}. ${actionEffect(a)}`} size={size} />;
}

function columns(data: SeoOpportunitiesPayload, openId: string | null): Column<OpportunityLine>[] {
  const on = openId ?? (data.selected?.state === "ok" ? data.selected.value.opportunity.id : null);
  return [
    {
      key: "opportunity",
      head: "Opportunity",
      cell: (r) => (
        <span className="dk-seo-opps-what" data-opp-on={r.id === on ? "" : undefined}>
          <span className="dk-seo-opps-icon" aria-hidden>
            <Icon name={TYPE_ICON[r.type]} size={14} />
          </span>
          <span className="dk-seo-opps-what-text">
            <span className="dk-seo-opps-title" title={r.title}>
              {r.title}
            </span>
            <span className="dk-seo-opps-type">
              {r.typeLabel}
              {r.state.state !== "open" ? ` · ${STATE_LABEL[r.state.state]}` : ""}
              {!r.active ? " · no longer found" : ""}
            </span>
          </span>
        </span>
      ),
    },
    {
      /* The board's Page and Keyword / topic, one over the other: the list keeps its width for the figures. */
      key: "page",
      head: "Page / keyword",
      cell: (r) => (
        <span className="dk-seo-opps-where">
          {r.subject.page ? (
            <span className="dk-seo-opps-path" title={r.subject.page.title ? `${r.subject.page.path}: ${r.subject.page.title}` : r.subject.page.path}>
              {r.subject.page.path}
            </span>
          ) : (
            <span className="dk-seo-opps-quiet">{r.type === "keyword-gap" || r.type === "german-missing" ? "no page yet" : "the site"}</span>
          )}
          {r.subject.keyword ? (
            <span className="dk-seo-opps-kw" title={r.subject.keyword}>
              “{r.subject.keyword}”
            </span>
          ) : r.subject.cluster ? (
            <span className="dk-seo-opps-kw dk-seo-opps-kw--topic" title={`Topic: ${r.subject.cluster.name}`}>
              {r.subject.cluster.name}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "current",
      head: "Current",
      numeric: true,
      cell: (r) => <Current r={r} rank={data.rank} />,
    },
    {
      key: "target",
      head: "Target",
      numeric: true,
      cell: (r) =>
        r.potential ? (
          <Tooltip text={`The position our estimate aims at: ${r.potential.targetCtr}% of impressions become clicks there on our curve, against ${r.potential.currentCtr}% now.`}>
            <span tabIndex={0}>{r.potential.targetPosition <= 3 ? `Top ${r.potential.targetPosition}` : `Pos. ${r.potential.targetPosition}`}</span>
          </Tooltip>
        ) : (
          <span className="dk-seo-opps-none">{DASH}</span>
        ),
    },
    {
      key: "gain",
      head: (
        <span className="dk-seo-opps-head-info">
          Est. gain
          <Tooltip text={data.curve.note}>
            <span className="dk-info" tabIndex={0} aria-label="Our estimate: how it is made">
              <Icon name="info" size={12} />
            </span>
          </Tooltip>
        </span>
      ),
      numeric: true,
      cell: (r) => <Gain r={r} />,
    },
    {
      key: "priority",
      head: "Priority",
      cell: (r) => (
        <Tooltip text={r.priorityWhy}>
          <span tabIndex={0}>
            <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge>
          </span>
        </Tooltip>
      ),
    },
    { key: "action", head: "Action", cell: (r) => <ActionCell r={r} /> },
    {
      key: "more",
      head: <span className="dk-sr">More</span>,
      align: "right",
      cell: (r) => (
        <RowMenu
          id={r.id}
          state={r.state.state}
          title={r.title}
          byHand={r.action.kind === "chrome" && r.action.href && r.action.available && r.state.state === "open" ? "Mark indexing requested" : null}
          ownerTask={r.state.state === "open" && (r.action.kind === "chrome" || data.viewer.owner) ? ownerStep(r.action) : null}
        />
      ),
      width: "40px",
    },
  ];
}

function Pager({ reading, asked, base, cleared }: { reading: SeoOpportunitiesPayload["list"]; asked: OpportunityQuery; base: Record<string, string>; cleared: number }) {
  if (reading.state !== "ok") return null;
  const { total, offset, limit } = reading.value;
  const pages = Math.max(1, Math.ceil(total / limit));
  const at = Math.floor(offset / limit);
  /* The pages near this one, and the first and last. */
  const shown = [...new Set([0, at - 1, at, at + 1, pages - 1])].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b);
  const to = (p: number) => hrefWith(base, { offset: p ? String(p * limit) : undefined, open: undefined, tab: undefined });
  return (
    <div className="dk-seo-opps-pager">
      <p className="dk-seo-opps-pager-said">
        {total ? `Showing ${num(offset + 1)}–${num(Math.min(total, offset + limit))} of ${num(total)} opportunit${total === 1 ? "y" : "ies"}` : "No opportunities"}
        {cleared && asked.active === "1" ? (
          <>
            {" · "}
            <Go href={hrefWith(base, { active: "0", state: "open,queued,in-progress,done,dismissed" })} scroll={false}>
              {num(cleared)} no longer found
            </Go>
          </>
        ) : null}
        <Stamp reading={reading} />
      </p>
      {pages > 1 ? (
        <nav className="dk-seo-opps-pages" aria-label="Pages of the list">
          {at > 0 ? (
            <Go href={to(at - 1)} scroll={false} className="dk-seo-opps-page" aria-label="Previous page">
              <Icon name="chevron-left" size={14} />
            </Go>
          ) : null}
          {shown.map((p, i) => (
            <span key={p} className="dk-seo-opps-page-wrap">
              {i > 0 && p - shown[i - 1]! > 1 ? <span className="dk-seo-opps-gap">…</span> : null}
              <Go href={to(p)} scroll={false} className={cx("dk-seo-opps-page", p === at && "dk-seo-opps-page--on")} aria-current={p === at ? "page" : undefined}>
                {num(p + 1)}
              </Go>
            </span>
          ))}
          {at < pages - 1 ? (
            <Go href={to(at + 1)} scroll={false} className="dk-seo-opps-page" aria-label="Next page">
              <Icon name="chevron-right" size={14} />
            </Go>
          ) : null}
        </nav>
      ) : null}
      <label className="dk-seo-opps-perpage">
        <span>Rows per page</span>
        <Select param="limit" label="Rows per page" fallback="10" resets={["offset"]} options={LIMITS} />
      </label>
    </div>
  );
}

