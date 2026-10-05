import type { Reading } from "@/contract/common";
import type { KeywordDetail } from "@/contract/seo/keywords";
import { Spark, SparkBars } from "@/components/charts";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Absent } from "@/components/ui/Read";
import { DASH, num, shortDate } from "@/lib/format";
import { clearedHref, closeHref, keywordsHref, openHref, optimizeHref, oppsForPhrase, researchHref, type Place } from "./href";
import { BriefButton, KeywordMenu } from "./KwAct";
import { EditKeyword, ResearchThis } from "./KwWeb";
import { SerpBody } from "./KwSerp";
import { byWhom, INTENT_LABEL, INTENT_TONE, langLabel, pos, SOURCE_LABEL, STATUS_LABEL, volumeCell, webLang } from "./look";

/**
 * One keyword's own view (?open=<id>), above the list as Opportunities and
 * Competitors draw their open row: what Search Console saw day by day and on
 * which pages, who ranks on Google's page, what the research found from it,
 * where it is filed, its briefs and its demand figure when one exists, and
 * what can be done with it.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="dk-seo-kw-open-sec" aria-label={title}>
      <h3 className="dk-seo-kw-rgroup-head">{title}</h3>
      {children}
    </section>
  );
}

function Days({ series }: { series: KeywordDetail["series"] }) {
  if (series.state !== "ok") return <Absent reading={series} form="inline" />;
  const d = series.value;
  const shown = d.filter((x) => x.impressions > 0);
  if (!shown.length) return <p className="dk-seo-kw-basis">Google did not show the site for it in the window.</p>;
  const impressions = shown.reduce((n, x) => n + x.impressions, 0);
  const clicks = shown.reduce((n, x) => n + x.clicks, 0);
  return (
    <div className="dk-seo-kw-open-days">
      <p className="dk-seo-kw-basis">
        {num(impressions)} impressions, {num(clicks)} clicks on {num(shown.length)} of {num(d.length)} days ({shortDate(d[0]!.date)} – {shortDate(d[d.length - 1]!.date)}).
      </p>
      <span title="Impressions per day">
        <SparkBars data={d.map((x) => x.impressions)} />
      </span>
      <span title="Average position per day; a higher line is a better position">
        <Spark data={d.map((x) => (x.position === null ? null : -x.position))} label="Average position per day" />
      </span>
    </div>
  );
}

function Pages({ pages }: { pages: KeywordDetail["pages"] }) {
  if (pages.state !== "ok") return <Absent reading={pages} form="inline" />;
  if (!pages.value.length) return <p className="dk-seo-kw-basis">No page of the site was shown for it in the window.</p>;
  return (
    <ul className="dk-seo-kw-serp-plain">
      {pages.value.slice(0, 8).map((p) => (
        <li key={p.path}>
          <Go href={optimizeHref(p.path)} className="dk-seo-kw-path">
            {p.path}
          </Go>{" "}
          · {num(p.impressions)} impressions, {num(p.clicks)} clicks, position {pos(p.position)}
        </li>
      ))}
    </ul>
  );
}

export function KwOpen({ open, place }: { open: Reading<KeywordDetail>; place: Place }) {
  if (open.state !== "ok") {
    return (
      <Card title="Keyword" icon="key" right={<Go href={closeHref(place, "open")} scroll={false} className="dk-seo-kw-reset">Close</Go>}>
        <Absent reading={open} />
      </Card>
    );
  }
  const v = open.value;
  const r = v.row;
  const lang = webLang(r.lang);
  const busy = r.brief && (r.brief.state === "queued" || r.brief.state === "running") ? r.brief.task : null;
  return (
    <Card
      className="dk-seo-kw-open"
      title={`“${r.phrase}”`}
      icon="key"
      info="Everything the desk knows about this search: Search Console's days and pages over the head's period, Google's first page as last checked, what the research found from it, where it is filed and what was asked for it."
      right={
        <Go href={closeHref(place, "open")} scroll={false} className="dk-seo-kw-reset">
          Close
        </Go>
      }
    >
      <div className="dk-seo-kw-open-head">
        <span className="dk-seo-kw-engines">
          <Chip tone="quiet">{langLabel(r.lang)}</Chip>
          {r.intent ? <Chip tone={INTENT_TONE[r.intent]}>{INTENT_LABEL[r.intent]}</Chip> : null}
          <Chip tone={r.status === "relevant" ? "good" : r.status === "irrelevant" ? "bad" : "quiet"}>{STATUS_LABEL[r.status]}</Chip>
          {r.target ? <Chip tone="info">Target, by {r.target.by}</Chip> : null}
          {r.sources.map((s) => (
            <Chip key={s} tone="quiet">
              {SOURCE_LABEL[s]}
            </Chip>
          ))}
        </span>
        <span className="dk-seo-kw-actions">
          <ResearchThis place={place} phrase={r.phrase} lang={lang} label="Research it" />
          {busy ? null : <BriefButton url={`/api/v1/seo/keywords/${r.id}/brief`} label="Brief" title="The operator (the studio workstation's model) writes a brief for a page answering this search. A person writes and publishes." />}
          <EditKeyword id={r.id} phrase={r.phrase} cluster={r.cluster?.key ?? null} lang={r.lang} intent={r.intent} />
          <KeywordMenu
            id={r.id}
            phrase={r.phrase}
            lang={r.lang}
            target={!!r.target}
            status={r.status}
            page={r.page}
            opportunities={r.opportunities}
            oppsHref={oppsForPhrase(r.phrase)}
            mappedByPerson={r.mappedBy === "person"}
            removable={r.removable}
            briefBusy={busy}
            hrefs={{ open: openHref(place, r.id), research: researchHref(place, r.phrase, lang) }}
          />
        </span>
      </div>
      <div className="dk-seo-kw-open-grid">
        <Section title="Where it is filed">
          <ul className="dk-seo-kw-serp-plain">
            <li>
              Topic:{" "}
              {v.topic ? (
                <Go href={clearedHref(place, { view: "keywords", cluster: v.topic.key, status: "all", open: r.id })} scroll={false} className="dk-seo-kw-topic">
                  {v.topic.name}
                </Go>
              ) : (
                "none"
              )}
              {v.topic?.page ? ` (its page ${v.topic.page})` : ""}
            </li>
            <li>
              Page:{" "}
              {r.page ? (
                <Go href={optimizeHref(r.page)} className="dk-seo-kw-path">
                  {r.page}
                </Go>
              ) : (
                "no page answers it (a gap)"
              )}
              {r.mappedBy ? `, mapped by ${r.mappedBy === "person" ? "a person" : r.mappedBy === "rule" ? "the desk's rule" : "the audit"}` : ""}
            </li>
            <li>Judged {STATUS_LABEL[r.status].toLowerCase()} by {byWhom(r.statusBy)}{v.editedBy ? `; refiled by ${v.editedBy}` : ""}.</li>
            <li>First seen {shortDate(r.firstSeen.slice(0, 10))}.</li>
          </ul>
        </Section>
        <Section title="Search Console, day by day">
          <Days series={v.series} />
        </Section>
        <Section title="The pages Google showed for it">
          <Pages pages={v.pages} />
        </Section>
        <Section title="Search volume">
          <p className="dk-seo-kw-basis">
            {r.volume
              ? `${volumeCell(r.volume)}, ${shortDate(r.volume.at.slice(0, 10))}${r.volume.cpc !== null ? `; cost per click ${r.volume.cpc} ${r.volume.currency ?? ""}` : ""}${r.volume.difficulty ? `; difficulty ${r.volume.difficulty.value} (DataForSEO)` : ""}.`
              : "No monthly search figure: none was imported from Keyword Planner and DataForSEO is not connected. Impressions above are Search Console's for the site."}
          </p>
        </Section>
        <Section title="The research">
          <p className="dk-seo-kw-basis">
            {v.seed ? (
              <>
                Found by researching{" "}
                <Go href={researchHref(place, v.seed, lang)} scroll={false} className="dk-seo-kw-topic">
                  “{v.seed}”
                </Go>
                .{" "}
              </>
            ) : null}
            {v.found.length ? `${num(v.found.length)} phrase${v.found.length === 1 ? "" : "s"} in the table were found from it:` : "No phrase in the table was found from it yet."}
          </p>
          {v.found.length ? (
            <ul className="dk-seo-kw-serp-plain">
              {v.found.slice(0, 12).map((f) => (
                <li key={f.id}>
                  <Go href={openHref(place, f.id)} scroll={false}>
                    {f.phrase}
                  </Go>{" "}
                  · {STATUS_LABEL[f.status].toLowerCase()}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
        <Section title="Briefs">
          {v.briefs.length ? (
            <ul className="dk-seo-kw-serp-plain">
              {v.briefs.map((b) => (
                <li key={b.task}>
                  <Go href={`/operator?result=${b.task}`}>Operator task #{b.task}</Go> · {b.state} · {b.by}, {shortDate(b.at.slice(0, 10))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="dk-seo-kw-basis">No brief was asked for it from this page.</p>
          )}
        </Section>
      </div>
      <Section title="Who ranks on Google">
        <SerpBody view={v.serp} place={place} />
      </Section>
      {r.opportunities ? (
        <p className="dk-seo-kw-basis">
          <Go href={oppsForPhrase(r.phrase)}>Opportunities that name it</Go>
        </p>
      ) : null}
      <p className="dk-seo-kw-basis">
        <Go href={keywordsHref(place, { open: null, q: r.phrase, status: "all" })} scroll={false}>
          Find it in the table
        </Go>
        {r.position === null ? "" : ` · position ${pos(r.position)} over the window`}
      </p>
    </Card>
  );
}
