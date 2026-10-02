"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { OperatorLive, RunnerState, TaskRow, TodoAnswer, TodoRow } from "@/contract/operator";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { buttonClass, LinkButton } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ago, clock, num } from "@/lib/format";
import { useLive } from "@/lib/live";
import { cx } from "@/lib/cx";
import { useSend } from "./send";

/** What the line under a task says: where it is, in true terms. */
function where(t: TaskRow, runner: RunnerState): string {
  if (t.state === "running" && t.lost) {
    return `Lost contact with ${t.runner ?? "the workstation"}: it took this at ${clock(t.lost.since)} and has not answered. It goes back to the queue at ${clock(t.lost.backAt)}`;
  }
  if (t.state === "running") {
    return `${t.retried ? "Asked again after a refused answer. " : ""}Running on ${t.runner ?? "the workstation"} since ${clock(t.takenAt ?? t.createdAt)}`;
  }
  if (t.stage === "crawl") return t.crawl ? `Crawling the website: ${num(t.crawl.done)} of ${num(t.crawl.of)} pages` : "Waiting for the crawl to start";
  const behind = t.ahead ? `Queued behind ${t.ahead} other${t.ahead === 1 ? "" : "s"}` : "Next in the queue";
  const articles = runner.articlesFirst ? `, after ${runner.articlesFirst} article${runner.articlesFirst === 1 ? "" : "s"}` : "";
  const off =
    runner.state === "online"
      ? ""
      : runner.state === "articles"
        ? ". The workstation's runner does not take operator tasks yet"
        : runner.state === "never"
          ? ". No workstation has asked for operator tasks yet"
          : ". The workstation is off";
  return `${t.retried ? "Asked again: its first answer was refused. " : ""}${behind}${articles}${off}`;
}

function TaskLine({ t, runner, specimen }: { t: TaskRow; runner: RunnerState; specimen: boolean }) {
  const { go, busy, message } = useSend();
  const crawlShare = t.stage === "crawl" && t.crawl && t.crawl.of > 0 ? t.crawl.done / t.crawl.of : null;
  return (
    <li className="dk-operator-task">
      <span
        className={cx(
          "dk-operator-task-mark",
          t.state === "running" && !t.lost ? "dk-operator-task-mark--run" : t.stage === "crawl" && t.crawl ? "dk-operator-task-mark--crawl" : "dk-operator-task-mark--wait",
        )}
        aria-hidden
      />
      <span className="dk-operator-task-text">
        <span className="dk-operator-task-title" title={t.title}>
          {t.title}
        </span>
        <span className="dk-operator-task-sub">{message && !message.ok ? message.text : where(t, runner)}</span>
      </span>
      <span className="dk-operator-task-bar">
        {crawlShare !== null ? (
          <>
            <span className="dk-operator-task-pct dk-num">{Math.round(crawlShare * 100)}%</span>
            <ProgressBar value={crawlShare} label={`The crawl: ${t.crawl!.done} of ${t.crawl!.of} pages`} size="md" />
          </>
        ) : t.state === "running" && t.lost ? (
          <span className="dk-operator-task-queued">No answer</span>
        ) : t.state === "running" ? (
          /* A model's answer has no progress to report: the bar says "working", not a percentage. */
          <span className="dk-operator-busy" role="progressbar" aria-label="The workstation is answering; a model's answer has no measurable progress" />
        ) : (
          <span className="dk-operator-task-queued">{t.stage === "crawl" ? "Crawl first" : "Queued"}</span>
        )}
      </span>
      <button
        type="button"
        className={buttonClass({ variant: "quiet", size: "sm" }, "dk-operator-stop")}
        disabled={busy || specimen}
        onClick={() => void go(`/api/v1/operator/tasks/${t.id}/cancel`, {})}
        title={t.state === "running" ? "Stop: its answer is discarded when it comes" : "Stop: it is taken out of the queue"}
      >
        Stop
      </button>
    </li>
  );
}

function TodoLine({ t, specimen }: { t: TodoRow; specimen: boolean }) {
  const { go, busy } = useSend();
  return (
    <li className={cx("dk-operator-todo", t.done && "dk-operator-todo--done")}>
      <button
        type="button"
        role="checkbox"
        aria-checked={t.done}
        className="dk-operator-tick"
        disabled={busy || specimen}
        onClick={() => void go<TodoAnswer>(`/api/v1/operator/todos/${t.id}`, { done: !t.done })}
        aria-label={t.done ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`}
      >
        {t.done ? <Icon name="check" size={12} /> : null}
      </button>
      <span className="dk-operator-task-text">
        <span className="dk-operator-task-title">{t.title}</span>
        {/* The age is worked out where it is drawn; the browser a second later may say a minute more. */}
        <span className="dk-operator-task-sub" suppressHydrationWarning>
          {t.note ? `${t.note} · ` : ""}
          {t.done ? `Done by ${t.doneBy ?? "someone"} ${ago(t.doneAt ?? t.createdAt)}` : `Added by ${t.who} ${ago(t.createdAt)}`}
        </span>
      </span>
      <button type="button" className="dk-operator-remove" disabled={busy || specimen} onClick={() => void go(`/api/v1/operator/todos/${t.id}`, { remove: true })} aria-label={`Remove "${t.title}"`} title="Remove from the list">
        <Icon name="x" size={14} />
      </button>
    </li>
  );
}

/**
 * Current tasks: what waits for the workstation and what it is doing, with
 * its true state, and the studio's own to-do list under it. Polls the desk
 * every few seconds while something is open, and redraws the screen when a
 * task finishes so its answer appears.
 */
export function Tasks({ initial, todos, specimen }: { initial: OperatorLive; todos: TodoRow[]; specimen: boolean }) {
  const router = useRouter();
  const [, redraw] = useTransition();
  const open = initial.tasks.length > 0;
  const live = useLive<OperatorLive>(`/api/v1/operator/live${specimen ? "?specimen=1" : ""}`, open ? 4_000 : 20_000, initial);
  const markOf = (d: OperatorLive) => JSON.stringify([d.latest, d.tasks.map((t) => [t.id, t.state])]);
  const seen = useRef(markOf(initial));
  const [data, setData] = useState(initial);

  /* The server drew the screen again (a task was queued or stopped here, or a
     poll asked it to): its answer is the newest. */
  useEffect(() => {
    setData(initial);
    seen.current = markOf(initial);
  }, [initial]);

  /* A poll answered. When something started or finished, the answer, the
     actions and the head are drawn again from the server. */
  useEffect(() => {
    if (!live.data || live.at === null) return;
    setData(live.data);
    const mark = markOf(live.data);
    if (mark !== seen.current) {
      seen.current = mark;
      redraw(() => router.refresh());
    }
  }, [live.data, live.at, router]);

  const now = data.tasks;

  const running = now.filter((t) => t.state === "running" && !t.lost).length;
  const queued = now.length - running;

  return (
    <Card
      title={
        <span className="dk-operator-tasks-title">
          Current tasks
          {now.length ? (
            <span className="dk-operator-count">
              <span className={cx("dk-operator-dot", running ? "dk-operator-dot--on" : "dk-operator-dot--wait")} aria-hidden />
              {running ? `${running} running` : `${queued} queued`}
            </span>
          ) : null}
        </span>
      }
      icon="play"
      right={<LinkButton href="/operator/results?tab=tasks" size="xs">View all</LinkButton>}
      className="dk-operator-panel"
      id="current-tasks"
    >
      {now.length ? (
        <ol className="dk-operator-tasks" aria-label="Tasks for the workstation">
          {now.map((t) => (
            <TaskLine key={t.id} t={t} runner={data.runner} specimen={specimen} />
          ))}
        </ol>
      ) : (
        <Empty icon="play" title="Nothing is waiting for the workstation" compact>
          {data.runner.state === "online"
            ? "It is on and asking for tasks: a question asked now is taken on its next ask."
            : data.runner.state === "articles"
              ? `${data.runner.line} Tasks wait until it runs a build that does.`
              : data.runner.line}
        </Empty>
      )}
      {todos.length ? (
        <>
          <p className="dk-operator-sublabel">Your to-do list</p>
          <ul className="dk-operator-tasks" aria-label="To-do list">
            {todos.map((t) => (
              <TodoLine key={t.id} t={t} specimen={specimen} />
            ))}
          </ul>
        </>
      ) : null}
      {live.error ? <p className="dk-operator-said dk-operator-said--bad">{live.error}</p> : null}
    </Card>
  );
}

