"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { TaskAnswer } from "@/contract/operator";
import type { OperatorPanel } from "@/contract/seo/common";
import { Badge, type ChipTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { useSend } from "@/components/operator/send";
import { queuedLine, Said } from "@/components/seo/overview/Act";
import { cx } from "@/lib/cx";
import { API } from "./look";
import "@/components/seo/overview/overview.css";

const RUNNER: Record<OperatorPanel["runner"]["state"], { tone: ChipTone; word: string }> = {
  online: { tone: "good", word: "Online" },
  articles: { tone: "warn", word: "Writing articles" },
  off: { tone: "quiet", word: "Workstation off" },
  never: { tone: "quiet", word: "Not connected yet" },
};

const TASKS = `${API}/task`;

/**
 * The AI SEO Operator on this page: a question or a suggested task is queued
 * through AI Search's own door (POST /api/v1/seo/ai-search/task), and the
 * studio workstation's own model answers it when the workstation is on. Never
 * a hosted model. Drawn as the Overview draws its operator (its classes), so
 * the section reads as one; what the operator proposes for the website waits
 * for a person's approval in AI Operator › Approvals.
 */
export function AiOperator({ panel }: { panel: OperatorPanel }) {
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
    const sent = await ask.go<TaskAnswer>(TASKS, { kind: "ask", prompt: prompt.slice(0, 1000), context: "website", depth: "deep" }, queuedLine);
    if (sent.ok) setText("");
  };

  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Card title="AI SEO Operator" icon="robot" className="dk-seo-ai-search-panel" info={panel.line}>
      <div className="dk-seo-overview-op">
        <p className="dk-seo-overview-op-runner">
          <Badge tone={r.tone} dot>
            {r.word}
          </Badge>
          <span className="dk-seo-overview-quiet">{panel.runner.line}</span>
        </p>
        <form className="dk-seo-overview-op-ask" onSubmit={(e) => void submit(e)}>
          <label htmlFor="dk-seo-ai-search-op-q" className="dk-sr">
            A question for the operator about being named in AI answers
          </label>
          <textarea
            id="dk-seo-ai-search-op-q"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={key}
            rows={3}
            maxLength={1000}
            placeholder="Ask about AI answers: why an assistant names others, what a page lacks…"
          />
          <button type="submit" className="dk-seo-overview-op-send" disabled={ask.busy} aria-label="Queue the question for the operator">
            <Icon name={ask.busy ? "refresh" : "send"} size={16} />
          </button>
        </form>
        <Said message={ask.message} />

        <p className="dk-seo-overview-sublabel">Suggested from this page</p>
        <ul className="dk-seo-overview-op-list" aria-label="Suggested operator tasks">
          {panel.suggestions.map((s, i) => (
            <li key={s.label}>
              <button
                type="button"
                className={cx("dk-seo-overview-op-do", run.busy && which === i && "dk-seo-overview-op-do--busy")}
                disabled={run.busy}
                onClick={async () => {
                  setWhich(i);
                  await run.go<TaskAnswer>(TASKS, s.task, queuedLine);
                  setWhich(null);
                }}
              >
                <Icon name={s.task.kind === "brief" ? "file-text" : s.task.kind === "opportunities" ? "lightbulb" : "message"} size={14} />
                <span>{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <Said message={run.message} />
        <p className="dk-seo-overview-op-note">
          Runs on the studio workstation’s own model, never a hosted one: tasks wait in the queue while it is off. Proposals for the website wait for approval in{" "}
          <Go href="/operator#approvals" className="dk-seo-overview-link">
            AI Operator
          </Go>
          .
        </p>
      </div>
    </Card>
  );
}
