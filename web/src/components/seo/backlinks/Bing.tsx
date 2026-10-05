import type { SeoBacklinksPayload } from "@/contract/seo/backlinks";
import { SparkBars } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { fullDate, num } from "@/lib/format";
import { ImportLinks } from "./Forms";
import { hrefWith, paramsOf, taskAnchor } from "./look";

const SHOWN = 8;

/**
 * "Pages linked to": which pages of the website other sites link to, from
 * the two sources that say so. Google's own list is on Search Console's
 * screen only (no API gives it): the owner exports it there and imports the
 * file here, and the panel shows Google's top linked pages and link texts as
 * of that export. Bing Webmaster's index, once its key exists, adds its count
 * per page and its total per day since the desk began asking.
 */
export function Bing({ data, range }: { data: SeoBacklinksPayload; range: string }) {
  const b = data.bing;
  const g = data.google;
  const base = paramsOf(range, data.asked);
  const ownerStep = data.needsYou.find((t) => t.id === "bing-webmaster");
  const imported = g.state === "ok" ? Object.entries(g.value.imported).filter(([, x]) => !!x) : [];
  return (
    <Card
      title="Pages linked to"
      icon="link"
      sub="Google's export of its links, and Bing's index once connected"
      info="Google gives its list of links by no API: Search Console shows it on its screen, and exports it as a file the owner imports here. Bing Webmaster Tools gives its own (smaller) index by API once its key exists. Each figure says whose it is."
      className="dk-seo-bl-bing"
      right={<ImportLinks owner={data.viewer.owner} href={data.gscLinksUrl} />}
      footer={g.state === "ok" ? <Stamp reading={g} /> : b.state === "ok" ? <Stamp reading={b} /> : undefined}
    >
      <section className="dk-seo-bl-linked">
        <h3 className="dk-seo-bl-linked-head">Google (Search Console › Links)</h3>
        {g.state === "ok" ? (
          <>
            {g.value.pages.length ? (
              <>
                <p className="dk-seo-bl-quiet">Top linked pages, by links from other sites</p>
                <ol className="dk-seo-bl-bing-pages">
                  {g.value.pages.slice(0, SHOWN).map((p) => (
                    <li key={p.path}>
                      <Go href={`/seo/pages/view?path=${encodeURIComponent(p.path)}`} className="dk-seo-bl-clip dk-seo-bl-path" title={`${p.path}: ${num(p.links)} links from ${num(p.sites)} sites`}>
                        {p.path}
                      </Go>
                      <span className="dk-num">{num(p.links)}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
            {g.value.sites.length ? (
              <p className="dk-seo-bl-quiet">
                {num(g.value.sites.length)} linking site{g.value.sites.length === 1 ? "" : "s"} in Top linking sites: they are rows of the table.
              </p>
            ) : null}
            {g.value.texts.length ? (
              <p className="dk-seo-bl-quiet">
                Top link texts: {g.value.texts.slice(0, 5).map((t) => `“${t}”`).join(", ")}
                {g.value.texts.length > 5 ? ` and ${num(g.value.texts.length - 5)} more` : ""}
              </p>
            ) : null}
            {g.value.samples ? (
              <p className="dk-seo-bl-quiet">
                {num(g.value.samples)} linking page{g.value.samples === 1 ? "" : "s"} from Latest links: the desk reads each one itself, to see the link and whether it is followed.
              </p>
            ) : null}
            <ul className="dk-seo-bl-imported">
              {imported.map(([kind, x]) => (
                <li key={kind} className="dk-seo-bl-quiet">
                  {IMPORT_NAME[kind] ?? kind}: {num(x!.rows)} rows, imported {fullDate(x!.at)} by {x!.by}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <PanelAbsent reading={g} />
        )}
        <p className="dk-seo-bl-note">
          <Go href={data.gscLinksUrl} className="dk-seo-bl-link">
            Open Links in Search Console
          </Go>{" "}
          for the website's property: the export is made there.
        </p>
      </section>

      <section className="dk-seo-bl-linked">
        <h3 className="dk-seo-bl-linked-head">Bing Webmaster</h3>
        {b.state === "ok" ? (
          b.value.pages.length ? (
            <>
              <p className="dk-seo-bl-bing-total">
                <b className="dk-num">{num(b.value.total)}</b> link{b.value.total === 1 ? "" : "s"} to {num(b.value.pages.length)} page{b.value.pages.length === 1 ? "" : "s"}
                {b.value.complete ? "" : " (Bing had more pages of results than were read)"}
              </p>
              {b.value.history.length > 1 ? (
                <div className="dk-seo-bl-bing-spark">
                  <SparkBars data={b.value.history.map((h) => h.links)} />
                </div>
              ) : null}
              <ol className="dk-seo-bl-bing-pages">
                {b.value.pages.slice(0, SHOWN).map((p) => (
                  <li key={p.path}>
                    <Go href={`/seo/pages/view?path=${encodeURIComponent(p.path)}`} className="dk-seo-bl-clip dk-seo-bl-path" title={p.path}>
                      {p.path}
                    </Go>
                    <span className="dk-num">{num(p.links)}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="dk-seo-bl-quiet">Bing knows no link to the website yet. That is Bing’s index, not proof there is none.</p>
          )
        ) : (
          <>
            <PanelAbsent reading={b} />
            {ownerStep ? (
              <Go href={hrefWith(base, { task: ownerStep.id }, taskAnchor(ownerStep.id))} className="dk-seo-bl-decision">
                <Icon name={ownerStep.done ? "check-circle" : "flag"} size={15} />
                <span>
                  <b>{ownerStep.done ? "Marked done" : "Needs you"}:</b> set up Bing Webmaster Tools; its key then goes on the box.
                </span>
                <Icon name="chevron-right" size={14} />
              </Go>
            ) : null}
          </>
        )}
      </section>
    </Card>
  );
}

const IMPORT_NAME: Record<string, string> = { sites: "Top linking sites", pages: "Top linked pages", texts: "Top linking text", links: "Latest links" };
