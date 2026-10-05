import { notFound, redirect } from "next/navigation";
import type { TaskResult } from "@/contract/operator";
import { ask, DeskError, me as whoIsLooking } from "@/lib/api";
import { ago, clock, duration, fullDate, sourceLabel } from "@/lib/format";
import { PageHead } from "@/components/shell/PageHead";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Badge } from "@/components/ui/Badge";
import { AnswerText, Flags } from "@/components/operator/Answer";
import { proposalLine } from "@/components/operator/look";
import { ReviewButton } from "@/components/operator/Review";
import { KeywordsApply, TodosAdd } from "@/components/operator/Apply";
import "@/components/operator/operator.css";

export const metadata = { title: "AI Operator: an answer" };

const WORD: Record<string, string> = { waiting: "Waiting", approved: "Approved", applied: "Live", rejected: "Rejected", withdrawn: "Withdrawn" };
const FROM: Record<string, string> = { crawl: "the crawl", "search-console": "Search Console", analytics: "GA4" };

/**
 * One finished task in full: the whole answer, what the desk refused or
 * changed in it, the data it was given and from when, and the proposals it
 * made, each with its review.
 */
export default async function OperatorResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const got = await ask<TaskResult>(`/api/v1/operator/tasks/${id}`);
  if (!got.ok) {
    if (got.kind === "missing") notFound();
    if (got.kind === "signed-out") redirect("/auth/google");
    /* With its digest, so a refusal at the gate is drawn as the access gate, not as a screen that broke. */
    throw new DeskError(got.kind, got.status, got.message);
  }
  const r = got.value;
  const t = r.task;
  const who = await whoIsLooking();
  /* The true reason somebody cannot approve, access asked first as the server asks it (src/people.ts `publishBlock`): an email would not help somebody whose Insights is read-only. */
  const why = who.canPublish
    ? null
    : who.access?.pages?.insights !== undefined && who.access.pages.insights !== "edit"
      ? "Approving changes the live site, and that needs edit on Insights. The owner gives it under Team › Access & Roles."
      : "Approving changes the live site: it needs an email Vercel knows.";

  return (
    <div className="dk-operator">
      <PageHead eyebrow={`AI Operator · ${t.kindLabel}`} title={t.title || t.kindLabel} subtitle={`Asked by ${t.askedBy} on ${fullDate(t.createdAt)} at ${clock(t.createdAt)}.`} action={<LinkButton href="/operator" icon="arrow-left" size="sm">Back to the operator</LinkButton>} />
      <div className="dk-operator-result">
        <Card title={t.state === "failed" ? "Not answered" : "The answer"} icon={t.state === "failed" ? "alert" : "sparkles"} tone={t.state === "failed" ? "bad" : "good"}>
          {t.state === "failed" ? (
            <p className="dk-operator-said dk-operator-said--bad">{t.error}</p>
          ) : (
            <>
              <Flags result={r} />
              <AnswerText text={r.text} />
              {r.opportunities?.length ? (
                <ol className="dk-operator-opps" aria-label="Opportunities">
                  {r.opportunities.map((o, i) => (
                    <li key={i} className="dk-operator-opp">
                      <p className="dk-operator-opp-title">
                        {o.title}
                        {o.page ? (
                          <>
                            {" · "}
                            <Go href={`/pages?open=${encodeURIComponent(o.page)}`} className="dk-operator-link">
                              {o.page}
                            </Go>
                          </>
                        ) : null}
                      </p>
                      <p>{o.why}</p>
                      <p>Next: {o.action}</p>
                      <p className="dk-operator-given">From {FROM[o.from] ?? o.from}.</p>
                    </li>
                  ))}
                </ol>
              ) : null}
              {r.keywords?.length ? <KeywordsApply judgements={r.keywords} /> : null}
              {r.serp ? (
                <div className="dk-operator-serp">
                  <p className="dk-operator-given">
                    From the result page for “{r.serp.phrase}”{r.serp.checkedAt ? `, read ${fullDate(r.serp.checkedAt)}` : ""}
                    {r.serp.page ? (
                      <>
                        {"; our page "}
                        <Go href={`/seo/pages/view?path=${encodeURIComponent(r.serp.page)}`} className="dk-operator-link">
                          {r.serp.page}
                        </Go>
                      </>
                    ) : "; no page of ours is mapped to it"}
                    .
                  </p>
                  <ul className="dk-operator-opps" aria-label="What the first results have">
                    {r.serp.theyHave.map((t, i) => (
                      <li key={i} className="dk-operator-opp">
                        <p>{t.what}</p>
                        <p className="dk-operator-given">
                          Seen on{" "}
                          {t.seenOn.map((u, j) => (
                            <span key={u}>
                              {j ? ", " : ""}
                              <Go href={u} className="dk-operator-link">
                                {u.replace(/^https?:\/\//, "")}
                              </Go>
                            </span>
                          ))}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <p className="dk-operator-aside">
                    Turn it into an article from the{" "}
                    <Go href={`/operator?do=brief&q=${encodeURIComponent(r.serp.phrase)}${r.serp.page ? `&path=${encodeURIComponent(r.serp.page)}` : ""}`} className="dk-operator-link">
                      prompt box
                    </Go>
                    {r.serp.page ? (
                      <>
                        , or change the page itself on its{" "}
                        <Go href={`/seo/pages/view?path=${encodeURIComponent(r.serp.page)}&tab=optimize`} className="dk-operator-link">
                          Optimize tab
                        </Go>
                      </>
                    ) : null}
                    .
                  </p>
                </div>
              ) : null}
              {r.todos?.length ? <TodosAdd taskId={t.id} todos={r.todos} added={!!r.todosAdded} /> : null}
              {r.brief?.links.length ? (
                <p className="dk-operator-aside">
                  Write it from the{" "}
                  <Go href={`/operator?do=brief&q=${encodeURIComponent(r.brief.title)}`} className="dk-operator-link">
                    prompt box
                  </Go>{" "}
                  again, or create the article on the{" "}
                  <Go href="/insights?create=1" className="dk-operator-link">
                    Insights screen
                  </Go>
                  .
                </p>
              ) : null}
            </>
          )}
        </Card>
        <div className="dk-operator-side">
          <Card title="What it was given" icon="database">
            <dl className="dk-operator-facts">
              {r.given.length ? (
                r.given.map((g, i) => (
                  <div key={i} className="dk-operator-fact">
                    <dt>{g.label}</dt>
                    <dd>
                      {g.state === "ok" ? `${sourceLabel(g.source)}${g.asOf ? `, read ${fullDate(g.asOf)} ${clock(g.asOf)}` : ""}` : `Not available: ${g.note ?? ""}`}
                      {g.state === "ok" && g.note ? <span className="dk-operator-given"> {g.note}</span> : null}
                    </dd>
                  </div>
                ))
              ) : (
                <>
                  <dt>Data</dt>
                  <dd>None: it answered from the question alone.</dd>
                </>
              )}
              <dt>Model</dt>
              <dd>{r.model ? `${r.model} on ${t.runner ?? "the workstation"}` : "Not reported"}</dd>
              <dt>Took</dt>
              <dd>{r.ms ? duration(r.ms) : "Not reported"}</dd>
              <dt>Handed out</dt>
              <dd>
                {t.attempts} {t.attempts === 1 ? "time" : "times"}
                {t.retried ? "; its first answer was refused and it was asked again" : ""}
              </dd>
              <dt>Finished</dt>
              <dd>{t.finishedAt ? `${fullDate(t.finishedAt)} ${clock(t.finishedAt)}, ${ago(t.finishedAt)}` : "—"}</dd>
            </dl>
          </Card>
          {r.proposals.length ? (
            <Card title="What it proposed" icon="hourglass" count={r.proposals.length}>
              <ul className="dk-operator-aps">
                {r.proposals.map((p) => (
                  <li key={p.id} className="dk-operator-ap dk-operator-ap--badge">
                    <Badge tone={p.state === "applied" ? "good" : p.state === "waiting" ? "warn" : "quiet"}>{WORD[p.state] ?? p.state}</Badge>
                    <span className="dk-operator-ap-text">
                      <span className="dk-operator-ap-title">{p.address}</span>
                      <span className="dk-operator-ap-sub">{p.kind === "meta" ? (p.shownTitle ?? p.after.title ?? p.after.description) : proposalLine(p).sub}</span>
                    </span>
                    <span className="dk-operator-ap-actions">
                      <ReviewButton p={p} mode={p.state === "applied" ? "withdraw" : "review"} canApprove={who.canPublish} why={why} specimen={false} label={p.state === "applied" && who.canPublish ? "Withdraw" : "Review"} variant={p.state === "applied" && who.canPublish ? "danger" : "quiet"} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
