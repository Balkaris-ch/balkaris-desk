import Form from "next/form";
import type { PageFacets, PagesQuery, SearchBasis } from "@/contract/seo/pages";
import type { Reading } from "@/contract/common";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { BASE, keptFields, pagesHref, type Place } from "./href";

interface Option {
  key: string;
  label: string;
  count: number | null;
}

/**
 * One group of the filters: every option is a link that sets the group's one
 * value (the list answers one choice per group), drawn as the board's ticked
 * boxes with the count of pages beside it. "All" clears the group.
 */
function Group({ title, field, current, options, total, place }: { title: string; field: "type" | "status" | "score" | "traffic"; current: string; options: Option[]; total: number; place: Place }) {
  const all: Option[] = [{ key: "all", label: field === "type" ? "All pages" : "All", count: total }, ...options];
  return (
    <details className="dk-seo-pages-fgroup" open>
      <summary className="dk-seo-pages-fhead">
        <span>{title}</span>
        <Icon name="chevron-up" size={14} className="dk-seo-pages-fhead-mark" />
      </summary>
      <ul className="dk-seo-pages-flist">
        {all.map((o) => {
          const on = o.key === current;
          return (
            <li key={o.key}>
              <Go href={pagesHref(place, { [field]: o.key } as Partial<PagesQuery>)} scroll={false} replace className={cx("dk-seo-pages-fopt", on && "dk-seo-pages-fopt--on")} aria-current={on ? "true" : undefined}>
                <span className="dk-seo-pages-fbox" aria-hidden>
                  {on ? <Icon name="check" size={11} /> : null}
                </span>
                <span className="dk-seo-pages-flabel">{o.label}</span>
                {o.count !== null ? <span className="dk-seo-pages-fcount dk-num">{num(o.count)}</span> : null}
              </Go>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The board's Filters panel: a search, then page type, index status, SEO score and Search Console impressions. */
export function Filters({ facets, total, place, search }: { facets: PageFacets; total: number; place: Place; search: Reading<SearchBasis> }) {
  const q = place.query;
  const touched = q.type !== "all" || q.status !== "all" || q.score !== "all" || q.traffic !== "all" || q.q !== "";
  return (
    <Card
      title="Filters"
      className="dk-seo-pages-filters"
      right={
        touched ? (
          <Go href={pagesHref(place, { type: "all", status: "all", score: "all", traffic: "all", q: "", open: null })} scroll={false} className="dk-seo-pages-reset">
            Reset
          </Go>
        ) : (
          <span className="dk-seo-pages-reset dk-seo-pages-reset--off">Reset</span>
        )
      }
    >
      <Form action={BASE} prefetch={false} scroll={false} replace className="dk-seo-pages-search" role="search">
        {keptFields(place, ["q"]).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Icon name="search" size={15} className="dk-seo-pages-search-icon" />
        <input type="search" name="q" defaultValue={q.q} placeholder="Search pages…" aria-label="Search pages by address or title" className="dk-seo-pages-search-input" maxLength={80} />
      </Form>
      <div className="dk-seo-pages-fgroups">
        <Group title="Page type" field="type" current={q.type} options={facets.types} total={total} place={place} />
        <Group title="Status" field="status" current={q.status} options={facets.status} total={total} place={place} />
        <Group title="SEO score" field="score" current={q.score} options={facets.score} total={total} place={place} />
        {facets.traffic.length ? (
          <Group title="Traffic (impressions)" field="traffic" current={q.traffic} options={facets.traffic} total={total} place={place} />
        ) : (
          <div className="dk-seo-pages-fgroup">
            <p className="dk-seo-pages-fhead">
              <span>Traffic</span>
            </p>
            {search.state !== "ok" ? <Absent reading={search} form="tile" /> : null}
          </div>
        )}
      </div>
      <p className="dk-seo-pages-fnote">
        Status is Google’s word at the last daily URL Inspection; traffic is Search Console impressions in the window (no free source gives search volume). The score is the desk’s own, by its crawl’s stated rules: it does not count Google’s index or AI readiness, so Status is what tells indexed pages from the rest.
      </p>
    </Card>
  );
}
