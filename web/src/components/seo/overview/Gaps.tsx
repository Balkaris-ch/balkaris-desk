import type { Reading } from "@/contract/common";
import type { GapsPanel } from "@/contract/seo/overview";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardFoot } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { LangMark, PRIORITY_TONE } from "./bits";
import { DEFAULT_RANGE, gapHref, seoHref } from "./href";
import { RowAction } from "./RowAction";
import "./overview.css";

/**
 * Content Gap Analysis: the clusters of real searches, the ones no page
 * answers first, each with how much of it a page in its own language covers
 * and how many relevant phrases it holds. The board groups by industry; the
 * desk's clusters are topics, so the list is by topic, and the button asks
 * the operator for the brief of the missing page. A brief already asked for
 * shows "Queued" on its row (the opportunity's own state), never a second
 * button or a bare link; a topic without a brief to ask for opens itself on
 * SEO › Content Gaps.
 */
export function Gaps({ reading, range = DEFAULT_RANGE, operate = true }: { reading: Reading<GapsPanel>; range?: string; operate?: boolean }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title="Content Gap Analysis"
      icon="layers"
      className="dk-seo-overview-panel dk-seo-overview-a-gaps"
      info="Clusters of real searches from the SEO audit’s keyword research, Search Console and Google Autocomplete. Coverage is the share of a cluster’s relevant phrases mapped to a page in the cluster’s own language; phrases is how many relevant phrases the cluster holds (counted, not a search volume). The site is English only, so every German cluster is a gap."
      sub={v ? `${num(v.gaps)} of ${num(v.clusters)} topics have no page · ${num(v.germanGaps)} of them German` : undefined}
      right={v ? <LinkButton href={seoHref("/seo/content-gaps", range)} size="sm">View all</LinkButton> : null}
      flush
      footer={v ? <CardFoot href={seoHref("/seo/content-gaps", range)}>View all content gaps</CardFoot> : undefined}
    >
      {v ? (
        <div className="dk-seo-overview-scroll">
          <table className="dk-seo-overview-table dk-seo-overview-gaps-table">
            <caption className="dk-sr">Topics and how much of each the site covers</caption>
            <thead>
              <tr>
                <th scope="col">Topic</th>
                <th scope="col">Coverage</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => {
                const share = r.coverage.of ? r.coverage.mapped / r.coverage.of : 0;
                return (
                  <tr key={r.key}>
                    <td className="dk-seo-overview-topic">
                      <span className={cx("dk-seo-overview-opp-dot", `dk-tone-${PRIORITY_TONE[r.priority]}`)} title={`${r.priority} priority`} aria-hidden />
                      <span className="dk-seo-overview-topic-name" title={r.name}>
                        {r.name.replace(/\s*\((DE|EN)\)$/i, "")}
                      </span>
                      <LangMark lang={r.lang} />
                      <span className="dk-seo-overview-gaptag">
                        {num(r.coverage.of)} relevant phrase{r.coverage.of === 1 ? "" : "s"}
                        {r.page ? ` · ${r.page}` : " · no page"}
                      </span>
                    </td>
                    <td className="dk-seo-overview-cover">
                      <ProgressBar value={share} label={`${r.name}: ${r.coverage.mapped} of ${r.coverage.of} phrases covered`} tone={share >= 0.6 ? "good" : share > 0 ? "warn" : "bad"} />
                      <span className="dk-num dk-seo-overview-cover-n">{r.coverage.of ? `${Math.round(share * 100)}%` : "—"}</span>
                    </td>
                    <td>
                      {r.action ? (
                        <RowAction
                          id={r.action.opportunityId}
                          kind={r.action.actionKind}
                          label={r.action.actionLabel}
                          step={r.action.step}
                          href={null}
                          available={r.action.available}
                          why={r.action.why}
                          state={r.action.state}
                          stateNote={r.action.stateNote}
                          variant="quiet"
                          range={range}
                          operate={operate}
                        />
                      ) : (
                        <LinkButton href={gapHref(r.key, range)} size="xs" variant="quiet" aria-label={`View ${r.name} on Content Gaps`}>
                          View
                        </LinkButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="dk-seo-overview-stampline">
            <Stamp reading={reading} />
          </div>
        </div>
      ) : reading.state !== "ok" ? (
        <div className="dk-seo-overview-pad">
          <PanelAbsent reading={reading} />
        </div>
      ) : null}
    </Card>
  );
}
