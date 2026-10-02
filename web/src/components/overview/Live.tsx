"use client";

import type { OverviewLive } from "@/contract/overview";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { LinkButton } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { useLive } from "@/lib/live";
import { num } from "@/lib/format";

/** About once a minute: the panel reads the desk's kept answer, which the GA4 job refreshes every two minutes while somebody looks. */
const EVERY = 60_000;

/**
 * "Live visitors": people active in the last 30 minutes as GA4 realtime
 * counts them, by page. Polls GET /api/v1/overview/live; the first answer
 * comes with the screen, so nothing is fetched on arrival.
 */
export function LiveCard({ initial, specimen }: { initial: OverviewLive; specimen: boolean }) {
  const live = useLive<OverviewLive>(`/api/v1/overview/live${specimen ? "?specimen=1" : ""}`, EVERY, initial);
  const reading = live.data ?? initial;
  const report = reading.state === "ok" ? reading.value.report : null;

  return (
    <Card
      title="Live visitors"
      icon="globe"
      className="dk-overview-live"
      info="Right now means active in the last 30 minutes, as GA4 realtime counts it: people who accepted the cookie banner. GA4 names pages by title; a title one crawled page carries is shown as its address."
      right={report ? <LinkButton href={report} variant="ghost" size="sm" icon="external" aria-label="Open GA4's realtime report" title="Open GA4's realtime report" /> : null}
    >
      <Read reading={reading}>
        {(v, r) => {
          const top = Math.max(1, ...v.pages.map((p) => p.users));
          return (
            <>
              <p className="dk-overview-livehead">
                <span className="dk-overview-big dk-num">{num(v.total)}</span>
                <span className="dk-overview-unit">{v.total === 1 ? "person" : "people"} on the site right now</span>
                {/* Its note says what "right now" means: active in the last 30 minutes, as GA4 realtime counts it. */}
                <span className="dk-overview-stampend">
                  <Stamp reading={r} />
                </span>
              </p>
              {v.pages.length ? (
                <ol className="dk-overview-livelist" aria-label="Pages people are on">
                  {v.pages.map((p, i) => (
                    <li key={`${p.label}-${i}`} className="dk-overview-liverow">
                      <span className="dk-overview-livecount dk-num">{num(p.users)}</span>
                      {p.href ? (
                        <Go href={p.href} className="dk-overview-livepage" title={p.label}>
                          {p.label}
                        </Go>
                      ) : (
                        <span className="dk-overview-livepage dk-overview-livetitle" title="A page title GA4 reported; no single crawled page carries it">
                          {p.label}
                        </span>
                      )}
                      <ProgressBar value={p.users} max={top} label={`People on ${p.label}`} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="dk-overview-quiet dk-overview-livenone">{v.total === 0 ? "Nobody has been active in the last 30 minutes." : "GA4 named no page for them."}</p>
              )}
              {v.more > 0 ? <p className="dk-overview-quiet">and {num(v.more)} more {v.more === 1 ? "page" : "pages"}</p> : null}
            </>
          );
        }}
      </Read>
      {live.error && live.data ? <p className="dk-overview-quiet">Not refreshed: {live.error}</p> : null}
    </Card>
  );
}
