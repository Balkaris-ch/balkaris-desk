import type { AssetItem, AssetList, AssetsQuery } from "@/contract/assets";
import { Chip, type ChipTone } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { Table } from "@/components/ui/Table";
import { Thumb } from "@/components/ui/Thumb";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { CheckSummary } from "./CheckChips";
import { CopyButton } from "./CopyButton";
import { assetsHref, liveHref, openHref, pageHref } from "./href";
import { KIND_LABEL, pixels, weight } from "./weight";

export const KIND_TONE: Record<AssetItem["kind"], ChipTone> = { image: "good", video: "violet", font: "info", scene: "warn", audio: "info", document: "quiet", other: "quiet" };
export const KIND_ICON: Record<AssetItem["kind"], IconName> = { image: "image", video: "video", font: "file-text", scene: "layers", audio: "play", document: "file-text", other: "file" };

/** A picture the browser can draw as a thumbnail; everything else gets its kind's mark. */
export const drawable = (a: Pick<AssetItem, "kind" | "ext">): boolean => a.kind === "image" && a.ext !== "ico";

/**
 * A file's thumbnail: the picture itself, a film's poster (as a page shows
 * it before it plays) with a film's mark on it, or its kind's mark.
 */
export function AssetThumb({ a, site }: { a: Pick<AssetItem, "kind" | "ext" | "path" | "poster">; site: string }) {
  if (drawable(a)) return <Thumb src={liveHref(site, a.path)} icon={KIND_ICON[a.kind]} size="sm" />;
  if (a.kind === "video" && a.poster) {
    return (
      <span className="dk-assets-thumb-film">
        <Thumb src={liveHref(site, a.poster)} icon="video" size="sm" />
        <span className="dk-assets-thumb-play" aria-hidden>
          <Icon name="play" size={10} />
        </span>
      </span>
    );
  }
  return <Thumb src={null} icon={KIND_ICON[a.kind]} size="sm" />;
}

/**
 * The table of files: one row per file in public/, the row opens it beside
 * the list. `crawled`: whether a crawl has finished; before it, which page
 * uses a file is not known, and the Used on cell says so instead of "none".
 */
export function AssetTable({ list, q, site, crawled }: { list: AssetList; q: AssetsQuery; site: string; crawled: boolean }) {
  const filtered = Boolean(q.q || q.folder !== null || q.format !== null || q.flag !== null);
  return (
    <Table
      caption="Files in the website's public folder"
      rows={list.rows}
      rowKey={(a) => a.path}
      rowHref={(a) => openHref(q, a.path)}
      /* The row only adds ?file= and opens the file beside the list: the reader stays where they had scrolled to. */
      keepScroll
      density="roomy"
      heads="plain"
      minWidth={980}
      empty={
        filtered ? (
          <>
            No file matches {q.q && (q.folder !== null || q.format !== null || q.flag !== null) ? "this search and these filters" : q.q ? "this search" : "these filters"}.{" "}
            <Go href={assetsHref(q, { q: "", folder: null, format: null, flag: null })} className="dk-assets-link">
              Clear them
            </Go>
          </>
        ) : (
          q.tab === "attention" ? "No file breaks or warns on any of the desk's rules." : "No file of this kind is in public/."
        )
      }
      columns={[
        {
          key: "file",
          head: "File",
          width: "22%",
          cell: (a) => (
            <span className="dk-assets-file">
              <AssetThumb a={a} site={site} />
              <span className="dk-assets-file-text">
                <span className="dk-assets-file-name">{a.name}</span>
                <span className="dk-assets-file-folder">{a.folder ? `/${a.folder}/` : "/ (root)"}</span>
              </span>
            </span>
          ),
        },
        {
          key: "type",
          head: "Type",
          cell: (a) => (
            <span className="dk-assets-type">
              <Chip tone={KIND_TONE[a.kind]}>{a.ext.toUpperCase() || KIND_LABEL[a.kind]}</Chip>
              <span className="dk-assets-ext">{KIND_LABEL[a.kind]}</span>
            </span>
          ),
        },
        {
          key: "dims",
          head: "Dimensions",
          cell: (a) => {
            const px = pixels(a.width, a.height);
            if (px) return <span className="dk-num">{px}</span>;
            return (
              <Tooltip text={a.kind === "image" ? "The desk could not read this picture's size." : "The desk measures pictures only."}>
                <span className="dk-assets-dash" tabIndex={0}>
                  —
                </span>
              </Tooltip>
            );
          },
        },
        {
          key: "weight",
          head: "Weight",
          numeric: true,
          cell: (a) => <span className={cx(a.checks.some((c) => c.id === "weight" && c.state === "fail") && "dk-assets-heavy")}>{weight(a.bytes)}</span>,
        },
        { key: "used", head: "Used on", width: "13%", cell: (a) => <UsedOn pages={a.pages} crawled={crawled} /> },
        { key: "alt", head: "Alt text", width: "15%", cell: (a) => <AltCell a={a} crawled={crawled} /> },
        { key: "seo", head: "SEO", width: "20%", cell: (a) => <CheckSummary checks={a.checks} /> },
        {
          key: "actions",
          head: "Actions",
          align: "right",
          cell: (a) => (
            <span className="dk-assets-actions">
              <LinkButton href={liveHref(site, a.path)} size="xs" variant="ghost" icon="external" aria-label={`Open ${a.name} on balkaris.ch`} title="Open on balkaris.ch" />
              <CopyButton text={liveHref(site, a.path)} />
            </span>
          ),
        },
      ]}
    />
  );
}

/** Said wherever "which page uses it" is shown before the first crawl has read the pages. */
export const NOT_CRAWLED = "The first crawl has not finished; which page uses a file comes from it.";

/** "3 pages" and the first as a chip, each a link to the page on the Pages screen. */
export function UsedOn({ pages, crawled, show = 1 }: { pages: readonly string[]; crawled: boolean; show?: number }) {
  if (!crawled) {
    return (
      <Tooltip text={NOT_CRAWLED}>
        <span className="dk-assets-dash" tabIndex={0}>
          —
        </span>
      </Tooltip>
    );
  }
  if (!pages.length) {
    return (
      <Tooltip text="No page's served HTML names it. Client code may still load it, so this is not proof it is unused.">
        <span className="dk-assets-quiet" tabIndex={0}>
          Not found on a page
        </span>
      </Tooltip>
    );
  }
  const rest = pages.length - show;
  return (
    <span className="dk-assets-used">
      <span className="dk-assets-used-n dk-num">{num(pages.length)}</span>
      {pages.slice(0, show).map((p) => (
        <Go key={p} href={pageHref(p)} className="dk-assets-pagechip" title={p}>
          {p}
        </Go>
      ))}
      {rest > 0 ? (
        <Tooltip text={pages.slice(show, show + 20).join(", ") + (rest > 20 ? ` and ${rest - 20} more` : "")}>
          <span className="dk-assets-more" tabIndex={0}>
            +{rest}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** The alt texts a file is shown with, or what stands in their place. */
function AltCell({ a, crawled }: { a: AssetItem; crawled: boolean }) {
  const uses = a.alt.written + a.alt.empty + a.alt.absent;
  if (!crawled) {
    return (
      <Tooltip text="The first crawl has not finished; the alt texts a picture is shown with come from it.">
        <span className="dk-assets-dash" tabIndex={0}>
          —
        </span>
      </Tooltip>
    );
  }
  if (!uses) {
    return (
      <Tooltip text={a.kind === "image" ? "No <img> tag shows it: it is a share picture, a poster or named elsewhere in the HTML, where alt text does not apply." : "Alt text belongs to pictures in <img> tags."}>
        <span className="dk-assets-dash" tabIndex={0}>
          —
        </span>
      </Tooltip>
    );
  }
  if (a.alt.absent) {
    return (
      <span className="dk-assets-alt dk-assets-alt--bad">
        no alt attribute{a.alt.absent < uses ? ` on ${a.alt.absent} of ${uses}` : ""}
      </span>
    );
  }
  if (a.decorativeEverywhere) {
    return (
      <Tooltip text={'Every <img> that shows it says alt="": decoration, on purpose. Not a fault; right if the picture adds nothing a reader needs.'}>
        <span className="dk-assets-alt dk-assets-alt--quiet" tabIndex={0}>
          decorative (empty alt)
        </span>
      </Tooltip>
    );
  }
  const first = a.altTexts[0] ?? "";
  const more = a.altTexts.length - 1;
  return (
    <Tooltip
      text={
        <span className="dk-assets-tip">
          {a.altTexts.map((t) => (
            <span key={t}>“{t}”</span>
          ))}
          {a.alt.empty ? <span>Marked decorative (alt="") on {a.alt.empty} of {uses} uses.</span> : null}
        </span>
      }
    >
      <span className="dk-assets-alt" tabIndex={0}>
        <span className="dk-assets-alt-text">“{first}”</span>
        {more > 0 ? <span className="dk-assets-more">+{more}</span> : null}
      </span>
    </Tooltip>
  );
}
