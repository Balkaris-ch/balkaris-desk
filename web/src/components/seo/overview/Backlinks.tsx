import type { Reading } from "@/contract/common";
import type { PresencePanel } from "@/contract/seo/overview";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { num, shortDate } from "@/lib/format";
import { plural } from "./bits";
import "./overview.css";

/**
 * Backlinks, as far as anything free and honest can say: Bing's count of
 * links (Google gives no backlink API; absent until Bing Webmaster is
 * connected), the sites that sent visitors (GA4 referrals), and the studio's
 * profiles and listings. No "domain rating", no invented referring domains.
 */
export function Backlinks({ reading }: { reading: Reading<PresencePanel> }) {
  return (
    <Card
      title="Backlinks"
      icon="link"
      className="dk-seo-overview-panel dk-seo-overview-a-links"
      info="Google offers no backlink figures at all. The links are Bing Webmaster’s count of the links it knows (once its key exists); the sites listed sent visitors, as GA4 counted them (consenting visitors only); the profiles are the studio’s listings the desk checks once a week. There is no domain rating here: no free source gives an honest one."
      right={<LinkButton href="/seo/backlinks" size="sm">View all</LinkButton>}
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
