import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { EngineCheck, EngineLocal, EnginePublic } from "@/contract/hosting";
import { Spark } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { Tooltip } from "@/components/ui/Tooltip";
import { ago, DASH, num } from "@/lib/format";

function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="dk-hosting-kv">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** What one check found: up with its time, or the answer it got in its own words. */
function Answer({ c }: { c: EngineCheck }) {
  return c.ok ? (
    <Tooltip text={`${c.url} answered 200 with ok: true in ${num(c.ms)} ms.`}>
      <span tabIndex={0}>
        <StatusDot tone="good">{num(c.ms)}ms</StatusDot>
      </span>
    </Tooltip>
  ) : (
    <Tooltip text={`${c.url}: ${c.failure ?? "no answer"}`}>
      <span tabIndex={0}>
        <StatusDot tone="bad" tint>
          {c.status ? `Answered ${c.status}` : "No answer"}
        </StatusDot>
      </span>
    </Tooltip>
  );
}

/**
 * The engine on the box: the website's enquiry form, booking calendar and
 * slots call it. Left: the loopback check every two minutes. Right: the
 * public address hourly, with its certificate.
 */
export function EnginePanel({ local, pub }: { local: Reading<EngineLocal>; pub: Reading<EnginePublic> }) {
  return (
    <Card
      title="Engine"
      icon="server"
      className="dk-hosting-card"
      right={<Stamp reading={local} />}
      info="The desk's own check of the engine's /health, which answers { ok, ai_mode, store, crm } and does no work. Up means 200 and ok: true; anything else is shown as it came, a 502 or 503 while its database is paused included."
    >
      <div className="dk-hosting-engine">
        <div className="dk-hosting-engine-col">
          <p className="dk-hosting-subhead">On the box, every 2 min</p>
          <Read reading={local}>
            {(e) => (
              <>
                <dl className="dk-hosting-kvs">
                  <KV k="Answer">
                    <Answer c={e} />
                  </KV>
                  <KV k="Store">{e.body?.store ?? DASH}</KV>
                  <KV k="AI mode">{e.body?.aiMode ?? DASH}</KV>
                  <KV k="CRM">{e.body?.crm ?? DASH}</KV>
                  <KV k="Last 24 h">
                    <span className="dk-num">
                      {num(e.passed)} / {num(e.checks)} passed
                    </span>
                  </KV>
                </dl>
                {e.spark.filter((x) => x !== null).length > 1 ? <Spark data={e.spark} size="row" floor="min" label="Time to answer per hour, last 24 hours" /> : null}
              </>
            )}
          </Read>
        </div>
        <div className="dk-hosting-engine-col dk-hosting-engine-col--pub">
          <p className="dk-hosting-subhead">Public, hourly</p>
          <Read reading={pub}>
            {(e) => (
              <dl className="dk-hosting-kvs">
                <KV k="Answer">
                  <Answer c={e} />
                </KV>
                <KV k="Checked">
                  <time dateTime={e.at} suppressHydrationWarning>
                    {ago(e.at)}
                  </time>
                </KV>
                <KV k="Certificate">
                  {e.cert && e.cert.daysLeft !== null ? (
                    <Tooltip text={`${e.cert.issuer ?? "Unknown issuer"}, valid until ${e.cert.validTo?.slice(0, 10) ?? "?"}${e.cert.trusted ? "" : ` (${e.cert.problem ?? "not trusted"})`}`}>
                      <span tabIndex={0}>
                        <StatusDot tone={!e.cert.trusted || e.cert.daysLeft < 0 ? "bad" : e.cert.daysLeft > 14 ? "good" : "warn"}>
                          {e.cert.daysLeft < 0 ? "Expired" : `${e.cert.daysLeft} days`}
                        </StatusDot>
                      </span>
                    </Tooltip>
                  ) : (
                    <span className="dk-hosting-quiet">{e.cert?.problem ?? "Not read yet"}</span>
                  )}
                </KV>
              </dl>
            )}
          </Read>
        </div>
      </div>
    </Card>
  );
}
