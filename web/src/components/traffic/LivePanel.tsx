"use client";

import type { Reading } from "@/contract/common";
import type { TrafficLive } from "@/contract/traffic";
import { SparkBars } from "@/components/charts/SparkBars";
import { Bar } from "@/components/charts/BarList";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { useLive } from "@/lib/live";
import { num } from "@/lib/format";
import { deviceLabel } from "./words";
import "./traffic.css";

/**
 * GA4's realtime reports poll at most every two minutes on the server (ga4.ts,
 * LIVE_EVERY: the realtime token bucket is shared by every copy of the desk),
 * so asking more often would only be handed the same answer.
 */
const POLL_MS = 120_000;

/**
 * Live visitors: people active in the last 30 minutes, minute by minute, by
 * page title, by country and by device. Drawn by the server first, then kept
 * current in the browser while the tab is visible.
 */
export function LivePanel({ initial, realtime }: { initial: Reading<TrafficLive>; realtime: string }) {
  const live = useLive<Reading<TrafficLive>>("/api/v1/traffic/live", POLL_MS, initial);
  const reading = live.data ?? initial;

  return (
    <Card
      title="Live visitors"
      icon="pulse"
      className="dk-traffic-live"
      info="People with a page of the website open in the last 30 minutes, as GA4's realtime report counts them: only visitors who accepted the cookie banner, by page title (realtime has no address or traffic source), and every site that sends to the same GA4 property."
      right={
        <>
          <Stamp reading={reading} />
          <LinkButton href={realtime} variant="ghost" size="sm" icon="external" aria-label="Open GA4's realtime report" title="Open GA4's realtime report" />
        </>
      }
    >
      {reading.state !== "ok" ? <Absent reading={reading} /> : <LiveBody v={reading.value} />}
      {live.error && reading.state === "ok" ? <p className="dk-traffic-live-err">Not refreshed: {live.error}</p> : null}
    </Card>
  );
}

function LiveBody({ v }: { v: TrafficLive }) {
  /* GA4 can list a title with nobody on it (a view counted, the person gone): only titles with people are rows. */
  const screens = v.screens.filter((s) => s.users > 0);
  const top = Math.max(0, ...screens.map((s) => s.users));
  return (
    <div className="dk-traffic-live-body">
      <div className="dk-traffic-live-now">
        <p className="dk-traffic-live-head">
          <b className="dk-traffic-live-figure dk-num">{num(v.total)}</b>
          <span>{v.total === 1 ? "person active in the last 30 minutes" : "people active in the last 30 minutes"}</span>
        </p>

        <div className="dk-traffic-minutes">
          <SparkBars data={v.minutes} label={`People active in each of the last 30 minutes: ${v.minutes.join(", ")}`} className="dk-traffic-minutes-bars" />
          <p className="dk-traffic-minutes-axis" aria-hidden>
            <span>30 min ago</span>
            <span>now</span>
          </p>
        </div>
      </div>

      <div className="dk-traffic-live-where">
        {screens.length === 0 ? (
          <p className="dk-traffic-quiet">{v.total === 0 ? "Nobody who accepted analytics has the website open right now." : "GA4 named no page titles for this half hour."}</p>
        ) : (
          <ol className="dk-traffic-live-list" aria-label="By page title">
            {screens.slice(0, 5).map((s) => (
              <li key={s.title} className="dk-traffic-live-row">
                <span className="dk-traffic-live-n dk-num">{num(s.users)}</span>
                <span className="dk-traffic-live-title" title={s.path ? `${s.title} (${s.path})` : s.title}>
                  {s.path ?? s.title}
                </span>
                <Bar value={s.users} max={top} className="dk-traffic-live-bar" />
              </li>
            ))}
          </ol>
        )}

        {v.total > 0 ? (
          <dl className="dk-traffic-live-split">
            <div>
              <dt>Countries</dt>
              <dd>
                {v.countries.length
                  ? v.countries
                      .slice(0, 3)
                      .map((c) => `${c.name} ${num(c.users)}`)
                      .join(" · ")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Devices</dt>
              <dd>{v.devices.length ? v.devices.map((d) => `${deviceLabel(d.key)} ${num(d.users)}`).join(" · ") : "—"}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </div>
  );
}
