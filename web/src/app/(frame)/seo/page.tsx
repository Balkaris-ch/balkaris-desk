import { redirect } from "next/navigation";
import type { SeoOverviewPayload } from "@/contract/seo/overview";
import { ask, me } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Grid } from "@/components/ui/Grid";
import { SeoRefused } from "@/components/seo/nav/Refused";
import { AiSearch } from "@/components/seo/overview/AiSearch";
import { Automations } from "@/components/seo/overview/Automations";
import { Backlinks } from "@/components/seo/overview/Backlinks";
import { OverviewBar } from "@/components/seo/overview/Bar";
import { Console } from "@/components/seo/overview/Console";
import { Engine } from "@/components/seo/overview/Engine";
import { Gaps } from "@/components/seo/overview/Gaps";
import { keywordHref } from "@/components/seo/overview/href";
import { Keywords } from "@/components/seo/overview/Keywords";
import { Movements } from "@/components/seo/overview/Movements";
import { NeedsYou } from "@/components/seo/overview/NeedsYou";
import { Operator } from "@/components/seo/overview/Operator";
import { Organic } from "@/components/seo/overview/Organic";
import { Priority } from "@/components/seo/overview/Priority";
import { Recent } from "@/components/seo/overview/Recent";
import { Running } from "@/components/seo/overview/Running";
import { Technical } from "@/components/seo/overview/Technical";
import { OverviewTileRow } from "@/components/seo/overview/Tiles";
import { TopPages } from "@/components/seo/overview/TopPages";
import "@/components/seo/overview/overview.css";

export const metadata = { title: "SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The only params the Overview's address carries beside the period: where its Search Console figures are read. */
const PASSED = ["country", "device"] as const;

/**
 * SEO › Overview: everything the SEO tools find and do, on one page (boards
 * 116 and 110 as drawn: the tiles, Priority Opportunities and Content Gap
 * Analysis over Top Performing Pages, Technical SEO and Backlinks, the AI SEO
 * Operator and Recent SEO actions stacked beside both, the Automations strip;
 * then Needs you, Running now and AI search, board 104's keyword and Search
 * Console panels with What moved and From search under them, and what each
 * part of the engine holds). The head and the tabs come from the SEO layout
 * (app/(frame)/seo/layout.tsx); the bar over the tiles looks a keyword up on
 * SEO › Keywords and narrows the Search Console figures to a country or a
 * device (?country=, ?device=).
 *
 * One request draws it (GET /api/v1/seo/overview, contract/seo/overview.ts);
 * each panel is its own reading, so a source that is not connected costs its
 * panel and says what connects it. Running now keeps itself current in the
 * browser; the buttons queue operator tasks (answered by the studio
 * workstation's own model), run a job, or mark a person's step, and nothing
 * changes the live website without a person's approval. What the person may
 * press comes with the page (`can`), so no button is drawn that the server
 * would refuse.
 *
 * Two old addresses still arrive here. The top bar's keyword hits lead to
 * /seo?open=<query>: that phrase opens on SEO › Keywords, filtered to it,
 * where the desk shows what it knows of a phrase. The workstation's specimen
 * (/seo?specimen=1) belongs to the earlier SEO screen, now at /seo/legacy,
 * and is sent on there with the rest of its address.
 */
export default async function SeoOverviewPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  if (q.specimen !== undefined) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) for (const s of Array.isArray(v) ? v : v === undefined ? [] : [v]) p.append(k, s);
    redirect(`/seo/legacy?${p}`);
  }
  const range = parseRange(q.range);
  const opened = one(q.open)?.trim();
  if (opened) redirect(keywordHref(opened.slice(0, 120), range));

  const params: Record<string, string | undefined> = { range };
  for (const k of PASSED) params[k] = one(q[k]);
  const [answer, who] = await Promise.all([ask<SeoOverviewPayload>("/api/v1/seo/overview", params), me()]);

  if (!answer.ok) {
    if (answer.kind === "signed-out") redirect("/auth/google");
    /* A page the owner has not given this person: the server did answer, with a refusal, and the gate says so. */
    if (answer.kind === "forbidden") return <SeoRefused message={answer.message} />;
    return (
      <Card title="Overview" icon="grid">
        <Empty icon="alert" title="The Overview could not be read">
          {answer.kind === "missing" ? "This desk has no SEO Overview address yet: its server code is not mounted." : answer.message} The other SEO pages are in the tabs above.
        </Empty>
      </Card>
    );
  }

  const d = answer.value;
  /* A desk that answers without `can` (older server code) is read as before: everything offered, the server still decides. */
  const can = d.can ?? { operate: true, ownerSteps: who.owner, run: [] };
  return (
    <div className="dk-seo-overview">
      {d.asked ? <OverviewBar asked={d.asked} range={range} /> : null}
      <OverviewTileRow tiles={d.tiles} range={range} />
      {/* The boards' block: the work and the site's state on the left in two rows, the operator and
          the log stacked on the right beside both (overview.css, "the boards' main block"). */}
      <div className="dk-seo-overview-main">
        <div className="dk-seo-overview-left">
          <div className="dk-seo-overview-row dk-seo-overview-row--work">
            <Priority reading={d.priority} curve={d.curve} range={range} operate={can.operate} />
            <Gaps reading={d.contentGaps} range={range} operate={can.operate} />
          </div>
          <div className="dk-seo-overview-row dk-seo-overview-row--site">
            <TopPages reading={d.topPages} range={range} />
            <Technical reading={d.technical} range={range} operate={can.operate} />
            <Backlinks reading={d.presence} range={range} />
          </div>
        </div>
        <div className="dk-seo-overview-side">
          <Operator panel={d.operator} operate={can.operate} />
          <Recent items={d.recent} at={d.head.at} range={range} />
        </div>
      </div>
      <Automations jobs={d.automations} owner={who.owner} run={can.run} range={range} />
      {/* What the boards do not draw and the owner asked for: his steps, what runs now, the AI baseline. */}
      <Grid cols="1.62fr 1.04fr 0.84fr">
        <NeedsYou reading={d.needsYou} ownerSteps={can.ownerSteps} />
        <Running initial={d.running} />
        <AiSearch reading={d.aiSearch} range={range} />
      </Grid>
      <Grid cols="1.4fr 1fr">
        <Keywords reading={d.keywords} range={range} operate={can.operate} />
        <Console reading={d.searchConsole} range={range} />
      </Grid>
      {d.movements || d.organic ? (
        <Grid cols="1.4fr 1fr">
          {d.movements ? <Movements reading={d.movements} range={range} /> : null}
          {d.organic ? <Organic reading={d.organic} /> : null}
        </Grid>
      ) : null}
      <Engine parts={d.engine} range={range} />
    </div>
  );
}
