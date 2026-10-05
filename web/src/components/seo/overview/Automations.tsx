import type { SeoJob } from "@/contract/seo/common";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { ago } from "@/lib/format";
import { DEFAULT_RANGE, seoHref } from "./href";
import { RunNow } from "./RunNow";
import { JobSwitch } from "./Switch";
import "./overview.css";

/** The strip's five, in the board's spirit: the Search Console sync, the engine, the crawl, the index check, the keyword research. */
const PICK: { name: string; icon: IconName }[] = [
  { name: "seo-snapshot", icon: "line-chart" },
  { name: "seo-engine", icon: "lightbulb" },
  { name: "crawl", icon: "globe" },
  { name: "gsc-inspect", icon: "search" },
  { name: "seo-research", icon: "tag" },
];

/** "Every 6 hours", "Daily", "Weekly", "Every 15 min". */
export function every(seconds: number): string {
  if (seconds % (7 * 86_400) === 0) return seconds === 7 * 86_400 ? "Weekly" : `Every ${seconds / (7 * 86_400)} weeks`;
  if (seconds % 86_400 === 0) return seconds === 86_400 ? "Daily" : `Every ${seconds / 86_400} days`;
  if (seconds % 3600 === 0) return seconds === 3600 ? "Hourly" : `Every ${seconds / 3600} hours`;
  return `Every ${Math.round(seconds / 60)} min`;
}

/** The job's state in a few words: running, last run, never run, switched off. */
function when(j: SeoJob): string {
  if (j.running) return "Running now";
  if (!j.ready) return "Waits for its source";
  if (!j.enabled) return "Switched off";
  if (j.lastEnd) return `${j.lastOk === false ? "Failed" : "Ran"} ${ago(j.lastEnd)}`;
  return "Not run yet";
}

/**
 * The Automations strip at the foot of the board: five of the jobs the SEO
 * section runs on, each with its schedule, its last run, "Run now" for a
 * person the server lets run it (`run`, the payload's `can.run`; "Retry",
 * marked, after a failed run) and, for the owner, its switch. "Manage
 * automations" lists them all with their budgets.
 */
export function Automations({ jobs, owner, run = [], range = DEFAULT_RANGE }: { jobs: SeoJob[]; owner: boolean; run?: string[]; range?: string }) {
  const picked = PICK.flatMap((p) => {
    const j = jobs.find((x) => x.name === p.name);
    return j ? [{ ...p, job: j }] : [];
  });
  const more = jobs.length - picked.length;
  return (
    <Card title="Automations" icon="clock" className="dk-seo-overview-panel dk-seo-overview-a-auto" right={<LinkButton href={seoHref("/seo/automations", range)} size="sm">Manage automations{more > 0 ? ` (${jobs.length})` : ""}</LinkButton>}>
      {picked.length ? (
        <ul className="dk-seo-overview-autos" aria-label="SEO jobs">
          {picked.map(({ job: j, icon }) => (
            <li key={j.name} className={cx("dk-seo-overview-auto", j.lastOk === false && !j.running && "dk-seo-overview-auto--failed")}>
              <span className="dk-seo-overview-auto-icon" aria-hidden>
                <Icon name={icon} size={18} />
              </span>
              <Tooltip text={j.budget ? `${j.what} ${j.budget.line}.` : j.what}>
                <span className="dk-seo-overview-auto-text" tabIndex={0}>
                  <span className="dk-seo-overview-auto-title">{j.title}</span>
                  <span className="dk-seo-overview-auto-sub" suppressHydrationWarning>
                    {every(j.every)} · {when(j)}
                  </span>
                </span>
              </Tooltip>
              {/* Not offered while it runs, while what it reads is not connected, or while it is switched off: the door would refuse. */}
              {run.includes(j.name) && j.ready && j.enabled && !j.running ? <RunNow name={j.name} title={j.title} failed={j.lastOk === false} /> : null}
              {owner ? (
                <JobSwitch name={j.name} title={j.title} enabled={j.enabled} />
              ) : (
                <span className="dk-seo-overview-quiet" title="Only the owner can switch a job off or on.">
                  {j.enabled ? "On" : "Off"}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dk-seo-overview-quiet">The SEO jobs are not registered on this desk yet.</p>
      )}
    </Card>
  );
}
