"use client";

import { useState, useTransition } from "react";
import type { NewTask } from "@/contract/operator";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { queueTask, type Queued } from "./actions";

export interface QueueButtonProps {
  task: NewTask;
  /** The button's words. */
  label: string;
  /** What pressing it does, in one sentence: the tooltip and the screen reader's description. */
  step: string;
  icon?: IconName;
  /** "button" is a button; "row" is a quick-action line (icon, label, chevron); "mini" is a small button in a list. */
  look?: "button" | "row" | "mini";
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Null when it may be pressed; otherwise why not, shown instead of pressing. */
  blocked?: string | null;
  className?: string;
}

/**
 * A button that queues one operator task and then says, in place, what
 * happened: the task's number and that it waits for the studio workstation,
 * or the desk server's own sentence when it refused (too many tasks waiting,
 * nothing to write metadata for). It never says more than the server did.
 */
export function QueueButton({ task, label, step, icon = "sparkles", look = "button", variant = "quiet", size = "sm", blocked = null, className }: QueueButtonProps) {
  /* The answer belongs to the task it was given for: should React keep this
     button for another task (another page opened beside the list), the old
     answer is not shown for it. Callers also key it by page. */
  const which = JSON.stringify(task);
  const [answer, setAnswer] = useState<{ which: string; said: Queued } | null>(null);
  const said = answer?.which === which ? answer.said : null;
  const [busy, start] = useTransition();
  const press = () => {
    if (blocked || busy) return;
    start(async () => {
      try {
        setAnswer({ which, said: await queueTask(task) });
      } catch {
        setAnswer({ which, said: { ok: false, message: "The desk did not answer. Try again in a moment." } });
      }
    });
  };
  const done = said?.ok === true;

  const reply = said ? (
    <span className={cx("dk-seo-pages-queued", said.ok ? "dk-seo-pages-queued--ok" : "dk-seo-pages-queued--no")} role="status">
      {said.ok ? (
        <>
          <Icon name="check-circle" size={13} />
          <span>
            Queued as operator task #{said.id}. It runs on the studio workstation when it is on, and its answer is kept on AI Operator.{" "}
            {/* The queue, not ?result=: until the task is answered, the operator screen shows the newest answer of another task there. */}
            <Go href="/operator#current-tasks" className="dk-seo-pages-queued-link">
              See the queue
            </Go>
          </span>
        </>
      ) : (
        <>
          <Icon name="alert" size={13} />
          <span>{said.message}</span>
        </>
      )}
    </span>
  ) : null;

  if (look === "row") {
    return (
      <div className={cx("dk-seo-pages-qa", className)}>
        <button type="button" className="dk-seo-pages-qa-btn" onClick={press} disabled={Boolean(blocked) || busy || done} title={blocked ?? step}>
          <Icon name={icon} size={16} className="dk-seo-pages-qa-icon" />
          <span className="dk-seo-pages-qa-label">{busy ? "Queuing…" : label}</span>
          <Icon name={done ? "check" : "chevron-right"} size={14} className="dk-seo-pages-qa-go" />
        </button>
        {blocked ? <span className="dk-seo-pages-queued dk-seo-pages-queued--quiet">{blocked}</span> : reply}
      </div>
    );
  }

  return (
    <span className={cx("dk-seo-pages-qb", look === "mini" && "dk-seo-pages-qb--mini", className)}>
      <button type="button" className={buttonClass({ variant, size })} onClick={press} disabled={Boolean(blocked) || busy || done} title={blocked ?? step}>
        {look === "mini" ? null : <Icon name={icon} size={size === "md" ? 16 : 14} />}
        <span className="dk-btn-label">{busy ? "Queuing…" : done ? "Queued" : label}</span>
      </button>
      {reply}
    </span>
  );
}
