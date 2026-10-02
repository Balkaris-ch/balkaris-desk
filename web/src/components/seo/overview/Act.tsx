"use client";

import type { NewTask, TaskAnswer } from "@/contract/operator";
import type { OpportunitiesActed } from "@/contract/seo/common";
import type { OwnerTaskAnswer } from "@/contract/seo/common";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import type { IconName } from "@/components/ui/icons";
import { useSend } from "@/components/operator/send";
import { cx } from "@/lib/cx";

/**
 * The Overview's buttons that change something, each through the desk
 * server, which decides who may and refuses with a sentence shown beside the
 * button. None changes the live website: an opportunity's action queues an
 * operator task (what it proposes waits in AI Operator › Approvals) or marks
 * a person's step as taken.
 */

const ACT = "/api/v1/seo/overview/act";
const OWNER = "/api/v1/seo/overview/owner";
/* Tasks queued from the Overview go through its own door: the same queue as AI Operator's, written to the SEO log. */
export const TASKS = "/api/v1/seo/overview/task";

/** What the desk said after an act, in one line. */
export function actedLine(v: OpportunitiesActed): string {
  const good = v.results.filter((r) => r.ok);
  const bad = v.results.filter((r) => !r.ok);
  if (v.results.length === 1) return v.results[0]!.line;
  return [good.length ? `${good.length} queued or marked.` : "", bad.length ? `${bad.length} not: ${bad[0]!.line}` : ""].filter(Boolean).join(" ");
}

export function queuedLine(v: TaskAnswer): string {
  return `Queued: ${v.task.title}${v.task.ahead ? `, behind ${v.task.ahead} other${v.task.ahead === 1 ? "" : "s"}` : ""}. The studio workstation answers when it is on.`;
}

/** The line under a button: the desk's answer, or its refusal. */
export function Said({ message, className }: { message: { ok: boolean; text: string } | null; className?: string }) {
  if (!message) return null;
  return (
    <p className={cx("dk-seo-overview-said", !message.ok && "dk-seo-overview-said--bad", className)} role={message.ok ? "status" : "alert"}>
      {message.text}
    </p>
  );
}

/** Take one opportunity's action, from a row. */
export function ActButton({ id, label, variant = "good", size = "xs", icon, title }: { id: string; label: string; variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; title?: string }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-overview-act">
      <Button variant={variant} size={size} icon={icon} disabled={busy} aria-busy={busy || undefined} title={title} onClick={() => void go<OpportunitiesActed>(ACT, { ids: [id] }, actedLine)}>
        {busy ? "Asking…" : label}
      </Button>
      <Said message={message} className="dk-seo-overview-said--row" />
    </span>
  );
}

/** Queue one operator task (a suggestion, a fix), from a button. */
export function TaskButton({ task, label, variant = "quiet", size = "xs", icon, className }: { task: NewTask; label: string; variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; className?: string }) {
  const { go, busy, message } = useSend();
  return (
    <span className={cx("dk-seo-overview-act", className)}>
      <Button variant={variant} size={size} icon={icon} disabled={busy} aria-busy={busy || undefined} onClick={() => void go<TaskAnswer>(TASKS, task, queuedLine)}>
        {busy ? "Asking…" : label}
      </Button>
      <Said message={message} className="dk-seo-overview-said--row" />
    </span>
  );
}

/** Mark an owner task done, or open again. A person's mark: the desk never sets it. */
export function OwnerMark({ id, done }: { id: string; done: boolean }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-overview-act">
      <Button
        variant={done ? "ghost" : "good"}
        size="xs"
        icon={done ? "refresh" : "check"}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void go<OwnerTaskAnswer>(OWNER, { id, done: !done }, (v) => (v.task.done ? `Marked done by ${v.task.doneBy ?? "you"}.` : "Open again."))}
      >
        {busy ? "Asking…" : done ? "Open again" : "Mark done"}
      </Button>
      <Said message={message} className="dk-seo-overview-said--row" />
    </span>
  );
}
