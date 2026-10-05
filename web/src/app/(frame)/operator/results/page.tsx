import type { OperatorHistory, ProposalRow, ResultCard, TaskRow } from "@/contract/operator";
import { proposalLine } from "@/components/operator/look";
import type { ActivityItem } from "@/contract/common";
import { api } from "@/lib/api";
import { ago, fullDate, clock } from "@/lib/format";
import { PageHead } from "@/components/shell/PageHead";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Badge, type ChipTone } from "@/components/ui/Badge";
import { Go } from "@/components/ui/Go";
import { Table } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import "@/components/operator/operator.css";

export const metadata = { title: "AI Operator: everything" };

const TABS = ["results", "tasks", "proposals", "actions"] as const;
type Tab = (typeof TABS)[number];

const TASK_TONE: Record<TaskRow["state"], ChipTone> = { queued: "quiet", running: "info", done: "good", failed: "bad", cancelled: "quiet" };
const PROPOSAL_TONE: Record<ProposalRow["state"], ChipTone> = { waiting: "warn", approved: "info", applied: "good", rejected: "quiet", withdrawn: "quiet" };
const TASK_WORD: Record<TaskRow["state"], string> = { queued: "Queued", running: "Running", done: "Answered", failed: "Failed", cancelled: "Stopped" };
const PROPOSAL_WORD: Record<ProposalRow["state"], string> = { waiting: "Waiting", approved: "Approved", applied: "Live", rejected: "Rejected", withdrawn: "Withdrawn" };
const when = (iso: string | null) => (iso ? `${fullDate(iso)} ${clock(iso)}` : "—");

/**
 * Everything the operator has done: every answer, every task with its true
 * end, every proposal with who decided, and every action in the log. The
 * "View all" of each panel on the AI Operator screen leads here.
 */
export default async function OperatorHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const asked = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = TABS.find((t) => t === asked) ?? "results";
  const data = await api<OperatorHistory>("/api/v1/operator/history", { tab });
  /* The lists are the newest `most`; the counts are all of them. Say so where a list is cut. */
  const listed = { results: data.results.length, tasks: data.tasks.length, proposals: data.proposals.length, actions: data.actions.length }[tab];
  const all = data.counts[tab];

  return (
    <div className="dk-operator">
      <PageHead eyebrow="AI Operator" title="Everything the operator did" subtitle="Every answer, task, proposal and action, newest first." action={<LinkButton href="/operator" icon="arrow-left" size="sm">Back to the operator</LinkButton>} />
      <Tabs
        label="History"
        active={tab}
        items={[
          { key: "results", label: "Answers", href: "/operator/results", count: data.counts.results },
          { key: "tasks", label: "Tasks", href: "/operator/results?tab=tasks", count: data.counts.tasks },
          { key: "proposals", label: "Proposals", href: "/operator/results?tab=proposals", count: data.counts.proposals },
          { key: "actions", label: "Actions", href: "/operator/results?tab=actions", count: data.counts.actions },
        ]}
      />
      <Card flush>
        {tab === "results" ? (
          <Table<ResultCard>
            caption="Answers"
            rows={data.results}
            rowKey={(r) => r.id}
            rowHref={(r) => `/operator/results/${r.id}`}
            empty="No answer yet: the workstation has not finished a task."
            columns={[
              { key: "what", head: "Answer", cell: (r) => r.label },
              { key: "sub", head: "Holds", width: "28%", cell: (r) => r.sub },
              { key: "at", head: "Finished", width: "180px", cell: (r) => when(r.finishedAt) },
            ]}
          />
        ) : tab === "tasks" ? (
          <Table<TaskRow>
            caption="Tasks"
            rows={data.tasks}
            rowKey={(t) => t.id}
            rowHref={(t) => (t.state === "done" || t.state === "failed" ? `/operator/results/${t.id}` : null)}
            empty="No task has been asked for yet."
            columns={[
              { key: "task", head: "Task", cell: (t) => `${t.kindLabel}: ${t.title}` },
              { key: "who", head: "Asked by", width: "140px", cell: (t) => t.askedBy },
              { key: "state", head: "State", width: "110px", cell: (t) => <Badge tone={TASK_TONE[t.state]} dot>{TASK_WORD[t.state]}</Badge> },
              { key: "at", head: "Asked", width: "160px", cell: (t) => when(t.createdAt) },
              { key: "end", head: "Ended", width: "220px", cell: (t) => (t.error ? <span title={t.error}>{t.finishedAt ? ago(t.finishedAt) : ""} · {t.error.slice(0, 60)}</span> : t.finishedAt ? ago(t.finishedAt) : "—") },
            ]}
          />
        ) : tab === "proposals" ? (
          <Table<ProposalRow>
            caption="Proposals"
            rows={data.proposals}
            rowKey={(p) => p.id}
            empty="Nothing has been proposed yet."
            columns={[
              { key: "address", head: "Address", cell: (p) => p.address },
              { key: "change", head: "Change", width: "34%", cell: (p) => <span title={JSON.stringify(p.after)}>{proposalLine(p).title}: {proposalLine(p).sub.replace(`${p.address}: `, "")}</span> },
              { key: "from", head: "Proposed by", width: "140px", cell: (p) => (p.source === "operator" ? (p.taskId ? <Go href={`/operator/results/${p.taskId}`}>Operator, task #{p.taskId}</Go> : "Operator") : (p.proposedBy ?? "A person")) },
              { key: "state", head: "State", width: "110px", cell: (p) => <Badge tone={PROPOSAL_TONE[p.state]} dot>{PROPOSAL_WORD[p.state]}</Badge> },
              { key: "by", head: "Decided", width: "220px", cell: (p) => (p.decidedBy ? `${p.decidedBy}, ${ago(p.decidedAt ?? p.createdAt)}${p.sha ? ` · ${p.sha}` : ""}` : "—") },
            ]}
          />
        ) : (
          <Table<ActivityItem>
            caption="Actions"
            rows={data.actions}
            rowKey={(a) => a.id}
            rowHref={(a) => a.href ?? null}
            empty="Nothing has happened yet."
            columns={[
              { key: "what", head: "What", cell: (a) => a.text },
              { key: "detail", head: "Detail", width: "36%", cell: (a) => a.detail ?? "" },
              { key: "who", head: "By", width: "120px", cell: (a) => a.actor ?? "" },
              { key: "at", head: "When", width: "160px", cell: (a) => when(a.at) },
            ]}
          />
        )}
      </Card>
      {all > listed ? (
        <p className="dk-operator-more-line">
          The newest {listed} of {all} are shown.
        </p>
      ) : null}
    </div>
  );
}
