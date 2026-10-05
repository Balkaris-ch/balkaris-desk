import type { ClusterCompare, OurPage, RivalPage, SeoCompetitorsPayload } from "@/contract/seo/competitors";
import { Badge, Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent, Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tooltip } from "@/components/ui/Tooltip";
import { fullDate, num, shortDate } from "@/lib/format";
import { BriefButton } from "./Buttons";
import { BASE, count, langChip, PRIORITY_LABEL, PRIORITY_TONE, safeHref, shortUrl } from "./look";

/**
 * "Our clusters against who ranks": for each of our keyword clusters a
 * competitor was seen for, the searches captured, who ranks and what their
 * pages say, our own page beside them (or the gap), and what Search Console
 * counted for the cluster's phrases in the head's window. The brief button
 * hands those facts to the AI Operator; nothing on the website changes.
 */
export function Clusters({ reading, rules, range }: { reading: SeoCompetitorsPayload["clusters"]; rules: SeoCompetitorsPayload["rules"]; range: string }) {
  return (
    <Card
      title="Our clusters against who ranks"
      icon="layers"
      className="dk-seo-competitors-clusters"
      sub="For each cluster a competitor was seen for: who ranks, what their pages say, and our page beside them."
      info={
        <span className="dk-seo-competitors-rules">
          <span>{rules.filing} A search filed by that rule is marked *.</span>
          <span>Search Console is the head's window; the rest is what was observed on its day.</span>
        </span>
      }
      right={<Stamp reading={reading} />}
      flush
    >
      <Read reading={reading}>
        {(list) =>
          list.length ? (
            <div className="dk-seo-competitors-cl" role="table" aria-label="Our clusters against who ranks">
              <div className="dk-seo-competitors-cl-head" role="row">
                <span role="columnheader">Cluster and searches</span>
                <span role="columnheader">Who ranks in Google</span>
                <span role="columnheader">Their pages</span>
                <span role="columnheader">Our page</span>
                <span role="columnheader">Search Console</span>
                <span role="columnheader">
                  <span className="dk-seo-competitors-sr">Action</span>
                </span>
              </div>
              {list.map((c) => (
                <ClusterLine key={c.cluster.key} c={c} range={range} />
              ))}
            </div>
          ) : (
            <p className="dk-seo-competitors-note dk-seo-competitors-pad">No cluster has a competitor seen for its searches.</p>
          )
        }
      </Read>
    </Card>
  );
}

type Ranked = { position: number; us: Placed; r?: undefined } | { position: number; us?: undefined; r: RivalPage };
type Placed = NonNullable<ClusterCompare["ourSeen"]>[number];

function ClusterLine({ c, range }: { c: ClusterCompare; range: string }) {
  /* Balkaris among who ranks, in its place by position (on a tie, before the other site). */
  const ourSeen = c.ourSeen ?? [];
  const ranked: Ranked[] = [...ourSeen.map((us): Ranked => ({ position: us.position, us })), ...c.organic.map((r): Ranked => ({ position: r.position, r }))].sort(
    (a, b) => a.position - b.position || (a.us ? -1 : b.us ? 1 : 0),
  );
  return (
    <div className="dk-seo-competitors-cl-row" role="row">
      <span className="dk-seo-competitors-cl-cell dk-seo-competitors-cl-name" role="cell">
        <Go href={`${BASE}?cluster=${encodeURIComponent(c.cluster.key)}${range !== "30d" ? `&range=${range}` : ""}`} className="dk-seo-competitors-cl-title" title="Show its competitors in the list">
          {c.cluster.name}
        </Go>
        <span className="dk-seo-competitors-cl-chips">
          <Chip tone={c.cluster.lang === "de" ? "good" : "quiet"} className="dk-seo-competitors-mini">
            {langChip(c.cluster.lang)}
          </Chip>
          <Badge tone={PRIORITY_TONE[c.cluster.priority]}>{PRIORITY_LABEL[c.cluster.priority]}</Badge>
          {c.cluster.rank !== null ? <span className="dk-seo-competitors-quiet">order {c.cluster.rank}</span> : null}
        </span>
        {/* Ways out: the cluster's phrases on Keywords, its gaps on Content Gaps. */}
        <span className="dk-seo-competitors-cl-chips">
          <Go href={`/seo/keywords?cluster=${encodeURIComponent(c.cluster.key)}`} className="dk-seo-competitors-task-link">
            Keywords
          </Go>
          <Go href={`/seo/content-gaps?cluster=${encodeURIComponent(c.cluster.key)}`} className="dk-seo-competitors-task-link">
            Content gaps
          </Go>
        </span>
        <span className="dk-seo-competitors-cl-queries">
          {c.queries.map((q) => (
            <Tooltip key={q.query} text={`Seen in ${q.engines.join(", ")}. ${q.filed === "words" ? "Filed under this cluster by the page's words rule." : q.filed === "hand" ? "Filed under this cluster by hand." : "Filed under this cluster by the keyword table."}`}>
              <span className="dk-seo-competitors-q" tabIndex={0}>
                “{q.query}”{q.filed === "words" ? "*" : ""}
              </span>
            </Tooltip>
          ))}
        </span>
      </span>

      <span className="dk-seo-competitors-cl-cell" role="cell">
        <span className="dk-seo-competitors-cl-label">Who ranks in Google</span>
        {c.organic.length || ourSeen.length ? (
          <ol className="dk-seo-competitors-rivals">
            {ranked.map((x) => (x.us ? <Us key={`us-${x.us.query}`} s={x.us} /> : <Rival key={x.r.domain} r={x.r} range={range} />))}
          </ol>
        ) : (
          <span className="dk-seo-competitors-none">No organic result captured</span>
        )}
        {c.ourSeenWhy ? <span className="dk-seo-competitors-small dk-seo-competitors-quiet">{c.ourSeenWhy}</span> : null}
        {c.mapPack.length ? (
          <span className="dk-seo-competitors-small">
            <Icon name="map-pin" size={12} /> Map pack: {c.mapPack.map((m) => m.name).join(", ")}
          </span>
        ) : null}
        {c.ai.length ? (
          <Tooltip text={c.ai.map((a) => `${a.name} (${a.engines.join(", ")})`).join("; ")}>
            <span className="dk-seo-competitors-small" tabIndex={0}>
              <Icon name="sparkles" size={12} /> AI answers named or cited {count(c.ai.length, "company", "companies")}
            </span>
          </Tooltip>
        ) : null}
      </span>

      <span className="dk-seo-competitors-cl-cell" role="cell">
        <span className="dk-seo-competitors-cl-label">Their pages</span>
        {c.theirs.read ? (
          <>
            <span className="dk-seo-competitors-cl-fig">
              <b className="dk-num">{num(c.theirs.german)}</b> of {num(c.theirs.read)} in German
            </span>
            <span className="dk-seo-competitors-cl-fig">
              <b className="dk-num">{num(c.theirs.price)}</b> of {num(c.theirs.read)} state a price
            </span>
            <span className="dk-seo-competitors-cl-fig">
              <b className="dk-num">{num(c.theirs.faq)}</b> of {num(c.theirs.read)} with FAQ markup
            </span>
            {c.theirs.medianWords !== null ? (
              <span className="dk-seo-competitors-cl-fig" title="The middle word count of their pages read (home pages where only the site was observed).">
                <b className="dk-num">{num(c.theirs.medianWords)}</b> words, the middle page
              </span>
            ) : null}
            {c.theirs.prices.length ? <span className="dk-seo-competitors-small dk-seo-competitors-price">{c.theirs.prices.map((p) => `“${p}”`).join(" · ")}</span> : null}
            {c.theirs.shown !== undefined ? (
              <span className="dk-seo-competitors-small dk-seo-competitors-quiet" title="Their pages are counted only for the sites shown under “Who ranks in Google”: a platform's page is never read, and a page not read yet is not counted.">
                A page read for {num(c.theirs.read)} of the {count(c.theirs.shown, "site")} shown
              </span>
            ) : null}
          </>
        ) : (
          <span className="dk-seo-competitors-none">None read: platforms only, or not read yet</span>
        )}
      </span>

      <span className="dk-seo-competitors-cl-cell" role="cell">
        <span className="dk-seo-competitors-cl-label">Our page</span>
        {c.ours ? <Ours o={c.ours} /> : <span className="dk-seo-competitors-gap">{c.gap ?? "No page of ours answers it."}</span>}
      </span>

      <span className="dk-seo-competitors-cl-cell" role="cell">
        <span className="dk-seo-competitors-cl-label">Search Console</span>
        {c.search.state === "ok" ? (
          c.search.value.shown ? (
            <>
              <span className="dk-seo-competitors-cl-fig">
                <b className="dk-num">{num(c.search.value.impressions)}</b> {c.search.value.impressions === 1 ? "impression" : "impressions"}, {num(c.search.value.clicks)} {c.search.value.clicks === 1 ? "click" : "clicks"}
              </span>
              {c.search.value.position !== null ? <span className="dk-seo-competitors-cl-fig">average position {num(c.search.value.position, 1)}</span> : null}
              <span className="dk-seo-competitors-small">
                {num(c.search.value.shown)} of {count(c.search.value.phrases, "phrase")} shown
              </span>
            </>
          ) : (
            <Tooltip text={c.search.note ?? ""}>
              <span className="dk-seo-competitors-none" tabIndex={0}>
                Not shown for any of its {count(c.search.value.phrases, "phrase")}, {shortDate(c.search.value.start)} – {shortDate(c.search.value.end)}
              </span>
            </Tooltip>
          )
        ) : (
          <Absent reading={c.search} form="inline" />
        )}
      </span>

      <span className="dk-seo-competitors-cl-cell dk-seo-competitors-cl-act" role="cell">
        {c.brief ? <BriefButton task={c.brief.task} label={c.brief.label} step={c.brief.step} /> : null}
      </span>
    </div>
  );
}

function Rival({ r, range }: { r: RivalPage; range: string }) {
  const p = r.page;
  const href = safeHref(p?.url ?? null);
  return (
    <li className="dk-seo-competitors-rival">
      <span className="dk-seo-competitors-rival-pos dk-num">#{r.position}</span>
      <span className="dk-seo-competitors-rival-text">
        <Go href={`${BASE}?open=${encodeURIComponent(r.domain)}${range !== "30d" ? `&range=${range}` : ""}`} className="dk-seo-competitors-rival-name" title={`#${r.position} for “${r.query}”. Open it beside Balkaris.`}>
          {r.domain}
        </Go>
        {p && !p.error ? (
          <span className="dk-seo-competitors-rival-facts">
            <Chip tone={p.lang?.startsWith("de") ? "good" : "quiet"} className="dk-seo-competitors-mini">
              {langChip(p.lang)}
            </Chip>
            <Words n={p.words} />
            {p.schemaTypes.includes("FAQPage") ? <Chip className="dk-seo-competitors-mini">FAQ</Chip> : null}
            {p.priceStated ? (
              <Chip tone="good" className="dk-seo-competitors-mini">
                CHF
              </Chip>
            ) : null}
            {href ? (
              <Go href={href} className="dk-seo-competitors-ext" title={`${shortUrl(p.url)} (${p.address === "home" ? "its home page: the capture named only the site" : p.address === "topic" ? "its page for this cluster, from its sitemap" : "the page that ranks"})`} aria-label={`Open ${shortUrl(p.url)}`}>
                <Icon name="external" size={11} />
              </Go>
            ) : null}
          </span>
        ) : p?.error ? (
          <span className="dk-seo-competitors-quiet dk-seo-competitors-small">not read: {p.error}</span>
        ) : null}
      </span>
    </li>
  );
}

/** Balkaris's own place among who ranks, as the same capture counted it. */
function Us({ s }: { s: Placed }) {
  return (
    <li className="dk-seo-competitors-rival dk-seo-competitors-rival--us">
      <span className="dk-seo-competitors-rival-pos dk-num">#{s.position}</span>
      <span className="dk-seo-competitors-rival-text">
        <Tooltip text={`Balkaris at ${s.position} for “${s.query}” on ${fullDate(s.day)}, as the capture counted the results (ads, the map pack and question boxes not counted). An observation of that day, not Search Console's average.`}>
          <span className="dk-seo-competitors-rival-name dk-seo-competitors-us" tabIndex={0}>
            Balkaris
          </span>
        </Tooltip>
        <span className="dk-seo-competitors-rival-facts">
          <span>observed {shortDate(s.day)}</span>
        </span>
      </span>
    </li>
  );
}

/** A page's words, short; none in the HTML a crawler gets is said as that, not as a count. */
function Words({ n }: { n: number | null }) {
  if (n === null) return null;
  if (n === 0) return <span title="No words in the HTML a crawler gets: the page may draw its text with JavaScript, which the desk does not run.">no text in its HTML</span>;
  return <span title={`${num(n)} words`}>{num(n)} w</span>;
}

function Ours({ o }: { o: OurPage }) {
  return (
    <>
      <Go href={`/seo/pages/view?path=${encodeURIComponent(o.page.path)}`} className="dk-seo-competitors-ourpath" title={o.page.title ? `${o.page.path}: ${o.page.title}` : o.page.path}>
        {o.page.path}
      </Go>
      <span className="dk-seo-competitors-rival-facts">
        <Chip tone={o.lang?.startsWith("de") ? "good" : "quiet"} className="dk-seo-competitors-mini">
          {langChip(o.lang)}
        </Chip>
        <Words n={o.words} />
        {o.faq ? <Chip className="dk-seo-competitors-mini">FAQ</Chip> : <span>no FAQ markup</span>}
      </span>
      <span className="dk-seo-competitors-small">
        {o.german === true ? "Links a German version" : o.german === false ? "No German version" : "German version not recorded"}
      </span>
      <Tooltip text={o.priceWhy}>
        <span className="dk-seo-competitors-small" tabIndex={0}>
          {o.price === true ? <span className="dk-seo-competitors-price">States a CHF amount</span> : o.price === false ? "No price stated" : "Price not checked for this kind of page"}
        </span>
      </Tooltip>
      {o.mappedBy === "rule" ? <span className="dk-seo-competitors-quiet dk-seo-competitors-small">mapped by the desk's rule</span> : null}
    </>
  );
}
