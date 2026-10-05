/**
 * SEO › Overview keeps what it shows in its address: the period the frame's
 * select wrote (?range=), and the country and the device its Search Console
 * figures are narrowed to (?country=, ?device=, written by the bar's two
 * selects). Every link a panel draws to another page of the SEO section goes
 * through `seoHref`, so the chosen period travels with it, as the tab strip
 * carries it. The country and the device do not travel: a filter on one page
 * means nothing on the next.
 *
 * Pure: the server components and the client ones both build their links here.
 */

/** The period a bare address means: left out of every link. */
export const DEFAULT_RANGE = "30d";

/**
 * `href` with the chosen period added, when it leads to a page of the SEO
 * section and the period is not the default. Anything already in the link
 * (its own params, its #anchor) is kept; a link that names a period keeps its
 * own. Links elsewhere (the operator, Site Health, another site) come back
 * unchanged.
 */
export function seoHref(href: string, range: string): string {
  if (!range || range === DEFAULT_RANGE) return href;
  if (href !== "/seo" && !/^\/seo[/?#]/.test(href)) return href;
  const at = href.indexOf("#");
  const hash = at < 0 ? "" : href.slice(at);
  const rest = at < 0 ? href : href.slice(0, at);
  const q = rest.indexOf("?");
  const path = q < 0 ? rest : rest.slice(0, q);
  const params = new URLSearchParams(q < 0 ? "" : rest.slice(q + 1));
  if (!params.has("range")) params.set("range", range);
  return `${path}?${params.toString()}${hash}`;
}

/** An opportunity's own page on SEO › Opportunities, where its step is written out whole. */
export const opportunityHref = (id: string, range = DEFAULT_RANGE): string => seoHref(`/seo/opportunities?open=${encodeURIComponent(id)}`, range);

/** Page Optimization for one address. */
export const pageHref = (path: string, range = DEFAULT_RANGE): string => seoHref(`/seo/pages/view?path=${encodeURIComponent(path)}`, range);

/** SEO › Keywords filtered to one phrase: where a query of this page opens. */
export const keywordHref = (phrase: string, range = DEFAULT_RANGE): string => seoHref(`/seo/keywords?q=${encodeURIComponent(phrase)}`, range);
