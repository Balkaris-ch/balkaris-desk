import type { ReactNode } from "react";
import type { Reading, Stat } from "@/contract/common";
import type { BuildRow, BuildState, ConsentGap, EngineLocal, HostingTiles as Tiles6, PlatformStatus } from "@/contract/hosting";
import { Spark, SparkBars } from "@/components/charts";
import { Badge } from "@/components/ui/Badge";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Tooltip } from "@/components/ui/Tooltip";
import { ago, clock, duration, fullDate, num, shortDate } from "@/lib/format";
import { BUILD_STATE, componentTone, platformWord } from "./words";

/** A tile's chip, with what stands behind it on hover. */
function Chip({ tone, text, tip }: { tone: "good" | "warn" | "bad" | "info" | "quiet"; text: string; tip: string }) {
  return (
    <Tooltip text={tip}>
      <Badge tone={tone} dot>
        {text}
      </Badge>
    </Tooltip>
  );
}

/**
 * A tile whose figure is a state, not a number: the build, Vercel's status,
 * the engine. The same anatomy as the Tile primitive (label and chip, figure,
 * a line under it, a small line, the stamp), so the six tiles' lines meet.
 */
function StateTile<T>({
  label,
  reading,
  chip,
  figure,
  under,
  sub,
  chart,
}: {
  label: string;
  reading: Reading<T>;
  chip?: (v: T) => ReactNode;
  figure: (v: T) => ReactNode;
  under?: (v: T) => ReactNode;
  sub?: (v: T) => ReactNode;
  chart?: (v: T) => ReactNode;
}) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <article className="dk-tile dk-hosting-statetile">
      <div className="dk-tile-main">
        <div className="dk-tile-top">
          <h3 className="dk-tile-label">
            <span className="dk-tile-label-text">{label}</span>
          </h3>
          {v !== null && chip ? <span className="dk-tile-badge">{chip(v)}</span> : null}
        </div>
        {v !== null && reading.state === "ok" ? (
          <>
            <div className="dk-tile-row">
              <div className="dk-tile-figures">
                <p className="dk-tile-figure dk-num">
                  <span className="dk-tile-value dk-hosting-statevalue">{figure(v)}</span>
                </p>
                {under ? <p className="dk-tile-under dk-hosting-under">{under(v)}</p> : null}
              </div>
              {chart ? <div className="dk-tile-chart">{chart(v)}</div> : null}
            </div>
            {sub ? <p className="dk-tile-sub dk-hosting-tilesub">{sub(v)}</p> : null}
            <Stamp reading={reading} />
          </>
        ) : reading.state !== "ok" ? (
          <Absent reading={reading} form="tile" />
        ) : null}
      </div>
    </article>
  );
}

const bars = (label: string) => (s: Stat) => <SparkBars data={s.series} label={label} />;

/** "1 in 4.9": how many server page views stand behind each one GA4 saw. */
function oneIn(g: ConsentGap): string {
  if (!g.server) return "none counted";
  if (!g.ga4) return "none";
  return `1 in ${num(g.server / g.ga4, 1)}`;
}

function buildChip(b: BuildRow) {
  const s = BUILD_STATE[b.state];
  const why = b.error ? `${b.error.message ?? b.error.code ?? "No reason given."}${b.error.step ? ` (step: ${b.error.step})` : ""}` : s.tip;
  return <Chip tone={s.tone} text={s.text} tip={why} />;
}

function platformChip(p: PlatformStatus) {
  const worst = p.components.reduce<"good" | "warn" | "bad" | "info" | "quiet">((a, c) => {
    const t = componentTone(c.status);
    const rank = { bad: 3, warn: 2, info: 1, quiet: 0, good: 0 } as const;
    return rank[t] > rank[a] ? t : a;
  }, "good");
  const touching = p.incidents.filter((i) => i.touches.length).length;
  return <Chip tone={touching && worst === "good" ? "warn" : worst} text={worst === "good" && !touching ? "Operational" : touching ? "Incident" : "Degraded"} tip={`The parts of Vercel this site stands on, as Vercel's status page reports them. The page itself says: ${p.description}.`} />;
}

/** The six figures under the head. */
export function HostingTiles({ tiles }: { tiles: Tiles6 }) {
  return (
    <Tiles count={6} className="dk-hosting-tiles">
      <Tile
        label="True page views today"
        reading={tiles.viewsToday}
        delta="none"
        info="Today's page views (Zurich day) from Vercel's own request records: pages loaded and navigations that reached Vercel, robots, prefetches and files set aside by the rules on this screen. The small line is the range's total."
        chart={bars("Page views per day, from Vercel's records")}
      />
      <Tile
        label="GA4 page views"
        reading={tiles.ga4Views}
        delta="none"
        info="GA4's page views on the same whole days the consent gap compares. GA4 loads only after a visitor accepts the cookie banner, so it counts consenting visitors only."
        chart={bars("GA4 page views per day")}
      />
      <StateTile<ConsentGap>
        label="Consent gap"
        reading={tiles.gap}
        chip={(g) => <Chip tone="info" text={oneIn(g)} tip="How many page views the server counted for each one GA4 saw, on the same whole days." />}
        figure={(g) => (
          <>
            {num(g.ga4)}
            <span className="dk-tile-of">/ {num(g.server)}</span>
          </>
        )}
        under={() => "GA4 / the server's own count"}
        sub={(g) => `${g.days} whole day${g.days === 1 ? "" : "s"}, ${shortDate(g.from)}–${shortDate(g.to)}`}
      />
      <StateTile<BuildRow>
        label="Last build"
        reading={tiles.build}
        chip={buildChip}
        figure={(b) => (b.durationMs !== null ? duration(b.durationMs) : BUILD_STATE[b.state].text)}
        under={(b) => (
          <time dateTime={b.createdAt} suppressHydrationWarning title={`Created ${clock(b.createdAt)} on ${fullDate(b.createdAt)}`}>
            {ago(b.createdAt)}
          </time>
        )}
        sub={(b) => (
          <>
            {b.sha ? <span className="dk-hosting-mono">{b.sha.slice(0, 7)}</span> : null} {b.creator ?? ""}
          </>
        )}
      />
      <StateTile<PlatformStatus>
        label="Vercel status"
        reading={tiles.platform}
        chip={platformChip}
        figure={(p) => platformWord(p)}
        under={(p) => `${p.components.length} parts watched`}
        sub={(p) => (p.incidents.length ? `${p.incidents.length} unresolved incident${p.incidents.length === 1 ? "" : "s"} on the page` : "No unresolved incident on the page")}
      />
      <StateTile<EngineLocal>
        label="Engine"
        reading={tiles.engine}
        chip={(e) => <Chip tone={e.ok ? "good" : "bad"} text={e.ok ? "Answers" : "Not answering"} tip={e.ok ? `${e.url} answered 200 with ok: true.` : `${e.url}: ${e.failure ?? "no answer"}`} />}
        figure={(e) => (e.ok && e.ms !== null ? `${num(e.ms)}ms` : e.status ? String(e.status) : "No answer")}
        under={(e) => (e.ok ? "to answer, over loopback" : (e.failure ?? "no answer"))}
        sub={(e) => `${num(e.passed)} / ${num(e.checks)} checks passed in 24 h`}
        chart={(e) => (e.spark.filter((x) => x !== null).length > 1 ? <Spark data={e.spark} floor="min" label="Engine answer time per hour" /> : null)}
      />
    </Tiles>
  );
}
