import Form from "next/form";
import { Suspense } from "react";
import type { OverviewAsked } from "@/contract/seo/overview";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { Info } from "@/components/ui/Tooltip";
import { DEFAULT_RANGE } from "./href";
import "./overview.css";

const COUNTRIES = [
  { value: "all", label: "All countries" },
  { value: "che", label: "Switzerland" },
];

const DEVICES = [
  { value: "all", label: "All devices" },
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
  { value: "tablet", label: "Tablet" },
];

/** "Switzerland, mobile": what the Search Console figures are narrowed to, or null when they are not. */
export function narrowedTo(asked: OverviewAsked): string | null {
  const parts = [asked.country === "che" ? "Switzerland" : "", asked.device !== "all" ? asked.device : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * The Overview's own bar, over the tiles.
 *
 * On the left, a keyword box: a phrase typed here opens SEO › Keywords
 * filtered to it (?q=), which is where the desk shows what it knows of a
 * phrase and looks it up; the chosen period goes with it. On the right, the
 * country and the device the Search Console figures on this page are read
 * for. They write the address (?country=, ?device=) as the period select
 * does, the server draws the page again, and the panels they reach say so in
 * their notes: the four search tiles, Search Console, What moved and Top
 * pages. A Swiss studio reads its Swiss figures with one choice.
 */
export function OverviewBar({ asked, range }: { asked: OverviewAsked; range: string }) {
  const where = narrowedTo(asked);
  return (
    <div className="dk-seo-overview-bar">
      <Form action="/seo/keywords" prefetch={false} className="dk-seo-overview-find" role="search">
        {range && range !== DEFAULT_RANGE ? <input type="hidden" name="range" value={range} /> : null}
        <Icon name="search" size={15} className="dk-seo-overview-find-icon" />
        <input
          type="search"
          name="q"
          required
          minLength={2}
          maxLength={80}
          placeholder="Look up a keyword…"
          aria-label="Look up a keyword on SEO › Keywords"
          className="dk-seo-overview-find-input"
        />
        <button type="submit" className="dk-seo-overview-find-go">
          Look up
        </button>
      </Form>
      <div className="dk-seo-overview-where">
        <span className="dk-seo-overview-where-label">
          Search figures for
          <Info
            text="Narrows the Search Console figures on this page to one country or one device: the clicks, impressions, position and CTR tiles, the Search Console panel, What moved and Top pages. The desk keeps every day twice, for all countries and for Switzerland alone, and by device. The other panels (opportunities, keywords, the crawl, AI search) are not narrowed."
            label="About the country and device"
          />
        </span>
        {/* The selects read the address in the browser; until they have, their place is kept. */}
        <Suspense fallback={<span className="dk-seo-overview-where-space" />}>
          <Select param="country" fallback="all" label="Country" options={COUNTRIES} />
          <Select param="device" fallback="all" label="Device" options={DEVICES} />
        </Suspense>
        {where ? <span className="dk-seo-overview-where-on">Showing {where} only</span> : null}
      </div>
    </div>
  );
}
