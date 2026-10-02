import type { ReactNode } from "react";
import type { AssetDetail as Detail, AssetPageUse, AssetsQuery } from "@/contract/assets";
import type { Reading } from "@/contract/common";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { cx } from "@/lib/cx";
import { fullDate } from "@/lib/format";
import { drawable, KIND_ICON, KIND_TONE, NOT_CRAWLED } from "./AssetTable";
import { CHECK_ICON, CHECK_WORD } from "./CheckChips";
import { CopyButton } from "./CopyButton";
import { Drawer } from "./Drawer";
import { assetsHref, closeHref, liveHref, pageHref } from "./href";
import { KIND_LABEL, pixels, plural, weight } from "./weight";

const HOW: Record<AssetPageUse["how"], string> = {
  img: "<img>",
  video: "<video>",
  poster: "a film's poster",
  share: "its share picture",
  mention: "named in the HTML",
};

/**
 * One file opened beside the list: the picture, every fact, every page and
 * alt text, every check. `crawledAt`: when the crawl that says where it is
 * used finished, or null before the first one.
 */
export function AssetDetailView({ reading, q, site, crawledAt }: { reading: Reading<Detail>; q: AssetsQuery; site: string; crawledAt: string | null }) {
  const title = reading.state === "ok" ? reading.value.name : (q.file ?? "File");
  return (
    <Drawer title={title} closeHref={closeHref(q)}>
      {reading.state !== "ok" ? <Absent reading={reading} /> : <Body a={reading.value} reading={reading} q={q} site={site} crawledAt={crawledAt} />}
    </Drawer>
  );
}

function Body({ a, reading, q, site, crawledAt }: { a: Detail; reading: Reading<Detail>; q: AssetsQuery; site: string; crawledAt: string | null }) {
  const crawled = crawledAt !== null;
  const url = liveHref(site, a.path);
  const order = { fail: 0, warn: 1, pass: 2, note: 3 } as const;
  const checks = [...a.checks].sort((x, y) => order[x.state] - order[y.state]);
  const facts: [string, ReactNode][] = [
    ["Address", <span key="a" className="dk-assets-mono dk-assets-break">{a.path}</span>],
    ["In the repository", <span key="r" className="dk-assets-mono dk-assets-break">{a.repoPath}</span>],
    ["Folder", a.folder ? <Go key="f" href={assetsHref(q, { folder: a.folder, tab: "all" })} className="dk-assets-link">/{a.folder}/</Go> : "/ (root)"],
    ["Type", `${KIND_LABEL[a.kind]}, ${a.ext.toUpperCase() || "no extension"}`],
    ["Dimensions", pixels(a.width, a.height) ?? (a.kind === "image" ? "Not readable" : "Not measured (the desk measures pictures)")],
    ["Weight", weight(a.bytes)],
    ...(a.kind === "image" && a.alpha !== null ? [["Transparency", a.alpha ? "Has a transparency channel" : "None"] as [string, string]] : []),
    ["Used on", !crawled ? "Not known yet: the first crawl has not finished" : a.pages.length ? plural(a.pages.length, "page") : "Not found on any page"],
    ...(a.shareOf ? [["Share picture of", plural(a.shareOf, "page")] as [string, string]] : []),
    ["Listed by the desk since", fullDate(a.firstSeen)],
  ];
  const byPage = new Map<string, AssetPageUse[]>();
  for (const u of a.uses) byPage.set(u.page, [...(byPage.get(u.page) ?? []), u]);

  return (
    <>
      <div className={cx("dk-assets-preview", a.alpha && "dk-assets-preview--alpha")}>
        {drawable(a) ? (
          // The website's own file, as it is served; next/image would fetch and re-encode it for nothing.
          <img src={url} alt="" loading="lazy" decoding="async" />
        ) : a.kind === "video" && a.poster ? (
          <>
            <img src={liveHref(site, a.poster)} alt="" loading="lazy" decoding="async" />
            <span className="dk-assets-preview-caption">
              <Icon name="video" size={14} />
              Its poster, {a.poster}: films are not played inside the desk.
            </span>
          </>
        ) : (
          <span className="dk-assets-preview-mark">
            <Icon name={KIND_ICON[a.kind]} size={28} />
            <span>{a.kind === "video" ? "Films are not played inside the desk. Open it on balkaris.ch." : `${KIND_LABEL[a.kind]}: nothing to preview.`}</span>
          </span>
        )}
      </div>

      <div className="dk-assets-drawer-actions">
        <LinkButton href={url} size="sm" variant="quiet" icon="external">
          Open on balkaris.ch
        </LinkButton>
        <CopyButton text={url} size="sm" variant="quiet" bare={false} />
        <Chip tone={KIND_TONE[a.kind]}>{KIND_LABEL[a.kind]}</Chip>
      </div>

      <section className="dk-assets-drawer-section" aria-label="Facts">
        <dl className="dk-assets-dl">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="dk-assets-drawer-section">
        <h3 className="dk-assets-drawer-h">For search and speed</h3>
        {checks.length ? (
          <ul className="dk-assets-checks">
            {checks.map((c) => (
              <li key={c.id} className={cx("dk-assets-check", `dk-assets-check--${c.state}`)}>
                <Icon name={CHECK_ICON[c.state]} size={16} />
                <div>
                  <p className="dk-assets-check-head">
                    <b>{c.label}</b>
                    <span className="dk-assets-check-word">{CHECK_WORD[c.state]}</span>
                  </p>
                  <p className="dk-assets-check-text">{c.text}</p>
                  {c.measured !== null || c.limit !== null ? (
                    <p className="dk-assets-check-figures">
                      {c.measured !== null ? (
                        <span>
                          Measured <b>{c.measured}</b>
                        </span>
                      ) : null}
                      {c.limit !== null ? (
                        <span>
                          Limit <b>{c.limit}</b>
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dk-assets-panel-note">No rule of the desk applies to {KIND_LABEL[a.kind].toLowerCase()} files.</p>
        )}
      </section>

      <section className="dk-assets-drawer-section">
        <h3 className="dk-assets-drawer-h">Where it is used</h3>
        {byPage.size ? (
          <ul className="dk-assets-uses">
            {[...byPage].map(([page, uses]) => (
              <li key={page}>
                <Go href={pageHref(page)} className="dk-assets-use-page">
                  <span className="dk-assets-use-title">{a.titles[page] ?? page}</span>
                  <span className="dk-assets-mono dk-assets-use-path">{page}</span>
                </Go>
                <ul className="dk-assets-use-list">
                  {uses.map((u, i) => (
                    <li key={i}>
                      <span className="dk-assets-use-how">
                        {HOW[u.how]}
                        {u.how === "img" ? (u.via === "optimised" ? ", through the optimiser" : ", the file itself") : ""}
                        {u.how === "img" && (u.width || u.height) ? ` · ${u.width ?? "?"} × ${u.height ?? "?"} in the markup` : ""}
                      </span>
                      {u.how === "img" ? (
                        u.alt === "written" ? (
                          <span className="dk-assets-use-alt">“{u.altText}”</span>
                        ) : u.alt === "empty" ? (
                          <span className="dk-assets-use-alt dk-assets-alt--quiet">alt="" (decorative)</span>
                        ) : (
                          <span className="dk-assets-use-alt dk-assets-alt--bad">no alt attribute</span>
                        )
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dk-assets-panel-note">{crawled ? "No page's served HTML names it. Client code may still load it, so this is not proof it is unused." : NOT_CRAWLED}</p>
        )}
      </section>

      <p className="dk-assets-panel-stamp">
        <Stamp reading={reading} />
        {crawledAt ? <Stamp source="crawl" asOf={crawledAt} note="Where it is used, and with which alt text: from the crawl of every page's served HTML, which runs no scripts." /> : null}
      </p>
    </>
  );
}
