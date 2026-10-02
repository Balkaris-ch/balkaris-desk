import type { Range, Reading } from "@/contract/common";
import type { MetadataPanel, PageActivityItem, PagesPayload, PagesTiles, RouteHealthPanel } from "@/contract/pages";
import { Donut, Legend, Spark } from "@/components/charts";
import { ActionList, type ActionItem } from "@/components/ui/ActionList";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardFoot } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Icon } from "@/components/ui/icons";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Go } from "@/components/ui/Go";
import { cx } from "@/lib/cx";
import { ago, feedTime, num } from "@/lib/format";
import { runCrawl } from "./actions";
import "@/components/ui/tone.css";
import "./pages.css";

/* ---------- the six tiles ---------------------------------------------------- */

/*
 * Five of the six figures are counts of what the last crawl found, with no
 * earlier count kept to compare with, so they carry no change at all (a lone
 * dash under each would only say so six times). Total pages has the crawl's
 * daily count: its change appears once that history reaches the start of the
 * range.
 */
export function PagesTileRow({ tiles }: { tiles: PagesTiles }) {
  const totalChanges = tiles.total.state === "ok" && tiles.total.value.previous !== null;
  return (
    <Tiles count={6}>
      <Tile
        label="Total pages"
        reading={tiles.total}
        delta={totalChanges ? "under" : "none"}
        info="Every page the desk's crawl reads: the addresses in the sitemap and the page files the website keeps out of it. The line is the crawl's own daily count since its first day; the change against the start of the range appears once the count reaches back that far."
        chart={(s) => <Spark data={s.series} />}
      />
      <Tile label="Missing metadata" reading={tiles.missingMeta} delta="none" info="Sitemap pages with no title or no description, or with one longer than the limit (60 characters for a title, 160 for a description). The desk's crawl, read once a day." />
      <Tile label="Missing schema" reading={tiles.missingSchema} delta="none" info="Sitemap pages that carry no structured data (JSON-LD) at all. The desk's crawl." />
      <Tile label="Orphan pages" reading={tiles.orphans} delta="none" info="Sitemap pages that no other page links to, the home page aside: a reader following the site cannot reach them. The desk's crawl." />
      <Tile
        label="Top performers"
        reading={tiles.topPerformers}
        delta="none"
        info="Pages whose visitors in the range are above the median per page (a page with none counts as 0) and higher than in the period before. GA4, consenting visitors only. Absent while the period before was not measured whole."
      />
      <Tile label="Drafts" reading={tiles.drafts} delta="none" info="Pages that exist and answer but are kept out of search: they say noindex, or they are articles not listed yet. From the crawl and the website's repository." />
    </Tiles>
  );
}

/* ---------- Route health -------------------------------------------------------- */

const showHref = (range: Range, show: string) => `/pages?${new URLSearchParams({ ...(range !== "30d" ? { range } : {}), show }).toString()}#dk-pages-table`;

/** Where the SEO report lists every redirect rule that does not work, with what happened. */
const RULES_HREF = "/seo/report#redirects";

export function RouteHealthCard({ reading, range }: { reading: Reading<RouteHealthPanel>; range: Range }) {
  /* "View route issues" opens the table's list of pages that redirect or fail.
     A redirect rule is not a page, so when the issues are rules (a broken one,
     or every redirect counted comes from the rules) it opens the SEO report's
     Redirects, where each rule is listed with what it answered. */
  const h = reading.state === "ok" ? reading.value : null;
  const toRules = h !== null && (h.brokenRules > 0 || h.routePages === 0);
  return (
    <Card
      title="Route health"
      icon="heart-pulse"
      right={<LinkButton href="/site-health" size="sm">View all</LinkButton>}
      footer={<CardFoot href={toRules ? RULES_HREF : showHref(range, "route")}>View route issues</CardFoot>}
      info="How every page the crawl read and every redirect rule the site promises answered at the last crawl. A redirect is not an error, but it is not a page either: the ring is the share that answers 200. A broken redirect is a rule that does not redirect, lands somewhere it does not promise, or lands on a page that does not answer 200. View route issues opens the pages that redirect or fail, or, when the issues are redirect rules, the SEO report's list of them."
    >
      <Read reading={reading}>
        {(h, r) => {
          const slices = [
            { key: "healthy", label: "Healthy", value: h.healthy, color: "green" as const },
            { key: "redirects", label: "Redirects", value: h.redirects, color: "amber" as const },
            { key: "broken", label: "Broken redirects", value: h.brokenRules, color: "red" as const },
            { key: "client", label: "Client errors", value: h.clientErrors, color: "pink" as const },
            { key: "server", label: h.unanswered ? "Server errors, no answer" : "Server errors", value: h.serverErrors + h.unanswered, color: "violet" as const },
          ];
          const share = h.total ? Math.round((h.healthy / h.total) * 100) : null;
          return (
            <div className="dk-pages-health">
              <Donut size="small" weight="thin" slices={slices} label="Routes by how they answered" figure={share === null ? "—" : `${share}%`} caption="Healthy" captionTone="good" />
              <div className="dk-pages-health-side">
                <Legend layout="column" items={slices.map((s) => ({ label: s.label, color: s.color, share: num(s.value) }))} />
                <Stamp reading={r} />
              </div>
            </div>
          );
        }}
      </Read>
    </Card>
  );
}

/* ---------- Metadata status ------------------------------------------------------ */

export function MetadataCard({ reading, range }: { reading: Reading<MetadataPanel>; range: Range }) {
  return (
    <Card
      title="Metadata status"
      icon="file-text"
      right={<LinkButton href="/seo" size="sm">View all</LinkButton>}
      footer={<CardFoot href={showHref(range, "metadata")}>View metadata issues</CardFoot>}
      info="The sitemap's pages by what their head is missing, from the desk's crawl. Complete: a title and a description within the limits (60 and 160 characters), a share picture of their own and structured data. A title or description over the limit is cut in results, so it is counted beside the missing ones. Missing OG image: still on the site's default share picture, or with none."
    >
      <Read reading={reading}>
        {(m, r) => (
          <>
            <ul className="dk-pages-list">
              <li>
                <span className="dk-pages-mark dk-pages-mark--ok" aria-hidden>
                  <Icon name="check-circle" size={14} />
                </span>
                <span>Complete</span>
                <b className="dk-num">{num(m.complete)}</b>
              </li>
              {(
                [
                  ["Missing or long title", m.missingTitle + m.longTitle, `${num(m.missingTitle)} missing, ${num(m.longTitle)} longer than 60 characters`],
                  ["Missing or long description", m.missingDescription + m.longDescription, `${num(m.missingDescription)} missing, ${num(m.longDescription)} longer than 160 characters`],
                  ["Missing OG image", m.missingPicture, "On the site's default share picture, or with none"],
                  ["Missing schema", m.missingSchema, "No structured data at all"],
                ] as const
              ).map(([label, n, split]) => (
                <li key={label} title={split}>
                  <span className={cx("dk-pages-mark", n > 0 ? "dk-tone-bad" : "dk-pages-mark--none")} aria-hidden />
                  <span>{label}</span>
                  <b className="dk-num">{num(n)}</b>
                </li>
              ))}
            </ul>
            <p className="dk-pages-stamp-line">
              <Stamp reading={r} />
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

/* ---------- Recent page activity ------------------------------------------------- */

export function ActivityCard({ reading }: { reading: Reading<PageActivityItem[]> }) {
  const now = new Date();
  return (
    <Card
      title="Recent page activity"
      icon="pulse"
      right={<LinkButton href="/activity" size="sm">View all</LinkButton>}
      info="Commits to the website mapped to the pages whose own files they changed, articles published, and what the desk's crawl saw change between two crawls. The name is the commit's author."
    >
      <Read reading={reading}>
        {(items, r) =>
          items.length ? (
            <>
              <ol className="dk-pages-feed" aria-label="Recent page activity">
                {items.slice(0, 5).map((a) => {
                  const inner = (
                    <>
                      <span className="dk-pages-feed-node" aria-hidden />
                      <time className="dk-pages-feed-time dk-num" dateTime={a.at} suppressHydrationWarning>
                        {feedTime(a.at, now)}
                      </time>
                      <span className={cx("dk-pages-feed-dot", `dk-tone-${a.tone}`)} aria-hidden>
                        <Icon name="check" size={9} />
                      </span>
                      <span className="dk-pages-feed-body">
                        <span className="dk-pages-feed-text" title={a.detail ?? undefined}>
                          {a.text}
                        </span>
                        <span className="dk-pages-feed-by">{a.who ? `by ${a.who}` : "seen by the desk's crawl"}</span>
                      </span>
                    </>
                  );
                  return (
                    <li key={a.id}>
                      {a.path ? (
                        <Go href={`/pages/view?path=${encodeURIComponent(a.path)}`} className="dk-pages-feed-row">
                          {inner}
                        </Go>
                      ) : (
                        <div className="dk-pages-feed-row">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
              <p className="dk-pages-stamp-line">
                <Stamp reading={r} />
              </p>
            </>
          ) : (
            <Empty compact icon="clock" title="Nothing yet">
              No commit has changed a page&apos;s own files and no crawl has seen a page change.
            </Empty>
          )
        }
      </Read>
    </Card>
  );
}

/* ---------- Quick actions --------------------------------------------------------- */

export function QuickActionsCard({ range, crawl, said, back }: { range: Range; crawl: PagesPayload["crawl"]; said: { text: string; good: boolean } | null; back: string }) {
  const items: ActionItem[] = [
    { icon: "edit", label: "Edit metadata in bulk", href: "/operator?do=metadata" },
    { icon: "image", label: "Pages on the default share picture", href: showHref(range, "picture") },
  ];
  if (crawl.ready) {
    items.push({ icon: "link", label: crawl.running ? "Scan for orphan pages (the crawl is running)" : "Scan for orphan pages", action: runCrawl, fields: { back } });
  }
  items.push({ icon: "download", label: "Export pages (CSV)", href: `/api/v1/pages/export.csv?range=${range}` });
  return (
    <Card title="Quick actions" icon="bolt" id="dk-pages-actions" info="Scan for orphan pages runs the desk's crawl now: every page read again and every link counted. It reads the website with GET requests only.">
      <ActionList label="Quick actions" items={items} />
      {said ? (
        <p className={cx("dk-pages-said", !said.good && "dk-pages-said--bad")} role="status">
          {said.text}
        </p>
      ) : crawl.lastEnd ? (
        <p className="dk-pages-stamp-line">
          <span className="dk-stamp" suppressHydrationWarning>
            Last crawl finished {ago(crawl.lastEnd)}
          </span>
        </p>
      ) : null}
    </Card>
  );
}
