import type { SerpCheck } from "@/contract/seo/common";
import type { SerpView } from "@/contract/seo/keywords";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { DASH, shortDate } from "@/lib/format";
import { closeHref, openHref, type Place } from "./href";
import { WhoRanks } from "./KwWeb";

/**
 * Who ranks for a phrase: the newest result pages the desk kept, what is on
 * its way and the phrase's history. Google's page is fetched by the studio
 * workstation from its own line (or DataForSEO, once connected); DuckDuckGo's
 * is read by the server and always labelled as a second opinion, never as
 * Google's ranking. Each page shows its day.
 */

const when = (iso: string | null): string => (iso ? `${shortDate(iso.slice(0, 10))}, ${iso.slice(11, 16)} UTC` : DASH);

function Page({ check, own }: { check: SerpCheck; own: boolean }) {
  const p = check.page;
  if (!p) return <p className="dk-seo-kw-basis">{check.line}</p>;
  return (
    <div className="dk-seo-kw-serp-page">
      <p className="dk-seo-kw-serp-head">
        <strong>{check.label}</strong> · {when(check.doneAt)}
        {own ? (check.ownPosition ? ` · Balkaris at ${check.ownPosition}` : " · Balkaris not in the first ten") : ""}
        {p.ads ? ` · ${p.ads} ad${p.ads === 1 ? "" : "s"}` : ""}
      </p>
      <ol className="dk-seo-kw-serp-list">
        {p.organic.map((o) => (
          <li key={`${o.position}-${o.url}`} className={check.ownPosition === o.position ? "dk-seo-kw-serp-own" : undefined}>
            <span className="dk-num dk-seo-kw-serp-pos">{o.position}</span>
            <span className="dk-seo-kw-serp-what">
              <a href={o.url} target="_blank" rel="noreferrer" className="dk-seo-kw-serp-title">
                {o.title || o.host}
              </a>
              <span className="dk-seo-kw-serp-host">{o.host}</span>
            </span>
          </li>
        ))}
      </ol>
      {p.localPack.length ? (
        <div className="dk-seo-kw-serp-more">
          <p className="dk-seo-kw-serp-head">The map pack (placed by where the asker is)</p>
          <ul className="dk-seo-kw-serp-plain">
            {p.localPack.map((l) => (
              <li key={l.name}>
                {l.name}
                {l.rating !== null ? ` · ${l.rating}★${l.reviews !== null ? ` (${l.reviews})` : ""}` : ""}
                {l.category ? ` · ${l.category}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.related.length ? <p className="dk-seo-kw-basis">People also search for: {p.related.slice(0, 8).join("; ")}.</p> : null}
      {p.questions.length ? <p className="dk-seo-kw-basis">People also ask: {p.questions.slice(0, 6).join(" ")}</p> : null}
    </div>
  );
}

/** The body: Google's page, DuckDuckGo's second opinion, what is on its way, the history. */
export function SerpBody({ view, place }: { view: SerpView; place: Place }) {
  const g = view.google;
  const d = view.duckduckgo;
  const older = view.history.filter((h) => h.id !== g?.id && h.id !== d?.id && h.id !== view.pending?.id);
  return (
    <div className="dk-seo-kw-serp">
      <div className="dk-seo-kw-serp-bar">
        <WhoRanks place={place} phrase={view.phrase} lang={view.lang} id={view.tracked} label={g || d ? "Check again" : "Check who ranks"} />
        <span className="dk-seo-kw-basis">{view.lane.line}</span>
      </div>
      {view.pending ? (
        <p className="dk-seo-kw-serp-pending">
          <Icon name="hourglass" size={14} /> {view.pending.label}: {view.pending.line}
          {view.pending.source === "workstation" ? ` The workstation is ${view.lane.workstation.on ? "on" : "not on"}: ${view.lane.workstation.line}` : ""}
        </p>
      ) : null}
      {view.kept ? <p className="dk-seo-kw-basis">{view.kept.line}</p> : null}
      {g ? <Page check={g} own /> : !view.pending ? <p className="dk-seo-kw-basis">Google&apos;s page has not been checked for it yet.</p> : null}
      {d ? (
        <div className="dk-seo-kw-serp-second">
          <Chip tone="quiet">Second opinion: DuckDuckGo, not Google</Chip>
          <Page check={d} own />
        </div>
      ) : null}
      {older.length ? (
        <details className="dk-seo-kw-serp-history">
          <summary>Earlier checks ({older.length})</summary>
          <ul className="dk-seo-kw-serp-plain">
            {older.map((h) => (
              <li key={h.id}>
                {when(h.doneAt ?? h.requestedAt)} · {h.label} · {h.state === "done" ? (h.ownPosition ? `Balkaris at ${h.ownPosition}` : "Balkaris not in the first ten") : h.line}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Who ranks for a phrase the keyword table does not hold (?serp=). */
export function KwSerpCard({ view, place }: { view: SerpView; place: Place }) {
  return (
    <Card
      title={`Who ranks for “${view.phrase}”`}
      icon="list"
      info="Google's first page as the studio workstation fetched it from its own line (or DataForSEO, once connected), with Balkaris's place; DuckDuckGo's page as a second opinion, never as Google's ranking. Each page keeps its day."
      right={
        <span className="dk-seo-kw-actions">
          {view.tracked ? (
            <Go href={openHref(place, view.tracked)} scroll={false} className="dk-seo-kw-reset">
              Its keyword view
            </Go>
          ) : null}
          <Go href={closeHref(place, "serp")} scroll={false} className="dk-seo-kw-reset">
            Close
          </Go>
        </span>
      }
    >
      <SerpBody view={view} place={place} />
    </Card>
  );
}
