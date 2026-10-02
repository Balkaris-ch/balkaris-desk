"use client";

import { useEffect, useRef, useState } from "react";
import type { RunningPanel } from "@/contract/seo/overview";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusDot } from "@/components/ui/StatusDot";
import { ago, clock, num } from "@/lib/format";
import { useLive } from "@/lib/live";
import "./overview.css";

/** While something runs the panel asks every five seconds; otherwise twice a minute. */
const BUSY_MS = 5_000;
const IDLE_MS = 30_000;

/**
 * When a scheduled run is: "in 9 min", or "due now" once its time has passed
 * (the scheduler wakes every 30 seconds and runs one job at a time, so a due
 * job can wait behind another), never "6 min ago" for a run that has not happened.
 */
const due = (at: string): string => (Date.parse(at) <= Date.now() ? "due now" : ago(at));

/**
 * Running now: the SEO jobs in progress with how far they have got, the
 * audit's steps still waiting their turn, the operator tasks of the SEO kinds
 * in the queue, and what runs next. It keeps itself current from GET
 * /api/v1/seo/overview/running; a failed ask keeps the last answer.
 */
export function Running({ initial }: { initial: RunningPanel }) {
  const first = initial.jobs.length + initial.tasks.length + initial.queued.length;
  const [every, setEvery] = useState(first ? BUSY_MS : IDLE_MS);
  const live = useLive<RunningPanel>("/api/v1/seo/overview/running", every, initial);
  const v = live.data ?? initial;
  const busy = v.jobs.length + v.tasks.length + v.queued.length;
  const { refresh } = live;

  useEffect(() => setEvery(busy ? BUSY_MS : IDLE_MS), [busy]);
  /* The page was drawn again (a task was just queued from it): ask at once rather than at the next turn. */
  const drawn = useRef(initial.at);
  useEffect(() => {
    if (initial.at === drawn.current) return;
    drawn.current = initial.at;
    refresh();
  }, [initial.at, refresh]);

  return (
    <Card
      title="Running now"
      icon="refresh"
      className="dk-seo-overview-panel dk-seo-overview-a-run"
      info="The SEO jobs the desk is running, the steps of a full audit still waiting (the desk runs one job at a time), and the operator tasks for search in the queue. Operator tasks run on the studio workstation’s model, only while it is on."
      right={
        <StatusDot tone={busy ? "good" : "quiet"} pulse={busy > 0} tint={busy > 0}>
          {busy ? `${num(busy)} active` : "Idle"}
        </StatusDot>
      }
    >
      <div className="dk-seo-overview-run" aria-live="polite">
        {v.jobs.map((j) => (
          <div key={j.name} className="dk-seo-overview-run-item">
            <p className="dk-seo-overview-run-title">
              <Icon name="refresh" size={14} className="dk-seo-overview-spin" />
              {j.title}
            </p>
            {j.progress && j.progress.of > 0 ? (
              <>
                <ProgressBar value={j.progress.done} max={j.progress.of} label={`${j.title}: ${j.progress.done} of ${j.progress.of}`} size="md" />
                <p className="dk-seo-overview-quiet">
                  {num(j.progress.done)} of {num(j.progress.of)}
                  {j.progress.what ? ` · ${j.progress.what}` : ""}
                </p>
              </>
            ) : (
              <p className="dk-seo-overview-quiet">Started {j.lastStart ? ago(j.lastStart) : "just now"}.</p>
            )}
          </div>
        ))}
        {v.queued.map((s) => (
          <div key={s.job} className="dk-seo-overview-run-item dk-seo-overview-run-item--wait">
            <p className="dk-seo-overview-run-title">
              <Icon name="hourglass" size={14} />
              {s.title}
            </p>
            <p className="dk-seo-overview-quiet">Waiting its turn in the full audit.</p>
          </div>
        ))}
        {(v.lost ?? []).map((s) => (
          <div key={s.job} className="dk-seo-overview-run-item dk-seo-overview-run-item--wait dk-seo-overview-run-item--lost">
            <p className="dk-seo-overview-run-title">
              <Icon name="alert" size={14} />
              {s.title}
            </p>
            <p className="dk-seo-overview-quiet">
              Not started: the desk restarted <time dateTime={v.bootedAt} title={clock(v.bootedAt)} suppressHydrationWarning>{ago(v.bootedAt)}</time>, after the full audit asked for it, and forgot its queue.{" "}
              {s.at ? (
                <>
                  It runs on its own schedule <time dateTime={s.at} title={clock(s.at)} suppressHydrationWarning>{due(s.at)}</time>, or with Run full SEO audit.
                </>
              ) : (
                "Run full SEO audit asks for it again."
              )}
            </p>
          </div>
        ))}
        {v.tasks.map((t) => (
          <Go key={t.id} href={t.href} className="dk-seo-overview-run-item dk-seo-overview-run-task">
            <p className="dk-seo-overview-run-title">
              <Icon name={t.state === "running" ? "robot" : "clock"} size={14} />
              <span className="dk-seo-overview-run-text">{t.title}</span>
            </p>
            <p className="dk-seo-overview-quiet">
              {t.kindLabel} · operator task #{t.id} · {t.state === "running" ? "the workstation is answering it" : t.ahead ? `queued behind ${num(t.ahead)}` : "queued, next"}
              {t.opportunityId ? " · from an opportunity" : ""}
            </p>
          </Go>
        ))}
        {!busy ? <p className="dk-seo-overview-run-idle">Nothing is running now.</p> : null}

        {v.tasks.length || !busy ? (
          <p className="dk-seo-overview-run-runner">
            <StatusDot tone={v.runner.state === "online" ? "good" : v.runner.state === "articles" ? "warn" : "quiet"} />
            <span>
              Workstation: {v.runner.line}
              {v.runner.lastSeen ? ` Last asked ${ago(v.runner.lastSeen)}.` : ""}
            </span>
          </p>
        ) : null}

        {v.next.length ? (
          <>
            <p className="dk-seo-overview-sublabel">Next</p>
            <ul className="dk-seo-overview-next">
              {v.next.map((n) => (
                <li key={n.name}>
                  <span className="dk-seo-overview-next-title">{n.title}</span>
                  <time className="dk-num dk-seo-overview-quiet" dateTime={n.at} title={clock(n.at)} suppressHydrationWarning>
                    {due(n.at)}
                  </time>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {live.error ? <p className="dk-seo-overview-quiet">Not current: {live.error}</p> : null}
      </div>
    </Card>
  );
}
