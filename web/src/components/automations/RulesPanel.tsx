import type { Reading } from "@/contract/common";
import type { AlertRule } from "@/contract/automations";
import { Chip } from "@/components/ui/Badge";
import { CardFoot, Card } from "@/components/ui/Card";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { Tooltip } from "@/components/ui/Tooltip";
import { sourceLabel } from "@/lib/format";

/**
 * The rules behind the Command Center's "Attention required": what each one
 * watches, with its threshold, and whether what it reads is connected. The
 * rules are the Command Center's; they are listed here so the automatic
 * part of the desk is in one place.
 */
export function RulesPanel({ reading }: { reading: Reading<AlertRule[]> }) {
  return (
    <Card
      title="Alert rules"
      icon="bell"
      count={reading.state === "ok" ? reading.value.length : undefined}
      sub="What puts a row in Attention required"
      footer={<CardFoot href="/">Attention required, on the Command Center</CardFoot>}
    >
      <Read reading={reading}>
        {(rules, ok) => (
          <div className="dk-automations-rules">
            {rules.length ? (
              <ul className="dk-automations-rules-list">
                {rules.map((r) => (
                  <li key={r.id} className="dk-automations-rule">
                    <div className="dk-automations-rule-head">
                      {r.area ? <Chip caps>{r.area}</Chip> : null}
                      <b>{r.title}</b>
                      <RuleState rule={r} />
                    </div>
                    <p className="dk-automations-rule-text">{r.rule}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dk-automations-quiet">The rules module lists no rules.</p>
            )}
            <Stamp reading={ok} />
          </div>
        )}
      </Read>
    </Card>
  );
}

function RuleState({ rule: r }: { rule: AlertRule }) {
  const from = r.source ? sourceLabel(r.source) : null;
  if (!r.state || r.state === "ok") {
    return (
      <StatusDot tone="good" className="dk-automations-rule-state">
        {from ? `Reads ${from}` : "Ready"}
      </StatusDot>
    );
  }
  const dot = <StatusDot tone="warn">{from ? `Waits for ${from}` : "Waiting"}</StatusDot>;
  if (!r.reason && !r.step) return <span className="dk-automations-rule-state">{dot}</span>;
  /* The reason and the step are on hover and on focus; the tooltip's own span is the flex item, so it carries the class. */
  return (
    <Tooltip
      className="dk-automations-rule-state"
      text={
        <>
          {r.reason}
          {r.step ? <span className="dk-automations-tip-step">{r.step}</span> : null}
        </>
      }
    >
      <span tabIndex={0}>{dot}</span>
    </Tooltip>
  );
}
