import Form from "next/form";
import type { ReactNode } from "react";
import type { Facet, PageFacets, PagesQuery, SearchBasis } from "@/contract/seo/pages";
import type { Reading } from "@/contract/common";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { BASE, CLEARED, keptFields, narrowed, pagesHref, type FilterField, type Place } from "./href";

interface Option {
  key: string;
  label: string;
  count: number | null;
  /** The option's own (i), when its label needs one. */
  title?: string;
}

/**
 * One group of the filters: every option is a link that sets the group's one
 * value (the list answers one choice per group), drawn as the board's ticked
 * boxes with the count of pages beside it. Each count is the list that option
 * would give with every OTHER group's choice kept (the server counts them so);
 * "All" clears the group. A group that is not one of the board's four starts
 * folded, unless one of its options is chosen.
 */
function Group({ title, field, options, all, place, folded }: { title: string; field: FilterField; options: Option[]; all: number; place: Place; folded?: boolean }) {
  const current = place.query[field];
  const list: Option[] = [{ key: "all", label: field === "type" ? "All pages" : "All", count: all }, ...options];
  return (
    <details className="dk-seo-pages-fgroup" open={!folded || current !== "all"}>
      <summary className="dk-seo-pages-fhead">
        <span>{title}</span>
        <Icon name="chevron-up" size={14} className="dk-seo-pages-fhead-mark" />
      </summary>
      <ul className="dk-seo-pages-flist">
        {list.map((o) => {
          const on = o.key === current;
          return (
            <li key={o.key}>
              <Go
                href={pagesHref(place, { [field]: o.key } as Partial<PagesQuery>)}
                scroll={false}
                replace
                className={cx("dk-seo-pages-fopt", on && "dk-seo-pages-fopt--on")}
                aria-current={on ? "true" : undefined}
                title={o.title}
              >
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

const opts = (list: Facet[]): Option[] => list.map((f) => ({ key: f.key, label: f.label, count: f.count }));

const SEVERITY_WORD = { critical: "Critical", warning: "Warning", opportunity: "Opportunity" } as const;

/** A group that has nothing to choose from says why in its place, so it is not simply missing. */
function Unavailable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="dk-seo-pages-fgroup">
      <p className="dk-seo-pages-fhead">
        <span>{title}</span>
      </p>
      {children}
    </div>
  );
}

/**
 * Which part of Google Search the figures are of: every country or
 * Switzerland, every device or one. Links, so the choice is in the address.
 * The desk's own daily copy of Search Console keeps both splits; Search
 * Console asked live (before that copy's first run) does not, and then this
 * says so instead of offering a choice the list would ignore.
 */
function SearchPart({ place, search }: { place: Place; search: Reading<SearchBasis> }) {
  if (search.state !== "ok") return null;
  if (search.value.by !== "history") {
    return <p className="dk-seo-pages-fnote dk-seo-pages-fnote--top">Country and device come from the desk’s own daily copy of Search Console, which has not run yet: the figures are of every country and device.</p>;
  }
  const q = place.query;
  const seg = <K extends "country" | "device">(field: K, label: string, choices: { key: PagesQuery[K]; label: string }[]) => (
    <div className="dk-seo-pages-seg" role="group" aria-label={label}>
      {choices.map((c) => {
        const on = q[field] === c.key;
        return (
          <Go key={c.key} href={pagesHref(place, { [field]: c.key } as Partial<PagesQuery>)} scroll={false} replace className={cx("dk-seo-pages-seg-opt", on && "dk-seo-pages-seg-opt--on")} aria-current={on ? "true" : undefined}>
            {c.label}
          </Go>
        );
      })}
    </div>
  );
  return (
    <div className="dk-seo-pages-part">
      <p className="dk-seo-pages-fhead">
        <span>Search figures from</span>
      </p>
      {seg("country", "Country", [
        { key: "all", label: "All countries" },
        { key: "che", label: "Switzerland" },
      ])}
      {seg("device", "Device", [
        { key: "all", label: "All" },
        { key: "mobile", label: "Mobile" },
        { key: "desktop", label: "Desktop" },
        { key: "tablet", label: "Tablet" },
      ])}
    </div>
  );
}

/**
 * The board's Filters panel: a search, the part of Google Search the figures
 * are of, then page type, index status, SEO score and Search Console
 * impressions (the board's four), then the audit's own: sitemap, links in, a
 * finding of the crawl, a waiting proposal, language and change against the
 * window before.
 */
export function Filters({ facets, place, search }: { facets: PageFacets; place: Place; search: Reading<SearchBasis> }) {
  const q = place.query;
  const a = facets.all;
  return (
    <Card
      title="Filters"
      className="dk-seo-pages-filters"
      right={
        narrowed(q) ? (
          <Go href={pagesHref(place, CLEARED)} scroll={false} className="dk-seo-pages-reset">
            Reset
          </Go>
        ) : (
          <span className="dk-seo-pages-reset dk-seo-pages-reset--off">Reset</span>
        )
      }
    >
      {/* A new search lists from its first row and opens its first page: the old ?open= and offset are left behind. */}
      <Form action={BASE} prefetch={false} scroll={false} replace className="dk-seo-pages-search" role="search">
        {keptFields(place, ["q"]).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Icon name="search" size={15} className="dk-seo-pages-search-icon" />
        <input
          type="search"
          name="q"
          defaultValue={q.q}
          placeholder="Search pages or paste an address…"
          aria-label="Search pages by address, title, description, main heading or a search they are shown for, or paste an address of the website to look it up"
          title="Words are looked for in each page's address, title, description, main heading and the searches Google showed it for. A whole address of the website opens that page, or looks it up live when the crawl does not read it."
          className="dk-seo-pages-search-input"
          maxLength={200}
        />
      </Form>
      <SearchPart place={place} search={search} />
      <div className="dk-seo-pages-fgroups">
        <Group title="Page type" field="type" options={opts(facets.types)} all={a.type} place={place} />
        <Group title="Status" field="status" options={opts(facets.status)} all={a.status} place={place} />
        <Group title="SEO score" field="score" options={opts(facets.score)} all={a.score} place={place} />
        {facets.traffic.length ? (
          <Group title="Traffic (impressions)" field="traffic" options={opts(facets.traffic)} all={a.traffic} place={place} />
        ) : (
          <Unavailable title="Traffic">{search.state !== "ok" ? <Absent reading={search} form="tile" /> : null}</Unavailable>
        )}
        <Group title="Sitemap" field="sitemap" options={opts(facets.sitemap)} all={a.sitemap} place={place} folded />
        <Group title="Links in" field="links" options={opts(facets.links)} all={a.links} place={place} folded />
        {facets.findings.length ? (
          <Group
            title="Finding of the crawl"
            field="finding"
            options={facets.findings.map((f) => ({ key: f.key, label: f.label, count: f.count, title: `${SEVERITY_WORD[f.severity]}: ${f.key}` }))}
            all={a.finding}
            place={place}
            folded
          />
        ) : null}
        <Group title="Proposals" field="proposal" options={opts(facets.proposal)} all={a.proposal} place={place} folded />
        {facets.langs.length ? <Group title="Language" field="lang" options={opts(facets.langs)} all={a.lang} place={place} folded /> : null}
        {facets.moved.length ? (
          <Group title="Change" field="moved" options={opts(facets.moved)} all={a.moved} place={place} folded />
        ) : (
          <Unavailable title="Change">
            <p className="dk-seo-pages-small">
              {search.state === "ok"
                ? "Not compared with the window before: the desk’s copy of Search Console does not reach back that far yet, or Google named no page then."
                : "Not available without Search Console."}
            </p>
          </Unavailable>
        )}
      </div>
      <p className="dk-seo-pages-fnote">
        Status is Google’s word at each address’s newest daily URL Inspection; traffic is Search Console impressions in the window (no free source gives search volume). The score is the desk’s own, by its crawl’s stated rules: it does not count Google’s index or AI readiness, so Status is what tells indexed pages from the rest. Each count is what the list would show with the other choices kept.
      </p>
    </Card>
  );
}
