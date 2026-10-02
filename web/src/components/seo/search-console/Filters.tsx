import Form from "next/form";
import { Suspense } from "react";
import type { Reading } from "@/contract/common";
import type { ExplorerOptions, ExplorerResult } from "@/contract/seo/search-console";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { fullDate, shortDate } from "@/lib/format";
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

/**
 * The filters, over everything they narrow (the four figures, the chart and
 * the table), as Search Console sets its own: query words, one page, a
 * country, a device. Each is in the address. The window is the period chosen
 * in the head; the line under the filters says which days it is, what it is
 * compared with, and where the figures were read.
 */
export function ScFilters({ place, options, result }: { place: Place; options: ExplorerOptions; result: Reading<ExplorerResult> }) {
  const a = place.asked;
  const touched = a.q !== "" || a.page !== null || a.country !== "all" || a.device !== "all";
  const r = result.state === "ok" ? result.value : null;
  const pages = [{ value: "", label: "All pages" }, ...options.pages.map((p) => ({ value: p.path, label: p.path }))];
  const countries = options.countries.map((c) => ({ value: c.key, label: c.label }));

  return (
    <section className="dk-seo-gsc-filters" aria-label="Filters">
      <div className="dk-seo-gsc-filters-row">
        <Form action={BASE} prefetch={false} scroll={false} replace className="dk-seo-gsc-search" role="search">
          {keptFields(place, ["q"]).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <Icon name="search" size={15} className="dk-seo-gsc-search-icon" />
          <input type="search" name="q" defaultValue={a.q} placeholder="Query contains…" aria-label="Show only queries that contain these words" className="dk-seo-gsc-search-input" maxLength={80} />
        </Form>
        <FilterSelect param="page" fallback="" label="Page" options={pages} className="dk-seo-gsc-filter--page" />
        <FilterSelect param="country" fallback="all" label="Country" options={countries} />
        <FilterSelect param="device" fallback="all" label="Device" options={DEVICES} />
        {touched ? (
          <Go href={scHref(place, { q: "", page: null, country: "all", device: "all" })} scroll={false} replace className="dk-seo-gsc-clear">
            <Icon name="x" size={13} />
            <span>Clear filters</span>
          </Go>
        ) : null}
      </div>
      <p className="dk-seo-gsc-filters-said">
        {r ? (
          <>
            <span className="dk-num">
              {shortDate(r.start)} – {fullDate(r.end)}
            </span>
            <span aria-hidden>·</span>
            <span>{r.previous ? `compared with ${shortDate(r.previous.start)} – ${fullDate(r.previous.end)}` : "not compared"}</span>
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
