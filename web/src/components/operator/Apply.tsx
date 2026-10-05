"use client";

import { useState } from "react";
import type { KeywordJudgement, SuggestedTodo, TodosAdded } from "@/contract/operator";
import { Button } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { cx } from "@/lib/cx";
import { send, useSend } from "./send";

const WORD: Record<KeywordJudgement["judgement"], string> = { relevant: "Relevant", weak: "Weak", irrelevant: "Irrelevant" };

/**
 * The "keywords" task's judgements, readable, and applied with one press
 * through the Keywords screen's own addresses: POST /api/v1/seo/keywords/bulk
 * for the judgement (one call per judgement), then /:id/edit for a phrase's
 * topic and intent where the topic is one the desk already has. A new topic
 * the model named is only suggested: the Keywords screen makes topics.
 * Nothing changes on the Keywords screen until a person presses.
 */
export function KeywordsApply({ judgements }: { judgements: KeywordJudgement[] }) {
  const { busy, message, setMessage } = useSend();
  const [working, setWorking] = useState(false);
  const fresh = judgements.filter((j) => j.newTopic && j.topic);

  const apply = async () => {
    setWorking(true);
    setMessage(null);
    const done: string[] = [];
    const failed: string[] = [];
    for (const op of ["relevant", "weak", "irrelevant"] as const) {
      const ids = judgements.filter((j) => j.judgement === op).map((j) => j.id);
      if (!ids.length) continue;
      const r = await send<{ ok: true; results: { id: number; ok: boolean; line: string }[] }>("/api/v1/seo/keywords/bulk", { op, ids });
      if (!r.ok) failed.push(`${WORD[op]}: ${r.message}`);
      else {
        const ok = r.value.results.filter((x) => x.ok).length;
        done.push(`${ok} ${op}`);
        for (const x of r.value.results.filter((y) => !y.ok)) failed.push(x.line);
      }
    }
    let filed = 0;
    for (const j of judgements.filter((x) => x.topicKey || x.intent)) {
      const r = await send(`/api/v1/seo/keywords/${j.id}/edit`, { ...(j.topicKey ? { cluster: j.topicKey } : {}), intent: j.intent });
      if (r.ok) filed++;
      else failed.push(`“${j.phrase}”: ${r.message}`);
    }
    setWorking(false);
    setMessage({
      ok: !failed.length,
      text: `${done.length ? `Judged ${done.join(", ")}` : "No judgement applied"}${filed ? `; topic and intent filed for ${filed}` : ""}.${failed.length ? ` Not applied: ${failed.slice(0, 3).join(" ")}` : ""}`,
    });
  };

  return (
    <div className="dk-operator-kw">
      <div className="dk-operator-table-wrap">
        <table className="dk-operator-table">
          <thead>
            <tr>
              <th scope="col">Search</th>
              <th scope="col">Judgement</th>
              <th scope="col">Topic</th>
              <th scope="col">Intent</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {judgements.map((j) => (
              <tr key={j.id}>
                <td>
                  <Go href={`/seo/keywords?q=${encodeURIComponent(j.phrase)}&status=all`} className="dk-operator-link">
                    {j.phrase}
                  </Go>
                </td>
                <td className={cx("dk-operator-judge", `dk-operator-judge--${j.judgement}`)}>{WORD[j.judgement]}</td>
                <td>{j.topic ? `${j.topic}${j.newTopic ? " (new)" : ""}` : "—"}</td>
                <td>{j.intent}</td>
                <td className="dk-operator-why">{j.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fresh.length ? (
        <p className="dk-operator-aside">
          New topics suggested: {[...new Set(fresh.map((j) => j.topic))].join(", ")}. Make them on the{" "}
          <Go href="/seo/keywords" className="dk-operator-link">
            Keywords screen
          </Go>{" "}
          if they are worth keeping; the phrases keep their topic until then.
        </p>
      ) : null}
      <div className="dk-operator-apply">
        <Button variant="primary" icon="check" disabled={busy || working} onClick={() => void apply()}>
          Apply these judgements
        </Button>
        {message ? (
          <span className={cx("dk-operator-said-inline", !message.ok && "dk-operator-said--bad")} role={message.ok ? "status" : "alert"}>
            {message.text}
          </span>
        ) : (
          <span className="dk-operator-aside">Sets each phrase&apos;s judgement on the Keywords screen, and its topic and intent where the topic exists.</span>
        )}
      </div>
    </div>
  );
}

/**
 * What the "links" and "alt" tasks found, as to-dos for the website's code
 * (the desk cannot edit a page's body), put on the to-do list with one press.
 */
export function TodosAdd({ taskId, todos, added }: { taskId: number; todos: SuggestedTodo[]; added: boolean }) {
  const { go, busy, message } = useSend();
  return (
    <div className="dk-operator-todos-suggested">
      <ul className="dk-operator-opps" aria-label="To-dos for the website's code">
        {todos.map((t, i) => (
          <li key={i} className="dk-operator-opp">
            <p className="dk-operator-opp-title">{t.title}</p>
            <p>{t.note}</p>
          </li>
        ))}
      </ul>
      <div className="dk-operator-apply">
        <Button variant={added ? "quiet" : "primary"} icon="plus" disabled={busy || added} onClick={() => void go<TodosAdded>(`/api/v1/operator/tasks/${taskId}/todos`, {}, (v) => v.line)}>
          {added ? "On the to-do list" : "Put on the to-do list"}
        </Button>
        {message ? (
          <span className={cx("dk-operator-said-inline", !message.ok && "dk-operator-said--bad")} role={message.ok ? "status" : "alert"}>
            {message.text}
          </span>
        ) : (
          <span className="dk-operator-aside">The desk cannot change a page&apos;s text or code: these go to whoever changes the website.</span>
        )}
      </div>
    </div>
  );
}
