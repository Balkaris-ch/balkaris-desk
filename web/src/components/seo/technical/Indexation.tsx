import type { JobListed, Reading } from "@/contract/common";
import type { CoverageGroup, Indexation } from "@/contract/seo/technical";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { cx } from "@/lib/cx";
import { ago, fullDate, num } from "@/lib/format";
import { Submitted } from "./Act";
import { Body, PathLink, Quiet } from "./bits";

/**
 * Google's index: every sitemap address by the state Google's URL Inspection
 * reported at its newest daily check, each state with what Google means by it
 * and what fixes it, and the Request indexing queue the lead works through by
 * hand in Search Console (no API offers it).
 */

/** The bar's colours, by what a state means for the page. */
function stateTone(g: CoverageGroup): "good" | "bad" | "warn" | "quiet" {
  if (g.indexed) return "good";
  if (/noindex|404|not found|server error|soft 404|blocked/i.test(g.state)) return "bad";
  if (/unknown|discovered|crawled/i.test(g.state)) return "warn";
  return "quiet";
}

const PRIORITY_TONE = { high: "bad", medium: "warn", low: "quiet" } as const;

/** How many of a group's pages the crawl finds saying index today: the measure of a stale noindex record. */
function liveLine(g: CoverageGroup): string | null {
  if (g.indexed) return null;
  const known = g.pages.filter((p) => p.livePageSaysIndex !== null);
  if (!known.length) return null;
  const says = known.filter((p) => p.livePageSaysIndex).length;
  return `The live page says index on ${num(says)} of ${num(known.length)}, by the crawl.`;
}

function Group({ g, open }: { g: CoverageGroup; open: boolean }) {
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
              <span className="dk-seo-technical-cov-crawl">{p.lastCrawl ? `Google crawled ${fullDate(p.lastCrawl)}` : "Never crawled by Google"}</span>
              {p.livePageSaysIndex === false ? <Chip tone="bad">live page: noindex</Chip> : null}
              {p.link ? (
                <Go href={p.link} className="dk-seo-technical-ext" aria-label={`URL Inspection of ${p.path} in Search Console`}>
                  <Icon name="external" size={12} />
                </Go>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

const QUEUE_SHOWN = 10;

export function IndexationCard({ reading, job }: { reading: Reading<Indexation>; job: JobListed | null }) {
  return (
    <Card
      title="Google’s index"
      icon="search"
      id="indexing"
      info="Google’s URL Inspection of every sitemap address, read once a day by the desk. It is Google’s stored record: it changes when Google crawls the page again, not when the page changes. Request indexing has no API: it is pressed by hand in Search Console, about ten addresses a day."
      right={reading.state === "ok" ? <Stamp reading={reading} /> : null}
      className="dk-seo-technical-index"
    >
      <Body reading={reading}>
        {(ix) => {
          const of = ix.of ?? ix.inspected;
          const waitingQ = ix.queue.filter((q) => !q.submitted);
          const firstOpen = ix.groups.find((g) => !g.indexed)?.state ?? null;
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
                  Checked {fullDate(ix.day)}
                  {ix.inspected < of ? `; ${num(ix.inspected)} of ${num(of)} addresses have a result that day` : ""}.
                  {ix.history.length > 1 ? ` ${num(ix.history[0]!.indexed)} → ${num(ix.history.at(-1)!.indexed)} indexed since ${fullDate(ix.history[0]!.day)}.` : " The desk’s daily history of this count begins today."}
                  {job?.nextRun ? ` Next check ${ago(job.nextRun)}.` : ""}
                </Quiet>
                {ix.canonicalDiffers?.length ? (
                  <Quiet>
                    Google chose another canonical than the page declares for {ix.canonicalDiffers.map((c) => c.path).join(", ")}.
                  </Quiet>
                ) : null}
              </div>
              <div className="dk-seo-technical-index-grid">
                <section className="dk-seo-technical-index-groups" aria-label="Index states">
                  <h3 className="dk-seo-technical-h3">By Google’s state</h3>
                  {ix.groups.map((g) => (
                    <Group key={g.state} g={g} open={g.state === firstOpen} />
                  ))}
                </section>
                <section className="dk-seo-technical-queue" aria-label="Request indexing">
                  <h3 className="dk-seo-technical-h3">
                    Request indexing
                    <span className="dk-seo-technical-h3-n dk-num">
                      {num(waitingQ.length)} waiting · {num(ix.queue.length - waitingQ.length)} submitted
                    </span>
                  </h3>
                  <Quiet>
                    In Search Console open URL Inspection for the address (the arrow) and press “Request indexing”, then mark it here. About ten a day; Google publishes no quota. Most important first.
                  </Quiet>
                  {ix.queue.length ? (
                    <ol className="dk-seo-technical-queue-list">
                      {ix.queue.slice(0, QUEUE_SHOWN).map((q) => (
                        <QueueRow key={q.path} q={q} />
                      ))}
                    </ol>
                  ) : (
                    <Quiet>Nothing is waiting: every sitemap address Google does not index has been submitted, or there is none.</Quiet>
                  )}
                  {ix.queue.length > QUEUE_SHOWN ? (
                    <details className="dk-seo-technical-more">
                      <summary>{num(ix.queue.length - QUEUE_SHOWN)} more</summary>
                      <ol className="dk-seo-technical-queue-list">
                        {ix.queue.slice(QUEUE_SHOWN).map((q) => (
                          <QueueRow key={q.path} q={q} />
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </section>
              </div>
            </div>
          );
        }}
      </Body>
    </Card>
  );
}

function QueueRow({ q }: { q: Indexation["queue"][number] }) {
  return (
    <li className={cx("dk-seo-technical-queue-row", q.submitted && "dk-seo-technical-queue-row--done")}>
      <span className="dk-seo-technical-queue-what">
        <PathLink path={q.path} />
        <span className="dk-seo-technical-queue-sub">
          <Chip tone={PRIORITY_TONE[q.priority]}>{q.priority === "high" ? "High" : q.priority === "medium" ? "Medium" : "Low"}</Chip>
          <span>{q.submitted ? `Submitted${q.submittedBy ? ` by ${q.submittedBy}` : ""}${q.submittedAt ? `, ${ago(q.submittedAt)}` : ""}` : (q.coverage ?? "Not indexed")}</span>
        </span>
      </span>
      {q.href ? (
        <Go href={q.href} className="dk-seo-technical-ext" aria-label={`Open ${q.path} in Search Console’s URL Inspection`} title="Open in Search Console’s URL Inspection">
          <Icon name="external" size={14} />
        </Go>
      ) : (
        <span />
      )}
      <Submitted path={q.path} submitted={q.submitted} />
    </li>
  );
}
