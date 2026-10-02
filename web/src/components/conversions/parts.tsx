import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { GroupRow } from "@/contract/conversions";
import { Stamp } from "@/components/ui/Stamp";
import { Absent } from "@/components/ui/Read";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import type { BarListItem } from "@/components/charts/BarList";
import type { ChipTone } from "@/components/ui/Badge";
import { num, sourceLabel } from "@/lib/format";
import "./conversions.css";

/**
 * The small pieces every panel of the Conversions screen shares: a body that
 * keeps the source stamp at its foot, the absent state in a panel's place,
 * the specimen ribbon, and how a share is printed when the counts are small.
 */

/** A panel's body: its content, and at the foot the source, its age and the caveat on hover. */
export function PanelBody({ reading, children, extra }: { reading: Reading<unknown>; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="dk-conversions-body">
      <div className="dk-conversions-content">{children}</div>
      {/* A div, not a p: `extra` may be a dialog's trigger, and a <dialog> cannot sit in a paragraph. */}
      <div className="dk-conversions-foot">
        <Stamp reading={reading} />
        {extra}
      </div>
    </div>
  );
}

/**
 * A panel whose source has nothing to show: what is missing, why, and the
 * step, in the panel's own place. `compact` is for a narrow panel that must
 * keep the board's height: the step is cut to three lines there, and the
 * whole of it is a hover or a focus away.
 */
export function PanelAbsent({ reading, compact }: { reading: Reading<unknown>; compact?: boolean }) {
  if (reading.state === "ok") return null;
  if (!compact) return <Absent reading={reading} form="panel" className="dk-conversions-absent" />;
  const waiting = reading.state === "waiting";
  const step = reading.state === "off" ? reading.step : undefined;
  return (
    <div className="dk-conversions-gap">
      <p className="dk-conversions-gap-head">
        <Icon name={waiting ? "hourglass" : "minus"} size={14} />
        {waiting ? "Nothing yet" : "Not available"}
        {reading.source !== "none" ? <span className="dk-conversions-gap-from">{sourceLabel(reading.source)}</span> : null}
      </p>
      <p className="dk-conversions-gap-why">{reading.reason}</p>
      {step ? (
        <Tooltip text={step}>
          <span className="dk-conversions-gap-step" tabIndex={0}>
            <Icon name="arrow-right" size={14} />
            <span>{step}</span>
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** Under thirty events a share is noise: print the two counts it is made of instead. */
export const SMALL = 30;

/** "32%", or "3 of 12" while the whole is under thirty. */
export function shareOf(part: number, whole: number | null): string {
  if (whole === null || whole <= 0) return num(part);
  if (whole < SMALL) return `${num(part)} of ${num(whole)}`;
  const p = (part / whole) * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

/** Groups as BarList rows: the share (or the two counts) as the value, the count beside it. */
export function groupItems(rows: readonly GroupRow[], total: number | null, keep?: number): BarListItem[] {
  const shown = keep !== undefined && rows.length > keep ? rows.slice(0, keep - 1) : rows;
  const rest = rows.slice(shown.length);
  const items: BarListItem[] = shown.map((r) => ({ key: r.key, label: r.label, value: r.count, text: shareOf(r.count, total), second: total !== null && total >= SMALL ? num(r.count) : undefined }));
  if (rest.length) {
    const n = rest.reduce((a, r) => a + r.count, 0);
    items.push({ key: "other", label: `Other (${rest.length})`, value: n, text: shareOf(n, total), second: total !== null && total >= SMALL ? num(n) : undefined });
  }
  return items;
}

/** The engine's stages in plain words, with the tone their chip takes. */
const STAGES: Record<string, { label: string; tone: ChipTone }> = {
  received: { label: "Received", tone: "info" },
  processed: { label: "Processed", tone: "quiet" },
  expert_assigned: { label: "Expert assigned", tone: "violet" },
  meeting_confirmed: { label: "Meeting confirmed", tone: "good" },
  proposal_in_preparation: { label: "Proposal in preparation", tone: "warn" },
  proposal_ready: { label: "Proposal ready", tone: "good" },
};

/** A stage key as people say it. An unknown one is printed as it came, never guessed. */
export function stageOf(stage: string | null): { label: string; tone: ChipTone } {
  if (!stage) return { label: "No stage", tone: "quiet" };
  return STAGES[stage] ?? { label: stage.replace(/_/g, " "), tone: "quiet" };
}

/** An address as the engine sends it ("https://www.balkaris.ch/contact"), as the path the site's pages are known by. */
export function pathOf(page: string | null): string | null {
  if (!page) return null;
  try {
    const p = new URL(page, "https://www.balkaris.ch").pathname.replace(/\/+$/, "");
    return p || "/";
  } catch {
    return page;
  }
}

/** The development copy's specimen, said across the top of the screen with the way back to the real state. */
export function SpecimenRibbon({ href }: { href: string }) {
  return (
    <p className="dk-conversions-ribbon" role="status">
      <Icon name="flask" size={16} />
      <span>
        <b>Specimen data.</b> The engine&apos;s panels show artificial rows written into the route&apos;s own file, so the connected state can be looked at before the engine&apos;s key exists. None of it is an enquiry. GA4&apos;s panels are real.
      </span>
      <Go href={href} className="dk-conversions-ribbon-link" scroll={false}>
        Show the real state
      </Go>
    </p>
  );
}
