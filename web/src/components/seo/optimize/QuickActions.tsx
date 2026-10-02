"use client";

import { useState } from "react";
import type { TaskAnswer } from "@/contract/operator";
import type { QuickAction } from "@/contract/seo/page-view";
import { useSend } from "@/components/operator/send";
import { buttonClass } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

/* As on the board: an icon on the first and the last button only, so the five fit one row. */
const ICON: Partial<Record<QuickAction["key"], IconName>> = { optimize: "sparkles", schema: "code" };

/**
 * "Quick actions" (board 115): each button queues one real operator task for
 * this page (POST /api/v1/operator/tasks). The operator runs on the studio
 * workstation's model, so a task waits while it is off; a title or
 * description it writes waits for a person's approval. A button whose task is
 * already queued or running stays off until that task is done, so one press
 * is one task. The line under the buttons says what was queued, or the
 * desk's refusal word for word.
 */
export function QuickActions({ actions, runnerLine }: { actions: QuickAction[]; runnerLine: string }) {
  const { go, busy, message } = useSend();
  const [asked, setAsked] = useState<{ id: number; label: string } | null>(null);
  const [which, setWhich] = useState<string | null>(null);
  /* Pressed and taken in this visit: off at once, before the server's next draw says so. */
  const [sent, setSent] = useState<string[]>([]);
  const pending = actions.filter((a) => a.pending);
  return (
    <section className="dk-card dk-seo-optimize-panel dk-seo-optimize-quick" aria-label="Quick actions">
      <header className="dk-card-head">
        <h2 className="dk-card-title">
          <span className="dk-card-title-text">Quick actions</span>
        </h2>
      </header>
      <div className="dk-card-body">
        <div className="dk-seo-optimize-quick-row">
          {actions.map((a, i) => {
            const icon = busy && which === a.key ? "hourglass" : ICON[a.key];
            return (
              <button
                key={a.key}
                type="button"
                className={buttonClass({ variant: i === 0 ? "primary" : "quiet", size: "sm" }, "dk-seo-optimize-quick-btn")}
                disabled={busy || !a.available || sent.includes(a.key)}
                title={a.available ? a.step : (a.unavailable ?? undefined)}
                onClick={() => {
                  setWhich(a.key);
                  void go<TaskAnswer>("/api/v1/operator/tasks", a.task, (v) => {
                    setAsked({ id: v.task.id, label: a.label });
                    setSent((s) => [...s, a.key]);
                    return null;
                  });
                }}
              >
                {icon ? <Icon name={icon} size={14} /> : null}
                <span>{a.label}</span>
              </button>
            );
          })}
        </div>
        <p className={cx("dk-seo-optimize-said", message && !message.ok && "dk-seo-optimize-said--bad")} aria-live="polite">
          {message && !message.ok ? (
            message.text
          ) : asked ? (
            <>
              “{asked.label}” is queued as operator task #{asked.id}. {runnerLine}{" "}
              <Go href={`/operator?result=${asked.id}#response`} className="dk-seo-optimize-link">
                Follow it in AI Operator
              </Go>
            </>
          ) : pending.length ? (
            <>
              {pending.map((a, i) => (
                <span key={a.key}>
                  {i ? " " : null}“{a.label}” is {a.pending!.running ? "running" : "queued"} as{" "}
                  <Go href={a.pending!.href} className="dk-seo-optimize-link">
                    operator task #{a.pending!.id}
                  </Go>
                  .
                </span>
              ))}{" "}
              {pending.length === 1 ? "Its button comes back when the task is done." : "Their buttons come back when the tasks are done."}
            </>
          ) : (
            "Each button queues a task for the AI Operator on the studio workstation. Nothing on the live site changes without a person’s approval."
          )}
        </p>
      </div>
    </section>
  );
}
