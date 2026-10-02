import type { SeoContentGapsPayload } from "@/contract/seo/content-gaps";
import { api, ask } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { CoverageList, ViewSwitch } from "@/components/seo/content-gaps/Coverage";
import { GroupPanel } from "@/components/seo/content-gaps/Group";
import { Headline, TableCoverage } from "@/components/seo/content-gaps/Headline";
import { hrefWith, paramsOf } from "@/components/seo/content-gaps/look";
import { ClusterPanel, CompetitorView, KeywordView, Lower } from "@/components/seo/content-gaps/Views";
import "@/components/seo/content-gaps/gaps.css";

export const metadata = { title: "Content Gaps · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The params the desk server reads (contract/seo/content-gaps.ts). */
const PASSED = ["view", "open", "tab", "lang", "price", "question", "gap", "priority", "cluster", "offset", "limit"] as const;

/**
 * SEO › Content Gaps (board 113, panel 5). The head, the period and the tab
 * strip are the SEO layout's (app/(frame)/seo/layout.tsx). One request
 * (GET /api/v1/seo/content-gaps) draws the page: the two largest gaps
 * (German, price questions) in one low band on top; then the view switch
 * with the whole keyword table's coverage beside it, and either the coverage list with the open
 * group beside it (by topic, industry, language or cluster), the phrases
 * with no page (by keyword), or the competitor pages read (by competitor);
 * and what only the owner can do.
 *
 * Should the desk not answer for this page (its server code not loaded, a
 * failure), the page says so in place and the head and tabs stay.
 */
export default async function SeoContentGapsPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range, undefined, "30d");
  const params: Record<string, string | undefined> = { range };
  for (const k of PASSED) params[k] = one(q[k]);

  const got = await ask<SeoContentGapsPayload>("/api/v1/seo/content-gaps", params);
  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoContentGapsPayload>("/api/v1/seo/content-gaps", params);
    return (
      <Card title="Content Gaps" icon="layers">
        <Empty icon="alert" title="The desk did not answer for this page">
          {got.message}
        </Empty>
      </Card>
    );
  }
  const data = got.value;
  const base = paramsOf(data.asked, range);
  const listed = data.view === "topic" || data.view === "industry" || data.view === "language" || data.view === "clusters";
  const openKey = data.group?.state === "ok" ? data.group.value.group.key : data.asked.open;

  return (
    <div className="dk-seo-gaps">
      <Headline german={data.german} price={data.price} />
      <section className="dk-seo-gaps-explore" aria-label="Content gaps">
        <div className="dk-seo-gaps-switchrow">
          <ViewSwitch views={data.views} active={data.view} base={base} />
          <TableCoverage tiles={data.tiles} />
        </div>
        {listed && data.groups ? (
          <div className="dk-seo-gaps-main">
            <CoverageList reading={data.groups} view={data.view} open={openKey} asked={data.asked} base={base} />
            {data.selected ? (
              <ClusterPanel reading={data.selected} back={hrefWith(base, { cluster: null })} />
            ) : (
              <GroupPanel reading={data.group} base={base} impressionsNote={data.notes.impressions} />
            )}
          </div>
        ) : null}
        {data.view === "keywords" ? <KeywordView reading={data.keywords} asked={data.asked} base={base} impressionsNote={data.notes.impressions} /> : null}
        {data.view === "competitors" ? <CompetitorView reading={data.competitors} /> : null}
        {!listed && data.selected ? <ClusterPanel reading={data.selected} back={hrefWith(base, { cluster: null })} /> : null}
      </section>
      <Lower needsYou={data.needsYou} notes={data.notes} />
    </div>
  );
}
