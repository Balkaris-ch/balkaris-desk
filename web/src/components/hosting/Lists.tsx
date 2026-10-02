import type { Reading, Share } from "@/contract/common";
import { BarList } from "@/components/charts";
import { regionName } from "@/components/health/rules";
import { Card } from "@/components/ui/Card";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { num, percent } from "@/lib/format";

const SITE = "https://www.balkaris.ch";

/** Where the list comes from and how old it is, under it: the head is too narrow for both a title and a stamp. */
function Foot({ reading }: { reading: Reading<unknown> }) {
  return reading.state === "ok" ? (
    <p className="dk-hosting-foot dk-hosting-foot--list">
      <Stamp reading={reading} />
    </p>
  ) : null;
}

/** A share of the list's whole, beside its count. */
const shareOf = (v: number, all: number): string => (all > 0 ? percent((v / all) * 100, 0) : "");

/** The pages people loaded most, from Vercel's records. Each opens on the live site. */
export function TopPages({ reading }: { reading: Reading<Share[]> }) {
  return (
    <Card title="Top pages" icon="pages" className="dk-hosting-card" info="Page views per address in the range, by the counting rules: page loads and in-site navigations that reached Vercel.">
      <Read reading={reading}>
        {(rows) => (
          <BarList
            label="Page views per address"
            items={rows.map((r) => ({ key: r.key, label: r.label, value: r.value, ...(r.key.startsWith("/") ? { href: `${SITE}${r.key}` } : {}) }))}
            emptyNote="No page view counted in this range yet."
            className="dk-hosting-bars"
          />
        )}
      </Read>
      <Foot reading={reading} />
    </Card>
  );
}

/** Where page views came from: the referring site's host, nothing more of the address. */
export function Referrers({ reading }: { reading: Reading<Share[]> }) {
  return (
    <Card
      title="Referrers"
      icon="link"
      className="dk-hosting-card"
      info="The site a page load came from, as its host only. Browsers send only the host to another site, and many send nothing: those are 'Direct, or no referrer sent'. A navigation inside the site counts as 'Inside the site'."
    >
      <Read reading={reading}>
        {(rows) => {
          const all = rows.reduce((a, r) => a + r.value, 0);
          return <BarList label="Page views per referring site" items={rows.map((r) => ({ key: r.key, label: r.label, value: r.value, second: shareOf(r.value, all) }))} emptyNote="No page view counted in this range yet." className="dk-hosting-bars" />;
        }}
      </Read>
      <Foot reading={reading} />
    </Card>
  );
}

/**
 * Devices and the edge regions that served the views. Countries are not
 * here and say why: the records carry none, and the desk does not look one
 * up from an IP address.
 */
export function WhereFrom({ devices, regions, countries }: { devices: Reading<Share[]>; regions: Reading<Share[]>; countries: Reading<Share[]> }) {
  return (
    <Card title="Devices and regions" icon="globe" className="dk-hosting-card" info="Device class from the browser's own description (read, then dropped). Region: the Vercel edge that served the view, which follows the visitor's location only roughly.">
      {/* One source behind both lists: when it has nothing, one absent state says so for both. */}
      <Read reading={devices}>
        {(rows) => {
          const all = rows.reduce((a, r) => a + r.value, 0);
          return (
            <>
              <BarList label="Page views per device class" items={rows.map((r) => ({ key: r.key, label: r.label, value: r.value, text: shareOf(r.value, all), second: num(r.value) }))} emptyNote="No page view counted in this range yet." className="dk-hosting-bars" />
              <p className="dk-hosting-subhead dk-hosting-subhead--gap">Edge regions</p>
              <Read reading={regions} form="inline">
                {(list) => <BarList label="Page views per Vercel edge region" items={list.slice(0, 4).map((r) => ({ key: r.key, label: regionName(r.key) ?? r.label, value: r.value }))} emptyNote="No region recorded yet." className="dk-hosting-bars" />}
              </Read>
            </>
          );
        }}
      </Read>
      {countries.state !== "ok" ? (
        <p className="dk-hosting-note">
          <b>Countries:</b> {countries.reason}
        </p>
      ) : null}
      <Foot reading={devices} />
    </Card>
  );
}

/** Robots by family, and people's 404s by address. */
export function BotsAnd404s({ bots, notFound }: { bots: Reading<{ total: number; list: Share[] }>; notFound: Reading<{ total: number; list: Share[] }> }) {
  return (
    <Card title="Bots and 404s" icon="robot" className="dk-hosting-card" info="Robots: page requests whose user agent names a robot, by family, never counted as views. 404s: people's page requests that found nothing, by address.">
      {/* One source behind both lists: when it has nothing, one absent state says so for both. */}
      <Read reading={bots}>
        {(b) => (
          <>
            <p className="dk-hosting-subhead">
              Robots <span className="dk-num dk-hosting-subhead-n">{num(b.total)}</span>
            </p>
            <BarList label="Robot hits per family" items={b.list.slice(0, 5).map((r) => ({ key: r.key, label: r.label, value: r.value }))} emptyNote="No robot in this range." tone="grey" className="dk-hosting-bars" />
            <Read reading={notFound} form="inline">
              {(f) => (
                <>
                  <p className="dk-hosting-subhead dk-hosting-subhead--gap">
                    404s <span className="dk-num dk-hosting-subhead-n">{num(f.total)}</span>
                  </p>
                  <BarList label="404s per address" items={f.list.slice(0, 5).map((r) => ({ key: r.key, label: r.label, value: r.value }))} emptyNote="No person found a missing page in this range." tone="red" className="dk-hosting-bars" />
                </>
              )}
            </Read>
          </>
        )}
      </Read>
      <Foot reading={bots} />
    </Card>
  );
}
