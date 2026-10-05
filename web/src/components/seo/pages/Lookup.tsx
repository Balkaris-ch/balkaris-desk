import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { LookupLive, PageLookup } from "@/contract/seo/pages";
import { Badge, Chip, type ChipTone } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { cx } from "@/lib/cx";
import { bytes, DASH, num } from "@/lib/format";
import { keywordHref, pagesHref, type Place } from "./href";
import { rateCell } from "./PagesList";
import { RedirectForm } from "./RedirectForm";
import { IndexFacts } from "./Summary";

function Fact({ term, children, wide }: { term: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx("dk-seo-pages-fact", wide && "dk-seo-pages-fact--wide")}>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const statusTone = (s: number): ChipTone => (s === 200 ? "good" : s >= 300 && s < 400 ? "info" : "bad");

/**
 * What the live site answered, in one sentence. Vercel's refusal of a whole
 * deployment is said as what it is (the site switched off, not this page
 * missing), so nobody fixes an address for a hosting matter.
 */
function liveLine(v: LookupLive): string {
  if (v.status === 0) return `Nothing answered: ${v.error ?? "no reason given"}.`;
  if (v.status === 402 && v.error === "DEPLOYMENT_DISABLED")
    return "Vercel answers 402 (DEPLOYMENT_DISABLED): the website’s deployment is switched off, so every address answers this way until the hosting is paid. It says nothing about this address.";
  const via = v.hops.length ? ` after ${v.hops.length} redirect${v.hops.length === 1 ? "" : "s"}` : "";
  if (v.status === 200) return `Answers 200${via}.`;
  if (v.status === 404 || v.status === 410) return `Answers ${v.status}${via}: the website has no page here.`;
  return `Answers ${v.status}${via}${v.error ? ` (${v.error})` : ""}.`;
}

function Live({ live, place }: { live: Reading<LookupLive>; place: Place }) {
  if (live.state !== "ok") return <Absent reading={live} form="tile" />;
  const v = live.value;
  const p = v.page;
  return (
    <>
      <p className="dk-seo-pages-line">
        <Badge tone={statusTone(v.status)} dot>
          {v.status || "No answer"}
        </Badge>
        <span>{liveLine(v)}</span>
      </p>
      {v.hops.length ? (
        <ol className="dk-seo-pages-hops">
          {v.hops.map((h, i) => (
            <li key={`${i}-${h.url}`} className="dk-num">
              {h.status} {h.url} <Icon name="arrow-right" size={11} /> {h.location ?? DASH}
            </li>
          ))}
        </ol>
      ) : null}
      {v.landsOn ? (
        <p className="dk-seo-pages-small">
          It lands on{" "}
          <Go href={pagesHref(place, { open: v.landsOn })} scroll={false} replace>
            {v.landsOn}
          </Go>
          .
        </p>
      ) : null}
      {p ? (
        <dl className="dk-seo-pages-facts">
          <Fact term="Title" wide>
            {p.title ?? "none"}
          </Fact>
          <Fact term="Description" wide>
            {p.description ?? "none"}
          </Fact>
          <Fact term="Canonical" wide>
            {p.canonical ?? "none"} {p.canonicalSelf === true ? <Chip tone="good">its own</Chip> : p.canonicalSelf === false ? <Chip tone="warn">elsewhere</Chip> : null}
          </Fact>
          <Fact term="Search engines">{p.indexable ? <Chip tone="good">may index it</Chip> : <Chip tone="bad">noindex</Chip>}</Fact>
          <Fact term="Robots tag">{[p.robots, p.robotsHeader ? `header: ${p.robotsHeader}` : null].filter(Boolean).join(" · ") || "none"}</Fact>
          <Fact term="Main heading" wide>
            {p.h1.length ? p.h1.join(" · ") : "none"}
          </Fact>
          <Fact term="Words">{num(p.words)}</Fact>
          <Fact term="Language">{p.lang ?? "not declared"}</Fact>
          <Fact term="Structured data" wide>
            {p.schemaTypes.length ? p.schemaTypes.join(", ") : "none"}
          </Fact>
          {p.hreflang.length ? (
            <Fact term="Language versions" wide>
              {p.hreflang.map((h) => `${h.lang}: ${h.href}`).join(" · ")}
            </Fact>
          ) : null}
        </dl>
      ) : null}
      <p className="dk-seo-pages-small dk-num">
        First byte {num(v.ttfbMs)} ms · {bytes(v.bytes)} · {v.finalUrl}
      </p>
      <Stamp reading={live} />
    </>
  );
}

function Search({ search, range }: { search: PageLookup["search"]; range: string }) {
  if (search.state !== "ok") return <Absent reading={search} form="tile" />;
  const v = search.value;
  return (
    <>
      <dl className="dk-seo-pages-facts dk-seo-pages-facts--four">
        <Fact term="Clicks">{num(v.clicks)}</Fact>
        <Fact term="Impressions">{num(v.impressions)}</Fact>
        <Fact term="CTR">{rateCell(v.ctr)}</Fact>
        <Fact term="Position">{v.position === null ? DASH : num(v.position, 1)}</Fact>
      </dl>
      {v.keywords.length ? (
        <ul className="dk-seo-pages-lookup-kw">
          {v.keywords.slice(0, 10).map((k) => (
            <li key={k.query}>
              <Go href={keywordHref(range, k.query)}>{k.query}</Go>
              <span className="dk-seo-pages-small dk-num">
                {num(k.impressions)} impr. · pos. {num(k.position, 1)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dk-seo-pages-small">Google showed this address for no search in the window.</p>
      )}
      {v.total > 10 ? <p className="dk-seo-pages-small">The 10 searches with the most impressions of {num(v.total)}.</p> : null}
      <Stamp reading={search} />
    </>
  );
}

function Redirect({ l }: { l: PageLookup }) {
  if (l.redirect) {
    const r = l.redirect;
    const word = r.state === "waiting" ? "waits for approval" : r.state === "approved" ? "is approved and goes out with the next publish" : r.state === "applied" ? "is on the website" : r.state;
    return (
      <p className="dk-seo-pages-small">
        A redirect from {l.path} to {r.to ?? DASH} {word}. <Go href={r.href}>Open it on AI Operator</Go>
      </p>
    );
  }
  if (!l.mayRedirect.ok) return <p className="dk-seo-pages-small">{l.mayRedirect.why}</p>;
  const lands = l.live.state === "ok" ? l.live.value.landsOn : null;
  return <RedirectForm from={l.path} suggested={lands ?? "/"} />;
}

/**
 * One address of the website the crawl does not read, looked up on the live
 * site in the summary's place: asked for with ?open= (an old address Google
 * still counts, opened from the list's foot) or typed whole into the search.
 * What it answers now, Google's stored state, what it earned in search, and
 * a redirect to propose when it is gone. Each part is its own reading.
 */
export function LookupPanel({ reading, place }: { reading: Reading<PageLookup>; place: Place }) {
  /* Back is the list without the address: ?open= dropped, or the typed address cleared. */
  const back = place.query.open ? pagesHref(place, { open: null }) : pagesHref(place, { q: "", open: null });
  const backLink = (
    <Go href={back} scroll={false} replace className="dk-seo-pages-more">
      Back to the list
    </Go>
  );
  if (reading.state !== "ok") {
    return (
      <Card title="Address lookup" icon="search" className="dk-seo-pages-side" right={backLink}>
        <Absent reading={reading} />
      </Card>
    );
  }
  const l = reading.value;
  return (
    <section className="dk-card dk-seo-pages-side dk-seo-pages-lookup" aria-label={`Lookup of ${l.path}`}>
      <header className="dk-seo-pages-side-head">
        <span className="dk-seo-pages-lookup-icon" aria-hidden>
          <Icon name="globe" size={18} />
        </span>
        <div className="dk-seo-pages-side-titles">
          <a href={l.url} target="_blank" rel="noreferrer" className="dk-seo-pages-side-path" title={`${l.url} (opens the live page)`}>
            <span>{l.path}</span>
            <Icon name="external" size={13} />
          </a>
          <p className="dk-seo-pages-side-sub">
            {l.known ? <Chip tone="good">Read by the crawl</Chip> : <Chip tone="warn">Not read by the crawl</Chip>}
            <span>{l.inSitemap === null ? "The sitemap has not been read yet" : l.inSitemap ? "In the sitemap" : "Not in the sitemap"}</span>
          </p>
        </div>
        {backLink}
      </header>
      <div className="dk-seo-pages-lookup-body">
        {l.known ? (
          <p className="dk-seo-pages-small">
            The crawl reads this address:{" "}
            <Go href={pagesHref(place, { open: l.path, q: "" })} scroll={false} replace>
              open its summary
            </Go>
            .
          </p>
        ) : null}
        <section className="dk-seo-pages-box">
          <h3 className="dk-seo-pages-h">On the live site now</h3>
          <Live live={l.live} place={place} />
        </section>
        <section className="dk-seo-pages-box">
          <h3 className="dk-seo-pages-h">Google’s index</h3>
          <IndexFacts idx={l.index} path={l.path} />
        </section>
        <section className="dk-seo-pages-box">
          <h3 className="dk-seo-pages-h">In Google Search</h3>
          <Search search={l.search} range={place.range} />
        </section>
        <section className="dk-seo-pages-box">
          <h3 className="dk-seo-pages-h">Redirect</h3>
          <Redirect l={l} />
        </section>
        <LinkButton href={l.url} size="sm" icon="external" className="dk-seo-pages-side-view">
          View the address live
        </LinkButton>
      </div>
    </section>
  );
}
