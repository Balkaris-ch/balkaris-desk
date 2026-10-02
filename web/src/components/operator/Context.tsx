import type { Range } from "@/contract/common";
import type { ContextChannel, ContextInsight, ContextIssue, ContextPage, OperatorContext } from "@/contract/operator";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { Go } from "@/components/ui/Go";
import { DASH, num } from "@/lib/format";
import { cx } from "@/lib/cx";
import { ProposeFixes, Refresh } from "./Buttons";

export type ContextTab = "pages" | "insights" | "traffic" | "issues";

const STATUS_TONE: Record<ContextPage["status"], string> = { healthy: "good", update: "warn", fix: "bad", down: "bad", unknown: "quiet" };
const SEVERITY: Record<ContextIssue["severity"], { label: string; tone: string }> = {
  critical: { label: "Critical", tone: "bad" },
  warning: { label: "Warning", tone: "warn" },
  opportunity: { label: "Opportunity", tone: "info" },
};
const STATE: Record<ContextInsight["state"], { label: string; tone: string }> = {
  listed: { label: "Listed", tone: "good" },
  unlisted: { label: "Unlisted", tone: "info" },
  draft: { label: "Draft", tone: "violet" },
};

function Status({ tone, children }: { tone: string; children: string }) {
  return (
    <span className={cx("dk-operator-status", `dk-tone-${tone}`)}>
      <span className="dk-operator-status-dot" aria-hidden />
      {children}
    </span>
  );
}

const FOOT: Record<ContextTab, { href: string; label: string }> = {
  pages: { href: "/pages", label: "View all pages" },
  insights: { href: "/insights", label: "View all insights" },
  traffic: { href: "/traffic", label: "View all traffic" },
  issues: { href: "/seo", label: "View all issues" },
};

/**
 * Website context: the real data the operator's packs are built from, as a
 * person sees it before asking. Each tab is its own reading, so a source
 * that is not connected costs one tab, drawn in its place.
 */
export function Context({ context, tab, hrefFor, range, specimen }: { context: OperatorContext; tab: ContextTab; hrefFor: (tab: ContextTab) => string; range: Range; specimen: boolean }) {
  const reading = context[tab];
  return (
    <Card title="Website context" icon="database" right={<Refresh tab={tab} range={range} specimen={specimen} />} className="dk-operator-panel" id="context">
      <Tabs
        size="sm"
        label="Website context"
        active={tab}
        items={[
          { key: "pages", label: "Pages", href: hrefFor("pages") },
          { key: "insights", label: "Insights", href: hrefFor("insights") },
          { key: "traffic", label: "Traffic", href: hrefFor("traffic") },
          { key: "issues", label: "Issues", href: hrefFor("issues") },
        ]}
        className="dk-operator-tabs"
      />
      <div className="dk-operator-ctx">
        {tab === "pages" ? (
          <Read reading={context.pages}>
            {(rows) => (
              <Table<ContextPage>
                caption="Pages"
                rows={rows}
                rowKey={(r) => r.path}
                empty="No page had a view in this period."
                columns={[
                  { key: "page", head: "Page", cell: (r) => <Go href={`/pages?open=${encodeURIComponent(r.path)}`} className="dk-operator-path">{r.path}</Go> },
                  { key: "views", head: "Views", numeric: true, width: "84px", cell: (r) => (r.views === null ? DASH : num(r.views)) },
                  { key: "status", head: "Status", width: "120px", cell: (r) => <Status tone={STATUS_TONE[r.status]}>{r.statusLabel}</Status> },
                ]}
              />
            )}
          </Read>
        ) : tab === "insights" ? (
          <Read reading={context.insights}>
            {(rows) => (
              <Table<ContextInsight>
                caption="Insights"
                rows={rows}
                rowKey={(r) => r.href}
                columns={[
                  { key: "title", head: "Article", cell: (r) => <Go href={r.href} className="dk-operator-path" title={r.title}>{r.title}</Go> },
                  { key: "views", head: "Views", numeric: true, width: "72px", cell: (r) => (r.views === null ? DASH : num(r.views)) },
                  { key: "state", head: "Status", width: "96px", cell: (r) => <Status tone={STATE[r.state].tone}>{STATE[r.state].label}</Status> },
                ]}
              />
            )}
          </Read>
        ) : tab === "traffic" ? (
          <Read reading={context.traffic}>
            {(rows) => (
              <Table<ContextChannel>
                caption="Sessions by channel"
                rows={rows}
                rowKey={(r) => r.key}
                empty="No sessions in this period."
                columns={[
                  { key: "channel", head: "Channel", cell: (r) => r.label },
                  { key: "sessions", head: "Sessions", numeric: true, width: "84px", cell: (r) => num(r.sessions) },
                  {
                    key: "change",
                    head: "Change",
                    numeric: true,
                    width: "96px",
                    cell: (r) => (r.change === null ? <span className="dk-operator-quiet" title="The period before was not measured by GA4, so there is nothing to compare with.">{DASH}</span> : <span className={cx("dk-operator-change", `dk-tone-${r.tone}`)}>{r.change}</span>),
                  },
                ]}
              />
            )}
          </Read>
        ) : (
          <Read reading={context.issues}>
            {(rows) => (
              <Table<ContextIssue>
                caption="The crawl's findings"
                rows={rows}
                rowKey={(r) => r.rule}
                empty="The last crawl found nothing to hold against the site."
                columns={[
                  { key: "issue", head: "Issue", cell: (r) => <span title={r.pages.join(", ")}>{r.title}</span> },
                  { key: "count", head: "Found", numeric: true, width: "64px", cell: (r) => num(r.count) },
                  { key: "severity", head: "Severity", width: "112px", cell: (r) => <Status tone={SEVERITY[r.severity].tone}>{SEVERITY[r.severity].label}</Status> },
                ]}
              />
            )}
          </Read>
        )}
      </div>
      <div className="dk-operator-ctx-foot">
        <LinkButton href={FOOT[tab].href} size="sm">
          {FOOT[tab].label}
        </LinkButton>
        {tab === "issues" ? <ProposeFixes metadata={context.fixable.metadata} redirect={context.fixable.redirect} range={range} specimen={specimen} /> : null}
        {reading.state === "ok" ? <Stamp reading={reading} className="dk-operator-stamp" /> : null}
      </div>
    </Card>
  );
}

