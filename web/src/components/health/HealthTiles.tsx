import type { Reading, Stat } from "@/contract/common";
import type { Deployment, HealthTiles as Tiles6 } from "@/contract/health";
import { Spark, SparkBars } from "@/components/charts";
import { Badge } from "@/components/ui/Badge";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Tooltip } from "@/components/ui/Tooltip";
import { ago, clock, fullDate, shortDate } from "@/lib/format";
import { ERROR_RULE, PASS_RULE, rateChip, RUN_RULE, VITALS, vitalTone } from "./rules";

/** A tile's chip, with the rule behind it on hover: the board draws no (i) on its tiles, so the explanation lives here. */
function Chip({ chip, tip }: { chip: { tone: "good" | "warn" | "bad" | "info" | "quiet"; text: string } | null; tip: string }) {
  return chip ? (
    <Tooltip text={tip}>
      <Badge tone={chip.tone} dot>
        {chip.text}
      </Badge>
    </Tooltip>
  ) : null;
}

function speedChip(r: Reading<Stat>) {
  if (r.state !== "ok") return null;
  const t = vitalTone(r.value.value, VITALS.lcp.good, VITALS.lcp.poor);
  return { tone: t, text: t === "good" ? "Good" : t === "warn" ? "Needs work" : "Poor" };
}

/* A rate that lives near 100% is drawn from its own lowest reading (the Spark primitive's "min" floor); the error rate from zero. */
const spark = (tone: "good" | "bad" = "good") => (s: Stat) => <Spark data={s.series} tone={tone} floor={tone === "good" ? "min" : "zero"} />;

/** The six figures under the head, in the board's order. */
export function HealthTiles({ tiles }: { tiles: Tiles6 }) {
  return (
    <Tiles count={6} className="dk-health-tiles">
      <Tile
        label="Uptime"
        reading={tiles.uptime}
        badge={<Chip chip={rateChip(tiles.uptime, "pass")} tip={`Checks of the home page that answered 200, out of those that ran in the range. One check every two minutes from the desk's server. Healthy from ${PASS_RULE.good}%, the desk's own line.`} />}
        chart={spark()}
      />
      <Tile
        label="Page speed (LCP)"
        reading={tiles.speed}
        downIsGood
        badge={<Chip chip={speedChip(tiles.speed)} tip="Largest Contentful Paint: field (real Chrome visits, 75th percentile, 28 days) when Google has data for the site, otherwise lab (one PageSpeed load per page on a simulated phone). The line under the figure says which. Good up to 2.5 s, poor over 4 s, as Google publishes." />}
        chart={spark()}
      />
      <Tile
        label="Endpoint health"
        reading={tiles.endpoints}
        badge={<Chip chip={rateChip(tiles.endpoints, "pass")} tip="Checks of the other probed addresses (insights index, sitemap, a cached file, a function) that got their healthy answer. These are the only addresses the desk calls: none of the website's form or booking routes is ever probed." />}
        chart={spark()}
      />
      <DeployTile reading={tiles.deployment} />
      <Tile
        label="Background jobs"
        reading={tiles.jobs}
        badge={<Chip chip={rateChip(tiles.jobs, "runs")} tip={`Runs of the desk's scheduled jobs that finished without an error. The desk keeps a week of runs. Healthy from ${RUN_RULE.good}%.`} />}
        chart={spark()}
      />
      <Tile
        label="Error rate"
        reading={tiles.errors}
        downIsGood
        badge={<Chip chip={rateChip(tiles.errors, "errors")} tip={`Checks of every probed address that failed (no answer, or not the healthy status), out of all checks in the range. Good up to ${ERROR_RULE.good}%.`} />}
        chart={spark("bad")}
      />
    </Tiles>
  );
}

/** The tile's chip for the newest commit: only what the desk verified (DeployState), never a build result. */
function deployChip(d: Deployment): { tone: "good" | "bad" | "quiet"; text: string; tip: string } | null {
  const at = d.check ? `${clock(d.check.at)} on ${fullDate(d.check.at)}` : "";
  const from = `${clock(d.checkFrom)} on ${fullDate(d.checkFrom)}`;
  const vercel = "Whether Vercel's build of it succeeded only Vercel knows; the desk has no Vercel token.";
  switch (d.state) {
    case "live":
      return { tone: "good", text: "Live", tip: `The home page answered ${d.check?.status ?? 200} at ${at}, at least three minutes after the desk saw this commit, so Vercel's build had had time. ${vercel}` };
    case "failed":
      return { tone: "bad", text: "Check failed", tip: `The first check of the home page after this commit's build had had time (${at}) got ${d.check?.status || "no answer"}.` };
    case "pending":
      return { tone: "quiet", text: "Unchecked", tip: `No check counts for this commit yet: checks count from ${from}, three minutes after the desk saw it, so Vercel's build has had time. The desk checks every two minutes.` };
    default:
      return null;
  }
}

/**
 * The board's "Deployment status" tile. The desk sees commits, not Vercel's
 * builds, so the figure is "Last change" with its age, and the chip says
 * "Live" only by the rule the history table uses (DeployState). The bars
 * count commits per bucket from where the desk's record of them begins.
 */
function DeployTile({ reading }: { reading: Reading<Deployment> }) {
  const d = reading.state === "ok" ? reading.value : null;
  const chip = d ? deployChip(d) : null;
  return (
    <article className="dk-tile dk-health-deploy">
      <div className="dk-tile-main">
        <div className="dk-tile-top">
          <h3 className="dk-tile-label">
            <span className="dk-tile-label-text">Deployment status</span>
          </h3>
          {chip ? (
            <span className="dk-tile-badge">
              <Tooltip text={chip.tip}>
                <Badge tone={chip.tone} dot>
                  {chip.text}
                </Badge>
              </Tooltip>
            </span>
          ) : null}
        </div>
        {d && reading.state === "ok" ? (
          <>
            <div className="dk-tile-row">
              <div className="dk-tile-figures dk-health-deploy-figures">
                <p className="dk-tile-figure">
                  <span className="dk-tile-value">Last change</span>
                </p>
                <p className="dk-tile-under dk-health-deploy-age">
                  <time dateTime={d.at} suppressHydrationWarning title={`Committed ${clock(d.at)} on ${fullDate(d.at)}`}>
                    {ago(d.at)}
                  </time>
                </p>
              </div>
              {d.perBucket.some((n) => n > 0) ? (
                <>
                  <div className="dk-tile-chart">
                    <SparkBars data={d.perBucket} label={`Commits to main per bar${d.barsSince ? `, since ${fullDate(d.barsSince)}, where the desk's record of them begins` : ""}`} />
                  </div>
                  {d.barsSince ? (
                    <span className="dk-health-bars-since" title="The desk's record of commits begins here: before it, the number is unknown, not zero.">
                      since {shortDate(d.barsSince)}
                    </span>
                  ) : null}
                </>
              ) : null}
            </div>
            <p className="dk-tile-sub dk-health-deploy-subject" title={`${d.short} ${d.subject}`}>
              <span className="dk-health-mono">{d.short}</span> {d.subject}
            </p>
            <Stamp reading={reading} />
          </>
        ) : reading.state !== "ok" ? (
          <Absent reading={reading} form="tile" />
        ) : null}
      </div>
    </article>
  );
}
