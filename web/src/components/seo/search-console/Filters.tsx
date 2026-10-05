import Form from "next/form";
import { Suspense } from "react";
import type { Reading } from "@/contract/common";
import type { ExplorerOptions, ExplorerResult } from "@/contract/seo/search-console";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { fullDate } from "@/lib/format";
import { spanText } from "./Chart";
import { BASE, keptFields, scHref, type Place } from "./href";

const DEVICES = [
  { value: "all", label: "All devices" },
  { value: "DESKTOP", label: "Desktop" },
  { value: "MOBILE", label: "Mobile" },
  { value: "TABLET", label: "Tablet" },
];

/** A select that writes the address, with its place kept while the browser reads the address. */
function FilterSelect(props: { param: string; fallback: string; label: string; options: { value: string; label: string }[]; className?: string }) {
  return (
    <Suspense fallback={<span className={cx("dk-seo-gsc-filter-space", props.className)} />}>
      <Select param={props.param} fallback={props.fallback} resets={["offset"]} label={props.label} options={props.options} size="md" className={cx("dk-seo-gsc-filter", props.className)} />
    </Suspense>
  );
}

/** The hidden fields that keep every other choice when a GET form sends its own. */
function Kept({ place, except }: { place: Place; except: string[] }) {
  return (
    <>
      {keptFields(place, except).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

/**
 * "Brand" and "Without brand": the first cut any SEO makes. The brand word is
 * the website's own name; "-word" in the search box leaves a word out, so the
 * two are plain searches a person could type, and pressing the one that is
 * on takes it off again.
 */
function BrandChips({ place, brand }: { place: Place; brand: string }) {
  const q = place.asked.q;
  const chips = [
    { q: brand, label: "Brand", title: `Only queries containing “${brand}”` },
    { q: `-${brand}`, label: "Without brand", title: `Only queries without “${brand}”: how people find the site who do not know its name yet` },
  ];
  return (
    <nav className="dk-seo-gsc-switch dk-seo-gsc-brand" aria-label="Brand queries">
      {chips.map((c) => {
        const on = q === c.q;
        return (
          <Go key={c.q} href={scHref(place, { q: on ? "" : c.q })} scroll={false} replace className={cx("dk-seo-gsc-switch-item", on && "dk-seo-gsc-switch-item--on")} aria-current={on ? "true" : undefined} title={on ? "Show every query again" : c.title}>
            {c.label}
          </Go>
        );
      })}
    </nav>
  );
}

/**
 * The window by its own dates, as Search Console's "Custom" range: the
 * question since the relaunch is "since the launch against before it",
 * which no period answers. Native date fields, sent with GET, so the
 * address keeps the dates and the server draws them. The window can be
 * chosen inside the desk's history; a window that runs past the newest day
 * Google has finished is cut there, and the line under the filters says so.
 */
function Dates({ place, days, ignored }: { place: Place; days: ExplorerOptions["days"]; ignored: boolean }) {
  const a = place.asked;
  const start = place.dates?.start ?? a.start;
  const end = place.dates?.end ?? a.end;
  return (
    <Form action={BASE} prefetch={false} scroll={false} replace className="dk-seo-gsc-dates" aria-label="Choose the days">
      <Kept place={place} except={["start", "end"]} />
      <Icon name="calendar" size={15} className="dk-seo-gsc-dates-icon" />
      <label className="dk-seo-gsc-date">
        <span className="dk-sr">From</span>
        <input type="date" name="start" defaultValue={start || undefined} min={days?.from} max={days?.to} required className="dk-seo-gsc-date-input" />
      </label>
      <span className="dk-seo-gsc-dates-to" aria-hidden>
        –
      </span>
      <label className="dk-seo-gsc-date">
        <span className="dk-sr">To</span>
        <input type="date" name="end" defaultValue={end || undefined} min={days?.from} max={days?.to} required className="dk-seo-gsc-date-input" />
      </label>
      <button type="submit" className="dk-seo-gsc-dates-go" title="Show these days instead of the period">
        Show
      </button>
      {place.dates ? (
        <Go href={scHref(place, { dates: null })} scroll={false} replace className="dk-seo-gsc-clear" title="Back to the period chosen at the top">
          <Icon name="x" size={13} />
          <span>Back to the period</span>
        </Go>
      ) : null}
      {ignored ? (
        <span className="dk-seo-gsc-dates-said" role="status">
          Those dates are not a window (the start is after the end, or it is longer than 485 days): the period is shown.
        </span>
      ) : null}
    </Form>
  );
}

/**
 * The filters, over everything they narrow (the four figures, the chart and
 * the table), as Search Console sets its own: query words (a word with a
 * minus leaves it out, the whole box in quotes is that exact query), brand or
 * not, one page or every page whose address contains a part, a country, a
 * device, and the days. Each is in the address. The line under the filters
 * says which days it is, what it is compared with, and where the figures were
 * read.
 */
export function ScFilters({ place, options, result, datesIgnored }: { place: Place; options: ExplorerOptions; result: Reading<ExplorerResult>; datesIgnored: boolean }) {
  const a = place.asked;
  const touched = a.q !== "" || a.page !== null || a.part !== null || a.country !== "all" || a.device !== "all";
  const r = result.state === "ok" ? result.value : null;
  const pages = [{ value: "", label: "All pages" }, ...options.pages.map((p) => ({ value: p.path, label: p.path }))];
  const countries = options.countries.map((c) => ({ value: c.key, label: c.label }));

  return (
    <section className="dk-seo-gsc-filters" aria-label="Filters">
      <div className="dk-seo-gsc-filters-row">
        <Form action={BASE} prefetch={false} scroll={false} replace className="dk-seo-gsc-search" role="search">
          <Kept place={place} except={["q"]} />
          <Icon name="search" size={15} className="dk-seo-gsc-search-icon" />
          <input
            type="search"
            name="q"
            defaultValue={a.q}
            placeholder="Query contains…"
            aria-label="Show only queries that contain these words. A word with a minus in front leaves it out; the whole search in double quotes is that exact query."
            title={'Every word must be in the query. -word leaves a word out; "two words" in double quotes is that exact query.'}
            className="dk-seo-gsc-search-input"
            maxLength={80}
          />
        </Form>
        <BrandChips place={place} brand={options.brand} />
        <FilterSelect param="page" fallback="" label="Page" options={pages} className="dk-seo-gsc-filter--page" />
        <Form action={BASE} prefetch={false} scroll={false} replace className="dk-seo-gsc-search dk-seo-gsc-search--part" role="search">
          <Kept place={place} except={["pagepart"]} />
          <Icon name="filter" size={15} className="dk-seo-gsc-search-icon" />
          <input
            type="search"
            name="pagepart"
            defaultValue={a.part ?? ""}
            placeholder="Address contains…"
            aria-label="Show only pages whose address contains this, for example /insights/"
            title="Every page whose address contains this: /insights/ for a section of the site"
            className="dk-seo-gsc-search-input"
            maxLength={80}
          />
        </Form>
        <FilterSelect param="country" fallback="all" label="Country" options={countries} />
        <FilterSelect param="device" fallback="all" label="Device" options={DEVICES} />
        {touched ? (
          <Go href={scHref(place, { q: "", page: null, part: null, country: "all", device: "all" })} scroll={false} replace className="dk-seo-gsc-clear">
            <Icon name="x" size={13} />
            <span>Clear filters</span>
          </Go>
        ) : null}
      </div>
      <div className="dk-seo-gsc-filters-row">
        <Dates place={place} days={options.days} ignored={datesIgnored} />
      </div>
      <p className="dk-seo-gsc-filters-said">
        {r ? (
          <>
            <span className="dk-num">{spanText(r.start, r.end)}</span>
            {r.askedEnd ? (
              <>
                <span aria-hidden>·</span>
                <span title={`Asked up to ${fullDate(r.askedEnd)}. Google finishes counting a day two to three days later, and a day nobody has counted is not a zero.`}>the days after {fullDate(r.end)} are not counted yet</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span>{r.previous ? `compared with ${spanText(r.previous.start, r.previous.end)}` : "not compared"}</span>
            <span aria-hidden>·</span>
            <Tooltip text={r.note}>
              <span className={cx("dk-seo-gsc-source", r.source === "live" && "dk-seo-gsc-source--live")} tabIndex={0}>
                <Icon name={r.source === "live" ? "bolt" : "database"} size={12} />
                {r.source === "live" ? "Read live from Search Console" : "The desk’s daily copy of Search Console"}
                <span className="dk-sr">. {r.note}</span>
              </span>
            </Tooltip>
          </>
        ) : (
          <span>Google Search, web results, final days only.</span>
        )}
      </p>
    </section>
  );
}
