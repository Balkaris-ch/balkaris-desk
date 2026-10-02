import type { CachingSummary, FolderWeight, FormatSummary, KindWeight, RemoteSummary, ShareSummary } from "@/contract/assets";
import type { Reading } from "@/contract/common";
import { BarList, Donut, Legend, shareTexts, type ChartColor } from "@/components/charts";
import { Card, CardFoot } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { flagHref, pageHref, viewHref } from "./href";
import { plural, weight } from "./weight";

const KIND_COLOR: Record<KindWeight["key"], ChartColor> = { image: "s1", video: "s2", font: "s3", other: "s4" };
const KIND_TAB = { image: "images", video: "video", font: "other", other: "other" } as const;

/** The stamp at the foot of a panel: source and age, the caveat on hover. */
function Foot({ reading }: { reading: Reading<unknown> }) {
  return reading.state === "ok" ? (
    <p className="dk-assets-panel-stamp">
      <Stamp reading={reading} />
    </p>
  ) : null;
}

/** Weight by kind: images, video, fonts, other, as a donut. */
export function WeightByKind({ reading }: { reading: Reading<KindWeight[]> }) {
  const top = reading.state === "ok" ? [...reading.value].sort((a, b) => b.bytes - a.bytes)[0] : undefined;
  return (
    <Card
      title="Weight by kind"
      icon="pie"
      info="Bytes of every file in public/, by kind. Fonts counts font files in public/ only; a font the site's build bundles is not in public/ and is not counted here."
      footer={top && top.bytes > 0 ? <CardFoot href={viewHref({ tab: KIND_TAB[top.key] })}>Open the {top.label.toLowerCase()} files, heaviest first</CardFoot> : undefined}
    >
      <Read reading={reading}>
        {(kinds) => {
          const total = kinds.reduce((s, k) => s + k.bytes, 0);
          const shares = shareTexts(kinds.map((k) => k.bytes));
          return (
            <>
              <div className="dk-assets-donut">
                <Donut
                  label="Weight by kind"
                  size="small"
                  slices={kinds.map((k) => ({ key: k.key, label: k.label, value: total ? (k.bytes / total) * 100 : 0, color: KIND_COLOR[k.key] }))}
                  unit="percent"
                  figure={total >= 10_000_000 ? `${Math.round(total / 1_000_000)} MB` : weight(total)}
                  caption="in public/"
                />
                <Legend
                  layout="column"
                  items={kinds.map((k, i) => ({
                    label: k.label,
                    color: KIND_COLOR[k.key],
                    share: shares[i],
                    value: weight(k.bytes),
                    href: k.files ? viewHref({ tab: KIND_TAB[k.key] }) : undefined,
                  }))}
                />
              </div>
              {kinds.find((k) => k.key === "other" && k.detail) ? <p className="dk-assets-panel-note">Other: {kinds.find((k) => k.key === "other")?.detail}.</p> : null}
              <Foot reading={reading} />
            </>
          );
        }}
      </Read>
    </Card>
  );
}

/** Weight by folder: the top-level folders of public/, heaviest first. */
export function WeightByFolder({ reading }: { reading: Reading<FolderWeight[]> }) {
  const SHOW = 5;
  return (
    <Card title="Weight by folder" icon="layers" info="Bytes of the files in each top-level folder of public/. A row opens that folder's files.">
      <Read reading={reading}>
        {(folders) => {
          const rest = folders.slice(SHOW);
          return (
            <>
              <BarList
                label="Weight by folder"
                tone="s2"
                items={folders.slice(0, SHOW).map((f) => ({ key: f.folder || "(root)", label: f.label, value: f.bytes, text: weight(f.bytes), second: plural(f.files, "file"), href: viewHref({ folder: f.folder || "(root)" }) }))}
                emptyNote="There are no files in public/."
              />
              {rest.length ? (
                <p className="dk-assets-panel-note">
                  And {plural(rest.length, "more folder")}, {weight(rest.reduce((s, f) => s + f.bytes, 0))} together: the Filters list every folder.
                </p>
              ) : null}
              <Foot reading={reading} />
            </>
          );
        }}
      </Read>
    </Card>
  );
}

/** Formats: how many of each, and which PNG and JPG files could be WebP or AVIF. */
export function Formats({ reading }: { reading: Reading<FormatSummary> }) {
  const n = reading.state === "ok" ? reading.value.toReaders.files : 0;
  return (
    <Card
      title="Formats"
      icon="image"
      info="Files by format. A PNG, JPG or GIF that readers' browsers load as it is could be WebP or AVIF, which carry the same picture in fewer bytes. How many fewer is not measured: the desk has not re-encoded them."
      /* The pictures whose format check fails are exactly the PNG/JPG/GIF sent to readers as they are: the same files as the count. */
      footer={n ? <CardFoot href={viewHref({ tab: "images", flag: "format" })}>Show the {plural(n, "file")} to convert</CardFoot> : undefined}
    >
      <Read reading={reading}>
        {(f) => (
          <>
            <BarList label="Files by format" tone="s1" items={f.formats.slice(0, 4).map((x) => ({ key: x.ext, label: x.label, value: x.files, text: num(x.files), second: weight(x.bytes), href: viewHref({ format: x.ext }) }))} emptyNote="No pictures, films or fonts in public/." />
            <ul className="dk-assets-facts">
              <li className={cx("dk-assets-fact", f.toReaders.files ? "dk-assets-fact--bad" : "dk-assets-fact--good")}>
                <span className="dk-assets-fact-dot" aria-hidden />
                <span className="dk-assets-fact-text">{f.toReaders.files ? "PNG/JPG sent to readers as is" : "No PNG/JPG sent to readers as is"}</span>
                <span className="dk-assets-fact-figure dk-num">{f.toReaders.files ? `${num(f.toReaders.files)} · ${weight(f.toReaders.bytes)}` : "0"}</span>
              </li>
              {f.elsewhere.files ? (
                <li className="dk-assets-fact dk-assets-fact--quiet">
                  <Tooltip text="Share pictures (networks fetch them, readers' browsers do not), sources the site's optimiser re-encodes for each browser, and files not found on a page. None of these is flagged.">
                    <span className="dk-assets-fact-text" tabIndex={0}>
                      Other PNG/JPG, not flagged
                    </span>
                  </Tooltip>
                  <span className="dk-assets-fact-figure dk-num">
                    {num(f.elsewhere.files)} · {weight(f.elsewhere.bytes)}
                  </span>
                </li>
              ) : null}
            </ul>
            <Foot reading={reading} />
          </>
        )}
      </Read>
    </Card>
  );
}

/** Caching: the folders served without a browser cache, from one file asked per folder. */
export function Caching({ reading }: { reading: Reading<CachingSummary> }) {
  const n = reading.state === "ok" ? reading.value.uncachedLoaded : 0;
  return (
    <Card
      title="Caching"
      icon="clock"
      info="The site sets Cache-Control by folder, so one file per folder was asked for its headers at the last scan. A folder answering max-age=0 makes every visit ask for its files again. A row opens the files readers' browsers load from that folder."
      footer={n ? <CardFoot href={flagHref("cache")}>Show the {plural(n, "file")} readers load uncached</CardFoot> : undefined}
    >
      <Read reading={reading}>
        {(c) => {
          const bad = c.folders.filter((f) => f.cacheControl !== null && f.maxAge === 0);
          const headers = [...new Set(bad.map((f) => f.cacheControl))];
          return (
            <>
              <p className="dk-assets-panel-lead">
                <b className={cx("dk-num", c.uncached ? "dk-assets-bad" : "dk-assets-good")}>
                  {num(c.uncached)} of {num(c.checked)}
                </b>{" "}
                folders answer without a browser cache
              </p>
              {bad.length ? (
                <ul className="dk-assets-rows">
                  {bad.slice(0, 4).map((f) => (
                    <li key={f.folder}>
                      <Go href={f.loaded ? viewHref({ folder: f.folder, flag: "cache" }) : viewHref({ folder: f.folder })} className="dk-assets-row">
                        <span className="dk-assets-row-label dk-assets-mono">/{f.folder}/</span>
                        <span className="dk-assets-row-sub">{f.loaded ? `${num(f.loaded)} of ${num(f.files)} loaded by readers` : `${plural(f.files, "file")}, none loaded`}</span>
                        <span className="dk-assets-row-figure dk-num">{weight(f.bytes)}</span>
                      </Go>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dk-assets-panel-note">Every folder asked answers with a max-age above 0.</p>
              )}
              {bad.length > 4 ? <p className="dk-assets-panel-note">And {plural(bad.length - 4, "more folder")}.</p> : null}
              {headers.length === 1 && headers[0] ? (
                <p className="dk-assets-panel-note dk-assets-cut" title={`Cache-Control: ${headers[0]}`}>
                  {bad.length === 1 ? "It answers" : `All ${bad.length} answer`} <span className="dk-assets-mono">{headers[0]}</span>
                </p>
              ) : null}
              <Foot reading={reading} />
            </>
          );
        }}
      </Read>
    </Card>
  );
}

/** Pictures the pages load from other hosts, by host and by page. */
export function RemoteImages({ reading }: { reading: Reading<RemoteSummary> }) {
  const SHOW = 4;
  return (
    <Card title="Images from other hosts" icon="globe" info="Pictures in <img> tags whose address is on another host: outside the repository, and somebody else's to move or take down. A row opens the page on the Pages screen.">
      <Read reading={reading}>
        {(r) =>
          !r.pictures ? (
            <>
              <Empty compact icon="globe" title="None">
                Every picture the pages show is a file of the site's own.
              </Empty>
              <Foot reading={reading} />
            </>
          ) : (
            <>
              <p className="dk-assets-panel-lead">
                <b className="dk-num">{num(r.pictures)}</b> {r.pictures === 1 ? "picture" : "pictures"} from {plural(r.hosts.length, "host")}, on {plural(r.pages.length, "page")}
              </p>
              <ul className="dk-assets-hosts">
                {r.hosts.slice(0, 3).map((h) => (
                  <li key={h.host}>
                    <span className="dk-assets-mono dk-assets-cut">{h.host}</span>
                    <span className="dk-assets-row-sub">
                      {plural(h.uses, "use")}
                      {h.optimised === h.pictures ? ", all through the site's optimiser" : h.optimised ? `, ${num(h.optimised)} through the optimiser` : ", loaded by readers from that host"}
                    </span>
                  </li>
                ))}
              </ul>
              <ul className="dk-assets-rows">
                {r.pages.slice(0, SHOW).map((p) => (
                  <li key={p.page}>
                    <Go href={pageHref(p.page)} className="dk-assets-row">
                      <span className="dk-assets-row-label dk-assets-cut">{p.page}</span>
                      <span className="dk-assets-row-figure dk-num">{plural(p.pictures, "picture")}</span>
                    </Go>
                  </li>
                ))}
              </ul>
              {r.pages.length > SHOW ? (
                <Tooltip text={r.pages.slice(SHOW).map((p) => `${p.page} (${p.pictures})`).join(", ")}>
                  <p className="dk-assets-panel-note" tabIndex={0}>
                    And {plural(r.pages.length - SHOW, "more page")}.
                  </p>
                </Tooltip>
              ) : null}
              {r.altAbsent ? <p className="dk-assets-panel-note dk-assets-bad">{plural(r.altAbsent, "use")} with no alt attribute.</p> : null}
              <Foot reading={reading} />
            </>
          )
        }
      </Read>
    </Card>
  );
}

/** Share pictures: own, default, shared, none; and the pages still on the default. */
export function SharePictures({ reading }: { reading: Reading<ShareSummary> }) {
  return (
    <Card
      title="Share pictures"
      icon="send"
      info="Each page's og:image, the picture a network shows when the page is shared. The default is the site's fallback, the picture the website's lib/site.ts names for a page that has none of its own. These pictures are made by hand, page by page."
      footer={<CardFoot href={viewHref({ tab: "share" })}>Open every page's share picture</CardFoot>}
    >
      <Read reading={reading}>
        {(s) => (
          <>
            <ul className="dk-assets-facts">
              <li className="dk-assets-fact dk-assets-fact--good">
                <span className="dk-assets-fact-dot" aria-hidden />
                <span className="dk-assets-fact-text">Own picture{s.generated ? ` (${num(s.generated)} drawn by the site)` : ""}</span>
                <span className="dk-assets-fact-figure dk-num">{num(s.own)}</span>
              </li>
              {/* Without the site's fallback read from its repository, nobody is "on" it: no line, rather than a 0 that was never counted. */}
              {s.defaultPicture ? (
                <li className={cx("dk-assets-fact", s.onDefault ? "dk-assets-fact--warn" : "dk-assets-fact--quiet")}>
                  <span className="dk-assets-fact-dot" aria-hidden />
                  <span className="dk-assets-fact-text">On the site's default</span>
                  <span className="dk-assets-fact-figure dk-num">{num(s.onDefault)}</span>
                </li>
              ) : null}
              {s.shared ? (
                <li className="dk-assets-fact dk-assets-fact--info">
                  <span className="dk-assets-fact-dot" aria-hidden />
                  <span className="dk-assets-fact-text">Shared with other pages</span>
                  <span className="dk-assets-fact-figure dk-num">{num(s.shared)}</span>
                </li>
              ) : null}
              <li className={cx("dk-assets-fact", s.none ? "dk-assets-fact--bad" : "dk-assets-fact--quiet")}>
                <span className="dk-assets-fact-dot" aria-hidden />
                <span className="dk-assets-fact-text">No share picture</span>
                <span className="dk-assets-fact-figure dk-num">{num(s.none)}</span>
              </li>
              <li className={cx("dk-assets-fact", s.offSize ? "dk-assets-fact--warn" : "dk-assets-fact--quiet")}>
                <span className="dk-assets-fact-dot" aria-hidden />
                <span className="dk-assets-fact-text">Not 1200 × 630</span>
                <span className="dk-assets-fact-figure dk-num">{num(s.offSize)}</span>
              </li>
            </ul>
            {s.defaultPicture && s.defaultPages.length ? (
              <div className="dk-assets-default">
                <p className="dk-assets-panel-note">
                  Still on <span className="dk-assets-mono">{s.defaultPicture.replace(/^https?:\/\/[^/]+/, "")}</span>:
                </p>
                <span className="dk-assets-pagechips">
                  {s.defaultPages.slice(0, 6).map((p) => (
                    <Go key={p} href={pageHref(p)} className="dk-assets-pagechip" title={p}>
                      {p}
                    </Go>
                  ))}
                  {s.defaultPages.length > 6 ? <span className="dk-assets-more">+{s.defaultPages.length - 6}</span> : null}
                </span>
              </div>
            ) : null}
            {s.ogUnnamed ? <p className="dk-assets-panel-note">{plural(s.ogUnnamed, "file")} in /og/ no page names as its share picture.</p> : null}
            <Foot reading={reading} />
          </>
        )}
      </Read>
    </Card>
  );
}
