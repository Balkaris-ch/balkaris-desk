import type { Reading, Stat } from "@/contract/common";
import type { SeoPayload } from "@/contract/seo";
import { Spark, SparkBars } from "@/components/charts";
import { Chip } from "@/components/ui/Badge";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import "./seo.css";

/**
 * Where the row's figures come from, once each: "Desk crawl · 1 hour ago
 * (SEO Health Score, Critical Issues)". The tiles are too narrow at the
 * board's width to carry a source line each without cutting it.
 */
function RowStamps({ tiles }: { tiles: [string, Reading<Stat>][] }) {
  const by = new Map<string, { reading: Reading<Stat>; labels: string[] }>();
  for (const [label, r] of tiles) {
    if (r.state !== "ok") continue;
    const key = `${r.source}|${r.asOf.slice(0, 16)}`;
    const g = by.get(key) ?? { reading: r, labels: [] };
    g.labels.push(label);
    by.set(key, g);
  }
  if (!by.size) return null;
  return (
    <p className="dk-seo-tile-stamps">
      {[...by.values()].map((g) => (
        <span key={g.labels.join()} className="dk-seo-tile-stamp">
          <Stamp reading={g.reading} />
          <span>{g.labels.join(", ")}</span>
        </span>
      ))}
    </p>
  );
}

/**
 * The seven figures under the head, in the board's order. Each says where it
 * comes from in its (i); the ones that wait for Search Console or Bing keep
 * their place and say so.
 */
export function SeoTiles({ data }: { data: SeoPayload }) {
  const t = data.tiles;
  const rule = data.scoreRule;
  const floors = data.floors;
  const named: [string, Reading<Stat>][] = [
    ["SEO Health Score", t.score],
    ["Indexed and Not Indexed Pages", t.indexed],
    ["Keyword Opportunities", t.keywordOpportunities],
    ["CTR Opportunities", t.ctrOpportunities],
    ["Backlinks", t.backlinks],
    ["Critical Issues", t.critical],
  ];
  return (
    <div className="dk-seo-tilerow">
    <Tiles count={7} className="dk-seo-tiles">
      <Tile
        noStamp
        label="SEO Health Score"
        reading={t.score}
        info={
          rule ? (
            <>
              The desk’s own score from its crawl, not a figure from Google. Every page in the sitemap starts at 100 and loses each of the {rule.pageRules} page rules’ points once when the
              rule finds something on it; the site score is the mean of the page scores, less the points of the {rule.siteRules} site rules that fired. Heaviest:{" "}
              {rule.heaviest.map((h) => `${h.title} (${h.cost})`).join(", ")}. History from the first crawl on.
            </>
          ) : (
            "The desk’s own score from its crawl, not a figure from Google. Every page in the sitemap starts at 100 and loses a rule’s points once when the rule finds something on it; the site score is the mean of the page scores, less the points of the site rules that fired. The rules are in src/cc/site/rules.ts. History from the first crawl on."
          )
        }
        chart={(s) => <Spark data={s.series} floor="min" />}
      />
      <Tile
        noStamp
        label="Indexed Pages"
        reading={t.indexed}
        info="Sitemap addresses Google’s URL Inspection reports as in its index, checked once a day. Not the total of Search Console’s Page indexing report, which no API gives."
        chart={(s) => <SparkBars data={s.series} />}
      />
      <Tile
        noStamp
        label="Not Indexed Pages"
        reading={t.notIndexed}
        downIsGood
        info="Sitemap addresses Google’s URL Inspection reports as not in its index, checked once a day. Google’s own words for each are in the full report."
        chart={(s) => <SparkBars data={s.series} />}
      />
      <Tile
        noStamp
        label="Keyword Opportunities"
        reading={t.keywordOpportunities}
        info={
          floors.early
            ? `Search Console queries at an average position of 4 to 20 over the period, already on the first two pages and not yet at the top. ${floors.early.line} Compared with the period before only when Google reported queries for it.`
            : `Search Console queries at an average position of 4 to 20 over the period, shown at least ${floors.opportunities} times: already on the first two pages, not yet at the top. Compared with the period before only when Google counted it whole.`
        }
      />
      <Tile
        noStamp
        label="CTR Opportunities"
        reading={t.ctrOpportunities}
        info={`Our own yardstick, not Google’s: pages whose click-through rate is under half the median of this site’s own pages in the same position band, counting pages shown at least ${floors.ctr} times; a band needs three such pages before it is compared. Google publishes no expected CTR.`}
      />
      <Tile
        noStamp
        label="Backlinks"
        reading={t.backlinks}
        badge={<Chip>Bing</Chip>}
        info="Inbound links in Bing’s index, from Bing Webmaster Tools. Google offers no backlink API, so this is Bing’s count, never Google’s; a zero means Bing knows no link, not that there is none."
        chart={(s) => <SparkBars data={s.series} />}
      />
      <Tile
        noStamp
        label="Critical Issues"
        reading={t.critical}
        downIsGood
        info="Critical findings of the desk’s crawl by its stated rules: a page that does not answer, a sitemap address that redirects or says noindex, a broken internal link, unreadable structured data. Recorded once a day."
        chart={(s) => <SparkBars data={s.series} tone="bad" />}
      />
    </Tiles>
    <RowStamps tiles={named} />
    </div>
  );
}
