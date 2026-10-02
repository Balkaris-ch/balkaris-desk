import type { ReactNode } from "react";
import type { OperatorPayload, ProposalRow } from "@/contract/operator";
import type { ChipTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Tabs } from "@/components/ui/Tabs";
import { ago } from "@/lib/format";
import { cx } from "@/lib/cx";
import { ReviewButton } from "./Review";

export type ApprovalTab = "waiting" | "approved" | "completed";

/** Rows the panel holds before it points to the rest. */
const SHOWN = 5;

function Row({ icon, tone, title, sub, children }: { icon: IconName; tone: ChipTone; title: string; sub: string; children?: ReactNode }) {
  return (
    <li className="dk-operator-ap">
      <span className={cx("dk-operator-tile", "dk-operator-tile--xs", `dk-tone-${tone}`)} aria-hidden>
        <Icon name={icon} size={16} />
      </span>
      <span className="dk-operator-ap-text">
        <span className="dk-operator-ap-title">{title}</span>
        <span className="dk-operator-ap-sub" title={sub}>
          {sub}
        </span>
      </span>
      <span className="dk-operator-ap-actions">{children}</span>
    </li>
  );
}

function what(p: ProposalRow): { title: string; sub: string } {
  if (p.kind === "redirect") return { title: p.state === "waiting" ? "Create redirect" : "Redirect", sub: `${p.address} → ${p.after.to}` };
  const fields = p.after.title !== undefined && p.after.description !== undefined ? "title and description" : p.after.title !== undefined ? "title" : "description";
  return { title: p.state === "waiting" ? "Update metadata" : "Metadata", sub: `${p.address}: new ${fields}` };
}

function status(p: ProposalRow): string {
  if (p.state === "applied") return `Live since ${ago(p.appliedAt ?? p.decidedAt ?? p.createdAt)}, approved by ${p.decidedBy ?? "a person"}`;
  if (p.state === "approved") return p.error ? `Approved, not applied: ${p.error}` : `Approved by ${p.decidedBy ?? "a person"}, being applied`;
  if (p.state === "withdrawn") return `Withdrawn ${ago(p.withdrawnAt ?? p.createdAt)} by ${p.withdrawnBy ?? "a person"}${p.note ? ` · ${p.note}` : ""}`;
  if (p.state === "rejected") return `Rejected by ${p.decidedBy ?? "a person"}${p.note ? ` · ${p.note}` : ""}`;
  return "";
}

/**
 * Actions & approvals: the changes the operator (or a person) proposed,
 * waiting for a person who can publish, and the articles the desk wrote that
 * nobody has published yet; what is live, and what was withdrawn or
 * rejected. Every button does its one job: Review and Approve open the
 * change with its consequence, Preview goes to the article.
 */
export function Approvals({ data, tab, hrefFor, specimen }: { data: OperatorPayload; tab: ApprovalTab; hrefFor: (tab: ApprovalTab) => string; specimen: boolean }) {
  const a = data.approvals;
  const drafts = a.drafts.state === "ok" ? a.drafts.value : [];
  /* Counted in the database: the lists are only the newest of each. */
  const counts = { waiting: a.counts.waiting + drafts.length, approved: a.counts.approved, completed: a.counts.completed };
  const can = data.me.canApprove;
  const why = data.me.why;

  const proposals = tab === "waiting" ? a.waiting : tab === "approved" ? a.approved : a.completed;
  const total = tab === "waiting" ? a.counts.waiting : tab === "approved" ? a.counts.approved : a.counts.completed;
  const room = Math.max(0, SHOWN - proposals.length);
  const shownDrafts = tab === "waiting" ? drafts.slice(0, room) : [];
  const more = (tab === "waiting" ? total + drafts.length : total) - Math.min(proposals.length, SHOWN) - shownDrafts.length;

  return (
    <Card title="Actions & approvals" icon="hourglass" right={<LinkButton href="/operator/results?tab=proposals" size="xs">View all</LinkButton>} className="dk-operator-panel" id="approvals">
      <Tabs
        size="sm"
        label="Actions & approvals"
        active={tab}
        items={[
          { key: "waiting", label: `Waiting (${counts.waiting})`, href: hrefFor("waiting") },
          { key: "approved", label: `Approved (${counts.approved})`, href: hrefFor("approved") },
          { key: "completed", label: `Completed (${counts.completed})`, href: hrefFor("completed") },
        ]}
        className="dk-operator-tabs"
      />
      {proposals.length || shownDrafts.length ? (
        <ul className="dk-operator-aps" aria-label={`${tab} actions`}>
          {proposals.slice(0, SHOWN).map((p) => {
            const w = what(p);
            const live = p.state === "applied";
            return (
              <Row
                key={`p${p.id}`}
                icon={p.kind === "redirect" ? "link" : "tag"}
                tone={p.state === "withdrawn" || p.state === "rejected" ? "quiet" : p.kind === "redirect" ? "warn" : "info"}
                title={w.title}
                sub={tab === "waiting" ? (p.drift ? `${w.sub} · the page changed since; ask again` : w.sub) : `${w.sub} · ${status(p)}`}
              >
                {tab === "waiting" || (p.state === "approved" && p.error) ? (
                  <>
                    <ReviewButton p={p} mode="review" canApprove={can} why={why} specimen={specimen} label="Review" variant="quiet" />
                    {can && !p.drift ? <ReviewButton p={p} mode="approve" canApprove={can} why={why} specimen={specimen} label={p.state === "approved" ? "Apply again" : "Approve"} variant="good" /> : null}
                  </>
                ) : live && can ? (
                  <>
                    <ReviewButton p={p} mode="review" canApprove={false} why={why} specimen={specimen} label="Review" variant="quiet" />
                    <ReviewButton p={p} mode="withdraw" canApprove={can} why={why} specimen={specimen} label="Withdraw" variant="danger" />
                  </>
                ) : (
                  <ReviewButton p={p} mode="review" canApprove={false} why={why} specimen={specimen} label="Review" variant="quiet" />
                )}
              </Row>
            );
          })}
          {shownDrafts.map((d) => (
            <Row key={`d${d.id}`} icon="file-text" tone="violet" title="Publish blog post draft" sub={d.title}>
              <LinkButton href={d.href} size="xs" className="dk-operator-row-btn">
                Preview
              </LinkButton>
            </Row>
          ))}
        </ul>
      ) : tab === "waiting" && a.drafts.state !== "ok" ? (
        <Absent reading={a.drafts} />
      ) : (
        <Empty icon={tab === "waiting" ? "check-circle" : "hourglass"} title={tab === "waiting" ? "Nothing waits for approval" : tab === "approved" ? "Nothing applied yet" : "Nothing completed yet"} compact>
          {tab === "waiting"
            ? "Proposals from the operator and articles the desk wrote appear here until a person decides."
            : tab === "approved"
              ? "A change a person approves is applied to the live site and listed here, where it can be withdrawn."
              : "Changes withdrawn or rejected are kept here."}
        </Empty>
      )}
      {more > 0 ? (
        <p className="dk-operator-more-line">
          {tab === "waiting" && drafts.length > shownDrafts.length ? (
            <Go href="/insights" className="dk-operator-link">
              {more} more waiting, among them {drafts.length - shownDrafts.length} draft{drafts.length - shownDrafts.length === 1 ? "" : "s"} on the Insights screen
            </Go>
          ) : (
            <Go href="/operator/results?tab=proposals" className="dk-operator-link">
              {more} more
            </Go>
          )}
        </p>
      ) : null}
      {!can && tab === "waiting" && a.waiting.length ? <p className="dk-operator-aside">{why}</p> : null}
    </Card>
  );
}
