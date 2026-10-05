import type { SeoScheduler } from "@/contract/seo/automations";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/StatusDot";
import { cx } from "@/lib/cx";
import { ago, num } from "@/lib/format";
import { ASK_WHY, jobHref, when } from "./words";

/**
 * Whether the SEO jobs start on time here, said plainly: whether anything
 * starts by itself on this desk at all, when the scheduler last started a
 * job, the SEO watch's rules (a late job to the front of the queue, a failed
 * run tried again, a run a restart cut off run again) and what it asked for
 * lately. The rules' numbers come from the server (src/cc/seo/jobs.ts WATCH),
 * so the card says what the code does.
 */
export function OnTime({ scheduler: s, at, range }: { scheduler: SeoScheduler; at: string; range: string }) {
  const tone = !s.on ? "warn" : s.stalled ? "bad" : "good";
  return (
    <Card
      title="Kept on time"
      icon="clock"
      tone={tone}
      sub="The desk runs one job at a time. This is how the SEO jobs get their turn, and what is done when one misses it."
      info="The SEO watch looks every minute wherever the desk's scheduler runs. It only puts a job at the front of the queue, through the same door as Run now; it never runs one beside another."
    >
      <div className="dk-seo-automations-ontime">
        <p className={cx("dk-seo-automations-ontime-state", `dk-tone-${tone}`)} role={tone === "good" ? undefined : "status"}>
          <Icon name={tone === "good" ? "check-circle" : "alert"} size={16} />
          <span>
            {!s.on ? (
              <>
                Nothing starts by itself on this desk: its scheduler is switched off (a workstation&apos;s copy). Run now still runs a job, and every job past its time reads Late.
              </>
            ) : s.stalled ? (
              <>
                Nothing has started on this desk since {s.lastStart ? when(s.lastStart, at) : "it started"}: the scheduler has stopped, or is stuck behind one job. The top bar&apos;s light says so too.
              </>
            ) : (
              <>The scheduler is running: it last started a job {s.lastStart ? ago(s.lastStart, at) : "a moment ago"}.</>
            )}
          </span>
        </p>

        {s.watch.on ? (
          <ul className="dk-seo-automations-ontime-rules">
            <li>
              A job <b className="dk-num">{num(s.watch.askAfterMin)} minutes</b> past its time goes to the front of the queue; past <span className="dk-num">{num(s.watch.lateAfterMin)}</span> minutes it reads Late, and past half an hour the top bar&apos;s light turns.
            </li>
            <li>
              A failed run is tried again after <b className="dk-num">{num(s.watch.retryAfterMin)} minutes</b>, {num(s.watch.retries)} times at most, when the job&apos;s own interval is longer; then it waits for its regular time.
            </li>
            <li>A run a restart of the desk cut off runs again once the desk has settled, instead of a whole interval later.</li>
            <li>Every job&apos;s runs are kept 400 days, so a weekly job shows more than its last run.</li>
          </ul>
        ) : (
          <p className="dk-seo-automations-quiet">
            The SEO watch runs wherever the scheduler runs{s.on ? " and has not started yet" : ": not here"}, so nothing late is asked for and no failed run is tried again on its own. A job&apos;s Next run is its last start plus its interval.
          </p>
        )}

        {s.watch.asks.length ? (
          <>
            <p className="dk-seo-automations-more-head">What the watch asked for lately</p>
            <ol className="dk-seo-automations-log">
              {s.watch.asks.slice(0, 6).map((a) => (
                <li key={`${a.name}:${a.at}`}>
                  <time className="dk-num" dateTime={a.at}>
                    {when(a.at, at)}
                  </time>
                  <StatusDot tone={a.why === "retry" ? "warn" : "info"} title={ASK_WHY[a.why]} />
                  <Go href={jobHref(a.name, range)} className="dk-seo-automations-log-body dk-seo-automations-log-link">
                    <span className="dk-seo-automations-log-text">{a.title}</span>
                    <span className="dk-seo-automations-log-detail">
                      {ASK_WHY[a.why]}; its time was {when(a.since, at)}
                    </span>
                  </Go>
                </li>
              ))}
            </ol>
          </>
        ) : s.watch.on ? (
          <p className="dk-seo-automations-quiet">The watch has not needed to ask for anything: every job started on its own.</p>
        ) : null}
      </div>
    </Card>
  );
}
