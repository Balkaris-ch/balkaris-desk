import type { AssetsPayload } from "@/contract/assets";
import { AssetDetailView } from "@/components/assets/AssetDetail";
import { AssetTable } from "@/components/assets/AssetTable";
import { AssetTile } from "@/components/assets/AssetTile";
import { rescanAssets } from "@/components/assets/actions";
import { backOf, csvHref, viewHref } from "@/components/assets/href";
import { Pager } from "@/components/assets/Pager";
import { Caching, Formats, RemoteImages, SharePictures, WeightByFolder, WeightByKind } from "@/components/assets/Panels";
import { ScanWatch } from "@/components/assets/ScanWatch";
import { ShareTable } from "@/components/assets/ShareTable";
import { Toolbar } from "@/components/assets/Toolbar";
import { PageHead } from "@/components/shell/PageHead";
import { ActionList } from "@/components/ui/ActionList";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Grid } from "@/components/ui/Grid";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tiles } from "@/components/ui/Tile";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import "@/components/assets/assets.css";

export const metadata = { title: "Assets" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** What the Rescan button's answer was, as the screen says it. */
const SAID: Record<string, { tone: "good" | "warn" | "bad" | "info"; text: string }> = {
  running: { tone: "info", text: "A scan was already running when the rescan was asked for, so no second one was started. It has finished since, and this is what it measured." },
  recent: { tone: "warn", text: "The files were measured, or a rescan was asked for, less than ten minutes ago. It can be asked for again ten minutes after that." },
  off: { tone: "warn", text: "The asset job is switched off, or what it reads is not connected. The owner can switch it on in Automations." },
  down: { tone: "bad", text: "The desk server did not answer, so no rescan was asked for. Try again in a moment." },
  failed: { tone: "bad", text: "The desk server refused the rescan. Its log says why." },
};

/**
 * Assets: every file in the website's public/ folder, where the pages use
 * it, and how it stands for search and speed. No board of its own: it is
 * drawn as one more board of the Pages set (tiles, tabs with counts, search
 * and filters, a dense table with thumbnails, a row of panels and quick
 * actions). One request draws it all; the tab, search, filters, page and
 * opened file are the address.
 */
export default async function AssetsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const k of ["tab", "q", "folder", "format", "flag", "sort", "page", "per", "file", "open"]) params[k] = one(sp[k]);
  const data = await api<AssetsPayload>("/api/v1/assets", params);
  const { query: q, site, scan, tiles } = data;

  const scanCode = one(sp.scan);
  const askedAt = Number(one(sp.at));
  /* What the Rescan answered is true for ten minutes: a reloaded or bookmarked address later says nothing. */
  const now = Date.now();
  const fresh = Number.isFinite(askedAt) && askedAt <= now + 60_000 && now - askedAt < 10 * 60_000;
  const asked = fresh && scanCode === "asked";
  const watchSince = asked ? askedAt : scan.running && scan.lastStart ? Date.parse(scan.lastStart) : null;
  /* "running" while it still runs is the watch's to say. */
  const said = fresh && scanCode && scanCode !== "asked" && !(scanCode === "running" && scan.running) ? SAID[scanCode] : undefined;
  const crawled = scan.crawledAt !== null;

  const back = backOf(q);
  /* The tiles' sources, printed once for the row under the button that refreshes them. */
  const rescan = (
    <div className="dk-assets-head-side">
      <form action={rescanAssets}>
        <input type="hidden" name="back" value={back} />
        <Button type="submit" variant="primary" icon="refresh" disabled={scan.running}>
          {scan.running ? "Rescanning…" : "Rescan assets"}
        </Button>
      </form>
      <p className="dk-assets-head-stamps">
        <Stamp reading={tiles.files} />
        <Stamp reading={tiles.notFound} />
      </p>
    </div>
  );

  return (
    <>
      <PageHead eyebrow="Assets" title="Assets" subtitle="Every file in balkaris.ch's public folder: where the pages use it, and how it stands for search and speed." action={rescan} />

      {watchSince !== null ? <ScanWatch since={watchSince} asked={asked} /> : null}
      {said ? (
        <p className={`dk-assets-notice dk-assets-notice--${said.tone}`} role="status">
          <span className="dk-assets-notice-dot" aria-hidden />
          {said.text}
        </p>
      ) : null}

      <Tiles count={6}>
        <AssetTile noStamp label="Files" reading={tiles.files} info="Every file under the website's public/ folder on its main branch, read from the repository." />
        <AssetTile noStamp label="Total weight" reading={tiles.weight} info="The bytes of every file in public/, as stored in the repository. A reader downloads only what the pages they open use." />
        <AssetTile noStamp label="Images" reading={tiles.images} info="Pictures in public/: WebP, AVIF, PNG, JPG, GIF, SVG and icons." />
        <AssetTile noStamp label="Videos" reading={tiles.videos} info="Films in public/: MP4, WebM, MOV." />
        <AssetTile
          noStamp
          label="Missing alt text"
          reading={tiles.missingAlt}
          tones={{ written: "good", empty: "quiet", absent: "bad" }}
          info={
            'Files shown somewhere by an <img> with no alt attribute at all: a screen reader then reads out the file name, every time. An empty alt="" is different: it says "decoration, skip it", is right for decoration, and is counted apart, never as a fault. The bar counts every <img> use of a file in public/.'
          }
        />
        <AssetTile
          noStamp
          label="Not found on any page"
          reading={tiles.notFound}
          tones={{ found: "quiet", "not-found": "warn" }}
          info="Files no page's served HTML names, in tags, preloads, styles or the data Next ships. The crawl runs no scripts, so a file only client code loads (a film set on scroll, a 3D scene) is not seen: this is not proof a file is unused. Files at the root of public/ and README files are fetched by convention and are not counted."
        />
      </Tiles>

      <Toolbar q={q} tabs={data.tabs} filters={data.filters} crawled={crawled} />

      <Card flush className="dk-assets-table-card" footer={<TableFoot data={data} />}>
        {q.tab === "share" ? (
          data.shares && data.shares.state === "ok" ? (
            <ShareTable list={data.shares.value} q={q} />
          ) : data.shares ? (
            <div className="dk-assets-absent">
              <Absent reading={data.shares} />
            </div>
          ) : null
        ) : data.list.state === "ok" ? (
          <AssetTable list={data.list.value} q={q} site={site} crawled={crawled} />
        ) : (
          <div className="dk-assets-absent">
            <Absent reading={data.list} />
          </div>
        )}
      </Card>

      {/* As on the Pages board, the row under the table ends with the quick actions. */}
      <Grid cols="1fr 1fr 1fr 1fr">
        <WeightByKind reading={data.byKind} />
        <WeightByFolder reading={data.byFolder} />
        <Formats reading={data.formats} />
        <Card title="Quick actions" icon="bolt">
          <ActionList
            label="Quick actions"
            items={[
              {
                icon: "refresh",
                label: "Rescan assets",
                description: scan.running ? "Running now" : scan.scannedAt ? `Last measured ${ago(scan.scannedAt)}` : "Measure the files on the branch",
                action: rescanAssets,
                fields: { back },
              },
              { icon: "download", label: "Export CSV", description: q.tab === "share" ? "Each page's share picture" : "All the files this view selects", href: csvHref(q) },
              { icon: "bar-chart", label: "Open the heaviest files", description: "Over the limit for their kind", href: viewHref({ flag: "weight", sort: "heaviest" }) },
            ]}
          />
        </Card>
      </Grid>

      <Grid cols="1fr 1fr 1fr">
        <Caching reading={data.caching} />
        <RemoteImages reading={data.remote} />
        <SharePictures reading={data.sharePictures} />
      </Grid>

      {data.open ? <AssetDetailView reading={data.open} q={q} site={site} crawledAt={scan.crawledAt} /> : null}
    </>
  );
}

/**
 * The table's foot: which rows are showing and where they come from, the
 * pages, and how many a page holds. The files are read from the repository;
 * where each is used, and the share pictures, from the crawl.
 */
function TableFoot({ data }: { data: AssetsPayload }) {
  const q = data.query;
  const crawledAt = data.scan.crawledAt;
  const crawl = crawledAt ? <Stamp source="crawl" asOf={crawledAt} note="Used on and Alt text: from the crawl of every page's served HTML. The crawl runs no scripts, so a file only client code loads is not seen." /> : null;
  if (q.tab === "share") {
    return data.shares && data.shares.state === "ok" ? (
      <Pager total={data.shares.value.total} page={data.shares.value.page} per={data.shares.value.per} q={q} noun={["page", "pages"]} stamps={<Stamp reading={data.shares} />} />
    ) : null;
  }
  return data.list.state === "ok" ? (
    <Pager
      total={data.list.value.total}
      page={data.list.value.page}
      per={data.list.value.per}
      q={q}
      noun={["file", "files"]}
      stamps={
        <>
          <Stamp reading={data.list} />
          {crawl}
        </>
      }
    />
  ) : null;
}
