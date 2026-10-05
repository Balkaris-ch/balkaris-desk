import type { SeoOpportunitiesPayload } from "@/contract/seo/opportunities";
import { api, ask } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Grid } from "@/components/ui/Grid";
import { SeoRefused } from "@/components/seo/nav/Refused";
import { DETAIL_TABS, OppDetail, type DetailTab } from "@/components/seo/opportunities/OppDetail";
import { OppList } from "@/components/seo/opportunities/OppList";
import { OppTiles } from "@/components/seo/opportunities/OppTiles";
import { Inputs } from "@/components/seo/opportunities/Inputs";
import { KeywordCluster, RankingPotential, Related } from "@/components/seo/opportunities/Lower";
import { paramsOf } from "@/components/seo/opportunities/look";
import "@/components/seo/opportunities/opps.css";

export const metadata = { title: "Opportunities · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The params the desk server reads (contract/seo/opportunities.ts); `tab` is this page's own. */
const PASSED = ["country", "type", "priority", "state", "active", "action", "page", "cluster", "keyword", "q", "sort", "offset", "limit", "open"] as const;

/**
 * SEO › Opportunities (boards 111, 109, 114). The head, the period and the
 * tab strip are the SEO layout's (app/(frame)/seo/layout.tsx). One request
 * (GET /api/v1/seo/opportunities) draws the page: the six figures, the list
 * with its filters, and one opportunity in detail (?open=, else the list's
 * first row) with its keyword cluster, its ranking potential and the
 * opportunities related to it. ?tab= picks the detail's tab. Under the
 * figures, what the list is made from: each source the rules read, and
 * whether it was read whole, in part, or not at all.
 *
 * Should the desk not answer for this page (its server code not loaded, a
 * failure), the page says so in place and the head and tabs stay.
 */
export default async function SeoOpportunitiesPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range, undefined, "30d");
  const params: Record<string, string | undefined> = { range };
  for (const k of PASSED) params[k] = one(q[k]);
  const tabAsked = one(q.tab);
  const tab: DetailTab = DETAIL_TABS.includes(tabAsked as DetailTab) ? (tabAsked as DetailTab) : "analysis";

  const got = await ask<SeoOpportunitiesPayload>("/api/v1/seo/opportunities", params);
  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoOpportunitiesPayload>("/api/v1/seo/opportunities", params);
    /* A page the owner has not given this person: the server did answer, with a refusal, and the gate says so. */
    if (got.kind === "forbidden") return <SeoRefused message={got.message} />;
    return (
      <Card title="Opportunities" icon="lightbulb">
        <Empty icon="alert" title="The desk did not answer for this page">
          {got.message}
        </Empty>
      </Card>
    );
  }
  const data = got.value;
  const detail = data.selected?.state === "ok" ? data.selected.value : null;
  const base = paramsOf(data.asked, { open: detail && one(q.open) ? detail.opportunity.id : undefined, tab: tab === "analysis" ? undefined : tab });

  return (
    <div className="dk-seo-opps">
      <OppTiles tiles={data.tiles} curve={data.curve} asked={data.asked} />
      <Inputs reading={data.inputs} />
      {/* The list, the detail beside it as tall as the list and the three panels under it; on a narrower page the detail comes straight after the list. */}
      <div className="dk-seo-opps-main">
        <div className="dk-seo-opps-main-grid">
          <div className="dk-seo-opps-area-list">
            <OppList data={data} openId={detail?.opportunity.id ?? null} />
          </div>
          <div className="dk-seo-opps-area-detail">
            <OppDetail data={data} base={base} tab={tab} />
          </div>
          <Grid cols="1fr 1fr 1fr" mid="1fr 1fr 1fr" className="dk-seo-opps-area-under">
            <KeywordCluster d={detail} />
            <RankingPotential d={detail} curveNote={data.curve.note} />
            <Related d={detail} base={base} />
          </Grid>
        </div>
      </div>
    </div>
  );
}
