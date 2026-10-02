import type { ReactNode } from "react";
import type { Range, Reading, Stat } from "@/contract/common";
import type { PageEventRow, PageFactsView, PageHistoryItem, PageInspectionView, PageScoreView, PageSearchView, PageSpeedView, PageTrafficView, PageViewPayload } from "@/contract/pages";
import { AreaChart, Ring } from "@/components/charts";
import { ActionList, type ActionItem } from "@/components/ui/ActionList";
import { Badge, Chip, type ChipTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Absent, Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { cx } from "@/lib/cx";
import { ago, bytes, DASH, duration, feedTime, fullDate, num, percent, rangeLabel } from "@/lib/format";
import { runCrawl } from "./actions";
import "./pages.css";

const SEVERITY: Record<"critical" | "warning" | "opportunity", { label: string; tone: ChipTone }> = {
  critical: { label: "Critical", tone: "bad" },
  warning: { label: "Warning", tone: "warn" },
  opportunity: { label: "Opportunity", tone: "info" },
};

const STATE_TONE: Record<string, ChipTone> = { live: "good", noindex: "quiet", redirect: "warn", error: "bad" };

/** A reading with the same source and age, another value. */
function as<T, U>(r: Reading<T>, make: (v: T) => U): Reading<U> {
  return r.state === "ok" ? { ...r, value: make(r.value) } : r;
}

/* ---------- the head's tiles ------------------------------------------------------ */

export function DetailTiles({ data }: { data: PageViewPayload }) {
  const score = as(data.facts, (f): Stat => ({ value: f.row.score ?? NaN, previous: null, unit: "score", series: [], of: 100 }));
  const scoreReading: Reading<Stat> =
    data.facts.state === "ok" && data.facts.value.row.score === null
      ? { state: "off", source: "crawl", reason: "Kept out of the sitemap on purpose, so it is not scored: the crawl only checks that it is really kept out of search." }
      : score;
  const visitors = as(data.traffic, (t) => t.visitors);
  const views = as(data.traffic, (t) => t.views);
  /* Enquiries: the engine's count when it is connected, GA4's generate_lead events until then. */
  const enquiries: Reading<Stat> =
    data.enquiries.state === "ok"
      ? as(data.enquiries, (e) => ({ value: e.count, previous: e.previous, unit: "count" as const, series: [], sub: "the engine's count" }))
      : as(data.events, (rows) => {
          const lead = rows.find((r) => r.name === "generate_lead");
          return { value: lead?.count ?? 0, previous: lead ? lead.previous : null, unit: "count" as const, series: [], sub: "GA4 generate_lead events" };
        });
  const links = as(data.facts, (f): Stat => ({ value: f.row.inlinks, previous: null, unit: "count", series: [], sub: `${f.row.inlinksFromContent} from their own content` }));
  return (
    <Tiles count={5}>
      <Tile label="SEO score" reading={scoreReading} info="The desk's own score out of 100 (src/cc/site/rules.ts): 100 less the cost of each rule that fired. Not a figure from Google." />
      <Tile label="Visitors" reading={visitors} info={`GA4 active users who viewed this page, ${rangeLabel(data.range).toLowerCase()}. Consenting visitors only.`} />
      <Tile label="Views" reading={views} info="GA4 page views of this page in the range. Consenting visitors only." />
      <Tile label="Enquiries" reading={enquiries} info="Enquiries sent from this page: the engine's count once the desk has its key, GA4's generate_lead events (consenting visitors only) until then." />
      <Tile label="Internal links" reading={links} info="Other pages of the site that link here, from anywhere on them (menus included)." />
    </Tiles>
  );
}

/* ---------- facts ------------------------------------------------------------------- */

function Length({ value, limit, what }: { value: number | null; limit: number; what: string }) {
  if (value === null) return null;
  const over = value > limit;
  return (
    <span className="dk-pages-len">
      <ProgressBar value={Math.min(value, limit)} max={limit} tone={over ? "bad" : "good"} label={`${what} length against the limit`} />
      <span className="dk-num">
        {value} of {limit} characters{over ? `: ${value - limit} over, cut in results` : ""}
      </span>
    </span>
  );
}

const or = (v: ReactNode, none = DASH) => (v === null || v === undefined || v === "" ? <span className="dk-pages-rate">{none}</span> : v);

export function AppearanceCard({ facts }: { facts: Reading<PageFactsView> }) {
  return (
    <Card title="Search appearance" icon="search" info="What the page's head says to a search engine, as the desk's crawl read it from the served HTML. The limits are the desk's yardsticks, not Google's law.">
      <Read reading={facts}>
        {(f, r) => (
          <>
            <dl className="dk-pages-facts">
              <dt>Title</dt>
              <dd>
                {or(f.row.title, "No <title>")}
                <Length value={f.titleLength} limit={f.limits.title} what="Title" />
              </dd>
              <dt>Description</dt>
              <dd>
                {or(f.description, "No meta description")}
                <Length value={f.descriptionLength} limit={f.limits.description} what="Description" />
              </dd>
              <dt>Canonical</dt>
              <dd>
                {or(f.canonical, "None")}
                {f.canonicalSelf === false ? <small>Points to another address, not to this page.</small> : f.canonicalSelf ? <small>Names this page.</small> : null}
              </dd>
              <dt>Robots</dt>
              <dd>
                {or(f.robots, "No robots tag: indexable")}
                {f.robotsHeader ? <small>X-Robots-Tag header: {f.robotsHeader}</small> : null}
              </dd>
              <dt>Main heading</dt>
              <dd>
                {f.h1.length ? f.h1.join(" · ") : or(null, "No <h1>")}
                <small>
                  {f.h1.length} h1, {f.h2} h2{f.lang ? ` · language ${f.lang}` : " · no language declared"}
                </small>
              </dd>
              <dt>Words</dt>
              <dd className="dk-num">
                {num(f.words)}
                {f.words !== null ? <small>Own content, inside &lt;main&gt;. Under {f.limits.thinWords} is thin by the desk&apos;s yardstick.</small> : null}
              </dd>
              <dt>In the sitemap</dt>
              <dd>
                {f.row.inSitemap ? "Yes" : f.row.listedBy === "unlisted" ? "No: an article not listed yet" : "No: a page file the sitemap leaves out"}
                {f.row.dated ? <small>Published {fullDate(f.row.dated)}, as its content file says</small> : null}
                {f.row.lastmod && f.row.lastmod.slice(0, 10) !== f.row.dated ? <small>Sitemap date {fullDate(f.row.lastmod)}: when it was last updated</small> : null}
              </dd>
            </dl>
            <p className="dk-pages-stamp-line">
              <Stamp reading={r} />
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

export function ShareCard({ facts }: { facts: Reading<PageFactsView> }) {
  return (
    <Card title="Share picture" icon="image" info="What a shared link unfurls into: the page's Open Graph title, description and picture, as served.">
      <Read reading={facts}>
        {(f, r) => {
          const isDefault = Boolean(f.og.image && f.defaultPicture && f.og.image === f.defaultPicture);
          return (
            <div className="dk-pages-share">
              {f.og.image ? (
                // The website's own share picture, shown as served.
                <img src={f.og.image} alt={`Share picture of ${f.row.path}`} loading="lazy" decoding="async" />
              ) : (
                <Empty compact icon="image" title="No share picture">
                  The page names no og:image, so a shared link unfurls bare.
                </Empty>
              )}
              <div>
                {isDefault ? (
                  <Badge tone="warn" dot>
                    The site&apos;s default picture
                  </Badge>
                ) : f.og.image ? (
                  <Badge tone="good" dot>
                    A picture of its own
                  </Badge>
                ) : null}
              </div>
              <dl className="dk-pages-facts">
                <dt>og:title</dt>
                <dd>{or(f.og.title, "None")}</dd>
                <dt>og:description</dt>
                <dd>{or(f.og.description, "None")}</dd>
                <dt>twitter:card</dt>
                <dd>{or(f.twitterCard, "None")}</dd>
              </dl>
              <Stamp reading={r} />
            </div>
          );
        }}
      </Read>
    </Card>
  );
}

/* ---------- issues and score -------------------------------------------------------- */

export function IssuesCard({ facts }: { facts: Reading<PageFactsView> }) {
  return (
    <Card
      title="Issues"
      icon="alert"
      tone="bad"
      count={facts.state === "ok" ? facts.value.findings.length : undefined}
      info="What the crawl's rules found on this page, each with the value it measured and the limit it held it against (src/cc/site/rules.ts)."
    >
      <Read reading={facts}>
        {(f, r) =>
          f.findings.length ? (
            <>
              <ul className="dk-pages-rows">
                {f.findings.map((x) => (
                  <li key={x.id}>
                    <Chip tone={SEVERITY[x.severity].tone}>{SEVERITY[x.severity].label}</Chip>
                    <span className="dk-pages-grow">
                      <b>{x.title}</b>
                      <small>{x.text}</small>
                      <small className="dk-num">
                        Measured {String(x.measured ?? DASH)} · limit {String(x.limit ?? DASH)} · first found {fullDate(x.firstSeen)}
                      </small>
                    </span>
                    <span className="dk-pages-end dk-num">{x.cost ? `−${x.cost}` : "0"}</span>
                  </li>
                ))}
              </ul>
              <p className="dk-pages-stamp-line">
                <Stamp reading={r} />
              </p>
            </>
          ) : (
            <Empty compact icon="check-circle" title="No issues">
              Every rule the crawl applies passed on this page at the last crawl.
            </Empty>
          )
        }
      </Read>
    </Card>
  );
}

export function ScoreCard({ score }: { score: Reading<PageScoreView> }) {
  return (
    <Card title="Score" icon="gauge" info="Why the page scored what it did: start at 100 and take off each rule's cost once, however often it fired. The weights are the desk's stated judgement, in src/cc/site/rules.ts.">
      <Read reading={score}>
        {(s, r) => (
          <>
            <div className="dk-pages-score">
              <Ring size="panel" value={s.score} label="SEO score" caption={s.score === null ? "Not scored" : "of 100"} />
              {s.unscored ? (
                <p className="dk-pages-rate">{s.unscored}</p>
              ) : (
                <ul className="dk-pages-rows dk-pages-grow">
                  <li>
                    <span className="dk-pages-grow">Start</span>
                    <span className="dk-pages-end dk-num">100</span>
                  </li>
                  {s.lines.map((l) => (
                    <li key={l.rule}>
                      <span className="dk-pages-grow">{l.title}</span>
                      <span className="dk-pages-end dk-num">{l.cost ? `−${l.cost}` : "0"}</span>
                    </li>
                  ))}
                  <li>
                    <b className="dk-pages-grow">Score</b>
                    <b className="dk-pages-end dk-num">{s.score ?? DASH}</b>
                  </li>
                </ul>
              )}
            </div>
            <p className="dk-pages-stamp-line">
              <Stamp reading={r} />
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

/* ---------- traffic and enquiries --------------------------------------------------- */

export function TrafficCard({ traffic, range }: { traffic: Reading<PageTrafficView>; range: Range }) {
  return (
    <Card title="Traffic" icon="line-chart" sub={`Visitors per day, ${rangeLabel(range).toLowerCase()}`} info="GA4 active users who viewed this page each day, with the same day one period earlier where that was measured. The newest days are still being counted. Consenting visitors only.">
      <Read reading={traffic}>
        {(t, r) => (
          <>
            <div className="dk-pages-figures">
              {(
                [
                  ["Visitors", t.visitors],
                  ["Views", t.views],
                  ["Sessions", t.sessions],
                ] as const
              ).map(([label, s]) => (
                <div key={label}>
                  <span>{label}</span>
                  <b className="dk-num">{num(s.value)}</b>
                  <Delta value={s.value} previous={s.previous} size="sm" />
                </div>
              ))}
            </div>
            <AreaChart label="Visitors per day" series={t.days} provisional={t.provisional} emptyNote="GA4 has no day in this period yet." zeroNote="Nobody viewed this page in this period." />
            <p className="dk-pages-stamp-line">
              <Stamp reading={r} />
              {t.period.partial ? <span className="dk-pages-rate"> · measured from {fullDate(t.period.since)}</span> : null}
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

export function EventsCard({ events, enquiries }: { events: Reading<PageEventRow[]>; enquiries: PageViewPayload["enquiries"] }) {
  return (
    <Card title="Enquiries and events" icon="funnel" info="The engine's enquiries from this page (counts only, once the desk has its key) and every GA4 event recorded on it in the range. The website's own five events are named; the rest are GA4's own.">
      {/* The engine's row says once, in place, what is missing, why, and the step that connects it. */}
      <ul className="dk-pages-rows">
        <li>
          <span className="dk-pages-grow">
            <b>Enquiries, by the engine</b>
            {enquiries.state === "ok" ? (
              <small>{enquiries.value.counts}</small>
            ) : (
              <>
                <small>
                  {enquiries.state === "waiting" ? "Nothing yet" : "Not available"}: {enquiries.reason}
                </small>
                {enquiries.state === "off" && enquiries.step ? <small className="dk-pages-step">{enquiries.step}</small> : null}
              </>
            )}
          </span>
          <span className="dk-pages-end">
            {enquiries.state === "ok" ? (
              <span className="dk-pages-figure dk-num">
                <b>{num(enquiries.value.count)}</b>
                <Delta value={enquiries.value.count} previous={enquiries.value.previous} size="sm" />
              </span>
            ) : (
              <span className="dk-pages-rate" aria-hidden>
                {DASH}
              </span>
            )}
          </span>
        </li>
      </ul>
      <Read reading={events}>
        {(rows, r) =>
          rows.length ? (
            <>
              <ul className="dk-pages-rows dk-pages-rows--after">
                {rows.map((e) => (
                  <li key={e.name}>
                    <span className="dk-pages-grow">
                      <span className="dk-pages-mono">{e.name}</span>
                      {e.what ? <small>{e.what}</small> : null}
                    </span>
                    <span className="dk-pages-end">
                      <span className="dk-pages-figure dk-num">
                        <b>{num(e.count)}</b>
                        <Delta value={e.count} previous={e.previous} size="sm" />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="dk-pages-stamp-line">
                <Stamp reading={r} />
              </p>
            </>
          ) : (
            <Empty compact icon="pulse" title="No events">
              GA4 recorded no event on this page in the range.
            </Empty>
          )
        }
      </Read>
    </Card>
  );
}

/* ---------- the request, structured data, speed ------------------------------------- */

export function ResponseCard({ facts }: { facts: Reading<PageFactsView> }) {
  return (
    <Card title="Response" icon="server" info="How the request went at the last crawl, measured from the desk's own server: one sample, a hint and not a measurement of what visitors get.">
      <Read reading={facts}>
        {(f, r) => (
          <>
            <dl className="dk-pages-facts">
              <dt>Status</dt>
              <dd>
                <Chip tone={STATE_TONE[f.row.state] ?? "quiet"}>{f.row.status || "No answer"}</Chip>
                {f.fetch.error ? <small>{f.fetch.error}</small> : null}
              </dd>
              {f.fetch.hops.length ? (
                <>
                  <dt>Redirects</dt>
                  <dd>
                    {f.fetch.hops.map((h) => `${h.status} ${h.url}`).join(" → ")}
                    {f.row.redirectTo ? <small>Lands on {f.row.redirectTo}</small> : null}
                  </dd>
                </>
              ) : null}
              <dt>First byte</dt>
              <dd className="dk-num">{duration(f.fetch.ttfbMs)}</dd>
              <dt>Whole page</dt>
              <dd className="dk-num">
                {duration(f.fetch.totalMs)}
                {f.fetch.bytes !== null ? <small>{bytes(f.fetch.bytes)} of HTML, uncompressed</small> : null}
              </dd>
              <dt>Cache</dt>
              <dd>
                {or(f.fetch.cache, "Not said")}
                {f.fetch.cacheControl ? <small className="dk-pages-mono">{f.fetch.cacheControl}</small> : null}
              </dd>
              <dt>Content type</dt>
              <dd className="dk-pages-mono">{or(f.fetch.contentType)}</dd>
              <dt>Last read</dt>
              <dd>
                <span suppressHydrationWarning>{ago(f.lastSeen)}</span>
                <small suppressHydrationWarning>{f.lastChanged ? `Content last seen changing ${ago(f.lastChanged)}` : "No change seen since the crawl first read it"}</small>
              </dd>
            </dl>
            <p className="dk-pages-stamp-line">
              <Stamp reading={r} />
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

export function SchemaCard({ facts }: { facts: Reading<PageFactsView> }) {
  return (
    <Card title="Structured data" icon="code" info="The JSON-LD blocks on the page: whether each is valid JSON, the types it describes, and any field the desk's rules require that is missing.">
      <Read reading={facts}>
        {(f, r) =>
          f.schema.length ? (
            <>
              <ul className="dk-pages-rows">
                {f.schema.map((b, i) => (
                  <li key={i}>
                    <Chip tone={b.parses ? "good" : "bad"}>{b.parses ? "Valid JSON" : "Not JSON"}</Chip>
                    <span className="dk-pages-grow">
                      {b.parses ? b.nodes.map((n) => n.type).join(", ") || "No typed node" : (b.error ?? "It does not parse.")}
                      {b.nodes
                        .filter((n) => n.missing.length || !n.known)
                        .map((n) => (
                          <small key={n.type}>{n.missing.length ? `${n.type} misses ${n.missing.join(", ")}` : `${n.type}: read, not judged (no rule for this type)`}</small>
                        ))}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="dk-pages-stamp-line">
                <Stamp reading={r} />
              </p>
            </>
          ) : (
            <Empty compact icon="code" title="No structured data">
              The page carries no JSON-LD block.
            </Empty>
          )
        }
      </Read>
    </Card>
  );
}

export function SpeedCard({ speed }: { speed: Reading<PageSpeedView> }) {
  return (
    <Card title="Lab speed" icon="gauge" info="PageSpeed Insights: one Lighthouse load of the page on Google's machines, on a phone and on a desktop. A measurement of the page, not of any visitor.">
      <Read reading={speed}>
        {(s, r) => (
          <>
            <div className="dk-pages-speed">
              {s.runs.map((run) => (
                <dl key={run.strategy} className="dk-pages-facts">
                  <dt>{run.strategy === "mobile" ? "Phone" : "Desktop"}</dt>
                  <dd suppressHydrationWarning>{ago(run.at)}</dd>
                  <dt>Performance</dt>
                  <dd className="dk-num">{num(run.performance)}</dd>
                  <dt>LCP</dt>
                  <dd className="dk-num">{duration(run.lcpMs)}</dd>
                  <dt>CLS</dt>
                  <dd className="dk-num">{run.cls === null ? DASH : num(run.cls, 3)}</dd>
                  <dt>Blocking time</dt>
                  <dd className="dk-num">{duration(run.tbtMs)}</dd>
                  {run.failure ? (
                    <>
                      <dt>Failed</dt>
                      <dd>{run.failure}</dd>
                    </>
                  ) : null}
                </dl>
              ))}
            </div>
            <p className="dk-pages-stamp-line">
              <Stamp reading={r} />
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

/* ---------- links and images ------------------------------------------------------------ */

const OUTCOME: Record<string, { label: string; tone: ChipTone }> = {
  ok: { label: "OK", tone: "good" },
  redirect: { label: "Redirects", tone: "warn" },
  broken: { label: "Broken", tone: "bad" },
  unchecked: { label: "Not checked", tone: "quiet" },
};

/** The links in, one row per page that links here: a page that links from its content and its menu is one page, as the Internal links tile counts it. */
function linkingPages(linksIn: PageFactsView["linksIn"]): { source: string; texts: string[]; content: boolean; menu: boolean }[] {
  const by = new Map<string, { source: string; texts: string[]; content: boolean; menu: boolean }>();
  for (const l of linksIn) {
    const row = by.get(l.source) ?? { source: l.source, texts: [], content: false, menu: false };
    if (l.place === "main") row.content = true;
    else row.menu = true;
    const words = l.text.trim();
    if (words && !row.texts.includes(words)) row.texts.push(words);
    by.set(l.source, row);
  }
  return [...by.values()];
}

export function LinksInCard({ facts }: { facts: Reading<PageFactsView> }) {
  const pages = facts.state === "ok" ? linkingPages(facts.value.linksIn) : [];
  return (
    <Card
      title="Links in"
      icon="link"
      count={facts.state === "ok" ? pages.length : undefined}
      info="The other pages of the site that link here, one row each, with the words of their links. Content: in the page's own text; menu: in the header or footer every page shares. A page that links from both is one page, as the Internal links tile counts it."
    >
      <Read reading={facts}>
        {(f, r) =>
          pages.length ? (
            <>
              <ul className="dk-pages-rows dk-pages-scroll">
                {pages.map((l) => (
                  <li key={l.source}>
                    <span className="dk-pages-grow">
                      <Go href={`/pages/view?path=${encodeURIComponent(l.source)}`}>{l.source}</Go>
                      <small>{l.texts.length ? l.texts.join(" · ") : "No words"}</small>
                    </span>
                    <span className="dk-pages-chips">
                      {l.content ? <Chip>Content</Chip> : null}
                      {l.menu ? <Chip>Menu</Chip> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="dk-pages-stamp-line">
                <Stamp reading={r} />
              </p>
            </>
          ) : (
            <Empty compact icon="link" title="No page links here">
              {f.row.path === "/" ? "The home page is reached by its address." : "An orphan: a reader following the site cannot reach it."}
            </Empty>
          )
        }
      </Read>
    </Card>
  );
}

export function LinksOutCard({ facts }: { facts: Reading<PageFactsView> }) {
  return (
    <Card title="Links out" icon="external" count={facts.state === "ok" ? facts.value.linksOut.length : undefined} info="Every address the page links to and what it answered: pages of the site at the last crawl, other sites at most once a week. Not checked means the other site refused or failed to answer an automated check, which is not the same as broken.">
      <Read reading={facts}>
        {(f, r) =>
          f.linksOut.length ? (
            <>
              <ul className="dk-pages-rows dk-pages-scroll">
                {f.linksOut.map((l) => {
                  const o = l.outcome ? OUTCOME[l.outcome] : null;
                  return (
                    <li key={`${l.target}|${l.place}`}>
                      <span className="dk-pages-grow">
                        {l.internal ? <Go href={`/pages/view?path=${encodeURIComponent(l.target)}`}>{l.target}</Go> : <Go href={l.target}>{l.target}</Go>}
                        <small>
                          {l.text || "No words"} · {l.place === "main" ? "content" : "menu"}
                          {l.rel ? ` · rel ${l.rel}` : ""}
                        </small>
                      </span>
                      {o ? <Chip tone={o.tone}>{l.status && l.outcome !== "ok" ? `${o.label} ${l.status}` : o.label}</Chip> : <Chip>Not yet checked</Chip>}
                    </li>
                  );
                })}
              </ul>
              <p className="dk-pages-stamp-line">
                <Stamp reading={r} />
              </p>
            </>
          ) : (
            <Empty compact icon="link" title="No links">
              The page links nowhere.
            </Empty>
          )
        }
      </Read>
    </Card>
  );
}

export function ImagesCard({ facts }: { facts: Reading<PageFactsView> }) {
  return (
    <Card title="Images" icon="image" count={facts.state === "ok" ? facts.value.images.length : undefined} info='The pictures in the served HTML with their alt text. alt="" says "decoration" and is correct; only a missing alt attribute is a fault. Pictures client code adds after load are not seen.'>
      <Read reading={facts}>
        {(f, r) =>
          f.images.length ? (
            <>
              <ul className="dk-pages-rows dk-pages-scroll">
                {f.images.map((i, k) => (
                  <li key={`${i.src}|${k}`}>
                    <span className="dk-pages-grow">
                      {i.url ? <Go href={i.url}>{i.src}</Go> : <span>{i.src}</span>}
                      <small className={cx(i.alt === "absent" && !i.hidden && "dk-pages-alt-absent")}>
                        {i.alt === "written" ? `alt “${i.altText}”` : i.alt === "empty" ? 'alt="" (decoration)' : i.hidden ? "No alt, hidden from assistive technology" : "No alt attribute"}
                        {i.width && i.height ? ` · ${i.width} × ${i.height}` : ""} · {i.place === "main" ? "content" : "menu"}
                        {i.unnamedLink ? " · the only thing in a link, which then has no name" : ""}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="dk-pages-stamp-line">
                <Stamp reading={r} />
              </p>
            </>
          ) : (
            <Empty compact icon="image" title="No pictures in the HTML">
              The served page holds no &lt;img&gt;.
            </Empty>
          )
        }
      </Read>
    </Card>
  );
}

/* ---------- Search Console -------------------------------------------------------------- */

export function SearchCard({ search, inspection }: { search: Reading<PageSearchView>; inspection: Reading<PageInspectionView> }) {
  /* Both halves come from the same source: when it is not connected, it is said once. */
  const same = search.state !== "ok" && inspection.state !== "ok" && search.reason === inspection.reason;
  return (
    <Card title="Search Console" icon="search" info="Google Search only. Queries: what people searched before this page showed in results, with Google's average position (not a tracked rank). Index state: Google's stored record of the address, checked once a day.">
      {same ? (
        <Absent reading={search} />
      ) : (
        <div className="dk-pages-stack">
          <Read reading={inspection}>{(x, r) => <InspectionPart x={x} r={r} />}</Read>
          <Read reading={search}>{(s, r) => <QueriesPart s={s} r={r} />}</Read>
        </div>
      )}
    </Card>
  );
}

function InspectionPart({ x, r }: { x: PageInspectionView; r: Reading<PageInspectionView> }) {
  return (
    <div>
      <Badge tone={x.indexed ? "good" : "warn"} dot>
        {x.indexed ? "In Google's index" : "Not in Google's index"}
      </Badge>
      <dl className="dk-pages-facts dk-pages-stamp-line">
        <dt>Google says</dt>
        <dd>{or(x.coverage)}</dd>
        <dt>Last crawled</dt>
        <dd>{x.lastCrawl ? fullDate(x.lastCrawl) : DASH}</dd>
        {x.canonicalOk === false ? (
          <>
            <dt>Google&apos;s canonical</dt>
            <dd>{x.googleCanonical}</dd>
          </>
        ) : null}
      </dl>
      {x.link ? <Go href={x.link}>Open in Search Console</Go> : null}
      <p className="dk-pages-stamp-line">
        <Stamp reading={r} showNote /> <span className="dk-pages-rate">· checked {fullDate(x.day)}</span>
      </p>
    </div>
  );
}

function QueriesPart({ s, r }: { s: PageSearchView; r: Reading<PageSearchView> }) {
  return (
    <div>
      <div className="dk-pages-figures">
        <div>
          <span>Clicks</span>
          <b className="dk-num">{num(s.totals.clicks)}</b>
        </div>
        <div>
          <span>Impressions</span>
          <b className="dk-num">{num(s.totals.impressions)}</b>
        </div>
        <div>
          <span>Average position</span>
          <b className="dk-num">{s.totals.position === null ? DASH : num(s.totals.position, 1)}</b>
        </div>
      </div>
      {s.queries.length ? (
        <ul className="dk-pages-rows">
          {s.queries.map((q) => (
            <li key={q.query}>
              <span className="dk-pages-grow">
                {q.query}
                <small className="dk-num">
                  {num(q.impressions)} impressions · CTR {percent(q.ctr)} · position {num(q.position, 1)}
                </small>
              </span>
              <span className="dk-pages-end dk-num">{num(q.clicks)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dk-pages-rate">Google showed this page for no query in the period.</p>
      )}
      <p className="dk-pages-stamp-line">
        <Stamp reading={r} showNote />
      </p>
    </div>
  );
}

/* ---------- history and actions ------------------------------------------------------------ */

export function HistoryCard({ history, ownFiles }: { history: Reading<PageHistoryItem[]>; ownFiles: string[] }) {
  const now = new Date();
  return (
    <Card
      title="History"
      icon="clock"
      info={
        ownFiles.length ? (
          <>
            Commits to the files only this page uses: {ownFiles.join(", ")}. And what the desk&apos;s crawl saw change between two crawls.
          </>
        ) : (
          "What the desk's crawl saw change between two crawls. No file of the website's code belongs to this page alone, so no commit can be said to have changed it."
        )
      }
    >
      <Read reading={history}>
        {(items, r) =>
          items.length ? (
            <>
              <ul className="dk-pages-rows dk-pages-scroll">
                {items.map((h) => (
                  <li key={h.id}>
                    <span className="dk-pages-rate dk-num" suppressHydrationWarning>
                      {feedTime(h.at, now)}
                    </span>
                    <span className="dk-pages-grow">
                      {h.href ? <Go href={h.href}>{h.text}</Go> : h.text}
                      <small>
                        {h.who ? `by ${h.who}` : "seen by the desk's crawl"}
                        {h.detail ? ` · ${h.detail}` : ""}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="dk-pages-stamp-line">
                <Stamp reading={r} showNote />
              </p>
            </>
          ) : (
            <Empty compact icon="clock" title="Nothing recorded">
              {r.note}
            </Empty>
          )
        }
      </Read>
    </Card>
  );
}

export function DetailActions({ path, url, crawl, said, back }: { path: string; url: string; crawl: PageViewPayload["crawl"]; said: { text: string; good: boolean } | null; back: string }) {
  const items: ActionItem[] = [
    { icon: "external", label: "Open live page", description: url, href: url },
    { icon: "sparkles", label: "Propose metadata", description: "The AI operator drafts a title and description", href: `/operator?do=metadata&path=${encodeURIComponent(path)}` },
  ];
  if (crawl.ready) items.push({ icon: "refresh", label: crawl.running ? "Run crawl for the site (running now)" : "Run crawl for the site", description: crawl.lastEnd ? `Last crawl finished ${ago(crawl.lastEnd)}` : "Reads every page again", action: runCrawl, fields: { back } });
  items.push({ icon: "pages", label: "Back to every page", href: "/pages" });
  return (
    <Card title="Actions" icon="bolt" id="dk-pages-actions">
      <ActionList label="Actions for this page" items={items} />
      {said ? (
        <p className={cx("dk-pages-said", !said.good && "dk-pages-said--bad")} role="status">
          {said.text}
        </p>
      ) : null}
    </Card>
  );
}

export function SpecimenRibbon() {
  return (
    <p className="dk-pages-ribbon" role="status">
      <b>Specimen data.</b> The Search Console panel shows artificial rows written into the route&apos;s own file, so its connected state can be looked at before the key exists. They are not Google&apos;s figures. Everything else on this page is real.
    </p>
  );
}
