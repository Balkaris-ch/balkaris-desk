import { cache } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { LinkPayload } from "@/contract/article";
import { ask, DeskError } from "@/lib/api";
import { ago } from "@/lib/format";
import { PageHead } from "@/components/shell/PageHead";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardFoot } from "@/components/ui/Card";
import { ActionForm } from "@/components/article/ActionForm";
import { Done } from "@/components/article/Done";
import { HistoryPanel, SourcePanel, WorkPanel } from "@/components/article/panels";
import { LINK_SAYS, StateBadge } from "@/components/article/parts";
import "@/components/article/article.css";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const load = cache(async (id: string): Promise<LinkPayload> => {
  if (!/^\d{1,9}$/.test(id)) notFound();
  const a = await ask<LinkPayload>(`/api/v1/article/link/${id}`);
  if (a.ok) return a.value;
  if (a.kind === "missing") notFound();
  if (a.kind === "signed-out") redirect("/auth/google");
  throw new DeskError(a.kind, a.status, a.message);
});

const titleOf = (p: LinkPayload): string => p.source.title ?? p.source.url;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: titleOf(await load(id)) };
}

/**
 * A link that was shared and has no article yet: the old console's link page
 * (src/console.ts `linkPage`) in the new frame. What the desk knows about it,
 * why it is waiting or why it failed, the workstation's jobs with their
 * errors, its history, and "Try it again". When an article has been written
 * from it after all, the way to that article.
 */
export default async function LinkPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const p = await load(id);
  /* The link's own state says "queued" while its only job has been parked as
     stuck, and after its draft was deleted, when nothing at all is queued
     (the delete re-marks the link and queues no job); the jobs say which. */
  const open = p.work.jobs.some((j) => j.state === "queued" || j.state === "running");
  const stuck = !open && p.work.jobs.some((j) => j.state === "stuck");
  const idle = !open && !stuck && (p.state === "queued" || p.state === "social");
  const said =
    stuck && !p.draft
      ? { label: "Stuck: the workstation gave up", tone: "bad" as const }
      : idle
        ? p.draft
          ? LINK_SAYS.drafted
          : { label: "Nothing queued", tone: "warn" as const }
        : (LINK_SAYS[p.state] ?? { label: p.state, tone: "quiet" as const });
  const done = Array.isArray(sp.done) ? sp.done[0] : sp.done;
  const shared = p.source.sharedBy ? `Shared by ${p.source.sharedBy} ${ago(p.source.sharedAt)}` : `Shared ${ago(p.source.sharedAt)}; the desk did not record by whom`;
  const deleted = p.history.some((h) => h.kind === "draft.removed");
  const written = p.draft
    ? "An article has been written from it."
    : deleted
      ? "Its article was deleted; the link stays."
      : "No article has been written from it yet.";

  return (
    <>
      <PageHead eyebrow="Insights · Shared link" title={<span className="dk-article-headline">{titleOf(p)}</span>} subtitle={`${shared}. ${written}`} />

      <Done done={done} history={p.history} />

      <div className="dk-article">
        <div className="dk-article-layout">
          <div className="dk-article-main dk-article-stack">
            <SourcePanel source={p.source} />
            <HistoryPanel history={p.history} className="dk-article-last" />
          </div>
          <div className="dk-article-side">
            <Card
              title="The link"
              icon="link"
              right={<Badge tone={said.tone}>{said.label}</Badge>}
              footer={<CardFoot href={`/link/${p.linkId}`}>Open it on the old console</CardFoot>}
            >
              {p.error ? (
                <p className="dk-article-flag dk-article-flag--first">
                  <b>Why it stopped.</b> {p.error}
                </p>
              ) : null}
              {p.draft ? (
                <div className="dk-article-written">
                  <div className="dk-article-written-text">
                    <p className="dk-article-quiet">{`Draft ${p.draft.id}`}</p>
                    <p className="dk-article-written-title">{p.draft.title}</p>
                  </div>
                  <StateBadge state={p.draft.state} />
                  <LinkButton href={`/insights/${p.draft.id}`} size="sm" variant="good" iconRight="chevron-right">
                    Open the article
                  </LinkButton>
                </div>
              ) : null}
              {idle && !p.draft ? (
                <p className={p.error ? "dk-article-flag" : "dk-article-flag dk-article-flag--first"}>
                  <b>Nothing is waiting for the workstation.</b> It takes this link up again only when somebody presses Try it again, which writes a new article from it.
                </p>
              ) : null}
              {p.offers.retry ? (
                <div className="dk-article-acts">
                  <ActionForm
                    post={`/link/${p.linkId}/retry`}
                    back={`/insights/link/${p.linkId}?done=retry`}
                    label="Try it again"
                    variant="primary"
                    icon="refresh"
                    explain="Queues it for the workstation again, deciding afresh whether it is an article or a social post. Nothing reaches the site until a person publishes it."
                  />
                </div>
              ) : null}
            </Card>
            <WorkPanel work={p.work} />
          </div>
        </div>
      </div>
    </>
  );
}
