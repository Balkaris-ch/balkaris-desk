import type { Reading } from "@/contract/common";
import type { BuildLog } from "@/contract/hosting";
import { Card } from "@/components/ui/Card";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { clock, duration, num } from "@/lib/format";
import { BUILD_STATE } from "./words";

/** The log as lines: time, an error mark, the text, mono. Nothing is interpreted. */
export function BuildLogPanel({ reading }: { reading: Reading<BuildLog> }) {
  return (
    <Card title="Last log lines" icon="terminal" className="dk-hosting-card" right={<Stamp reading={reading} />}>
      <Read reading={reading}>
        {(l) => (
          <>
            {l.build ? (
              <p className="dk-hosting-line">
                <StatusDot tone={BUILD_STATE[l.build.state].tone}>{BUILD_STATE[l.build.state].text}</StatusDot>
                {l.build.durationMs !== null ? <span className="dk-hosting-quiet"> · built in {duration(l.build.durationMs)}</span> : null}
                {l.build.error?.message ? <span className="dk-hosting-quiet"> · {l.build.error.message}</span> : null}
              </p>
            ) : null}
            {l.lines.length ? (
              <ol className="dk-hosting-log">
                {l.lines.map((x, i) => (
                  <li key={i} className={x.error ? "dk-hosting-log-line dk-hosting-log-line--error" : "dk-hosting-log-line"}>
                    <span className="dk-hosting-log-time dk-num">{x.at ? clock(x.at) : ""}</span>
                    <span className="dk-hosting-log-text">{x.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="dk-hosting-quiet">Vercel returned no log line for this build.</p>
            )}
            <p className="dk-hosting-note">
              The last {num(l.lines.length)} of {num(l.total)} lines Vercel returned.
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}
