import type { OpportunityAction, OpportunityState } from "@/contract/seo/common";
import { Chip } from "@/components/ui/Badge";
import { LinkButton, type ButtonVariant } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { DASH } from "@/lib/format";
import { ActButton } from "./Act";

/**
 * What an opportunity's row offers in its Action cell, the same on Priority
 * Opportunities and Top keyword opportunities: its button when the action can
 * be taken now, what it is waiting on when it cannot, and never a second
 * button for work already queued.
 *
 *   proposal, brief   a button that queues the operator task (a proposal then waits for approval)
 *   chrome            a link to the step in Search Console, taken by hand in the owner's browser
 *   owner             "Needs you", down to the owner's steps
 *   code              "Steps": the change is made in the website's code, which no desk task
 *                     receives, so the row says what to change and dispatches nothing
 */

export type RowActionKind = OpportunityAction["kind"];

export interface RowActionProps {
  id: string;
  kind: RowActionKind;
  /** The action's own words; the button prints `actionWord(...)`, the words in full on hover. */
  label: string;
  step: string;
  href: string | null;
  available: boolean;
  why: string | null;
  state: OpportunityState;
  stateNote: string | null;
  /** The button's look when the action can be taken: green on Priority Opportunities, quiet in a long list. */
  variant?: ButtonVariant;
}

/** The words on a row's button, one per kind of action: short, the same wherever the row is drawn. */
export function actionWord(kind: RowActionKind, label: string): string {
  switch (kind) {
    case "proposal":
      return "Propose title";
    case "brief":
      return "Write brief";
    case "code":
      return "Steps";
    case "owner":
      return "Needs you";
    default:
      return label.length > 14 ? `${label.slice(0, 13).trimEnd()}…` : label;
  }
}

/** The opportunity's page on SEO › Opportunities, where its step is written out whole. */
export const opportunityHref = (id: string): string => `/seo/opportunities?open=${encodeURIComponent(id)}`;

export function RowAction({ id, kind, label, step, href, available, why, state, stateNote, variant = "good" }: RowActionProps) {
  if (state === "queued" || state === "in-progress") {
    /* A code change marked as handed over sits in no queue the desk can see: say what it is, not "Queued". */
    const handed = kind === "code";
    return (
      <Tooltip text={handed ? `${stateNote ?? "Marked as handed to the website's code."} No desk task receives it: the change is made in the website's code.` : (stateNote ?? why ?? undefined)}>
        <span tabIndex={0}>
          <Chip tone={handed ? "quiet" : "info"} icon={handed ? "check" : "clock"}>
            {handed ? "Handed over" : state === "queued" ? "Queued" : "In progress"}
          </Chip>
        </span>
      </Tooltip>
    );
  }
  if (kind === "owner") {
    return (
      <LinkButton href="#needs-you" size="xs" variant="quiet" title={step}>
        Needs you
      </LinkButton>
    );
  }
  if (kind === "code") {
    return (
      <LinkButton href={opportunityHref(id)} size="xs" variant="quiet" title={`${step} A change in the website's code: no desk task receives it.`}>
        Steps
      </LinkButton>
    );
  }
  if (kind === "chrome") {
    return href ? (
      <LinkButton href={href} size="xs" variant="quiet" iconRight="external" title={step}>
        {label === "Request indexing" ? "Inspect" : "Open"}
      </LinkButton>
    ) : (
      <LinkButton href={opportunityHref(id)} size="xs" variant="quiet" title={step}>
        Steps
      </LinkButton>
    );
  }
  if (!available) {
    return (
      <Tooltip text={why ?? undefined}>
        <span className="dk-seo-overview-wait" tabIndex={0}>
          {DASH}
          <span className="dk-sr">{why}</span>
        </span>
      </Tooltip>
    );
  }
  return <ActButton id={id} label={actionWord(kind, label)} variant={variant} title={`${label}. ${step}`} />;
}
