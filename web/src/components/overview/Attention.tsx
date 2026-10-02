import type { AttentionItem, Reading, Tone } from "@/contract/common";
import type { AttentionPanel, AttentionRuleState } from "@/contract/overview";
import { Chip } from "@/components/ui/Badge";
import { LinkButton, type ButtonVariant } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { sourceLabel } from "@/lib/format";

/* As on the board: a fall is investigated in red, a weakness improved in red, good news viewed in green. */
const VARIANT: Record<Tone, ButtonVariant> = { bad: "danger", warn: "danger", good: "good", info: "quiet", quiet: "quiet" };

/** The rows themselves: tone dot, address, what the rule found, the area, and where it is acted on. */
export function AttentionRows({ items }: { items: readonly AttentionItem[] }) {
  return (
    <ul className="dk-overview-attn" aria-label="Attention required">
      {items.map((it) => (
        <li key={it.id} className="dk-overview-attnrow">
          <StatusDot tone={it.tone} title={it.tone === "bad" ? "Problem" : it.tone === "warn" ? "Weak spot" : it.tone === "good" ? "Good news" : "Housekeeping"} />
          <span className="dk-overview-attntext">
            <span className="dk-overview-attnsubject" title={it.subject}>
              {it.subject}
            </span>
            <span className="dk-overview-attnfound" title={it.text}>
              {it.text}
            </span>
          </span>
          <Chip caps className="dk-overview-attnarea">
            {it.area}
          </Chip>
          <LinkButton href={it.action.href} variant={VARIANT[it.tone]} size="sm" className="dk-overview-attnact">
            {it.action.label}
          </LinkButton>
        </li>
      ))}
    </ul>
  );
}

/** Which rules could not look, in one quiet line: "3 rules wait for Search Console and Engine". */
function Waiting({ rules, href }: { rules: readonly AttentionRuleState[]; href: string }) {
  const absent = rules.filter((r) => r.state !== "ok");
  if (!absent.length) return null;
  const sources = [...new Set(absent.map((r) => sourceLabel(r.source)))];
  return (
    <Go href={href} className="dk-overview-attnwait">
      {absent.length} of {rules.length} rules wait for {sources.join(", ").replace(/, ([^,]*)$/, " and $1")}
    </Go>
  );
}

/** No rows: "nothing needs attention" only when every rule could look; otherwise how many looked. */
export function NothingFound({ rules }: { rules: readonly AttentionRuleState[] }) {
  const looked = rules.filter((r) => r.state === "ok").length;
  const all = looked === rules.length;
  return (
    <Empty compact icon={all ? "check-circle" : "hourglass"} title={all ? "Nothing needs attention" : `Nothing found by the ${looked} ${looked === 1 ? "rule" : "rules"} that could look`}>
      {all ? "Every rule looked and found nothing." : "The others wait for their source; the line below names them."}
    </Empty>
  );
}

/** "Attention required" on the Command Center: the first three rows, worst first, and "View all (n)". */
export function AttentionCard({ reading, allHref }: { reading: Reading<AttentionPanel>; allHref: string }) {
  const total = reading.state === "ok" ? reading.value.total : null;
  return (
    <Card
      title="Attention required"
      icon="alert"
      tone="bad"
      divided
      className="dk-overview-attention"
      right={
        <LinkButton href={allHref} size="sm">
          {total === null ? "View all" : `View all (${total})`}
        </LinkButton>
      }
    >
      <Read reading={reading}>
        {(a, r) => (
          <>
            {a.items.length ? <AttentionRows items={a.items} /> : <NothingFound rules={a.rules} />}
            <p className="dk-overview-foot">
              <Stamp reading={r} />
              <Waiting rules={a.rules} href={allHref} />
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

/** Every rule, what it compares, and whether it could look: the second half of /attention. */
export function RuleList({ rules }: { rules: readonly AttentionRuleState[] }) {
  return (
    <ul className="dk-overview-rules" aria-label="The rules">
      {rules.map((r) => (
        <li key={r.id} className="dk-overview-rule">
          <StatusDot tone={r.state === "ok" ? (r.found ? "warn" : "good") : "quiet"} title={r.state === "ok" ? "Looked" : r.state === "waiting" ? "Waiting" : "Not connected"} />
          <span className="dk-overview-ruletext">
            <span className="dk-overview-rulehead">
              <b>{r.title}</b>
              <Chip caps>{r.area}</Chip>
              <span className="dk-overview-quiet">{sourceLabel(r.source)}</span>
            </span>
            <span className="dk-overview-rulewhat">{r.rule}</span>
            {r.state === "ok" ? (
              <span className="dk-overview-rulestate">{r.found === 0 ? "Looked and found nothing." : `Found ${r.found}.`}</span>
            ) : (
              <span className="dk-overview-rulestate">
                {r.state === "waiting" ? "Waiting: " : "Not connected: "}
                {r.reason}
                {r.step ? <span className="dk-overview-rulestep">{r.step}</span> : null}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
