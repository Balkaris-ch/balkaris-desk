import type { OpportunityRow, OpportunityType } from "@/contract/seo/common";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardFoot } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { ActButton } from "@/components/seo/overview/Act";
import { PRIORITY_TONE, PRIORITY_WORD, TYPE_TONE } from "@/components/seo/overview/bits";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import "@/components/ui/table.css";
import "./ai-search.css";

/**
 * What to change on the site so an assistant can quote it: the open
 * opportunities that are AI readiness (a direct answer, questions answered)
 * and German pages, the two kinds side by side, and the counts of every kind
 * that decides AI answers, each leading to its list in Opportunities. A
 * button queues the operator task (a brief, or a proposal that waits for
 * approval); nothing changes the live site by itself.
 */
export function Opps({ rows, types }: { rows: OpportunityRow[]; types: { type: OpportunityType; label: string; count: number; href: string }[] }) {
  const total = types.reduce((n, t) => n + t.count, 0);
  return (
    <Card
      title="What to change on the site"
      icon="lightbulb"
      flush
      className="dk-seo-ai-search-panel"
      info="Open opportunities the engine found (src/cc/seo/rules.ts) of the kinds that decide whether an assistant can quote the site. A brief or a proposal is an operator task on the studio workstation; a proposal waits for a person's approval before anything reaches the website."
      sub={`${num(total)} open of these kinds`}
      right={<LinkButton href="/seo/opportunities" size="sm">View all</LinkButton>}
      footer={<CardFoot href="/seo/opportunities?type=missing-answer">All AI-readiness opportunities</CardFoot>}
    >
      <div className="dk-seo-ai-search-types dk-seo-ai-search-pad-x">
        {types.map((t) => (
          <Go key={t.type} href={t.href} className="dk-seo-ai-search-type">
            <Chip tone={TYPE_TONE[t.type]}>{t.label}</Chip>
            <span className="dk-num">{num(t.count)}</span>
          </Go>
        ))}
      </div>
      {rows.length ? (
        <>
        <div className="dk-table-wrap dk-seo-ai-search-wide">
          <table className="dk-table dk-table--dense dk-table--caps dk-seo-ai-search-opps">
            <caption className="dk-sr">Open AI-readiness and German-page opportunities</caption>
            <thead>
              <tr>
                <th scope="col">Opportunity</th>
                <th scope="col">Type</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const subject = r.subject.page?.path ?? r.subject.cluster?.name ?? r.subject.keyword ?? null;
                return (
                  <tr key={r.id}>
                    <td className="dk-seo-ai-search-opp">
                      <span className={cx("dk-seo-ai-search-dot", `dk-tone-${PRIORITY_TONE[r.priority]}`)} title={`${PRIORITY_WORD[r.priority]} priority: ${r.priorityWhy}`} aria-hidden />
                      <Go href={`/seo/opportunities?open=${encodeURIComponent(r.id)}`} className="dk-seo-ai-search-opp-text">
                        <span className="dk-seo-ai-search-opp-title">{r.title}</span>
                        <span className="dk-seo-ai-search-quiet">
                          <span className="dk-sr">{PRIORITY_WORD[r.priority]} priority. </span>
                          {subject && subject !== r.title ? subject : `${PRIORITY_WORD[r.priority]} priority`}
                        </span>
                      </Go>
                    </td>
                    <td>
                      <Chip tone={TYPE_TONE[r.type]}>{r.typeLabel}</Chip>
                    </td>
                    <td className="dk-seo-ai-search-opp-act">
                      {r.action.available && (r.action.kind === "brief" || r.action.kind === "proposal") ? (
                        <ActButton id={r.id} label={r.action.label} />
                      ) : (
                        <span className="dk-seo-ai-search-quiet" title={r.action.why ?? r.action.step}>
                          {r.state.task ? `Task #${r.state.task.id} ${r.state.task.state}` : r.action.label}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* A phone: each opportunity a card with its type and its button in view. */}
        <ul className="dk-seo-ai-search-narrow dk-seo-ai-search-opp-cards" aria-label="Open AI-readiness and German-page opportunities">
          {rows.map((r) => {
            const subject = r.subject.page?.path ?? r.subject.cluster?.name ?? r.subject.keyword ?? null;
            return (
              <li key={r.id} className="dk-seo-ai-search-opp-card">
                <Go href={`/seo/opportunities?open=${encodeURIComponent(r.id)}`} className="dk-seo-ai-search-opp-card-text">
                  <span className="dk-seo-ai-search-opp-card-title">
                    <span className={cx("dk-seo-ai-search-dot", `dk-tone-${PRIORITY_TONE[r.priority]}`)} aria-hidden />
                    {r.title}
                  </span>
                  <span className="dk-seo-ai-search-quiet">
                    {PRIORITY_WORD[r.priority]} priority{subject && subject !== r.title ? ` · ${subject}` : ""}
                  </span>
                </Go>
                <div className="dk-seo-ai-search-opp-card-act">
                  <Chip tone={TYPE_TONE[r.type]}>{r.typeLabel}</Chip>
                  {r.action.available && (r.action.kind === "brief" || r.action.kind === "proposal") ? (
                    <ActButton id={r.id} label={r.action.label} />
                  ) : (
                    <span className="dk-seo-ai-search-quiet">{r.state.task ? `Task #${r.state.task.id} ${r.state.task.state}` : r.action.label}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        </>
      ) : (
        <p className="dk-seo-ai-search-pad dk-seo-ai-search-quiet">No open opportunity of these kinds: the engine finds none, or it has not run.</p>
      )}
    </Card>
  );
}
