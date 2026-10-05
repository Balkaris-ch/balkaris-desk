import type { SeoBacklinksPayload } from "@/contract/seo/backlinks";
import { api, ask } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { SeoRefused } from "@/components/seo/nav/Refused";
import { Follow } from "@/components/seo/backlinks/Act";
import { Bing } from "@/components/seo/backlinks/Bing";
import { BlTiles } from "@/components/seo/backlinks/BlTiles";
import { Detail } from "@/components/seo/backlinks/Detail";
import { Nap } from "@/components/seo/backlinks/Nap";
import { NeedsYou } from "@/components/seo/backlinks/NeedsYou";
import { Profiles } from "@/components/seo/backlinks/Profiles";
import { Sites } from "@/components/seo/backlinks/Sites";
import { Tracked } from "@/components/seo/backlinks/Tracked";
import "@/components/seo/backlinks/backlinks.css";

export const metadata = { title: "Backlinks · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * SEO › Backlinks (board 113, panel 6). The head, the period and the tab
 * strip are the SEO layout's (app/(frame)/seo/layout.tsx). One request
 * (GET /api/v1/seo/backlinks) draws the page: the five figures, the sites that
 * link or sent visitors with their filters and pager (?q=, ?from=, ?sort=,
 * ?page=), one site opened (?open=), the pages linked to (Google's export,
 * Bing), the links being followed with the checker, the profiles and
 * listings with the name, address and phone each states, and the owner's
 * steps (?task= opens one). While a job this page started runs, the page
 * follows it and draws itself again.
 *
 * Should the desk not answer for this page (its server code not loaded, a
 * failure), the page says so in place and the head and tabs stay.
 */
export default async function SeoBacklinksPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range, undefined, "30d");
  const params = { range, q: one(q.q), from: one(q.from), sort: one(q.sort), page: one(q.page), open: one(q.open) };

  const got = await ask<SeoBacklinksPayload>("/api/v1/seo/backlinks", params);
  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoBacklinksPayload>("/api/v1/seo/backlinks", params);
    /* A page the owner has not given this person: the server did answer, with a refusal, and the gate says so. */
    if (got.kind === "forbidden") return <SeoRefused message={got.message} />;
    return (
      <Card title="Backlinks" icon="link">
        <Empty icon="alert" title="The desk did not answer for this page">
          {got.message}
        </Empty>
      </Card>
    );
  }
  const data = got.value;
  const task = one(q.task) ?? null;

  return (
    <div className="dk-seo-bl">
      <Follow busy={!!data.presenceJob?.running || !!data.linksJob?.running} />
      <BlTiles tiles={data.tiles} />
      <div className="dk-seo-bl-top">
        <Sites data={data} range={range} />
        <Bing data={data} range={range} />
      </div>
      <Detail data={data} range={range} />
      <Tracked data={data} range={range} />
      <Profiles data={data} range={range} />
      <div className="dk-seo-bl-bottom">
        <Nap data={data} range={range} />
        <NeedsYou tasks={data.needsYou} open={task} truth={data.nap.state === "ok" ? data.nap.value.truth : null} />
      </div>
    </div>
  );
}
