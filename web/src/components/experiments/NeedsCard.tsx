import type { ExperimentsPayload } from "@/contract/experiments";
import { Card } from "@/components/ui/Card";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Info } from "@/components/ui/Tooltip";
import { num } from "@/lib/format";

/** "about 8 months", "about 3 weeks", "12 days": a long wait, as a person says it. */
function wait(days: number): string {
  if (days < 21) return `${num(days)} day${days === 1 ? "" : "s"}`;
  if (days < 75) return `about ${num(Math.round(days / 7))} weeks`;
  if (days < 730) return `about ${num(Math.round(days / 30.4))} months`;
  return `about ${num(Math.round(days / 365))} years`;
}

const enquiries = (n: number): string => `${num(n)} enquir${n === 1 ? "y" : "ies"}`;

/**
 * What a real experiment needs: the three things the website lacks before a
 * split test could be offered, the third worked out from the site's own
 * figures so it is a measurement and not an opinion.
 */
export function NeedsCard({ data }: { data: ExperimentsPayload }) {
  const r = data.readiness;
  return (
    <Card
      title="What a real experiment needs"
      icon="lightbulb"
      tone="info"
      className="dk-experiments-needs-card"
      sub="A split test shows two versions of a page to different visitors at the same time. The website cannot do that yet, so the desk does not offer it."
      divided
    >
      <ol className="dk-experiments-needs">
        <li className="dk-experiments-need">
          <span className="dk-experiments-need-n" aria-hidden>
            1
          </span>
          <div className="dk-experiments-need-body">
            <h3 className="dk-experiments-need-title">Variant flags on the website</h3>
            <p className="dk-experiments-need-text">
              Code that shows some visitors one version and the rest another, keeps each visitor on the version they first saw, and can be switched without a deployment. Today every visitor sees what is on main.
            </p>
          </div>
        </li>
        <li className="dk-experiments-need">
          <span className="dk-experiments-need-n" aria-hidden>
            2
          </span>
          <div className="dk-experiments-need-body">
            <h3 className="dk-experiments-need-title">The variant sent to GA4</h3>
            <p className="dk-experiments-need-text">
              Every visit has to say which version it saw: a parameter on the website's events, registered in GA4 Admin as a custom dimension. GA4 reports a dimension only from the day it is registered, never back in time.
            </p>
          </div>
        </li>
        <li className="dk-experiments-need">
          <span className="dk-experiments-need-n" aria-hidden>
            3
          </span>
          <div className="dk-experiments-need-body">
            <h3 className="dk-experiments-need-title">
              Far more traffic than today <Info text={r.state === "ok" ? r.value.method : "Worked out from GA4's visitors and enquiries of the last 30 days."} label="How this was worked out" />
            </h3>
            {r.state === "ok" ? (
              r.value.perVersion !== null && r.value.daysNeeded !== null ? (
                <>
                  <p className="dk-experiments-need-figure dk-num">{wait(r.value.daysNeeded)}</p>
                  <p className="dk-experiments-need-text">
                    {`of today's traffic to tell a version that brings half as many enquiries again from no change: about ${num(r.value.perVersion)} visitors in each version. The rate it rests on is ${enquiries(r.value.enquiries)} sent from ${num(r.value.visitors)} visitors in ${num(r.value.days)} days.`}
                  </p>
                </>
              ) : (
                <p className="dk-experiments-need-text">
                  {`GA4 recorded ${enquiries(r.value.enquiries)} from ${num(r.value.visitors)} visitors in ${num(r.value.days)} days, so there is no enquiry rate to plan a test from yet.`}
                </p>
              )
            ) : (
              <Absent reading={r} form="inline" />
            )}
            {r.state === "ok" ? <Stamp reading={r} /> : null}
          </div>
        </li>
      </ol>
    </Card>
  );
}
