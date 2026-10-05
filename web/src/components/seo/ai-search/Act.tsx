"use client";

import type { NewTask, TaskAnswer } from "@/contract/operator";
import type { AiDone } from "@/contract/seo/ai-search";
import type { OpportunitiesActed, OwnerTaskAnswer } from "@/contract/seo/common";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import type { IconName } from "@/components/ui/icons";
import { useSend } from "@/components/operator/send";
import { actedLine, queuedLine, Said } from "@/components/seo/overview/Act";
import { cx } from "@/lib/cx";
import { API } from "./look";
import "@/components/seo/overview/overview.css";

/**
 * AI Search's buttons that change something. Each posts to this page's own
 * address (/api/v1/seo/ai-search/…), so the owner's switch for AI Search
 * decides who may press them; until they did, they posted to the Overview's
 * addresses and followed the Overview's switch. The server answers in a
 * sentence, shown beside the button, and the page is drawn again. The look
 * is the Overview's own (overview/Act.tsx), so the section reads as one.
 */

type Look = { variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; title?: string; className?: string };

/** Any of this page's changes that answers { ok, line }: run the check now, check a page again, retire a question. */
export function PostButton({ path, body = {}, label, busyLabel = "Asking…", confirm, variant = "quiet", size = "xs", icon, title, className }: Look & { path: string; body?: unknown; label: string; busyLabel?: string; confirm?: string }) {
  const { go, busy, message } = useSend();
  return (
    <span className={cx("dk-seo-overview-act", className)}>
      <Button
        variant={variant}
        size={size}
        icon={icon}
        title={title}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => {
          /* A removal cannot be taken back from this page: the browser's own question, said plainly. */
          if (confirm && !window.confirm(confirm)) return;
          void go<AiDone>(`${API}${path}`, body, (v) => v.line);
        }}
      >
        {busy ? busyLabel : label}
      </Button>
      <Said message={message} className="dk-seo-overview-said--row" />
    </span>
  );
}

/** Take one opportunity's action, from a row: a brief or a proposal queues an operator task, a code step is marked for the website's code. */
export function AiActButton({ id, label, variant = "good", size = "xs", icon, title }: Look & { id: string; label: string }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-overview-act">
      <Button variant={variant} size={size} icon={icon} title={title} disabled={busy} aria-busy={busy || undefined} onClick={() => void go<OpportunitiesActed>(`${API}/act`, { ids: [id] }, actedLine)}>
        {busy ? "Asking…" : label}
      </Button>
      <Said message={message} className="dk-seo-overview-said--row" />
    </span>
  );
}

/** Queue one task for the operator, which runs on the studio workstation's own model. */
export function AiTaskButton({ task, label, variant = "quiet", size = "xs", icon, className }: Look & { task: NewTask; label: string }) {
  const { go, busy, message } = useSend();
  return (
    <span className={cx("dk-seo-overview-act", className)}>
      <Button variant={variant} size={size} icon={icon} disabled={busy} aria-busy={busy || undefined} onClick={() => void go<TaskAnswer>(`${API}/task`, task, queuedLine)}>
        {busy ? "Asking…" : label}
      </Button>
      <Said message={message} className="dk-seo-overview-said--row" />
    </span>
  );
}

/** Mark an owner task done, or open again. A person's mark: the desk never sets it. */
export function AiOwnerMark({ id, done }: { id: string; done: boolean }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-overview-act">
      <Button
        variant={done ? "ghost" : "good"}
        size="xs"
        icon={done ? "refresh" : "check"}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void go<OwnerTaskAnswer>(`${API}/owner`, { id, done: !done }, (v) => (v.task.done ? `Marked done by ${v.task.doneBy ?? "you"}.` : "Open again."))}
      >
        {busy ? "Asking…" : done ? "Open again" : "Mark done"}
      </Button>
      <Said message={message} className="dk-seo-overview-said--row" />
    </span>
  );
}
