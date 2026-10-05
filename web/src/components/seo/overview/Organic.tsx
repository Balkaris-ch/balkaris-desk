import type { Reading, Stat } from "@/contract/common";
import type { OrganicPanel } from "@/contract/seo/overview";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent, windowText } from "@/components/seo/bits";
import { num } from "@/lib/format";
import "./overview.css";

function Figure({ label, stat }: { label: string; stat: Stat }) {
  return (
    <div className="dk-seo-overview-fig">
      <p className="dk-seo-overview-sublabel">{label}</p>
      <p className="dk-seo-overview-fig-row">
        <span className="dk-seo-overview-fig-value dk-num">{num(stat.value)}</span>
        <Delta value={stat.value} previous={stat.previous} unit={stat.unit} size="sm" />
      </p>
    </div>
  );
}

/**
 * From search: what the people Google sent did, as GA4 counts them (the
 * channel group Organic Search): sessions and people, and their share of every
 * session in the same days. Beside Search Console's clicks, because a click
 * says Google sent somebody and a session says they arrived. GA4's days are
 * whole days to yesterday; Search Console's run two to three days behind, so
 * the window is named and the two are never set side by side as one figure.
 * Consenting visitors only: GA4 loads after the cookie banner.
 */
export function Organic({ reading }: { reading: Reading<OrganicPanel> }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title="From search"
      icon="users"
      className="dk-seo-overview-panel dk-seo-overview-a-organic"
      info={`Sessions and people GA4 puts in its channel group Organic Search (Google, Bing, DuckDuckGo and the other search engines), for whole days to yesterday. GA4 loads after the cookie banner is accepted, so these are consenting visitors only and fewer than came.${reading.state === "ok" && reading.note ? ` ${reading.note}` : ""}`}
      sub={v ? `GA4, ${windowText(v)}` : undefined}
      right={<LinkButton href="/traffic" size="sm">Traffic</LinkButton>}
    >
      {v ? (
        <div className="dk-seo-overview-organic">
          <div className="dk-seo-overview-figs dk-seo-overview-figs--two">
            <Figure label="Sessions" stat={v.sessions} />
            <Figure label="People" stat={v.users} />
          </div>
          <p className="dk-seo-overview-quiet">
            {v.allSessions ? (
              <>
                <b className="dk-num">{num(v.sessions.value)}</b> of the {num(v.allSessions)} sessions GA4 counted in these days came from a search engine.
              </>
            ) : (
              "GA4 counted no session at all in these days."
            )}
          </p>
          <div className="dk-seo-overview-moved-stamp">
            <Stamp reading={reading} />
          </div>
        </div>
      ) : reading.state !== "ok" ? (
        <PanelAbsent reading={reading} />
      ) : null}
    </Card>
  );
}
