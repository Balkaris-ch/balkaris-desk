"use client";

import type { JobAnswer } from "@/contract/common";
import type { NewTask, TaskAnswer } from "@/contract/operator";
import type { OwnerTaskAnswer } from "@/contract/seo/common";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import type { IconName } from "@/components/ui/icons";
import { useSend } from "@/components/operator/send";
import { cx } from "@/lib/cx";

/**
 * The page's buttons that change something, each through the desk server,
 * which decides who may and refuses with a sentence shown beside the button.
 * None changes the live website:
 *
 *   Mark done          a person's mark on an owner task (POST /api/v1/seo/owner-tasks/:id)
 *   Check profiles now the weekly profile check, run ahead of its turn
 *                      (POST /api/v1/jobs/seo-presence/run): it asks each known
 *                      profile address once, three seconds apart
 *   Draft …            an operator brief, queued for the studio workstation
 *                      (POST /api/v1/operator/tasks)
 */

function Said({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <span className={cx("dk-seo-bl-said", !message.ok && "dk-seo-bl-said--bad")} role={message.ok ? "status" : "alert"}>
      {message.text}
    </span>
  );
}

/** Mark an owner task done, or open again. A person's mark: the desk never sets it. */
export function MarkDone({ id, done, size = "xs" }: { id: string; done: boolean; size?: ButtonSize }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-bl-act">
      <Button
        variant={done ? "ghost" : "good"}
        size={size}
        icon={done ? "refresh" : "check"}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void go<OwnerTaskAnswer>(`/api/v1/seo/owner-tasks/${encodeURIComponent(id)}`, { done: !done }, (v) => (v.task.done ? `Marked done by ${v.task.doneBy ?? "you"}.` : "Open again."))}
      >
        {busy ? "Asking…" : done ? "Open again" : "Mark done"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** Run the weekly profile check now. */
export function CheckProfiles({ disabled, why }: { disabled: boolean; why: string | null }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-bl-act dk-seo-bl-act--head">
      <Button
        size="sm"
        icon="refresh"
        disabled={busy || disabled}
        aria-busy={busy || undefined}
        title={why ?? "Ask each known profile address now whether it answers, three seconds apart, under the desk's name. Takes about a minute."}
        onClick={() => void go<JobAnswer>("/api/v1/jobs/seo-presence/run", {}, () => "Asked for: the check runs next in the desk's queue, about a minute. Draw the page again after it.")}
      >
        {busy ? "Asking…" : "Check profiles now"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** Queue one operator task, from a button. */
export function QueueTask({ task, label, title, variant = "quiet", size = "sm", icon = "sparkles" }: { task: NewTask; label: string; title: string; variant?: ButtonVariant; size?: ButtonSize; icon?: IconName }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-bl-act dk-seo-bl-act--head">
      <Button
        variant={variant}
        size={size}
        icon={icon}
        disabled={busy}
        aria-busy={busy || undefined}
        title={title}
        onClick={() =>
          void go<TaskAnswer>("/api/v1/operator/tasks", task, (v) => `Queued as operator task #${v.task.id}${v.task.ahead ? `, behind ${v.task.ahead}` : ""}. The studio workstation answers when it is on.`)
        }
      >
        {busy ? "Asking…" : label}
      </Button>
      <Said message={message} />
    </span>
  );
}
