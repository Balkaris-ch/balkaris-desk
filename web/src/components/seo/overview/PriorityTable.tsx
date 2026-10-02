"use client";

import { useMemo, useState } from "react";
import type { OpportunitiesActed, OpportunityRow } from "@/contract/seo/common";
import type { PriorityPanel } from "@/contract/seo/overview";
import { Chip } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import { useSend } from "@/components/operator/send";
import { cx } from "@/lib/cx";
import { DASH, num } from "@/lib/format";
import { actedLine, Said } from "./Act";
import { PRIORITY_TONE, PRIORITY_WORD, TYPE_TONE } from "./bits";
import { opportunityHref, RowAction } from "./RowAction";

/* Five rows, as on the boards: two-line titles make each row taller than the boards' one-line keywords. */
const SHOWN = 5;

/** The rows a filter keeps: its types (or all) and its priority (or any). */
const keeps = (f: PriorityPanel["filters"][number], r: OpportunityRow): boolean => (!f.types || f.types.includes(r.type)) && (!f.priority || r.priority === f.priority);

/** Ticked rows go to the operator together: only actions that queue an operator task, and only when they can be taken now. */
const bulkable = (r: OpportunityRow): boolean => r.action.available && (r.action.kind === "proposal" || r.action.kind === "brief");

/** "position 9.4 → 3": Google's average position now and the one our estimate aims at, when the row has one. */
function positions(r: OpportunityRow): string | null {
  const now = r.evidence.find((e) => e.label === "Average position")?.value ?? null;
  if (!now) return null;
  return r.potential ? `position ${now} → ${r.potential.targetPosition}` : `position ${now}`;
}


/**
 * Priority Opportunities, the board's table: filter chips with real counts,
 * the highest-ranked rows, a tick box on each row whose action queues an
 * operator task, and the action itself. "Queue selected" sends the ticked
 * rows to the operator together; what it proposes waits for approval.
 */
export function PriorityTable({ panel }: { panel: PriorityPanel }) {
  const [filter, setFilter] = useState(panel.filters[0]?.key ?? "all");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const bulk = useSend();
  const f = panel.filters.find((x) => x.key === filter) ?? panel.filters[0]!;
  const rows = useMemo(() => {
    const byId = new Map(panel.rows.map((r) => [r.id, r]));
    const listed = (f.ids ?? []).map((id) => byId.get(id)).filter((r): r is OpportunityRow => !!r);
    return (listed.length ? listed : panel.rows.filter((r) => keeps(f, r))).slice(0, SHOWN);
  }, [panel.rows, f]);
  const chosen = [...picked].filter((id) => panel.rows.some((r) => r.id === id && bulkable(r)));

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const queue = async () => {
    const r = await bulk.go<OpportunitiesActed>("/api/v1/seo/overview/act", { ids: chosen }, actedLine);
    if (r.ok) setPicked(new Set());
  };

  return (
    <div className="dk-seo-overview-prio-panel">
      <div className="dk-seo-overview-chips" role="group" aria-label="Show opportunities of one kind">
        {panel.filters
          .filter((x) => x.count > 0 || x.key === "all")
          .map((x) => (
            <button key={x.key} type="button" className={cx("dk-seo-overview-chip", x.key === f.key && "dk-seo-overview-chip--on")} aria-pressed={x.key === f.key} onClick={() => setFilter(x.key)}>
              <span>{x.label}</span>
              <span className="dk-seo-overview-chip-n dk-num">{num(x.count)}</span>
            </button>
          ))}
      </div>

      <div className="dk-seo-overview-scroll">
        <table className="dk-seo-overview-table dk-seo-overview-prio-table">
          <caption className="dk-sr">Priority opportunities: {f.label}</caption>
          <thead>
            <tr>
              <th scope="col" className="dk-seo-overview-pick">
                <span className="dk-sr">Choose</span>
              </th>
              <th scope="col">Opportunity</th>
              <th scope="col" className="dk-seo-overview-col-type">
                Type
              </th>
              <th scope="col" className="dk-seo-overview-num">
                <Tooltip text="Our estimate: clicks a month it could add, from Google’s real impressions and our stated click-through curve. Absent where Google shows nothing to estimate from.">
                  <span tabIndex={0}>Our est.</span>
                </Tooltip>
              </th>
              <th scope="col">Action</th>
              <th scope="col" className="dk-seo-overview-more">
                <span className="dk-sr">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const subject = r.subject.page?.path ?? r.subject.keyword ?? r.subject.cluster?.name ?? null;
              const pos = positions(r);
              return (
                <tr key={r.id}>
                  <td className="dk-seo-overview-pick">
                    {bulkable(r) ? (
                      <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Choose: ${r.title}`} />
                    ) : (
                      <input type="checkbox" disabled aria-label={`${r.title}: its action is not an operator task`} />
                    )}
                  </td>
                  <td className="dk-seo-overview-opp">
                    <span className={cx("dk-seo-overview-opp-dot", `dk-tone-${PRIORITY_TONE[r.priority]}`)} title={`${PRIORITY_WORD[r.priority]} priority: ${r.priorityWhy}`} aria-hidden />
                    <span className="dk-seo-overview-opp-text">
                      <span className="dk-seo-overview-opp-title" title={r.title}>
                        {r.title}
                      </span>
                      <span className="dk-seo-overview-opp-sub">
                        <span className="dk-sr">{PRIORITY_WORD[r.priority]} priority. </span>
                        <span className="dk-seo-overview-opp-typed">{r.typeLabel} · </span>
                        {subject && subject !== r.title ? subject : r.early ? "Early signal" : `${PRIORITY_WORD[r.priority]} priority`}
                        {pos ? ` · ${pos}` : ""}
                      </span>
                    </span>
                  </td>
                  <td className="dk-seo-overview-col-type">
                    <Chip tone={TYPE_TONE[r.type]} className="dk-seo-overview-type">
                      {r.typeLabel}
                    </Chip>
                  </td>
                  <td className="dk-seo-overview-num dk-num">
                    {r.potential ? (
                      <Tooltip text={r.potential.basis}>
                        <span className="dk-seo-overview-gain" tabIndex={0}>
                          +{num(r.potential.clicksPerMonth, 1)}/mo
                        </span>
                      </Tooltip>
                    ) : (
                      <span className="dk-seo-overview-quiet" title="Google shows nothing to estimate from: no impressions.">
                        {DASH}
                      </span>
                    )}
                  </td>
                  <td>
                    <RowAction
                      id={r.id}
                      kind={r.action.kind}
                      label={r.action.label}
                      step={r.action.step}
                      href={r.action.href}
                      available={r.action.available}
                      why={r.action.why}
                      state={r.state.state}
                      stateNote={r.state.note}
                    />
                  </td>
                  <td className="dk-seo-overview-more">
                    <Go href={opportunityHref(r.id)} aria-label={`Open: ${r.title}`} className="dk-seo-overview-more-link">
                      <Icon name="more" size={16} />
                    </Go>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="dk-seo-overview-prio-foot">
        <Go href="/seo/opportunities" className="dk-seo-overview-footlink">
          <Icon name="arrow-right" size={14} />
          View all opportunities
        </Go>
        {chosen.length ? (
          <span className="dk-seo-overview-bulk">
            <Button size="xs" variant="primary" icon="send" disabled={bulk.busy} onClick={() => void queue()}>
              {bulk.busy ? "Asking…" : `Queue ${chosen.length} for the operator`}
            </Button>
          </span>
        ) : (
          <span className="dk-seo-overview-quiet dk-seo-overview-bulk-hint">Tick rows to queue them together. What the operator proposes waits for approval.</span>
        )}
      </div>
      <Said message={bulk.message} />
    </div>
  );
}
