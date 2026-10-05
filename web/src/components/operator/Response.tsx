import type { ResultCard, TaskResult, TaskRow } from "@/contract/operator";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { ago } from "@/lib/format";
import { cx } from "@/lib/cx";
import { AnswerText, Flags, GivenLine } from "./Answer";
import { KIND_LOOK } from "./look";

/**
 * AI response: the latest finished answer (or the one asked for with
 * ?result=), how old it is and what data it was given, then cards linking to
 * the newest result of each other kind. The whole answer is one click away.
 */
export function Response({ answer, pending, cards, specimen }: { answer: TaskResult | null; pending: TaskRow | null; cards: ResultCard[]; specimen: boolean }) {
  const look = answer ? KIND_LOOK[answer.task.kind] : null;
  const done = answer?.task.finishedAt ?? null;
  /* Two, in one row: the panel then stands as tall as the prompt box beside it, as on the board. */
  const others = cards.filter((c) => c.id !== answer?.task.id).slice(0, 2);
  const q = specimen ? "&specimen=1" : "";

  return (
    <Card
      title={
        <span className="dk-operator-tasks-title">
          AI response
          {done ? (
            <span className="dk-operator-count">
              <span className="dk-operator-ring" aria-hidden />
              <time dateTime={done} suppressHydrationWarning>
                {ago(done)}
              </time>
            </span>
          ) : null}
        </span>
      }
      icon="sparkles"
      right={<LinkButton href="/operator/results" size="xs">View all</LinkButton>}
      className="dk-operator-panel dk-operator-response"
      id="response"
    >
      {pending ? (
        <p className="dk-operator-said" role="status">
          Task #{pending.id}, “{pending.title}”, is {pending.state === "running" ? "with the workstation now" : pending.stage === "crawl" ? "waiting for its crawl" : `queued${pending.ahead ? `, behind ${pending.ahead}` : ""}`}. Its answer appears here when it is done.
        </p>
      ) : null}
      {answer && look ? (
        <>
          <div className="dk-operator-said-row">
            <span className={cx("dk-operator-tile", `dk-tone-${answer.task.state === "failed" ? "bad" : look.tone}`)} aria-hidden>
              <Icon name={answer.task.state === "failed" ? "alert" : look.icon} size={20} />
            </span>
            <div className="dk-operator-bubble-wrap">
              <div className="dk-operator-bubble" title={`${answer.task.kindLabel}: ${answer.task.title}`}>
                {answer.task.state === "failed" ? (
                  <p className="dk-operator-bubble-error">Not answered: {answer.task.error}</p>
                ) : (
                  <AnswerText text={answer.text} className="dk-operator-clamp" />
                )}
              </div>
              <Flags result={answer} />
              <p className="dk-operator-meta">
                <GivenLine given={answer.given} inline />
                {specimen && answer.task.id >= 9000 ? null : (
                  <Go href={`/operator/results/${answer.task.id}`} className="dk-operator-link dk-operator-more">
                    Read all
                  </Go>
                )}
              </p>
            </div>
          </div>
          {others.length ? (
            <ul className="dk-operator-cards">
              {others.map((c) => {
                const l = KIND_LOOK[c.kind];
                return (
                  <li key={c.id}>
                    <Go href={`/operator?result=${c.id}${q}`} className="dk-operator-card" scroll={false}>
                      <span className={cx("dk-operator-tile", "dk-operator-tile--sm", `dk-tone-${l.tone}`)} aria-hidden>
                        <Icon name={l.icon} size={18} />
                      </span>
                      <span className="dk-operator-card-text">
                        <span className="dk-operator-card-title">{l.name}</span>
                        <span className="dk-operator-card-sub">
                          {c.sub} · <time dateTime={c.finishedAt}>{ago(c.finishedAt)}</time>
                        </span>
                      </span>
                      <Icon name="arrow-right" size={16} className="dk-operator-card-go" />
                    </Go>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : pending ? null : (
        <Empty icon="sparkles" title="No answer yet">
          Ask a question or start a task. The workstation answers from the desk&apos;s own data when it is on, and the answer appears here with the data it was given.
        </Empty>
      )}
    </Card>
  );
}
