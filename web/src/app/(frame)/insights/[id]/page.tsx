import { cache } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ArticlePayload } from "@/contract/article";
import type { Reading, Stat } from "@/contract/common";
import { ask, DeskError } from "@/lib/api";
import { ago, num, parseRange } from "@/lib/format";
import { PageHead } from "@/components/shell/PageHead";
import { Spark } from "@/components/charts/Spark";
import { Tile, Tiles } from "@/components/ui/Tile";
import { ArticleCard } from "@/components/article/ArticleCard";
import { Done } from "@/components/article/Done";
import { countedOver, HistoryPanel, ListingPanel, SitePanel, SourcePanel, TrafficPanel, VideoPanel, WorkPanel, WritingPanel } from "@/components/article/panels";
import { Siblings } from "@/components/article/Siblings";
import { kindName, platformName } from "@/components/article/parts";
import "@/components/article/article.css";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The one request this page makes, shared by the metadata and the page. A missing draft is the frame's 404. */
const load = cache(async (id: string, range: string): Promise<ArticlePayload> => {
  if (!/^\d{1,9}$/.test(id)) notFound();
  const a = await ask<ArticlePayload>(`/api/v1/article/${id}`, { range });
  if (a.ok) return a.value;
  if (a.kind === "missing") notFound();
  if (a.kind === "signed-out") redirect("/auth/google");
  throw new DeskError(a.kind, a.status, a.message);
});

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const p = await load(id, parseRange(sp.range));
  return { title: p.article.title };
}

/**
 * One article: the old console's draft page (src/console.ts `draftPage`) in
 * the new frame, in the Insights board's language. The article as it will
 * read, where it lives on the site and the four things that move it there,
 * its readers, the search listing, where it came from, how it was written,
 * the workstation's jobs and its whole history.
 *
 * Every action is a plain form posting to the old console's own handler,
 * which keeps its checks, and lands back here (the `back` field, which
 * src/server.ts honours only under /insights/). No JavaScript is needed for
 * any of them.
 */
export default async function ArticlePage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const range = parseRange(sp.range);
  const p = await load(id, range);

  const counted = p.site.state === "unlisted" || p.site.state === "listed" || p.site.liveSince !== null;
  const back = (done: string): string => `/insights/${p.draftId}?${range !== "30d" ? `range=${range}&` : ""}done=${done}`;
  const s = p.source;
  /* "a video by @bbcnews on TikTok"; "an article on Wikipedia, by …". */
  const written =
    s.kind === "article"
      ? `an article${s.site ? ` on ${s.site}` : ""}${s.author ? `, by ${s.author}` : ""}`
      : `a ${kindName(s.kind).toLowerCase()}${s.author ? ` by @${s.author}${s.platform ? ` on ${platformName(s.platform)}` : ""}` : s.site ? ` from ${s.site}` : ""}`;

  return (
    <>
      <PageHead
        eyebrow="Insights · Article"
        title={p.article.title}
        subtitle={`Written from ${written}; ${s.sharedBy ? `shared by ${s.sharedBy} ${ago(s.sharedAt)}` : `shared ${ago(s.sharedAt)}, by somebody the desk did not record`}.`}
        ranges={counted ? true : undefined}
      />

      <Done done={one(sp.done)} history={p.history} />

      <Tiles count={4}>
        {/* No figure here has an earlier period to compare with, so no change line ("none"). */}
        <Tile label="Views" icon="eye" delta="none" reading={views(p)} chart={(st) => <Spark data={st.series} label="Views per day" />} info="Times the article's page was viewed on balkaris.ch, by people who accepted the cookie banner." />
        <Tile label="People" icon="users" tone="info" delta="none" reading={people(p)} info="People who viewed it at least once in the period, each counted once." />
        <Tile label="Time on page" icon="clock" tone="violet" delta="none" reading={time(p)} info="Engaged seconds per view: the time the page was in the foreground, added up over every view (GA4 userEngagementDuration), divided by the views." />
        <Tile label="The source's views" icon="play" tone="warn" delta="none" reading={sourceViews(p)} info="The view count the platform showed when the desk read the post. It is the post's, not the article's." />
      </Tiles>

      <div className="dk-article">
        <div className="dk-article-layout">
          <div className="dk-article-main dk-article-stack">
            <ArticleCard p={p} back={back} />
            <HistoryPanel history={p.history} className="dk-article-last" />
          </div>
          <div className="dk-article-side">
            <SitePanel p={p} back={back} />
            <TrafficPanel p={p} />
          </div>
          <div className="dk-article-rest">
            <ListingPanel meta={p.meta} slug={p.article.slug} excerpt={p.article.excerpt} />
            <SourcePanel source={p.source} />
            <WritingPanel p={p} />
            <VideoPanel p={p} back={back} />
            <WorkPanel work={p.work} />
            <Siblings siblings={p.siblings} />
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- the four tiles, from the readings the server sent -------------------- */

/** The period a figure covers, said under it. */
const covers = (p: ArticlePayload): string => (p.traffic.state === "ok" ? countedOver(p.traffic.value, p.range) : "");

/** A Stat built from the traffic reading, or the traffic reading's own absence. */
function fromTraffic(p: ArticlePayload, make: (t: Extract<ArticlePayload["traffic"], { state: "ok" }>["value"]) => Stat | Reading<Stat>): Reading<Stat> {
  const t = p.traffic;
  if (t.state !== "ok") return t;
  const made = make(t.value);
  if ("state" in made) return made;
  return { state: "ok", value: made, source: t.source, asOf: t.asOf, ...(t.note ? { note: t.note } : {}) };
}

function views(p: ArticlePayload): Reading<Stat> {
  return fromTraffic(p, (t) => ({ value: t.views, previous: null, unit: "count", series: t.days.map((d) => d.value), sub: covers(p) }));
}

function people(p: ArticlePayload): Reading<Stat> {
  return fromTraffic(p, (t) => ({ value: t.people, previous: null, unit: "count", series: [], sub: covers(p) }));
}

function time(p: ArticlePayload): Reading<Stat> {
  return fromTraffic(p, (t) => {
    if (t.views === 0) return { state: "waiting", source: "ga4", reason: "Nobody viewed it in this period, so there is no time per view." };
    const per = t.engagementSeconds / t.views;
    /* Fewer than thirty views: the average is said with the two counts it comes from. */
    const sub = t.views < 30 ? `${num(t.engagementSeconds)}s engaged over ${num(t.views)} ${t.views === 1 ? "view" : "views"}` : "engaged, per view";
    return { value: Math.round(per * 10) / 10, previous: null, unit: "s", series: [], sub };
  });
}

function sourceViews(p: ArticlePayload): Reading<Stat> {
  const f = p.source.figures;
  if (!f) return { state: "off", source: "none", reason: "An article on a website shows no view count. Only a social post carries one." };
  if (f.state !== "ok") return f;
  if (f.value.views === null) {
    return { state: "off", source: "desk", reason: `${platformName(p.source.platform) ?? "The platform"} does not publish a view count for this kind of post.` };
  }
  return {
    state: "ok",
    value: { value: f.value.views, previous: null, unit: "count", series: [], sub: `on ${platformName(p.source.platform) ?? "the platform"}, when the desk read it` },
    source: f.source,
    asOf: f.asOf,
    ...(f.note ? { note: f.note } : {}),
  };
}
