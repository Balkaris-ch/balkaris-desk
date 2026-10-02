import type { SeoBacklinksPayload } from "@/contract/seo/backlinks";
import { SparkBars } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { num } from "@/lib/format";
import { hrefWith, paramsOf, taskAnchor } from "./look";

const SHOWN = 8;

/**
 * "Pages linked to": Bing Webmaster's count of links per page of the site,
 * and its total per day since the desk began asking. Until Bing is connected
 * the panel is the step that connects it, and says where Google's own list
 * of links is: on Search Console's screen only, which no API gives.
 */
export function Bing({ data, range }: { data: SeoBacklinksPayload; range: string }) {
  const b = data.bing;
  const base = paramsOf(range, data.asked);
  const ownerStep = data.needsYou.find((t) => t.id === "bing-webmaster");
  return (
    <Card
      title="Pages linked to"
      icon="link"
      sub="Bing's index of links, per page of the website"
      info="Google gives no backlink figures by any API. Bing Webmaster Tools does: the pages of the site other sites link to, with the linking page and its words. Bing sees fewer links than Google, and every figure here says Bing."
      className="dk-seo-bl-bing"
      footer={b.state === "ok" ? <Stamp reading={b} /> : undefined}
    >
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
      <p className="dk-seo-bl-note">
        Google’s own list of the sites that link here is on Search Console’s screen only (Links, Top linking sites), which no API gives.{" "}
        <Go href="https://search.google.com/search-console/links" className="dk-seo-bl-link">
          Open it in Search Console
        </Go>
      </p>
    </Card>
  );
}
