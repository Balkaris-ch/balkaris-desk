import type { AssetsQuery, ShareList, ShareRow } from "@/contract/assets";
import { Chip, type ChipTone } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Table } from "@/components/ui/Table";
import { Thumb } from "@/components/ui/Thumb";
import { Tooltip } from "@/components/ui/Tooltip";
import { assetsHref, openHref, pageHref } from "./href";
import { pixels, weight } from "./weight";

const STATUS: Record<ShareRow["status"], { label: string; tone: ChipTone; why: string }> = {
  own: { label: "Own picture", tone: "good", why: "No other page shares with this picture." },
  default: { label: "Site's default", tone: "warn", why: "The site's fallback picture, as the website's lib/site.ts names it: this page has no picture of its own." },
  shared: { label: "Shared", tone: "info", why: "The same picture as other pages, and not the site's fallback." },
  none: { label: "No picture", tone: "bad", why: "The page names no og:image: a network shows its own guess, or nothing." },
};

const ORIGIN: Record<ShareRow["origin"], string> = {
  file: "File in public/",
  generated: "Drawn by the site",
  remote: "Another host",
  none: "—",
};

/** The share tab: every page the crawl read, and the picture it shares with. */
export function ShareTable({ list, q }: { list: ShareList; q: AssetsQuery }) {
  return (
    <Table
      caption="Each page's share picture"
      rows={list.rows}
      rowKey={(r) => r.page}
      rowHref={(r) => pageHref(r.page)}
      density="roomy"
      heads="plain"
      minWidth={1100}
      empty={
        q.q ? (
          <>
            No page matches this search.{" "}
            <Go href={assetsHref(q, { q: "" })} className="dk-assets-link">
              Clear it
            </Go>
          </>
        ) : (
          "The crawl read no page."
        )
      }
      columns={[
        {
          key: "page",
          head: "Page",
          width: "28%",
          cell: (r) => (
            <span className="dk-assets-file">
              <Thumb src={r.picture} icon="image" size="sm" />
              <span className="dk-assets-file-text">
                <span className="dk-assets-file-name">{r.title ?? r.page}</span>
                <span className="dk-assets-file-folder">{r.page}</span>
              </span>
            </span>
          ),
        },
        {
          key: "picture",
          head: "Share picture",
          width: "26%",
          cell: (r) =>
            r.picture ? (
              r.file ? (
                <Go href={openHref(q, r.file)} className="dk-assets-mono dk-assets-cut" title={r.picture} scroll={false}>
                  {r.file}
                </Go>
              ) : (
                <span className="dk-assets-mono dk-assets-cut" title={r.picture}>
                  {r.picture.replace(/^https?:\/\/[^/]+/, "")}
                </span>
              )
            ) : (
              <span className="dk-assets-dash">—</span>
            ),
        },
        { key: "origin", head: "Comes from", cell: (r) => <span className="dk-assets-quiet">{ORIGIN[r.origin]}</span> },
        {
          key: "status",
          head: "Status",
          cell: (r) => (
            <Tooltip text={STATUS[r.status].why + (r.sharedBy > 1 ? ` ${r.sharedBy} pages use it.` : "")}>
              <span className="dk-assets-chip" tabIndex={0}>
                <Chip tone={STATUS[r.status].tone}>
                  {STATUS[r.status].label}
                  {r.status === "default" || r.status === "shared" ? ` · ${r.sharedBy}` : ""}
                </Chip>
              </span>
            </Tooltip>
          ),
        },
        {
          key: "size",
          head: "Size",
          cell: (r) => {
            const px = pixels(r.width, r.height);
            if (!px) {
              return (
                <Tooltip text={r.origin === "generated" ? "Drawn by the site at build time: there is no file in public/ to measure." : r.origin === "remote" ? "On another host: not measured." : "No picture to measure."}>
                  <span className="dk-assets-dash" tabIndex={0}>
                    —
                  </span>
                </Tooltip>
              );
            }
            const right = r.width === 1200 && r.height === 630;
            return (
              <Tooltip text={right ? "1200 × 630: the size share pictures are made at." : "Share pictures are meant to be 1200 × 630; networks crop or shrink other sizes."}>
                <span className={right ? "dk-num" : "dk-num dk-assets-warn"} tabIndex={0}>
                  {px}
                </span>
              </Tooltip>
            );
          },
        },
        { key: "weight", head: "Weight", numeric: true, cell: (r) => (r.bytes !== null ? weight(r.bytes) : <span className="dk-assets-dash">—</span>) },
        {
          key: "actions",
          head: "Actions",
          align: "right",
          cell: (r) => (r.picture ? <LinkButton href={r.picture} size="xs" variant="ghost" icon="external" aria-label={`Open the share picture of ${r.page}`} title="Open the picture" /> : null),
        },
      ]}
    />
  );
}
