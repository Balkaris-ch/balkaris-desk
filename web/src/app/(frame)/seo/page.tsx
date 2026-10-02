import { redirect } from "next/navigation";
import type { SeoOverviewPayload } from "@/contract/seo/overview";
import { ask, me } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Grid } from "@/components/ui/Grid";
import { AiSearch } from "@/components/seo/overview/AiSearch";
import { Automations } from "@/components/seo/overview/Automations";
import { Backlinks } from "@/components/seo/overview/Backlinks";
import { Console } from "@/components/seo/overview/Console";
import { Engine } from "@/components/seo/overview/Engine";
import { Gaps } from "@/components/seo/overview/Gaps";
import { Keywords } from "@/components/seo/overview/Keywords";
import { NeedsYou } from "@/components/seo/overview/NeedsYou";
import { Operator } from "@/components/seo/overview/Operator";
import { Priority } from "@/components/seo/overview/Priority";
import { Recent } from "@/components/seo/overview/Recent";
import { Running } from "@/components/seo/overview/Running";
import { Technical } from "@/components/seo/overview/Technical";
import { OverviewTileRow } from "@/components/seo/overview/Tiles";
import { TopPages } from "@/components/seo/overview/TopPages";
import "@/components/seo/overview/overview.css";

export const metadata = { title: "SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * SEO › Overview: everything the SEO tools find and do, on one page (boards
 * 116 and 110 as drawn: the tiles, Priority Opportunities and Content Gap
 * Analysis over Top Performing Pages, Technical SEO and Backlinks, the AI SEO
 * Operator and Recent SEO actions stacked beside both, the Automations strip;
 * then Needs you, Running now and AI search, board 104's keyword and Search
 * Console panels, and what each part of the engine holds). The head and the
 * tabs come from the SEO layout (app/(frame)/seo/layout.tsx).
 *
 * One request draws it (GET /api/v1/seo/overview, contract/seo/overview.ts);
 * each panel is its own reading, so a source that is not connected costs its
 * panel and says what connects it. Running now keeps itself current in the
 * browser; the buttons queue operator tasks or mark a person's step, and
 * nothing changes the live website without a person's approval.
 *
 * The top bar's keyword hits lead to /seo?open=<query>, and the workstation's
 * specimen to /seo?specimen=1: both belong to the earlier SEO screen, now at
 * /seo/legacy, and are sent on to it with the rest of their address until
 * those links point elsewhere (src/cc/search/index.ts, `keyword`).
 */
export default async function SeoOverviewPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  if (q.open !== undefined || q.specimen !== undefined) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) for (const s of Array.isArray(v) ? v : v === undefined ? [] : [v]) p.append(k, s);
    redirect(`/seo/legacy?${p}`);
  }
  const range = parseRange(q.range);
  const [answer, who] = await Promise.all([ask<SeoOverviewPayload>("/api/v1/seo/overview", { range }), me()]);

  if (!answer.ok) {
    if (answer.kind === "signed-out") redirect("/auth/google");
    return (
      <Card title="Overview" icon="grid">
        <Empty icon="alert" title="The Overview could not be read">
          {answer.kind === "missing" ? "This desk has no SEO Overview address yet: its server code is not mounted." : answer.message} The other SEO pages are in the tabs above.
        </Empty>
      </Card>
    );
  }

  const d = answer.value;
  return (
    <div className="dk-seo-overview">
      <OverviewTileRow tiles={d.tiles} />
      {/* The boards' block: the work and the site's state on the left in two rows, the operator and
          the log stacked on the right beside both (overview.css, "the boards' main block"). */}
      <div className="dk-seo-overview-main">
        <div className="dk-seo-overview-left">
          <div className="dk-seo-overview-row dk-seo-overview-row--work">
            <Priority reading={d.priority} curve={d.curve} />
            <Gaps reading={d.contentGaps} />
          </div>
          <div className="dk-seo-overview-row dk-seo-overview-row--site">
            <TopPages reading={d.topPages} />
            <Technical reading={d.technical} />
            <Backlinks reading={d.presence} />
          </div>
        </div>
        <div className="dk-seo-overview-side">
          <Operator panel={d.operator} />
          <Recent items={d.recent} at={d.head.at} />
        </div>
      </div>
      <Automations jobs={d.automations} owner={who.owner} />
      {/* What the boards do not draw and the owner asked for: his steps, what runs now, the AI baseline. */}
      <Grid cols="1.62fr 1.04fr 0.84fr">
        <NeedsYou reading={d.needsYou} />
        <Running initial={d.running} />
        <AiSearch reading={d.aiSearch} />
      </Grid>
      <Grid cols="1.4fr 1fr">
        <Keywords reading={d.keywords} />
        <Console reading={d.searchConsole} />
      </Grid>
      <Engine parts={d.engine} />
    </div>
  );
}
