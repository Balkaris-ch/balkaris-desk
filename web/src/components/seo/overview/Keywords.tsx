import type { Reading } from "@/contract/common";
import type { KeywordPanel } from "@/contract/seo/overview";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Stamp } from "@/components/ui/Stamp";
import { Tooltip } from "@/components/ui/Tooltip";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { DASH, num, shortDate } from "@/lib/format";
import { LangMark, PRIORITY_TONE } from "./bits";
import { RowAction } from "./RowAction";
import "./overview.css";

/**
 * Top keyword opportunities (board 104): searches Google already shows the
 * site for at position 4 to 20, then topics of searches no page answers. The
 * board's "volume" has no free source: the column is Google's impressions of
 * the site for the phrase, named as such.
 */
export function Keywords({ reading }: { reading: Reading<KeywordPanel> }) {
  const w = reading.state === "ok" ? reading.value.window : null;
  return (
    <Card
      title="Top keyword opportunities"
      icon="tag"
      className="dk-seo-overview-panel dk-seo-overview-a-kw"
      info="Searches Google showed the site for at average position 4 to 20, then topics of real searches no page answers. Impressions are the times Google showed the site for the phrase: no free source gives a search volume. For a topic, phrases counts its relevant phrases."
      sub={w ? `Google Search, ${shortDate(w.start)} to ${shortDate(w.end)}` : undefined}
      right={<LinkButton href="/seo/keywords" size="sm">View all</LinkButton>}
      flush
    >
      {reading.state === "ok" ? (
        <div className="dk-seo-overview-scroll">
          <table className="dk-seo-overview-table dk-seo-overview-kw-table">
            <caption className="dk-sr">Keyword opportunities</caption>
            <thead>
              <tr>
                <th scope="col">Keyword or topic</th>
                <th scope="col" className="dk-seo-overview-num">
                  Impr.
                </th>
                <th scope="col" className="dk-seo-overview-num">
                  Now
                </th>
                <th scope="col" className="dk-seo-overview-num dk-seo-overview-col-aim">
                  Aim
                </th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {reading.value.rows.map((r) => (
                <tr key={r.opportunityId}>
                  <td className="dk-seo-overview-topic">
                    <span className={cx("dk-seo-overview-opp-dot", `dk-tone-${PRIORITY_TONE[r.priority]}`)} title={`${r.priority} priority`} aria-hidden />
                    <span className="dk-seo-overview-topic-name" title={r.page ? `${r.phrase} → ${r.page}` : r.phrase}>
                      {r.kind === "gap" ? r.phrase.replace(/\s*\((DE|EN)\)$/i, "") : r.phrase}
                    </span>
                    <LangMark lang={r.lang} />
                    {r.kind === "gap" ? <span className="dk-seo-overview-gaptag">{r.phrases !== null ? `${num(r.phrases)} phrases, no page` : "no page"}</span> : null}
                  </td>
                  <td className="dk-seo-overview-num dk-num">{r.impressions === null ? <Tooltip text="Google showed the site for none of these phrases in the window."><span tabIndex={0}>{DASH}</span></Tooltip> : num(r.impressions)}</td>
                  <td className="dk-seo-overview-num dk-num">{r.position === null ? DASH : num(r.position, 1)}</td>
                  <td className="dk-seo-overview-num dk-num dk-seo-overview-col-aim">{r.targetPosition === null ? DASH : `1–${r.targetPosition}`}</td>
                  <td>
                    <RowAction
                      id={r.opportunityId}
                      kind={r.actionKind}
                      label={r.actionLabel}
                      step={r.step}
                      href={null}
                      available={r.available}
                      why={r.why}
                      state={r.state}
                      stateNote={r.stateNote}
                      variant="quiet"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dk-seo-overview-stampline">
            <Stamp reading={reading} />
          </div>
        </div>
      ) : (
        <div className="dk-seo-overview-pad">
          <PanelAbsent reading={reading} />
        </div>
      )}
    </Card>
  );
}
