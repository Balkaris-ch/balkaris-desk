import type { LookupCard, LookupCell, SearchPanel, SeoCompetitorsPayload, SerpChange, SerpPanel, SerpView } from "@/contract/seo/competitors";
import { Badge, Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { cx } from "@/lib/cx";
import { ago, num, shortDate } from "@/lib/format";
import { ActButton, FileSearch, ImportAudit, LookupForm, RecordGoogle, SerpForm } from "./Act";
import { BriefButton } from "./Buttons";
import { day, hrefWith, lookHref, safeHref, serpHref, shortUrl } from "./look";

/**
 * SEO › Competitors on the open web: look up any site and set it beside
 * Balkaris, check who ranks for a search now, and every captured search with
 * its result page. Server components: the forms and buttons are in Act.tsx.
 */

/* ---------- the two questions over the page ---------------------------------------------------- */

export function Ask({ data }: { data: SeoCompetitorsPayload }) {
  const serp = data.serp?.state === "ok" ? data.serp.value : null;
  return (
    <Card className="dk-seo-competitors-askcard" title="Find a competitor" icon="search" sub="Look up any site, or check who ranks for a search now. Nothing here changes the website.">
      <div className="dk-seo-competitors-askgrid">
        <div>
          <h3 className="dk-seo-competitors-h">Look up any site</h3>
          <LookupForm initial={data.asked.look ?? undefined} />
        </div>
        <div>
          <h3 className="dk-seo-competitors-h">Who ranks for a search</h3>
          <SerpForm initial={data.asked.serp} lang={data.asked.serpLang} langs={serp?.langs ?? ["de", "en", "fr", "it"]} />
        </div>
      </div>
    </Card>
  );
}

/* ---------- a site beside Balkaris ---------------------------------------------------------------- */

function Cell({ c }: { c: LookupCell | null }) {
  if (!c) return <span className="dk-seo-competitors-none">Not looked up</span>;
  return (
    <span className={cx("dk-seo-competitors-cell", c.state !== "ok" && "dk-seo-competitors-cell--off")}>
      <span>{c.text}</span>
      {c.state === "ok" ? (
        <span className="dk-seo-competitors-from">
          {c.from}
          {c.at ? `, ${shortDate(c.at)}` : ""}
        </span>
      ) : c.step ? (
        <span className="dk-seo-competitors-from">{c.step}</span>
      ) : null}
    </span>
  );
}

export function Lookup({ reading, base }: { reading: SeoCompetitorsPayload["lookup"]; base: Record<string, string> }) {
  if (!reading) return null;
  const close = hrefWith(base, { look: undefined });
  if (reading.state !== "ok") {
    return (
      <Card className="dk-seo-competitors-lookup" title="Looked up" icon="globe" right={<Go href={close} scroll={false} className="dk-seo-competitors-task-link">Close</Go>}>
        <Absent reading={reading} />
      </Card>
    );
  }
  const v: LookupCard = reading.value;
  const home = safeHref(v.home);
  const watched = !!v.known?.decision?.watch;
  return (
    <Card
      className="dk-seo-competitors-lookup"
      title={v.domain}
      icon="globe"
      sub={
        <span className="dk-seo-competitors-detail-sub">
          {home ? (
            <Go href={home} className="dk-seo-competitors-ext">
              {shortUrl(v.home)}
              <Icon name="external" size={12} />
            </Go>
          ) : null}
          <span className="dk-seo-competitors-quiet">{v.line}</span>
          {v.known ? (
            <Go href={hrefWith(base, { open: v.known.key, look: undefined })} scroll={false} className="dk-seo-competitors-task-link">
              On the list: {num(v.known.sightings)} observation{v.known.sightings === 1 ? "" : "s"}
            </Go>
          ) : (
            <Chip className="dk-seo-competitors-mini">not on the list</Chip>
          )}
        </span>
      }
      right={
        <span className="dk-seo-competitors-right">
          <Stamp reading={reading} />
          <Go href={close} scroll={false} className="dk-seo-competitors-task-link">
            Close
          </Go>
        </span>
      }
      divided
    >
      <div className="dk-seo-competitors-actions">
        {watched ? (
          <ActButton path="/watch" body={{ input: v.domain, watch: false }} label="Stop watching" icon="eye" title="It leaves the list when no result shows it; its observations are kept." />
        ) : (
          <ActButton path="/watch" body={{ input: v.domain }} label="Watch as a competitor" variant="good" icon="eye" title="Puts it on the list as added by you, and reads its home page now and every week." />
        )}
        <ActButton path="/read" body={{ domain: v.domain }} label="Read its pages" icon="sitemap" busyLabel="Reading its sitemap…" title="Reads its sitemap for the pages that answer our clusters; they join the weekly read under that cluster, and Content Gaps sees them too." />
        <BriefButton task={v.brief.task} label={v.brief.label} step={v.brief.step} />
        <ActButton path="/lookup" body={{ input: v.domain, fresh: true }} label="Ask again" icon="refresh" busyLabel="Looking up…" title={`Reads every fact again now: one of today's domain lookups (${v.allowance.left} of ${v.allowance.cap} left).`} />
        <span className="dk-seo-competitors-quiet">
          {num(v.pages)} of its page{v.pages === 1 ? "" : "s"} on the weekly read · {v.allowance.left} of {v.allowance.cap} lookups left today
        </span>
      </div>
      <div className="dk-seo-competitors-facttable" role="table" aria-label={`${v.domain} beside Balkaris`}>
        <div className="dk-seo-competitors-facttable-head" role="row">
          <span role="columnheader">What</span>
          <span role="columnheader">{v.domain}</span>
          <span role="columnheader">Balkaris</span>
        </div>
        {v.rows.map((r) => (
          <div key={r.key} className="dk-seo-competitors-facttable-row" role="row">
            <span role="rowheader" className="dk-seo-competitors-facttable-label">
              {r.label}
            </span>
            <span role="cell">
              <Cell c={r.them} />
            </span>
            <span role="cell">
              <Cell c={r.us} />
            </span>
          </div>
        ))}
      </div>
      <Paid paid={v.paid} domain={v.domain} />
    </Card>
  );
}

/** DataForSEO's part: off with the owner's step while there is no account; each part named with its source when there is. */
function Paid({ paid, domain }: { paid: LookupCard["paid"]; domain: string }) {
  if (!paid.configured) {
    return (
      <section className="dk-seo-competitors-section" aria-label="What it ranks for">
        <h3 className="dk-seo-competitors-h">What it ranks for, its visibility, its links</h3>
        <p className="dk-seo-competitors-note">
          Not connected: these come from DataForSEO, and no account exists. {paid.step ?? ""}
        </p>
      </section>
    );
  }
  const r = paid.ranked;
  const b = paid.backlinks;
  const o = paid.overview;
  return (
    <section className="dk-seo-competitors-section" aria-label="What it ranks for">
      <h3 className="dk-seo-competitors-h">What it ranks for on google.ch (DataForSEO)</h3>
      {o.state !== "ok" || r.state !== "ok" ? <ActButton path="/paid" body={{ domain }} label="Ask DataForSEO" icon="database" busyLabel="Asking…" title="Buys what it ranks for on google.ch, its visibility and its link summary: about $0.07, kept seven days." /> : null}
      <p className="dk-seo-competitors-note">
        {o.state === "ok" ? `${num(o.value.count)} phrases, ${num(o.value.top3)} in the top three, ${num(o.value.top10)} in the top ten.` : o.state === "off" ? o.reason : o.reason}{" "}
        {b.state === "ok" ? `Links: ${b.value.referringDomains === null ? "not given" : num(b.value.referringDomains)} referring domains.` : ""}
      </p>
      {r.state === "ok" && r.value.rows.length ? (
        <ul className="dk-seo-competitors-plain">
          {r.value.rows.slice(0, 10).map((x) => (
            <li key={x.keyword}>
              <span className="dk-num">#{x.position}</span> {x.keyword}
              {x.volume !== null ? <span className="dk-seo-competitors-quiet"> · {num(x.volume)} a month</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ---------- who ranks: the checks ----------------------------------------------------------------- */

function Changes({ c }: { c: SerpChange | null | undefined }) {
  if (!c) return null;
  if (!c.newcomers.length && !c.gone.length && !c.moved.length) return <p className="dk-seo-competitors-note">The same ten as on {day(c.since)}.</p>;
  return (
    <p className="dk-seo-competitors-note">
      Since {day(c.since)}: {c.newcomers.length ? `new ${c.newcomers.join(", ")}` : "nobody new"}
      {c.gone.length ? `; gone ${c.gone.join(", ")}` : ""}
      {c.moved.length ? `; moved ${c.moved.map((m) => `${m.host} ${m.from}→${m.to}`).join(", ")}` : ""}.
    </p>
  );
}

const STATE: Record<SerpView["check"]["state"], { tone: "good" | "warn" | "bad" | "quiet"; label: string }> = {
  queued: { tone: "warn", label: "Waiting" },
  running: { tone: "warn", label: "Being fetched" },
  done: { tone: "good", label: "Done" },
  failed: { tone: "bad", label: "No answer" },
};

function Check({ v, base, title }: { v: SerpView; base: Record<string, string>; title: string }) {
  const s = STATE[v.check.state];
  return (
    <section className="dk-seo-competitors-section" aria-label={title}>
      <h3 className="dk-seo-competitors-h">
        {title}{" "}
        <Badge tone={s.tone} dot>
          {s.label}
        </Badge>
      </h3>
      <p className="dk-seo-competitors-note">
        {v.check.label}. {v.check.line}
        {v.check.doneAt ? ` ${ago(v.check.doneAt)}.` : ` Asked ${ago(v.check.requestedAt)} by ${v.check.requestedBy}.`}
      </p>
      {v.check.state === "queued" ? <ActButton path={`/serp/${v.check.id}/withdraw`} body={{}} label="Take it back" icon="x" title="Nothing is asked of Google for it." /> : null}
      {v.check.state === "done" && v.rows.some((r) => !r.ours) ? (
        <BriefButton
          task={{ kind: "serp", serpId: v.check.id }}
          label="What do they have that we lack?"
          step={`Queues a comparison for the AI Operator on the studio workstation (its local model): these results beside our page for “${v.check.phrase}”, and what to add. Nothing on the website changes.`}
        />
      ) : null}
      {v.rows.length ? (
        <ol className="dk-seo-competitors-serp">
          {v.rows.map((r) => (
            <li key={`${r.position}-${r.url}`} className={cx(r.ours && "dk-seo-competitors-serp--ours")}>
              <span className="dk-num dk-seo-competitors-serp-pos">{r.position}</span>
              <span className="dk-seo-competitors-serp-body">
                {r.ours ? (
                  <span className="dk-seo-competitors-name">Balkaris</span>
                ) : r.known ? (
                  <Go href={hrefWith(base, { open: r.key })} scroll={false} className="dk-seo-competitors-name" title="Open it beside Balkaris">
                    {r.host.replace(/^www\./, "")}
                  </Go>
                ) : (
                  <Go href={lookHref(base, r.key)} scroll={false} className="dk-seo-competitors-name" title="Look it up">
                    {r.host.replace(/^www\./, "")}
                  </Go>
                )}
                <span className="dk-seo-competitors-quiet">{r.title}</span>
              </span>
              {safeHref(r.url) ? (
                <Go href={r.url} className="dk-seo-competitors-ext" aria-label={`Open ${shortUrl(r.url)}`}>
                  <Icon name="external" size={12} />
                </Go>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {v.local.length ? (
        <p className="dk-seo-competitors-note">
          Map pack: {v.local.map((l, i) => `${i + 1}. ${l.name}${l.rating !== null ? ` (${l.rating}★${l.reviews !== null ? `, ${num(l.reviews)}` : ""})` : ""}`).join(" · ")}
        </p>
      ) : null}
      {v.check.state === "done" ? <p className="dk-seo-competitors-note">{v.check.ownPosition ? `Balkaris at ${v.check.ownPosition}.` : "Balkaris is not in the first ten."}{v.ads ? ` ${v.ads} ad${v.ads === 1 ? "" : "s"} above, not counted.` : ""}</p> : null}
      <Changes c={v.changes} />
      {v.related.length ? <p className="dk-seo-competitors-note">Also searched: {v.related.slice(0, 8).join(", ")}.</p> : null}
    </section>
  );
}

export function Serp({ reading, base, owner }: { reading: SeoCompetitorsPayload["serp"]; base: Record<string, string>; owner: boolean }) {
  if (!reading) return null;
  if (reading.state !== "ok") {
    return (
      <Card className="dk-seo-competitors-serpcard" title="Who ranks" icon="search">
        <Absent reading={reading} />
      </Card>
    );
  }
  const p: SerpPanel = reading.value;
  return (
    <Card
      className="dk-seo-competitors-serpcard"
      title={p.phrase ? `Who ranks for “${p.phrase}”` : "Who ranks: the checks"}
      icon="search"
      sub={p.lane.line}
      right={
        <span className="dk-seo-competitors-right">
          <RecordGoogle owner={owner} phrase={p.phrase} />
          {p.phrase ? (
            <Go href={hrefWith(base, { serp: undefined, serpLang: undefined })} scroll={false} className="dk-seo-competitors-task-link">
              Close
            </Go>
          ) : null}
        </span>
      }
      divided
    >
      {p.phrase ? (
        <div className="dk-seo-competitors-serpgrid">
          {p.google ? <Check v={p.google} base={base} title="Google" /> : <p className="dk-seo-competitors-note">No Google check of this phrase is kept. Check it above.</p>}
          {p.duckduckgo ? <Check v={p.duckduckgo} base={base} title="DuckDuckGo (a second opinion, not Google)" /> : null}
        </div>
      ) : null}
      {!p.dataforseo.configured ? <p className="dk-seo-competitors-note">Google pages answered at once need DataForSEO, which is not connected. {p.dataforseo.step}</p> : null}
      {p.recent.length ? (
        <section className="dk-seo-competitors-section" aria-label="Recent checks">
          <h3 className="dk-seo-competitors-h">Recent checks</h3>
          <ul className="dk-seo-competitors-plain">
            {p.recent.map((r) => (
              <li key={r.id}>
                <Go href={serpHref(base, r.phrase, r.lang)} scroll={false} className="dk-seo-competitors-task-link">
                  {r.phrase}
                </Go>{" "}
                <span className="dk-seo-competitors-quiet">
                  {r.engine === "google" ? "Google" : "DuckDuckGo"} · {STATE[r.state].label.toLowerCase()}
                  {r.state === "done" ? ` · ${r.ownPosition ? `Balkaris ${r.ownPosition}` : "Balkaris not in ten"}` : ""} · {ago(r.doneAt ?? r.requestedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="dk-seo-competitors-note">No check has been asked yet.</p>
      )}
    </Card>
  );
}

/* ---------- the captured searches ----------------------------------------------------------------- */

export function Searches({ reading, base, owner }: { reading: SeoCompetitorsPayload["searches"]; base: Record<string, string>; owner: boolean }) {
  if (!reading) return null;
  if (reading.state !== "ok") {
    return (
      <Card className="dk-seo-competitors-searches" title="Captured searches" icon="list" right={<ImportAudit owner={owner} />}>
        <Absent reading={reading} />
      </Card>
    );
  }
  const v: SearchPanel = reading.value;
  const c = v.chosen;
  return (
    <Card
      className="dk-seo-competitors-searches"
      title="Captured searches"
      icon="list"
      sub={`${num(v.rows.length)} searches with a Google result page kept${v.unfiled ? `; ${num(v.unfiled)} under no cluster` : ""}. Choose one for its page.`}
      right={
        <span className="dk-seo-competitors-right">
          <Stamp reading={reading} />
          <ImportAudit owner={owner} />
        </span>
      }
      divided
    >
      <ul className="dk-seo-competitors-plain dk-seo-competitors-searchlist">
        {v.rows.map((r) => (
          <li key={r.query} className={cx(c?.query === r.query && "dk-seo-competitors-searchlist--on")}>
            <Go href={hrefWith(base, { search: c?.query === r.query ? undefined : r.query })} scroll={false} className="dk-seo-competitors-task-link">
              {r.query}
            </Go>{" "}
            <span className="dk-seo-competitors-quiet">
              {r.cluster ? r.cluster.name : "no cluster"} · {num(r.sites)} site{r.sites === 1 ? "" : "s"} · {r.ours.position !== null ? (r.ours.how === "capture" ? `Balkaris ${r.ours.position}` : `Balkaris ≈${r.ours.position} (Search Console)`) : "Balkaris not recorded"} · {day(r.days[0])}
            </span>
          </li>
        ))}
      </ul>
      {c ? (
        <section className="dk-seo-competitors-section" aria-label={`The result page for ${c.query}`}>
          <h3 className="dk-seo-competitors-h">“{c.query}”, as captured on {day(c.days[0])}</h3>
          <p className="dk-seo-competitors-note">
            By {c.by}. {c.ours.line}. Filed {c.filed === "hand" ? "by hand" : c.filed === "words" ? "by the words rule" : c.filed === "audit" ? "by the keyword table" : "under no cluster"}
            {c.cluster ? `: ${c.cluster.name}` : ""}.{" "}
            <Go href={serpHref(base, c.query, c.lang)} scroll={false} className="dk-seo-competitors-task-link">
              Check it again now
            </Go>
          </p>
          <FileSearch query={c.query} current={c.cluster?.key ?? null} clusters={v.clusters} />
          <ol className="dk-seo-competitors-serp">
            {(c.organic ?? []).map((r) => (
              <li key={`${r.position}-${r.key}`} className={cx(r.ours && "dk-seo-competitors-serp--ours")}>
                <span className="dk-num dk-seo-competitors-serp-pos">{r.position}</span>
                <span className="dk-seo-competitors-serp-body">
                  {r.ours ? (
                    <span className="dk-seo-competitors-name">Balkaris</span>
                  ) : (
                    <Go href={hrefWith(base, { open: r.key })} scroll={false} className="dk-seo-competitors-name">
                      {r.name}
                    </Go>
                  )}
                  {r.title ? <span className="dk-seo-competitors-quiet">{r.title}</span> : null}
                </span>
                {safeHref(r.url) ? (
                  <Go href={r.url!} className="dk-seo-competitors-ext" aria-label={`Open ${shortUrl(r.url!)}`}>
                    <Icon name="external" size={12} />
                  </Go>
                ) : null}
              </li>
            ))}
          </ol>
          {c.mapPack?.length ? <p className="dk-seo-competitors-note">Map pack: {c.mapPack.map((m) => `${m.position}. ${m.name}`).join(" · ")}</p> : null}
          <Changes c={c.changes} />
          {c.days.length > 1 ? <p className="dk-seo-competitors-note">Captured on {c.days.map((d) => day(d)).join(", ")}.</p> : null}
        </section>
      ) : null}
    </Card>
  );
}
