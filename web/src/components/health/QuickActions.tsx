import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Diagnostics } from "./Diagnostics";

/**
 * The board's quick actions, the two the desk can really do: the full log,
 * and a check of the site now. "Revalidate cache" and "Rollback deployment"
 * are Vercel operations; without a Vercel token the desk cannot perform them,
 * so they are not drawn.
 */
export function QuickActions() {
  return (
    <section className="dk-card dk-health-qas" aria-label="Quick actions">
      <div className="dk-health-qas-head">
        <Icon name="bolt" size={20} className="dk-health-qas-icon" />
        <span>
          <span className="dk-health-qas-title">Quick actions</span>
          <span className="dk-health-qa-desc">Check for issues</span>
        </span>
      </div>
      <Go href="/site-health/logs" className="dk-health-qa">
        <Icon name="file-text" size={16} />
        <span className="dk-health-qa-text">
          <span className="dk-health-qa-label">View logs</span>
          <span className="dk-health-qa-desc">The full activity log</span>
        </span>
      </Go>
      <Diagnostics />
    </section>
  );
}

/** The ribbon over a screen fed with specimen rows (?specimen=1, development only). */
export function SpecimenRibbon() {
  return (
    <p className="dk-health-specimen" role="note">
      <Icon name="flask" size={15} />
      <span>
        <b>Specimen data.</b> The PageSpeed panels (page speed, performance trend, Core Web Vitals) show artificial values to preview their connected state. They are not measurements of the website.
      </span>
    </p>
  );
}
