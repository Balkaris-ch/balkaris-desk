import type { HealthDeployments } from "@/contract/health";
import { DeployTable } from "@/components/health/Tables";
import { PageHead } from "@/components/shell/PageHead";
import { buttonClass, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { api } from "@/lib/api";
import { fullDate, num } from "@/lib/format";
import "@/components/health/health.css";

export const metadata = { title: "Deployment history · Site Health" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** How many rows a page shows first, and how many more each "Show more" adds. */
const STEP = 100;

/**
 * Deployment history in full, behind the panel's "View all": every commit on
 * the website's main branch the desk has recorded, newest first, with what
 * the desk verified about each by the panel's own rule. One request.
 */
export default async function DeploymentsPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const asked = Math.floor(Number(one(q.n)) || STEP);
  const data = await api<HealthDeployments>("/api/v1/health/deployments", { n: Math.min(1000, Math.max(STEP, asked)) });
  const shown = data.list.state === "ok" ? data.list.value.length : 0;
  const more = shown < data.total && data.n < 1000;

  return (
    <>
      <PageHead
        eyebrow="Site Health"
        title="Deployment history"
        subtitle={
          data.since
            ? `Every commit on the website's main branch the desk has recorded, since ${fullDate(data.since)}. Each push to main is a production build on Vercel; the status is only what the desk verified.`
            : "Every commit on the website's main branch the desk has recorded. Each push to main is a production build on Vercel; the status is only what the desk verified."
        }
        action={
          <LinkButton href="/site-health" size="md" icon="arrow-left">
            Site Health
          </LinkButton>
        }
      />
      <Card title="Commits on main" icon="package" count={num(data.total)} flush className="dk-health-card" right={<Stamp reading={data.list} />} sub={shown < data.total ? `The newest ${num(shown)}.` : undefined}>
        <Read reading={data.list}>
          {(rows) => (
            <>
              <DeployTable rows={rows} caption="Commits to the website's main branch, newest first" subjects />
              {more ? (
                <p className="dk-health-more">
                  {/* Only the search param changes: the reader stays where the list ended. */}
                  <Go href={`/site-health/deployments?n=${data.n + STEP}`} scroll={false} className={buttonClass({ size: "sm" })}>
                    Show {num(Math.min(STEP, data.total - shown))} more
                  </Go>
                </p>
              ) : null}
            </>
          )}
        </Read>
      </Card>
    </>
  );
}
