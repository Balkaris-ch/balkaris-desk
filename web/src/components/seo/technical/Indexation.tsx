import type { JobListed, Reading } from "@/contract/common";
import type { CoverageGroup, Indexation } from "@/contract/seo/technical";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { InspectNowButton } from "@/components/seo/google/actions";
import { cx } from "@/lib/cx";
import { ago, fullDate, num } from "@/lib/format";
import { RunJob } from "./Act";
import { Body, PathLink, Quiet } from "./bits";

/**
 * Google's index: every sitemap address by the state Google's URL Inspection
 * reported, EACH BY ITS NEWEST ANSWER (a daily check that Google cut short
 * leaves the addresses it did not reach with their earlier answer, and the
 * card says so), each state with what Google means by it and what fixes it.
 * "Check now" runs the daily check again; "Inspect now" asks about one
 * address. The Request indexing queue, with Search Console's inspection of
 * each address, is in the Google panel under this card (#google).
 */

/** The bar's colours, by what a state means for the page. */
function stateTone(g: CoverageGroup): "good" | "bad" | "warn" | "quiet" {
  if (g.indexed) return "good";
  if (/noindex|404|not found|server error|soft 404|blocked/i.test(g.state)) return "bad";
  if (/unknown|discovered|crawled/i.test(g.state)) return "warn";
  return "quiet";
}

/** How many of a group's pages the crawl finds saying index today: the measure of a stale noindex record. */
function liveLine(g: CoverageGroup): string | null {
  if (g.indexed) return null;
  const known = g.pages.filter((p) => p.livePageSaysIndex !== null);
  if (!known.length) return null;
  const says = known.filter((p) => p.livePageSaysIndex).length;
  return `The live page says index on ${num(says)} of ${num(known.length)}, by the crawl.`;
}

function Group({ g, open, day }: { g: CoverageGroup; open: boolean; day: string }) {
  const tone = stateTone(g);
  const live = liveLine(g);
  return (
    <details className="dk-seo-technical-cov" open={open}>
      <summary className="dk-seo-technical-cov-head">
        <span className={cx("dk-seo-technical-swatch", `dk-seo-technical-swatch--${tone}`)} aria-hidden />
        <span className="dk-seo-technical-cov-state">{g.state}</span>
        <span className="dk-seo-technical-cov-n dk-num">{num(g.pages.length)}</span>
        <Icon name="chevron-down" size={14} className="dk-seo-technical-cov-chev" />
      </summary>
      <div className="dk-seo-technical-cov-body">
        <p className="dk-seo-technical-cov-meaning">
          <b>What Google means.</b> {g.meaning}
        </p>
        {g.indexed ? null : (
          <p className="dk-seo-technical-cov-fix">
            <b>The fix.</b> {g.fix}
          </p>
        )}
        {live ? <Quiet>{live}</Quiet> : null}
        <ul className="dk-seo-technical-cov-pages" aria-label={`Pages: ${g.state}`}>
          {g.pages.map((p) => (
            <li key={p.path}>
              <PathLink path={p.path} />
              <span className="dk-seo-technical-cov-crawl">
                {p.lastCrawl ? `Google crawled ${fullDate(p.lastCrawl)}` : "Never crawled by Google"}
                {/* An answer from another day than the newest check: carried, or asked for since. */}
                {p.day && p.day !== day ? ` · answer of ${fullDate(p.day)}` : ""}
              </span>
              {p.livePageSaysIndex === false ? <Chip tone="bad">live page: noindex</Chip> : <span />}
              {g.indexed ? (
                p.link ? (
                  <Go href={p.link} className="dk-seo-technical-ext" aria-label={`URL Inspection of ${p.path} in Search Console`}>
                    <Icon name="external" size={12} />
                  </Go>
                ) : (
                  <span />
                )
              ) : (
                <InspectNowButton path={p.path} label="Inspect now" compact />
              )}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/** "Next check in 5 hours", "Next check: due now" (never "17 hours ago"), or nothing when the job is not on this desk. */
function nextLine(job: JobListed | null, retryAt: string | null | undefined): string {
  if (retryAt && Date.parse(retryAt) > Date.now()) return ` The desk asks for the check again ${ago(retryAt)}, after the one that failed.`;
  if (!job?.nextRun) return "";
  if (!job.enabled) return " The daily check is switched off in Automations.";
  return Date.parse(job.nextRun) > Date.now() ? ` Next check ${ago(job.nextRun)}.` : " The next check is due now: it starts when the scheduler is free.";
}

export function IndexationCard({ reading, job }: { reading: Reading<Indexation>; job: JobListed | null }) {
  const run = job ? (
    <RunJob
      name={job.name}
      label="Check now"
      ready={job.ready && job.enabled}
      running={job.running}
      why={!job.enabled ? "Switched off in Automations." : "Search Console is not connected, so the check cannot run."}
    />
  ) : null;
  return (
    <Card
      title="Google’s index"
      icon="search"
      id="indexing"
      info="Google’s URL Inspection of every sitemap address, read once a day by the desk, each address by its newest answer. It is Google’s stored record: it changes when Google crawls the page again, not when the page changes. “Check now” runs the daily check again; “Inspect now” asks about one address (Google allows 2,000 a day)."
      right={run}
      className="dk-seo-technical-index"
    >
      <Body reading={reading}>
        {(ix) => {
          const of = ix.of ?? ix.inspected;
          const firstOpen = ix.groups.find((g) => !g.indexed)?.state ?? null;
          const waiting = ix.queue.filter((q) => !q.submitted).length;
          const failed = job && job.lastOk === false && job.lastNote;
          return (
            <div className="dk-seo-technical-index-body">
              <div className="dk-seo-technical-index-top">
                <p className="dk-seo-technical-index-figure">
                  <b className="dk-num">{num(ix.indexed)}</b>
                  <span className="dk-num"> / {num(of)}</span>
                  <span className="dk-seo-technical-index-word">sitemap addresses in Google’s index</span>
                </p>
                <div className="dk-seo-technical-stack" role="img" aria-label={ix.groups.map((g) => `${g.state}: ${g.pages.length}`).join(", ")}>
                  {ix.groups.map((g) => (
                    <span key={g.state} className={cx("dk-seo-technical-stack-part", `dk-seo-technical-swatch--${stateTone(g)}`)} style={{ flexGrow: g.pages.length }} title={`${g.state}: ${g.pages.length}`} />
                  ))}
                </div>
                <Quiet>
                  {ix.complete === false
                    ? `The check of ${fullDate(ix.day)} reached ${num(ix.checked ?? 0)} of ${num(of)} addresses; the other ${num(ix.carried ?? 0)} keep their answer from an earlier day${ix.wholeDay ? ` (the last whole check: ${fullDate(ix.wholeDay)})` : ""}${ix.missing ? `, and ${num(ix.missing)} have no answer at all, counted neither way` : ""}.`
                    : `Checked ${fullDate(ix.day)}: every sitemap address.`}
                  {ix.later ? ` ${num(ix.later)} address${ix.later === 1 ? " was" : "es were"} inspected since, by hand.` : ""}
                  {ix.history.length > 1
                    ? ` ${num(ix.history[0]!.indexed)} → ${num(ix.history.at(-1)!.indexed)} indexed since ${fullDate(ix.history[0]!.day)}.`
                    : ix.history.length === 1
                      ? ` The desk’s daily history of this count begins ${fullDate(ix.history[0]!.day)}.`
                      : " The desk keeps this count once a check reaches every address."}
                  {nextLine(job, ix.retryAt)}
                </Quiet>
                {failed ? (
                  <p className="dk-seo-technical-index-failed" role="status">
                    <Icon name="alert" size={14} />
                    <span>
                      The last check {job.lastEnd ? `(${ago(job.lastEnd)}) ` : ""}failed: {job.lastNote}
                    </span>
                  </p>
                ) : null}
                {ix.canonicalDiffers?.length ? (
                  <Quiet>
                    Google chose another canonical than the page declares for {ix.canonicalDiffers.map((c) => c.path).join(", ")}.
                  </Quiet>
                ) : null}
              </div>
              <section className="dk-seo-technical-index-groups" aria-label="Index states">
                <h3 className="dk-seo-technical-h3">
                  By Google’s state
                  <Go href="#google" className="dk-seo-technical-h3-n">
                    Request indexing: {num(waiting)} waiting · {num(ix.queue.length - waiting)} requested
                    <Icon name="chevron-right" size={12} />
                  </Go>
                </h3>
                {ix.groups.map((g) => (
                  <Group key={g.state} g={g} open={g.state === firstOpen} day={ix.day} />
                ))}
              </section>
              <div className="dk-seo-technical-stampline">
                <Stamp reading={reading} />
              </div>
            </div>
          );
        }}
      </Body>
    </Card>
  );
}
