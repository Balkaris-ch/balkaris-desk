import type { Reading } from "@/contract/common";
import type { AiPanel } from "@/contract/seo/overview";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Absent } from "@/components/ui/Read";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { fullDate, num, shortDate } from "@/lib/format";
import "./overview.css";

/**
 * AI search, the owner's "0% on that side", in three true figures: answers
 * of AI assistants that named Balkaris (recorded), visits from AI assistants
 * (GA4), requests from AI crawlers (Vercel's request records).
 */
export function AiSearch({ reading }: { reading: Reading<AiPanel> }) {
  return (
    <Card
      title="AI search"
      icon="robot"
      className="dk-seo-overview-panel dk-seo-overview-a-ai"
      info="Whether AI assistants name Balkaris: questions asked of them and their answers, recorded by the audit and by hand (each assistant’s newest round); sessions GA4 counted from AI assistants; and requests by named AI crawlers in Vercel’s request records once the drain delivers them."
      right={<LinkButton href="/seo/ai-search" size="sm">Open</LinkButton>}
    >
      {reading.state === "ok" ? (
        <div className="dk-seo-overview-ai">
          <div className="dk-seo-overview-ai-row">
            {/* The headline is the unprompted count, as on the tile: a question that names Balkaris is answered with it anyway. */}
            <p className="dk-seo-overview-sublabel">Named without being asked about</p>
            {reading.value.checks.asked ? (
              <>
                <p className={cx("dk-seo-overview-ai-fig dk-num", !reading.value.checks.unprompted.mentioned && "dk-seo-overview-bad")}>
                  {num(reading.value.checks.unprompted.mentioned)} <span>of {num(reading.value.checks.unprompted.asked)}</span>
                </p>
                <p className="dk-seo-overview-ai-line">
                  answers to questions without the name Balkaris. Counting questions that name it:{" "}
                  <b>
                    {num(reading.value.checks.mentioned)} of {num(reading.value.checks.asked)}
                  </b>
                  {reading.value.checks.lastDay ? ` · newest round ${fullDate(reading.value.checks.lastDay)}` : ""}
                </p>
              </>
            ) : (
              <p className="dk-seo-overview-quiet">No answers recorded yet.</p>
            )}
          </div>
          <div className="dk-seo-overview-ai-pair">
            <div>
              <p className="dk-seo-overview-sublabel">Visits from AI assistants</p>
              {reading.value.referrals.state === "ok" ? (
                <p className="dk-seo-overview-ai-fig dk-num">{num(reading.value.referrals.value.sessions)}</p>
              ) : (
                <Absent reading={reading.value.referrals} form="tile" />
              )}
            </div>
            <div>
              <p className="dk-seo-overview-sublabel">AI crawler requests</p>
              {reading.value.crawlers.state === "ok" ? (
                <p className="dk-seo-overview-ai-fig dk-num">{num(reading.value.crawlers.value.hits)}</p>
              ) : (
                <Absent reading={reading.value.crawlers} form="tile" />
              )}
            </div>
          </div>
          <p className="dk-seo-overview-quiet dk-seo-overview-ai-window">
            Visits and crawlers: {shortDate(reading.value.window.start)} to {shortDate(reading.value.window.end)}.
          </p>
        </div>
      ) : (
        <PanelAbsent reading={reading} />
      )}
    </Card>
  );
}
