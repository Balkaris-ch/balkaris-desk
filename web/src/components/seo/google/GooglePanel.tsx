import type { GooglePanel as Panel, GoogleSitemap, IndexQueueRow, LinkCheck } from "@/contract/seo/google";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { ago, fullDate, num } from "@/lib/format";
import { AnnounceAddress, AnnounceChangedButton, InspectAddress, InspectNowButton, MarkRequestedButton, RefreshSitemapsButton, SubmitSitemapButton } from "./actions";
import "./google.css";

/**
 * Google and the other search engines: what the desk can DO there, beside
 * what it reads (GET /api/v1/seo/google, the same object SEO › Technical
 * carries as `google`). Three parts, each where a person looks for it:
 *
 *   Request indexing   the queue of pages Google has not indexed, with
 *                      "Inspect now", Search Console's inspection of exactly
 *                      that address (where "Request indexing" is pressed: Google
 *                      has no API for it), "Mark requested", and whether pages
 *                      Google already has link to it
 *   Sitemaps           Search Console's record of each, "Submit to Google" /
 *                      "Submit again", and its Sitemaps report for the errors
 *   Other engines      IndexNow: Bing, Yandex, Seznam, Naver and Yep
 *
 * The site line on top says whether the website answers: both submissions are
 * refused by the server while it does not, and their buttons say why.
 */

const QUEUE_SHOWN = 8;
const PRIORITY = { high: { tone: "bad", word: "High" }, medium: { tone: "warn", word: "Medium" }, low: { tone: "quiet", word: "Low" } } as const;
const LINK_TONE = { good: "good", warn: "warn", bad: "bad" } as const;

export function GooglePanel({ panel: g }: { panel: Panel }) {
  /* The server refuses either submission while the website does not answer 200; a fresh look that saw an error disables the buttons with that sentence. */
  const siteBlocked = !g.site.ok && !g.site.stale ? g.site.line : null;
  const writeBlocked = g.access.connected && !g.access.canWrite ? `${g.access.reason ?? ""} ${g.access.step ?? ""}`.trim() : null;
  return (
    <Card
      title="Google and the other search engines"
      icon="globe"
      id="google"
      info="What the desk does at Google itself: inspect an address now, submit a sitemap, keep the Request indexing queue. And IndexNow for Bing, Yandex, Seznam, Naver and Yep. Every press is written to the activity with who pressed it and what the engine answered."
      right={g.queue.state === "ok" ? <Stamp reading={g.queue} /> : null}
      className="dk-seo-google"
    >
      <div className="dk-seo-google-body">
        <p className={cx("dk-seo-google-site", g.site.ok ? "dk-seo-google-site--ok" : g.site.stale ? "dk-seo-google-site--stale" : "dk-seo-google-site--bad")} role={g.site.ok || g.site.stale ? undefined : "alert"}>
          <Icon name={g.site.ok ? "check-circle" : g.site.stale ? "clock" : "alert"} size={14} />
          <span>{g.site.line}</span>
        </p>
        {!g.access.connected ? (
          <p className="dk-seo-google-site dk-seo-google-site--stale">
            <Icon name="minus" size={14} />
            <span>
              {g.access.reason} {g.access.step}
            </span>
          </p>
        ) : null}

        <div className="dk-seo-google-grid">
          <section className="dk-seo-google-queue" aria-label="Request indexing">
            <h3 className="dk-seo-google-h3">
              Request indexing
              {g.queue.state === "ok" ? (
                <span className="dk-seo-google-h3-n dk-num">
                  {num(g.queue.value.waiting)} waiting · {num(g.queue.value.requested)} requested
                </span>
              ) : null}
            </h3>
            <p className="dk-seo-google-quiet">{g.requestLine}</p>
            <InspectAddress />
            <p className="dk-seo-google-quiet">{g.quota.line}</p>
            {g.queue.state === "ok" ? (
              g.queue.value.rows.length ? (
                <>
                  <ol className="dk-seo-google-rows">
                    {g.queue.value.rows.slice(0, QUEUE_SHOWN).map((r) => (
                      <QueueRow key={r.path} r={r} />
                    ))}
                  </ol>
                  {g.queue.value.rows.length > QUEUE_SHOWN ? (
                    <details className="dk-seo-google-more">
                      <summary>{num(g.queue.value.rows.length - QUEUE_SHOWN)} more</summary>
                      <ol className="dk-seo-google-rows">
                        {g.queue.value.rows.slice(QUEUE_SHOWN).map((r) => (
                          <QueueRow key={r.path} r={r} />
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </>
              ) : (
                <p className="dk-seo-google-quiet">Nothing is waiting: Google's newest answer has every sitemap address indexed, or each one is marked requested.</p>
              )
            ) : (
              <PanelAbsent reading={g.queue} />
            )}
          </section>

          <div className="dk-seo-google-side">
            <section aria-label="Sitemaps at Google">
              <h3 className="dk-seo-google-h3">
                Sitemaps at Google
                <RefreshSitemapsButton />
              </h3>
              {writeBlocked ? <p className="dk-seo-google-quiet">{writeBlocked}</p> : null}
              {g.sitemaps.state === "ok" ? (
                <>
                  <ul className="dk-seo-google-rows">
                    {g.sitemaps.value.rows.map((s) => (
                      <SitemapRow key={s.url} s={s} blocked={writeBlocked ?? siteBlocked} />
                    ))}
                  </ul>
                  <p className="dk-seo-google-foot">
                    <Stamp reading={g.sitemaps} />
                    {g.sitemaps.value.consoleHref ? (
                      <Go href={g.sitemaps.value.consoleHref} className="dk-seo-google-ext">
                        Sitemaps report in Search Console <Icon name="external" size={12} />
                      </Go>
                    ) : null}
                  </p>
                </>
              ) : (
                <PanelAbsent reading={g.sitemaps} />
              )}
            </section>

            <section aria-label="The other search engines (IndexNow)">
              <h3 className="dk-seo-google-h3">Bing and the others (IndexNow)</h3>
              {g.indexNow.state === "ok" ? (
                <>
                  <p className="dk-seo-google-line">{g.indexNow.value.line}</p>
                  {g.indexNow.value.changed.paths.length || g.indexNow.value.changed.gone.length ? (
                    <details className="dk-seo-google-more">
                      <summary>Which</summary>
                      <ul className="dk-seo-google-paths">
                        {g.indexNow.value.changed.paths.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                        {g.indexNow.value.changed.gone.map((p) => (
                          <li key={p}>
                            {p} <span className="dk-seo-google-quiet-inline">gone from the sitemap</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <div className="dk-seo-google-buttons">
                    <AnnounceChangedButton count={g.indexNow.value.changed.paths.length + g.indexNow.value.changed.gone.length} blocked={siteBlocked} />
                  </div>
                  <AnnounceAddress blocked={siteBlocked} />
                  {g.indexNow.value.last ? (
                    <p className="dk-seo-google-quiet">
                      Last announced {ago(g.indexNow.value.last.at)} by {g.indexNow.value.last.by}, {num(g.indexNow.value.last.addresses)} address{g.indexNow.value.last.addresses === 1 ? "" : "es"}:{" "}
                      {g.indexNow.value.last.answers.map((a) => `${a.engine} ${a.accepted ? "accepted" : a.line}`).join(", ")}.
                    </p>
                  ) : (
                    <p className="dk-seo-google-quiet">The desk has not announced anything yet. The website's own workflow announces every deployment.</p>
                  )}
                  <p className="dk-seo-google-quiet">
                    Key file {g.indexNow.value.keyFile} on the website. Google does not take part in IndexNow.
                  </p>
                </>
              ) : (
                <PanelAbsent reading={g.indexNow} />
              )}
            </section>

            {g.recent.length ? (
              <section aria-label="Done here lately">
                <h3 className="dk-seo-google-h3">Done here lately</h3>
                <ul className="dk-seo-google-deeds">
                  {g.recent.map((d, i) => (
                    <li key={`${d.at}-${i}`} className={cx("dk-seo-google-deed", `dk-seo-google-deed--${d.tone}`)} title={d.detail ?? undefined}>
                      <span>{d.text}</span>
                      <span className="dk-seo-google-quiet-inline">
                        {d.by ? `${d.by}, ` : ""}
                        <time dateTime={d.at} suppressHydrationWarning>
                          {ago(d.at)}
                        </time>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}

function LinkLine({ l }: { l: LinkCheck }) {
  return (
    <span className={cx("dk-seo-google-links", `dk-seo-google-links--${LINK_TONE[l.tone]}`)} title={l.examples.length ? `Linked from ${l.examples.map((e) => `${e.path}${e.place === "chrome" ? " (menu or footer)" : ""}`).join(", ")}` : undefined}>
      {l.line}
    </span>
  );
}

function QueueRow({ r }: { r: IndexQueueRow }) {
  const p = PRIORITY[r.priority];
  return (
    <li className={cx("dk-seo-google-row", r.requested && "dk-seo-google-row--done")}>
      <div className="dk-seo-google-row-what">
        <Go href={`/seo/pages/view?path=${encodeURIComponent(r.path)}`} className="dk-seo-google-path" title={`Open ${r.path} in Page Optimization`}>
          {r.path}
        </Go>
        <span className="dk-seo-google-row-sub">
          <Chip tone={p.tone}>{p.word}</Chip>
          <span>
            {r.requested ? `Requested${r.requestedBy ? ` by ${r.requestedBy}` : ""}${r.requestedAt ? `, ${ago(r.requestedAt)}` : ""}` : (r.coverage ?? "Not indexed")}
            {r.inspectedAt ? ` · ${r.inspectedBy === "person" ? "asked" : "checked"} ${fullDate(r.inspectedAt)}` : ""}
          </span>
        </span>
        {r.links ? <LinkLine l={r.links} /> : null}
      </div>
      <div className="dk-seo-google-row-acts">
        <InspectNowButton path={r.path} compact />
        {r.consoleHref ? (
          <Go href={r.consoleHref} className="dk-seo-google-ext" title="Search Console's URL Inspection of this address, where “Request indexing” is pressed">
            Request in Search Console <Icon name="external" size={12} />
          </Go>
        ) : null}
        <MarkRequestedButton path={r.path} requested={r.requested} />
      </div>
    </li>
  );
}

function SitemapRow({ s, blocked }: { s: GoogleSitemap; blocked: string | null }) {
  const parts = s.known
    ? [
        s.lastDownloaded ? `Google fetched it ${ago(s.lastDownloaded)}` : "Google has not fetched it yet",
        s.lastSubmitted ? `submitted ${fullDate(s.lastSubmitted)}` : null,
        `${num(s.submitted)} address${s.submitted === 1 ? "" : "es"} counted`,
        s.isPending ? "Google is still processing it" : null,
      ].filter(Boolean)
    : ["The website names it; Search Console does not have it yet"];
  const tone = !s.known ? "warn" : s.errors ? "bad" : s.warnings || s.isPending ? "warn" : "good";
  return (
    <li className="dk-seo-google-row">
      <div className="dk-seo-google-row-what">
        <span className="dk-seo-google-path">{s.path}</span>
        <span className="dk-seo-google-row-sub">
          <Chip tone={tone}>{!s.known ? "Not submitted" : s.errors ? `${num(s.errors)} error${s.errors === 1 ? "" : "s"}` : s.warnings ? `${num(s.warnings)} warning${s.warnings === 1 ? "" : "s"}` : "No errors"}</Chip>
          <span>{parts.join(" · ")}</span>
        </span>
      </div>
      <div className="dk-seo-google-row-acts">{s.canSubmit ? <SubmitSitemapButton path={s.path} known={s.known} blocked={blocked} /> : null}</div>
    </li>
  );
}
