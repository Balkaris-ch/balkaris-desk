import { db } from "../../db.ts";
import * as site from "../site/index.ts";
import type { PageRef } from "../../../web/src/contract/seo/common.ts";

/**
 * The website as the SEO engine reads it: the crawl's pages (src/cc/site),
 * each with the language its html says. Read once per answer, never per row:
 * the crawl's own `page()` rebuilds every row each time it is called.
 */

export interface SitePage extends site.PageRow {
  /** html lang as the crawl read it, lower case ("en"); null when the page did not say or was not read. */
  lang: string | null;
}

export interface SiteView {
  /** When the crawl finished, or null before the first crawl. */
  at: string | null;
  pages: SitePage[];
  byPath: Map<string, SitePage>;
}

/** The crawl's pages with their language, or an empty view before the first crawl. */
export function siteView(): SiteView {
  let rows: site.PageRow[] = [];
  let at: string | null = null;
  try {
    const inv = site.inventory();
    if (inv.state === "ok") {
      rows = inv.value;
      at = inv.asOf;
    }
  } catch {
    rows = [];
  }
  const langs = new Map(
    (db.prepare("SELECT path, CASE WHEN json_valid(facts) THEN json_extract(facts, '$.lang') END AS lang FROM cc_pages").all() as { path: string; lang: string | null }[]).map((r) => [
      r.path,
      r.lang ? r.lang.toLowerCase().split("-")[0]! : null,
    ]),
  );
  const pages = rows.map((r) => ({ ...r, lang: langs.get(r.path) ?? null }));
  return { at, pages, byPath: new Map(pages.map((p) => [p.path, p])) };
}

/** A page's own title: the part before " | Balkaris" or " — Balkaris". */
export function ownTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = title.split(/\s+[|·]\s+/)[0]!.replace(/\s+[—–-]\s+Balkaris$/i, "").trim();
  return t || null;
}

/** A page as a row names it; a path the crawl does not know is named by its path alone. */
export function pageRef(path: string, view: SiteView): PageRef {
  const p = view.byPath.get(path);
  return {
    path,
    title: ownTitle(p?.title),
    kind: p?.kind ?? null,
    kindLabel: p?.kindLabel ?? null,
    picture: p?.sharePicture ?? null,
    lang: p?.lang ?? null,
  };
}

/** The kinds that carry the studio's offer: what a search engine should index first. */
export const MONEY_KINDS = new Set(["home", "service", "segment", "landing"]);
