import type { SeoPayload } from "@/contract/seo";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { Stamp } from "@/components/ui/Stamp";
import { num, percent } from "@/lib/format";
import { position, PositionChange, windowText, SeoRead } from "./bits";
import { briefHref } from "./KeywordOpportunities";
import "./seo.css";

/**
 * One query, opened from the top bar's search (/seo?open=<query>): its
 * figures over the period against the period before, and the page Google
 * shows for it. A row the board does not have; it is where a keyword hit leads.
 */
export function OpenQuery({ open, closeHref }: { open: NonNullable<SeoPayload["open"]>; closeHref: string }) {
  return (
    <Card
      title={<>Keyword: “{open.query}”</>}
      icon="search"
      className="dk-seo-open"
      right={
        <>
          {open.reading.state === "ok" ? (
            <LinkButton href={briefHref(open.reading.value.query)} variant="good" size="sm">
              Optimize
            </LinkButton>
          ) : null}
          <LinkButton href={closeHref} size="sm" icon="x" aria-label="Close this keyword" />
        </>
      }
    >
      <SeoRead reading={open.reading}>
        {(q, r) => (
          <div className="dk-seo-open-row">
            <div className="dk-seo-open-fig">
              <span>Clicks</span>
              <b className="dk-num">{num(q.clicks)}</b>
              <Delta value={q.clicks} previous={q.previous?.clicks ?? null} size="sm" />
            </div>
            <div className="dk-seo-open-fig">
              <span>Impressions</span>
              <b className="dk-num">{num(q.impressions)}</b>
              <Delta value={q.impressions} previous={q.previous?.impressions ?? null} size="sm" />
            </div>
            <div className="dk-seo-open-fig">
              <span>CTR</span>
              <b className="dk-num">{percent(q.ctr)}</b>
            </div>
            <div className="dk-seo-open-fig">
              <span>Position</span>
              <b className="dk-num">{position(q.position)}</b>
              <PositionChange previous={q.previous?.position ?? null} current={q.position} compared={q.compared} />
            </div>
            <div className="dk-seo-open-fig dk-seo-open-fig--page">
              <span>Page Google shows</span>
              <b>{q.path ?? "not known"}</b>
            </div>
            <p className="dk-seo-open-stamp">
              {windowText(q.window)} · <Stamp reading={r} />
            </p>
          </div>
        )}
      </SeoRead>
    </Card>
  );
}
