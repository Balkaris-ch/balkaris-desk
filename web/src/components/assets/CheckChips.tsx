import type { AssetCheck, CheckState } from "@/contract/assets";
import { Chip, type ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";

export const CHECK_TONE: Record<CheckState, ChipTone> = { pass: "good", warn: "warn", fail: "bad", note: "quiet" };
export const CHECK_ICON: Record<CheckState, IconName> = { pass: "check", warn: "alert", fail: "x-circle", note: "info" };
export const CHECK_WORD: Record<CheckState, string> = { pass: "Holds", warn: "Worth a look", fail: "Fails", note: "Noted" };

/** What a check says, for a tooltip: the rule's verdict, the sentence, the measured value against the limit. */
export function CheckText({ check }: { check: AssetCheck }) {
  return (
    <span className="dk-assets-tip">
      <b>
        {CHECK_WORD[check.state]}: {check.label}
      </b>
      <span>{check.text}</span>
      {check.measured !== null || check.limit !== null ? (
        <span className="dk-assets-tip-figures">
          {check.measured !== null ? `Measured: ${check.measured}` : ""}
          {check.measured !== null && check.limit !== null ? " · " : ""}
          {check.limit !== null ? `Limit: ${check.limit}` : ""}
        </span>
      ) : null}
    </span>
  );
}

/** One check as a chip, its rule on hover and focus. */
export function CheckChip({ check }: { check: AssetCheck }) {
  return (
    <Tooltip text={<CheckText check={check} />}>
      <span className="dk-assets-chip" tabIndex={0}>
        <Chip tone={CHECK_TONE[check.state]} icon={CHECK_ICON[check.state]}>
          {check.label}
        </Chip>
      </span>
    </Tooltip>
  );
}

/**
 * A row's checks in little room: what is broken, then what is worth a look,
 * up to `max` chips; the rest of those as "+2"; then one green chip counting
 * what holds. Notes (decoration, a re-encoded source) are facts, not
 * verdicts: they are in the opened file, not in the row.
 */
export function CheckSummary({ checks, max = 2 }: { checks: readonly AssetCheck[]; max?: number }) {
  const faults = [...checks.filter((c) => c.state === "fail"), ...checks.filter((c) => c.state === "warn")];
  const passes = checks.filter((c) => c.state === "pass");
  const shown = faults.slice(0, max);
  const rest = faults.slice(max);
  if (!faults.length && !passes.length) return <span className="dk-assets-none">No rule applies</span>;
  return (
    <span className="dk-assets-chips">
      {shown.map((c) => (
        <CheckChip key={c.id} check={c} />
      ))}
      {rest.length ? (
        <Tooltip
          text={
            <span className="dk-assets-tip">
              {rest.map((c) => (
                <span key={c.id}>
                  <b>{c.label}.</b> {c.text}
                </span>
              ))}
            </span>
          }
        >
          <span className="dk-assets-chip" tabIndex={0}>
            <Chip tone={rest.some((c) => c.state === "fail") ? "bad" : "warn"}>+{rest.length}</Chip>
          </span>
        </Tooltip>
      ) : null}
      {passes.length ? (
        <Tooltip
          text={
            <span className="dk-assets-tip">
              {passes.map((c) => (
                <span key={c.id}>
                  <b>{c.label}.</b> {c.text}
                </span>
              ))}
            </span>
          }
        >
          <span className="dk-assets-chip" tabIndex={0}>
            <Chip tone="good" icon="check">
              {faults.length ? passes.length : `${passes.length} ${passes.length === 1 ? "check holds" : "checks hold"}`}
            </Chip>
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
