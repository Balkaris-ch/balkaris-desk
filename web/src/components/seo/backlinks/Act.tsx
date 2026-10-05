"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { JobAnswer } from "@/contract/common";
import type { NewTask, TaskAnswer } from "@/contract/operator";
import type { BacklinksAnswer, LinkCheckAnswer } from "@/contract/seo/backlinks";
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
 *   Mark done            a person's mark on an owner task (POST /api/v1/seo/owner-tasks/:id)
 *   Check profiles now   the weekly profile check, run ahead of its turn
 *                        (POST /api/v1/jobs/seo-presence/run); the page then follows
 *                        the run and draws itself again when it ends
 *   Read links now       the daily read of referring pages and followed links
 *                        (POST /api/v1/jobs/seo-backlinks/run), followed the same way
 *   Check (a profile)    asks that one address now (POST /api/v1/seo/backlinks/profiles/:key/check)
 *   It is ours / Not ours  an address the weekly check found (…/profiles/:key/found)
 *   Read again, Follow, Stop following   one linking page (…/links/:id, …/links/:id/check)
 *   Draft …              an operator brief for the studio workstation's local model
 *                        (POST /api/v1/operator/tasks)
 */

/** A button's sentence, beside it. */
export function Said({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <span className={cx("dk-seo-bl-said", !message.ok && "dk-seo-bl-said--bad")} role={message.ok ? "status" : "alert"}>
      {message.text}
    </span>
  );
}

/* ---------- following a run until it ends ------------------------------------------------- */

/** Sent by a button that started a job, so the page follows it closely for a while. */
const ASKED = "dk-seo-bl-asked";

/**
 * Keeps the page current while a job it started runs: the server draws it
 * again every four seconds while `busy` (a job of this page is running) or for
 * ninety seconds after a button asked for one, and not at all otherwise.
 * Nothing is asked while the tab is hidden. The desk draws this page from its
 * own database, so a redraw costs no quota anywhere.
 */
export function Follow({ busy }: { busy: boolean }) {
  const router = useRouter();
  const askedAt = useRef(0);
  const [asks, setAsks] = useState(0);
  useEffect(() => {
    const asked = () => {
      askedAt.current = Date.now();
      setAsks((n) => n + 1);
    };
    window.addEventListener(ASKED, asked);
    return () => window.removeEventListener(ASKED, asked);
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => busy || Date.now() - askedAt.current < 90_000;
    const plan = () => {
      clearTimeout(timer);
      if (!document.hidden && close()) timer = setTimeout(tick, 4_000);
    };
    function tick() {
      router.refresh();
      plan();
    }
    const seen = () => (document.hidden ? clearTimeout(timer) : plan());
    document.addEventListener("visibilitychange", seen);
    plan();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", seen);
    };
  }, [router, busy, asks]);
  return null;
}

const announce = (): void => {
  window.dispatchEvent(new Event(ASKED));
};

/* ---------- owner tasks ----------------------------------------------------------------------- */

/** Mark an owner task done, or open again. A person's mark: the desk never sets it. `note` goes with a done mark (what was decided). */
export function MarkDone({ id, done, size = "xs", note }: { id: string; done: boolean; size?: ButtonSize; note?: string | null }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-bl-act">
      <Button
        variant={done ? "ghost" : "good"}
        size={size}
        icon={done ? "refresh" : "check"}
        disabled={busy}
        aria-busy={busy || undefined}
        title={!done && note ? `Marks it done with the note: ${note}` : undefined}
        onClick={() =>
          void go<OwnerTaskAnswer>(`/api/v1/seo/owner-tasks/${encodeURIComponent(id)}`, { done: !done, ...(!done && note ? { note: note.slice(0, 500) } : {}) }, (v) =>
            v.task.done ? `Marked done by ${v.task.doneBy ?? "you"}.` : "Open again.",
          )
        }
      >
        {busy ? "Asking…" : done ? "Open again" : "Mark done"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/* ---------- jobs ------------------------------------------------------------------------------ */

/** Run one of this page's jobs now; the page then follows it until it ends. */
export function RunJob({ job, label, title, disabled, why }: { job: "seo-presence" | "seo-backlinks"; label: string; title: string; disabled: boolean; why: string | null }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-bl-act dk-seo-bl-act--head">
      <Button
        size="sm"
        icon="refresh"
        disabled={busy || disabled}
        aria-busy={busy || undefined}
        title={why ?? title}
        onClick={() =>
          void go<JobAnswer>(`/api/v1/jobs/${job}/run`, {}, () => {
            announce();
            return "Asked for: it runs next in the desk's queue. This page follows it and draws itself again when it ends.";
          })
        }
      >
        {busy ? "Asking…" : label}
      </Button>
      <Said message={message} />
    </span>
  );
}

/* ---------- profiles -------------------------------------------------------------------------- */

/** Ask one profile's address now. */
export function CheckProfile({ profileKey, name, disabled }: { profileKey: string; name: string; disabled: string | null }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-bl-act">
      <Button
        size="xs"
        variant="ghost"
        icon="refresh"
        disabled={busy || !!disabled}
        aria-busy={busy || undefined}
        title={disabled ?? `Ask ${name}'s address now, once, under the desk's name`}
        onClick={() => void go<BacklinksAnswer>(`/api/v1/seo/backlinks/profiles/${encodeURIComponent(profileKey)}/check`, {}, (v) => v.line)}
      >
        {busy ? "Asking…" : "Check"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/** An address the weekly check found for a row without one: the studio's, or not. Never used until a person says. */
export function FoundChoice({ profileKey }: { profileKey: string }) {
  const { go, busy, message } = useSend();
  const say = (use: boolean) => void go<BacklinksAnswer>(`/api/v1/seo/backlinks/profiles/${encodeURIComponent(profileKey)}/found`, { use }, (v) => v.line);
  return (
    <span className="dk-seo-bl-act">
      <span className="dk-seo-bl-pair">
        <Button size="xs" variant="good" icon="check" disabled={busy} onClick={() => say(true)} title="It is the studio's: it becomes this row's address and is asked on the next check">
          It is ours
        </Button>
        <Button size="xs" variant="ghost" icon="x" disabled={busy} onClick={() => say(false)} title="Not the studio's: the desk does not offer it again">
          Not ours
        </Button>
      </span>
      <Said message={message} />
    </span>
  );
}

/* ---------- links ----------------------------------------------------------------------------- */

/** Read one linking page again now, and follow it or stop following it. */
export function LinkActions({ id, tracked }: { id: number; tracked: boolean }) {
  const read = useSend();
  const mark = useSend();
  const message = mark.message ?? read.message;
  return (
    <span className="dk-seo-bl-act">
      <span className="dk-seo-bl-pair">
        <Button
          size="xs"
          variant="ghost"
          icon="refresh"
          disabled={read.busy}
          aria-busy={read.busy || undefined}
          title="Read this page again now, under the desk's name"
          onClick={() => {
            mark.setMessage(null);
            void read.go<LinkCheckAnswer>(`/api/v1/seo/backlinks/links/${id}/check`, {}, (v) => v.line);
          }}
        >
          {read.busy ? "Reading…" : "Read again"}
        </Button>
        <Button
          size="xs"
          variant={tracked ? "ghost" : "quiet"}
          icon={tracked ? "x" : "eye"}
          disabled={mark.busy}
          aria-busy={mark.busy || undefined}
          title={tracked ? "Stop following: the weekly reading of this page stops being yours" : "Follow it: the desk reads the page every week and says when the link appears or goes"}
          onClick={() => {
            read.setMessage(null);
            void mark.go<BacklinksAnswer>(`/api/v1/seo/backlinks/links/${id}`, { tracked: !tracked }, (v) => v.line);
          }}
        >
          {mark.busy ? "Asking…" : tracked ? "Stop following" : "Follow"}
        </Button>
      </span>
      <Said message={message} />
    </span>
  );
}

/** Follow a page by its address, from a check's answer. */
export function FollowPage({ url, label = "Follow this page" }: { url: string; label?: string }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-bl-act">
      <Button
        size="xs"
        variant="quiet"
        icon="eye"
        disabled={busy}
        aria-busy={busy || undefined}
        title="The desk reads this page once a week and says when a link appears or goes"
        onClick={() => void go<BacklinksAnswer>("/api/v1/seo/backlinks/links", { url }, (v) => v.line)}
      >
        {busy ? "Asking…" : label}
      </Button>
      <Said message={message} />
    </span>
  );
}

/* ---------- the local model ---------------------------------------------------------------------- */

/** Queue one operator task, from a button: answered by the studio workstation's own model. */
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
          void go<TaskAnswer>("/api/v1/operator/tasks", task, (v) => `Queued as operator task #${v.task.id}${v.task.ahead ? `, behind ${v.task.ahead}` : ""}. The studio workstation answers when it is on; the answer is on AI Operator.`)
        }
      >
        {busy ? "Asking…" : label}
      </Button>
      <Said message={message} />
    </span>
  );
}
