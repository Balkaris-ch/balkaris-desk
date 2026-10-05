"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { TaskAnswer } from "@/contract/operator";
import type { OperatorPanel } from "@/contract/seo/common";
import { Badge, type ChipTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { useSend } from "@/components/operator/send";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { queuedLine, Said, TASKS } from "./Act";
import { NEEDS_OPERATOR } from "./RowAction";
import "./overview.css";

/**
 * The longest question the operator's queue takes (src/cc/operator/queue.ts
 * `createTask`, and this page's door, src/cc/routes/seo/overview.ts): the
 * workstation's model reads a few thousand characters in all, data included.
 */
const MOST = 1000;

const RUNNER: Record<OperatorPanel["runner"]["state"], { tone: ChipTone; word: string }> = {
  online: { tone: "good", word: "Online" },
  articles: { tone: "warn", word: "Writing articles" },
  off: { tone: "quiet", word: "Workstation off" },
  never: { tone: "quiet", word: "Not connected yet" },
};

/**
 * The boards' "AI SEO Operator" is the desk's own operator: a question or a
 * suggested task is queued, and the studio workstation's local model answers
 * it when the workstation is on. The panel says so in its own words, and
 * anything the operator proposes for the website waits for a person's
 * approval in AI Operator › Approvals. Queueing takes edit on the AI Operator
 * too (`operate`, from the payload's `can`): without it the box and the
 * suggestions say so and send nothing.
 */
export function Operator({ panel, operate = true }: { panel: OperatorPanel; operate?: boolean }) {
  const [text, setText] = useState("");
  const [which, setWhich] = useState<number | null>(null);
  const ask = useSend();
  const run = useSend();
  const r = RUNNER[panel.runner.state];

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const prompt = text.trim();
    if (prompt.length < 3) {
      ask.setMessage({ ok: false, text: "Write a question first." });
      return;
    }
    if (prompt.length > MOST) {
      ask.setMessage({ ok: false, text: `Keep the question under ${num(MOST)} characters: the workstation’s model reads a few thousand in all, data included.` });
      return;
    }
    const sent = await ask.go<TaskAnswer>(TASKS, { kind: "ask", prompt, context: "website", depth: "deep" }, queuedLine);
    if (sent.ok) setText("");
  };

  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Card
      title="AI SEO Operator"
      icon="robot"
      className="dk-seo-overview-panel dk-seo-overview-a-op"
      info={panel.line}
    >
      <div className="dk-seo-overview-op">
        <p className="dk-seo-overview-op-runner">
          <Badge tone={r.tone} dot>
            {r.word}
          </Badge>
          <span className="dk-seo-overview-quiet">{panel.runner.line}</span>
        </p>
        <form className="dk-seo-overview-op-ask" onSubmit={(e) => void submit(e)}>
          <label htmlFor="dk-seo-overview-op-q" className="dk-sr">
            A question for the operator about the website’s search
          </label>
          <textarea
            id="dk-seo-overview-op-q"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={key}
            rows={3}
            maxLength={MOST}
            disabled={!operate}
            aria-describedby={text.length > MOST * 0.8 ? "dk-seo-overview-op-left" : undefined}
            placeholder={operate ? "Ask about the website’s search: a page, a query, what to fix first…" : "Asking the operator takes edit on the AI Operator."}
          />
          <button type="submit" className="dk-seo-overview-op-send" disabled={ask.busy || !operate} aria-label="Queue the question for the operator">
            <Icon name={ask.busy ? "refresh" : "send"} size={16} />
          </button>
        </form>
        {text.length > MOST * 0.8 ? (
          <p id="dk-seo-overview-op-left" className="dk-seo-overview-quiet dk-seo-overview-op-left">
            {num(MOST - text.length)} characters left
          </p>
        ) : null}
        {operate ? null : <p className="dk-seo-overview-quiet dk-seo-overview-op-left">{NEEDS_OPERATOR}</p>}
        <Said message={ask.message} />

        <p className="dk-seo-overview-sublabel">Suggested actions</p>
        <ul className="dk-seo-overview-op-list" aria-label="Suggested operator tasks">
          {panel.suggestions.map((s, i) => (
            <li key={s.label}>
              <button
                type="button"
                className={cx("dk-seo-overview-op-do", run.busy && which === i && "dk-seo-overview-op-do--busy")}
                disabled={run.busy || !operate}
                title={operate ? undefined : NEEDS_OPERATOR}
                onClick={async () => {
                  setWhich(i);
                  await run.go<TaskAnswer>(TASKS, s.task, queuedLine);
                  setWhich(null);
                }}
              >
                <Icon name={s.task.kind === "brief" ? "file-text" : s.task.kind === "metadata" ? "tag" : s.task.kind === "redirect" ? "redirect" : s.task.kind === "audit" ? "search" : s.task.kind === "opportunities" ? "lightbulb" : "message"} size={14} />
                <span>{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <Said message={run.message} />
        <p className="dk-seo-overview-op-note">
          Runs on the studio workstation’s own model: tasks wait in the queue while it is off. Proposals for the website wait for approval in{" "}
          <Go href="/operator#approvals" className="dk-seo-overview-link">
            AI Operator
          </Go>
          .
        </p>
      </div>
    </Card>
  );
}
