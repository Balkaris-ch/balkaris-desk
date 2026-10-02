"use client";

import { useState } from "react";
import type { PageCrawl } from "@/contract/seo/page-view";
import type { Serp } from "@/contract/seo/opportunities";
import { buttonClass } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { DASH, num } from "@/lib/format";

type View = "google" | "mobile" | "social";

/** Every word of the phrase (three letters or more) in the text, ignoring case and accents. */
export function carries(text: string | null, phrase: string): boolean {
  if (!text) return false;
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hay = fold(text);
  const words = fold(phrase).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  return words.length > 0 && words.every((w) => hay.includes(w));
}

/** The address as Google prints it under the site's name: host › path › parts. */
function crumbs(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return [`${u.protocol}//${u.host}`, ...parts].join(" › ");
  } catch {
    return url;
  }
}

/**
 * "Search preview" (board 115): the page as a Google result on a desktop
 * and on a phone, and as a shared link, drawn from what the crawl read on
 * the live page. Google cuts a title by its width, not by a count; the
 * preview cuts it at the same width a result has, so what is hidden here
 * is about what Google hides. Beside it, the lengths against the desk's
 * yardsticks, and whether the page's most shown query is in the title or
 * the description. "Edit" opens the Optimize tab, where a new title and
 * description become a proposal for approval.
 */
export function SearchPreview({ serp, crawl, query, editHref }: { serp: Serp; crawl: PageCrawl | null; query: string | null; editHref: string }) {
  const [view, setView] = useState<View>("google");
  const host = (() => {
    try {
      return new URL(serp.url).host.replace(/^www\./, "");
    } catch {
      return serp.url;
    }
  })();
  const titleOk = serp.title !== null && serp.titleLength <= serp.titleLimit;
  const descOk = serp.description !== null && serp.descriptionLength <= serp.descriptionLimit;
  const inTitle = query ? carries(serp.title, query) || carries(serp.description, query) : null;
  const bad = [!titleOk, !descOk, inTitle === false].filter(Boolean).length;
  const og = crawl?.og ?? { title: null, description: null, image: null };
  const picture = og.image ?? crawl?.defaultPicture ?? null;

  return (
    <section className="dk-card dk-seo-optimize-panel dk-seo-optimize-serp" aria-label="Search preview">
      <header className="dk-card-head dk-seo-optimize-serp-head">
        <h2 className="dk-card-title">
          <span className="dk-card-title-text">Search preview</span>
        </h2>
        <div className="dk-seo-optimize-seg" role="tablist" aria-label="Preview">
          {(["google", "mobile", "social"] as View[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={cx("dk-seo-optimize-seg-btn", view === v && "dk-seo-optimize-seg-btn--on")} onClick={() => setView(v)}>
              {v === "google" ? "Google" : v === "mobile" ? "Mobile" : "Social"}
            </button>
          ))}
        </div>
        <Go href={editHref} className={buttonClass({ variant: "quiet", size: "sm" }, "dk-seo-optimize-serp-edit")}>
          <Icon name="pencil" size={14} />
          <span>Edit title &amp; description</span>
        </Go>
      </header>
      <div className="dk-card-body dk-seo-optimize-serp-body">
        <div className={cx("dk-seo-optimize-serp-stage", view === "mobile" && "dk-seo-optimize-serp-stage--phone")}>
          {view === "social" ? (
            <article className="dk-seo-optimize-share">
              {picture ? (
                // The share picture as the page names it: what a chat app or LinkedIn would show.
                <img src={picture} alt="" className="dk-seo-optimize-share-pic" loading="lazy" />
              ) : (
                <span className="dk-seo-optimize-share-pic dk-seo-optimize-share-pic--none">No share picture</span>
              )}
              <span className="dk-seo-optimize-share-host">{host}</span>
              <span className="dk-seo-optimize-share-title">{og.title ?? serp.title ?? DASH}</span>
              <span className="dk-seo-optimize-share-desc">{og.description ?? serp.description ?? ""}</span>
              {!og.image || (crawl?.defaultPicture && og.image === crawl.defaultPicture) ? (
                <span className="dk-seo-optimize-share-note">{crawl?.defaultPicture ? "The site’s default picture: the page has none of its own." : "The page names no share picture."}</span>
              ) : null}
            </article>
          ) : (
            <article className="dk-seo-optimize-result">
              <span className="dk-seo-optimize-result-site">
                <span className="dk-seo-optimize-result-mark" aria-hidden>
                  B
                </span>
                <span>
                  <span className="dk-seo-optimize-result-host">{host}</span>
                  <span className="dk-seo-optimize-result-url">{crumbs(serp.url)}</span>
                </span>
              </span>
              <span className="dk-seo-optimize-result-title">{serp.title ?? "(no title: Google would choose one)"}</span>
              <span className="dk-seo-optimize-result-desc">{serp.description ?? "(no description: Google would show a fragment of the page)"}</span>
            </article>
          )}
        </div>
        <dl className="dk-seo-optimize-serp-checks">
          <dt className="dk-seo-optimize-serp-checks-head">Now</dt>
          <dd />
          <dt>Title length</dt>
          <dd className={cx("dk-num", titleOk ? "dk-tone-good" : "dk-tone-warn")}>
            {num(serp.titleLength)}/{num(serp.titleLimit)}
          </dd>
          <dt>Description length</dt>
          <dd className={cx("dk-num", descOk ? "dk-tone-good" : "dk-tone-warn")}>
            {num(serp.descriptionLength)}/{num(serp.descriptionLimit)}
          </dd>
          <dt title={query ? `The page’s most shown query in Search Console: “${query}”` : undefined}>Carries its top query</dt>
          <dd>{inTitle === null ? <span className="dk-seo-optimize-quiet" title="Google showed the page for no query in the period">{DASH}</span> : inTitle ? <Icon name="check" size={14} className="dk-tone-good" /> : <Icon name="x" size={14} className="dk-tone-warn" />}</dd>
          <dt className={cx("dk-seo-optimize-serp-verdict", bad ? "dk-tone-warn" : "dk-tone-good")}>
            <span className="dk-seo-optimize-dot" aria-hidden />
            {bad ? `${bad} to improve` : "Looks good"}
          </dt>
          <dd />
        </dl>
      </div>
      <p className="dk-seo-optimize-note dk-seo-optimize-serp-foot">
        The desk’s yardsticks: {num(serp.titleLimit)} characters of title and {num(serp.descriptionLimit)} of description before a result is cut. Google cuts by width and may write its own snippet.
      </p>
    </section>
  );
}
