import type { Reading } from "@/contract/common";
import type { PresencePanel } from "@/contract/seo/overview";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { num, shortDate } from "@/lib/format";
import { plural } from "./bits";
import { DEFAULT_RANGE, seoHref } from "./href";
import "./overview.css";

/**
 * Backlinks, as far as anything free and honest can say: Bing's count of
 * links (Google gives no backlink API; absent until Bing Webmaster is
 * connected), the sites that sent visitors (GA4 referrals), and the studio's
 * profiles and listings. No "domain rating", no invented referring domains.
 */
export function Backlinks({ reading, range = DEFAULT_RANGE }: { reading: Reading<PresencePanel>; range?: string }) {
  return (
    <Card
      title="Backlinks"
      icon="link"
      className="dk-seo-overview-panel dk-seo-overview-a-links"
      info="Google offers no backlink API: its Links report is on Search Console’s screen only, and counts here once it is exported there and imported on SEO › Backlinks. The big figure is Bing Webmaster’s count of the links it knows (once its key exists); “read live by the desk” are linking pages the desk read itself and found the link on; the sites listed sent visitors, as GA4 counted them (consenting visitors only); the profiles are the studio’s listings the desk checks once a week. There is no domain rating here: no free source gives an honest one."
      right={<LinkButton href={seoHref("/seo/backlinks", range)} size="sm">View all</LinkButton>}
    >
      {reading.state === "ok" ? (
        <div className="dk-seo-overview-links">
          <div className="dk-seo-overview-links-head">
            {reading.value.bing.state === "ok" ? (
              <>
                <p className="dk-seo-overview-big dk-num">{num(reading.value.bing.value.total)}</p>
                <p className="dk-seo-overview-quiet">links Bing knows</p>
              </>
            ) : (
              <div className="dk-seo-overview-links-off">
                <p className="dk-seo-overview-small-head">Links (Bing Webmaster)</p>
                <Absent reading={reading.value.bing} form="tile" />
              </div>
            )}
          </div>

          {/* Links known without Bing: Google's Links report as imported, and the pages the desk reads itself. A desk without the line (older server code) shows none. */}
          {reading.value.known ? (
            <>
              <p className="dk-seo-overview-sublabel">Links known to the desk</p>
              {reading.value.known.state === "ok" ? (
                <ul className="dk-seo-overview-refs">
                  {reading.value.known.value.google ? (
                    <li>
                      <span className="dk-seo-overview-ref-host" title={reading.value.known.value.google.importedAt ? `Google’s Links report, imported ${shortDate(reading.value.known.value.google.importedAt)}` : "Google’s Links report, as imported"}>
                        Sites linking, per Google
                      </span>
                      <span className="dk-num">{num(reading.value.known.value.google.sites)}</span>
                    </li>
                  ) : null}
                  <li>
                    <span className="dk-seo-overview-ref-host" title="Linking pages the desk read itself and found the link on">
                      Read live by the desk
                    </span>
                    <span className="dk-num">
                      {num(reading.value.known.value.read.live)}
                      {reading.value.known.value.read.lost ? <span className="dk-seo-overview-bad"> · {num(reading.value.known.value.read.lost)} lost</span> : null}
                    </span>
                  </li>
                </ul>
              ) : (
                <Absent reading={reading.value.known} form="tile" />
              )}
            </>
          ) : null}

          <p className="dk-seo-overview-sublabel">Sites that sent visitors</p>
          {reading.value.referrers.state === "ok" ? (
            reading.value.referrers.value.rows.length ? (
              <ul className="dk-seo-overview-refs">
                {reading.value.referrers.value.rows.map((r) => (
                  <li key={r.host}>
                    <span className="dk-seo-overview-ref-host" title={r.host}>
                      {r.host}
                    </span>
                    <span className="dk-num">{num(r.sessions)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dk-seo-overview-quiet">
                No site sent a visitor GA4 counted, {shortDate(reading.value.referrers.value.start)} to {shortDate(reading.value.referrers.value.end)}.
              </p>
            )
          ) : (
            <Absent reading={reading.value.referrers} form="tile" />
          )}

          <p className="dk-seo-overview-sublabel">Profiles and listings</p>
          <p className="dk-seo-overview-profiles">
            {reading.value.profiles.of ? (
              <>
                <b className="dk-num">{num(reading.value.profiles.exist)}</b> of {plural(reading.value.profiles.of, "known profile")} exist
                {reading.value.profiles.missing ? (
                  <>
                    , <b className="dk-num dk-seo-overview-bad">{num(reading.value.profiles.missing)}</b> not found
                  </>
                ) : null}
                {reading.value.profiles.unknown ? <>, {num(reading.value.profiles.unknown)} not readable</> : null}.
              </>
            ) : (
              "None recorded yet: they come in with the SEO audit’s import."
            )}
          </p>
          {reading.value.referrers.state === "ok" ? <Stamp reading={reading.value.referrers} /> : null}
        </div>
      ) : (
        <PanelAbsent reading={reading} />
      )}
    </Card>
  );
}
