import { Suspense } from "react";
import Form from "next/form";
import type { AssetsPayload, AssetsQuery, AssetTab } from "@/contract/assets";
import type { Reading } from "@/contract/common";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { FilterMenu } from "./FilterMenu";
import { assetsHref, assetsParams } from "./href";

const TAB_LABEL: [AssetTab, string][] = [
  ["all", "All"],
  ["images", "Images"],
  ["video", "Video"],
  ["share", "Share pictures"],
  ["other", "Fonts and other"],
  ["attention", "Needs attention"],
];

const SORTS = [
  { value: "heaviest", label: "Heaviest first" },
  { value: "lightest", label: "Lightest first" },
  { value: "name", label: "Name, A to Z" },
  { value: "pages", label: "On most pages" },
  { value: "issues", label: "Most to fix" },
];

/**
 * Under the tiles: the tabs with their counts, the search box and the
 * filters, as on the Pages board. The counts follow the search and the
 * filters, so each tab says how many rows it would show.
 */
export function Toolbar({ q, tabs, filters, crawled }: { q: AssetsQuery; tabs: Reading<Record<AssetTab, number | null>>; filters: AssetsPayload["filters"]; crawled: boolean }) {
  /* "On most pages" sorts by what the crawl found; before the first crawl it would sort by nothing. */
  const sorts = crawled || q.sort === "pages" ? SORTS : SORTS.filter((s) => s.value !== "pages");
  const counts = tabs.state === "ok" ? tabs.value : null;
  const items: TabItem[] = TAB_LABEL.map(([key, label]) => ({
    key,
    label,
    href: assetsHref(q, { tab: key }),
    count: counts ? counts[key] : null,
    countTone: key === "attention" && counts && (counts.attention ?? 0) > 0 ? "warn" : "quiet",
  }));

  /* What the search form carries besides the words: the view it searches in. */
  const keep = assetsParams({ ...q, q: "", page: 1, file: null });
  const active = [q.folder, q.format, q.flag].filter((v) => v !== null).length + (q.sort !== "heaviest" ? 1 : 0);
  const files = q.tab !== "share";

  return (
    <div className="dk-assets-tools">
      <Tabs items={items} active={q.tab} label="Which files" className="dk-assets-tabs" />
      <div className="dk-assets-tools-side">
        <Form action="/assets" prefetch={false} scroll={false} className="dk-assets-search" role="search">
          {[...keep].map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <button type="submit" className="dk-assets-search-go" aria-label="Search">
            <Icon name="search" size={16} />
          </button>
          <input
            type="search"
            name="q"
            defaultValue={q.q}
            key={q.q}
            placeholder={files ? "Search files, alt text or pages…" : "Search pages or pictures…"}
            aria-label={files ? "Search files by name, folder, alt text or page" : "Search pages by address, title or picture"}
            className="dk-assets-search-input"
            maxLength={120}
          />
        </Form>
        {files ? (
          <FilterMenu active={active}>
            <Suspense fallback={null}>
              <label className="dk-assets-filter">
                <span>Folder</span>
                <Select param="folder" label="Folder" resets={["page", "file"]} size="md" options={[{ value: "", label: "Every folder" }, ...filters.folders.map((f) => ({ value: f.value, label: `${f.label} (${f.count})` }))]} />
              </label>
              <label className="dk-assets-filter">
                <span>Format</span>
                <Select param="format" label="Format" resets={["page", "file"]} size="md" options={[{ value: "", label: "Every format" }, ...filters.formats.map((f) => ({ value: f.value, label: `${f.label} (${f.count})` }))]} />
              </label>
              <label className="dk-assets-filter">
                <span>Check</span>
                <Select
                  param="flag"
                  label="Check that fails or warns"
                  resets={["page", "file"]}
                  size="md"
                  options={[{ value: "", label: "Any, or none" }, ...filters.flags.filter((f) => f.count > 0 || f.value === q.flag).map((f) => ({ value: f.value, label: `${f.label} (${f.count})` }))]}
                />
              </label>
              <label className="dk-assets-filter">
                <span>Sort</span>
                <Select param="sort" label="Sort" resets={["page", "file"]} size="md" options={sorts} />
              </label>
            </Suspense>
            {active ? (
              <Go href={assetsHref(q, { folder: null, format: null, flag: null, sort: "heaviest" })} className="dk-assets-link dk-assets-filter-clear" scroll={false}>
                Clear the filters
              </Go>
            ) : null}
          </FilterMenu>
        ) : null}
      </div>
    </div>
  );
}
