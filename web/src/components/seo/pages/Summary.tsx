import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { Priority } from "@/contract/seo/common";
import type { PageSpeed, QuickAction, SeoPageSummary, SummaryIndex, SummaryIssue } from "@/contract/seo/pages";
import { Ring } from "@/components/charts";
import { Badge, Chip, type ChipTone } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { InspectNowButton } from "@/components/seo/google/actions";
import { Stamp } from "@/components/ui/Stamp";
import { Thumb } from "@/components/ui/Thumb";
import { Info } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { ago, bytes, DASH, fullDate, num, shortDate } from "@/lib/format";
import { opportunitiesHref, optimizeHref, pagesHref, type Place } from "./href";
import { KindChip, rateCell } from "./PagesList";
import { QueueButton } from "./QueueButton";
import { ShowOnOpen } from "./ShowOnOpen";
import { Switch } from "./Switch";

const LEVEL: Record<Priority, { text: string; tone: ChipTone; icon: IconName }> = {
  high: { text: "High", tone: "bad", icon: "alert" },
  medium: { text: "Medium", tone: "warn", icon: "info" },
  low: { text: "Low", tone: "quiet", icon: "circle" },
};

const ACTION_ICON: Record<QuickAction["key"], IconName> = {
  metadata: "edit",
  content: "sparkles",
  links: "link",
  schema: "code",
  optimize: "target",
  inspect: "search",
};

/** One quick action: a button that queues its operator task, or a link. */
function ActionRow({ a }: { a: QuickAction }) {
  if (a.task) return <QueueButton look="row" task={a.task} label={a.label} step={a.step} icon={ACTION_ICON[a.key]} blocked={a.available ? null : a.why} />;
  if (!a.href) return null;
  return (
    <div className="dk-seo-pages-qa">
      <Go href={a.href} className="dk-seo-pages-qa-btn" title={a.step}>
        <Icon name={ACTION_ICON[a.key]} size={16} className="dk-seo-pages-qa-icon" />
        <span className="dk-seo-pages-qa-label">{a.label}</span>
        <Icon name="external" size={14} className="dk-seo-pages-qa-go" />
      </Go>
    </div>
  );
}

function IssueRow({ i }: { i: SummaryIssue }) {
  const l = LEVEL[i.level];
  return (
    <li className="dk-seo-pages-issue">
      <span className={cx("dk-seo-pages-issue-mark", `dk-tone-${l.tone}`)} aria-hidden>
        <Icon name={l.icon} size={13} />
      </span>
      <span className="dk-seo-pages-issue-text" title={i.detail}>
        <span className="dk-seo-pages-issue-title">{i.title}</span>
        <span className="dk-seo-pages-issue-detail">{i.detail}</span>
      </span>
      <Badge tone={l.tone} className="dk-seo-pages-issue-level">
        {l.text}
      </Badge>
      <span className="dk-seo-pages-issue-act">
        {i.action?.kind === "task" ? (
          <QueueButton
            look="mini"
            size="xs"
            task={i.action.task}
            label={i.action.label}
            step="The operator writes a new title and description for this page; they wait in AI Operator › Approvals until a person approves."
          />
        ) : i.action?.kind === "link" ? (
          <LinkButton href={i.action.href} size="xs" title="Opens Google's URL Inspection of this address in Search Console">
            {i.action.label}
          </LinkButton>
        ) : null}
      </span>
    </li>
  );
}

/**
 * What an empty issue list says. Only a page Google has in its index and on
 * which no rule fired has "no issue"; for any other the sentence says what is
 * not known (never inspected, kept out of search on purpose) instead of
 * claiming Google has it.
 */
function NoIssue({ s }: { s: SeoPageSummary }) {
  const idx = s.index;
  if (idx.state === "ok" && idx.value.indexed) {
    return (
      <Empty icon="check-circle" title="No issue found" compact className="dk-seo-pages-noissue">
        Google has it in its index and no rule of the crawl fired on it.
      </Empty>
    );
  }
  return (
    <Empty icon="info" title="No finding of the crawl" compact className="dk-seo-pages-noissue">
      No rule of the crawl fired on it. Google’s index: {idx.state === "ok" ? "not indexed" : idx.reason}
    </Empty>
  );
}

function Overview({ s, place }: { s: SeoPageSummary; place: Place }) {
  const issues = s.issues;
  const opps = s.opportunities;
  const waitingProposals = s.proposals.filter((p) => p.state === "waiting");
  const path = s.row.page.path;
  return (
    <div className="dk-seo-pages-ov">
      <div className="dk-seo-pages-ov-top">
        <div className="dk-seo-pages-box dk-seo-pages-score">
          <h3 className="dk-seo-pages-h">
            SEO score
            <Info text="The desk's own score from its crawl: 100, less the cost of each rule that fired on the page, once per rule (src/cc/site/rules.ts). Not a figure from Google, and it does not count Google's index state or AI readiness: a page Google has not indexed can score 100." />
          </h3>
          <Ring size="panel" value={s.score.value} label="SEO score" caption="/ 100" />
          {s.score.unscored ? (
            <p className="dk-seo-pages-small">{s.score.unscored}</p>
          ) : s.index.state === "ok" && !s.index.value.indexed ? (
            <p className="dk-seo-pages-small dk-seo-pages-score-note">Google has not indexed it: the score does not count that.</p>
          ) : (
            <p className="dk-seo-pages-small dk-seo-pages-score-note">The crawl’s rules only.</p>
          )}
          <LinkButton href={optimizeHref(path, place.range)} variant="good" size="sm" block title="Page Optimization: improve this page step by step">
            Optimize
          </LinkButton>
        </div>
        <div className="dk-seo-pages-box dk-seo-pages-actions">
          <h3 className="dk-seo-pages-h">Quick actions</h3>
          <div className="dk-seo-pages-qa-list">
            {s.actions.map((a) => (
              <ActionRow key={a.key} a={a} />
            ))}
          </div>
        </div>
      </div>

      <div className="dk-seo-pages-box dk-seo-pages-issues-box">
        <div className="dk-seo-pages-h-row">
          <h3 className="dk-seo-pages-h">SEO issues {issues.state === "ok" ? <span className="dk-seo-pages-h-n dk-num">({issues.value.length})</span> : null}</h3>
          {/* Page Optimization lists every finding with its cost on its Technical tab. */}
          <Go href={optimizeHref(path, place.range, "technical")} className="dk-seo-pages-more">
            View all
          </Go>
        </div>
        {issues.state !== "ok" ? (
          <Absent reading={issues} form="tile" />
        ) : issues.value.length ? (
          <ul className="dk-seo-pages-issue-list">
            {issues.value.slice(0, 6).map((i) => (
              <IssueRow key={i.key} i={i} />
            ))}
          </ul>
        ) : (
          <NoIssue s={s} />
        )}
        {issues.state === "ok" && issues.value.length > 6 ? (
          <p className="dk-seo-pages-small">
            <Go href={optimizeHref(path, place.range, "technical")}>{issues.value.length - 6} more on Page Optimization</Go>
          </p>
        ) : null}
      </div>

      <p className="dk-seo-pages-small dk-seo-pages-ov-foot">
        {opps.state === "ok" ? (
          opps.value.open ? (
            <Go href={opportunitiesHref(place.range, { page: path })}>
              {`${num(opps.value.open)} open opportunit${opps.value.open === 1 ? "y" : "ies"} for this page`}
            </Go>
          ) : (
            <span>No open opportunity for this page.</span>
          )
        ) : (
          <span>
            Opportunities {opps.state === "waiting" ? "not found yet" : "not available"}: {opps.reason}
            {opps.state === "off" && opps.step ? ` ${opps.step}` : ""}
          </span>
        )}
        {waitingProposals.length ? (
          <>
            {" · "}
            <Go href={waitingProposals[0]!.href}>
              {waitingProposals.length} proposal{waitingProposals.length === 1 ? "" : "s"} waiting for approval
            </Go>
          </>
        ) : null}
      </p>
    </div>
  );
}

function Fact({ term, children, wide }: { term: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx("dk-seo-pages-fact", wide && "dk-seo-pages-fact--wide")}>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const lengthTone = (n: number, limit: number) => (n === 0 ? "bad" : n > limit ? "warn" : "good");

/** Google's own words for its robots, fetch and indexing states, as people say them. */
const GOOGLE_WORDS: Record<string, string> = {
  ALLOWED: "allowed",
  DISALLOWED: "blocked by robots.txt",
  SUCCESSFUL: "fetched",
  SOFT_404: "a soft 404",
  BLOCKED_ROBOTS_TXT: "blocked by robots.txt",
  NOT_FOUND: "not found (404)",
  ACCESS_DENIED: "access denied (401)",
  SERVER_ERROR: "server error (5xx)",
  REDIRECT_ERROR: "a redirect error",
  ACCESS_FORBIDDEN: "forbidden (403)",
  BLOCKED_4XX: "a 4xx answer",
  INTERNAL_CRAWL_ERROR: "Google's own crawl error",
  INVALID_URL: "an invalid address",
  INDEXING_ALLOWED: "allowed",
  BLOCKED_BY_META_TAG: "noindex in a meta tag",
  BLOCKED_BY_HTTP_HEADER: "noindex in an HTTP header",
  BLOCKED_BY_ROBOTS_TXT: "blocked by robots.txt",
};
const said = (w: string | null): string => (w ? (GOOGLE_WORDS[w] ?? w.toLowerCase().replace(/_/g, " ")) : DASH);

/**
 * Google's stored state of one address: its verdict in its own words, what
 * that means and fixes, the day it was read and, from the same inspection,
 * the canonical Google chose against the one the page declared and the
 * robots, fetch and indexing states. Drawn in the summary's SEO view and in
 * an address looked up live. Given the path, "Inspect now" asks Google's URL
 * Inspection at once (the Google actions, one of the day's 2,000), also when
 * no stored answer exists yet.
 */
export function IndexFacts({ idx, path }: { idx: Reading<SummaryIndex>; path?: string }) {
  const now = path ? <InspectNowButton path={path} compact /> : null;
  if (idx.state !== "ok")
    return (
      <>
        <Absent reading={idx} form="tile" />
        {now}
      </>
    );
  const v = idx.value;
  return (
    <>
      <p className="dk-seo-pages-line">
        <Badge tone={v.indexed ? "good" : "bad"} dot>
          {v.indexed ? "Indexed" : "Not indexed"}
        </Badge>
        <span>{v.coverage ?? "Google gave no words for it"}</span>
      </p>
      <p className="dk-seo-pages-small">{v.meaning}</p>
      {!v.indexed ? <p className="dk-seo-pages-small dk-seo-pages-fix">{v.fix}</p> : null}
      {v.liveSaysIndex === true && /noindex/i.test(v.coverage ?? "") ? <p className="dk-seo-pages-small dk-seo-pages-fix">The live page says index now: Google’s record is stale.</p> : null}
      <dl className="dk-seo-pages-facts">
        <Fact term="Checked">
          {shortDate(v.day)}
          {v.day < v.newest ? <span className="dk-seo-pages-small"> · the check of {shortDate(v.newest)} did not reach it</span> : v.day > v.newest ? <span className="dk-seo-pages-small"> · asked by hand</span> : null}
        </Fact>
        <Fact term="Google last crawled">{v.lastCrawl ? fullDate(v.lastCrawl) : "never"}</Fact>
        <Fact term="Robots.txt">{said(v.robots)}</Fact>
        <Fact term="Fetch">{said(v.fetchState)}</Fact>
        <Fact term="Indexing">{said(v.indexing)}</Fact>
        <Fact term="Canonical Google chose" wide>
          {v.googleCanonical ?? "none named"} {v.canonicalOk === true ? <Chip tone="good">the page’s own</Chip> : v.canonicalOk === false ? <Chip tone="bad">differs</Chip> : null}
        </Fact>
        {v.canonicalOk === false ? (
          <Fact term="Canonical the page declared" wide>
            {v.userCanonical ?? "none"}
          </Fact>
        ) : null}
      </dl>
      {v.link ? (
        <LinkButton href={v.link} size="xs" icon="external">
          Inspect in Search Console
        </LinkButton>
      ) : null}
      {now}
    </>
  );
}

function SeoPane({ s }: { s: SeoPageSummary }) {
  const serp = s.serp;
  return (
    <div className="dk-seo-pages-pane">
      <section className="dk-seo-pages-box">
        <h3 className="dk-seo-pages-h">Google’s index</h3>
        <IndexFacts idx={s.index} path={s.row.page.path} />
      </section>
      <section className="dk-seo-pages-box">
        <h3 className="dk-seo-pages-h">Title and description</h3>
        {serp.state !== "ok" ? (
          <Absent reading={serp} form="tile" />
        ) : (
          <dl className="dk-seo-pages-facts">
            <Fact term="Title" wide>
              <span>{serp.value.title ?? "none"}</span>{" "}
              <Chip tone={lengthTone(serp.value.titleLength, serp.value.titleLimit)}>
                {serp.value.titleLength} / {serp.value.titleLimit}
              </Chip>
            </Fact>
            <Fact term="Description" wide>
              <span>{serp.value.description ?? "none"}</span>{" "}
              <Chip tone={lengthTone(serp.value.descriptionLength, serp.value.descriptionLimit)}>
                {serp.value.descriptionLength} / {serp.value.descriptionLimit}
              </Chip>
            </Fact>
          </dl>
        )}
      </section>
      <section className="dk-seo-pages-box">
        <h3 className="dk-seo-pages-h">What the score is made of</h3>
        {s.score.value === null ? (
          <p className="dk-seo-pages-small">{s.score.unscored}</p>
        ) : s.score.lines.length ? (
          <ul className="dk-seo-pages-cost">
            {s.score.lines.map((l) => (
              <li key={l.rule}>
                <span>{l.title}</span>
                <span className="dk-num">−{l.cost}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dk-seo-pages-small">No rule of the crawl costs it a point.</p>
        )}
      </section>
    </div>
  );
}

const CHECK_TONE: Record<string, { icon: IconName; tone: ChipTone; word: string }> = {
  pass: { icon: "check", tone: "good", word: "Pass" },
  fail: { icon: "x", tone: "bad", word: "Fail" },
  unknown: { icon: "minus", tone: "quiet", word: "Unknown" },
  "n/a": { icon: "minus", tone: "quiet", word: "n/a" },
};

function ContentPane({ s }: { s: SeoPageSummary }) {
  const r = s.readiness;
  const t = s.technical;
  return (
    <div className="dk-seo-pages-pane">
      {t.state === "ok" ? (
        <dl className="dk-seo-pages-facts dk-seo-pages-box">
          <Fact term="Words of its own">{t.value.words === null ? DASH : num(t.value.words)}</Fact>
          <Fact term="Main heading" wide>
            {t.value.h1.length ? t.value.h1.join(" · ") : "none"}
          </Fact>
          <Fact term="Section headings">{num(t.value.h2)}</Fact>
          <Fact term="Language">{t.value.lang ?? "not declared"}</Fact>
        </dl>
      ) : null}
      <section className="dk-seo-pages-box">
        <div className="dk-seo-pages-h-row">
          <h3 className="dk-seo-pages-h">AI search readiness</h3>
          {r.state === "ok" ? (
            <span className="dk-seo-pages-small dk-num">
              {r.value.pass} of {r.value.of} pass
            </span>
          ) : null}
        </div>
        {r.state !== "ok" ? (
          <Absent reading={r} form="tile" />
        ) : (
          <ul className="dk-seo-pages-checks">
            {r.value.checks.map((c) => {
              const k = CHECK_TONE[c.state] ?? CHECK_TONE.unknown!;
              return (
                <li key={c.key} title={[c.detail, c.fix].filter(Boolean).join(" ")}>
                  <span className={cx("dk-seo-pages-check-mark", `dk-tone-${k.tone}`)} aria-hidden>
                    <Icon name={k.icon} size={11} />
                  </span>
                  <span className="dk-seo-pages-check-label">{c.label}</span>
                  <span className="dk-seo-pages-small">{k.word}</span>
                </li>
              );
            })}
          </ul>
        )}
        {r.state === "ok" ? <Stamp reading={r} /> : null}
      </section>
    </div>
  );
}

function TechPane({ s }: { s: SeoPageSummary }) {
  const t = s.technical;
  if (t.state !== "ok") return <Absent reading={t} />;
  const v = t.value;
  return (
    <div className="dk-seo-pages-pane">
      <dl className="dk-seo-pages-facts dk-seo-pages-box">
        <Fact term="Answers">{v.status || "nothing"}</Fact>
        <Fact term="First byte">{v.ttfbMs === null ? DASH : `${num(v.ttfbMs)} ms`}</Fact>
        <Fact term="Whole page">{v.totalMs === null ? DASH : `${num(v.totalMs)} ms`}</Fact>
        <Fact term="HTML">{bytes(v.bytes)}</Fact>
        <Fact term="Vercel cache">{v.cache ?? DASH}</Fact>
        <Fact term="Robots tag">{v.robots ?? "none (index)"}</Fact>
        {v.robotsHeader ? <Fact term="X-Robots-Tag">{v.robotsHeader}</Fact> : null}
        <Fact term="Canonical" wide>
          {v.canonical ?? "none"} {v.canonicalSelf === true ? <Chip tone="good">its own</Chip> : v.canonicalSelf === false ? <Chip tone="bad">elsewhere</Chip> : null}
        </Fact>
        <Fact term="Structured data" wide>
          {v.schemaTypes.length ? v.schemaTypes.join(", ") : "none"}
        </Fact>
      </dl>
      <p className="dk-seo-pages-small">One fetch by the desk’s crawl from its own server, {ago(v.crawledAt)}: a hint about speed, not a measurement.</p>
      <section className="dk-seo-pages-box">
        <h3 className="dk-seo-pages-h">
          PageSpeed
          <Info text="Google's PageSpeed Insights: Lighthouse run on Google's machines (a lab test, not real visitors). The desk measures a fixed list of pages each day; Site Health shows them all." />
        </h3>
        <Speed reading={s.speed} />
      </section>
    </div>
  );
}

/** A lab score as the speed table tints it: Lighthouse's own bands (90 and up good, under 50 poor). */
const scoreTone = (n: number | null): ChipTone => (n === null ? "quiet" : n >= 90 ? "good" : n >= 50 ? "warn" : "bad");

function Speed({ reading }: { reading: Reading<PageSpeed> }) {
  if (reading.state !== "ok") return <Absent reading={reading} form="tile" />;
  return (
    <>
      <ul className="dk-seo-pages-speed">
        {reading.value.runs.map((r) => (
          <li key={r.strategy}>
            <span className="dk-seo-pages-speed-kind">{r.strategy === "mobile" ? "Mobile" : "Desktop"}</span>
            {r.failure ? (
              <span className="dk-seo-pages-small">The run failed: {r.failure}</span>
            ) : (
              <>
                <Chip tone={scoreTone(r.performance)}>{r.performance === null ? DASH : num(r.performance)}</Chip>
                <span className="dk-seo-pages-small dk-num">
                  LCP {r.lcpMs === null ? DASH : `${num(r.lcpMs / 1000, 1)} s`} · CLS {r.cls === null ? DASH : num(r.cls, 2)} · TBT {r.tbtMs === null ? DASH : `${num(r.tbtMs)} ms`}
                </span>
              </>
            )}
            <span className="dk-seo-pages-small">{ago(r.at)}</span>
          </li>
        ))}
      </ul>
      <Stamp reading={reading} />
    </>
  );
}

function LinksPane({ s, place }: { s: SeoPageSummary; place: Place }) {
  const l = s.links;
  if (l.state !== "ok") return <Absent reading={l} />;
  const v = l.value;
  return (
    <div className="dk-seo-pages-pane">
      <dl className="dk-seo-pages-facts dk-seo-pages-box">
        <Fact term="Pages linking here">{num(v.in)}</Fact>
        <Fact term="From their content">{num(v.inFromContent)}</Fact>
        <Fact term="Pages it links to">{v.out === null ? DASH : num(v.out)}</Fact>
      </dl>
      <section className="dk-seo-pages-box">
        <h3 className="dk-seo-pages-h">Linked from</h3>
        {v.from.length ? (
          <ul className="dk-seo-pages-linklist">
            {v.from.map((f) => (
              <li key={f.source}>
                <Go href={pagesHref(place, { open: f.source })} scroll={false}>
                  {f.source}
                </Go>
                <span className="dk-seo-pages-small">
                  “{f.text || "no words"}”{f.place === "chrome" ? " · menu or footer" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dk-seo-pages-small">No page links here.</p>
        )}
      </section>
    </div>
  );
}

function PerfPane({ s, place }: { s: SeoPageSummary; place: Place }) {
  const r = s.row;
  const o = s.opportunities;
  return (
    <div className="dk-seo-pages-pane">
      <dl className="dk-seo-pages-facts dk-seo-pages-box dk-seo-pages-facts--four">
        <Fact term="Clicks">{num(r.clicks)}</Fact>
        <Fact term="Impressions">{num(r.impressions)}</Fact>
        <Fact term="CTR">{rateCell(r.ctr)}</Fact>
        <Fact term="Position">{r.position === null ? DASH : num(r.position, 1)}</Fact>
        {/* GA4 is read only when the list shows or sorts by Organic sessions: then the visits its searches brought are here too. */}
        {r.organic ? (
          <Fact term="Organic sessions (GA4)" wide>
            {num(r.organic.sessions)} began here from search, {num(r.organic.engaged)} engaged <span className="dk-seo-pages-small">· consenting visitors only</span>
          </Fact>
        ) : null}
      </dl>
      <section className="dk-seo-pages-box">
        <h3 className="dk-seo-pages-h">Open opportunities</h3>
        {o.state !== "ok" ? (
          <Absent reading={o} form="tile" />
        ) : o.value.rows.length ? (
          <ul className="dk-seo-pages-opps">
            {o.value.rows.map((x) => (
              <li key={x.id}>
                <Go href={opportunitiesHref(place.range, { open: x.id })}>{x.title}</Go>
                <span className="dk-seo-pages-small">
                  {x.typeLabel} · {LEVEL[x.priority].text}
                  {x.potential ? ` · our estimate +${num(x.potential.clicksPerMonth, 1)} clicks a month` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dk-seo-pages-small">The engine finds nothing open for this page.</p>
        )}
      </section>
    </div>
  );
}

/**
 * The board's right-hand page summary: the page's head, then six views of it
 * (Overview with the score, the quick actions and the issues; SEO; Content;
 * Technical; Links; Performance). Every view is drawn here and switched in the
 * browser. A missing source costs its own view's part only.
 */
export function SummaryPanel({ reading, place }: { reading: Reading<SeoPageSummary> | null; place: Place }) {
  if (!reading) {
    return (
      <Card title="Page summary" icon="pages" className="dk-seo-pages-side">
        <Empty icon="pages" title="No page to show" compact>
          No page matches the filters. Clear them to see a page here.
        </Empty>
      </Card>
    );
  }
  if (reading.state !== "ok") {
    return (
      <Card title="Page summary" icon="pages" className="dk-seo-pages-side">
        <Absent reading={reading} />
      </Card>
    );
  }
  const s = reading.value;
  const r = s.row;
  /* Each pane is keyed by the page, so what a button said for one page (its
     answer, a disabled "Queued") is gone when another page opens; the chosen
     view is kept, as the switch sits outside the keyed panes. */
  const path = r.page.path;
  return (
    <section className="dk-card dk-seo-pages-side" aria-label={`Summary of ${path}`}>
      <ShowOnOpen path={path} />
      <header className="dk-seo-pages-side-head">
        <Thumb src={r.page.picture} size="md" icon="file" alt="" />
        <div className="dk-seo-pages-side-titles">
          <a href={r.url} target="_blank" rel="noreferrer" className="dk-seo-pages-side-path" title={`${r.url} (opens the live page)`}>
            <span>{r.page.path}</span>
            <Icon name="external" size={13} />
          </a>
          <p className="dk-seo-pages-side-sub">
            <KindChip kind={r.page.kind} label={r.page.kindLabel} />
            <span>{r.updated ? `Changed ${ago(r.updated)}` : r.page.title ?? ""}</span>
          </p>
        </div>
        <LinkButton href={r.url} size="sm" variant="good" className="dk-seo-pages-side-view">
          View page
        </LinkButton>
      </header>
      <Switch
        label="Page summary views"
        options={[
          { key: "overview", label: "Overview" },
          { key: "seo", label: "SEO" },
          { key: "content", label: "Content" },
          { key: "technical", label: "Technical" },
          { key: "links", label: "Links" },
          { key: "performance", label: "Performance" },
        ]}
      >
        <Overview key={path} s={s} place={place} />
        <SeoPane key={path} s={s} />
        <ContentPane key={path} s={s} />
        <TechPane key={path} s={s} />
        <LinksPane key={path} s={s} place={place} />
        <PerfPane key={path} s={s} place={place} />
      </Switch>
    </section>
  );
}
