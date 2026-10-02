import type { SeoPageViewPayload } from "@/contract/seo/page-view";
import { LinkButton } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import type { ReactNode } from "react";
import { num, percent, shortDate } from "@/lib/format";
import { optimizeHref, pathLabel, rateText, type OptimizeTab } from "./bits";

/** Our curve's CTR at a position (percent), read between whole positions, as src/cc/seo/ctr.ts reads it. */
export function curveAt(points: { position: number; ctr: number }[], beyond: number, position: number): number {
  if (!points.length) return beyond;
  if (position <= 1) return points[0]!.ctr;
  if (position > points.length) return beyond;
  const lo = Math.floor(position);
  const a = points[lo - 1]!.ctr;
  const b = points[Math.min(points.length, lo + 1) - 1]!.ctr;
  return Math.round((a + (b - a) * (position - lo)) * 100) / 100;
}

/**
 * The selected page's head (board 115): its address with a link to the live
 * page, one line of real facts (kind, last change the desk saw, GA4 visitors,
 * CTR against what our curve expects at its position), the two buttons and
 * the tabs of the page. Each tab is an address, so the server draws it.
 */
export function PageHeadCard({ data, range, tab }: { data: SeoPageViewPayload; range: string | null; tab: OptimizeTab }) {
  const path = data.path!;
  const page = data.page.state === "ok" ? data.page.value : null;
  const visitors = data.visitors.state === "ok" ? data.visitors.value : null;
  const ctr = data.tiles.ctr.state === "ok" ? data.tiles.ctr.value.now : null;
  const position = data.tiles.position.state === "ok" ? data.tiles.position.value.value : null;
  const expected = position !== null ? curveAt(data.curve.points, data.curve.beyond, position) : null;
  const crawl = data.crawl.state === "ok" ? data.crawl.value : null;
  const queries = data.queries.state === "ok" ? data.queries.value.rows.length : null;
  const linksIn = crawl ? crawl.linksIn : null;
  const findings = crawl ? crawl.findings.length : null;

  const facts: ReactNode[] = [];
  if (!page) {
    /* An address the crawl does not know: its name and nothing that would read as a figure about it. */
    return (
      <section className="dk-card dk-seo-optimize-head" aria-label="The page">
        <div className="dk-seo-optimize-head-top dk-seo-optimize-head-top--alone">
          <div className="dk-seo-optimize-head-text">
            <h2 className="dk-seo-optimize-head-path">{pathLabel(path)}</h2>
          </div>
        </div>
      </section>
    );
  }
  if (page?.kindLabel) facts.push(page.kindLabel);
  if (page?.updated) facts.push(`Changed ${shortDate(page.updated)}`);
  if (visitors) facts.push(`${num(visitors.users)} visitor${visitors.users === 1 ? "" : "s"} (GA4)`);
  if (ctr && ctr.den) {
    facts.push(
      <span key="ctr">
        CTR {rateText(ctr)}
        {expected !== null ? <span className="dk-seo-optimize-head-quiet"> (our curve expects {percent(expected, 2)} at position {num(position, 1)})</span> : null}
      </span>,
    );
  } else if (data.tiles.impressions.state === "ok") facts.push("Not shown in Google in the period");

  const items: TabItem[] = [
    { key: "overview", label: "Overview", href: optimizeHref(path, range, "overview") },
    { key: "optimize", label: "Optimize", href: optimizeHref(path, range, "optimize"), count: data.proposals.filter((p) => p.state === "waiting").length || null, countTone: "warn" },
    { key: "keywords", label: "Keywords", href: optimizeHref(path, range, "keywords"), count: queries || null },
    { key: "content", label: "Content", href: optimizeHref(path, range, "content") },
    { key: "links", label: "Internal Links", href: optimizeHref(path, range, "links"), count: linksIn },
    { key: "technical", label: "Technical", href: optimizeHref(path, range, "technical"), count: findings || null, countTone: findings ? "warn" : "quiet" },
    { key: "performance", label: "Performance", href: optimizeHref(path, range, "performance") },
  ];

  return (
    <section className="dk-card dk-seo-optimize-head" aria-label="The page">
      <div className="dk-seo-optimize-head-top">
        <div className="dk-seo-optimize-head-text">
          <h2 className="dk-seo-optimize-head-path">
            <span>{pathLabel(path)}</span>
            {page ? (
              <Go href={page.url} className="dk-seo-optimize-head-out" aria-label={`Open ${path} on the live site`}>
                <Icon name="external" size={15} />
              </Go>
            ) : null}
          </h2>
          {page?.title ? <p className="dk-seo-optimize-head-title">{page.title}</p> : null}
          {facts.length ? (
            <p className="dk-seo-optimize-head-facts">
              {facts.map((f, i) => (
                <span key={i}>{f}</span>
              ))}
            </p>
          ) : null}
        </div>
        <div className="dk-seo-optimize-head-actions">
          {page ? (
            <LinkButton href={page.url} size="sm" iconRight="external">
              View live page
            </LinkButton>
          ) : null}
          {page && page.status === 200 ? (
            <LinkButton href={optimizeHref(path, range, "optimize")} variant="primary" size="sm" icon="pencil">
              Edit title &amp; description
            </LinkButton>
          ) : null}
          <LinkButton href={`/pages/view?path=${encodeURIComponent(path)}`} variant="ghost" size="sm" icon="more" aria-label="The page’s full detail on Pages" title="The page’s full detail on Pages" />
        </div>
      </div>
      <Tabs items={items} active={tab} label="This page" size="sm" className="dk-seo-optimize-tabs" />
    </section>
  );
}
