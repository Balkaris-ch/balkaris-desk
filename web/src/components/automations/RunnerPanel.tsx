import type { Reading } from "@/contract/common";
import type { Runner, RunnerWork } from "@/contract/automations";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { cx } from "@/lib/cx";
import { ago, feedTime, num } from "@/lib/format";
import { took, workKind } from "./words";

/**
 * The article writer: the workstation's runner, which asks the desk for work
 * and writes, draws and cuts on its own graphics card. The desk knows only
 * what its queue holds and when the workstation last asked.
 */
export function RunnerPanel({ reading, at }: { reading: Reading<Runner>; at: string }) {
  const r = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title="Article writer"
      icon="cpu"
      sub="The runner on the workstation"
      right={r ? <Badge tone={r.awake ? "good" : "quiet"} dot>{r.awake ? "Awake" : r.lastSeen ? "Asleep" : "Never seen"}</Badge> : null}
      footer={<p className="dk-automations-foot">It runs only while the workstation is switched on. Shared links wait in the queue until it asks for work, every 20 seconds while it is awake.</p>}
    >
      <Read reading={reading}>
        {(v, ok) => (
          <div className="dk-automations-runner">
            <p className="dk-automations-runner-seen">
              <StatusDot tone={v.awake ? "good" : "quiet"} pulse={v.awake}>
                {v.lastSeen ? (
                  <>
                    {v.awake ? "Asked for work " : "Last asked for work "}
                    <time dateTime={v.lastSeen}>{ago(v.lastSeen, at)}</time>
                  </>
                ) : (
                  "No runner has asked this desk for work yet"
                )}
              </StatusDot>
            </p>

            <dl className="dk-automations-queue">
              <div>
                <dt>Waiting</dt>
                <dd className="dk-num">{num(v.queue.queued)}</dd>
              </div>
              <div>
                <dt>In hand</dt>
                <dd className="dk-num">{num(v.queue.running)}</dd>
              </div>
              <div>
                <dt>Stuck</dt>
                <dd className={cx("dk-num", v.queue.stuck > 0 && "dk-automations-bad")}>{num(v.queue.stuck)}</dd>
              </div>
              <div>
                <dt>Drafts</dt>
                <dd className="dk-num">
                  <Go href="/content" className="dk-automations-link">
                    {num(v.queue.drafts)}
                  </Go>
                </dd>
              </div>
            </dl>

            <div className="dk-automations-doing">
              <p className="dk-automations-more-head">Doing now</p>
              {v.doing.length ? (
                <ul className="dk-automations-work">
                  {v.doing.map((w) => (
                    <WorkRow key={w.id} w={w} at={at} />
                  ))}
                </ul>
              ) : (
                <p className="dk-automations-quiet">{v.queue.queued ? `Nothing in hand; ${num(v.queue.queued)} waiting for the workstation.` : "Nothing: the queue is empty."}</p>
              )}
            </div>

            {v.recent.length ? (
              <div className="dk-automations-doing">
                <p className="dk-automations-more-head">Last work</p>
                <ul className="dk-automations-work">
                  {v.recent.map((w) => (
                    <WorkRow key={w.id} w={w} at={at} />
                  ))}
                </ul>
              </div>
            ) : null}
            <Stamp reading={ok} />
          </div>
        )}
      </Read>
    </Card>
  );
}

function WorkRow({ w, at }: { w: RunnerWork; at: string }) {
  const tone = w.state === "running" ? "info" : w.state === "done" ? "good" : w.state === "stuck" ? "bad" : "quiet";
  const when = w.finished ?? w.taken ?? w.queued;
  const length = w.state === "done" && w.taken && w.finished ? took(Date.parse(w.finished) - Date.parse(w.taken)) : null;
  const detail =
    w.state === "running"
      ? `since ${ago(w.taken ?? w.queued, at)}`
      : w.state === "stuck"
        ? `stuck after ${w.attempts} attempt${w.attempts === 1 ? "" : "s"}`
        : length
          ? `took ${length}`
          : w.state;
  return (
    <li className="dk-automations-work-row" title={w.error}>
      <time className="dk-num" dateTime={when}>
        {feedTime(when, at)}
      </time>
      <StatusDot tone={tone} title={w.state} />
      <span className="dk-automations-work-text">
        <span className="dk-automations-work-kind">{workKind(w.kind)}</span>
        <span className="dk-automations-work-what">{w.what}</span>
      </span>
      <span className={cx("dk-automations-work-detail", w.state === "stuck" && "dk-automations-bad")}>{detail}</span>
    </li>
  );
}
