import type { Reading } from "@/contract/common";
import type { CountriesPanel, TopPageRow, TopPagesPanel } from "@/contract/overview";
import { WorldMap, shareTexts } from "@/components/charts";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Absent, Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { Thumb } from "@/components/ui/Thumb";
import { Info } from "@/components/ui/Tooltip";
import { num } from "@/lib/format";

/** "Top pages": the five addresses most people saw, their change, and the enquiries (or GA4's form count, labelled) sent from each. */
export function TopPagesCard({ reading }: { reading: Reading<TopPagesPanel> }) {
  return (
    <Card
      title="Top pages"
      icon="pages"
      flush
      className="dk-overview-top"
      right={
        <LinkButton href="/pages" size="sm">
          View all
        </LinkButton>
      }
    >
      <Read reading={reading}>
        {(t, r) => {
          const sends = t.sends;
          return (
            <>
              <div className="dk-overview-topwrap">
              <Table<TopPageRow>
                caption="Top pages"
                rows={t.rows}
                rowKey={(p) => p.path}
                minWidth={300}
                empty="GA4 saw no page view in this range."
                columns={[
                  {
                    key: "page",
                    head: "Page",
                    cell: (p) => (
                      <span className="dk-overview-toppage">
                        <Thumb src={p.picture} size="sm" icon="file" />
                        <span className="dk-overview-toppath" title={p.path}>
                          {p.path}
                        </span>
                      </span>
                    ),
                  },
                  { key: "visitors", head: "Visitors", numeric: true, width: "17%", cell: (p) => num(p.users) },
                  { key: "change", head: "Change", numeric: true, width: "17%", cell: (p) => <Delta value={p.users} previous={p.previous} size="sm" /> },
                  {
                    key: "sends",
                    head:
                      sends.state === "ok" ? (
                        <span className="dk-overview-tophead">
                          {sends.value.label}
                          <Info text={sends.value.note} label="What this column counts" />
                        </span>
                      ) : (
                        "Enquiries"
                      ),
                    numeric: true,
                    width: "20%",
                    cell: (p) => (sends.state === "ok" ? num(sends.value.byPath[p.path] ?? 0) : <Absent reading={sends} form="inline" />),
                  },
                ]}
              />
              </div>
              <p className="dk-overview-foot dk-overview-foot--pad">
                <Stamp reading={r} />
                {/* The last column's own source, named, when it is not the one already stamped (the engine's enquiries). */}
                {sends.state === "ok" && sends.source !== r.source ? <Stamp source={sends.source} asOf={sends.asOf} note={`the ${sends.value.label.toLowerCase()} column`} showNote /> : null}
              </p>
            </>
          );
        }}
      </Read>
    </Card>
  );
}

/** "Countries": the dotted world with the countries that have visitors lit, and the first five with their shares. */
export function CountriesCard({ reading }: { reading: Reading<CountriesPanel> }) {
  return (
    <Card
      title="Countries"
      icon="map-pin"
      className="dk-overview-countries"
      right={
        <LinkButton href="/traffic" size="sm">
          View all
        </LinkButton>
      }
    >
      <Read reading={reading}>
        {(c, r) => {
          /* Shares of fewer than 30 people are noise: the counts are shown instead. */
          const shares = c.total < 30 ? c.rows.map((x) => num(x.users)) : shareTexts(c.rows.map((x) => x.users));
          return (
            <>
              <div className="dk-overview-world">
                <div className="dk-overview-map">
                  <WorldMap label="Visitors by country" countries={c.rows.map((x) => ({ code: x.code, value: x.users, name: x.name }))} />
                </div>
                <ol className="dk-overview-countrylist" aria-label="Countries, most visitors first">
                  {c.rows.slice(0, 5).map((x, i) => (
                    <li key={`${x.code ?? "none"}-${i}`} className="dk-overview-country">
                      <span className="dk-overview-code">{x.code ?? "··"}</span>
                      <span className="dk-overview-countryname" title={x.name}>
                        {x.name}
                      </span>
                      <span className="dk-overview-share dk-num" title={`${num(x.users)} ${x.users === 1 ? "person" : "people"}`}>
                        {shares[i]}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <p className="dk-overview-foot">
                <Stamp reading={r} />
              </p>
            </>
          );
        }}
      </Read>
    </Card>
  );
}
