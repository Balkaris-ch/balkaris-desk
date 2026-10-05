import type { BesideRow, CompetitorDetail, CompetitorPage, SeoCompetitorsPayload, Sighting } from "@/contract/seo/competitors";
import { Badge, Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { DASH, num, shortDate } from "@/lib/format";
import { ActButton, MergeForm } from "./Act";
import { byLabel, count, day, engineIcon, hrefWith, KIND_LABEL, langChip, lookHref, safeHref, seenAs, shortUrl, shownHost, shownName, taskWho } from "./look";

/**
 * One competitor in detail, beside the list: what it shows next to what
 * Balkaris shows (each line says how both sides were read), where it
 * was seen, and its pages as the desk read them.
 */
export function CompDetail({ reading, list, clear, base }: { reading: SeoCompetitorsPayload["selected"]; list: SeoCompetitorsPayload["list"]; clear: string | null; base: Record<string, string> }) {
  if (!reading) {
    /* Nothing is chosen because there is nothing to choose: the list's own reason and step say why, or the filters left no row. */
    if (list.state !== "ok") {
      return (
        <Card title="Competitor" icon="users" className="dk-seo-competitors-detail">
          <Absent reading={list} />
        </Card>
      );
    }
    return (
      <Card title="Competitor" icon="users" className="dk-seo-competitors-detail">
        {list.value.total === 0 ? (
          <Empty
            icon="filter"
            title="No competitor matches these filters"
            action={
              clear ? (
                <Go href={clear} scroll={false} className="dk-seo-competitors-task-link">
                  Show every competitor
                </Go>
              ) : undefined
            }
          >
            Change the filters over the list to choose one to set beside Balkaris.
          </Empty>
        ) : (
          <Empty icon="users" title="Nothing chosen">
            Choose a competitor in the list to see it beside Balkaris.
          </Empty>
        )}
      </Card>
    );
  }
  if (reading.state !== "ok") {
    return (
      <Card title="Competitor" icon="users" className="dk-seo-competitors-detail">
        <Absent reading={reading} />
        {base.open ? (
          <p className="dk-seo-competitors-note dk-seo-competitors-pad">
            <Go href={lookHref(base, base.open)} scroll={false} className="dk-seo-competitors-task-link">
              Look up {base.open}
            </Go>{" "}
            ·{" "}
            <Go href={hrefWith(base, { open: undefined })} scroll={false} className="dk-seo-competitors-task-link">
              Show the list's first
            </Go>
          </p>
        ) : null}
      </Card>
    );
  }
  const d = reading.value;
  const c = d.competitor;
  const name = shownName(c.domain, c.name);
  const host = shownHost(c.domain);
  const site = safeHref(d.site);
  return (
    <Card
      className="dk-seo-competitors-detail"
      title={name}
      icon="users"
      sub={
        <span className="dk-seo-competitors-detail-sub">
          {site && host ? (
            <Go href={site} className="dk-seo-competitors-ext">
              {host}
              <Icon name="external" size={12} />
            </Go>
          ) : (
            <span>Named without a site</span>
          )}
          {site && host ? (
            /* Technical's one-page audit of their home page (titles, headings, structured data); it reopens a kept audit or fills in the address. */
            <Go href={`/seo/technical?audit=${encodeURIComponent(site)}#audit`} className="dk-seo-competitors-task-link" title="Audit their home page on Technical: one press there reads it">
              Audit their page
            </Go>
          ) : null}
          {host ? (
            <Go href={lookHref(base, c.domain)} scroll={false} className="dk-seo-competitors-task-link" title="Their public facts beside Balkaris">
              Beside Balkaris
            </Go>
          ) : null}
          {c.platform ? <Chip className="dk-seo-competitors-mini">platform</Chip> : null}
          {c.alsoNamed.length ? <span className="dk-seo-competitors-quiet">also named “{c.alsoNamed.join("”, “")}”</span> : null}
          {c.decision?.watch ? <Chip tone="good" className="dk-seo-competitors-mini">watched, added by {c.decision.by}</Chip> : null}
          {c.decision?.ignore ? <Chip className="dk-seo-competitors-mini">ignored by {c.decision.by}</Chip> : null}
        </span>
      }
      right={<Stamp reading={reading} />}
      divided
    >
      <div className="dk-seo-competitors-facts">
        <Fact label="Google" value={c.bestPosition !== null ? `#${c.bestPosition}` : DASH} title="Best organic position for one of our searches" />
        <Fact label="Map pack" value={c.mapPack !== null ? `#${c.mapPack}` : DASH} title="Best position in Google's map pack" />
        <Fact label="AI named" value={num(c.named)} title="Times an AI answer named it" />
        <Fact label="AI cited" value={num(c.cited)} title="Times an AI answer cited its site as a source" />
        <Fact label="Searches" value={num(c.queries.length)} title="Searches and questions it was seen for" />
      </div>

      <Decide d={d} base={base} />

      <section className="dk-seo-competitors-section" aria-label="Beside Balkaris">
        <h3 className="dk-seo-competitors-h">Beside Balkaris</h3>
        <p className="dk-seo-competitors-note">{d.against.line}</p>
        <Beside rows={d.beside} />
      </section>

      <section className="dk-seo-competitors-section" aria-label="Where it was seen">
        <h3 className="dk-seo-competitors-h">
          Where it was seen <span className="dk-seo-competitors-quiet">({num(d.sightings.length)})</span>
        </h3>
        <Seen list={d.sightings} />
      </section>

      {d.topics?.length ? (
        <section className="dk-seo-competitors-section" aria-label="What its pages target">
          <h3 className="dk-seo-competitors-h">What its pages target, in our clusters</h3>
          <ul className="dk-seo-competitors-plain">
            {d.topics.map((t) => (
              <li key={t.cluster.key}>
                <Go href={`/seo/content-gaps?cluster=${encodeURIComponent(t.cluster.key)}`} className="dk-seo-competitors-task-link" title="Open the cluster on Content Gaps">
                  {t.cluster.name}
                </Go>{" "}
                <span className="dk-seo-competitors-quiet">{t.pages.map((p) => p.title ?? shortUrl(p.url)).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="dk-seo-competitors-section" aria-label="Its pages">
        <h3 className="dk-seo-competitors-h">
          Its pages <span className="dk-seo-competitors-quiet">({pagesLine(d.pages)})</span>
        </h3>
        <Pages d={d} />
      </section>
    </Card>
  );
}

function Fact({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <span className="dk-seo-competitors-fact" title={title}>
      <span className="dk-seo-competitors-fact-v dk-num">{value}</span>
      <span className="dk-seo-competitors-fact-l">{label}</span>
    </span>
  );
}

function Verdict({ lack, scale }: { lack: boolean | null; scale: boolean }) {
  if (lack === true) return <Badge tone="bad" dot>We lack it</Badge>;
  if (lack === false) return <Badge tone="good" dot>Not a lack</Badge>;
  return <Badge tone="quiet">{scale ? "For scale" : "Not compared"}</Badge>;
}

function Beside({ rows }: { rows: BesideRow[] }) {
  return (
    <div className="dk-seo-competitors-beside" role="table" aria-label="Them beside us">
      <div className="dk-seo-competitors-beside-head" role="row">
        <span role="columnheader">What</span>
        <span role="columnheader">Them</span>
        <span role="columnheader">Balkaris</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className={cx("dk-seo-competitors-beside-row", r.lack === true && "dk-seo-competitors-beside-row--lack")} role="row">
          <span className="dk-seo-competitors-beside-label" role="cell">
            <span>{r.label}</span>
            <Verdict lack={r.lack} scale={r.key === "words"} />
          </span>
          <span className="dk-seo-competitors-beside-them" role="cell">
            {r.them}
          </span>
          <span className="dk-seo-competitors-beside-us" role="cell">
            {r.us}
            {r.task ? (
              <span className="dk-seo-competitors-task" title={`${taskWho(r.task)}: ${r.task.title}`}>
                {r.task.href ? (
                  <Go href={r.task.href} className="dk-seo-competitors-task-link">
                    {taskWho(r.task)}: {r.task.title}
                  </Go>
                ) : (
                  <span>
                    {taskWho(r.task)}: {r.task.title}
                  </span>
                )}
                {r.task.done ? " (marked done)" : ""}
              </span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The first observations in sight; the rest behind one fold, so a much-seen competitor does not push its pages off the panel. */
const SEEN_FIRST = 8;

function Seen({ list }: { list: Sighting[] }) {
  if (!list.length) return <p className="dk-seo-competitors-note">No observation is recorded.</p>;
  const rest = list.slice(SEEN_FIRST);
  return (
    <>
      <SeenList list={list.slice(0, SEEN_FIRST)} />
      {rest.length ? (
        <details className="dk-seo-competitors-more">
          <summary>
            <Icon name="chevron-down" size={13} />
            {rest.length} more
          </summary>
          <SeenList list={rest} />
        </details>
      ) : null}
    </>
  );
}

function SeenList({ list }: { list: Sighting[] }) {
  return (
    <ul className="dk-seo-competitors-seen">
      {list.map((s, i) => (
        <li key={`${s.engine}-${s.kind}-${s.query}-${i}`} className="dk-seo-competitors-seen-row">
          <span className={cx("dk-seo-competitors-seen-icon", s.kind === "named" || s.kind === "cited" ? "dk-tone-violet" : "dk-tone-good")} aria-hidden>
            <Icon name={engineIcon(s.engine)} size={13} />
          </span>
          <span className="dk-seo-competitors-seen-text">
            <span className="dk-seo-competitors-seen-q" title={s.query}>
              “{s.query}”
            </span>
            <span className="dk-seo-competitors-seen-meta">
              {s.engineLabel}
              {s.kind === "local-pack" ? "" : ` · ${KIND_LABEL[s.kind].toLowerCase()}`}
              {s.cluster ? (
                <>
                  {" · "}
                  <span title={s.filed === "words" ? "Filed under this cluster by the page's words rule" : "Filed under this cluster by the keyword table"}>
                    {s.cluster.name}
                    {s.filed === "words" ? "*" : ""}
                  </span>
                </>
              ) : null}
            </span>
          </span>
          <Tooltip text={`Seen on ${day(s.day)} by ${byLabel(s.by)}.`}>
            <span className="dk-seo-competitors-seen-pos" tabIndex={0}>
              {seenAs(s)}
              <span className="dk-seo-competitors-quiet"> · {shortDate(s.day)}</span>
            </span>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

function Pages({ d }: { d: CompetitorDetail }) {
  if (!d.pages.length) {
    return <p className="dk-seo-competitors-note">{d.competitor.platform ? "A platform's pages are not compared as a competitor's." : d.site ? "None of its pages is on the desk's list yet: Read its pages takes the ones of its sitemap that answer our clusters." : "It was named without a site, so there is no page to read."}</p>;
  }
  return (
    <ul className="dk-seo-competitors-pagelist">
      {d.pages.map((p) => (
        <PageItem key={p.url} p={p} />
      ))}
    </ul>
  );
}

function PageItem({ p }: { p: CompetitorPage }) {
  const href = safeHref(p.url);
  return (
    <li className="dk-seo-competitors-pageitem">
      <span className="dk-seo-competitors-pageitem-top">
        {href ? (
          <Go href={href} className="dk-seo-competitors-ext dk-seo-competitors-pageurl" title={p.url}>
            {shortUrl(p.url)}
            <Icon name="external" size={12} />
          </Go>
        ) : (
          <span>{p.url}</span>
        )}
        <Chip className="dk-seo-competitors-mini">{p.address === "home" ? "home page" : p.address === "topic" ? `its page for ${p.cluster?.name ?? "a cluster"}` : "page that ranks"}</Chip>
      </span>
      {p.error ? (
        <span className="dk-seo-competitors-note">
          Not read: {p.error}
          {p.fetchedAt ? ` (${shortDate(p.fetchedAt)})` : ""}.
        </span>
      ) : !p.fetchedAt ? (
        <span className="dk-seo-competitors-note">Not read yet: the weekly read takes it next.</span>
      ) : (
        <>
          {p.title ? (
            <span className="dk-seo-competitors-pagetitle" title={p.title}>
              {p.title}
            </span>
          ) : null}
          <span className="dk-seo-competitors-pagefacts">
            <Chip tone={p.lang?.startsWith("de") ? "good" : "quiet"} className="dk-seo-competitors-mini" icon="globe">
              {langChip(p.lang)}
            </Chip>
            <span title={p.words === 0 ? "No words in the HTML a crawler gets: the page may draw its text with JavaScript, which the desk does not run." : undefined}>
              {p.words === null ? "words not counted" : p.words === 0 ? "no text in its HTML" : count(p.words, "word")}
            </span>
            <PriceLine p={p} />
          </span>
          {p.schemaTypes.length ? (
            <span className="dk-seo-competitors-schema" title="Its JSON-LD types">
              {p.schemaTypes.map((t) => (
                <span key={t} className="dk-seo-competitors-schema-t">
                  {t}
                </span>
              ))}
            </span>
          ) : (
            <span className="dk-seo-competitors-note">No structured data.</span>
          )}
          <span className="dk-seo-competitors-quiet dk-seo-competitors-small">
            Read {shortDate(p.fetchedAt)}
            {p.query ? ` for “${p.query}”` : ""}
            {p.address === "home" ? ": the capture named only the site, so its home page was read; it is not necessarily the page that ranks." : ""}
          </span>
        </>
      )}
    </li>
  );
}

function PriceLine({ p }: { p: Pick<CompetitorPage, "priceStated" | "priceText" | "priceDoubt"> }) {
  if (p.priceStated === true) return <span className="dk-seo-competitors-price">states “{p.priceText ?? "a price"}”</span>;
  if (p.priceDoubt) {
    return (
      <Tooltip text={p.priceDoubt}>
        <span className="dk-seo-competitors-quiet" tabIndex={0}>
          “{p.priceText}” not counted
        </span>
      </Tooltip>
    );
  }
  return <span className="dk-seo-competitors-quiet">no price stated</span>;
}

export { PriceLine };

/** "3 read, 1 could not be read, 2 not read yet": only pages that answered count as read. */
function pagesLine(pages: CompetitorPage[]): string {
  const read = pages.filter((p) => p.fetchedAt && !p.error).length;
  const failed = pages.filter((p) => p.error).length;
  const waiting = pages.filter((p) => !p.fetchedAt).length;
  return [`${num(read)} read`, failed ? `${num(failed)} could not be read` : "", waiting ? `${num(waiting)} not read yet` : ""].filter(Boolean).join(", ");
}

/**
 * A person's word on this row: watch it, ignore it, count it as a platform or
 * a site over the desk's list, merge it with another, read its pages. Kept by
 * the desk with the name of who said it; the observations are never deleted.
 */
function Decide({ d, base }: { d: CompetitorDetail; base: Record<string, string> }) {
  const c = d.competitor;
  const key = c.domain;
  const site = !key.startsWith("name:");
  const dec = c.decision ?? null;
  const kindLabel = dec?.kind ? "Platform by the desk's list" : c.platform ? "Count as a site" : "Count as a platform";
  const kindTitle = dec?.kind
    ? `You said ${dec.kind}; this gives the decision back to the desk's list.`
    : c.platform
      ? "Over the desk's list of platforms: its pages are read and compared as a competitor's."
      : "A directory or platform, not a studio: its pages are not compared.";
  return (
    <div className="dk-seo-competitors-actions" aria-label="Your word on it">
      {site && !dec?.watch ? <ActButton path="/watch" body={{ input: key }} label="Watch" icon="eye" title="Keeps it on the list as a competitor you chose, its home page read every week." /> : null}
      {site && dec?.watch ? <ActButton path="/watch" body={{ input: key, watch: false }} label="Stop watching" icon="eye" /> : null}
      <ActButton
        path="/decide"
        body={{ domain: key, ignore: !dec?.ignore }}
        label={dec?.ignore ? "Stop ignoring" : "Ignore"}
        icon={dec?.ignore ? "eye" : "x"}
        title={dec?.ignore ? "Back on the list and in its counts." : "Hidden from the list and its counts (Shown: Ignored finds it); its observations are kept."}
      />
      <ActButton path="/decide" body={{ domain: key, kind: dec?.kind ? "auto" : c.platform ? "studio" : "platform" }} label={kindLabel} icon="tag" title={kindTitle} />
      {site && !c.platform ? <ActButton path="/read" body={{ domain: key }} label="Read its pages" icon="sitemap" busyLabel="Reading its sitemap…" title="Reads its sitemap for the pages that answer our clusters, then reads them, two seconds apart." /> : null}
      {site ? (
        <Go href={lookHref(base, key)} scroll={false} className="dk-seo-competitors-task-link">
          Look it up
        </Go>
      ) : null}
      {d.mergeWith?.length ? <MergeForm domain={key} options={d.mergeWith} /> : null}
      {d.merged?.map((m) => <ActButton key={m.key} path="/decide" body={{ domain: m.key, mergeInto: null }} label={`Count “${m.name}” apart again`} icon="minus" title={`Merged into this row by ${m.by}.`} />)}
    </div>
  );
}
