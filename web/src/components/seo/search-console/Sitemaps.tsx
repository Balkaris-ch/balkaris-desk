import type { Reading } from "@/contract/common";
import type { SeoSearchConsolePayload, SitemapRow } from "@/contract/seo/search-console";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { ago, fullDate, num } from "@/lib/format";

/** "/sitemap.xml" from the full address, the host being the site's own. */
function fileOf(path: string): string {
  try {
    return new URL(path).pathname || path;
  } catch {
    return path;
  }
}

function SitemapState({ s }: { s: SitemapRow }) {
  if (s.errors > 0) return <Chip tone="bad">{num(s.errors)} {s.errors === 1 ? "error" : "errors"}</Chip>;
  if (s.isPending) return <Chip tone="warn">Pending</Chip>;
  if (!s.lastDownloaded) return <Chip tone="warn">Not read yet</Chip>;
  if (s.warnings > 0) return <Chip tone="warn">{num(s.warnings)} {s.warnings === 1 ? "warning" : "warnings"}</Chip>;
  return <Chip tone="good">Success</Chip>;
}

/**
 * The desk's own last read of the website's sitemap (every fifteen minutes):
 * what the file answered and what is wrong with it as far as the desk checks.
 * Google's API counts a sitemap's errors and never says what they are, so this
 * is the nearest the desk can come to saying it, with the Technical tab for
 * the whole of it.
 */
function OwnRead({ own }: { own: NonNullable<SeoSearchConsolePayload["ownSitemap"]> }) {
  return (
    <div className="dk-seo-gsc-map dk-seo-gsc-own">
      <div className="dk-seo-gsc-map-head">
        <p className="dk-seo-gsc-map-path">The desk’s own read</p>
        {own.status !== 200 ? (
          <Chip tone="bad">{own.status ? `Answered ${own.status}` : "Not answering"}</Chip>
        ) : own.issues.length ? (
          <Chip tone="warn">
            {num(own.issues.length)} {own.issues.length === 1 ? "problem" : "problems"}
          </Chip>
        ) : (
          <Chip tone="good">No problem found</Chip>
        )}
      </div>
      <p className="dk-seo-gsc-own-said">
        Read <time dateTime={own.at} suppressHydrationWarning>{ago(own.at)}</time>
        {own.status === 200 ? "" : `, and the website ${own.status ? `answered ${own.status}` : "did not answer"}`}: {num(own.addresses)} {own.addresses === 1 ? "address" : "addresses"}
        {own.entriesAt ? ` as the file was last read whole, ${ago(own.entriesAt)}` : ""}
        {own.issues.length ? ":" : "."}
      </p>
      {own.issues.length ? (
        <ul className="dk-seo-gsc-own-issues">
          {own.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : null}
      <Go href="/seo/technical" className="dk-seo-gsc-own-link">
        Every check of the sitemap on Technical
      </Go>
    </div>
  );
}

/**
 * The sitemaps Search Console knows for the property and what it made of
 * each (Search Console's Sitemaps report, read through its API), set beside
 * the desk's own count of the addresses the website's sitemap lists (beside
 * that one file only) and the desk's own read of it.
 */
export function Sitemaps({
  reading,
  listed,
  own,
  href,
}: {
  reading: SeoSearchConsolePayload["sitemaps"];
  listed: SeoSearchConsolePayload["listed"];
  own: SeoSearchConsolePayload["ownSitemap"];
  href: string | null;
}) {
  return (
    <Card
      title="Sitemaps"
      icon="sitemap"
      className="dk-seo-gsc-sitemaps"
      info="The sitemaps submitted to Search Console, when Google last read each, how many addresses it found in it and the errors and warnings it reported. Read through Search Console's API, which gives the number of errors but not what they are; Search Console's own Sitemaps report (Open) shows them. Beside the website's own sitemap: the desk's count of the addresses it lists, from the daily index check, and the desk's own read of the file."
      right={href ? <LinkButton href={href} size="sm" iconRight="external">Open</LinkButton> : null}
    >
      {reading.state !== "ok" ? (
        <>
          <PanelAbsent reading={reading} />
          {own ? <OwnRead own={own} /> : null}
        </>
      ) : (
        <div className="dk-seo-gsc-maps">
          {reading.value.map((s) => (
            <div key={s.path} className="dk-seo-gsc-map">
              <div className="dk-seo-gsc-map-head">
                <p className="dk-seo-gsc-map-path" title={s.path}>
                  {fileOf(s.path)}
                </p>
                <SitemapState s={s} />
              </div>
              <dl className="dk-seo-gsc-facts">
                <div>
                  <dt>Addresses Google found</dt>
                  <dd className="dk-num">
                    {num(s.submitted)}
                    {listed && fileOf(s.path) === listed.file ? (
                      <span className="dk-seo-gsc-facts-of" title={`The desk counted ${num(listed.addresses)} addresses in this file at its index check on ${fullDate(listed.day)}.`}>
                        {" "}
                        · the site lists {num(listed.addresses)}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>Submitted</dt>
                  <dd>{s.lastSubmitted ? fullDate(s.lastSubmitted) : "—"}</dd>
                </div>
                <div>
                  <dt>Last read by Google</dt>
                  <dd>{s.lastDownloaded ? <time dateTime={s.lastDownloaded} suppressHydrationWarning>{ago(s.lastDownloaded)}</time> : "Not yet"}</dd>
                </div>
                <div>
                  <dt>Errors · warnings</dt>
                  <dd className="dk-num">
                    {num(s.errors)} · {num(s.warnings)}
                  </dd>
                </div>
              </dl>
              {s.errors > 0 || s.warnings > 0 ? (
                <p className="dk-seo-gsc-map-said">
                  Google’s API gives how many, not what they are: {href ? <Go href={href}>Search Console’s Sitemaps report</Go> : "Search Console’s Sitemaps report"} names them.
                </p>
              ) : null}
            </div>
          ))}
          {own ? <OwnRead own={own} /> : null}
          <Stamp reading={reading} />
        </div>
      )}
    </Card>
  );
}

/**
 * What the desk's own copy of Search Console holds: Google forgets after
 * sixteen months, the desk keeps one snapshot a day of every finished day.
 */
export function History({ reading }: { reading: Reading<{ from: string; to: string; days: number; rows: number; lastSnapshot: string | null }> }) {
  return (
    <Card
      title="The desk’s copy"
      icon="database"
      className="dk-seo-gsc-history"
      info="Every day the desk asks Search Console for the newest day Google has finished counting (two to three days behind) and keeps it: queries, pages, devices and the totals, every country and Switzerland alone. Search Console itself forgets after sixteen months; the copy does not."
    >
      {reading.state !== "ok" ? (
        <PanelAbsent reading={reading} />
      ) : (
        <div className="dk-seo-gsc-maps">
          <dl className="dk-seo-gsc-facts">
            <div>
              <dt>Days kept</dt>
              <dd className="dk-num">
                {num(reading.value.days)} · {fullDate(reading.value.from)} – {fullDate(reading.value.to)}
              </dd>
            </div>
            <div>
              <dt>Rows kept</dt>
              <dd className="dk-num">{num(reading.value.rows)}</dd>
            </div>
            <div>
              <dt>Last snapshot</dt>
              <dd>{reading.value.lastSnapshot ? <time dateTime={reading.value.lastSnapshot} suppressHydrationWarning>{ago(reading.value.lastSnapshot)}</time> : "—"}</dd>
            </div>
          </dl>
          <Stamp reading={reading} />
        </div>
      )}
    </Card>
  );
}
