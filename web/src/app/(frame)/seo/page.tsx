import type { SeoPayload } from "@/contract/seo";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { PageHead } from "@/components/shell/PageHead";
import { SpecimenRibbon } from "@/components/seo/bits";
import { ContentGaps } from "@/components/seo/ContentGaps";
import { ConsoleOverview } from "@/components/seo/ConsoleOverview";
import { KeywordOpportunities } from "@/components/seo/KeywordOpportunities";
import { Landing } from "@/components/seo/Landing";
import { Movements } from "@/components/seo/Movements";
import { OpenQuery } from "@/components/seo/OpenQuery";
import { QuickActions } from "@/components/seo/QuickActions";
import { RankingTrend } from "@/components/seo/RankingTrend";
import { SeoTiles } from "@/components/seo/SeoTiles";
import { TechChecks } from "@/components/seo/TechChecks";
import "@/components/seo/seo.css";

export const metadata = { title: "SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** This address with some params changed (undefined removes one). */
function here(q: Record<string, string | string[] | undefined>, change: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    const s = one(v);
    if (s !== undefined && !(k in change)) p.set(k, s);
  }
  for (const [k, v] of Object.entries(change)) if (v !== undefined) p.set(k, v);
  const s = p.toString();
  return s ? `/seo?${s}` : "/seo";
}

/**
 * SEO: the website's search health. One request for the whole screen; every
 * panel is drawn from its own reading, so a panel whose source is not
 * connected keeps its place and says what would connect it.
 */
export default async function SeoPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range);
  const open = one(q.open)?.trim() || undefined;
  const data = await api<SeoPayload>("/api/v1/seo", { range, open, specimen: one(q.specimen) === "1" ? "1" : undefined });
  /* The full lists follow the screen's range, and its specimen when it shows one. */
  const listParams = new URLSearchParams();
  if (data.range !== "30d") listParams.set("range", data.range);
  if (data.specimen) listParams.set("specimen", "1");
  const qs = listParams.size ? `?${listParams}` : "";

  return (
    <>
      {data.specimen ? <SpecimenRibbon realHref={here(q, { specimen: undefined })} /> : null}
      <PageHead eyebrow="SEO" title="SEO" subtitle="Monitor rankings, find opportunities and keep your site ahead." ranges />
      {data.open ? <OpenQuery open={data.open} closeHref={here(q, { open: undefined })} /> : null}
      <SeoTiles data={data} />
      <div className="dk-seo-board">
        <div className="dk-seo-grid">
          <RankingTrend reading={data.ranking} className="dk-seo-panel dk-seo-a-trend" />
          <KeywordOpportunities reading={data.opportunities} qs={qs} className="dk-seo-panel dk-seo-a-kw" />
          <ContentGaps reading={data.gaps} qs={qs} className="dk-seo-panel dk-seo-a-gap" />
          <TechChecks checks={data.checks} className="dk-seo-panel dk-seo-a-tech" />
          <ConsoleOverview reading={data.console} className="dk-seo-panel dk-seo-a-sc" />
          <Movements reading={data.movements} qs={qs} className="dk-seo-panel dk-seo-a-move" />
          <Landing reading={data.landing} qs={qs} className="dk-seo-panel dk-seo-a-land" />
          <QuickActions audit={data.audit} rules={data.scoreRule?.rules ?? null} className="dk-seo-panel dk-seo-a-quick" />
        </div>
      </div>
    </>
  );
}
