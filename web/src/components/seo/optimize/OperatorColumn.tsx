"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Reading } from "@/contract/common";
import type { ProposalRow, TaskAnswer, TodoAnswer } from "@/contract/operator";
import type { OperatorPanel, OpportunityAnswer } from "@/contract/seo/common";
import type { AskedTask, PageSuggestion } from "@/contract/seo/page-view";
import { send, useSend } from "@/components/operator/send";
import { buttonClass } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { ago, num } from "@/lib/format";
import { PriorityChip } from "./bits";
import "@/components/ui/field.css";

/** The words the runner's state is said in, short, beside its dot. */
const RUNNER: Record<OperatorPanel["runner"]["state"], { word: string; tone: string }> = {
  online: { word: "The workstation is on", tone: "good" },
  articles: { word: "The workstation runs articles only", tone: "warn" },
  off: { word: "The workstation is off: tasks wait", tone: "warn" },
  never: { word: "No workstation has asked for tasks yet", tone: "quiet" },
};

function iconOf(s: PageSuggestion): IconName {
  if (s.act.kind === "person") return "user";
  if (s.act.kind === "todo") return "check-circle";
  if (s.key.startsWith("not-indexed:")) return "search";
  if (s.key.includes("title") || s.key.includes("description") || s.label.toLowerCase().includes("title")) return "edit";
  if (s.key.includes("link")) return "link";
  if (s.key.includes("schema") || s.label.toLowerCase().includes("structured")) return "code";
  if (s.key.includes("image") || s.label.toLowerCase().includes("picture")) return "image";
  if (s.act.kind === "task" && s.act.task.kind === "brief") return "file-text";
  return "sparkles";
}

/** Where one suggestion's button sends, and the line it says when the desk answers. True when the desk took it. */
async function act(s: PageSuggestion, go: ReturnType<typeof useSend>["go"]): Promise<boolean> {
  const a = s.act;
  if (a.kind === "opportunity") {
    return (await go<OpportunityAnswer>("/api/v1/seo/optimize/act", { id: a.id }, (v) => v.opportunity.state.note ?? "Done: its state is updated.")).ok;
  } else if (a.kind === "task") {
    return (await go<TaskAnswer>("/api/v1/operator/tasks", a.task, (v) => `Queued as operator task #${v.task.id}. It runs on the studio workstation.`)).ok;
  } else if (a.kind === "todo") {
    return (await go<TodoAnswer>("/api/v1/operator/todos", { title: a.title, note: a.note }, (v) => (v.todo ? `On the operator’s to-do list as #${v.todo.id}.` : "On the operator’s to-do list."))).ok;
  }
  return false;
}

function SuggestionLine({ s }: { s: PageSuggestion }) {
  const { go, busy, message } = useSend();
  /* Once the desk took it, the button stays off: the server's answer marks the line as asked on the next draw. */
  const [sent, setSent] = useState(false);
  const st = s.state && s.state.state !== "open" ? s.state : null;
  return (
    <li className="dk-seo-optimize-sug">
      <span className="dk-seo-optimize-sug-icon" aria-hidden>
        <Icon name={iconOf(s)} size={15} />
      </span>
      <span className="dk-seo-optimize-sug-text">
        <span className="dk-seo-optimize-sug-label">
          {s.label}
          {s.priority ? <PriorityChip priority={s.priority} className="dk-seo-optimize-sug-prio" /> : null}
        </span>
        <span className="dk-seo-optimize-sug-why" title={s.why}>
          {s.why}
        </span>
        {s.potential ? <span className="dk-seo-optimize-sug-said">Our estimate: +{num(s.potential.clicksPerMonth, 1)} clicks a month</span> : null}
        {st ? (
          <span className="dk-seo-optimize-sug-said">
            {st.note ?? st.state}
            {st.task ? (
              <>
                {" "}
                <Go href={st.task.href} className="dk-seo-optimize-link">
                  Task #{st.task.id}
                </Go>
              </>
            ) : null}
          </span>
        ) : null}
        {s.act.kind === "person" ? <span className="dk-seo-optimize-sug-said">{s.step}</span> : null}
        {/* Why the button is off, when the state above does not already say it. */}
        {s.button && !s.available && s.unavailable && !st?.task && s.unavailable !== st?.note ? <span className="dk-seo-optimize-sug-said">{s.unavailable}</span> : null}
        {s.href ? (
          <Go href={s.href} className="dk-seo-optimize-link dk-seo-optimize-sug-said">
            Open in Search Console
          </Go>
        ) : null}
        {message ? <span className={cx("dk-seo-optimize-sug-said", message.ok ? "dk-tone-good" : "dk-tone-bad")}>{message.text}</span> : null}
      </span>
      {s.button ? (
        <button
          type="button"
          className={buttonClass({ variant: s.act.kind === "opportunity" || s.act.kind === "task" ? "good" : "quiet", size: "xs" }, "dk-seo-optimize-sug-btn")}
          disabled={busy || sent || !s.available}
          title={s.available ? s.step : (s.unavailable ?? undefined)}
          onClick={async () => {
            if (await act(s, go)) setSent(true);
          }}
        >
          {busy ? "…" : s.button}
        </button>
      ) : null}
    </li>
  );
}

/**
 * "Bulk actions": every available suggestion that queues an operator task
 * (`queueable`), one after the other. Never "Mark requested" or "Hand to
 * code": those record a person's step and are pressed one at a time.
 */
function QueueAll({ items }: { items: PageSuggestion[] }) {
  const router = useRouter();
  const [, redraw] = useTransition();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const can = items.filter((s) => s.available && s.queueable && (s.act.kind === "opportunity" || s.act.kind === "task"));
  /* After a run the lines come back as asked, so the button goes; what it did stays said. */
  if (can.length < 2 && !said) return null;
  return (
    <div className="dk-seo-optimize-bulk">
      {can.length >= 2 ? (
        <button
          type="button"
          className={buttonClass({ variant: "quiet", size: "sm" })}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            let ok = 0;
            const refused: string[] = [];
            for (const s of can) {
              const a = s.act;
              const r =
                a.kind === "opportunity" ? await send<OpportunityAnswer>("/api/v1/seo/optimize/act", { id: a.id }) : a.kind === "task" ? await send<TaskAnswer>("/api/v1/operator/tasks", a.task) : null;
              if (r?.ok) ok++;
              else if (r) refused.push(`${s.label}: ${r.message}`);
            }
            setBusy(false);
            setSaid(
              `${ok} of ${can.length} queued as operator tasks on the studio workstation; a title or description they write waits for approval.${refused.length ? ` Not queued: ${refused.join(" ")}` : ""}`,
            );
            /* Drawn again from the server with the new states. */
            redraw(() => router.refresh());
          }}
        >
          <Icon name="layers" size={14} />
          <span>{busy ? "Queuing…" : `Queue all ${can.length}`}</span>
        </button>
      ) : null}
      {said ? <p className="dk-seo-optimize-said">{said}</p> : null}
    </div>
  );
}

function Ask({ path }: { path: string }) {
  const { go, busy, message } = useSend();
  const [text, setText] = useState("");
  const [id, setId] = useState<number | null>(null);
  return (
    <form
      className="dk-seo-optimize-ask"
      onSubmit={(e) => {
        e.preventDefault();
        const prompt = text.trim();
        if (prompt.length < 3) return;
        void go<TaskAnswer>("/api/v1/operator/tasks", { kind: "ask", path, prompt, context: "pages", depth: "deep" }, (v) => {
          setId(v.task.id);
          setText("");
          return null;
        });
      }}
    >
      <label className="dk-seo-optimize-ask-box">
        <span className="dk-sr">Ask anything about this page</span>
        <input className="dk-input" value={text} maxLength={1000} placeholder="Ask anything about this page…" onChange={(e) => setText(e.target.value)} />
        <button type="submit" className={buttonClass({ variant: "quiet", size: "sm" }, "dk-btn--icon")} disabled={busy || text.trim().length < 3} aria-label="Ask the operator">
          <Icon name="send" size={15} />
        </button>
      </label>
      {message && !message.ok ? <p className="dk-seo-optimize-said dk-seo-optimize-said--bad">{message.text}</p> : null}
      {id ? (
        <p className="dk-seo-optimize-said">
          Asked as task #{id}: answered on the studio workstation when it is on.{" "}
          <Go href={`/operator?result=${id}#response`} className="dk-seo-optimize-link">
            Read it in AI Operator
          </Go>
        </p>
      ) : null}
    </form>
  );
}

/** Where the suggestions came from, naming only the sources that gave one. */
function sourcesLine(list: PageSuggestion[]): string {
  const n = (from: PageSuggestion["from"]) => list.filter((s) => s.from === from).length;
  const parts = [
    [n("engine"), "the opportunity rules"],
    [n("crawl"), "the crawl"],
    [n("readiness"), "the AI-readiness check"],
  ].filter(([k]) => (k as number) > 0) as [number, string][];
  if (parts.length === 1) return `all from ${parts[0]![1]}`;
  return parts.map(([k, w]) => `${k} from ${w}`).join(", ").replace(/, ([^,]*)$/, " and $1");
}

const STATE_WORD: Record<string, string> = { queued: "Queued", running: "Running", done: "Answered", failed: "Failed", cancelled: "Stopped" };

/**
 * The board's "AI SEO Operator" column, truthfully: the desk's own operator,
 * which runs on the studio workstation's local model (queued, not live). Its
 * suggestions for this page come from the engine's rules and the crawl, each
 * with the figure that made it and a real action: an opportunity's action, an
 * operator task, a line on the to-do list, or a step only a person can take.
 * A title or description it writes waits in AI Operator › Approvals.
 */
export function OperatorColumn({ operator, suggestions, asked, proposals, path }: { operator: OperatorPanel; suggestions: PageSuggestion[]; asked: Reading<AskedTask[]>; proposals: ProposalRow[]; path: string }) {
  const [tab, setTab] = useState<"suggestions" | "asked">("suggestions");
  const runner = RUNNER[operator.runner.state];
  const tasks = asked.state === "ok" ? asked.value : [];
  const waiting = proposals.filter((p) => p.state === "waiting");
  const fromEngine = suggestions.filter((s) => s.from === "engine").length;
  return (
    <section className="dk-card dk-seo-optimize-ops" aria-label="AI SEO Operator">
      <header className="dk-seo-optimize-ops-head">
        <span className="dk-seo-optimize-ops-mark" aria-hidden>
          <Icon name="robot" size={20} />
        </span>
        <span className="dk-seo-optimize-ops-titles">
          <h2 className="dk-card-title">
            <span className="dk-card-title-text">AI SEO Operator</span>
          </h2>
          <span className={cx("dk-seo-optimize-ops-state", `dk-tone-${runner.tone}`)} title={operator.line}>
            <span className="dk-seo-optimize-dot" aria-hidden />
            {runner.word}
          </span>
        </span>
      </header>
      <div className="dk-seo-optimize-seg dk-seo-optimize-seg--wide" role="tablist" aria-label="Operator">
        <button type="button" role="tab" aria-selected={tab === "suggestions"} className={cx("dk-seo-optimize-seg-btn", tab === "suggestions" && "dk-seo-optimize-seg-btn--on")} onClick={() => setTab("suggestions")}>
          Suggestions <span className="dk-num">{num(suggestions.length)}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "asked"} className={cx("dk-seo-optimize-seg-btn", tab === "asked" && "dk-seo-optimize-seg-btn--on")} onClick={() => setTab("asked")}>
          Asked <span className="dk-num">{num(tasks.length)}</span>
        </button>
      </div>

      {tab === "suggestions" ? (
        <>
          <p className="dk-seo-optimize-ops-intro">
            {suggestions.length
              ? `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} for this page, ${sourcesLine(suggestions)}. Each says the figure behind it.`
              : "Nothing to suggest: the rules, the crawl and the readiness check found nothing open on this page."}
          </p>
          <ul className="dk-seo-optimize-sugs">
            {suggestions.map((s) => (
              <SuggestionLine key={s.key} s={s} />
            ))}
          </ul>
          <QueueAll items={suggestions} />
        </>
      ) : (
        <ul className="dk-seo-optimize-asked">
          {tasks.length ? (
            tasks.map((t) => (
              <li key={t.task.id}>
                <span className="dk-seo-optimize-asked-title">{t.task.title}</span>
                <span className="dk-seo-optimize-asked-sub">
                  {t.task.kindLabel} · {STATE_WORD[t.task.state] ?? t.task.state} · {ago(t.task.finishedAt ?? t.task.createdAt)}
                  {t.proposals ? ` · ${t.proposals} proposal${t.proposals === 1 ? "" : "s"}${t.waiting ? `, ${t.waiting} waiting` : ""}` : ""}
                </span>
                <Go href={t.href} className="dk-seo-optimize-link">
                  {t.task.state === "done" ? "Read the answer" : "Open"}
                </Go>
              </li>
            ))
          ) : (
            <li className="dk-seo-optimize-asked-none">{asked.state === "ok" ? "Nothing has been asked about this page yet." : asked.reason}</li>
          )}
        </ul>
      )}

      {waiting.length ? (
        <div className="dk-seo-optimize-ops-waiting">
          <p>
            <Icon name="hourglass" size={14} /> {waiting.length} change{waiting.length === 1 ? "" : "s"} to this page wait{waiting.length === 1 ? "s" : ""} for approval.
          </p>
          <Go href="/operator?ap=waiting#approvals" className="dk-seo-optimize-link">
            Review in AI Operator
          </Go>
        </div>
      ) : null}

      <Ask path={path} />
      <p className="dk-seo-optimize-ops-truth">{operator.line}</p>
    </section>
  );
}
